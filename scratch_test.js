require('dotenv').config({ path: '.env.local' });
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("No API key");
    process.exit(1);
}
const prompt = `You are an intelligent aquaculture operations triage engine for AquaGen Farm. Analyze parameters. Extract metrics into strict raw JSON object. No markdown blocks. Return ONLY raw JSON. {"event_type": "Categorize as 'Feeding', 'Cleaning', 'Inventory Check', 'General', 'Sampling', 'Mortality', 'Harvest', or 'Unknown'. (Hint: Shorthand like 'A1 2kg 4mm' or images of feed/scales with weights/sizes must be categorized as 'Feeding')", "ponds": [], "metrics": {"feed_amount": null, "pellet_size": null, "average_weight_g": null, "water_parameters": null, "mortality_count": null}, "ai_visual_verification": "Summarize what operations task is occurring based on data.", "confidence_score": 95}
Message Context: "Feeding A1 4mm 0.5kg"`;

async function test() {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
        })
    });
    const data = await res.json();
    console.log(data.candidates[0].content.parts[0].text);
}
test();
