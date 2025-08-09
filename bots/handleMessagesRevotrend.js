// handleMessagesTemplateWweb.js

//STEP BY STEP GUIDE
//1. CHANGE all handleMessagesTemplate to -> handleMessages<YourBotName>
//2. CHANGE all idSubstring to firebase collection name
//3. CHANGE all <assistant> to openai assistant id
//4. CHANGE all Template to your <YourBotName>

const OpenAI = require('openai');
const axios = require('axios').default;
const { Client } = require('whatsapp-web.js');

const { v4: uuidv4 } = require('uuid');

const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();

let ghlConfig = {};
const { google } = require('googleapis');

// Set up Google Sheets API
const auth = new google.auth.GoogleAuth({
  keyFile: './service_account.json', // Replace with your credentials file path
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
// Schedule the task to run every 12 hours

const openai = new OpenAI({
    apiKey: process.env.OPENAIKEY,
});

const steps = {
    START: 'start',
};
const userState = new Map();

async function customWait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

let employees = [];
let sales = [];
let currentEmployeeIndex = 0;

async function fetchEmployeesFromFirebase(idSubstring) {
    const employeesRef = db.collection('companies').doc(idSubstring).collection('employee');
    const snapshot = await employeesRef.get();
    
    employees = [];
    
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.name && data.role === "4") {
            employees.push({
                name: data.name,
                email: data.email,
                phoneNumber: data.phoneNumber,
                assignedContacts: data.assignedContacts || 0,
                group: data.group || null
            });
        }
    });

    console.log('Fetched employees with role 4:', employees);
    await loadAssignmentState(idSubstring);
}

async function fetchSalesFromFirebase(idSubstring, group) {
    const employeesRef = db.collection('companies').doc(idSubstring).collection('employee');
    const snapshot = await employeesRef.get();
    
    sales = [];
    
    console.log(`Total documents in employee collection: ${snapshot.size}`);

    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`Processing employee document:`, data);

        if (data.name && data.role === "2" && data.group === group) {
            sales.push({
                name: data.name,
                email: data.email,
                phoneNumber: data.phoneNumber,
                assignedContacts: data.assignedContacts || 0,
                weightage: data.weightage || 0
            });
            console.log(`Added employee ${data.name} with role 2`);
        } else {
            console.log(`Skipped employee ${data.name} due to missing name or role not being 2`);
        }
    });

    console.log('Fetched employees with role 2:', employees);

}


async function loadAssignmentState(idSubstring) {
    const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentState');
    const doc = await stateRef.get();
    if (doc.exists) {
        const data = doc.data();
        currentEmployeeIndex = data.currentEmployeeIndex;
        console.log('Assignment state loaded from Firebase:', data);
    } else {
        console.log('No previous assignment state found');
        currentEmployeeIndex = 0;
    }
}

async function storeAssignmentState(idSubstring) {
    const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentState');
    const stateToStore = {
        currentEmployeeIndex: currentEmployeeIndex,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    };

    await stateRef.set(stateToStore);
    console.log('Assignment state stored in Firebase:', stateToStore);
}



async function addNotificationToUser(companyId, message, contactName) {
    console.log('Adding notification and sending FCM');
    try {
        // Find the user with the specified companyId
        const usersRef = db.collection('user');
        const querySnapshot = await usersRef.where('companyId', '==', companyId).get();

        if (querySnapshot.empty) {
            console.log('No matching documents.');
            return;
        }

        // Filter out undefined values and reserved keys from the message object
        const cleanMessage = Object.fromEntries(
            Object.entries(message)
                .filter(([key, value]) => value !== undefined && !['from', 'notification', 'data'].includes(key))
                .map(([key, value]) => {
                    if (key === 'text' && typeof value === 'string') {
                        return [key, { body: value }];
                    }
                    return [key, typeof value === 'object' ? JSON.stringify(value) : String(value)];
                })
        );

        // Add sender information to cleanMessage
        cleanMessage.senderName = contactName;
     // Filter out undefined values from the message object
     const cleanMessage2 = Object.fromEntries(
        Object.entries(message).filter(([_, value]) => value !== undefined)
    );  
        let text;
        if(cleanMessage2.hasMedia){
            text = "Media"
        }
        text = cleanMessage2.text?.body || 'New message received';
        // Prepare the FCM message
        const topic = message.phoneIndex != null ? `${companyId}_phone_${message.phoneIndex}` : companyId;
        const fcmMessage = {
            notification: {
                title: `${contactName}`,
                body: cleanMessage2.text?.body || 'New message received'
            },
            data: {
                ...cleanMessage,
                text: JSON.stringify(cleanMessage.text), // Stringify the text object for FCM
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                sound: 'default'
            },
            topic: topic // Specify the topic here
        };

        // Add the new message to Firestore for each user
        const promises = querySnapshot.docs.map(async (doc) => {
            const userRef = doc.ref;
            const notificationsRef = userRef.collection('notifications');
            const updatedMessage = { ...cleanMessage2, read: false, from: contactName };
        
            await notificationsRef.add(updatedMessage);
            console.log(`Notification added to Firestore for user with companyId: ${companyId}`);
            console.log('Notification content:');
        });

        await Promise.all(promises);

        // Send FCM message to the topic
        await admin.messaging().send(fcmMessage);
        console.log(`FCM notification sent to topic '001'`);

    } catch (error) {
        console.error('Error adding notification or sending FCM: ', error);
    }
}


async function addMessagetoFirebase(msg, idSubstring, extractedNumber, contactName,phoneIndex){
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
        phoneIndex:phoneIndex??0
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
    await addNotificationToUser(idSubstring, messageData, contactName);
}


