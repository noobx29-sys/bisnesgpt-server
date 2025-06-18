const fetch = require('node-fetch');
const admin = require('../firebase.js');
const db = admin.firestore();
const OpenAI = require('openai');
const schedule = require('node-schedule');
const hubspot = require('@hubspot/api-client');
const fs = require('fs').promises;
const path = require('path');
let ghlConfig = {};
let scheduledJob;
const openai = new OpenAI({
    apiKey: process.env.OPENAIKEY,
});
const HUBSPOT_ACCESS_TOKEN = 'pat-na1-6d593838-7fda-4368-b271-56c28cdde7eb';
const hubspotClient = new hubspot.Client({ accessToken: HUBSPOT_ACCESS_TOKEN });

async function fetchConfigFromDatabase() {
    try {
        const docRef = db.collection('companies').doc('042');
        const doc = await docRef.get();
        if (!doc.exists) {
            console.log('No such document!');
            return;
        }
        ghlConfig = doc.data();
    } catch (error) {
        console.error('Error fetching config:', error);
        throw error;
    }
}

async function handleZahinHubspot(req, res, getClient) {
    console.log('Zahin Hubspot Webhook');
    const data = req.body;
    setupZahinScheduledJob(getClient);

    let objectIds = [];

    if (Array.isArray(data)) {
        objectIds = data.map(item => item.objectId).filter(id => id !== undefined);
    } else if (typeof data === 'object' && data !== null) {
        objectIds = [data].map(item => item.objectId).filter(id => id !== undefined);
    }

    if (objectIds.length === 0) {
        return res.status(400).json({ message: 'No valid objectIds found in the data' });
    }

    try {
        const apiResponses = await Promise.all(objectIds.map(makeApiCall));
        console.log('API responses:', JSON.stringify(apiResponses, null, 2));

        await updateDailyWebhookCount();

        const client = getClient();
        if (!client) {
            throw new Error('Unable to retrieve client');
        }

        await fetchConfigFromDatabase();

        const results = [];

        for (const response of apiResponses) {
            const contactData = response.data;
            if (!contactData) {
                console.log(`No valid contact data found for objectId: ${response.objectId}`);
                continue;
            }

            let { name, phone, email } = contactData;
            if (!phone || !name) {
                console.log(`Missing phone or name for objectId: ${response.objectId}`);
                continue;
            }

            const phoneWithPlus = phone.startsWith('+') ? phone : '+' + phone;
            const phoneWithoutPlus = phone.startsWith('+') ? phone.slice(1) : phone;
            const chatId = `${phoneWithoutPlus}@c.us`;

            console.log(`Processing: ${chatId}, ${name}`);

            try {
                const message = `Hi ${name}. Terima kasih kerana mendaftar nombor telefon dengan Zahin Travel melalui [TikTok / Facebook]. 

Boleh saya dapatkan maklumat seperti di bawah:

1) Rancang nak bercuti ke mana?
2) Bilangan peserta dewasa dan kanak-kanak?

Sebaik sahaja butiran diterima, perunding percutian akan menghubungi ${name} secepat mungkin.

Terima kasih.

Zahin Travel Sdn. Bhd. (1276808-W)
No. Lesen Pelancongan: KPK/LN 9159
No. Ahli MATTA: MA6018

Diyakini . Responsif . Budi Bahasa`;

                const msg = await client.sendMessage(chatId, message);
                lastMessageData = await addMessagetoFirebase(msg, '042', phoneWithPlus, name);

                await writeContactToFile(phoneWithPlus, name, lastMessageData.timestamp);

                const contactData = {
                    total_message_count: 1,
                    last_replied_time: lastMessageData.timestamp,
                    chat: {
                        contact_id: phoneWithPlus,
                        id: chatId,
                        name: name,
                        not_spam: true,
                        tags: ['Hubspot Lead'],
                        timestamp: lastMessageData.timestamp ?? 0,
                        type: 'contact',
                        unreadCount: 0,
                        last_message: {
                            chat_id: lastMessageData.from,
                            from: lastMessageData.from ?? "",
                            from_me: lastMessageData.fromMe ?? false,
                            id: lastMessageData.id._serialized ?? "",
                            source: "",
                            status: "delivered",
                            text: {
                                body: lastMessageData.text.body ?? ""
                            },
                            timestamp: lastMessageData.timestamp ?? 0,
                            type: 'text',
                        },
                    },
                    chat_id: chatId,
                    city: null,
                    companyName: "",
                    contactName: name,
                    unreadCount: 0,
                    threadid: "",
                    phoneIndex: 0,
                    last_message: {
                        chat_id: lastMessageData.from,
                        from: lastMessageData.from ?? "",
                        from_me: lastMessageData.fromMe ?? false,
                        id: lastMessageData.id._serialized ?? "",
                        source: "",
                        status: "delivered",
                        text: {
                            body: lastMessageData.text.body ?? ""
                        },
                        timestamp: lastMessageData.timestamp ?? 0,
                        type: 'text',
                    },
                    createdAt: admin.firestore.Timestamp.now()
                };

                await db.collection('companies').doc('042').collection('contacts').doc(phoneWithPlus).set(contactData, { merge: true });
                
                results.push({ phone: phoneWithPlus, name, success: true });
            } catch (error) {
                console.error(`Error processing contact ${name} (${phone}):`, error);
                results.push({ phone, name, success: false, error: error.message });
            }
        }

        res.status(200).json({ 
            message: 'Data processed successfully!', 
            results 
        });
    } catch (error) {
        console.error('Error processing contacts:', error);
        res.status(500).json({ 
            message: 'Error processing data', 
            error: error.message 
        });
    }
}

