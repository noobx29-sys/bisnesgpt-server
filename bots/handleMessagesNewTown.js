// handleMessagesTemplateWweb.js

//STEP BY STEP GUIDE
//1. CHANGE all handleMessagesTemplate to -> handleMessages<YourBotName>
//2. CHANGE all idSubstring to firebase collection name
//3. CHANGE all <assistant> to openai assistant id
//4. CHANGE all Template to your <YourBotName>

const OpenAI = require('openai');
const axios = require('axios').default;
const { Client } = require('whatsapp-web.js');
const { MessageMedia } = require('whatsapp-web.js');
const { v4: uuidv4 } = require('uuid');
const FormData = require('form-data');
const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();
const path = require('path');
const fs = require('fs');
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
        if (data.name) {
            employees.push({
                name: data.name,
                email: data.email,
                phoneNumber: data.phoneNumber,
                assignedContacts: data.assignedContacts || 0,
                group: data.group
            });
        }
    });

    console.log('Fetched employees:', employees);
    await loadAssignmentState(idSubstring);
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

async function assignNewContactToEmployee(contactID, idSubstring, client, contactName) {
    if (employees.length === 0) {
        await fetchEmployeesFromFirebase(idSubstring);
    }

    if (employees.length === 0) {
        console.log('No employees found for assignment');
        return [];
    }
    
    let assignedEmployee = employees[currentEmployeeIndex];
    currentEmployeeIndex = (currentEmployeeIndex + 1) % employees.length;

    console.log(`Assigned employee: ${assignedEmployee.name}`);

    const tags = [assignedEmployee.name, assignedEmployee.phoneNumber];
    const employeeID = assignedEmployee.phoneNumber.split('+')[1] + '@c.us';
    
    // Fetch the contact data from Firebase to ensure we have the most up-to-date information
    const contactData = await getContactDataFromDatabaseByPhone(contactID, idSubstring);
    const updatedContactName = contactData?.contactName || contactName || 'Not provided';

    await client.sendMessage(employeeID, `Hello ${assignedEmployee?.name || 'Employee'}, a new contact has been assigned to you:

Name: ${updatedContactName}
Phone: ${contactID}

Kindly login to https://web.jutasoftware.co/login

Thank you.

Juta Teknologi`);
    await addtagbookedFirebase(contactID, assignedEmployee.name, idSubstring);

    if(assignedEmployee.group){
        await fetchSalesFromFirebase(idSubstring, assignedEmployee.group);
    } else {
        console.log('No group assigned to the employee');
        return tags;
    }
    
    let availableEmployees = sales.filter(emp => emp.weightage > 0);

    if (availableEmployees.length === 0) {
        console.log('No available sales employees found. Assigning to any employee.');
        availableEmployees = employees;
    }

    if (availableEmployees.length === 0) {
        console.log('No available employees found for assignment');
        return tags;
    }

    const totalWeight = availableEmployees.reduce((sum, emp) => sum + (emp.weightage || 1), 0);
    const randomValue = Math.random() * totalWeight;

    let cumulativeWeight = 0;
    let assignedSales = null;
   
    for (const emp of availableEmployees) {
        cumulativeWeight += emp.weightage || 1;
        if (randomValue <= cumulativeWeight) {
            assignedSales = emp;
            break;
        }
    }
    
    if (!assignedSales) {
        console.log('Failed to assign a sales employee');
        return tags;
    }

    console.log(`Assigned sales/employee: ${assignedSales.name}`);
    await addtagbookedFirebase(contactID, assignedSales.name, idSubstring);
    const salesID = assignedSales.phoneNumber.replace(/\s+/g, '').split('+')[1] + '@c.us';

    await client.sendMessage(salesID, `Hello ${assignedSales?.name || 'Employee'}, a new contact has been assigned to you:

Name: ${updatedContactName}
Phone: ${contactID}

Kindly login to https://web.jutasoftware.co/login

Thank you.

Juta Teknologi`);

    tags.push(assignedSales.name, assignedSales.phoneNumber);

    await storeAssignmentState(idSubstring);

    return tags;
}
async function addtagbookedFirebase(contactID, tag, idSubstring) {
    console.log(`Adding tag "${tag}" to Firebase for contact ${contactID}`);
    const docPath = `companies/${idSubstring}/contacts/${contactID}`;
    const contactRef = db.doc(docPath);

    try {
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(contactRef);
            if (!doc.exists) {
                throw new Error("Contact document does not exist!");
            }

            let currentTags = doc.data().tags || [];
            if (!currentTags.includes(tag)) {
                currentTags.push(tag);
                transaction.update(contactRef, { tags: currentTags });
                console.log(`Tag "${tag}" added successfully to contact ${contactID}`);
            } else {
                console.log(`Tag "${tag}" already exists for contact ${contactID}`);
            }
        });
    } catch (error) {
        console.error('Error adding tag to Firebase:', error);
    }
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
            topic: companyId // Specify the topic here
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


