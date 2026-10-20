const admin = require('firebase-admin');

// ============================================================================
// AUTOMATED FEEDER (NODE B) DOMAIN CONTROLLER
// Compliant with Aquagen Feeder API Protocol (ESP32 & Vercel Final Architecture)
//
// Hardware Telemetry Scenarios (Uplink POST):
// 1. Instant Start: trigger_source = "START" (motor initiated spinning)
// 2. Action Confirmation: trigger_source in ["WEB", "AUTO", "BTN"] (cycle completed)
// 3. Volume Delta: trigger_source = "NONE", feed_triggered = false (ultrasonic change > 2.0cm)
//
// Downlink Polling (GET):
// Expects flat JSON: { pending_command, schedule_str, calibration_ms }
// ============================================================================

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

// Grams per unit. Returns null for non-weight units (e.g. "bags").
const gramsPerUnit = (unit) => {
    const u = String(unit || '').trim().toLowerCase();
    if (['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos'].includes(u)) return 1000;
    if (['g', 'gm', 'gms', 'gram', 'grams'].includes(u)) return 1;
    if (['t', 'ton', 'tons', 'tonne', 'tonnes'].includes(u)) return 1000000;
    return null;
};

const statusForQty = (qty) => (qty <= 0 ? 'out_of_stock' : qty < 20 ? 'low' : 'in_stock');

const getEatClock = (date = new Date()) => {
    const eat = new Date(date.getTime() + EAT_OFFSET_MS);
    return {
        hour: eat.getUTCHours(),
        dateKey: eat.toISOString().slice(0, 10), // YYYY-MM-DD in EAT
    };
};

/**
 * Atomically deducts dispensed feed from inventory exactly once per eventId.
 * Writes: inventory (qty/status), inventory_history, feed_events/{eventId}, logs.
 */
