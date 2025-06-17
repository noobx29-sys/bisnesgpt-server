const fetch = require('node-fetch');
const admin = require('../firebase.js');
const db = admin.firestore();
const OpenAI = require('openai');
let ghlConfig = {};
const openai = new OpenAI({
    apiKey: process.env.OPENAIKEY,
});
async function fetchConfigFromDatabase() {
    try {
        const docRef = db.collection('companies').doc('045');
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

async function saveThreadIDFirebase(contactID, threadID, idSubstring) {
    
    // Construct the Firestore document path
    const docPath = `companies/${idSubstring}/contacts/${contactID}`;

    try {
        await db.doc(docPath).set({
            threadid: threadID
        }, { merge: true }); // merge: true ensures we don't overwrite the document, just update it
        console.log(`Thread ID saved to Firestore at ${docPath}`);
    } catch (error) {
        console.error('Error saving Thread ID to Firestore:', error);
    }
}

async function handleHajoonCreateContact(req, res, client) {
    console.log('hajoon webhook');
    console.log(req.body);
    await fetchConfigFromDatabase();

    const { fields } = req.body;
    const first_name = fields.name?.value || '';
    let phone = fields.Number?.value || '';
    const location = fields.location?.value || '';
    const carModel = fields.CarModel?.value || '';
    const note = fields.Note?.value || '';
    


    if (!phone || !first_name) {
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
    console.log(first_name);
    try {
        const message = `New contact added. ${first_name} - ${phoneWithPlus}`;
        const msg = await client.sendMessage("601121677522@c.us", message);
        
        const tags = [location, carModel];
        // Add message to assistant
        const messageData = await addMessagetoFirebase(msg, '045', phoneWithPlus, first_name);

        const data = {
            additionalEmails: [],
            address1: null,
            assignedTo: null,
            location: location,
            carModel: carModel,
            note: note,
            businessId: null,
            phone: phoneWithPlus,
            tags: tags,
            chat: {
                contact_id: phoneWithPlus,
                id: chatId,
                name: first_name,
                not_spam: true,
                tags: tags,
                timestamp: Date.now(),
                type: 'contact',
                unreadCount: 0,
                last_message: {
                    chat_id: msg.from,
                    from: msg.from ?? "",
                    from_me: msg.fromMe ?? false,
                    id: msg.id._serialized ?? "",
                    source: "",
                    status: "delivered",
                    text: {
                        body: message ?? ""
                    },
                    timestamp: msg.timestamp ?? 0,
                    type:'text',
                },
            },
            chat_id: chatId,
            city: null,
            companyName: null,
            contactName: first_name,
            unreadCount: 0,
            threadid:  "",
            phoneIndex: 0,
            last_message: {
                chat_id: msg.from,
                from: msg.from ?? "",
                from_me: msg.fromMe ?? false,
                id: msg.id._serialized ?? "",
                source: "",
                status: "delivered",
                text: {
                    body: message ?? ""
                },
                timestamp: msg.timestamp ?? 0,
                type: 'text',
            },
        };

        data.createdAt = admin.firestore.Timestamp.now();

        await addNotificationToUser('045', messageData, first_name);

        // Add the data to Firestore
        await db.collection('companies').doc('045').collection('contacts').doc(phoneWithPlus).set(data, {merge: true});   

        res.json({ success: true });
    } catch (error) {
        console.error(`Error sending message to ${phone}:`, error);
        res.json({ phone, first_name, success: false, error: error.message });
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

async function addMessageAssistant(threadId, message) {
    const response = await openai.beta.threads.messages.create(
        threadId,
        {
            role: "assistant",
            content: message
        }
    );
    console.log(response);
    return response;
}
function createMessage(name) {
    return `Hi ${name}! 
Thanks for signing up with Extreme Fitness, SG's #1 Transformation & Fat-loss Studio. 🏋

We’ve helped hundreds of people transform their bodies, and we can’t wait to help you too! `;
}

module.exports = { handleHajoonCreateContact };