async function getChatMetadata(chatId,) {
    const url = `https://gate.whapi.cloud/chats/${chatId}`;
    const headers = {
        'Authorization': `Bearer ${ghlConfig.whapiToken}`,
        'Accept': 'application/json'
    };

    try {
        const response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        console.error('Error fetching chat metadata:', error.response.data);
        throw error;
    }
}
async function transcribeAudio(audioData) {
    try {
        const formData = new FormData();
        formData.append('file', Buffer.from(audioData, 'base64'), {
            filename: 'audio.ogg',
            contentType: 'audio/ogg',
        });
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'json');

        const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${process.env.OPENAIKEY}`,
            },
        });

        return response.data.text;
    } catch (error) {
        console.error('Error transcribing audio:', error);
        return '';
    }
}

const MESSAGE_BUFFER_TIME = 10000; // 1 minute in milliseconds
const messageBuffers = new Map();

async function handleNewMessagesRevotrend(client, msg, botName, phoneIndex) {
    console.log('Handling new Messages '+botName);

    const idSubstring = botName;
    const chatId = msg.from;
 // Process the message immediately for Firebase and notifications
 await processImmediateActions(client, msg, botName, phoneIndex);
    // Initialize or update the message buffer for this chat
    if (!messageBuffers.has(chatId)) {
        messageBuffers.set(chatId, {
            messages: [],
            timer: null
        });
    }
    const buffer = messageBuffers.get(chatId);

    // Add the new message to the buffer
    buffer.messages.push(msg);

    // Clear any existing timer
    if (buffer.timer) {
        clearTimeout(buffer.timer);
    }

    // Set a new timer
    buffer.timer = setTimeout(() => processBufferedMessages(client, chatId, botName, phoneIndex), MESSAGE_BUFFER_TIME);
}

async function processImmediateActions(client, msg, botName, phoneIndex) {
    const idSubstring = botName;
    const chatId = msg.from;
   console.log('processImmediateActions');

    try {
         // Initial fetch of config
         await fetchConfigFromDatabase(idSubstring,phoneIndex);
         const sender = {
             to: msg.from,
             name: msg.notifyName,
         };
 
         const extractedNumber = '+'+(sender.to).split('@')[0];
 
         if (msg.fromMe){
             console.log(msg);
             return;
         }
             
         let contactID;
         let contactName;
         let threadID;
         let query;
         let answer;
         let parts;
         let currentStep;
         const chat = await msg.getChat();
         const contactData = await getContactDataFromDatabaseByPhone(extractedNumber, idSubstring);
         let unreadCount = 0;
         let stopTag = contactData?.tags || [];
         const contact = await chat.getContact();
 
         console.log(contactData);
         if (contactData !== null) {
             if(contactData.tags){
                 stopTag = contactData.tags;
                 console.log(stopTag);
                 unreadCount = contactData.unreadCount ?? 0;
                 contactID = extractedNumber;
                 contactName = contactData.contactName ?? contact.pushname ?? extractedNumber;
             
                 if (phoneIndex === 0 && contactData.threadid) {
                    threadID = contactData.threadid;
                } else if ((phoneIndex === 1 || phoneIndex === 3) && contactData.threadid2) {
                    threadID = contactData.threadid2;
                } else if (phoneIndex === 2 && contactData.threadid3) {
                    threadID = contactData.threadid3;
                } else {
                    // No matching threadId found for this phoneIndex, create new thread
                    const thread = await createThread();
                    threadID = thread.id;
                    await saveThreadIDFirebase(contactID, threadID, idSubstring, phoneIndex);
                }
             } else {
                 contactID = extractedNumber;
                 contactName = contactData.contactName ?? msg.pushname ?? extractedNumber;
                 if (phoneIndex === 0 && contactData.threadid) {
                    threadID = contactData.threadid;
                } else if ((phoneIndex === 1 || phoneIndex === 3) && contactData.threadid2) {
                    threadID = contactData.threadid2;
                } else if (phoneIndex === 2 && contactData.threadid3) {
                    threadID = contactData.threadid3;
                } else {
                    // No matching threadId found for this phoneIndex, create new thread
                    const thread = await createThread();
                    threadID = thread.id;
                    await saveThreadIDFirebase(contactID, threadID, idSubstring, phoneIndex);
                }
                
             }
         } else {
             await customWait(2500); 
 
             contactID = extractedNumber;
             contactName = contact.pushname || contact.name || extractedNumber;
 
             const thread = await createThread();
             threadID = thread.id;
             console.log(threadID);
             await saveThreadIDFirebase(contactID, threadID, idSubstring,phoneIndex)
             console.log('sent new contact to create new contact');
           
         }   
 
         let firebaseTags = []
         if (contactData) {
             firebaseTags = contactData.tags ?? [];
             // Remove 'snooze' tag if present
             if(firebaseTags.includes('snooze')){
                 firebaseTags = firebaseTags.filter(tag => tag !== 'snooze');
             }
         } else {
             if ((sender.to).includes('@g.us')) {
                 firebaseTags = ['stop bot']
             }
         }
 
         if(firebaseTags.includes('replied') && firebaseTags.includes('fb')){
             // Schedule removal of 'replied' tag after 1 hour
             // scheduleRepliedTagRemoval(idSubstring, extractedNumber, msg.from);
         }
 
         let type = 'text';
         if(msg.type == 'e2e_notification' || msg.type == 'notification_template'){
             return;
         } else if (msg.type != 'chat') {
             type = msg.type;
         }
             
         if(extractedNumber.includes('status')){
             return;
         }
 
         // Use combinedMessage instead of looping through messages
         let messageBody = msg.body;
         let audioData = null;
 
         const data = {
             additionalEmails: [],
             address1: null,
             assignedTo: null,
             businessId: null,
             phone: extractedNumber,
             tags: firebaseTags,
             chat: {
                 contact_id: extractedNumber,
                 id: msg.from,
                 name: contactName || contact.name || contact.pushname || extractedNumber,
                 not_spam: true,
                 tags: firebaseTags,
                 timestamp: chat.timestamp || Date.now(),
                 type: 'contact',
                 unreadCount: 0,
                 last_message: {
                     chat_id: msg.from,
                     from: msg.from ?? "",
                     from_me: msg.fromMe ?? false,
                     id: msg.id._serialized ?? "",
                     source: chat.deviceType ?? "",
                     status: "delivered",
                     text: {
                         body: messageBody ?? ""
                     },
                     timestamp: msg.timestamp ?? 0,
                     type: type,
                 },
             },
             chat_id: msg.from,
             city: null,
             companyName: contact.companyName || null,
             contactName: contactName || contact.name || contact.pushname || extractedNumber,
             unreadCount: unreadCount + 1,

             phoneIndex: phoneIndex,
             phoneIndexes: admin.firestore.FieldValue.arrayUnion(phoneIndex), // Add this new array field
             last_message: {
                 chat_id: msg.from,
                 from: msg.from ?? "",
                 from_me: msg.fromMe ?? false,
                 id: msg.id._serialized ?? "",
                 source: chat.deviceType ?? "",
                 status: "delivered",
                 text: {
                     body: messageBody ?? ""
                 },
                 timestamp: msg.timestamp ?? 0,
                 type: type,
             },
         };
 // Only add threadid fields if they exist or should be set
if (contactData?.threadid || phoneIndex == 0) {
    data.threadid = contactData?.threadid || threadID;
}
if (contactData?.threadid2 || (phoneIndex == 1 || phoneIndex == 3)) {
    data.threadid2 = contactData?.threadid2 || threadID;
}
if (contactData?.threadid3 || phoneIndex == 2) {
    data.threadid3 = contactData?.threadid3 || threadID;
}

// Then
         // Only add createdAt if it's a new contact
         if (!contactData) {
             data.createdAt = admin.firestore.Timestamp.now();
         }
 
         let profilePicUrl = "";
         if (contact.getProfilePicUrl()) {
             try {
                 profilePicUrl = await contact.getProfilePicUrl() || "";
             } catch (error) {
                 console.error(`Error getting profile picture URL for ${contact.id.user}:`, error);
             }
         }
         data.profilePicUrl = profilePicUrl;
 
         const messageData = {
             chat_id: msg.from,
             from: msg.from ?? "",
             from_me: msg.fromMe ?? false,
             id: msg.id._serialized ?? "",
             source: chat.deviceType ?? "",
             status: "delivered",
             text: {
                 body: messageBody ?? ""
             },
             timestamp: msg.timestamp ?? 0,
             type: type,
             phoneIndex: phoneIndex ?? 0,
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
             
         if((sender.to).includes('@g.us')){
             const authorNumber = '+'+(msg.author).split('@')[0];
 
             const authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
             if(authorData){
                 messageData.author = authorData.contactName;
             }else{
                 messageData.author = authorNumber;
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
 
                 
               } else {
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
         console.log(msg);
         await addNotificationToUser(idSubstring, messageData, contactName);
        
        // Add the data to Firestore
        await db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber).set(data, {merge: true}); 
          //reset bot command
          if (msg.body.includes('/resetbot')) {
            const thread = await createThread();
            threadID = thread.id;
            await saveThreadIDFirebase(contactID, threadID, idSubstring,phoneIndex)
            client.sendMessage(msg.from, 'Bot is now restarting with new thread.');
            return;
        }

        //test bot command
        if (msg.body.includes('/hello')) {
            client.sendMessage(msg.from, 'tested.');
            return;
        }
        if(ghlConfig.stopbot){
            if(ghlConfig.stopbot == true){
                console.log('bot stop all');
                return;
            }
        }
        if(firebaseTags !== undefined){
            if(firebaseTags.includes('stop bot')){
                console.log('bot stop');
                return;
            }
        }   
       
         
    // Check if contact already has an employee assigned
    const hasEmployeeAssigned = contactData?.tags?.some(tag => 
        tag !== 'stop bot' && 
        tag !== 'snooze' && 
        tag !== 'fb'
    );

    // Only assign employee if contact doesn't already have one
    if (!hasEmployeeAssigned) {
        await assignNewContactToEmployee(extractedNumber, idSubstring, client, phoneIndex);
    }
        console.log('Message processed immediately:', msg.id._serialized);
    } catch (error) {
        console.error('Error in immediate processing:', error);
    }
}
async function processBufferedMessages(client, chatId, botName, phoneIndex) {
    const buffer = messageBuffers.get(chatId);
    if (!buffer || buffer.messages.length === 0) return;

    const messages = buffer.messages;
    messageBuffers.delete(chatId); // Clear the buffer

    // Combine all message bodies
    const combinedMessage = messages.map(m => m.body).join(' ');

    // Process the combined message
    await processMessage(client, messages[0], botName, phoneIndex, combinedMessage);
}

const RATE_LIMIT_DELAY = 500; // Define the rate limit delay in milliseconds

async function processMessage(client, msg, botName, phoneIndex, combinedMessage) {
    console.log('Processing buffered messages for '+botName);

    const idSubstring = botName;
    const chatId = msg.from;
    
    try {
        // Initial fetch of config
        await fetchConfigFromDatabase(idSubstring,phoneIndex);
        if(ghlConfig.stopbot){
            if(ghlConfig.stopbot == true){
                console.log('bot stop all');
                return;
            }
        }
        // Set up the daily report schedule
        //await checkAndScheduleDailyReport(client, idSubstring);

        const sender = {
            to: msg.from,
            name: msg.notifyName,
        };

        const extractedNumber = '+'+(sender.to).split('@')[0];

        if (msg.fromMe){
            console.log(msg);
            return;
        }
            
        let contactID;
        let contactName;
        let threadID;
        let query;
        let answer;
        let parts;
        let currentStep;
        const chat = await msg.getChat();
        const contactData = await getContactDataFromDatabaseByPhone(extractedNumber, idSubstring);
        let unreadCount = 0;
        let stopTag = contactData?.tags || [];
        const contact = await chat.getContact();
        chat.sendStateTyping();

   
        if (msg.fromMe){
            if(stopTag.includes('idle')){
            }
            return;
        }
        if(stopTag.includes('stop bot')){
            console.log('Bot stopped for this message');
            return;
        }

      
        if ((msg.from).includes('120363178065670386')) {
            console.log('detected message from group juta')
            console.log(combinedMessage)
            if ((combinedMessage).startsWith('<Confirmed Appointment>')) {
                console.log('detected <CONFIRMED APPOINTMENT>')
                await handleConfirmedAppointment(client, msg);
                return;
            }
        } 
        if (phoneIndex === 0 && contactData.threadid) {
            threadID = contactData.threadid;
        } else if ((phoneIndex === 1 || phoneIndex === 3) && contactData.threadid2) {
            threadID = contactData.threadid2;
        } else if (phoneIndex === 2 && contactData.threadid3) {
            threadID = contactData.threadid3;
        } else {
            // No matching threadId found for this phoneIndex, create new thread
            const thread = await createThread();
            threadID = thread.id;
            await saveThreadIDFirebase(contactID, threadID, idSubstring, phoneIndex);
        }
        if (msg.body.includes('/resetbot')) {
 
            return;
        }
        currentStep = userState.get(sender.to) || steps.START;
        switch (currentStep) {
            case steps.START:
                var context = "";
                const followUpTemplates = await getFollowUpTemplates(idSubstring);
                let templateFound = false;

                query = `${combinedMessage}`;
                if(msg.type === 'image'){
                    var image = await handleImageMessage(msg, sender, threadID, client,idSubstring,extractedNumber);
                    query = `${combinedMessage} The user image analysis is: ${image}`;
                    answer = await handleOpenAIAssistant(query, threadID, stopTag, extractedNumber, idSubstring, client,contactData.contactName,phoneIndex);
                    console.log(answer);
                    parts = answer.split(/\s*\|\|\s*/);
                    
                    for (let i = 0; i < parts.length; i++) {
                        const part = parts[i].trim();   
                        const check = part.toLowerCase();
                        if (part) {
                            if (part) {
                                const aiResponses = await getAIImageResponses(idSubstring);
                                let imageFound = false;
  
                                if (msg.type === 'audio' || msg.type === 'ptt') {
                                    console.log('audio or ptt');
                                    let sentMessage = null;
                                    // Generate audio file
                                    const audioFilePath = await generateAudioFromText(part);
                                    
                                    // Send audio message
                                    const media = MessageMedia.fromFilePath(audioFilePath);
                                    media.mimetype = 'audio/mp4';
                                    sentMessage = await client.sendMessage(msg.from, media, { sendAudioAsVoice: true });
            
            
                                    // Clean up the audio file
                                    await fs.promises.unlink(audioFilePath);
                                    await addMessagetoFirebase(sentMessage, idSubstring, extractedNumber, contactName,phoneIndex);
                                }else{
                                    const sentMessage = await client.sendMessage(msg.from, part);
  
                                    // Save the message to Firebase
                                    const sentMessageData = {
                                        chat_id: sentMessage.from,
                                        from: sentMessage.from ?? "",
                                        from_me: true,
                                        id: sentMessage.id._serialized ?? "",
                                        source: sentMessage.deviceType ?? "",
                                        status: "delivered",
                                        text: {
                                            body: part
                                        },
                                        timestamp: sentMessage.timestamp ?? 0,
                                        type: 'text',
                                        ack: sentMessage.ack ?? 0,
                                        phoneIndex:phoneIndex??0,
                                    };
        
                                    const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
                                    const messagesRef = contactRef.collection('messages');
                            
                                    const messageDoc = messagesRef.doc(sentMessage.id._serialized);
        
                                    await messageDoc.set(sentMessageData, { merge: true });
                                  
            
                                }
                                for (const response of aiResponses) {
                                    if (part.toLowerCase().includes(response.keyword)) {
                                        console.log('image found for keyword ' + response.keyword);
                                        // Send image using MessageMedia
                                        const media = await MessageMedia.fromUrl(response.imageUrl);
                                        const imageMessage = await client.sendMessage(msg.from, media);
                                        await addMessagetoFirebase(imageMessage, idSubstring, extractedNumber, contactName,phoneIndex);
                                        imageFound = true;
                                        break;
                                    }
                                }
  
                            }
                          
                        }
                    }
                }else{
                    if(!(sender.to.includes('@g.us')) || (combinedMessage.toLowerCase().startsWith('@juta') && phoneIndex == 0)){
                        answer = await handleOpenAIAssistant(query, threadID, stopTag, extractedNumber, idSubstring, client,contactData.contactName,phoneIndex);
                    console.log(answer);
                    parts = answer.split(/\s*\|\|\s*/);
                    
                    for (let i = 0; i < parts.length; i++) {
                        const part = parts[i].trim();   
                        const check = part.toLowerCase();
                        if (part) {
                            const sentMessage = await client.sendMessage(msg.from, part);

                            // Save the message to Firebase
                            const sentMessageData = {
                                chat_id: sentMessage.from,
                                from: sentMessage.from ?? "",
                                from_me: true,
                                id: sentMessage.id._serialized ?? "",
                                source: sentMessage.deviceType ?? "",
                                status: "delivered",
                                text: {
                                    body: part
                                },
                                timestamp: sentMessage.timestamp ?? 0,
                                type: 'text',
                                ack: sentMessage.ack ?? 0,
                                phoneIndex:phoneIndex??0
                            };

                            const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
                            const messagesRef = contactRef.collection('messages');
                    
                            const messageDoc = messagesRef.doc(sentMessage.id._serialized);

                            await messageDoc.set(sentMessageData, { merge: true });
                            if (part.toLowerCase().includes('key clients executive will be in touch') || part.toLowerCase().includes('key clients executives to be in touch')) {
                                try {
                                    const contactData = await getContactDataFromDatabaseByPhone(extractedNumber, idSubstring);
                                    
                                    // Determine which assistant to use based on phoneIndex
                                    const assistantId = phoneIndex === 0 ? ghlConfig.assistantId : 
                                                      (phoneIndex === 1 || phoneIndex === 3) ? ghlConfig.assistantId2 : 
                                                      ghlConfig.assistantId3;
                            
                                    // Generate notification instruction based on phoneIndex
                                    let notificationInstruction;
                                    switch (phoneIndex) {
                                        case 0:
                                            notificationInstruction = `Generate a notification in exactly this format based on our conversation:
                            
                            *StoreGuru Customer Assistance Required*
                            
                            1. Customer Name: ${contactData.contactName || 'Not provided'}
                            2. Contact Number: ${extractedNumber}
                            3. Query Type: [Extract from conversation]
                            
                            Current Status:
                            1. Stage in Sales Process: [Extract from conversation]
                            2. Last Discussion Point: [Extract from conversation]
                            3. Immediate Action Required: [Extract from conversation]
                            
                            Additional Notes: [Extract any relevant additional information]`;
                                            break;
                            
                                        case 1:
                                            notificationInstruction = `Generate a notification in exactly this format based on our conversation:
                            
                            *Revotrend Customer Assistance Required*
                            
                            1. Customer Name: ${contactData.contactName || 'Not provided'}
                            2. Contact Number: ${extractedNumber}
                            3. Query Type: [Extract from conversation]
                            4. Current Service Interest: ${contactData.tags?.find(tag => ['RSP', 'RSC', 'RST'].includes(tag)) || '[Extract from conversation]'}
                            
                            Current Status:
                            1. Stage in Sales Process: [Extract from conversation]
                            2. Last Discussion Point: [Extract from conversation]
                            3. Immediate Action Required: [Extract from conversation]
                            
                            Additional Notes: [Extract any relevant additional information]`;
                                            break;
                            
                                        case 2:
                                            notificationInstruction = `Generate a notification in exactly this format based on our conversation:
                            
                            *ShipGuruFulfillment Inquiry - Assistance Required*
                            
                            1. Customer Name: ${contactData.contactName || 'Not provided'}
                            2. Contact Number: ${extractedNumber}
                            3. Service Type: ${contactData.tags?.find(tag => ['B2B', 'B2C'].includes(tag)) || '[Extract from conversation]'}
                            
                            Action Required: [Extract from conversation]
                            Please review chat history for detailed requirements`;
                                            break;
                            
                                        case 3:
                                            notificationInstruction = `Generate a notification in exactly this format based on our conversation:
                            
                            *StoreGuru Storage Inquiry - Assistance Required*
                            
                            1. Customer Name: ${contactData.contactName || 'Not provided'}
                            2. Contact Number: ${extractedNumber}
                            3. Storage Type: ${contactData.tags?.find(tag => ['PS', 'BS'].includes(tag)) || '[Extract from conversation]'}
                            
                            Action Required: [Extract from conversation]
                            Please review chat history for detailed requirements`;
                                            break;
                            
                                        default:
                                            notificationInstruction = `Generate a simple notification for a customer inquiry with:
                            - Customer name: ${contactData.contactName || 'Not provided'}
                            - Phone: ${extractedNumber}
                            - Required action based on our conversation`;
                                    }
                            
                                       // Send the instruction to the existing thread
        await openai.beta.threads.messages.create(threadID, {
            role: "user",
            content: notificationInstruction
        });

        // Create a new run for the notification
        const run = await openai.beta.threads.runs.create(threadID, {
            assistant_id: assistantId
        });

        // Wait for completion and get the notification message
        let notificationMessage;
        while (true) {
            const status = await openai.beta.threads.runs.retrieve(threadID, run.id);
            if (status.status === 'completed') {
                const messages = await openai.beta.threads.messages.list(threadID);
                notificationMessage = messages.data[0].content[0].text.value;
                break;
            }
            if (status.status === 'failed') {
                throw new Error('Failed to generate notification message');
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
                            
                                    let notificationSent = false;
                                    const employeeTags = contactData?.tags || [];
                                    const employeesRef = db.collection('companies').doc(idSubstring).collection('employee');
                                    const allEmployeesSnapshot = await employeesRef.get();
                                    
                                    // Send notification to assigned employee(s)
                                    for (const doc of allEmployeesSnapshot.docs) {
                                        const employeeData = doc.data();
                                        if (employeeData.name && employeeTags.includes(employeeData.name)) {
                                            if (employeeData.phoneNumber) {
                                                const employeeID = employeeData.phoneNumber.split('+')[1] + '@c.us';
                                                try {
                                                    const sentMessage = await client.sendMessage(employeeID, notificationMessage);
                                                    await addMessagetoFirebase(sentMessage, idSubstring, employeeData.phoneNumber,phoneIndex);
                                                    notificationSent = true;
                                                } catch (error) {
                                                    console.error('Error sending notification to employee:', error);
                                                }
                                            }
                                        }
                                    }
                            
                                    // If no assigned employee found, assign a new one
                                    if (!notificationSent) {
                                        await assignNewContactToEmployee(extractedNumber, idSubstring, client, phoneIndex);
                                    }
                                } catch (error) {
                                    console.error('Error handling Key Clients Executive notification:', error);
                                }
                            }
                      // ... existing code ...
else if (part.toLowerCase().includes('great, looking forward to meeting you soon!')||part.toLowerCase().includes('great, Looking forward to meeting you soon') || part.toLowerCase().includes('please allow us some time to prepare the pricing proposal for your request')) {
    console.log('Detected trigger phrase for report generation');
    
    try {
        await customWait(2500);
        
        // Get the contact data and log it
        const contactData = await getContactDataFromDatabaseByPhone(extractedNumber, idSubstring);
        console.log('Contact data retrieved:', contactData);
        
        // Determine assistant ID and log it
        const assistantId = phoneIndex === 0 ? ghlConfig.assistantId : 
            (phoneIndex === 1 || phoneIndex === 3) ? ghlConfig.assistantId2 : 
            ghlConfig.assistantId3;
        console.log('Using assistant ID:', assistantId);
        
        // Generate the report
        console.log('Generating onboarding report...');
        const report = await generateOnboardingReport(threadID, assistantId, extractedNumber, contactData);
        console.log('Generated report:', report);

        // Extract service type
        const serviceMatch = report.match(/(?:Selected Service|Storage Type):\s*([^\n]+)/);
        const selectedService = serviceMatch ? serviceMatch[1].trim() : null;
        console.log('Extracted service:', selectedService);

        if (selectedService) {
            let serviceTag = '';
            // For Revotrend services
            if (selectedService.toLowerCase().includes('revospace')) serviceTag = 'RSP';
            else if (selectedService.toLowerCase().includes('revoscan')) serviceTag = 'RSC';
            else if (selectedService.toLowerCase().includes('revostroy')) serviceTag = 'RST';
            // For StorageGuru services
            else if (selectedService.toLowerCase().includes('personal storage')) serviceTag = 'PS';
            else if (selectedService.toLowerCase().includes('business storage')) serviceTag = 'BS';
            // For ShipGuru services
            else if (selectedService.toLowerCase().includes('b2b')) serviceTag = 'B2B';
            else if (selectedService.toLowerCase().includes('b2c')) serviceTag = 'B2C';
            else serviceTag = 'other';
            
            console.log('Determined service tag:', serviceTag);
            await addtagbookedFirebase(extractedNumber, serviceTag, idSubstring);
        }

        const contactTags = contactData?.tags || [];
        console.log('Contact tags:', contactTags);
        
        // Get all employees
        const employeesRef = db.collection('companies').doc(idSubstring).collection('employee');
        const allEmployeesSnapshot = await employeesRef.get();
        console.log('Found employees:', allEmployeesSnapshot.size);
        
        // Use Promise.all to properly handle async operations
        const sendPromises = [];
        
        allEmployeesSnapshot.forEach((doc) => {
            const employeeData = doc.data();
            const employeeName = employeeData.name;
            
            if (employeeName && contactTags.some(tag => 
                tag.toLowerCase() === employeeName.toLowerCase())) {
                console.log('Found matching employee:', employeeName);
                
                if (employeeData.phoneNumber) {
                    const employeeID = employeeData.phoneNumber.split('+')[1] + '@c.us';
                    console.log('Sending report to employee:', employeeID);
                    
                    const sendPromise = (async () => {
                        try {
                            const sentMessage = await client.sendMessage(employeeID, 
                                `${report}\n\nGenerated on: ${new Date().toLocaleString()}`
                            );
                            await addMessagetoFirebase(sentMessage, idSubstring, employeeData.phoneNumber,phoneIndex);
                            console.log('Report sent successfully to:', employeeID);
                        } catch (error) {
                            console.error('Error sending report to employee:', employeeID, error);
                        }
                    })();
                    
                    sendPromises.push(sendPromise);
                } else {
                    console.error('Employee found but no phone number:', employeeData);
                }
            }
        });
        
        // Wait for all messages to be sent
        await Promise.all(sendPromises);
        console.log('All reports sent successfully');
        await addtagbookedFirebase(extractedNumber, 'stop bot', idSubstring);
    } catch (error) {
        console.error('Error in report generation and sending:', error);
    }
}
for (const template of followUpTemplates) {
    if (template.triggerKeywords.some(kw => part.toLowerCase().includes(kw.toLowerCase()))) {
        console.log('Follow-up trigger found for template:', template.name);
        try {
            // Get current contact data to check tags
            const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
            const contactDoc = await contactRef.get();
            const contactData = contactDoc.data();
            const currentTags = contactData?.tags || [];

            // Check if contact has any tags that match other templates' trigger tags
            for (const otherTemplate of followUpTemplates) {
                const tagToRemove = otherTemplate.triggerTags?.[0];
                if (tagToRemove && currentTags.includes(tagToRemove)) {
                    // Remove the tag if it exists
                    await contactRef.update({
                        tags: admin.firestore.FieldValue.arrayRemove(tagToRemove)
                    });

                    // Call the API to remove scheduled messages
                    try {
                        const response = await fetch('https://juta.ngrok.app/api/tag/followup', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                requestType: 'removeTemplate',
                                phone: extractedNumber,
                                first_name: contactName || extractedNumber,
                                phoneIndex: phoneIndex || 0,
                                templateId: otherTemplate.id,
                                idSubstring: idSubstring
                            }),
                        });

                        if (!response.ok) {
                            console.error('Failed to remove template messages:', await response.text());
                        }
                    } catch (error) {
                        console.error('Error removing template messages:', error);
                    }
                }
            }
            // Add new tag for current template
            if (template.triggerTags.length > 0) {
                await addtagbookedFirebase(extractedNumber, template.triggerTags[0], idSubstring);
            }

            // Start follow-up sequence
            const response = await fetch('https://juta.ngrok.app/api/tag/followup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    requestType: 'startTemplate',
                    phone: extractedNumber,
                    first_name: contactName || extractedNumber,
                    phoneIndex: phoneIndex || 0,
                    templateId: template.id,
                    idSubstring: idSubstring
                }),
            });

            if (!response.ok) {
                console.error('Failed to start follow-up sequence:', await response.text());
            }
            templateFound = true;
            break;
        } catch (error) {
            console.error('Error triggering follow-up sequence:', error);
        }
        return;
    }
    if (templateFound) break;
}

                        }
                    }
                }
                
                }
                  
                console.log('Response sent.');
                userState.set(sender.to, steps.START);
                break;
            default:
                // Handle unrecognized step
                console.error('Unrecognized step:', currentStep);
                break;
        }
        // Implement rate limiting
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    } catch (e) {
        console.error('Error:', e.message);
        return(e.message);
    }
}



async function loadAssignmentCounts(idSubstring) {
    const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentCounts');
    const doc = await stateRef.get();
    if (doc.exists) {
        const data = doc.data();
        assignmentCounts = data.counts || {};
        totalAssignments = data.total || 0;
        console.log('Assignment counts loaded from Firebase:', data);
    } else {
        console.log('No previous assignment counts found');
        assignmentCounts = {};
        totalAssignments = 0;
    }
}
async function getFollowUpTemplates(idSubstring) {
    const templates = [];
    const followUpTemplatesRef = db.collection('companies').doc(idSubstring).collection('followUpTemplates');
    const snapshot = await followUpTemplatesRef.where('status', '==', 'active').get();
    
    snapshot.forEach(doc => {
        templates.push({
            id: doc.id,
            triggerKeywords: doc.data().triggerKeywords || [],
            triggerTags: doc.data().triggerTags || [],
            name: doc.data().name,
            keywordSource: doc.data().keywordSource || "user" // Default to "user" if not specified
        });
    });
    return templates;
}
async function storeAssignmentCounts(idSubstring) {
    const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentCounts');
    const stateToStore = {
        counts: assignmentCounts,
        total: totalAssignments,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    };

    await stateRef.set(stateToStore);
    console.log('Assignment counts stored in Firebase:', stateToStore);
}

async function assignNewContactToEmployee(contactID, idSubstring, client, phoneIndex) {
    try {
      // Get all employee phone numbers from Firebase
        const employeesRef2 = db.collection('companies').doc(idSubstring).collection('employee');
        const employeeSnapshot2 = await employeesRef2.get();
        const staffPhoneNumbers = [];
        
        employeeSnapshot2.forEach(doc => {
            const employeeData = doc.data();
            if (employeeData.phoneNumber) {
                staffPhoneNumbers.push(employeeData.phoneNumber);
            }
        });

        // Check if contactID is a staff number
        if (staffPhoneNumbers.includes(contactID)) {
            console.log('Contact is a staff member, skipping assignment');
            return [];
        }

          // Add tag based on phoneIndex
          let botTag;
          switch(phoneIndex) {
              case 0:
                  botTag = 'Revotrend';
                  break;
              case 1:
                  botTag = 'StoreGuru';
                  break;
              case 2:
                  botTag = 'ShipGuru';
                  break;
                  case 3:
                    botTag = 'StoreGuru';
                    break;
              default:
                  botTag = 'Revotrend';
          }
          await addtagbookedFirebase(contactID, botTag, idSubstring);
        // Define employee lists
        const storeguru_revotrend_employees = [
        
            'nikaliff@addbigspace.com',
            'mshafiq@addbigspace.com',
            'arulibrahim@addbigspace.com'
        ];

        const shipguru_employees = [
            'syaashipguru@gmail.com',
            'lina@theshipguru.com',
            'isabelle.ku@theshipguru.com'
        ];

        // Get the current assignment index from Firebase
        const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentState');
        const stateDoc = await stateRef.get();
        let currentIndex = 0;

        if (stateDoc.exists) {
            currentIndex = stateDoc.data().currentIndex || 0;
        }

        // Determine which employee list to use based on phoneIndex
        const employeeList = (phoneIndex === 2) ? shipguru_employees : storeguru_revotrend_employees;
        
        // Get the next employee
        const assignedEmail = employeeList[currentIndex % employeeList.length];
        
        // Fetch employee details from Firebase
        const employeesRef = db.collection('companies').doc(idSubstring).collection('employee');
        const employeeSnapshot = await employeesRef.where('email', '==', assignedEmail).get();
        
        if (employeeSnapshot.empty) {
            console.log('No matching employee found');
            return null;
        }

        const employeeData = employeeSnapshot.docs[0].data();
        
        // Update the index in Firebase
        await stateRef.set({
            currentIndex: (currentIndex + 1) % employeeList.length,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });

        // Add tag directly with employee name string
        const employeeName = employeeData.name;
        await addtagbookedFirebase(contactID, employeeName, idSubstring);

        // Format employee ID for WhatsApp
        const employeeID = employeeData.phoneNumber.split('+')[1] + '@c.us';

        // Send assignment notification
        const contactData = await getContactDataFromDatabaseByPhone(contactID, idSubstring);
        const contactName = contactData?.contactName || 'New Contact';
        
        await client.sendMessage(employeeID, `Hello ${employeeName}, a new contact has been assigned to you:

Name: ${contactName}
Phone: ${contactID}

Kindly login to https://web.jutasoftware.co/login

Thank you.

Juta Teknologi`);

        return [employeeName, employeeData.phoneNumber];

    } catch (error) {
        console.error('Error in assignNewContactToEmployee:', error);
        return [];
    }
}

async function getAIImageResponses(idSubstring) {
    const responses = [];
    const aiResponsesRef = db.collection('companies').doc(idSubstring).collection('aiImageResponses');
    const snapshot = await aiResponsesRef.where('status', '==', 'active').get();
    
    snapshot.forEach(doc => {
        responses.push({
            keyword: doc.data().keyword.toLowerCase(),
            imageUrl: doc.data().imageUrl
        });
    });
    return responses;
}
async function handleImageMessage(msg, sender, threadID, client, idSubstring, extractedNumber) {
    try {
        const media = await msg.downloadMedia();
        
        // Create a message with the image for the assistant
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: msg.caption || "What is in this image?",
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:${media.mimetype};base64,${media.data}`
                            },
                        },
                    ],
                }
            ],
            max_tokens: 300,
        });

        // Get the response text
        const answer = response.choices[0].message.content;
        
      return answer

    } catch (error) {
        console.error("Error in image processing:", error);
     return "error processing image";
    }
}
async function analyzeImageWithGPT4Vision(base64Image, query) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4-vision-preview",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: query },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/jpeg;base64,${base64Image}`,
                            },
                        },
                    ],
                },
            ],
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error analyzing image with GPT-4 Vision:", error);
        throw error;
    }
}
async function addtagbookedFirebase(contactID, tag, idSubstring) {
    console.log(`Adding tag "${tag}" to Firebase for contact ${contactID}`);
    
    try {
        // Reference to the contact document
        const contactRef = db.collection('companies').doc(idSubstring)
                           .collection('contacts').doc(contactID);

        // Get the current document
        const doc = await contactRef.get();
        
        // Get current data and tags
        const currentData = doc.data() || {};
        let currentTags = currentData.tags || [];

        // Ensure currentTags is an array
        if (!Array.isArray(currentTags)) {
            currentTags = [];
        }

        // Check if tag already exists
        if (!currentTags.includes(tag)) {
            // Add new tag
            currentTags.push(tag);
            
            // Update document with new tags using merge: true
            await contactRef.set({
                tags: currentTags
            }, { merge: true });  // Added merge: true here
            
            console.log(`Tag "${tag}" added successfully to contact ${contactID}`);
            console.log('Updated tags array:', currentTags);
        } else {
            console.log(`Tag "${tag}" already exists for contact ${contactID}`);
        }

    } catch (error) {
        console.error('Error in addtagbookedFirebase:', error);
        console.error('Error details:', {
            contactID,
            tag,
            idSubstring,
            errorMessage: error.message,
            errorStack: error.stack
        });
    }
}

