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

        if (!from) {
            req.userTier = 'technician'; // Default fallback safe operational clearance
            return next();
        }

        const telegramId = String(from.id);
        const db = admin.firestore();

        // Optimized Spark plan document single-read path
        const userDoc = await db.collection('authorized_users').doc(telegramId).get();

        if (userDoc.exists) {
            const userData = userDoc.data() || {};
            req.userTier = userData.tier || 'technician';
            req.userData = userData;
        } else {
            // Default configuration for initial field deployment teams
            req.userTier = 'technician';
        }

        return next();
    } catch (error) {
        console.error('RBAC Access Validation Middleware Exception:', error);
        req.userTier = 'technician'; // Safe edge isolation
        return next();
    }
};

module.exports = rbacMiddleware;