
const admin = require('firebase-admin');

// Strip out quotes/newlines from Vercel env just like server.js
let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) {
    privateKey = privateKey.replace(/^"|"$/g, '').replace(/\\n/g, '\n');
}

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID ? process.env.FIREBASE_PROJECT_ID.trim() : undefined,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL ? process.env.FIREBASE_CLIENT_EMAIL.trim() : undefined,
        privateKey: privateKey,
    })
});

const db = admin.firestore();

async function check() {
    console.log("Checking DB...");
    const snapshot = await db.collection('logs').get();
    console.log("Total logs in DB:", snapshot.size);
    process.exit(0);
}

check().catch(e => {
    console.error(e);
    process.exit(1);
});