async function removeTagBookedGHL(contactID, tag) {
    const options = {
        method: 'DELETE',
        url: `https://services.leadconnectorhq.com/contacts/${contactID}/tags`,
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        data: {
            tags: [tag],
        }
    };

    try {
        const response = await axios.request(options);
    } catch (error) {
        console.error('Error removing tag from contact:', error);
    }
}

async function storeVideoData(videoData, filename) {
    const bucket = admin.storage().bucket();
    const uniqueFilename = `${uuidv4()}_${filename}`;
    const file = bucket.file(`videos/${uniqueFilename}`);

    await file.save(Buffer.from(videoData, 'base64'), {
        metadata: {
            contentType: 'video/mp4', // Adjust this based on the actual video type
        },
    });

    const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2500', // Adjust expiration as needed
    });

    return url;
}

async function getContactById(contactId) {
    const options = {
        method: 'GET',
        url: `https://services.leadconnectorhq.com/contacts/${contactId}`,
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-07-28',
            Accept: 'application/json'
        }
    };

    try {
        const response = await axios.request(options);
        return response.data.contact;
    } catch (error) {
        console.error(error);
    }
}

async function addtagbookedGHL(contactID, tag) {
    const contact = await getContactById(contactID);
    const previousTags = contact.tags || [];
    const options = {
        method: 'PUT',
        url: `https://services.leadconnectorhq.com/contacts/${contactID}`,
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        data: {
            tags: [...new Set([...previousTags, tag])]
        }
    };

    try {
        await axios.request(options);
    } catch (error) {
        console.error('Error adding tag to contact:', error);
    }
}

