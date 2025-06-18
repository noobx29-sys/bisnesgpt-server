const cron = require('node-cron');
const admin = require('../firebase.js');
const db = admin.firestore();

const activeCheckers = new Set(); // Track active checkers by companyId

function scheduleFollowUpChecker(client, companyId) {
    // Prevent duplicate schedulers
    if (activeCheckers.has(companyId)) {
        console.log(`Follow-up checker already running for company ${companyId}`);
        return;
    }

    const cronJob = cron.schedule('* * * * *', async () => {
        try {
            // Get all contacts that have a last_replied_time
            const contactsRef = db.collection('companies').doc(companyId).collection('contacts');
            const contactsSnapshot = await contactsRef
                .where('last_replied_time', '>', 0)
                .get();

            if (contactsSnapshot.empty) return;

            // Get all active follow-ups
            const followUpsRef = db.collection('companies').doc(companyId).collection('followUps');
            const followUpsSnapshot = await followUpsRef
                .where('status', '==', 'active')
                .get();
            
            if (followUpsSnapshot.empty) return;

            const followUps = followUpsSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Process each contact
            for (const contactDoc of contactsSnapshot.docs) {
                const contactData = contactDoc.data();
                const phoneNumber = contactDoc.id;
                const lastRepliedTime = contactData.last_replied_time * 1000;
                const currentTime = Date.now();

                // Get sent follow-ups for this contact
                const sentFollowUpsRef = contactDoc.ref.collection('sentFollowUps');
                const sentFollowUpsSnapshot = await sentFollowUpsRef.get();
                const sentFollowUpIds = new Set(sentFollowUpsSnapshot.docs.map(doc => doc.id));

                // Process each unsent follow-up
                for (const followUp of followUps) {
                    if (sentFollowUpIds.has(followUp.id)) continue;

                    const intervalInMs = followUp.interval * (
                        followUp.intervalUnit === 'minutes' ? 60000 :
                        followUp.intervalUnit === 'hours' ? 3600000 :
                        followUp.intervalUnit === 'days' ? 86400000 : 0
                    );

                    const shouldSendTime = lastRepliedTime + intervalInMs;

                    if (currentTime >= shouldSendTime) {
                        try {
                            const sentMessage = await client.sendMessage(
                                phoneNumber + '@c.us', 
                                followUp.message
                            );

                            await sentFollowUpsRef.doc(followUp.id).set({
                                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                                messageId: followUp.id,
                                scheduledTime: new Date(shouldSendTime).toISOString(),
                                lastRepliedTime: lastRepliedTime,
                                interval: followUp.interval,
                                intervalUnit: followUp.intervalUnit
                            });

                            console.log(`Follow-up sent to ${phoneNumber} for company ${companyId}`);
                        } catch (error) {
                            console.error(`Error sending follow-up to ${phoneNumber}:`, error);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error in follow-up checker for company ${companyId}:`, error);
        }
    }, {
        timezone: "Asia/Kuala_Lumpur"
    });

    activeCheckers.add(companyId);
    console.log(`Follow-up checker scheduled for company ${companyId}`);

    // Add cleanup for when bot disconnects/stops
    client.on('disconnected', () => {
        cronJob.stop();
        activeCheckers.delete(companyId);
        console.log(`Follow-up checker stopped for company ${companyId}`);
    });
}

module.exports = { scheduleFollowUpChecker };