async function addMessagetoFirebase(msg, idSubstring, extractedNumber, contactName){
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
  //  await addNotificationToUser(idSubstring, messageData, contactName);
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
        // Create temporary file
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }
        const tempFilePath = path.join(tempDir, `temp_${Date.now()}.ogg`);
        
        // Write audio data to temp file
        fs.writeFileSync(tempFilePath, Buffer.from(audioData, 'base64'));
        
        // Create form data
        const form = new FormData();
        form.append('file', fs.createReadStream(tempFilePath));
        form.append('model', 'whisper-1');
        form.append('response_format', 'json');

        // Make the API request
        const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${process.env.OPENAIKEY}`,
            },
            maxBodyLength: Infinity,
        });

        // Clean up temp file
        fs.unlinkSync(tempFilePath);

        return response.data.text;
    } catch (error) {
        console.error('Error transcribing audio:', error);
        // Ensure temp file is cleaned up even if there's an error
        try {
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        } catch (cleanupError) {
            console.error('Error cleaning up temp file:', cleanupError);
        }
        return '';
    }
}

const MESSAGE_BUFFER_TIME = 1000; // 1 minute in milliseconds
const messageBuffers = new Map();

async function handleNewMessagesNewTown(client, msg, botName, phoneIndex) {
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
             
                 if (contactData.threadid) {
                     threadID = contactData.threadid;
                 } else {
                     const thread = await createThread();
                     threadID = thread.id;
                     await saveThreadIDFirebase(contactID, threadID, idSubstring)
                 }
             } else {
                 contactID = extractedNumber;
                 contactName = contactData.contactName ?? msg.pushname ?? extractedNumber;
                 if (contactData.threadid) {
                     threadID = contactData.threadid;
                 } else {
                     const thread = await createThread();
                     threadID = thread.id;
                     await saveThreadIDFirebase(contactID, threadID, idSubstring)
                 } 
             }
         } else {
             await customWait(2500); 
 
             contactID = extractedNumber;
             contactName = contact.pushname || contact.name || extractedNumber;
 
             const thread = await createThread();
             threadID = thread.id;
             console.log(threadID);
             await saveThreadIDFirebase(contactID, threadID, idSubstring)
             console.log('sent new contact to create new contact');
         }   
         if (msg.fromMe){
            await handleOpenAIMyMessage(msg.body,threadID);
            return;
        }
         let firebaseTags = ['']
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
             threadid: threadID ?? "",
             phoneIndex: phoneIndex,
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
             phoneIndex: phoneIndex,
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
            await saveThreadIDFirebase(contactID, threadID, idSubstring)
            client.sendMessage(msg.from, 'Bot is now restarting with new thread.');
            return;
        }

        //test bot command
        if (msg.body.includes('/hello')) {
            client.sendMessage(msg.from, 'tested.');
            try {
                // Read the image file
                const imageBuffer = fs.readFileSync('./media/juta/juta.png');
                const base64Image = imageBuffer.toString('base64');
        
                // Create a MessageMedia instance for the product image
                const product = new MessageMedia('image/jpeg', base64Image, 'product.jpg');
        
                // Send the product message
                await client.sendMessage(msg.from, product, {
                    caption: 'View this item on WhatsApp: https://wa.me/p/24571882625791055/60189688525\n\nAI Automation System\n\nAutomate Your Business Using A.I On WhatsApp\n\nCustom Automations Integrations\nAutomated Texts (WhatsApp, SMS)\nAutomated Appointment Setter\nAutomated Social Media Messaging\nAnalytics Tools\nMobile App Version\n\nPrice: MYR 688/month\n\nFor more info: https://jutasoftware.co/',
                    sendMediaAsSticker: false,
                    sendAudioAsVoice: false,
                    sendVideoAsGif: false,
                    isViewOnce: false,
                    productId: '24571882625791055',
                    businessOwnerJid: '60189688525@s.whatsapp.net',
                    title: 'AI Automation System',
                    description: 'Automate Your Business Using A.I On WhatsApp',
                    currencyCode: 'MYR',
                    priceAmount1000: 5000000,
                    productImageCount: 1,
                    url: 'https://jutasoftware.co/'
                });
        
                console.log('Product message sent successfully');
            } catch (error) {
                console.error('Error sending product message:', error);
            }
        
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

async function processMessage(client, msg, botName, phoneIndex, combinedMessage) {
    console.log('Processing buffered messages for ' + botName);

    const idSubstring = botName;
    const chatId = msg.from;

    try {
        // Initial fetch of config
        await fetchConfigFromDatabase(idSubstring, phoneIndex);
        if (ghlConfig.stopbot) {
            if (ghlConfig.stopbot == true) {
                console.log('bot stop all');
                return;
            }
        }

        const sender = {
            to: msg.from,
            name: msg.notifyName,
        };

        const extractedNumber = '+' + (sender.to).split('@')[0];

        if (msg.fromMe) {
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
        let companyName;
        const chat = await msg.getChat();
        const contactData = await getContactDataFromDatabaseByPhone(extractedNumber, idSubstring);
        let unreadCount = 0;
        let stopTag = contactData?.tags || [];
        const contact = await chat.getContact();

        if (msg.fromMe) {
            if (stopTag.includes('idle')) {
            }
            return;
        }
        if (stopTag.includes('stop bot')) {
            console.log('Bot stopped for this message');
            return;
        }

        if (contactData.threadid) {
            threadID = contactData.threadid;
        } else {
            const thread = await createThread();
            threadID = thread.id;
            await saveThreadIDFirebase(contactID, threadID, idSubstring)
        }

        if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {
         
            console.log('Voice message detected');
            const media = await msg.downloadMedia();
            const transcription = await transcribeAudio(media.data);
            console.log('Transcription:', transcription);

            if (transcription && transcription.trim() !== '' && transcription !== 'Audio transcription failed. Please try again.') {
                messageBody = transcription;
            } else {
                messageBody = "[Voice message]"; // Default message if transcription fails or is empty
            }
            audioData = media.data;
            combinedMessage = messageBody;
            console.log(msg);
        } else {
        
        }
        chat.sendStateTyping();
        currentStep = userState.get(sender.to) || steps.START;
        switch (currentStep) {
            case steps.START:
                var context = "";
                const aiResponses = await getAIImageResponses(idSubstring);
                const aiVoiceResponses = await getAIVoiceResponses(idSubstring);
                const aiTagResponses = await getAITagResponses(idSubstring);
                const followUpTemplates = await getFollowUpTemplates(idSubstring);
                let templateFound = false;
                let imageFound = false;
                let voiceFound = false;
                let tagFound = false;

                query = `${combinedMessage}`;
               
                if (!tagFound) {
                    for (const response of aiTagResponses) {
                        if (response.keywordSource === "user" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
                            console.log('tags found for keywords:', response.keywords);
                            try {
                                // Remove any specified tags first
                                for (const tagToRemove of response.removeTags) {
                                    await addtagbookedFirebase(extractedNumber, tagToRemove, idSubstring, true);
                                }
                                
                                // Add new tags
                                for (const tag of response.tags) {
                                    await addtagbookedFirebase(extractedNumber, tag, idSubstring);
                                    console.log(`Added tag: ${tag} for number: ${extractedNumber}`);
                                }
                                tagFound = true;
                                return;
                            } catch (error) {
                                console.error(`Error handling tags for keywords ${response.keywords}:`, error);
                                continue;
                            }
                        }
                    }
                }
                
                if (!voiceFound) {
                    for (const response of aiVoiceResponses) {
                        if (response.keywordSource === "user" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
                            console.log('voice messages found for keywords:', response.keywords);
                            for (let i = 0; i < response.voiceUrls.length; i++) {
                                try {
                                    const caption = response.captions?.[i] || '';
                                    const voiceMessage = await sendVoiceMessage(client, msg.from, response.voiceUrls[i], caption);
                                    await addMessagetoFirebase(voiceMessage, idSubstring, extractedNumber, contactName);
                                    if (i < response.voiceUrls.length - 1) {
                                        await new Promise(resolve => setTimeout(resolve, 1000));
                                    }
                                } catch (error) {
                                    console.error(`Error sending voice message ${response.voiceUrls[i]}:`, error);
                                    continue;
                                }
                            }
                            voiceFound = true;
                            return;
                        }
                    }
                }
                
                if (!imageFound) {
                    for (const response of aiResponses) {
                        if (response.keywordSource === "user" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
                            console.log('images found for keywords:', response.keywords);
                            for (const imageUrl of response.imageUrls) {
                                try {
                                    const media = await MessageMedia.fromUrl(imageUrl);
                                    const imageMessage = await client.sendMessage(msg.from, media);
                                    await addMessagetoFirebase(imageMessage, idSubstring, extractedNumber, contactName);
                                } catch (error) {
                                    console.error(`Error sending image ${imageUrl}:`, error);
                                    continue;
                                }
                            }
                            imageFound = true;
                            return;
                        }
                    }
                }
                if (!(sender.to.includes('@g.us')) || (combinedMessage.toLowerCase().startsWith('@juta') && phoneIndex == 0)) {
                    answer = await handleOpenAIAssistant(query, threadID, stopTag, extractedNumber, idSubstring, client, contactData.contactName);
                    console.log(answer);
                    parts = answer.split(/\s*\|\|\s*/);

                    for (let i = 0; i < parts.length; i++) {
                        const part = parts[i].trim();
                        const check = part.toLowerCase();
                        if (part) {
                            if (part.includes('You sent this to the user:')) {
                                return;
                            }
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
                                };

                                const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
                                const messagesRef = contactRef.collection('messages');

                                const messageDoc = messagesRef.doc(sentMessage.id._serialized);

                                await messageDoc.set(sentMessageData, { merge: true });
                                if (part.includes('notified the team')) {
                                    await assignNewContactToEmployee(extractedNumber, idSubstring, client);

                                }

                                if (idSubstring == '0128' && part.includes('get back to you')) {
                                    await addtagbookedFirebase(extractedNumber, 'stop bot', idSubstring);
                                    await assignNewContactToEmployee(extractedNumber, idSubstring, client);
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
                                                        const response = await fetch('https://mighty-dane-newly.ngrok-free.app/api/tag/followup', {
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
                                            const response = await fetch('https://mighty-dane-newly.ngrok-free.app/api/tag/followup', {
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
                                
                                // For tags
                                if (!tagFound) {
                                    for (const response of aiTagResponses) {
                                        if (response.keywordSource === "bot" && response.keywords.some(kw => part.toLowerCase().includes(kw.toLowerCase()))) {
                                            console.log('tags found for keywords:', response.keywords);
                                            try {
                                                // Remove any specified tags first
                                                for (const tagToRemove of response.removeTags) {
                                                    await addtagbookedFirebase(extractedNumber, tagToRemove, idSubstring, true);
                                                }
                                                
                                                // Add new tags
                                                for (const tag of response.tags) {
                                                    await addtagbookedFirebase(extractedNumber, tag, idSubstring);
                                                    console.log(`Added tag: ${tag} for number: ${extractedNumber}`);
                                                }
                                                tagFound = true;
                                                return;
                                            } catch (error) {
                                                console.error(`Error handling tags for keywords ${response.keywords}:`, error);
                                                continue;
                                            }
                                        }
                                    }
                                }
                                
                                // For voice messages
                                if (!voiceFound) {
                                    for (const response of aiVoiceResponses) {
                                        if (response.keywordSource === "bot" && response.keywords.some(kw => part.toLowerCase().includes(kw.toLowerCase()))) {
                                            console.log('voice messages found for keywords:', response.keywords);
                                            for (let i = 0; i < response.voiceUrls.length; i++) {
                                                try {
                                                    const caption = response.captions?.[i] || '';
                                                    const voiceMessage = await sendVoiceMessage(client, msg.from, response.voiceUrls[i], caption);
                                                    await addMessagetoFirebase(voiceMessage, idSubstring, extractedNumber, contactName);
                                                    if (i < response.voiceUrls.length - 1) {
                                                        await new Promise(resolve => setTimeout(resolve, 1000));
                                                    }
                                                } catch (error) {
                                                    console.error(`Error sending voice message ${response.voiceUrls[i]}:`, error);
                                                    continue;
                                                }
                                            }
                                            voiceFound = true;
                                            return;
                                        }
                                    }
                                }
                                
                                // For images
                                if (!imageFound) {
                                    for (const response of aiResponses) {
                                        if (response.keywordSource === "bot" && response.keywords.some(kw => part.toLowerCase().includes(kw.toLowerCase()))) {
                                            console.log('images found for keywords:', response.keywords);
                                            for (const imageUrl of response.imageUrls) {
                                                try {
                                                    const media = await MessageMedia.fromUrl(imageUrl);
                                                    const imageMessage = await client.sendMessage(msg.from, media);
                                                    await addMessagetoFirebase(imageMessage, idSubstring, extractedNumber, contactName);
                                                } catch (error) {
                                                    console.error(`Error sending image ${imageUrl}:`, error);
                                                    continue;
                                                }
                                            }
                                            imageFound = true;
                                            return;
                                        }
                                    }
                                }

                            }

                        }
                    }
                }
                await chat.markUnread();
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
        return (e.message);
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

async function getAITagResponses(idSubstring) {
    const responses = [];
    const aiTagResponsesRef = db.collection('companies').doc(idSubstring).collection('aiTagResponses');
    const snapshot = await aiTagResponsesRef.where('status', '==', 'active').get();
    
    snapshot.forEach(doc => {
        responses.push({
            keywords: doc.data().keywords || [], // Array of keywords
            tags: doc.data().tags || [], // Array of tags to add
            removeTags: doc.data().removeTags || [], // Optional array of tags to remove
            keywordSource: doc.data().keywordSource || "user" // Default to "user" if not specified
        });
    });
    return responses;
}

async function getAIImageResponses(idSubstring) {
    const responses = [];
    const aiResponsesRef = db.collection('companies').doc(idSubstring).collection('aiImageResponses');
    const snapshot = await aiResponsesRef.where('status', '==', 'active').get();
    
    snapshot.forEach(doc => {
        responses.push({
            keywords: doc.data().keywords || [], // Array of keywords
            imageUrls: doc.data().imageUrls || [], // Get array of image URLs
            keywordSource: doc.data().keywordSource || "user" // Default to "user" if not specified
        });
    });
    return responses;
}

async function getAIVoiceResponses(idSubstring) {
    const responses = [];
    const aiVoiceResponsesRef = db.collection('companies').doc(idSubstring).collection('aiVoiceResponses');
    const snapshot = await aiVoiceResponsesRef.where('status', '==', 'active').get();
    
    snapshot.forEach(doc => {
        responses.push({
            keywords: doc.data().keywords || [], // Array of keywords
            voiceUrls: doc.data().voiceUrls || [], // Array of voice message URLs
            captions: doc.data().captions || [], // Optional captions for each voice message
            language: doc.data().language || 'en', // Optional language setting
            keywordSource: doc.data().keywordSource || "user" // Default to "user" if not specified
        });
    });
    return responses;
}
async function sendVoiceMessage(client, chatId, voiceUrl, caption = '') {
    try {
        console.log('Sending voice message:', { chatId, voiceUrl, caption });
        
        // Download the audio file
        const response = await axios.get(voiceUrl, { responseType: 'arraybuffer' });
        const audioBuffer = Buffer.from(response.data);

        // Create MessageMedia object
        const media = new MessageMedia(
            'audio/mpeg', // Default MIME type for voice messages
            audioBuffer.toString('base64'),
            `voice_${Date.now()}.mp3` // Generate unique filename
        );

        // Send the voice message with options
        const messageOptions = {
            sendAudioAsVoice: true, // This ensures it's sent as a voice message
        };

        if (caption) {
            messageOptions.caption = caption;
        }

        const sent = await client.sendMessage(chatId, media, messageOptions);
        console.log('Voice message sent successfully');
        
        return sent;
    } catch (error) {
        console.error('Error sending voice message:', error);
        // Log detailed error information
        if (error.response) {
            console.error('Response error:', {
                status: error.response.status,
                data: error.response.data
            });
        }
        throw new Error(`Failed to send voice message: ${error.message}`);
    }
}

// Define a mapping of keywords to media URLs and options
const mediaMap = {
    'Product: BT 14 Kg': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F14kg%20gas%20(normal).jpg?alt=media&token=d149ec04-5d8e-493f-8c32-e282efd424eb',
        type: 'image'
    },
    'Product: C14 Kg': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F14kg%20gas%20(%20forklift%20).jpg?alt=media&token=213a3c36-bb75-4a79-b43b-cc36218156da',
        type: 'image'
    },
    'Product: C50 Kg': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F50kg%20gas%20(commercial%20%26%20industrial).jpg?alt=media&token=5d9c2ab0-c890-4b22-bac8-43ca17f20df8',
        type: 'image'
    },
    '3. BT 14 Kg': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F14kg%20gas%20(normal).jpg?alt=media&token=d149ec04-5d8e-493f-8c32-e282efd424eb',
        type: 'image'
    },
    '1. C14 Kg': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F14kg%20gas%20(%20forklift%20).jpg?alt=media&token=213a3c36-bb75-4a79-b43b-cc36218156da',
        type: 'image'
    },
    '5. C50 Kg': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F50kg%20gas%20(commercial%20%26%20industrial).jpg?alt=media&token=5d9c2ab0-c890-4b22-bac8-43ca17f20df8',
        type: 'image'
    },
    'C200 Kg': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F200kg%20gas%20(commercial%20%26%20industrial).jpg?alt=media&token=1b1b216c-e558-4897-893d-15628932a174',
        type: 'image'
    },
    'Bull Tank': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2Fbulk%20tank%20(commercial%20%26%20industrial).jpg.png?alt=media&token=b50f888f-a7f5-4420-b66a-d558435e9d81',
        type: 'image'
    },
    'Placement': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FSafety%20Tips%2F14KG%20GAS%20(1-4).png?alt=media&token=37ac0ef5-e490-4980-95f0-9f4a13922c69',
        type: 'image'
    },
    'Keep Away from Flammables': [
        {
            url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FSafety%20Tips%2F2%2C%203.png?alt=media&token=74501b8f-1f07-430a-9e5e-579bf299f820',
            type: 'image'
        },
        {
            url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FSafety%20Tips%2F3.jpg?alt=media&token=ff225d2d-38e3-47a9-8506-1b2e6310776e',
            type: 'image'
        }
    ],
    'Post-Usage': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FSafety%20Tips%2F5.png?alt=media&token=3cbe6b69-105e-4a6c-af5b-070d9e17ad12',
        type: 'image'
    },
    'Avoid Ignition': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FGas%20leak%20user%20guide%2F1.2.png?alt=media&token=f4142f7c-9ae0-452f-b2e0-ddb5510a8dcd',
        type: 'image'
    },
    'Turn Off Gas Supply': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FGas%20leak%20user%20guide%2F2.png?alt=media&token=c17e40c7-83e4-400b-a20d-f3444fa3a21b',
        type: 'image'
    },
    'Ventilate': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FGas%20leak%20user%20guide%2F3.jpg?alt=media&token=758994af-7d1d-441f-84ed-8a4074b3bb60',
        type: 'image'
    },
    'Prepare Soap Water Solution': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20gas%20leak%2F1.jpg?alt=media&token=44057500-d219-44da-b30f-5dbdd2a013cf',
        type: 'image'
    },
'Public Bank': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/7f4ea49b-b743-4fee-96f7-a25dfe02c901.jpeg?alt=media&token=ffa0a5c2-3dc9-46e4-a849-9f2b5cedd278',
        type: 'image'
    },
    
    'Inspect the Hose': [
        {
            url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20gas%20leak%2F2.1.jpg?alt=media&token=8a3a1d43-3fce-4cbc-9983-4fb17572a9f4',
            type: 'image'
        },
        {
            url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20gas%20leak%2F2.2.jpg?alt=media&token=154ca40f-e2a1-48a0-9267-96acdbfb8fca',
            type: 'image'
        },
        {
            url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20gas%20leak%2F3.png?alt=media&token=0769a6fe-1b8d-4a89-9a23-d4d02d2f282b',
            type: 'image'
        }
    ],
    '3 Easy Steps': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20gas%20leak%2F4.jpeg?alt=media&token=12ae9d1c-5891-42ce-a51e-ac9f010f878d',
        type: 'image'
    },
    'Lesen Borong': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FCSA%20Lesen%20Borong%20Expired%2017Nov2024.pdf?alt=media&token=6296cf5e-96e4-4ff2-b371-8bad9b4891e0',
        type: 'document',
        filename: 'CSA Lesen Borong Expired 17Nov2024.pdf'
    },
    'Product Specifications': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20Product%20Specifications.pdf?alt=media&token=a9effbff-1798-4341-857f-df4fc2ad2cb1',
        type: 'document',
        filename: 'LPG Product Specifications.pdf'
    },
    'Material Safety': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20Material%20Safety%20Data%20Sheet%20(MSDS)%20-%202-pager%20(1).pdf?alt=media&token=531565e5-6f9b-46d5-bc13-a6553c4bdb68',
        type: 'document',
        filename: 'LPG Material Safety Data Sheet (MSDS) - 2-pager.pdf'
    },
    'PDA License': {
        url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FPDA%20LICENSE%20EXPIRED%2027%20APR%2027.pdf?alt=media&token=aed70bc4-5749-496d-b794-a7f0a5c2f6ee',
        type: 'document',
        filename: 'PDA LICENSE EXPIRED 27 APR 27.pdf'
    }
};

// Replace the multiple if statements with a single function
async function sendMedia(client, msg, part, idSubstring, extractedNumber, contactName) {
    for (const [keyword, mediaInfo] of Object.entries(mediaMap)) {
        if (part.includes(keyword)) {
            if (Array.isArray(mediaInfo)) {
                // Handle multiple media items for the same keyword
                for (const item of mediaInfo) {
                    const media = await MessageMedia.fromUrl(item.url, 
                        item.type === 'document' ? { unsafeMime: true, filename: item.filename } : {});
                    const sentMessage = await client.sendMessage(msg.from, media, 
                        item.type === 'document' ? { sendMediaAsDocument: true } : {});
                    await addMessagetoFirebase(sentMessage, idSubstring, extractedNumber, contactName);
                }
            } else {
                const media = await MessageMedia.fromUrl(mediaInfo.url, 
                    mediaInfo.type === 'document' ? { unsafeMime: true, filename: mediaInfo.filename } : {});
                const sentMessage = await client.sendMessage(msg.from, media, 
                    mediaInfo.type === 'document' ? { sendMediaAsDocument: true } : {});
                await addMessagetoFirebase(sentMessage, idSubstring, extractedNumber, contactName);
            }
        }
    }
}
async function generateInquiryReport(threadID, assistantId) {
    try {
        // Check for any active runs first
        const runs = await openai.beta.threads.runs.list(threadID);
        const activeRun = runs.data.find(run => 
            ['in_progress', 'queued', 'requires_action'].includes(run.status)
        );
        if (activeRun) {
            console.log(`Waiting for active run ${activeRun.id} to complete...`);
            await waitForReportCompletion(threadID, activeRun.id);
        }

 
        // Add a message requesting the report
        await openai.beta.threads.messages.create(threadID, {
            role: "user",
            content: "Please generate a detailed report of the customer's inquiry and contact information."
        });

        // Create the run for the report
        console.log('Creating final report run...');
        const finalRun = await openai.beta.threads.runs.create(threadID, {
            assistant_id: assistantId,
            instructions: 
                `Generate a concise inquiry report in exactly this format based on our conversation depending on the customer's inquiry:
