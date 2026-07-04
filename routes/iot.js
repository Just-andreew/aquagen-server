const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

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

module.exports = router;