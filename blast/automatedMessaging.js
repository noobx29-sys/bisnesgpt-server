const admin = require('firebase-admin');
const cron = require('node-cron');

class AutomatedMessaging {
    constructor(db, botMap) {
        this.db = db;
        this.botMap = botMap;
        this.initialize();
    }

    initialize() {
        // Run every 5 minutes
        cron.schedule('*/5 * * * *', async () => {
            console.log('Running automated messaging - 5-minute check at:', new Date().toISOString());
            await this.handleAutomatedMessaging();
        });
    }

    async handleAutomatedMessaging() {
        try {
            const companiesRef = this.db.collection('companies');
            const companies = await companiesRef.get();

            for (const company of companies.docs) {
                const companyId = company.id;
                const scheduledMessagesRef = companiesRef.doc(companyId).collection('scheduledNurture');
                const activeMessages = await scheduledMessagesRef
                    .where('status', '==', 'active')
                    .get();

                for (const messageDoc of activeMessages.docs) {
                    const messageConfig = messageDoc.data();
                    await this.processAutomatedMessage(companyId, messageDoc.id, messageConfig);
                }
            }
        } catch (error) {
            console.error('Error in handleAutomatedMessaging:', error);
        }
    }

    async processAutomatedMessage(companyId, messageId, config) {
        try {
            const now = new Date();
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
            const timeIndex = config.times.findIndex(time => time === currentTimeStr);

            // Create a log entry for this execution
            const logRef = this.db.collection('automationLogs').doc();
            const executionLog = {
                timestamp: admin.firestore.Timestamp.now(),
                companyId,
                messageId,
                timeSlot: currentTimeStr,
                status: 'started',
                messagesAttempted: 0,
                messagesSent: 0,
                errors: []
            };

            await logRef.set(executionLog);

            if (timeIndex === -1) {
                await logRef.update({
                    status: 'skipped',
                    reason: 'No matching time slot'
                });
                return;
            }

            const contactsRef = this.db.collection('companies').doc(companyId).collection('contacts');
            const contacts = await contactsRef
                .where('tags', 'array-contains-any', ['new', 'lead'])
                .where('tags', 'array-contains-none', ['stop bot', config.stopKeyword])
                .get();

            let messagesAttempted = 0;
            let messagesSent = 0;
            let errors = [];

            for (const contact of contacts.docs) {
                messagesAttempted++;
                const contactData = contact.data();

                try {
                    // Get message history for this contact
                    const messageHistory = await contact.ref
                        .collection('messageHistory')
                        .where('type', '==', 'automated')
                        .get();

                    const receivedMessages = messageHistory.docs.map(doc => doc.data().messageContent);
                    const availableMessages = config.messages.filter(msg => !receivedMessages.includes(msg));

                    // If no new messages available, skip this contact
                    if (availableMessages.length === 0) {
                        console.log(`Contact ${contactData.chat_id} has received all available messages. Skipping.`);
                        continue;
                    }

                    const randomMessage = this.getRandomMessage(availableMessages);
                    const personalizedMessage = randomMessage.replace(/%name%/g, contactData.contactName || '');

                    const botData = this.botMap.get(companyId);
                    if (!botData) {
                        errors.push({
                            contactId: contact.id,
                            error: 'Bot not found for company'
                        });
                        continue;
                    }

                    const client = botData[0].client;
                    await client.sendMessage(contactData.chat_id, personalizedMessage);

                    // Create a new message history record
                    await this.db.collection('companies')
                        .doc(companyId)
                        .collection('contacts')
                        .doc(contact.id)
                        .collection('messageHistory')
                        .add({
                            messageContent: randomMessage,
                            timestamp: admin.firestore.Timestamp.now(),
                            messageSlot: timeIndex,
                            type: 'automated'
                        });

                    // Update only the essential tracking fields in contact
                    await contact.ref.update({
                        lastAutomatedMessage: admin.firestore.Timestamp.now(),
                        lastMessageSlot: timeIndex
                    });

                    console.log(`Sent automated message to ${contactData.chat_id} for company ${companyId} at scheduled time ${config.times[timeIndex]}. Messages remaining: ${availableMessages.length - 1}`);

                    messagesSent++;
                } catch (error) {
                    errors.push({
                        contactId: contact.id,
                        error: error.message
                    });
                    console.error(`Error sending message to ${contactData.chat_id}:`, error);
                }
            }

            // Update the log with final results
            await logRef.update({
                status: 'completed',
                messagesAttempted,
                messagesSent,
                errors,
                completedAt: admin.firestore.Timestamp.now()
            });

        } catch (error) {
            // Log any overall process errors
            await this.db.collection('automationLogs').add({
                timestamp: admin.firestore.Timestamp.now(),
                companyId,
                messageId,
                status: 'failed',
                error: error.message,
                stack: error.stack
            });
            console.error('Error in processAutomatedMessage:', error);
        }
    }

    getRandomMessage(messages) {
        return messages[Math.floor(Math.random() * messages.length)];
    }

    async toggleAutomation(companyId, messageId, status) {
        try {
            await this.db.collection('companies')
                .doc(companyId)
                .collection('scheduledNurture')
                .doc(messageId)
                .update({ status });

            return { success: true };
        } catch (error) {
            console.error('Error toggling automation:', error);
            throw error;
        }
    }
}

module.exports = AutomatedMessaging;