If Restaurant
Inquiry Details Has Been Submitted

Inquiry & Contact Details:
1. Cooking Stoves: [Extract from conversation] units
2. Steaming Burners: [Extract from conversation] units
3. Low-Pressure Burners: [Extract from conversation] units
4. Frying Burners: [Extract from conversation] units
5. Operating for [Extract from conversation] hours per day.
6. Closed for [Extract from conversation] days per month.
7. Significant kitchen appliances: [Extract from conversation]
8. Full Name: [Extract from conversation]
9. Contact Number: [Extract from conversation]
10. Intended Usage: [Extract from conversation]

AI Suggested (per month):
1. Product: [Extract from conversation] Kg gas cylinders
2. Quantity: [Extract from conversation]

If Laundry
Inquiry Details Has Been Submitted

Laundry Inquiry & Contact Details:
1. Dryers: [Extract from conversation] units
2. Operating for [Extract from conversation] hours per day
3. Closed for [Extract from conversation] days per month
4. Additional Equipment: [Extract from conversation]
5. Full Name: [Extract from conversation]
6. Contact Number: [Extract from conversation]
7. Intended Usage: [Extract from conversation]

AI Suggested (per month):
1. Product: [Extract from conversation] Kg gas cylinders
2. Quantity: [Extract from conversation]