async function createThread() {
    console.log('Creating a new thread...');
    const thread = await openai.beta.threads.create();
    return thread;
}

async function addMessage(threadId, message) {
    const response = await openai.beta.threads.messages.create(
        threadId,
        {
            role: "user",
            content: message
        }
    );
    return response;
}

async function callWebhook(webhook,senderText,thread) {
    console.log('calling webhook')
    const webhookUrl = webhook;
    const body = JSON.stringify({ senderText,thread}); // Include sender's text in the request body
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: body
    });  let responseData =""
    if(response.status === 200){
        responseData= await response.text(); // Dapatkan respons sebagai teks
    }else{
        responseData = 'stop'
    }
 return responseData;
}

async function getContactDataFromDatabaseByPhone(phoneNumber, idSubstring) {
    try {
        // Check if phoneNumber is defined
        if (!phoneNumber) {
            throw new Error("Phone number is undefined or null");
        }

        // Initial fetch of config
        //await fetchConfigFromDatabase(idSubstring);

        let threadID;
        let contactName;
        let bot_status;
        const contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
        const querySnapshot = await contactsRef.where('phone', '==', phoneNumber).get();

        if (querySnapshot.empty) {
            console.log('No matching documents.');
            return null;
        } else {
            const doc = querySnapshot.docs[0];
            const contactData = doc.data();
            contactName = contactData.name;
            threadID = contactData.thread_id;
            bot_status = contactData.bot_status;
            return { ...contactData};
        }
    } catch (error) {
        console.error('Error fetching or updating document:', error);
        throw error;
    }
}

