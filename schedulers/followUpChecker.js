const cron = require('node-cron');
const admin = require('../firebase.js');
const db = admin.firestore();
const MessageMedia = require('whatsapp-web.js').MessageMedia;

const activeCheckers = new Set();

async function addMessagetoFirebase(msg, idSubstring, extractedNumber, first_name) {


    if (!extractedNumber) {
        console.error('Invalid extractedNumber for Firebase document path:', extractedNumber);
        return;
    }

    if (!idSubstring) {
        console.error('Invalid idSubstring for Firebase document path');
        return;
    }

    let messageBody = msg.body;
    let type = msg.type == 'chat' ? 'text' : msg.type;
    
    if (msg.type === 'e2e_notification' || msg.type === 'notification_template') {
        return;
    }

    const messageData = {
        chat_id: msg.from,
        from: msg.from ?? "",
        from_me: msg.fromMe ?? false,
        id: msg.id._serialized ?? "",
        status: "delivered",
        text: {
            body: messageBody ?? ""
        },
        timestamp: msg.timestamp ?? 0,
        type: type,
    };

    const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
    const messagesRef = contactRef.collection('messages');

    const messageDoc = messagesRef.doc(msg.id._serialized);
    await messageDoc.set(messageData, { merge: true });
    await addNotificationToUser(idSubstring, messageData, first_name);
    return messageData;
}

async function addNotificationToUser(idSubstring, messageData, first_name) {
    try {
        const notificationRef = db.collection('companies').doc(idSubstring).collection('notifications').doc();
        await notificationRef.set({
            title: first_name,
            text: messageData.text.body,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
            type: 'message'
        });
    } catch (error) {
        console.error('Error adding notification:', error);
    }
}

async function sendFollowUpMessage(client, followUp, chatId) {
    if (followUp.document) {
        const media = await MessageMedia.fromUrl(followUp.document, { 
            unsafeMime: true, 
            filename: followUp.document.split('/').pop() 
        });
        return await client.sendMessage(chatId, media, { caption: followUp.message });
    } else if (followUp.image) {
        const media = await MessageMedia.fromUrl(followUp.image);
        return await client.sendMessage(chatId, media, { caption: followUp.message });
    } else {
        return await client.sendMessage(chatId, followUp.message);
    }
}

function scheduleFollowUpChecker(client, companyId) {
    if (activeCheckers.has(companyId)) {
        return;
    }

    const cronJob = cron.schedule('* * * * *', async () => {
        try {
            // Get all contacts that have a last_replied_time
            const contactsRef = db.collection('companies').doc(companyId).collection('contacts');
            const contactsSnapshot = await contactsRef
                .where('last_replied_time', '>', 0)
                .get();

            if (contactsSnapshot.empty) {
                return;
            }

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

            // Add delay between messages
            const DELAY_BETWEEN_MESSAGES = 60000; // 10 seconds delay

            // Process each contact
            for (const contactDoc of contactsSnapshot.docs) {
                const contactData = contactDoc.data();
                const phoneNumber = contactDoc.id;
                const lastRepliedTime = contactData.last_replied_time * 1000;
                const currentTime = Date.now();

                // Skip if this is a group chat
                if (contactData.chat_id.includes('@g.us')) {
                    continue;
                }

                // Get sent follow-ups for this contact
                const sentFollowUpsRef = contactDoc.ref.collection('sentFollowUps');
                const sentFollowUpsSnapshot = await sentFollowUpsRef.get();
                const sentFollowUpIds = new Set(sentFollowUpsSnapshot.docs.map(doc => doc.id));

                // Process each follow-up
                for (const followUp of followUps) {
                    // Skip if this follow-up was already sent to this contact
                    if (sentFollowUpIds.has(followUp.id)) {
                        continue;
                    }

                    // Skip if the last reply was before the follow-up was created
                    const followUpCreatedAt = followUp.createdAt?.toMillis() || Date.now();
                    if (lastRepliedTime < followUpCreatedAt) {
                        continue;
                    }

                    // Check both stopTag and stopTags array
                    const tagsToCheck = [
                        ...(followUp.stopTags || []),
                        ...(followUp.stopTag ? [followUp.stopTag] : [])
                    ];

                    // Skip if contact has any of the stop tags
                    if (tagsToCheck.length > 0 && contactData.tags) {
                        const hasStopTag = tagsToCheck.some(tag => contactData.tags.includes(tag));
                        if (hasStopTag) {
                            continue;
                        }
                    }

                    let shouldSend = false;

                    // Check if using scheduled time
                    if (followUp.useScheduledTime && followUp.scheduledTime) {
                        const [scheduledHour, scheduledMinute] = followUp.scheduledTime.split(':').map(Number);
                        const now = new Date();
                        const scheduledTimeToday = new Date(
                            now.getFullYear(),
                            now.getMonth(),
                            now.getDate(),
                            scheduledHour,
                            scheduledMinute
                        );

                        // Check if current time is past scheduled time
                        if (now >= scheduledTimeToday) {
                            // Check if we haven't sent it today
                            const startOfDay = new Date(
                                now.getFullYear(),
                                now.getMonth(),
                                now.getDate()
                            ).getTime();

                            if (lastRepliedTime <= startOfDay) {
                                shouldSend = true;
                            }
                        }
                    } else {
                        // Use original interval-based logic
                        const intervalInMs = followUp.interval * (
                            followUp.intervalUnit === 'minutes' ? 60000 :
                            followUp.intervalUnit === 'hours' ? 3600000 :
                            followUp.intervalUnit === 'days' ? 86400000 : 0
                        );

                        // Calculate time elapsed since last reply
                        const timeElapsed = currentTime - lastRepliedTime;

                        // Only send if elapsed time is greater than the interval
                        if (timeElapsed >= intervalInMs) {
                            shouldSend = true;
                        }
                    }

                    if (shouldSend) {
                        // Add delay before sending
                        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_MESSAGES));

                        try {
                            const sentMessage = await sendFollowUpMessage(
                                client, 
                                followUp, 
                                contactData.chat_id
                            );

                            // Add to Firebase
                            await addMessagetoFirebase(
                                sentMessage,
                                companyId,
                                phoneNumber,
                                contactData.contactName || phoneNumber
                            );

                            // Mark as sent with createdAt timestamp
                            await sentFollowUpsRef.doc(followUp.id).set({
                                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                                messageId: followUp.id,
                                lastRepliedTime: lastRepliedTime,
                                interval: followUp.interval,
                                intervalUnit: followUp.intervalUnit,
                                whatsappMessageId: sentMessage.id._serialized,
                                createdAt: followUp.createdAt || admin.firestore.FieldValue.serverTimestamp()
                            });
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

    // Add cleanup for when bot disconnects/stops
    client.on('disconnected', () => {
        cronJob.stop();
        activeCheckers.delete(companyId);
    });
}

module.exports = { scheduleFollowUpChecker }; 