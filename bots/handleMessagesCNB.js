// handleMessagesTemplateWweb.js

//STEP BY STEP GUIDE
//1. CHANGE all handleMessagesTemplate to -> handleMessages<YourBotName>
//2. CHANGE all idSubstring to firebase collection name
//3. CHANGE all <assistant> to openai assistant id
//4. CHANGE all Template to your <YourBotName>

const OpenAI = require('openai');
const axios = require('axios').default;
const { MessageMedia } = require('whatsapp-web.js');
const AsyncLock = require('async-lock');
const lock = new AsyncLock();
const { Client } = require('whatsapp-web.js');


const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();

let ghlConfig = {};

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
let currentEmployeeIndex = 0;

async function fetchEmployeesFromFirebase(idSubstring) {
    const employeesRef = db.collection('companies').doc(idSubstring).collection('employee');
    const snapshot = await employeesRef.get();
    
    employees = [];
    
    console.log(`Total documents in employee collection: ${snapshot.size}`);

    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`Processing employee document:`, data);

        if (data.name) {
            employees.push({
                name: data.name,
                email: data.email,
                phoneNumber: data.phoneNumber,
                assignedContacts: data.assignedContacts || 0
            });
            console.log(`Added employee ${data.name}`);
        } else {
            console.log(`Skipped employee due to missing name:`, data);
        }
    });

    console.log('Fetched employees:', employees);

    // Load the previous assignment state
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

    console.log('Employees:', employees);
    console.log('Current Employee Index:', currentEmployeeIndex);

    if (employees.length === 0) {
        console.log('No employees found for assignment');
        return [];
    }
    
    let assignedEmployee = null;

    // Round-robin assignment
    assignedEmployee = employees[currentEmployeeIndex];
    currentEmployeeIndex = (currentEmployeeIndex + 1) % employees.length;

    console.log(`Assigned employee: ${assignedEmployee.name}`);

    const tags = [assignedEmployee.name, assignedEmployee.phoneNumber];
    const employeeID = assignedEmployee.phoneNumber.split('+')[1] + '@c.us';
    console.log(`Contact ${contactID} assigned to ${assignedEmployee.name}`);
    
    await client.sendMessage(employeeID, `Hello ${assignedEmployee?.name || 'Employee'}, a new contact has been assigned to you:

Name: ${contactName || 'Not provided'}
Phone: ${contactID || 'Not provided'}

Kindly login to https://web.jutasoftware.co/login

Thank you.

Juta Teknologi`);
    await addtagbookedFirebase(contactID, assignedEmployee.name, idSubstring);

    // Fetch sales employees based on the assigned employee's group
    if(assignedEmployee.group){
        await fetchSalesFromFirebase(idSubstring, assignedEmployee.group);
        console.log('Fetched sales employees:', sales);
    } else {
        console.log('No group assigned to the employee');
        return tags;  // Return early if no group is assigned
    }
    
    // Filter out employees who are inactive (assuming active employees have a weightage > 0)
    const availableEmployees = sales.filter(emp => emp.weightage > 0);

    console.log('Available sales employees:', availableEmployees);

    if (availableEmployees.length === 0) {
        console.log('No available sales employees found for assignment');
        return tags;
    }

    // Calculate total weight
    const totalWeight = availableEmployees.reduce((sum, emp) => sum + emp.weightage, 0);

    console.log('Total weight:', totalWeight);

    // Generate a random number between 0 and totalWeight
    const randomValue = Math.random() * totalWeight;

    console.log('Random value:', randomValue);

    // Select an employee based on the weighted random selection
    let cumulativeWeight = 0;
    let assignedSales = null;

    for (const emp of availableEmployees) {
        cumulativeWeight += emp.weightage;
        console.log(`Sales Employee: ${emp.name}, Cumulative Weight: ${cumulativeWeight}`);
        if (randomValue <= cumulativeWeight) {
            assignedSales = emp;
            break;
        }
    }
    
    if (!assignedSales) {
        console.log('Failed to assign a sales employee');
        return tags;
    }

    console.log(`Assigned sales: ${assignedSales.name}`);
    await addtagbookedFirebase(contactID, assignedSales.name, idSubstring);
    const salesID = assignedSales.phoneNumber.replace(/\s+/g, '').split('+')[1] + '@c.us';

    await client.sendMessage(salesID, `Hello ${assignedSales?.name || 'Sales Employee'}, a new contact has been assigned to you:

Name: ${contactName || 'Not provided'}
Phone: ${contactID || 'Not provided'}

Kindly login to https://web.jutasoftware.co/login

Thank you.

Juta Teknologi`);

    // Add the assigned sales employee to the tags
    tags.push(assignedSales.name, assignedSales.phoneNumber);

    // Store the current state in Firebase
    await storeAssignmentState(idSubstring);

    return tags;
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