async function updateDailyWebhookCount() {
    const today = new Date().toISOString().split('T')[0];
    const idSubstring = '042';
    const countRef = db.collection('companies').doc(idSubstring).collection('hubspot').doc(today);

    try {
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(countRef);
            if (!doc.exists) {
                transaction.set(countRef, { count: 1 });
            } else {
                const newCount = doc.data().count + 1;
                transaction.update(countRef, { count: newCount });
            }
        });
        console.log(`Updated daily webhook count for ${today}`);
    } catch (error) {
        console.error('Error updating daily webhook count:', error);
    }
}

async function makeApiCall(objectId) {
    console.log(`Making API call for objectId: ${objectId}`);
    try {
        const properties = ['firstname', 'lastname', 'hs_calculated_phone_number', 'email'];
        const propertiesWithHistory = undefined;
        const associations = undefined;
        const archived = false;

        const apiResponse = await hubspotClient.crm.contacts.basicApi.getById(
            objectId,
            properties,
            propertiesWithHistory,
            associations,
            archived
        );

        console.log(JSON.stringify(apiResponse, null, 2));

        const contactData = {
            name: `${apiResponse.properties.firstname || ''} ${apiResponse.properties.lastname || ''}`.trim(),
            phone: apiResponse.properties.hs_calculated_phone_number || '',
            email: apiResponse.properties.email || '',
        };

        await storeContactInFirebase(contactData);

        return { objectId, data: contactData };
    } catch (error) {
        if (error.message === 'HTTP request failed') {
            console.error(JSON.stringify(error.response, null, 2));
        } else {
            console.error(error);
        }
        throw error;
    }
}

async function storeContactInFirebase(contactData) {
    try {
        const idSubstring = '042';
        const docRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(contactData.phone);

        await docRef.set({
            ...contactData,
            tags: admin.firestore.FieldValue.arrayUnion('Hubspot Lead')
        }, { merge: true });

        console.log(`Contact stored in Firebase with phone number: ${contactData.phone}`);
    } catch (error) {
        console.error('Error storing contact in Firebase:', error);
        throw error;
    }
}