If Other than Kitchen or Laundry:

Generate a concise inquiry report in exactly this format based on our conversation:

Inquiry Details Has Been Submitted

Contact Details:
1. Full Name: [Extract from conversation]
2. Contact Number: [Extract from conversation]
3. Intended Usage: [Extract from conversation]
` 
              
        });

        // Get the final report
        console.log('Waiting for final report completion...');
        const reportMessage = await waitForReportCompletion(threadID, finalRun.id);
        console.log('Final report received');
        
        return reportMessage;

    } catch (error) {
        console.error('Error in generateInquiryReport:', error);
        return `Error generating inquiry report: ${error.message}`;
    }
}

  // Internal function to handle report completion
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
    }

    console.error(`Timeout: Report generation did not complete in time (depth: ${depth}, runId: ${runId})`);
    return "Error: Report generation timed out. Please try again.";
}
async function generateSpecialReport(threadID, assistantId) {
    try {
        // Check for any active runs first
        const runs = await openai.beta.threads.runs.list(threadID);
        const activeRun = runs.data.find(run => 
            ['in_progress', 'queued', 'requires_action'].includes(run.status)
        );
        if (activeRun) {
            console.log(`Waiting for active run ${activeRun.id} to complete...`);
            await waitForReportCompletion(threadID, activeRun.id);
        }
        // Add a message requesting the report
        await openai.beta.threads.messages.create(threadID, {
            role: "user",
            content: "Please generate a detailed report of the customer's requirements and contact information."
        });

        // Create the run for the report
        console.log('Creating final report run...');
        const finalRun = await openai.beta.threads.runs.create(threadID, {
            assistant_id: assistantId,
            instructions:
                `Generate a report in this exact format depending on the customer's inquiry:
Other than Kitchen or Laundry:

New Order Has Been Submitted

1. Full Name: [Extract]
2. Contact Number: [Extract]
3. Company Name: [Extract]
4. SSM: [Extract]
5. Address: [Extract]
6. Stock Receiver: [Extract]
7. Account Payable Contact Name and Phone: [Extract]
8. Product: [Extract]
9. Quantity: [Extract]
10. Intended Usage: [Extract]

If Kitchen:

New Order Has Been Submitted

Inquiry Details:
1. Cooking Stoves: [Extract] units
2. Steaming Burners: [Extract] units
3. Low-Pressure Burners: [Extract] units
4. Frying Burners: [Extract] units
5. Operating for [Extract] hours per day
6. Closed for [Extract] days per month
7. Significant kitchen appliances: [Extract]

Contact Details:
1. Full Name: [Extract]
2. Contact Number: [Extract]
3. Company Name: [Extract]
4. SSM: [Extract]
5. Address: [Extract]
6. Intended Usage: [Extract]

AI Suggested (per month):
1. Product: [Extract] Kg gas cylinders
2. Quantity: [Extract]

If Laundry:

New Order Has Been Submitted

Laundry Equipment Details:
1.Dryers: [Extract] units

Operating Schedule:
1. Operating Hours: [Extract] hours per day
2. Operating Days: [Extract] days per month

