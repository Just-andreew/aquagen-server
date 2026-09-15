
const admin = require('firebase-admin');

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) {
    privateKey = privateKey.replace(/^"|"$/g, '').replace(/\\n/g, '\n');
}
admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
    })
});

const apiKey = process.env.GEMINI_API_KEY;

async function reprocess() {
    const db = admin.firestore();
    const logsRef = db.collection('logs');
    
    // We get all logs and filter in memory since we don't have composite indexes guaranteed
    const snapshot = await logsRef.where('source', '==', 'Telegram').get();
    
    let reprocessedCount = 0;
    
    for (const doc of snapshot.docs) {
        const log = doc.data();
        const dataField = log.data || {};
        
        // Check if it's a September 2026 log and failed AI parsing (confidence 0)
        if (log.timestamp && log.timestamp.startsWith('2026-09') && dataField.ai_confidence === 0) {
            console.log(`Reprocessing log ${doc.id} - original_text: "${dataField.original_text}"`);
            
            const systemPrompt = `You are an intelligent aquaculture operations triage engine for AquaGen Farm. Analyze the text parameters and visual evidence.

CRITICAL INSTRUCTIONS:
1. REJECTION: If the image or text is completely unrelated to fish farming or aquaculture (e.g., a random phone screenshot, a selfie, a meme, unrelated objects), you MUST set "event_type" to "Irrelevant".
2. INFERRING ACTION: Use context to determine the action. If you see shorthand like "A1 2kg 4mm" AND/OR an image of feed on a scale, intelligently deduce if it's a "Feeding" event. Do not blindly assume any bucket is feeding unless the context supports it (e.g., text mentioning amounts, tanks, or feed sizes).
3. If it's a valid farm image but no specific action is clear, use "General Observation".

Return your analysis as a strict raw JSON object. Do not use markdown blocks.

JSON Schema:
{
  "event_type": "Must be one of: 'Feeding', 'Cleaning', 'Inventory Check', 'General Observation', 'Sampling', 'Mortality', 'Harvest', 'Unknown', or 'Irrelevant'",
  "ponds": ["Array of pond tags, e.g., 'A1'"],
  "metrics": {
    "feed_amount": "Amount of feed IN KILOGRAMS ONLY (e.g. '2' or '0.5'). Convert grams to kg if necessary.",
    "pellet_size": "Pellet size, e.g., '4mm'",
    "average_weight_g": "Fish weight in grams",
    "water_parameters": "Key-value pairs",
    "mortality_count": "Number of dead fish",
    "time_recorded": "Manually logged time if provided (e.g. '9:00am')"
  },
  "ai_visual_verification": "Summary of operations task or reason for rejection",
  "confidence_score": 95
}
Message Context: "${dataField.original_text}"`;

            let success = false;
            let retries = 0;
            
            while (!success && retries < 3) {
                try {
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            contents: [{ parts: [{ text: systemPrompt }] }],
                            generationConfig: { responseMimeType: "application/json" }
                        })
                    });

                    const rawData = await response.json();
                    
                    if (rawData.error) {
                        console.error(`API Error for ${doc.id}: ${rawData.error.message}`);
                        if (rawData.error.message.includes('Quota exceeded')) {
                            console.log(`Quota exceeded. Waiting 60 seconds before retrying... (Attempt ${retries + 1}/3)`);
                            await new Promise(resolve => setTimeout(resolve, 60000));
                            retries++;
                            continue;
                        } else {
                            break;
                        }
                    }

                    let geminiRawText = "";
                    if (rawData && rawData.candidates && rawData.candidates[0] && rawData.candidates[0].content && rawData.candidates[0].content.parts && rawData.candidates[0].content.parts[0]) {
                        geminiRawText = rawData.candidates[0].content.parts[0].text || "";
                    }

                    let aiData = { event_type: "General Observation", ponds: [], metrics: {}, confidence_score: 0, ai_visual_verification: "" };
                    try {
                        const cleanText = geminiRawText.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
                        aiData = JSON.parse(cleanText || "{}");
                    } catch (e) {
                        console.error('JSON parse failed for', doc.id);
                        break;
                    }
                    
                    if (aiData.event_type && aiData.event_type !== "Irrelevant" && aiData.confidence_score > 0) {
                        await logsRef.doc(doc.id).update({
                            event_type: aiData.event_type || "General Observation",
                            "data.ponds": aiData.ponds || [],
                            "data.metrics": aiData.metrics || {},
                            "data.ai_confidence": aiData.confidence_score || 0,
                            "data.notes": aiData.ai_visual_verification || ""
                        });
                        console.log(`Successfully updated ${doc.id}`);
                        reprocessedCount++;
                    } else {
                        console.log(`Skipped ${doc.id} - event_type: ${aiData.event_type}, confidence: ${aiData.confidence_score}`);
                    }
                    
                    success = true; // Mark as success to exit retry loop
                    await new Promise(resolve => setTimeout(resolve, 4500)); // Normal sleep

                } catch (err) {
                    console.error(`Failed to process ${doc.id}:`, err);
                    await new Promise(resolve => setTimeout(resolve, 4500));
                    break;
                }
            }
        }
    }
    
    console.log(`Reprocessing complete. Updated ${reprocessedCount} logs.`);
}

reprocess();
