const admin = require('firebase-admin');

const handleMenu = async (req, res) => {
    try {
        const body = req.body || {};
        const message = body.message;
        const callbackQuery = body.callback_query;

        const chatId = String(message ? message.chat.id : (callbackQuery && callbackQuery.message.chat.id));
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const userTier = req.userTier || 'technician';
        const db = admin.firestore();

        // Intercept inline keyboard callback button responses
        if (callbackQuery) {
            const actionKey = callbackQuery.data;

            if (actionKey === 'nav_check_tasks') {
                // Fetch tasks assigned to the user
                const tasksSnapshot = await db.collection('tasks').where('assigned_to', '==', chatId).where('status', '!=', 'completed').get();
                let callbackResponseText = "";
                if (tasksSnapshot.empty) {
                    callbackResponseText = "📋 You have no pending tasks.";
                } else {
                    let taskList = "📋 <b>Your Pending Tasks:</b>\n\n";
                    tasksSnapshot.forEach(doc => {
                        const task = doc.data();
                        taskList += `- ${task.title || 'Task'} (Priority: ${task.priority || 'Normal'})\n`;
                    });
                    callbackResponseText = taskList;
                }
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, text: callbackResponseText, parse_mode: 'HTML' })
                });
            } else if (actionKey === 'nav_add_log') {
                // Send Submenu for Log Types
                const logSubmenu = {
                    inline_keyboard: [
                        [{ text: 'Feeding', callback_data: 'log_feeding' }, { text: 'Cleaning', callback_data: 'log_cleaning' }],
                        [{ text: 'Inventory Check', callback_data: 'log_inventory' }, { text: 'Sampling', callback_data: 'log_sampling' }],
                        [{ text: 'Mortality', callback_data: 'log_mortality' }, { text: 'Harvest', callback_data: 'log_harvest' }],
                        [{ text: 'General', callback_data: 'log_general' }]
                    ]
                };
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: `📝 <b>Select Log Type:</b>`,
                        parse_mode: 'HTML',
                        reply_markup: logSubmenu
                    })
                });
            } else if (actionKey.startsWith('log_')) {
                const logType = actionKey.replace('log_', '');
                await db.collection('telegram_sessions').doc(chatId).set({
                    current_step: `AWAITING_LOG_${logType.toUpperCase()}`,
                    updated_at: new Date().toISOString()
                });
                
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, text: `Please send a photo or describe the ${logType} details.` })
                });
            } else if (actionKey === 'nav_add_financial') {
                if (userTier === 'super-admin') {
                    await db.collection('telegram_sessions').doc(chatId).set({
                        current_step: 'AWAITING_RECEIPT',
                        updated_at: new Date().toISOString()
                    });
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text: "Please upload the receipt." })
                    });
                }
            }

            return res.status(200).send({ success: true });
        }

        // Construct adaptive multi-tier UI navigation elements 
        const masterAdminKeyboard = {
            inline_keyboard: [
                [
                    { text: '📋 Check Tasks', callback_data: 'nav_check_tasks' },
                    { text: '📝 Add Log', callback_data: 'nav_add_log' }
                ],
                [
                    { text: '💸 Add Financial Doc', callback_data: 'nav_add_financial' }
                ]
            ]
        };

        const technicianKeyboard = {
            inline_keyboard: [
                [
                    { text: '📋 Check Tasks', callback_data: 'nav_check_tasks' },
                    { text: '📝 Add Log', callback_data: 'nav_add_log' }
                ]
            ]
        };

        const replyMarkup = userTier === 'super-admin' ? masterAdminKeyboard : technicianKeyboard;

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: `🐟 <b>AquaGen Systems Portal</b>\nSelect an operation below [Clearance Level: ${userTier.toUpperCase()}]:`,
                parse_mode: 'HTML',
                reply_markup: replyMarkup
            })
        });

        return res.status(200).send({ success: true });
    } catch (error) {
        console.error('Menu state control system fault:', error);
        return res.status(200).send({ success: false });
    }
};

module.exports = { handleMenu };