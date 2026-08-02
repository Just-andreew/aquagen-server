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

        // 1. Query the primary 'users' collection instead of verified_staff
        const usersSnapshot = await db.collection('users').where('telegram_chat_id', '==', telegramId).get();

        if (!usersSnapshot.empty) {
            const userDoc = usersSnapshot.docs[0];
            const userData = userDoc.data();
            
            // 2. Check if admin explicitly granted bot access
            if (userData.bot_access === true) {
                // Map web 'admin' role to bot 'super-admin'
                req.userTier = userData.role === 'admin' ? 'super-admin' : (userData.role || 'technician');
                req.userData = { ...userData, id: userDoc.id };
                return next();
            }
        } else {
            // 3. Auto-Discovery: First time we've seen this Telegram ID. Create a pending profile.
            if (from) {
                const tgName = [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || 'Unknown Telegram User';
                
                await db.collection('users').add({
                    name: tgName,
                    email: '',
                    role: 'farm_technician',
                    bot_access: false,
                    telegram_chat_id: telegramId,
                    telegram_name: tgName,
                    created_via: 'telegram_auto_discovery',
                    created_at: new Date().toISOString()
                });
            }
        }

        // 4. Unverified / Pending Approval Flow
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
                    text: "Welcome to AquaGen. Your access request has been sent to the administrators for approval."
                })
            });
        }

        return res.status(200).send({ success: true });
        
    } catch (error) {
        console.error('RBAC Access Validation Middleware Exception:', error);
        req.userTier = 'technician'; // Safe edge isolation
        return next();
    }
};

module.exports = rbacMiddleware;