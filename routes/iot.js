const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const feeder = require('../controllers/feeder');

// MODULE 2: ESP32 SHORT-POLLING ROUTE (MANUAL DROP TRIGGER)
router.get('/feederPing', async (req, res) => {
    try {
        const db = admin.firestore();
        const deviceId = req.query.device_id;
        if (!deviceId) return res.status(400).send({ error: 'Missing device_id query param' });

        const deviceRef = db.collection('devices').doc(deviceId);
        const doc = await deviceRef.get();

        if (doc.exists && doc.data().feed_pending === true) {
            const target = doc.data().target_grams || 100;

            // Atomic safety kill-switch execution
            await deviceRef.update({ feed_pending: false, last_ping: new Date().toISOString() });
            return res.status(200).send({ drop: true, grams: target });
        }

        if (doc.exists) await deviceRef.update({ last_ping: new Date().toISOString() });
        res.status(200).send({ drop: false });
    } catch (e) {
        console.error('ESP32 Telemetry polling routine failure:', e);
        res.status(500).send({ drop: false });
    }
});

// MODULE 3: ESP32 INGESTION & RECEIPT LOGGING
router.post('/iotLog', async (req, res) => {
    if (req.headers['x-iot-secret'] !== process.env.IOT_SECRET_KEY) {
        return res.status(401).send({ error: 'Unauthorized hardware payload verification failed.' });
    }

    try {
        const db = admin.firestore();
        const payload = req.body || {};
        const logEntry = {
            timestamp: new Date().toISOString(),
            technician_name: `Automated Feeder (${payload.device_id || 'Unknown'})`,
            animal_type: "Fish",
            event_type: "Feeding",
            data: {
                ponds: payload.pond_tag ? [payload.pond_tag] : ["Machakos_Main"],
                metrics: { feed_amount: `${payload.grams_dispensed || 0}g`, average_weight_g: null, water_parameters: null },
                ai_confidence: 100,
                notes: `Hardware success loop. Battery state: ${payload.v_batt || 'N/A'}V`,
                original_text: `[IoT Receipt]: Event=${payload.event_type || 'Manual_Trigger'}, Dispensed=${payload.grams_dispensed || 0}g`
            },
            source: "ESP32_IoT"
        };
        await db.collection('logs').add(logEntry);
        res.status(200).send({ success: true });
    } catch (error) {
        console.error('Telemetry write logging database constraint failure:', error);
        res.status(500).send({ error: 'Database write execution failure' });
    }
});

// ============================================================================
// AUTOMATED FISH FEEDER (NODE B INTEGRATION)
// Adheres strictly to Aquagen Feeder API Protocol (ESP32 & Vercel Final Architecture)
// ============================================================================

// 1. POST Endpoint: Telemetry Ingest (Instant Start, Action Confirmation, Volume Delta)
// Headers: x-iot-secret
// Payload: { pond_id, distance_cm, feed_triggered, trigger_source, hardware_timestamp, rssi }
router.post('/api/v1/feeders/telemetry', async (req, res) => {
    // Global Header Authentication
    if (req.headers['x-iot-secret'] !== process.env.IOT_SECRET_KEY) {
        return res.status(401).send({ error: 'Unauthorized hardware payload verification failed.' });
    }

    try {
        const db = admin.firestore();
        const payload = req.body || {};

        if (!payload.pond_id) {
            return res.status(400).send({ error: 'Missing pond_id in payload' });
        }

        const result = await feeder.processTelemetryUplink(db, payload);
        res.status(200).send({ success: true, ...result });
    } catch (error) {
        console.error('Telemetry ingest failure:', error);
        res.status(500).send({ error: 'Database write execution failure' });
    }
});

// 2. GET Endpoint: Command & Configuration Polling
// Headers: x-iot-secret
// Query: ?pond=POND_01
// Response: flat JSON { pending_command, schedule_str, calibration_ms }
router.get('/api/v1/feeders/status', async (req, res) => {
    // Global Header Authentication
    if (req.headers['x-iot-secret'] !== process.env.IOT_SECRET_KEY) {
        return res.status(401).send({ error: 'Unauthorized hardware payload verification failed.' });
    }

    try {
        const db = admin.firestore();
        const pondId = req.query.pond ? String(req.query.pond).toUpperCase() : null;

        if (!pondId) {
            return res.status(400).send({ error: 'Missing pond query param' });
        }

        // Atomically claim (and clear) any pending command so it is dispatched exactly once
        const { pond, command } = await feeder.claimPendingCommand(db, pondId);

        // Record live polling heartbeat so the web app knows the feeder is actively connected
        // Throttled to once every 10 seconds to optimize Firestore writes
        const lastPingMs = pond?.last_ping_ms || 0;
        const now = Date.now();
        if (now - lastPingMs >= 10000) {
            db.collection('ponds').doc(pondId).set({
                last_ping: admin.firestore.FieldValue.serverTimestamp(),
                last_ping_ms: now,
                online: true
            }, { merge: true }).catch(err => console.error('Feeder heartbeat write error:', err));
        }

        const calibrationMs = pond?.feeder_config?.calibrationMs ?? pond?.calibration_ms ?? 4000;

        // Flat JSON object as specified in Section 3 & 4 of protocol
        res.status(200).send({
            pending_command: command || null,
            schedule_str: pond?.schedule_str || null,
            calibration_ms: Number(calibrationMs) || 4000
        });

    } catch (error) {
        console.error('Command polling failure:', error);
        res.status(500).send({ error: 'Command polling execution failure' });
    }
});

module.exports = router;