async function addMessagetoFirebase(msg, idSubstring, extractedNumber, first_name){
    console.log('Adding message to Firebase');
    console.log('idSubstring:', idSubstring);
    console.log('extractedNumber:', extractedNumber);

    if (!extractedNumber) {
        console.error('Invalid extractedNumber for Firebase document path:', extractedNumber);
        return;
    }

    if (!idSubstring) {
        console.error('Invalid idSubstring for Firebase document path');
        return;
    }
    let messageBody = msg.body;
    let audioData = null;
    let type = '';
    if(msg.type == 'chat'){
        type ='text'
    }else if(msg.type == 'e2e_notification' || msg.type == 'notification_template'){
        return;
    }else{
        type = msg.type;
    }
    
    if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {
        console.log('Voice message detected');
        const media = await msg.downloadMedia();
        const transcription = await transcribeAudio(media.data);
        console.log('Transcription:', transcription);
                
        messageBody = transcription;
        audioData = media.data;
        console.log(msg);
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

    if(msg.hasQuotedMsg){
        const quotedMsg = await msg.getQuotedMessage();
        // Initialize the context and quoted_content structure
        messageData.text.context = {
          quoted_content: {
            body: quotedMsg.body
          }
        };
        const authorNumber = '+'+(quotedMsg.from).split('@')[0];
        const authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
        messageData.text.context.quoted_author = authorData ? authorData.contactName : authorNumber;
    }

    if((msg.from).includes('@g.us')){
        const authorNumber = '+'+(msg.author).split('@')[0];

        const authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
        if(authorData){
            messageData.author = authorData.contactName;
        }else{
            messageData.author = msg.author;
        }
    }

    if (msg.type === 'audio' || msg.type === 'ptt') {
        messageData.audio = {
            mimetype: 'audio/ogg; codecs=opus', // Default mimetype for WhatsApp voice messages
            data: audioData // This is the base64 encoded audio data
        };
    }

    if (msg.hasMedia &&  (msg.type !== 'audio' || msg.type !== 'ptt')) {
        try {
            const media = await msg.downloadMedia();
            if (media) {
              if (msg.type === 'image') {
                messageData.image = {
                    mimetype: media.mimetype,
                    data: media.data,  // This is the base64-encoded data
                    filename: msg._data.filename || "",
                    caption: msg._data.caption || "",
                };
                // Add width and height if available
                if (msg._data.width) messageData.image.width = msg._data.width;
                if (msg._data.height) messageData.image.height = msg._data.height;
              } else if (msg.type === 'document') {
                  messageData.document = {
                      mimetype: media.mimetype,
                      data: media.data,  // This is the base64-encoded data
                      filename: msg._data.filename || "",
                      caption: msg._data.caption || "",
                      pageCount: msg._data.pageCount,
                      fileSize: msg._data.size,
                  };
              }else if (msg.type === 'video') {
                    messageData.video = {
                        mimetype: media.mimetype,
                        filename: msg._data.filename || "",
                        caption: msg._data.caption || "",
                    };
                    // Store video data separately or use a cloud storage solution
                    const videoUrl = await storeVideoData(media.data, msg._data.filename);
                    messageData.video.link = videoUrl;
              } else {
                  messageData[msg.type] = {
                      mimetype: media.mimetype,
                      data: media.data,
                      filename: msg._data.filename || "",
                      caption: msg._data.caption || "",
                  };
              }
  
              // Add thumbnail information if available
              if (msg._data.thumbnailHeight && msg._data.thumbnailWidth) {
                  messageData[msg.type].thumbnail = {
                      height: msg._data.thumbnailHeight,
                      width: msg._data.thumbnailWidth,
                  };
              }
  
              // Add media key if available
              if (msg.mediaKey) {
                  messageData[msg.type].mediaKey = msg.mediaKey;
              }

              
            }  else {
                console.log(`Failed to download media for message: ${msg.id._serialized}`);
                messageData.text = { body: "Media not available" };
            }
        } catch (error) {
            console.error(`Error handling media for message ${msg.id._serialized}:`, error);
            messageData.text = { body: "Error handling media" };
        }
    }

    const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
    const messagesRef = contactRef.collection('messages');

    const messageDoc = messagesRef.doc(msg.id._serialized);
    await messageDoc.set(messageData, { merge: true });
    console.log(messageData);
    await addNotificationToUser(idSubstring, messageData, first_name);
    return messageData;
}

async function addNotificationToUser(companyId, message, contactName) {
    console.log('noti');
    try {
        // Find the user with the specified companyId
        message.from = contactName
        const usersRef = db.collection('user');
        const querySnapshot = await usersRef.where('companyId', '==', companyId).where('email', '==', 'admin@zahintravel.com').get();

        if (querySnapshot.empty) {
            console.log('No matching documents.');
            return;
        }

        // Filter out undefined values from the message object
        const cleanMessage = Object.fromEntries(
            Object.entries(message).filter(([_, value]) => value !== undefined)
        );

        // Add the new message to the notifications subcollection of the user's document
        querySnapshot.forEach(async (doc) => {
            const userRef = doc.ref;
            const notificationsRef = userRef.collection('notifications');
            const updatedMessage = { ...cleanMessage, read: false };
        
            await notificationsRef.add(updatedMessage);
            console.log(`Notification ${updatedMessage} added to user with companyId: ${companyId}`);
        });
    } catch (error) {
        console.error('Error adding notification: ', error);
    }
}

async function writeContactToFile(phoneWithPlus, name, timestamp) {
    const filePath = path.join(__dirname, 'pendingReplies.json');
    let pendingReplies = [];
    
    try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        pendingReplies = JSON.parse(fileContent);
    } catch (error) {
        console.error('Error reading pendingReplies.json:', error);
    }

    pendingReplies.push({ phone: phoneWithPlus,name: name, timestamp });

    await fs.writeFile(filePath, JSON.stringify(pendingReplies, null, 2));
}

