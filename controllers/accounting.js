const admin = require('firebase-admin');

const handleReceipt = async (req, res, session) => {
    try {
        const message = req.body.message;
        const chatId = String(message.chat.id);
        const botToken = process.env.TELEGRAM_BOT_TOKEN;

        // Validate message contains a photo
        if (!message.photo || message.photo.length === 0) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: "No photo detected. Please upload the receipt." })
            });
            return res.status(200).send({ success: true });
        }

        const fileId = message.photo[message.photo.length - 1].file_id;
        const db = admin.firestore();

        await db.collection('telegram_sessions').doc(chatId).update({
            current_step: 'AWAITING_CATEGORY',
            file_id: fileId,
            updated_at: new Date().toISOString()
        });

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: "Receipt received. Reply with category:\n1. Feed\n2. Hardware\n3. Logistics" })
        });

        return res.status(200).send({ success: true });
    } catch (error) {
        console.error('handleReceipt fault:', error);
        return res.status(200).send({ success: false });
    }
};

const handleCategory = async (req, res, session) => {
    try {
        const message = req.body.message;
        const chatId = String(message.chat.id);
        const text = message.text ? message.text.trim() : "";
        const botToken = process.env.TELEGRAM_BOT_TOKEN;

        const categoryMap = {
            '1': 'Feed',
            '2': 'Hardware',
            '3': 'Logistics'
        };

        const mappedCategory = categoryMap[text];

        if (!mappedCategory) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: "Invalid option. Reply with:\n1. Feed\n2. Hardware\n3. Logistics" })
            });
            return res.status(200).send({ success: true });
        }

        const db = admin.firestore();
        await db.collection('telegram_sessions').doc(chatId).update({
            current_step: 'AWAITING_AMOUNT',
            category: mappedCategory,
            updated_at: new Date().toISOString()
        });

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: "Enter the total amount (e.g., 5000)." })
        });

        return res.status(200).send({ success: true });
    } catch (error) {
        console.error('handleCategory fault:', error);
        return res.status(200).send({ success: false });
    }
};

const handleAmount = async (req, res, session) => {
    try {
        const message = req.body.message;
        const chatId = String(message.chat.id);
        const text = message.text ? message.text.trim() : "";
        const botToken = process.env.TELEGRAM_BOT_TOKEN;

        const amount = Number(text);
        if (isNaN(amount) || text === "") {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: "Invalid amount. Please enter a valid number (e.g., 5000)." })
            });
            return res.status(200).send({ success: true });
        }

        const db = admin.firestore();
        const staffId = req.userData && req.userData.id ? req.userData.id : chatId;

        await db.collection('expenses').add({
            category: session.category,
            amount: amount,
            file_id: session.file_id,
            staff_id: staffId,
            status: 'Draft',
            created_at: new Date().toISOString()
        });

        await db.collection('telegram_sessions').doc(chatId).delete();

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: "Expense saved as Draft. Finalize it on the web dashboard." })
        });

        return res.status(200).send({ success: true });
    } catch (error) {
        console.error('handleAmount fault:', error);
        return res.status(200).send({ success: false });
    }
};

module.exports = { handleReceipt, handleCategory, handleAmount };