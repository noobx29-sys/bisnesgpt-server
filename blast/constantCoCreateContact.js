const fetch = require('node-fetch');
const admin = require('../firebase.js');
const db = admin.firestore();
const OpenAI = require('openai');
const schedule = require('node-schedule');
let ghlConfig = {};
const openai = new OpenAI({
    apiKey: process.env.OPENAIKEY,
});
async function fetchConfigFromDatabase() {
    try {
        const docRef = db.collection('companies').doc('0148');
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

const axios = require('axios');

async function handleConstantCoCreateContact(req, res, client) {
    console.log('Constant Co webhook');
    console.log(req.body);
    await fetchConfigFromDatabase();
    let { name, phone,email } = req.body;
    if (!phone || !name) {
       return res.status(400).json({ error: 'Phone number and name are required' });
    }
    phone = phone.replace(/\s+|-/g, '');
    let phoneWithPlus = phone;
    if(!phone.startsWith('+')){
        phoneWithPlus = "+"+phone;
    }else{
        phone = phone.replace('+', '');
    }
    const chatId = `${phone.replace(/^\+/, '')}@c.us`;
    console.log(chatId);
    console.log(name);
    try {
        const message = `Hey there. Selamat datang.||at Constant Co, we helped thousands recover.feel better, move easier 😁||what is your goal?||do you have any current joint pain or you want to get stronger, tone up , lose weight and get fitter?`;
        const messageParts = message.split('||');
        let lastMessageData = null;

        for (const part of messageParts) {
            const msg = await client.sendMessage(chatId, part);
            lastMessageData = await addMessagetoFirebase(msg, '0148', phoneWithPlus, first_name);
        }

        const data = {
            additionalEmails: [],
            address1: null,
            assignedTo: null,
            businessId: null,
            phone: phoneWithPlus,
            tags: tags,
            email: email,
            total_message_count: 0,
            last_replied_time: lastMessageData.timestamp,
            chat: {
                contact_id: phoneWithPlus,
                id: chatId,
                name: name,
                not_spam: true,
                tags: tags,
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
        };

        data.createdAt = admin.firestore.Timestamp.now();

        await addNotificationToUser('0148', lastMessageData, name);

        // Add the data to Firestore
        await db.collection('companies').doc('0148').collection('contacts').doc(phoneWithPlus).set(data, { merge: true }); 
        //scheduleFollowUpMessages(client, chatId, first_name, '0148');
        res.json({ success: true});
    } catch (error) {
        console.error(`Error sending message to ${phone}:`, error);
        res.json({ phone, first_name, success: false, error: error.message });
    }
}

async function scheduleFollowUpMessages(client, chatId, contactName, idSubstring) {
    const followUpDelays = [1 * 60 * 1000, 2 * 60 * 1000, 3 * 60 * 1000]; // 1 minute, 2 minutes, 3 minutes in milliseconds
    const followUpMessages = [
        `hi ${contactName}, just checking in. can i book an appointment for you or do you need any help?`,
        `hello ${contactName}, i noticed you haven't responded. can i book you an appointment or is there anything you need help with?`,
        `hi ${contactName}, i'm following up one last time. please let me know if i can book you an appointment or do you need any assistance.`
    ];

    const scheduledMessages = followUpDelays.map((delay, index) => {
        const reminderTime = new Date(Date.now() + delay);
        const scheduledTimeSeconds = Math.floor(reminderTime.valueOf() / 1000);

        return {
            batchQuantity: 1,
            chatIds: [chatId],
            companyId: idSubstring,
            createdAt: admin.firestore.Timestamp.now(),
            documentUrl: "",
            fileName: null,
            mediaUrl: "",
            message: followUpMessages[index],
            mimeType: null,
            repeatInterval: 0,
            repeatUnit: "days",
            scheduledTime: {
                seconds: scheduledTimeSeconds,
                nanoseconds: 0
            },
            status: "scheduled",
            v2: true,
            whapiToken: null,
            tag: 'followup'
        };
    });

    try {
        console.log('Sending schedule request for follow-up messages:', JSON.stringify(scheduledMessages));
        const response = await axios.post(`http://localhost:8443/api/schedule-message/${idSubstring}`, { messages: scheduledMessages });
        console.log('Follow-up messages scheduled successfully:', response.data);
    } catch (error) {
        console.error('Error scheduling follow-up messages:', error.response ? error.response.data : error.message);
        if (error.response && error.response.data) {
            console.error('Server response:', error.response.data);
        }
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
        const querySnapshot = await usersRef.where('companyId', '==', companyId).get();

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

module.exports = { handleConstantCoCreateContact };