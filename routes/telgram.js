const express = require('express');
const router = express.Router();
const rbacMiddleware = require('../middlewares/rbac');
const auditStamper = require('../middlewares/auditStamper');
const { handleTriage } = require('../controllers/triage');
const { handleMenu } = require('../controllers/menu');

// Inject Global Core Security and Tracking Middleware Chains
router.use(rbacMiddleware);
router.use(auditStamper);

router.post('/telegramWebhook', async (req, res) => {
    try {
        const body = req.body || {};

        // 1. Intercept interactive button actions (Inline Keyboard Callbacks)
        if (body.callback_query) {
            return await handleMenu(req, res);
        }

        const message = body.message;
        if (!message) return res.status(200).send({ success: true });

        const text = message.text || message.caption || "";

        // 2. Map structural explicit command route requests
        if (text.trim() === '/menu' || text.trim() === '/admin' || text.trim() === '/start') {
            return await handleMenu(req, res);
        }

        // 3. Fallthrough Pathway: Execute general text/visual telemetry analysis
        return await handleTriage(req, res);

    } catch (error) {
        console.error('Master Telegram Webhook Dispatcher Failure:', error);
        return res.status(200).send({ success: true }); // Prevent Telegram from looping retries
    }
});

module.exports = router;