let sales = [];

async function addNotificationToUser(companyId, message) {
    console.log('noti');
    try {
        // Find the user with the specified companyId
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

const MESSAGE_BUFFER_TIME = 60000; // 1 minute in milliseconds
const messageBuffers = new Map();

async function handleNewMessagesCNB(client, msg, botName, phoneIndex) {
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
                         filename: msg._data.filename || "",
                         caption: msg._data.caption || "",
                         pageCount: msg._data.pageCount || 0,
                         fileSize: msg._data.size || 0
                     };
                     
                     // Store document data separately if needed
                     try {
                         const docUrl = await storeDocumentData(media.data, msg._data.filename);
                         messageData.document.url = docUrl;
                     } catch (error) {
                         console.error('Error storing document:', error);
                         messageData.document.url = '';
                     }
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
        const sender = {
            to: msg.from,
            name: msg.notifyName,
        };

        const extractedNumber = '+'+(sender.to).split('@')[0];
        // Remove this line as 'message' is not defined
        // const lockKey = `thread_${message.chat_id}`;

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
        } if (contactData.threadid) {
            threadID = contactData.threadid;
        } else {
            const thread = await createThread();
            threadID = thread.id;
            await saveThreadIDFirebase(contactID, threadID, idSubstring)
        }

        currentStep = userState.get(sender.to) || steps.START;
        switch (currentStep) {
            case steps.START:
                var context = "";

                query = `${combinedMessage}`;
                const carpetTileFilePaths = {
                    'atria-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FAtria%20Leaflet.pdf?alt=media&token=73303523-9c3c-4935-bd14-1004b45a7f58',
                    'mw-moscow-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FMoscow%20St%20Petersburg%20Leaflet.pdf?alt=media&token=d5dfa885-1cf1-4232-aaf4-aa0c61aaa4f9',
                    'palette-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FPalette%20Leaflet.pdf?alt=media&token=625df591-76ce-4aac-a2f4-cca73f8706f4',
                    'pe-saintpetersburg-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FMoscow%20St%20Petersburg%20Leaflet.pdf?alt=media&token=d5dfa885-1cf1-4232-aaf4-aa0c61aaa4f9',
                    'canvas(new)-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FCanvas%20Leaflet.pdf?alt=media&token=377c77a6-c4d0-4778-9e37-b4a80a88ca0b',
                    'spark(new)-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FSpark%20Leaflet.pdf?alt=media&token=43756f59-08c9-4c10-9030-900acecdf3c4',
                    'brs-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FBRS%20Leaflet.pdf?alt=media&token=a9259cc5-7c7c-4860-97e3-65aae607c214',
                    'vlt-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FVLT%20Leaflet.pdf?alt=media&token=2289c5a0-d4bd-469f-bf27-eedb26d28051',
                    'bonn-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FBonn%20Leaflet.pdf?alt=media&token=004bdc9a-8d9e-446b-9f02-774d3e9bc1d0',
                    'phantom(new)-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FPhantom%20Leaflet.pdf?alt=media&token=9eadd923-c352-4b90-a5a6-7b523c934721',
                    'roma-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FRoma%20Leaflet%20(online).pdf?alt=media&token=7e68447b-7a98-4ed9-b168-e4bd5cda52c1',
                    'rhythm-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FRhythm%20Leaflet.pdf?alt=media&token=5b09b936-2223-4631-a48f-f877a2d17681',
                    'proearth-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FPro%20Earth%20Leaflet.pdf?alt=media&token=54d5ad6b-64d0-438e-98ac-5f6ca844fc53',
                    '3c-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2F3C%20Leaflet.pdf.pdf?alt=media&token=d40a927e-6383-478c-8447-960f24a34769',
                    'eno-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FENO%20Leaflet.pdf?alt=media&token=fbb321a6-9928-4401-ac63-68185a192d9a',
                    'alta-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FAlta%20leaflet.pdf?alt=media&token=595b3ebc-85db-48c4-8f79-8b75cc33754a',
                    'ndnewdelhi-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FNew%20Delhi%20Leaflet.pdf?alt=media&token=ad3bb24d-31d9-48dc-90fd-3d81c75eff19',
                    'colourtone-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FColourtone%20Leaflet.pdf?alt=media&token=6fc90919-1e29-4748-b9dd-e6ab83536515',
                    'starlight-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FStarlight%20Leaflet.pdf?alt=media&token=7955ba92-9a51-46ed-ac48-39ce3770cd3e',
                    'landscape-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FLandscape%20Leaflet.pdf?alt=media&token=eb1fbdf5-55be-453f-aa62-a17f9a2084be',
                    'liverpoollvp-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FLiverpool%20Leaflet.pdf?alt=media&token=aed6f0f4-b2d1-4bb3-a67f-e948047aa7eb',
                    'colourplus-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FColour%20Plus%20Leaflet.pdf?alt=media&token=1996713f-3af7-4d98-9368-ad6b9a34715a',
                    'aberdeen-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FAberdeen%20Leaflet.pdf?alt=media&token=6af44f4f-d7b5-46a2-888e-b9fe3e94758b',
                    'saipan-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FSaipan%20Leaflet.pdf?alt=media&token=5f2f7c29-854e-42b0-bdb4-3af1781ce3bd',
                    'superloop-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FSuper%20Loop%20leaflet.pdf?alt=media&token=26d89c55-d0c4-4772-8859-6c07d5217b68',
                    'newloop-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FNew%20Loop%20Leaflet.pdf?alt=media&token=dc5ca05e-da6b-4b33-9a36-f572f80162fb',
                    'matahari-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FMatahari%20Leaflet.pdf?alt=media&token=4899ca90-3657-47d8-8bcb-18cb76e910bc',
                    'camb-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FCamb%20Leaflet.pdf?alt=media&token=1f68e3fd-645b-4f5c-a95e-70fbb8581359',
                    'patriot-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FPatriot%20Leaflet.pdf?alt=media&token=7a8785b9-e2d1-4552-87bf-7c522abee65a',
                    'heavyloop-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FHeavy%20Loop%20Leaflet.pdf?alt=media&token=dcc81e88-a851-44af-8159-b1b0477114e6',
                    'cloud-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FCloud%20Leaflet.pdf?alt=media&token=6b2ab550-231e-46f9-b0a0-a0ac64e9b97d',
                    'taurus-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FTaurus%20Leaflet.pdf?alt=media&token=90438fde-cdb8-4579-92ab-636a0015c2aa',
                    'transit-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FTransit%20Leaflet.pdf?alt=media&token=138bcf28-30ee-493f-acb1-b1ac41eeb7ef',
                    'canon-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FCanon%20Leaflet.pdf?alt=media&token=7523912d-efe7-4d2e-b22e-3aff13b670f5',
                    'metro-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FMetro%20Leaflet.pdf?alt=media&token=e22dc654-1a5f-415f-8b8d-18e6f335e927',
                    'tokyo-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FTokyo%20Leaflet.pdf?alt=media&token=5fff3ac7-e3ad-4bd8-b168-2447b281654b',
                    'villa-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FVilla%20Leaflet.pdf?alt=media&token=beb33a50-2311-4daa-9478-db1f9291d538',
                    'grandcanyon-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FGrand%20Canyon%20Leaflet.pdf?alt=media&token=89899c88-2e28-4473-9767-16c814675342',
                    'glitter-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FGlitter%20Leaflet.pdf?alt=media&token=b0864bcf-a168-4fae-a3c7-79187af2323e',
                    'mirage-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FMirage%20Leaflet.pdf.pdf?alt=media&token=4d1e1152-a519-480d-92d8-1a3bf0785518',
                    'impression-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FImpression%20Leaflet.pdf?alt=media&token=42cd7154-99a8-45e9-87c3-d238951b017b',
                    'timber-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FTimber%20Leaflet.pdf?alt=media&token=a82d78c6-c446-4dce-9bd8-b0cffaaf0039',
                    'rainbow-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FRainbow%20Leaflet.pdf?alt=media&token=b11ec600-6ab9-4b85-be4b-e8206ea5df7e',
                    'chamber-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FChamber%20Leaflet.pdf?alt=media&token=b798657c-845b-4ea0-b5c6-f40da2fe7960',
                    'nile-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FNile%20Leaflet.pdf.pdf?alt=media&token=5a5e1ea8-3ade-49f6-ab9b-8a8f24a5cfe5',
                    'sahara-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FSahara%20Leaflet.pdf?alt=media&token=fe9ed83b-cf1b-4959-842f-1f1bbcad004f',
                    'nybroadway2-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FNY%20Broadway%202%20Leaflet.pdf?alt=media&token=9dd5dc2e-b3d9-463f-8b52-00bad5d4fe54',
                    'element-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FElement%20Leaflet.pdf?alt=media&token=98444455-4706-40cf-80e2-2eca4ac6f0dd',
                    'vello-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FVello%20Leaflet.pdf?alt=media&token=9743d1e4-4c73-48fa-8ff3-e623ebab84d5',
                    'imperial-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FImperial%20Leaflet.pdf?alt=media&token=1b7ff207-d96b-47e1-95b5-7fbcd09a9700',
                    'luxe-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FLuxe%20Leaflet.pdf?alt=media&token=83991260-95a8-4aca-8266-ffce50fc950c',
                    'empire-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FEmpire%20Leaflet_page-0001.pdf?alt=media&token=e54d812e-061f-401b-8f43-81c6ad22861a',
                    'madinahmosque-thepriceper': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FMadinah%20Leaflet.pdf?alt=media&token=8f9c58e3-4147-435f-8a5d-696fdc995738',
                    'dywood-thepriceper': 'URL_FOR_DY_WOOD',
                    'redwoodnew-thepriceper': 'URL_FOR_REDWOOD_NEW',
                    'implexdeluxe-thepriceper': 'URL_FOR_IMPLEX_DELUXE',
                    'woodland-thepriceper': 'URL_FOR_WOODLAND',
                    'woodlink-thepriceper': 'URL_FOR_WOODLINK',
                    'widewood-thepriceper': 'URL_FOR_WIDE_WOOD',
                    'pebblestone-thepriceper': 'URL_FOR_PEBBLE_STONE',
                    'woodtek-thepriceper': 'URL_FOR_WOODTEK',
                    'grandwood-thepriceper': 'URL_FOR_GRAND_WOOD',
                    '7mmgrass-thepriceper': 'URL_FOR_7MM_GRASS',
                    'meadow-thepriceper': 'URL_FOR_MEADOW',
                    'prado15mmw/uvstabalizer-thepriceper': 'URL_FOR_PRADO_15MM',
                    'nobel25mmw/uvstabalizer-thepriceper': 'URL_FOR_NOBEL_25MM',
                    '10mmw/uvstabalizer-thepriceper': 'URL_FOR_10MM_W_UV',
                    '10mm(white)w/uvstabalizer-thepriceper': 'URL_FOR_10MM_WHITE',
                    'softturf25mm(green)-thepriceper': 'URL_FOR_SOFTTURF_25MM_GREEN',
                    'softturf25mm(yellow)-thepriceper': 'URL_FOR_SOFTTURF_25MM_YELLOW',
                    '35mm(green)w/uvstabilizer-thepriceper': 'URL_FOR_35MM_GREEN',
                    '35mm(yellow)w/uvstabilizer-thepriceper': 'URL_FOR_35MM_YELLOW',
                };
                if(msg.type === 'image'){
                    var image = await handleImageMessage(msg);
                    query = `${combinedMessage} The user image analysis is: ${image}]`;
                    console.log(query);
                    answer = await handleOpenAIAssistant(query, threadID);
                    parts = answer.split(/\s*\|\|\s*/);
                        
                        for (let i = 0; i < parts.length; i++) {
                            const part = parts[i].trim();   
                            const check = part.toLowerCase();
                            if (part) {
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
                                }
                            }
                        }
                }else{
                    if(!(sender.to.includes('@g.us')) || (combinedMessage.toLowerCase().startsWith('@juta') && phoneIndex == 0)){
                        answer = await handleOpenAIAssistant(query, threadID);
                        console.log(answer);
                        parts = answer.split(/\s*\|\|\s*/);
                        
                        for (let i = 0; i < parts.length; i++) {
                            const part = parts[i].trim();   
                            const check = part.toLowerCase();
                            const carpetCheck = check.replace(/\s+/g, '');             
                            
                            if (part.startsWith('~')) {
                                // Extract the product name from the part and append '-thepriceper'
                                const rawProductName = part.slice(1).trim(); // Remove tilde and trim spaces
                                const productName = rawProductName.toLowerCase().replace(/\s+/g, '') + '-thepriceper';
                                const filePath = carpetTileFilePaths[productName];
                                
                                if (filePath) {
                                    try {
                                        const media = await MessageMedia.fromUrl(filePath, { 
                                            unsafeMime: true, 
                                            filename: `${rawProductName}.pdf` 
                                        });
                                        const sentMessage = await client.sendMessage(msg.from, media, {
                                            sendMediaAsDocument: true // Ensure it's sent as a document
                                        });
                                        
                                        // Save the message to Firebase
                                        const messageData = {
                                            chat_id: sentMessage.from,
                                            from: sentMessage.from ?? "",
                                            from_me: true,
                                            id: sentMessage.id._serialized ?? "",
                                            source: sentMessage.deviceType ?? "",
                                            status: "delivered",
                                            document: {
                                                mimetype: media.mimetype,
                                                url: filePath,
                                                filename: `${rawProductName}.pdf`,
                                                caption: "",
                                            },
                                            timestamp: sentMessage.timestamp ?? 0,
                                            type: 'document',
                                            ack: sentMessage.ack ?? 0,
                                        };

                                        const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
                                        const messagesRef = contactRef.collection('messages');
                                        const messageDoc = messagesRef.doc(sentMessage.id._serialized);

                                        await messageDoc.set(messageData, { merge: true });
                                    } catch (error) {
                                        await client.sendMessage(msg.from, `Error sending document for ${rawProductName}: ${error.message}`);
                                    }
                                } else {
                                    await client.sendMessage(msg.from, `Sorry, I couldn't find the document for ${rawProductName}`);
                                }
                            } else {
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

async function handleImageMessage(msg) {
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

const extractProductName = (str) => {
    const match = str.split('-')[0];
    return match ? match.trim() : null;
};

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

async function storeDocumentData(docData, filename) {
    const bucket = admin.storage().bucket();
    const uniqueFilename = `${uuidv4()}_${filename}`;
    const file = bucket.file(`documents/${uniqueFilename}`);

    await file.save(Buffer.from(docData, 'base64'), {
        metadata: {
            contentType: 'application/pdf' // Adjust based on actual document type
        },
    });

    const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2500'
    });

    return url;
}

async function removeTagFirebase(contactID, tag, idSubstring) {
    const docPath = `companies/${idSubstring}/contacts/${contactID}`;
    const contactRef = db.doc(docPath);

    try {
        const doc = await contactRef.get();
        if (doc.exists) {
            let currentTags = doc.data().tags || [];
            const updatedTags = currentTags.filter(t => t !== tag);
            
            if (currentTags.length !== updatedTags.length) {
                await contactRef.update({ tags: updatedTags });
                console.log(`Tag "${tag}" removed from contact ${contactID} in Firebase`);
            }
        }
    } catch (error) {
        console.error('Error removing tag from Firebase:', error);
    }
}

async function hasTag(contactID, tag, idSubstring) {
    const docPath = `companies/${idSubstring}/contacts/${contactID}`;
    const contactRef = db.doc(docPath);

    try {
        const doc = await contactRef.get();
        if (doc.exists) {
            const currentTags = doc.data().tags || [];
            return currentTags.includes(tag);
        }
        return false;
    } catch (error) {
        console.error('Error checking tag in Firebase:', error);
        return false;
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
            console.log("error from handleNewMessagesCNB: "+error)
            throw error;
        }
    }
    return null; // Return null if not completed
}

async function waitForCompletion(threadId, runId) {
    return new Promise((resolve, reject) => {
        const maxAttempts = 30; // Maximum number of attempts
        let attempts = 0;
        const pollingInterval = setInterval(async () => {
            attempts++;
            try {
                const answer = await checkingStatus(threadId, runId);
                if (answer) {
                    clearInterval(pollingInterval);
                    resolve(answer);
                } else if (attempts >= maxAttempts) {
                    clearInterval(pollingInterval);
                    reject(new Error("Timeout: Assistant did not complete in time"));
                }
            } catch (error) {
                clearInterval(pollingInterval);
                reject(error);
            }
        }, 2000); // Poll every 2 seconds
    });
}

async function runAssistant(assistantID,threadId) {
    console.log('Running assistant for thread: ' + threadId);
    const response = await openai.beta.threads.runs.create(
        threadId,
        {
            assistant_id: assistantID
        }
    );

    const runId = response.id;

    const answer = await waitForCompletion(threadId, runId);
    return answer;
}

async function handleOpenAIAssistant(message, threadID) {
    console.log(ghlConfig.assistantId);
    const assistantId = ghlConfig.assistantId;
    await addMessage(threadID, message);
    const answer = await runAssistant(assistantId,threadID);
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

module.exports = { handleNewMessagesCNB };