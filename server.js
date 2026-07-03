const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors');

// ============================================================================
// 1. BULLETPROOF FIREBASE AUTHENTICATION (ENVIRONMENT VARIABLES)
// ============================================================================
let privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (privateKey) {
    // Strip out any rogue wrapping quotes Vercel might have injected into the env
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
    }
    // Convert literal escape \n sequences back into genuine cryptographic linebreaks
    privateKey = privateKey.replace(/\\n/g, '\n');
}

const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
};

// Initialize Firebase Admin cleanly
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ============================================================================
// ROOT ROUTE: Prevents Vercel 404 when clicking the default dashboard link
// ============================================================================
app.get('/', (req, res) => {
    res.status(200).send('✅ AquaGen Server is Live on Vercel!');
});

// ============================================================================
// MODULE 1: TELEGRAM AI OPERATIONS TRIAGE
// ============================================================================
app.post('/telegramWebhook', async (req, res) => {
    try {
        const message = req.body.message;
        if (!message) return res.status(200).send({ success: true });

        const rawText = message.text || message.caption || "";
        const chatId = message.chat.id;
        const technicianName = message.from?.first_name || "Field Tech";

        if (rawText.trim() === '/start') return res.status(200).send({ success: true });

        const apiKey = process.env.GEMINI_API_KEY;
        const botToken = process.env.TELEGRAM_BOT_TOKEN;

        if (!apiKey || !botToken) return res.status(200).send({ success: false, error: 'Config Error' });

        let imageBase64 = "";
        let fileIdToFetch = null;

        if (message.photo && message.photo.length > 0) fileIdToFetch = message.photo[message.photo.length - 1].file_id;
        else if (message.video && (message.video.thumbnail || message.video.thumb)) fileIdToFetch = (message.video.thumbnail || message.video.thumb).file_id;

        if (fileIdToFetch) {
            try {
                const fileInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileIdToFetch}`);
                const fileInfo = await fileInfoRes.json();
                if (fileInfo.ok) {
                    const imageRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`);
                    const arrayBuffer = await imageRes.arrayBuffer();
                    imageBase64 = Buffer.from(arrayBuffer).toString('base64');
                }
            } catch (err) { console.error('Visual capture error:', err); }
        }

        if (!rawText.trim() && !imageBase64) return res.status(200).send({ success: true });

        let combinedText = rawText || "[Visual Uploaded]";
        let existingDocId = null;

        const recentLogs = await db.collection('logs').where('chat_id', '==', chatId).orderBy('timestamp', 'desc').limit(1).get();

        if (!recentLogs.empty) {
            const lastDoc = recentLogs.docs[0];
            const lastLogData = lastDoc.data();
            if (Date.now() - new Date(lastLogData.timestamp).getTime() <= 180000) {
                existingDocId = lastDoc.id;
                combinedText = `${lastLogData.data.notes ? `[Visual context: ${lastLogData.data.notes}] ` : ""}${lastLogData.data.original_text} ; ${rawText}`;
            }
        }

        const geminiParts = [{ text: `You are an intelligent aquaculture operations triage engine for AquaGen Farm. Analyze parameters. Extract metrics into strict raw JSON object. No markdown blocks. Return ONLY raw JSON. {"event_type": "Categorize as 'Feeding', 'Weight Measurement', 'Water Quality', 'Harvesting', 'General Observation', or 'Unknown'", "ponds": [], "metrics": {"feed_amount": null, "average_weight_g": null, "water_parameters": null}, "ai_visual_verification": "Summarize what operations task is occurring based on data.", "confidence_score": 95} Message Context: "${combinedText}"` }];
        if (imageBase64) geminiParts.push({ inline_data: { mime_type: "image/jpeg", data: imageBase64 } });

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: geminiParts }] })
        });

        const rawData = await response.json();
        const aiData = JSON.parse(rawData.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim());

        const logEntry = {
            timestamp: new Date().toISOString(),
            technician_name: technicianName,
            chat_id: chatId,
            animal_type: "Fish",
            event_type: aiData.event_type || "General Observation",
            data: { ponds: aiData.ponds || [], metrics: aiData.metrics || {}, ai_confidence: aiData.confidence_score || 0, notes: aiData.ai_visual_verification || "", original_text: combinedText },
            source: "Telegram"
        };

        if (existingDocId) await db.collection('logs').doc(existingDocId).set(logEntry, { merge: true });
        else await db.collection('logs').add(logEntry);

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: `✓ <b>Log Processed</b>\n<b>Action:</b> ${aiData.event_type}\n<blockquote>"${combinedText}"</blockquote>`, parse_mode: "HTML" })
        });

        res.status(200).send({ success: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(200).send({ success: false });
    }
});

// ============================================================================
// MODULE 2: ESP32 SHORT-POLLING ROUTE (MANUAL DROP TRIGGER)
// ============================================================================
app.get('/feederPing', async (req, res) => {
    try {
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
        console.error('Polling error:', e);
        res.status(500).send({ drop: false });
    }
});

// ============================================================================
// MODULE 3: ESP32 INGESTION & RECEIPT LOGGING
// ============================================================================
app.post('/iotLog', async (req, res) => {
    if (req.headers['x-iot-secret'] !== process.env.IOT_SECRET_KEY) {
        return res.status(401).send({ error: 'Unauthorized hardware payload verification failed.' });
    }

    try {
        const payload = req.body;
        const logEntry = {
            timestamp: new Date().toISOString(),
            technician_name: `Automated Feeder (${payload.device_id})`,
            animal_type: "Fish",
            event_type: "Feeding",
            data: {
                ponds: payload.pond_tag ? [payload.pond_tag] : ["Machakos_Main"],
                metrics: { feed_amount: `${payload.grams_dispensed || 0}g`, average_weight_g: null, water_parameters: null },
                ai_confidence: 100,
                notes: `Hardware success loop. Battery state: ${payload.v_batt || 'N/A'}V`,
                original_text: `[IoT Receipt]: Event=${payload.event_type || 'Manual_Trigger'}, Dispensed=${payload.grams_dispensed}g`
            },
            source: "ESP32_IoT"
        };
        await db.collection('logs').add(logEntry);
        res.status(200).send({ success: true });
    } catch (error) {
        console.error('Telemetry write logging error:', error);
        res.status(500).send({ error: 'Database write execution failure' });
    }
});

// ============================================================================
// RUNTIME ENVIRONMENT DETECTION & EXPORT EXECUTIONS
// ============================================================================
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 AquaGen Server running locally on port ${PORT}`));
}

// REQUIRED HOOK FOR VERCEL SERVERLESS RUNTIME MECHANICS
module.exports = app;