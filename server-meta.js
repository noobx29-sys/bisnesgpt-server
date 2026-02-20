// Meta Direct Process
console.log('Starting Meta process...');
process.env.PROCESS_NAME = 'meta';

// Require the main server code first
require('./server.js');

// Add the queue worker for Meta Direct messages
try {
    const { createMetaWorker } = require('./src/services/messaging/queue');
    const metaDirect = require('./src/services/whatsapp/metaDirect');

    if (typeof createMetaWorker === 'function') {
        const worker = createMetaWorker(async (job) => {
            const { companyId, phoneIndex, messageData } = job.data;
            console.log(`[META WORKER] Processing job for ${companyId}`);

            // Dispatch via Meta Direct
            // The implementation will branch here based on internal schema 
            await metaDirect.sendMessage(companyId, phoneIndex, messageData.to, messageData);
        });
        console.log('[META WORKER] Successfully initialized message worker queue');
    }
} catch (error) {
    console.log('[META WORKER] Optional queuing services not started yet or errored:', error.message);
}
