const admin = require('firebase-admin');

const handleFeedConfirmation = async (req, res, session) => {
    try {
        const message = req.body.message;
        const chatId = String(message.chat.id);
        const text = message.text ? message.text.trim().toLowerCase() : "";
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const apiKey = process.env.GEMINI_API_KEY;
        const db = admin.firestore();

        if (text === "no" || text === "cancel") {
            await db.collection('telegram_sessions').doc(chatId).delete();
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: "Log cancelled. Please submit the photo and text again with the correct details." })
            });
            return res.status(200).send({ success: true });
        }

        let aiData = session.log_data;

        if (text === "yes" || text === "y") {
            // Do deduction and log
            const amountMatch = String(aiData.metrics?.feed_amount || "").match(/[\d.]+/);
            const amount = amountMatch ? parseFloat(amountMatch[0]) : 0;
            const pelletSize = String(aiData.metrics?.pellet_size || "").toLowerCase().replace(/\s/g, '');
            
            let deductionMessage = "";

            if (amount > 0) {
                const inventoryRef = db.collection('inventory');
                const invSnapshot = await inventoryRef.get();
                let targetItemDoc = null;
                
                invSnapshot.forEach(doc => {
                    const item = doc.data();
                    const itemName = (item.item_name || "").toLowerCase().replace(/\s/g, '');
                    if (itemName.includes('feed') && itemName.includes(pelletSize)) {
                        targetItemDoc = doc;
                    }
                });

                if (targetItemDoc) {
                    const currentQty = targetItemDoc.data().quantity || 0;
                    const newQty = Math.max(0, currentQty - amount);
                    const newStatus = newQty === 0 ? 'out_of_stock' : newQty < 20 ? 'low' : 'in_stock';
                    
                    await inventoryRef.doc(targetItemDoc.id).update({
                        quantity: newQty,
                        status: newStatus,
                        last_updated: new Date().toISOString()
                    });
                    
                    deductionMessage = `\n\n(Deducted ${amount} units of ${targetItemDoc.data().item_name} from inventory)`;
                    aiData.ai_visual_verification = (aiData.ai_visual_verification || "") + deductionMessage;
                } else {
                    deductionMessage = `\n\n(Warning: No inventory item found matching feed size ${pelletSize})`;
                    aiData.ai_visual_verification = (aiData.ai_visual_verification || "") + deductionMessage;
                }
            }

            const logEntry = {
                timestamp: new Date(session.message_time_ms).toISOString(),
                message_time_ms: session.message_time_ms,
                technician_name: session.technician_name,
                chat_id: chatId,
                animal_type: "Fish",
                event_type: aiData.event_type || "General Observation",
                data: { ponds: aiData.ponds || [], metrics: aiData.metrics || {}, ai_confidence: aiData.confidence_score || 0, notes: aiData.ai_visual_verification || "", original_text: session.original_text },
                source: "Telegram",
                audit_metadata: session.audit_metadata || {}
            };

            await db.collection('logs').add(logEntry);
            await db.collection('telegram_sessions').doc(chatId).delete();

            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: `✓ <b>Log Processed</b>\n<b>Action:</b> ${aiData.event_type}\n<blockquote>"${session.original_text}"</blockquote>${deductionMessage}`, parse_mode: "HTML" })
            });

            return res.status(200).send({ success: true });
        } else {
            // Handle edit using AI
            const systemPrompt = `You are an aquaculture AI. The user is correcting a feeding log.
Current data: ${JSON.stringify(aiData)}
User correction: "${message.text}"
Update the JSON to reflect the correction. Return ONLY raw JSON matching the structure exactly.`;
            
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    contents: [{ parts: [{ text: systemPrompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });
            
            const rawData = await response.json();
            let updatedData = aiData;
            try {
                const rawGeminiText = rawData.candidates[0].content.parts[0].text;
                updatedData = JSON.parse(rawGeminiText.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim());
            } catch (parseErr) {
                console.error("Gemini correction parsing failed", parseErr);
            }

            await db.collection('telegram_sessions').doc(chatId).update({
                log_data: updatedData,
                updated_at: new Date().toISOString()
            });

            const amount = updatedData.metrics?.feed_amount || "Unknown amount";
            const pelletSize = updatedData.metrics?.pellet_size || "Unknown size";
            const ponds = (updatedData.ponds && updatedData.ponds.length > 0) ? updatedData.ponds.join(", ") : "Unknown pond";

            const msgText = `Updated: Fed ${amount} of ${pelletSize} feed to ${ponds}.\n\nIs this correct? Reply YES to confirm, or reply with more corrections.`;

            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: msgText })
            });

            return res.status(200).send({ success: true });
        }
    } catch (error) {
        console.error('handleFeedConfirmation fault:', error);
        return res.status(200).send({ success: false });
    }
};

module.exports = { handleFeedConfirmation };
