const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors');

// Import Feature-Driven Route Hub Modules
const telegramRouter = require('./routes/telegram');
const iotRouter = require('./routes/iot');

// ============================================================================
// 1. BULLETPROOF FIREBASE AUTHENTICATION (ENVIRONMENT VARIABLES)
// ============================================================================
let privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (privateKey) {
    // Strip out any rogue wrapping quotes Vercel might have injected into the env
    privateKey = privateKey.replace(/^"|"$/g, '');
    // Convert literal escape \n sequences back into genuine cryptographic linebreaks
    privateKey = privateKey.replace(/\\n/g, '\n');
}

const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID ? process.env.FIREBASE_PROJECT_ID.trim() : undefined,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL ? process.env.FIREBASE_CLIENT_EMAIL.trim() : undefined,
    privateKey: privateKey,
};

// Guard initialization wrapper for serverless execution environments
if (admin.apps.length === 0) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Bind Pipeline Routers onto the Express Root
app.use('/', telegramRouter);
app.use('/', iotRouter);

// ============================================================================
// ROOT HEALTH CHECK: Prevents Vercel 404 when clicking the dashboard link
// ============================================================================
app.get('/', (req, res) => {
    res.status(200).send('✅ AquaGen Server is Live on Vercel!');
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