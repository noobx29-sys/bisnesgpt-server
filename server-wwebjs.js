// WWebJS Process
console.log('Starting WWebJS process...');
process.env.PROCESS_NAME = 'wwebjs';

// Require the main server code first
const serverModules = require('./server.js');

// Add the queue worker for WWebJS messages
try {
    const { createWwebjsWorker } = require('./src/services/messaging/queue');

    if (typeof createWwebjsWorker === 'function') {
        const worker = createWwebjsWorker(async (job) => {
            const { companyId, phoneIndex, messageData } = job.data;
            console.log(`[WWEBJS WORKER] Processing job for ${companyId} at phone ${phoneIndex}`);

            const botMap = global.botMap || serverModules.botMap;
            if (!botMap) {
                throw new Error("botMap not found");
            }

            // Execute the message
            const botData = botMap.get(companyId);
            if (!botData || !botData[phoneIndex] || !botData[phoneIndex].client) {
                throw new Error(`Bot ${companyId} phone ${phoneIndex} not ready`);
            }

            const client = botData[phoneIndex].client;

            // Basic text message for now, in a full implementation we'd check messageData.type
            // This bridges the queue worker to the actual client safely outside HTTP context
            if (messageData.message) {
                await client.sendMessage(messageData.to, messageData.message);
            }
        });

        console.log('[WWEBJS WORKER] Successfully initialized message worker queue');
    }
} catch (error) {
    console.log('[WWEBJS WORKER] Optional queuing services not started yet or errored:', error.message);
}