Contact Details:
1. Full Name: [Extract]
2. Contact Number: [Extract]
3. Company Name: [Extract]
4. SSM: [Extract]
5. Address: [Extract]

Monthly Usage Calculation:
1. Per Dryer Usage: [Extract] kg/hour
2. Total Monthly Usage: [Extract] kg/month

AI Suggested (per month):
1. Product: [Extract] Kg gas cylinders
2. Quantity: [Extract] units`
        });

        // Get the final report
        console.log('Waiting for final report completion...');
        const reportMessage = await waitForReportCompletion(threadID, finalRun.id);
        console.log('Final report received');
        
        // Verify we got a proper report
        return reportMessage;

    } catch (error) {
        console.error('Error in generateSpecialReport:', error);
        return `Error generating report: ${error.message}`;
    }
}

async function waitForUsageCheckCompletion(threadId, runId, depth = 0) {
    const maxDepth = 5;
    const maxAttempts = 30;
    const pollingInterval = 2000;

    if (depth >= maxDepth) {
        console.error(`Max recursion depth reached for usage check runId: ${runId}`);
        return "NO";
    }

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
        try {
            const runObject = await openai.beta.threads.runs.retrieve(threadId, runId);
            console.log(`Usage check status: ${runObject.status} (attempt ${attempts + 1})`);

            if (runObject.status === 'completed') {
                const messagesList = await openai.beta.threads.messages.list(threadId);
                const response = messagesList.data[0].content[0].text.value;
                // Look for YES/NO in the response
                if (response.toUpperCase().includes('YES')) return 'YES';
                if (response.toUpperCase().includes('NO')) return 'NO';
                return 'NO'; // Default to NO if unclear
            } else if (['failed', 'cancelled', 'expired'].includes(runObject.status)) {
                console.error(`Usage check ${runId} ended with status: ${runObject.status}`);
                return "NO";
            }

            await new Promise(resolve => setTimeout(resolve, pollingInterval));
        } catch (error) {
            console.error(`Error in usage check:`, error);
            return "NO";
        }
    }

    console.error(`Timeout: Usage check did not complete in time`);
    return "NO";
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
            console.log("error from handleNewMessagesNewTown: "+error)
            throw error;
        }
    }
    return null; // Return null if not completed
}
async function waitForCompletion(threadId, runId, idSubstring, client, depth = 0, phoneNumber, name, threadID) {
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
                    const toolOutputs = await handleToolCalls(toolCalls, idSubstring, client, phoneNumber, name, threadID);
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
                return await waitForCompletion(threadId, runId, idSubstring, client, depth + 1, phoneNumber, name, threadID);
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
// Also update runAssistant to pass the necessary parameters to waitForCompletion
async function runAssistant(assistantID, threadId, tools, idSubstring, client, phoneNumber, name,threadID) {
    console.log('Running assistant for thread: ' + threadId);
    const response = await openai.beta.threads.runs.create(
        threadId,
        {
            assistant_id: assistantID,
            tools: tools
        }
    );

    const runId = response.id;
    const answer = await waitForCompletion(threadId, runId, idSubstring, client, 0, phoneNumber, name,threadID);
    return answer;
}
async function handleOpenAIAssistant(message, threadID, stopTag, extractedNumber, idSubstring, client, contactName) {
    console.log(ghlConfig.assistantId);
    const assistantId = ghlConfig.assistantId;
    await addMessage(threadID, message);

    const tools = [
        {
            type: "function",
            function: {
                name: "sendInquiryToGroupNewTown",
                description: "Send customer inquiry details to a designated group when customer is not ready to order but needs more information",
                parameters: {
                    type: "object",
                    properties: {
                        customerName: {
                            type: "string",
                            description: "Name of the customer making the inquiry"
                        },
                        customerPhone: {
                            type: "string",
                            description: "Phone number of the customer"
                        }
                    },
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "assignContactAndGenerateReportNewTown",
                description: "Assign a contact to an employee and generate a report to send to a designated group. This must be called after order is made.",
                parameters: {
                    type: "object",
                    properties: {},  // No parameters needed as we'll use the existing variables
                    required: []
                }
            }
        },
        {
            type: "function",
            function: {
                name: "sendFeedbackToGroupNewTown",
                description: "Send customer feedback to a designated group when customer provide feedback or when you detect a customer is unhappy",
                parameters: {
                    type: "object",
                    properties: {
                        feedback: {
                            type: "string",
                            description: "The feedback message from the customer"
                        },
                        customerName: {
                            type: "string",
                            description: "Name of the customer providing feedback"
                        },
                        customerPhone: {
                            type: "string",
                            description: "Phone number of the customer"
                        }
                    },
                    required: ["feedback"]
                }
            }
        }
    ];

    const answer = await runAssistant(assistantId, threadID, tools, idSubstring, client, extractedNumber, contactName,threadID);
    return answer;
}
async function handleToolCalls(toolCalls, idSubstring, client, phoneNumber, name,threadID) {
    console.log('Handling tool calls...');
    const toolOutputs = [];
    for (const toolCall of toolCalls) {
        console.log(`Processing tool call: ${toolCall.function.name}`);
        switch (toolCall.function.name) {
            case 'sendInquiryToGroupNewTown':
                try {
                    const report = await generateInquiryReport(threadID, ghlConfig.assistantId);
                    const sentMessage = await client.sendMessage('120363107024888999@g.us', report);
                    await addMessagetoFirebase(sentMessage, idSubstring, '+120363107024888999');
                    
                    // Add inquiry tag to contact in Firebase
                    const contactRef = db.collection('companies').doc(idSubstring)
                        .collection('contacts').doc(phoneNumber);
                    await contactRef.update({
                        tags: admin.firestore.FieldValue.arrayUnion('inquiry')
                    });

                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({
                            success: true,
                            message: "Inquiry sent to group successfully for NewTown in HMNT"
                        })
                    });
                } catch (error) {
                    console.error('Error in sendInquiryToGroupNewTown in HMNT:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message })
                    });
                }
                break;
            case 'assignContactAndGenerateReportNewTown':
                try {                    
                    // Generate and send report
                    const report = await generateSpecialReport(threadID, ghlConfig.assistantId);
                    const sentMessage = await client.sendMessage('120363107024888999@g.us', report);
                    await addMessagetoFirebase(sentMessage, idSubstring, '+120363107024888999');
                    
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({
                            success: true,
                            message: "Contact report generated successfully for NewTown in HMNT"
                        })
                    });
                } catch (error) {
                    console.error('Error in assignContactAndGenerateReportNewTown in HMNT:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message })
                    });
                    
                }
                break;
            case 'sendFeedbackToGroupNewTown':
                try {
                    console.log('Sending feedback to group...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const result = await sendFeedbackToGroup(client, args.feedback, name, phoneNumber, idSubstring);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: result,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for sendFeedbackToGroupNewTown in HMNT:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            // ... other cases ...
        }
    }
    return toolOutputs;
}

async function sendFeedbackToGroup(client, feedback, customerName, customerPhone, idSubstring) {
    try {
        const feedbackMessage = `*New Customer Feedback*\n\n` +
            `👤 Customer: ${customerName}\n` +
            `📱 Phone: ${customerPhone}\n` +
            `💬 Feedback: ${feedback}\n\n` +
            `Received: ${new Date().toLocaleString()}`;

        // Send to feedback group (you'll need to set this group ID in your config)
        const feedbackGroupId = '120363107024888999@g.us'; // Default group or from config
        const sentMessage = await client.sendMessage(feedbackGroupId, feedbackMessage);
        await addMessagetoFirebase(sentMessage,idSubstring,'+120363107024888999')
        // Log feedback to Firebase
        await logFeedbackToFirebase(idSubstring, customerPhone, feedback);

        return JSON.stringify({
            success: true,
            message: "Feedback sent to group successfully"
        });
    } catch (error) {
        console.error('Error sending feedback:', error);
        throw error;
    }
}

async function logFeedbackToFirebase(idSubstring, customerPhone, feedback) {
    try {
        const feedbackRef = db.collection('companies').doc(idSubstring)
            .collection('feedback').doc();
        
        await feedbackRef.set({
            customerPhone: customerPhone,
            feedback: feedback,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Error logging feedback to Firebase:', error);
    }
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

async function fetchSalesFromFirebase(idSubstring, group) {
    const salesRef = db.collection('companies').doc(idSubstring).collection('sales');
    const snapshot = await salesRef.where('group', '==', group).get();
    
    sales = [];
    
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.name && data.phoneNumber && data.weightage !== undefined) {
            sales.push({
                name: data.name,
                phoneNumber: data.phoneNumber,
                weightage: data.weightage
            });
        }
    });

    console.log('Fetched sales employees:', sales);
}

module.exports = { handleNewMessagesNewTown };