const admin = require('firebase-admin');

const handleMenu = async (req, res) => {
    try {
        const body = req.body || {};
        const message = body.message;
        const callbackQuery = body.callback_query;

        const chatId = message ? message.chat.id : (callbackQuery && callbackQuery.message.chat.id);
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const userTier = req.userTier || 'technician';

        // Intercept inline keyboard callback button responses
        if (callbackQuery) {
            const actionKey = callbackQuery.data;
            let callbackResponseText = `⚡ Action [${actionKey}] initialized. Scaffolding layer active for clearance: ${userTier.toUpperCase()}`;

            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: callbackResponseText })
            });

            return res.status(200).send({ success: true });
        }

        // Construct adaptive multi-tier UI navigation elements 
        const masterAdminKeyboard = {
            inline_keyboard: [
                [
                    { text: '💸 Log Pending Sale', callback_data: 'nav_log_sale' },
                    { text: '🧾 Scan Receipt', callback_data: 'nav_scan_receipt' }
                ],
                [
                    { text: '💀 Report Mortalities', callback_data: 'nav_report_mortality' },
                    { text: '📊 Daily Summary', callback_data: 'nav_daily_summary' }
                ]
            ]
        };

        // RBAC Scaffolding Layer: Strip advanced metrics out of the technician interface
        if (userTier === 'technician') {
            masterAdminKeyboard.inline_keyboard = [
                [{ text: '💀 Report Mortalities', callback_data: 'nav_report_mortality' }],
                [{ text: '📊 Daily Summary', callback_data: 'nav_daily_summary' }]
            ];
        }

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: `🐟 <b>AquaGen Systems Portal</b>\nSelect an operation below [Clearance Level: ${userTier.toUpperCase()}]:`,
                parse_mode: 'HTML',
                reply_markup: masterAdminKeyboard
            })
        });

        return res.status(200).send({ success: true });
    } catch (error) {
        console.error('Menu state control system fault:', error);
        return res.status(200).send({ success: false });
    }
};

module.exports = { handleMenu };