async function checkingStatus(threadId, runId) {
    const runObject = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
    );
    const status = runObject.status; 
    if(status == 'completed') {
        try{
            const messagesList = await openai.beta.threads.messages.list(threadId);
            const latestMessage = messagesList.body.data[0].content;

            console.log("Latest Message:");
            console.log(latestMessage[0].text.value);
            const answer = latestMessage[0].text.value;
            return answer;
        } catch(error){
            console.log("error from handleNewMessagesRevotrend: "+error)
            throw error;
        }
    }
    return null; // Return null if not completed
}
async function handleToolCalls(toolCalls, idSubstring, client, phoneNumber, name, threadID, phoneIndex) {
    console.log('Handling tool calls...');
    const toolOutputs = [];

    for (const toolCall of toolCalls) {
        console.log(`Processing tool call: ${toolCall.function.name}`);
        
        switch (toolCall.function.name) {
            
// Update the case in handleToolCalls
case 'checkAvailableTimeSlots':
    try {
        console.log('Checking available time slots...');
        const args = JSON.parse(toolCall.function.arguments || '{}');
        const result = await checkAvailableTimeSlots(phoneNumber, idSubstring, args.requestedDate);
        
        if (Array.isArray(result)) {
            const employeeName = result[0].employeeName;
            const formattedMessage = `Here are the available consultation slots:\n\n` +
                result.map(slot => 
                    `Option ${slot.option}:\n` +
                    `📅 ${slot.date}\n` +
                    `⏰ ${slot.time}\n`
                ).join('\n') +
                `\nWhich time slot would you prefer? Or would you like to check another date?`;

            toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({
                    success: true,
                    message: formattedMessage,
                    availableSlots: result
                })
            });
        } else {
            toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({
                    success: false,
                    message: result
                })
            });
        }
    } catch (error) {
        console.error('Error in checkAvailableTimeSlots:', error);
        toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({
                success: false,
                error: `Unable to check available time slots: ${error.message}`
            })
        });
    }
    break;
            case 'createCalendarEvent':
                try {
                    console.log('Processing createCalendarEvent tool call...');
                    const args = JSON.parse(toolCall.function.arguments);
                    
                    // Calculate the end time (30 minutes from start)
                    const startDateTime = new Date(args.startDateTime);
                    const endDateTime = new Date(startDateTime.getTime() + (30 * 60 * 1000));
                    
                    const result = await createCalendarEvent(
                        args.summary,
                        args.description,
                        startDateTime.toISOString(),
                        endDateTime.toISOString(),
                        phoneNumber,
                        name,
                        "Shipguru",
                        idSubstring
                    );

                    if (result.success) {
                        const response = {
                            success: true,
                            message: 'Appointment scheduled successfully',
                            appointmentDetails: {
                                ...result.appointmentDetails,
                                formattedResponse: `✅ Appointment Confirmed!\n\n` +
                                    `📅 Date: ${result.appointmentDetails.date}\n` +
                                    `⏰ Time: ${result.appointmentDetails.time}\n` +
                                    `📍 Location: ${result.appointmentDetails.description || 'TBD'}\n` +
                                    `👤 Staff: ${result.appointmentDetails.staff}\n\n` 
                                   
                            }
                        };

                        toolOutputs.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify(response)
                        });

                    } else {
                        let errorMessage = result.error;
                        if (result.conflictingAppointments) {
                            errorMessage = `I apologize, but that time slot is already booked. ` +
                                `Would you like to try a different time?`;
                        }

                        toolOutputs.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: false,
                                error: errorMessage,
                                conflicts: result.conflictingAppointments
                            })
                        });
                    }
                } catch (error) {
                    console.error('Error in createCalendarEvent handler:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({
                            success: false,
                            error: `I apologize, but I couldn't schedule the appointment. ${error.message}`
                        })
                    });
                }
                break;
            case 'generateOnboardingReport':
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    const contactData = await getContactDataFromDatabaseByPhone(phoneNumber, idSubstring);
                    const assistantId = contactData.phoneIndex === 0 ? ghlConfig.assistantId : 
            (contactData.phoneIndex === 1 || contactData.phoneIndex === 3) ? ghlConfig.assistantId2 : 
            ghlConfig.assistantId3;
                    // Generate the onboarding report
                    const report = await generateOnboardingReport(threadID,assistantId, phoneNumber, contactData);
                    const serviceTag = extractServiceType(report, contactData.phoneIndex);
                    if (serviceTag !== 'other') {
                        console.log('Determined service tag:', serviceTag);
                        await addtagbookedFirebase(phoneNumber, serviceTag, idSubstring);
                    } else {
                        console.log('Could not determine specific service tag from report');
                    }

                    // Get the contact data to find the assigned employee
                    const employeeTags = contactData?.tags || [];
                    const employeesRef = db.collection('companies').doc(idSubstring).collection('employee');
                    const allEmployeesSnapshot = await employeesRef.get();
                    
                    // Send report to each assigned employee
                    allEmployeesSnapshot.forEach(async (doc) => {
                        const employeeData = doc.data();
                        if (employeeData.name && employeeTags.includes(employeeData.name)) {
                            if (employeeData.phoneNumber) {
                                const employeeID = employeeData.phoneNumber.split('+')[1] + '@c.us';
                                try {
                                    const sentMessage = await client.sendMessage(employeeID, 
                                        `*New Lead Report*\n\n${report}\n\nGenerated on: ${new Date().toLocaleString()}`
                                    );
                                    await addMessagetoFirebase(sentMessage, idSubstring, employeeData.phoneNumber,phoneIndex);
                                } catch (error) {
                                    console.error('Error sending report to employee:', error);
                                }
                            }
                        }
                    });

                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({
                            success: true,
                            message: "Onboarding report generated and sent successfully"
                        })
                    });
                } catch (error) {
                    console.error('Error in generateOnboardingReport:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message })
                    });
                }
                break;
                case 'notifyEmployeeForAssistance':
                    try {
                        const args = JSON.parse(toolCall.function.arguments);
                        const contactData = await getContactDataFromDatabaseByPhone(phoneNumber, idSubstring);
                        
                        // Check for any active runs first
                        const runs = await openai.beta.threads.runs.list(threadID);
                        const activeRun = runs.data.find(run => 
                            ['in_progress', 'queued', 'requires_action'].includes(run.status)
                        );
                
                        if (activeRun) {
                            console.log(`Waiting for active run ${activeRun.id} to complete...`);
                            await waitForNotificationCompletion(threadID, activeRun.id);
                        }
                
                        // Generate notification instruction based on phoneIndex
                        let notificationInstruction;
                        switch (contactData.phoneIndex) {
                            case 0: // Revotrend
                                notificationInstruction = `Generate a notification in exactly this format based on our conversation:
                
                *Customer Assistance Required*
                
                1. Customer Name: ${contactData.contactName || 'Not provided'}
                2. Contact Number: ${phoneNumber}
                3. Query Type: ${args.requestType || 'Not specified'}
                4. Current Service Interest: [Extract from conversation]
                
                Current Status:
                1. Stage in Sales Process: [Extract from conversation]
                2. Last Discussion Point: [Extract from conversation]
                3. Immediate Action Required: ${args.query || 'Not specified'}
                
                Additional Notes: [Extract any relevant additional information]`;
                                break;
                            // ... other cases remain the same ...
                        }
                        const notificationAssistantId = contactData.phoneIndex === 0 ? ghlConfig.assistantId : 
                        (contactData.phoneIndex === 1 || contactData.phoneIndex === 3) ? ghlConfig.assistantId2 : 
                        ghlConfig.assistantId3;
                        // Create a new run for the notification
                        const notificationRun = await openai.beta.threads.runs.create(threadID, {
                            assistant_id: notificationAssistantId,
                            instructions: notificationInstruction
                        });
                
                        // Wait for the notification to be generated
                        const notificationMessage = await waitForNotificationCompletion(threadID, notificationRun.id);
                
                        let notificationSent = false;
                        const employeeTags = contactData?.tags || [];
                        const employeesRef = db.collection('companies').doc(idSubstring).collection('employee');
                        const allEmployeesSnapshot = await employeesRef.get();
                        
                        // Send notification to assigned employee(s)
                        for (const doc of allEmployeesSnapshot.docs) {
                            const employeeData = doc.data();
                            if (employeeData.name && employeeTags.includes(employeeData.name)) {
                                if (employeeData.phoneNumber) {
                                    const employeeID = employeeData.phoneNumber.split('+')[1] + '@c.us';
                                    try {
                                        const sentMessage = await client.sendMessage(employeeID, notificationMessage);
                                        await addMessagetoFirebase(sentMessage, idSubstring, employeeData.phoneNumber,phoneIndex);
                                        notificationSent = true;
                                    } catch (error) {
                                        console.error('Error sending notification to employee:', error);
                                    }
                                }
                            }
                        }
                
                        // If no assigned employee found, assign a new one
                        if (!notificationSent) {
                            await assignNewContactToEmployee(phoneNumber, idSubstring, client, phoneIndex);
                        }
                
                        toolOutputs.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: true,
                                message: "Employee notification sent successfully"
                            })
                        });
                    } catch (error) {
                        console.error('Error in notifyEmployeeForAssistance:', error);
                        toolOutputs.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({ error: error.message })
                        });
                    }
                    break;
        }
    }
    return toolOutputs;
}
async function checkAvailableTimeSlots(phoneNumber, idSubstring, requestedDate = null) {
    try {
        // Get the assigned employee first
        const assignedEmployee = await getAssignedEmployee(phoneNumber, idSubstring);
        if (!assignedEmployee || !assignedEmployee.email) {
            throw new Error('No assigned employee found for this contact');
        }

        console.log(`Checking available slots for employee: ${assignedEmployee.name} (${assignedEmployee.email})`);

        // Get current date/time in Malaysia timezone
        const now = new Date();
        const availableSlots = [];
        const slotDuration = 30 * 60 * 1000; // 30 minutes in milliseconds
        
        let startDate;
        if (requestedDate) {
            // If a specific date is requested, use that date
            startDate = new Date(requestedDate);
            startDate.setHours(11, 0, 0, 0);
            
            // Check if requested date is at least 1 days in the future
            const minDate = new Date(now);
            minDate.setDate(now.getDate() + 1);
            if (startDate < minDate) {
                return `I apologize, but appointments must be scheduled at least 1 day in advance. The earliest available date would be ${minDate.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                })}.`;
            }
        } else {
            // Start checking from 1 days after current date
            startDate = new Date(now);
            startDate.setDate(now.getDate() + 1);
            startDate.setHours(11, 0, 0, 0);
        }

        // If it's a weekend, move to next business day
        while (startDate.getDay() === 0 || startDate.getDay() === 6) {
            startDate.setDate(startDate.getDate() + 1);
        }

        // Check slots for the specific date or next 5 business days
        let daysToCheck = requestedDate ? 1 : 5;
        let daysChecked = 0;
        let currentDate = new Date(startDate);

        while (daysChecked < daysToCheck) {
            // Skip weekends
            if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
                currentDate.setDate(currentDate.getDate() + 1);
                continue;
            }

            // Check slots between 11 AM and 5 PM
            for (let hour = 11; hour < 17 && availableSlots.length < 3; hour++) {
                for (let minute of [0, 30]) {
                    if (availableSlots.length >= 3) break;

                    const slotStart = new Date(currentDate);
                    slotStart.setHours(hour, minute, 0, 0);
                    const slotEnd = new Date(slotStart.getTime() + slotDuration);

                    // Get all appointments for this employee on this day
                    const userRef = db.collection('user').doc(assignedEmployee.email);
                    const appointmentsRef = userRef.collection('appointments');
                    
                    // Query for conflicting appointments
                    const conflictingAppointments = await appointmentsRef
                        .where('startTime', '<', slotEnd.getTime())
                        .where('endTime', '>', slotStart.getTime())
                        .get();

                    if (conflictingAppointments.empty) {
                        const formattedDate = slotStart.toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });

                        const formattedStartTime = slotStart.toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                        });

                        const formattedEndTime = slotEnd.toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                        });

                        availableSlots.push({
                            date: formattedDate,
                            time: `${formattedStartTime} - ${formattedEndTime}`,
                            startDateTime: slotStart.toISOString(),
                            endDateTime: slotEnd.toISOString(),
                            employeeName: assignedEmployee.name,
                            employeeEmail: assignedEmployee.email
                        });
                    }
                }
            }

            currentDate.setDate(currentDate.getDate() + 1);
            daysChecked++;
        }

        if (availableSlots.length === 0) {
            if (requestedDate) {
                return `No available time slots for ${assignedEmployee.name} on ${startDate.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                })}. Would you like to check another date?`;
            }
            return `No available time slots for ${assignedEmployee.name} in the next few days.`;
        }

        // Format the response for better readability
        const formattedResponse = availableSlots.map((slot, index) => ({
            option: index + 1,
            date: slot.date,
            time: slot.time,
            startDateTime: slot.startDateTime,
            endDateTime: slot.endDateTime,
            employeeName: slot.employeeName
        }));

        return formattedResponse;

    } catch (error) {
        console.error('Error checking available time slots:', error);
        throw error;
    }
}

