const admin = require('firebase-admin');

/**
 * 3-Tier Role-Based Access Control Middleware
 * Assigns req.userTier to 'super-admin', 'pre-approved', or 'technician'
 */
const rbacMiddleware = async (req, res, next) => {
    try {
        const body = req.body || {};
        const message = body.message || (body.callback_query && body.callback_query.message);
        const from = body.message ? body.message.from : (body.callback_query && body.callback_query.from);
        
        const chatId = message ? message.chat.id : (from ? from.id : null);

        if (!chatId) {
            req.userTier = 'technician'; // Default fallback safe operational clearance
            return next();
        }

        const telegramId = String(chatId);
        const db = admin.firestore();

        const userDoc = await db.collection('verified_staff').doc(telegramId).get();

        if (userDoc.exists) {
            const userData = userDoc.data() || {};
            req.userTier = userData.tier || 'technician';
            req.userData = { ...userData, id: telegramId };
            return next();
        } else {
            // Unverified User
            await db.collection('admin_logs').add({
                timestamp: new Date().toISOString(),
                telegram_id: telegramId,
                payload: body,
                type: 'unauthorized_access_attempt'
            });

            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (botToken) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: telegramId,
                        text: "Welcome to AquaGen. Your account is pending verification."
                    })
                });
            }

            return res.status(200).send({ success: true });
        }
    } catch (error) {
        console.error('RBAC Access Validation Middleware Exception:', error);
        req.userTier = 'technician'; // Safe edge isolation
        return next();
    }
};

module.exports = rbacMiddleware;