async function checkAndSendFollowUp(client) {
    const filePath = path.join(__dirname, 'pendingReplies.json');
    let pendingReplies = [];

    try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        pendingReplies = JSON.parse(fileContent);
    } catch (error) {
        console.error('Error reading pendingReplies.json:', error);
        return;
    }

    const now = Date.now();
    const fourHoursInMs = 4 * 60 * 60 * 1000;
    const updatedPendingReplies = [];

    for (const contact of pendingReplies) {
        if (now - contact.timestamp >= fourHoursInMs) {
            const phoneWithoutPlus = contact.phone.startsWith('+') ? contact.phone.slice(1) : contact.phone;
            const chatId = `${phoneWithoutPlus}@c.us`;

            const messagesRef = db.collection('companies').doc('042').collection('contacts').doc(contact.phone).collection('messages');
            const latestMessage = await messagesRef.orderBy('timestamp', 'desc').limit(1).get();

            if (!latestMessage.empty && latestMessage.docs[0].data().timestamp > contact.timestamp) {continue;}

            // Send follow-up message
            const followUpMessage = `Hi ${contact.name}. Boleh saya tahu adakah masih berminat dengan pakej percutian Zahin Travel?

Terima kasih.

Zahin Travel Sdn. Bhd. (1276808-W)
No. Lesen Pelancongan: KPK/LN 9159
No. Ahli MATTA: MA6018

Diyakini . Responsif . Budi Bahasa`;
            const msg = await client.sendMessage(chatId, followUpMessage);
            const lastMessageData = await addMessagetoFirebase(msg, '042', contact.phone, contact.name);

            const contactData = {
                total_message_count: 1,
                last_replied_time: lastMessageData.timestamp,
                chat: {
                    contact_id: contact.phone,
                    id: chatId,
                    name: contact.name,
                    not_spam: true,
                    tags: ['Hubspot Lead'],
                    timestamp: lastMessageData.timestamp ?? 0,
                    type: 'contact',
                    unreadCount: 0,
                    last_message: {
                        chat_id: lastMessageData.from,
                        from: lastMessageData.from ?? "",
                        from_me: lastMessageData.fromMe ?? false,
                        id: lastMessageData.id._serialized ?? "",
                        source: "",
                        status: "delivered",
                        text: {
                            body: lastMessageData.text.body ?? ""
                        },
                        timestamp: lastMessageData.timestamp ?? 0,
                        type: 'text',
                    },
                },
                chat_id: chatId,
                city: null,
                companyName: "",
                contactName: contact.name,
                unreadCount: 0,
                threadid: "",
                phoneIndex: 0,
                last_message: {
                    chat_id: lastMessageData.from,
                    from: lastMessageData.from ?? "",
                    from_me: lastMessageData.fromMe ?? false,
                    id: lastMessageData.id._serialized ?? "",
                    source: "",
                    status: "delivered",
                    text: {
                        body: lastMessageData.text.body ?? ""
                    },
                    timestamp: lastMessageData.timestamp ?? 0,
                    type: 'text',
                },
                createdAt: admin.firestore.Timestamp.now()
            };

            await db.collection('companies').doc('042').collection('contacts').doc(contact.phone).set(contactData, { merge: true });

            console.log(`Sent follow-up message to ${contact.phone}`);
        } else {
            updatedPendingReplies.push(contact);
        }
    }

    await fs.writeFile(filePath, JSON.stringify(updatedPendingReplies, null, 2));
}

function setupZahinScheduledJob(getClient) {
    if (scheduledJob) {
        console.log('Cancelling existing scheduled job');
        scheduledJob.cancel();
    }
    console.log('Setting up new scheduled job');
    scheduledJob = schedule.scheduleJob('0 * * * *', async function() {
        console.log('Running scheduled follow-up check');
        const client = getClient();
        if (client) {
            await checkAndSendFollowUp(client);
        } else {
            console.error('Unable to retrieve client for scheduled job');
        }
    });
    return scheduledJob;
}

module.exports = { handleZahinHubspot };