async function waitForNotificationCompletion(threadId, runId, depth = 0) {
    const maxDepth = 5;
    const maxAttempts = 30;
    const pollingInterval = 2000;

    console.log(`Waiting for notification completion (depth: ${depth}, runId: ${runId})...`);

    if (depth >= maxDepth) {
        console.error(`Max recursion depth reached for notification runId: ${runId}`);
        return "Error: Maximum recursion depth reached while generating notification.";
    }

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
        try {
            const runObject = await openai.beta.threads.runs.retrieve(threadId, runId);
            console.log(`Notification run status: ${runObject.status} (attempt ${attempts + 1})`);

            if (runObject.status === 'completed') {
                const messagesList = await openai.beta.threads.messages.list(threadId);
                const notificationMessage = messagesList.data[0].content[0].text.value;
                return notificationMessage;
            } else if (runObject.status === 'requires_action') {
                console.log('Notification generation requires action...');
                try {
                    const toolCalls = runObject.required_action.submit_tool_outputs.tool_calls;
                    const toolOutputs = toolCalls.map(toolCall => ({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ status: "notification_generation_completed" })
                    }));

                    await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
                        tool_outputs: toolOutputs
                    });
                } catch (toolError) {
                    if (toolError.message?.includes('Runs in status "completed"')) {
                        const messagesList = await openai.beta.threads.messages.list(threadId);
                        const notificationMessage = messagesList.data[0].content[0].text.value;
                        return notificationMessage;
                    }
                    throw toolError;
                }
                return await waitForNotificationCompletion(threadId, runId, depth + 1);
            } else if (['failed', 'cancelled', 'expired'].includes(runObject.status)) {
                console.error(`Notification generation ${runId} ended with status: ${runObject.status}`);
                return `Error generating notification: ${runObject.status}`;
            }

            await new Promise(resolve => setTimeout(resolve, pollingInterval));
        } catch (error) {
            if (error.message?.includes('Runs in status "completed"')) {
                try {
                    const messagesList = await openai.beta.threads.messages.list(threadId);
                    const notificationMessage = messagesList.data[0].content[0].text.value;
                    return notificationMessage;
                } catch (msgError) {
                    console.error('Error fetching final message:', msgError);
                }
            }
            console.error(`Error in notification generation (depth: ${depth}, runId: ${runId}):`, error);
            return `Error generating notification: ${error.message}`;
        }
    }

    console.error(`Timeout: Notification generation did not complete in time (depth: ${depth}, runId: ${runId})`);
    return "Error: Notification generation timed out. Please try again.";
}
async function waitForCompletion(threadId, runId, idSubstring, client, depth = 0, phoneNumber, name, threadID, phoneIndex) {
    const maxDepth = 5; // Maximum recursion depth
    const maxAttempts = 30;
    const pollingInterval = 2000; // 2 seconds
  
    console.log(`Waiting for completion (depth: ${depth}, runId: ${runId})...`);
  
    if (depth >= maxDepth) {
        console.error(`Max recursion depth reached for runId: ${runId}`);
        return "I apologize, but I'm having trouble completing this task. Could you please try rephrasing your request?";
    }
  
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
        try {
            const runObject = await openai.beta.threads.runs.retrieve(threadId, runId);
            console.log(`Run status: ${runObject.status} (attempt ${attempts + 1})`);
  
            if (runObject.status === 'completed') {
                const messagesList = await openai.beta.threads.messages.list(threadId);
                const latestMessage = messagesList.data[0].content[0].text.value;
                return latestMessage;
            } else if (runObject.status === 'requires_action') {
                console.log('Run requires action, handling tool calls...');
                try {
                    const toolCalls = runObject.required_action.submit_tool_outputs.tool_calls;
                    const toolOutputs = await handleToolCalls(toolCalls, idSubstring, client, phoneNumber, name, threadID, phoneIndex);
                    console.log('Submitting tool outputs...');
                    await openai.beta.threads.runs.submitToolOutputs(threadId, runId, { tool_outputs: toolOutputs });
                    console.log('Tool outputs submitted, restarting wait for completion...');
                } catch (toolError) {
                    // If we get a "completed" status error, proceed to get the latest message
                    if (toolError.message?.includes('Runs in status "completed"')) {
                        console.log('Run completed while processing tools, fetching final message...');
                        const messagesList = await openai.beta.threads.messages.list(threadId);
                        const latestMessage = messagesList.data[0].content[0].text.value;
                        return latestMessage;
                    }
                    throw toolError;
                }
                return await waitForCompletion(threadId, runId, idSubstring, client, depth + 1, phoneNumber, name, threadID, phoneIndex);
            } else if (['failed', 'cancelled', 'expired'].includes(runObject.status)) {
                console.error(`Run ${runId} ended with status: ${runObject.status}`);
                return `I encountered an error (${runObject.status}). Please try your request again.`;
            }
  
            await new Promise(resolve => setTimeout(resolve, pollingInterval));
        } catch (error) {
            console.error(`Error in waitForCompletion (depth: ${depth}, runId: ${runId}): ${error}`);
            // If the error is about completed status, try to get the latest message
            if (error.message?.includes('Runs in status "completed"')) {
                try {
                    const messagesList = await openai.beta.threads.messages.list(threadId);
                    const latestMessage = messagesList.data[0].content[0].text.value;
                    return latestMessage;
                } catch (msgError) {
                    console.error('Error fetching final message:', msgError);
                }
            }
            // Only return error message if we couldn't recover
            return "I'm sorry, but I encountered an error while processing your request. Please try again.";
        }
    }
  
    console.error(`Timeout: Assistant did not complete in time (depth: ${depth}, runId: ${runId})`);
    return "I'm sorry, but it's taking longer than expected to process your request. Please try again or rephrase your question.";
}
async function runAssistant(assistantID, threadId, tools, idSubstring, client, phoneNumber, name,threadID,phoneIndex) {
    console.log('Running assistant for thread: ' + threadId);
    const response = await openai.beta.threads.runs.create(
        threadId,
        {
            assistant_id: assistantID,
            tools: tools
        }
    );

    const runId = response.id;
    const answer = await waitForCompletion(threadId, runId, idSubstring, client, 0, phoneNumber, name,threadID,phoneIndex);
    return answer;
}
async function generateOnboardingReport(threadID, assistantId, phoneNumber, contact) {
    try {
        const currentDate = new Date().toISOString().split('T')[0];
        let reportInstruction;

        // Different report formats based on phoneIndex
        switch (contact.phoneIndex) {
            case 0: // Revotrend
                reportInstruction = `Please generate a report in the following format based on our conversation and the contact data ${contact}:

Revotrend New Lead Onboarding Summary

1. Customer Name: [Extract from conversation] or ${contact.contactName}
2. Contact Number: ${phoneNumber}
3. Selected Service: [Extract from conversation]
4. Sub-Service (if applicable): [Extract from conversation]

For RevoSpace/RevoScan/RevoStroy:
1. Business Name Card: [Extract if provided]
2. Appointment Date & Time: [Extract scheduled time]
3. Meeting Address: [Extract meeting location]

Additional Notes: [Extract any relevant additional information]`;
                break;

            case 1: // StoreGuru
            case 3: // StoreGuru
                reportInstruction = `Please generate a report in the following format based on our conversation and the contact data ${contact}:

StoreGuru New Lead Onboarding Summary

1. Customer Name: [Extract from conversation] or ${contact.contactName}
2. Contact Number: ${phoneNumber}
3. Storage Type: [Extract Personal/Business Storage]
4. Item Category: [Extract items to be stored]
5. Storage Size: [Extract size requirement]
6. Move-In Timeline: [Extract timeline]
7. Storage Duration: [Extract duration]
8. Transportation Required: [Extract Yes/No]
9. Floor Level (if transport needed): [Extract floor level]
10. Pick-up Address (if transport needed): [Extract address]
11. Preferred Storage Location: [Extract location preference]

Additional Notes: [Extract any relevant additional information]`;
                break;

            case 2: // ShipGuru
                reportInstruction = `Please generate a report in the following format based on our conversation and the contact data ${contact}:

ShipGuru New Lead Onboarding Summary

1. Customer Name: [Extract from conversation] or ${contact.contactName}
2. Contact Number: ${phoneNumber}
3. Fulfillment Type: [Extract B2B/B2C]
4. Items for Storage: [Extract items]
5. Number of SKUs: [Extract SKU count]
6. Quantities: [Extract quantities]
7. Current Inventory Management: [Extract current method]
8. Orders per Day/Month: [Extract order volume]
9. Special Packaging Requirements: [Extract if any]
10. Marketplaces/Websites: [Extract selling platforms]
11. Service Start Timeline: [Extract timeline]
12. Estimated Storage Space: [Extract space requirement]
13. Preferred Storage Location: [Extract location]
14. Business Name Card: [Extract if provided]
15. Consultation Session Details: [Extract appointment details if scheduled]

Additional Notes: [Extract any relevant additional information]`;
                break;

            default:
                throw new Error('Invalid phoneIndex');
        }

        // Send the instruction to the thread
        await openai.beta.threads.messages.create(threadID, {
            role: "user",
            content: reportInstruction
        });

        // Create a new run for the report
        const run = await openai.beta.threads.runs.create(threadID, {
            assistant_id: assistantId
        });

        // Use waitForReportCompletion to handle the response
        const reportMessage = await waitForReportCompletion(threadID, run.id);
        return reportMessage;
    } catch (error) {
        console.error('Error generating onboarding report:', error);
        return 'Error generating report';
    }
}
const extractServiceType = (report, phoneIndex) => {
    let serviceTag = '';
    
    switch(phoneIndex) {
        case 0: // Revotrend
            // Look for "Selected Service:" or "Sub-Service:"
            const revoMatch = report.match(/(?:Selected Service|Sub-Service):\s*([^\n]+)/i);
            if (revoMatch) {
                const service = revoMatch[1].trim().toLowerCase();
                if (service.includes('revospace')) serviceTag = 'RSP';
                else if (service.includes('revoscan')) serviceTag = 'RSC';
                else if (service.includes('revostroy')) serviceTag = 'RST';
            }
            break;
            
        case 1: // StoreGuru
        case 3:
            // Look for "Storage Type:"
            const storageMatch = report.match(/Storage Type:\s*([^\n]+)/i);
            if (storageMatch) {
                const storageType = storageMatch[1].trim().toLowerCase();
                if (storageType.includes('personal')) serviceTag = 'PS';
                else if (storageType.includes('business')) serviceTag = 'BS';
            }
            break;
            
        case 2: // ShipGuru
            // Look for "Fulfillment Type:"
            const fulfillmentMatch = report.match(/Fulfillment Type:\s*([^\n]+)/i);
            if (fulfillmentMatch) {
                const fulfillmentType = fulfillmentMatch[1].trim().toLowerCase();
                if (fulfillmentType.includes('b2b')) serviceTag = 'B2B';
                else if (fulfillmentType.includes('b2c')) serviceTag = 'B2C';
            }
            break;
    }
    
    return serviceTag || 'other';
};

