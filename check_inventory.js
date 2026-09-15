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

async function check() {
    const db = admin.firestore();
    const inv = await db.collection('inventory').get();
    inv.forEach(doc => {
        console.log(doc.id, doc.data());
    });
}
check();
