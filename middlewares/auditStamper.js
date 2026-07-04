/**
 * Identity & Action Micro-Audit Trail Middleware
 * Attaches immutable actor tracking metadata onto incoming database write intents
 */
const auditStamper = (req, res, next) => {
    try {
        const body = req.body || {};
        const message = body.message || (body.callback_query && body.callback_query.message);
        const from = body.message ? body.message.from : (body.callback_query && body.callback_query.from);

        if (from) {
            req.auditMetadata = {
                initiated_by_name: `${from.first_name || ''} ${from.last_name || ''}`.trim() || 'Field Tech',
                telegram_id: from.id,
                telegram_username: from.username || 'N/A',
                action_timestamp: new Date().toISOString(),
                source_channel: 'Telegram_Bot'
            };
        } else {
            req.auditMetadata = {
                initiated_by_name: 'System_Automated_Hardware',
                telegram_id: null,
                telegram_username: 'N/A',
                action_timestamp: new Date().toISOString(),
                source_channel: 'ESP32_IoT_Gateway'
            };
        }
        return next();
    } catch (error) {
        console.error('Audit Activity Ingestion Mutation Fault:', error);
        req.auditMetadata = {
            initiated_by_name: 'Emergency_Fault_Fallback',
            action_timestamp: new Date().toISOString(),
            source_channel: 'System_Error_Capture'
        };
        return next();
    }
};

module.exports = auditStamper;