const deductFeed = async (db, { eventId, pondId, inventoryId, grams, source, trigger }) => {
    const eventRef = db.collection('feed_events').doc(eventId);
    const gramsNum = Number(grams) || 0;

    if (!inventoryId || gramsNum <= 0) {
        await eventRef.set({
            pond_id: pondId, trigger, source, grams: gramsNum, inventory_id: inventoryId || null,
            deducted: false, reason: !inventoryId ? 'no_inventory_item' : 'zero_grams',
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { deducted: false, reason: !inventoryId ? 'no_inventory_item' : 'zero_grams' };
    }

    const invRef = db.collection('inventory').doc(inventoryId);

    const result = await db.runTransaction(async (tx) => {
        const [eventSnap, invSnap] = await Promise.all([tx.get(eventRef), tx.get(invRef)]);

        if (eventSnap.exists && eventSnap.data().deducted) {
            return { deducted: false, skipped: true, reason: 'already_processed' };
        }
        if (!invSnap.exists) {
            tx.set(eventRef, {
                pond_id: pondId, trigger, source, grams: gramsNum, inventory_id: inventoryId,
                deducted: false, reason: 'inventory_item_missing',
                created_at: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            return { deducted: false, reason: 'inventory_item_missing' };
        }

        const item = invSnap.data();
        const perUnit = gramsPerUnit(item.unit);
        if (!perUnit) {
            tx.set(eventRef, {
                pond_id: pondId, trigger, source, grams: gramsNum, inventory_id: inventoryId,
                deducted: false, reason: `unsupported_unit:${item.unit}`,
                created_at: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            return { deducted: false, reason: `unsupported_unit:${item.unit}` };
        }

        const currentQty = Number(item.quantity) || 0;
        const change = gramsNum / perUnit;
        const newQty = Math.max(0, Number((currentQty - change).toFixed(3)));
        const actualChange = Number((newQty - currentQty).toFixed(3)); // negative, capped at stock
        const nowIso = new Date().toISOString();

        tx.update(invRef, { quantity: newQty, status: statusForQty(newQty), last_updated: nowIso });

        const triggerLabels = {
            manual: 'Web App Manual Drop',
            scheduled: 'Autonomous RTC Drop',
            button: 'Physical Manual Button Press',
        };
        const humanTrigger = triggerLabels[trigger] || trigger;

        tx.set(db.collection('inventory_history').doc(), {
            item_id: inventoryId,
            item_name: item.item_name || 'Unknown',
            change: actualChange,
            reason: `Feeder [${humanTrigger}] – ${pondId}: ${gramsNum}g`,
            changed_by_name: 'Automated Feeder',
            timestamp: nowIso,
        });

        tx.set(db.collection('logs').doc(), {
            timestamp: nowIso,
            technician_name: `Automated Feeder (${pondId})`,
            animal_type: 'Fish',
            event_type: 'Feeding',
            data: {
                ponds: [pondId],
                metrics: { feed_amount: `${gramsNum}g`, average_weight_g: null, water_parameters: null },
                feed_used: inventoryId,
                ai_confidence: 100,
                notes: `Feeder confirmation: ${humanTrigger}. Deducted ${Math.abs(actualChange)} ${item.unit} of ${item.item_name || 'feed'}.`,
                original_text: `[IoT Action Confirmation]: Pond=${pondId}, Trigger=${humanTrigger}, Dispensed=${gramsNum}g`,
            },
            source,
        });

        tx.set(eventRef, {
            pond_id: pondId, trigger, source, grams: gramsNum, inventory_id: inventoryId,
            item_name: item.item_name || 'Unknown', unit: item.unit,
            quantity_before: currentQty, quantity_after: newQty, change: actualChange,
            insufficient_stock: currentQty < change,
            deducted: true,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        return {
            deducted: true, item_name: item.item_name, change: actualChange,
            quantity_after: newQty, unit: item.unit, insufficient_stock: currentQty < change,
        };
    });

    return result;
};

/**
 * Downlink Claim: Atomically claims and clears pending_command when polled by ESP32.
 * Updates last_manual_feed.status to 'dispatched' (handshake in progress).
 */
const claimPendingCommand = async (db, pondId) => {
    const pondRef = db.collection('ponds').doc(pondId);

    return db.runTransaction(async (tx) => {
        const snap = await tx.get(pondRef);
        if (!snap.exists) return { pond: null, command: null, manual: null };

        const pond = snap.data();
        const command = pond.pending_command || null;
        if (!command) return { pond, command: null, manual: null };

        const updates = { pending_command: admin.firestore.FieldValue.delete() };
        let manual = null;

        const lmf = pond.last_manual_feed;
        if (command === 'CMD:FEED' && lmf && (!lmf.status || lmf.status === 'queued')) {
            manual = { ...pond.last_manual_feed };
            if (!manual.request_id) manual.request_id = `req_${Date.now()}`;
            updates['last_manual_feed.status'] = 'dispatched';
            updates['last_manual_feed.request_id'] = manual.request_id;
            updates['last_manual_feed.dispatched_at'] = admin.firestore.FieldValue.serverTimestamp();
        }

        tx.update(pondRef, updates);
        return { pond, command, manual };
    });
};

/**
 * Uplink: Processes telemetry packet according to the 3 hardware protocol scenarios:
 * 1. Instant Start: trigger_source = "START"
 * 2. Action Confirmation: trigger_source in ["WEB", "AUTO", "BTN"]
 * 3. Volume Delta: trigger_source = "NONE" (or feed_triggered = false)
 */
const processTelemetryUplink = async (db, payload) => {
    const pondId = String(payload.pond_id || '').toUpperCase();
    const distanceCm = Number(payload.distance_cm);
    const feedTriggered = payload.feed_triggered === true || payload.feed_triggered === 'true' || payload.feed_triggered === 1;
    const triggerSource = String(payload.trigger_source || 'NONE').toUpperCase();
    const hardwareTimestamp = Number(payload.hardware_timestamp) || null;
    const rssi = Number(payload.rssi) || null;

    // 1. Ingest telemetry log entry into 'feeder_telemetry'
    const telemetryEntry = {
        pond_id: pondId,
        distance_cm: Number.isFinite(distanceCm) ? distanceCm : null,
        feed_triggered: feedTriggered,
        trigger_source: triggerSource,
        hardware_timestamp: hardwareTimestamp,
        rssi: Number.isFinite(rssi) ? rssi : null,
        created_at: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('feeder_telemetry').add(telemetryEntry);

    // 2. Update real-time pond state
    const pondRef = db.collection('ponds').doc(pondId);
    const pondSnap = await pondRef.get();
    const pondData = pondSnap.exists ? pondSnap.data() : {};

    const pondUpdates = {
        last_telemetry: {
            distance_cm: Number.isFinite(distanceCm) ? distanceCm : null,
            feed_triggered: feedTriggered,
            trigger_source: triggerSource,
            rssi: Number.isFinite(rssi) ? rssi : null,
            hardware_timestamp: hardwareTimestamp,
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        }
    };

    let deductionOutcome = null;

    // SCENARIO 1: INSTANT START (Motor initiated spinning)
    if (triggerSource === 'START') {
        pondUpdates.feeder_state = 'spinning';
        pondUpdates.motor_active = true;
        if (pondData.last_manual_feed && pondData.last_manual_feed.status === 'dispatched') {
            pondUpdates['last_manual_feed.status'] = 'feeding';
        }
        await pondRef.set(pondUpdates, { merge: true });
        return { scenario: 'instant_start', trigger_source: 'START', state: 'spinning' };
    }

    // SCENARIOS 2 & 3: ACTION CONFIRMATION (Motor finished cycle) or VOLUME DELTA
    pondUpdates.feeder_state = 'idle';
    pondUpdates.motor_active = false;

    if (triggerSource === 'WEB') {
        // Confirmation: Cycle completed via Vercel manual web command
        const manual = pondData.last_manual_feed;
        if (manual) {
            const reqId = manual.request_id || `legacy_${hardwareTimestamp || Date.now()}`;
            
            // If already deducted when triggered from Web App, do not double-deduct
            if (manual.already_deducted) {
                deductionOutcome = {
                    deducted: true,
                    skipped: true,
                    reason: 'already_deducted_on_web_trigger',
                    change: manual.deducted_change,
                    unit: manual.deducted_unit
                };
            } else {
                deductionOutcome = await deductFeed(db, {
                    eventId: `${pondId}_manual_${reqId}`,
                    pondId,
                    inventoryId: manual.feed_inventory_id,
                    grams: manual.estimated_grams,
                    source: 'ESP32_IoT',
                    trigger: 'manual'
                });
            }

            pondUpdates['last_manual_feed.status'] = 'completed';
            pondUpdates['last_manual_feed.completed_at'] = admin.firestore.FieldValue.serverTimestamp();
            pondUpdates['last_manual_feed.deduction'] = deductionOutcome;
            pondUpdates['last_manual_feed.final_distance_cm'] = distanceCm;
        }
    } else if (triggerSource === 'AUTO') {
        // Confirmation: Cycle completed via Node A RTC schedule
        const { hour, dateKey } = getEatClock();
        const schedules = Array.isArray(pondData.schedules) ? pondData.schedules : [];
        const slot = schedules.find((s) => Number(s.hour) === hour);

        if (slot) {
            deductionOutcome = await deductFeed(db, {
                eventId: `${pondId}_sched_${dateKey}_${String(hour).padStart(2, '0')}`,
                pondId,
                inventoryId: slot.feedInventoryId,
                grams: slot.grams,
                source: 'ESP32_IoT',
                trigger: 'scheduled'
            });
        } else {
            deductionOutcome = { deducted: false, reason: `no_schedule_for_hour_${hour}` };
        }
    } else if (triggerSource === 'BTN') {
        // Confirmation: Cycle completed via physical manual button press on hardware
        const fallbackMs = Number(pondData.feeder_config?.calibrationMs ?? pondData.calibration_ms) || 4000;
        const rateGps = Number(pondData.feeder_config?.dispenseRateGps) || 8;
        const dispensedGrams = Math.round((fallbackMs / 1000) * rateGps);

        // Associate with pond's configured feed item, or first schedule item
        const schedules = Array.isArray(pondData.schedules) ? pondData.schedules : [];
        const feedId = pondData.default_feed_id || schedules[0]?.feedInventoryId || null;
        const feedName = schedules[0]?.feedName || 'Standard Feed';

        deductionOutcome = await deductFeed(db, {
            eventId: `${pondId}_btn_${hardwareTimestamp || Date.now()}`,
            pondId,
            inventoryId: feedId,
            grams: dispensedGrams,
            source: 'ESP32_IoT',
            trigger: 'button'
        });

        pondUpdates.last_button_feed = {
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            grams: dispensedGrams,
            feed_id: feedId,
            feed_name: feedName,
            distance_cm: distanceCm,
            hardware_timestamp: hardwareTimestamp,
            deducted: deductionOutcome?.deducted || false
        };
    }
    }

    await pondRef.set(pondUpdates, { merge: true });

    return {
        scenario: triggerSource === 'NONE' ? 'volume_delta' : 'action_confirmation',
        trigger_source: triggerSource,
        deduction: deductionOutcome
    };
};

module.exports = {
    gramsPerUnit,
    getEatClock,
    deductFeed,
    claimPendingCommand,
    processTelemetryUplink
};
