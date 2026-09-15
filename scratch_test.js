const apiKey = "AIzaSyCogpYc92gALPxzku26osVm9DAumZWVWdE";
const prompt = `You are an intelligent aquaculture operations triage engine for AquaGen Farm. Analyze the text parameters and visual evidence.

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
    "feed_amount": "Amount of feed with units, e.g., '2kg' or '0.5kg'",
    "pellet_size": "Pellet size, e.g., '4mm'",
    "average_weight_g": "Fish weight in grams",
    "water_parameters": "Key-value pairs",
    "mortality_count": "Number of dead fish"
  },
  "ai_visual_verification": "Summary of operations task or reason for rejection",
  "confidence_score": 95
}
Message Context: "9:00am"`;

async function test() {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
        })
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
}
test();