async function waitForReportCompletion(threadId, runId, depth = 0) {
    const maxDepth = 5;
    const maxAttempts = 30;
    const pollingInterval = 2000;

    console.log(`Waiting for report completion (depth: ${depth}, runId: ${runId})...`);

    if (depth >= maxDepth) {
        console.error(`Max recursion depth reached for report runId: ${runId}`);
        return "Error: Maximum recursion depth reached while generating report.";
    }

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
        try {
            const runObject = await openai.beta.threads.runs.retrieve(threadId, runId);
            console.log(`Report run status: ${runObject.status} (attempt ${attempts + 1})`);

            if (runObject.status === 'completed') {
                const messagesList = await openai.beta.threads.messages.list(threadId);
                const reportMessage = messagesList.data[0].content[0].text.value;
                return reportMessage;
            } else if (runObject.status === 'requires_action') {
                console.log('Report generation requires action...');
                try {
                    const toolCalls = runObject.required_action.submit_tool_outputs.tool_calls;
                    const toolOutputs = toolCalls.map(toolCall => ({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ status: "report_generation_completed" })
                    }));

                    await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
                        tool_outputs: toolOutputs
                    });
                } catch (toolError) {
                    // If run is already completed, try to get the message
                    if (toolError.message?.includes('Runs in status "completed"')) {
                        const messagesList = await openai.beta.threads.messages.list(threadId);
                        const reportMessage = messagesList.data[0].content[0].text.value;
                        return reportMessage;
                    }
                    throw toolError;
                }
                return await waitForReportCompletion(threadId, runId, depth + 1);
            } else if (['failed', 'cancelled', 'expired'].includes(runObject.status)) {
                console.error(`Report generation ${runId} ended with status: ${runObject.status}`);
                return `Error generating report: ${runObject.status}`;
            }
            await new Promise(resolve => setTimeout(resolve, pollingInterval));
        } catch (error) {
            // If run is completed, try to get the message
            if (error.message?.includes('Runs in status "completed"')) {
                try {
                    const messagesList = await openai.beta.threads.messages.list(threadId);
                    const reportMessage = messagesList.data[0].content[0].text.value;
                    return reportMessage;
                } catch (msgError) {
                    console.error('Error fetching final message:', msgError);
                }
            }
            console.error(`Error in report generation (depth: ${depth}, runId: ${runId}):`, error);
            return `Error generating report: ${error.message}`;
        }
    }}
