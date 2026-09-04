const admin = require('firebase-admin');
const { handleMenu } = require('./menu');
const { handleReceipt, handleCategory, handleAmount } = require('./accounting');

const handleTriage = async (req, res) => {
    try {
        const message = req.body.message;
        if (!message) return res.status(200).send({ success: true });

        const chatId = String(message.chat.id);
        const rawText = message.text || message.caption || "";

        const db = admin.firestore();
        const sessionDoc = await db.collection('telegram_sessions').doc(chatId).get();

        if (rawText.trim() === '/start' || rawText.trim() === '/menu') {
            return await handleMenu(req, res);
        }

        const session = sessionDoc.exists ? sessionDoc.data() : null;

        if (session) {
            switch (session.current_step) {
                case 'AWAITING_RECEIPT':
                    return await handleReceipt(req, res, session);
                case 'AWAITING_CATEGORY':
                    return await handleCategory(req, res, session);
                case 'AWAITING_AMOUNT':
                    return await handleAmount(req, res, session);
                default:
                    if (!session.current_step.startsWith('AWAITING_LOG_')) {
                        return await handleMenu(req, res);
                    }
            }
        }

        // ==========================================
        // AI TRIAGE ENGINE (Restored)
        // ==========================================
        const technicianName = message.from?.first_name || "Field Tech";
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
            } catch (err) { console.error('Visual capture error extraction bypass:', err); }
        }

        if (!rawText.trim() && !imageBase64) return res.status(200).send({ success: true });

        let combinedText = rawText || "[Visual Uploaded]";
        let existingDocId = null;

        // Context injection if user selected a log type from the menu
        let specificLogContext = "";
        if (session && session.current_step.startsWith('AWAITING_LOG_')) {
            const logType = session.current_step.replace('AWAITING_LOG_', '');
            specificLogContext = `\nThe user explicitly categorized this action as: ${logType}. Ensure this is reflected.`;
            // Clean up the session since we are processing it now
            await db.collection('telegram_sessions').doc(chatId).delete();
        }

        const messageTimeMs = message.date ? message.date * 1000 : Date.now();
        // 30-Minute Temporal Buffer Processing Loop using session tracking (avoids composite index requirements)
        if (session && session.last_log_id && session.last_log_time_ms) {
            if (Math.abs(messageTimeMs - session.last_log_time_ms) <= 1800000) { // 30 minutes
                const lastDoc = await db.collection('logs').doc(session.last_log_id).get();
                if (lastDoc.exists) {
                    const lastLogData = lastDoc.data();
                    existingDocId = lastDoc.id;
                    
                    const prevNotes = lastLogData.data?.notes || "";
                    const prevText = lastLogData.data?.original_text || lastLogData.text || "";
                    combinedText = `${prevNotes ? `[Visual context: ${prevNotes}] ` : ""}${prevText} ; ${rawText}`;
                }
            }
        }

        const systemPrompt = `You are an intelligent aquaculture operations triage engine for AquaGen Farm. Analyze parameters. Extract metrics into strict raw JSON object. No markdown blocks. Return ONLY raw JSON. {"event_type": "Categorize as 'Feeding', 'Cleaning', 'Inventory Check', 'General', 'Sampling', 'Mortality', 'Harvest', or 'Unknown'", "ponds": [], "metrics": {"feed_amount": null, "average_weight_g": null, "water_parameters": null, "mortality_count": null}, "ai_visual_verification": "Summarize what operations task is occurring based on data.", "confidence_score": 95}${specificLogContext}\nMessage Context: "${combinedText}"`;

        const geminiParts = [{ text: systemPrompt }];
        if (imageBase64) geminiParts.push({ inline_data: { mime_type: "image/jpeg", data: imageBase64 } });

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: geminiParts }] })
        });

        const rawData = await response.json();

        // Defensive Edge Case Calibration: Insulate against malformed LLM outputs
        let aiData = { event_type: "General Observation", ponds: [], metrics: {}, confidence_score: 0, ai_visual_verification: "" };
        try {
            const textResponse = rawData.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
            aiData = JSON.parse(textResponse);
        } catch (parseErr) {
            console.error("Gemini raw parser crash protection intercepted. Deploying fallback structural schemas:", parseErr);
        }

        const logEntry = {
            timestamp: new Date(messageTimeMs).toISOString(),
            message_time_ms: messageTimeMs,
            technician_name: technicianName,
            chat_id: chatId,
            animal_type: "Fish",
            event_type: aiData.event_type || "General Observation",
            data: { ponds: aiData.ponds || [], metrics: aiData.metrics || {}, ai_confidence: aiData.confidence_score || 0, notes: aiData.ai_visual_verification || "", original_text: combinedText },
            source: "Telegram",
            audit_metadata: req.auditMetadata || {}
        };

        if (existingDocId) {
            await db.collection('logs').doc(existingDocId).set(logEntry, { merge: true });
        } else {
            const newDocRef = await db.collection('logs').add(logEntry);
            existingDocId = newDocRef.id;
        }

        // Store last log reference in session to avoid complex Firestore composite indices
        await db.collection('telegram_sessions').doc(chatId).set({
            last_log_id: existingDocId,
            last_log_time_ms: messageTimeMs
        }, { merge: true });

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: `✓ <b>Log Processed</b>\n<b>Action:</b> ${aiData.event_type || 'General Observation'}\n<blockquote>"${combinedText}"</blockquote>`, parse_mode: "HTML" })
        });

        res.status(200).send({ success: true });
    } catch (error) {
        console.error('Webhook triage pipeline error:', error);
        res.status(200).send({ success: false });
    }
};

module.exports = { handleTriage };