async function updateMessageUsage(idSubstring) {
    try {
        // Get current date
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const collectionName = `${year}-${month}`;

        // Reference to the usage document
        const usageRef = db.collection('companies')
            .doc(idSubstring)
            .collection('usage')
            .doc(collectionName);

        // Try to update the document
        const result = await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(usageRef);

            if (!doc.exists) {
                // Create new document if it doesn't exist
                transaction.set(usageRef, {
                    total_messages: 1,
                    month: collectionName
                });
                return 1;
            } else {
                // Update existing document
                const newTotal = (doc.data().total_messages || 0) + 1;
                transaction.update(usageRef, { total_messages: newTotal });
                return newTotal;
            }
        });

        console.log(`Updated message count for ${collectionName}: ${result}`);
    } catch (error) {
        console.error('Error updating message usage:', error);
    }
}
async function handleOpenAIAssistant(message, threadID, tags, phoneNumber, idSubstring, client,name,phoneIndex) {
    console.log(ghlConfig.assistantId);
    const assistantId = phoneIndex === 0 ? ghlConfig.assistantId : 
    (phoneIndex === 1 || phoneIndex === 3) ? ghlConfig.assistantId2 : 
    ghlConfig.assistantId3;
    await addMessage(threadID, message);
    await updateMessageUsage(idSubstring);
    const tools = [
        {
            type: "function",
            function: {
                name: "checkAvailableTimeSlots",
                description: "Check for available consultation time slots. Returns three available 30-minute slots. Can check specific dates if requested by the user. Slots are only available during business hours (11 AM - 5 PM) and exclude weekends. Appointments must be scheduled at least 1 day in advance.",
                parameters: {
                    type: "object",
                    properties: {
                        requestedDate: {
                            type: "string",
                            description: "Optional. ISO date string for a specific date to check availability. If not provided, will show next available slots."
                        }
                    },
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "createCalendarEvent",
                description: "Create a calendar appointment when a customer wants to schedule a meeting or consultation",
                parameters: {
                    type: "object",
                    properties: {
                        summary: {
                            type: "string",
                            description: "Title or purpose of the appointment"
                        },
                        description: {
                            type: "string",
                            description: "Additional details including meeting location or notes"
                        },
                        startDateTime: {
                            type: "string",
                            description: "Start time of the appointment in ISO format"
                        },
                        contactName: {
                            type: "string",
                            description: "Name of the customer"
                        },
                        companyName: {
                            type: "string",
                            description: "Name of the company"
                        }
                    },
                    required: ["summary", "startDateTime", "contactName"]
                }
            }
        },
       /* {
            type: "function",
            function: {
                name: "generateOnboardingReport",
                description: "Generate and send an onboarding report when a customer provides all necessary information or confirms an appointment",
                parameters: {
                    type: "object",
                    properties: {
                        customerName: {
                            type: "string",
                            description: "Name of the customer"
                        },
                        customerPhone: {
                            type: "string",
                            description: "Phone number of the customer"
                        },
                        serviceType: {
                            type: "string",
                            description: "Type of service requested (RevoSpace/RevoScan/RevoStroy for Revotrend, Personal/Business Storage for StoreGuru, B2B/B2C for ShipGuru)"
                        }
                    },
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "notifyEmployeeForAssistance",
                description: "Notify assigned employee when AI cannot answer a question or when customer requests to speak with a human. Should be called when detecting complex queries, specific pricing requests, or call requests.",
                parameters: {
                    type: "object",
                    properties: {
                        customerName: {
                            type: "string",
                            description: "Name of the customer"
                        },
                        customerPhone: {
                            type: "string",
                            description: "Phone number of the customer"
                        },
                        requestType: {
                            type: "string",
                            enum: ["call_request", "complex_query"],
                            description: "Type of assistance needed"
                        },
                        query: {
                            type: "string",
                            description: "The customer's question or request that needs human assistance"
                        }
                    },
                    required: []
                }
            }
        }*/
    ];

    const answer = await runAssistant(assistantId, threadID, tools, idSubstring, client, phoneNumber, name,threadID,phoneIndex);
    return answer;
}

async function sendWhapiRequest(endpoint, params = {}, method = 'POST') {
    console.log('Sending request to Whapi.Cloud...');
    const options = {
        method: method,
        headers: {
            Authorization: `Bearer ${ghlConfig.whapiToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
    };
    const url = `https://gate.whapi.cloud/${endpoint}`;
    const response = await fetch(url, options);
    const jsonResponse = await response.json();
    return jsonResponse;
}


async function saveThreadIDGHL(contactID,threadID){
    const options = {
        method: 'PUT',
        url: `https://services.leadconnectorhq.com/contacts/${contactID}`,
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        data: {
            customFields: [
                {key: 'threadid', field_value: threadID}
            ],
        }
    };

    try {
        await axios.request(options);
    } catch (error) {
        console.error(error);
    }
}

async function saveThreadIDFirebase(contactID, threadID, idSubstring,phoneIndex) {
    
    // Construct the Firestore document path
    const docPath = `companies/${idSubstring}/contacts/${contactID}`;
if(phoneIndex === 0){
    try {
        await db.doc(docPath).set({
            threadid: threadID
        }, { merge: true }); // merge: true ensures we don't overwrite the document, just update it
        console.log(`Thread ID saved to Firestore at ${docPath}`);
    } catch (error) {
            console.error('Error saving Thread ID to Firestore:', error);
        }
        }else if(phoneIndex === 1 || phoneIndex === 3){
            try {
                await db.doc(docPath).set({
                    threadid2: threadID
                }, { merge: true }); // merge: true ensures we don't overwrite the document, just update it
            } catch (error) {
                console.error('Error saving Thread ID to Firestore:', error);
            }
        }else if(phoneIndex === 2){
            try {
                await db.doc(docPath).set({
                    threadid3: threadID
                }, { merge: true }); // merge: true ensures we don't overwrite the document, just update it
            } catch (error) {
                console.error('Error saving Thread ID to Firestore:', error);
            }
        }
}

async function createContact(name,number){
    const options = {
        method: 'POST',
        url: 'https://services.leadconnectorhq.com/contacts/',
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        data: {
            firstName: name,
            name: name,
            locationId: ghlConfig.ghl_location,
            phone: number,
        }
    };

    try {
        await axios.request(options);
    } catch (error) {
        console.error(error);
    }
}

async function getContact(number) {
    const options = {
        method: 'GET',
        url: 'https://services.leadconnectorhq.com/contacts/search/duplicate',
        params: {
            locationId: ghlConfig.ghl_location,
            number: number
        },
        headers: {
          Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
          Version: '2021-07-28',
          Accept: 'application/json'
        }
    };
  
    try {
      const response = await axios.request(options);
      return(response.data.contact);
    } catch (error) {
        console.error(error);
    }
}


async function fetchConfigFromDatabase(idSubstring) {
    try {
        const docRef = db.collection('companies').doc(idSubstring);
        const doc = await docRef.get();
        if (!doc.exists) {
            console.log('No such document!');
            return;
        }
        ghlConfig = doc.data();
        console.log(ghlConfig);
    } catch (error) {
        console.error('Error fetching config:', error);
        throw error;
    }
}

// Constants for assignment tracking
const BATCH_SIZE = 10;
const RESET_THRESHOLD = 100;
let assignmentCounts = {};
let totalAssignments = 0;

async function loadAssignmentCounts(idSubstring) {
    try {
        const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentCounts');
        const doc = await stateRef.get();
        if (doc.exists) {
            const data = doc.data();
            assignmentCounts = data.counts || {};
            totalAssignments = data.totalAssignments || 0;
            console.log('Assignment counts loaded from Firebase:', { assignmentCounts, totalAssignments });
        } else {
            console.log('No previous assignment counts found');
            assignmentCounts = {};
            totalAssignments = 0;
        }
    } catch (error) {
        console.error('Error loading assignment counts:', error);
        assignmentCounts = {};
        totalAssignments = 0;
    }
}

async function storeAssignmentCounts(idSubstring) {
    try {
        const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentCounts');
        const stateToStore = {
            counts: assignmentCounts,
            totalAssignments: totalAssignments,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        };

        await stateRef.set(stateToStore);
        console.log('Assignment counts stored in Firebase:', stateToStore);
    } catch (error) {
        console.error('Error storing assignment counts:', error);
    }
}

// Function to check for scheduling conflicts in Firebase
async function checkScheduleConflicts(startDateTime, endDateTime, employeeEmail) {
    try {
        console.log('Checking for scheduling conflicts...');
        
        // Convert input to timestamps
        const startTimestamp = new Date(startDateTime).getTime();
        const endTimestamp = new Date(endDateTime).getTime();
        
        // Reference to appointments collection using the employee's email
        const userRef = db.collection('user').doc(employeeEmail);
        const appointmentsCollectionRef = userRef.collection('appointments');
        
        // Query for overlapping appointments
        const conflictingAppointments = await appointmentsCollectionRef
            .where('startTime', '>', startTimestamp)
            .where('startTime', '<', endTimestamp)
            .get();

        if (!conflictingAppointments.empty) {
            console.log('Found conflicting appointments');
            const conflicts = conflictingAppointments.docs.map(doc => ({
                id: doc.id,
                title: doc.data().title,
                startTime: doc.data().startTime,
                endTime: doc.data().endTime,
                address: doc.data().address || "",
                staff: doc.data().staff || []
            }));

            return {
                conflict: true,
                conflictingAppointments: conflicts
            };
        }

        console.log('No conflicts found');
        return {
            conflict: false,
            conflictingAppointments: []
        };
    } catch (error) {
        console.error('Error checking for scheduling conflicts:', error);
        return { 
            conflict: true, 
            error: error.message 
        };
    }
}

// Function to get assigned employee from contact's tags
async function getAssignedEmployee(phoneNumber, idSubstring) {
    try {
        // Get contact data to find tags
        const contactData = await getContactDataFromDatabaseByPhone(phoneNumber, idSubstring);
        if (!contactData || !contactData.tags) {
            throw new Error('No contact data or tags found');
        }

        // Get all employees from the company
        const employeesRef = db.collection('companies').doc(idSubstring).collection('employee');
        const employeesSnapshot = await employeesRef.get();
        
        // Find the employee whose name matches one of the contact's tags
        let assignedEmployee = null;
        employeesSnapshot.forEach(doc => {
            const employeeData = doc.data();
            if (contactData.tags.includes(employeeData.name)) {
                assignedEmployee = employeeData;
            }
        });

        if (!assignedEmployee) {
            throw new Error('No assigned employee found');
        }

        return assignedEmployee;

    } catch (error) {
        console.error('Error getting assigned employee:', error);
        throw error;
    }
}

// Function to create calendar event
async function createCalendarEvent(summary, description, startDateTime, endDateTime, phoneNumber, contactName, companyName, idSubstring) {
    try {
        console.log('Creating appointment with params:', { 
            summary, description, startDateTime, endDateTime, phoneNumber, contactName, companyName 
        });

        // Get assigned employee
        const assignedEmployee = await getAssignedEmployee(phoneNumber, idSubstring);
        if (!assignedEmployee || !assignedEmployee.email) {
            throw new Error('No assigned employee email found');
        }

        // Add initial tags
        await addtagbookedFirebase(phoneNumber, 'Booked Appointment', idSubstring);
        // Ensure 30-minute duration
        const start = new Date(startDateTime);
        const end = new Date(start.getTime() + (30 * 60 * 1000));

        // Check for conflicts using assigned employee's email
        const conflictCheck = await checkScheduleConflicts(
            startDateTime, 
            end.toISOString(),
            assignedEmployee.email
        );

        if (conflictCheck.conflict) {
            return {
                error: 'Scheduling conflict detected',
                conflictingAppointments: conflictCheck.conflictingAppointments
            };
        }

        // Create appointment in Firebase using the assigned employee's email
        console.log('Creating appointment in Firebase...');
        const userRef = db.collection('user').doc(assignedEmployee.email);
        const appointmentsCollectionRef = userRef.collection('appointments');
        
        const newAppointment = {
            id: appointmentDoc.id, // Using Firestore generated ID instead of uuidv4
            title: summary,  // Remove the "- companyName" part
            startTime: start.toISOString(), // Store as ISO string instead of timestamp
            endTime: end.toISOString(),     // Store as ISO string instead of timestamp
            address: "",  // Empty string as default
            appointmentStatus: "new",
            color: "#33FF8C",  // Updated color code
            packageId: null,   // Changed from empty string to null
            dateAdded: new Date().toISOString(),
            contacts: phoneNumber && contactName ? [{
                id: phoneNumber,
                name: contactName,
                session: null
            }] : [],
            staff: [assignedEmployee.email], // Store email instead of name
            tags: []  // Added empty tags array
        };
        

        const appointmentDoc = await appointmentsCollectionRef.add(newAppointment);
        console.log('Appointment created successfully:', appointmentDoc.id);

        // Format response
        const startDate = start.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        const startTime = start.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const endTime = end.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });

        return {
            success: true,
            message: 'Appointment created successfully',
            appointmentDetails: {
                id: appointmentDoc.id,
                title: newAppointment.title,
                date: startDate,
                time: `${startTime} - ${endTime}`,
                description: description,
                contact: `${contactName || 'Unknown'} (${phoneNumber || 'No phone number'})`,
                staff: assignedEmployee.name
            }
        };

    } catch (error) {
        console.error('Error in createCalendarEvent:', error);
        return { 
            error: `Failed to create appointment: ${error.message}` 
        };
    }
}

module.exports = { handleNewMessagesRevotrend };

