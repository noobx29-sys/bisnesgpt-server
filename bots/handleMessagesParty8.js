// handleMessagesTemplateWweb.js

//STEP BY STEP GUIDE
//1. CHANGE all handleMessagesTemplate to -> handleMessages<YourBotName>
//2. CHANGE all idSubstring to firebase collection name
//3. CHANGE all <assistant> to openai assistant id
//4. CHANGE all Template to your <YourBotName>

var OpenAI = require('openai');
var axios = require('axios').default;
var { Client } = require('whatsapp-web.js');

var { v4: uuidv4 } = require('uuid');

var { URLSearchParams } = require('url');
var admin = require('../firebase.js');
var db = admin.firestore();

let ghlConfig = {};
var { google } = require('googleapis');

// Set up Google Sheets API
var auth = new google.auth.GoogleAuth({
  keyFile: './service_account.json', // Replace with your credentials file path
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

var sheets = google.sheets({ version: 'v4', auth });
// Schedule the task to run every 12 hours

var openai = new OpenAI({
    apiKey: process.env.OPENAIKEY,
});

var steps = {
    START: 'start',
};
var userState = new Map();

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
                group: data.group,
                role: data.role || '2', // Default to sales role if not specified
                weightage: data.weightage || 1 // Default weightage to 1 if not specified
            });
        }
    });

    console.log('Fetched employees:', employees);
    await loadAssignmentState(idSubstring);
}

async function loadAssignmentState(idSubstring) {
    var stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentState');
    var doc = await stateRef.get();
    if (doc.exists) {
        var data = doc.data();
        currentEmployeeIndex = data.currentEmployeeIndex;
        console.log('Assignment state loaded from Firebase:', data);
    } else {
        console.log('No previous assignment state found');
        currentEmployeeIndex = 0;
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
async function storeAssignmentState(idSubstring) {
    var stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentState');
    var stateToStore = {
        currentEmployeeIndex: currentEmployeeIndex,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    };

    await stateRef.set(stateToStore);
    console.log('Assignment state stored in Firebase:', stateToStore);
}

// Add this new function to fetch sales employees
async function fetchSalesFromFirebase(idSubstring, group) {
    var salesRef = db.collection('companies').doc(idSubstring).collection('sales');
    var snapshot = await salesRef.where('group', '==', group).get();
    
    sales = [];
    
    console.log(`Total documents in sales collection for group ${group}: ${snapshot.size}`);

    snapshot.forEach(doc => {
        var data = doc.data();
        console.log(`Processing sales document:`, data);

        if (data.name && data.weightage) {
            sales.push({
                name: data.name,
                email: data.email,
                phoneNumber: data.phoneNumber,
                weightage: data.weightage
            });
            console.log(`Added sales employee ${data.name}`);
        } else {
            console.log(`Skipped sales employee due to missing name or weightage:`, data);
        }
    });

    console.log('Fetched sales employees:', sales);
}

async function assignNewContactToEmployee(contactID, idSubstring, client, contactName) {
    if (employees.length === 0) {
        await fetchEmployeesFromFirebase(idSubstring);
    }

    console.log('Employees:', employees);

    if (employees.length === 0) {
        console.log('No employees found for assignment');
        return [];
    }

    const tags = [];
    const contactData = await getContactDataFromDatabaseByPhone(contactID, idSubstring);
    const updatedContactName = contactData?.contactName || contactName || 'Not provided';

    // Filter employees by role
    const managers = employees.filter(emp => emp.role === "4");
    const salesEmployees = employees.filter(emp => emp.role === "2");
    const admins = employees.filter(emp => emp.role === "1");

    let assignedManager = null;
    let assignedSales = null;

    // Assign to manager if available
    if (managers.length > 0) {
        assignedManager = managers[Math.floor(Math.random() * managers.length)];
        await assignToEmployee(assignedManager, "Manager", contactID, updatedContactName, client, idSubstring);
        tags.push(assignedManager.name, assignedManager.phoneNumber);
    }

    // Assign to sales if available
    if (salesEmployees.length > 0) {
        // Calculate total weightage
        const totalWeight = salesEmployees.reduce((sum, emp) => sum + (emp.weightage || 1), 0);
        const randomValue = Math.random() * totalWeight;

        let cumulativeWeight = 0;
        for (const emp of salesEmployees) {
            cumulativeWeight += emp.weightage || 1;
            if (randomValue <= cumulativeWeight) {
                assignedSales = emp;
                break;
            }
        }

        if (assignedSales) {
            await assignToEmployee(assignedSales, "Sales", contactID, updatedContactName, client, idSubstring);
            tags.push(assignedSales.name, assignedSales.phoneNumber);
        }
    }

    // If no manager and no sales, assign to admin
    if (!assignedManager && !assignedSales && admins.length > 0) {
        const assignedAdmin = admins[Math.floor(Math.random() * admins.length)];
        await assignToEmployee(assignedAdmin, "Admin", contactID, updatedContactName, client, idSubstring);
        tags.push(assignedAdmin.name, assignedAdmin.phoneNumber);
    }

    await storeAssignmentState(idSubstring);

    return tags;
}

async function assignToEmployee(employee, role, contactID, contactName, client, idSubstring) {
    const employeeID = employee.phoneNumber.split('+')[1] + '@c.us';

    await client.sendMessage(employeeID, `Hello ${employee.name}, a new contact has been assigned to you as ${role}:

Name: ${contactName}
Phone: ${contactID}

Kindly login to https://web.jutasoftware.co/login

Thank you.

Juta Teknologi`);

    await addtagbookedFirebase(contactID, employee.name, idSubstring);
    console.log(`Assigned ${role}: ${employee.name}`);
}

async function addNotificationToUser(companyId, message, contactName) {
    console.log('Adding notification and sending FCM');
    try {
        // Find the user with the specified companyId
        var usersRef = db.collection('user');
        var querySnapshot = await usersRef.where('companyId', '==', companyId).get();

        if (querySnapshot.empty) {
            console.log('No matching documents.');
            return;
        }

        // Filter out undefined values and reserved keys from the message object
        var cleanMessage = Object.fromEntries(
            Object.entries(message)
                .filter(([key, value]) => value !== undefined && !['from', 'notification', 'data'].includes(key))
                .map(([key, value]) => {
                    if (key === 'text' && typeof value === 'object') {
                        return [key, { body: value.body || '' }];
                    }
                    return [key, typeof value === 'object' ? JSON.stringify(value) : String(value)];
                })
        );

        // Add sender information to cleanMessage
        cleanMessage.senderName = contactName || 'Unknown';

        // Prepare the FCM message
        var fcmMessage = {
            notification: {
                title: contactName || 'New Message',
                body: cleanMessage.text?.body || 'New message received'
            },
            data: {
                ...cleanMessage,
                text: JSON.stringify(cleanMessage.text || {}), // Stringify the text object for FCM
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                sound: 'default'
            },
            topic: companyId // Specify the topic here
        };

        // Add the new message to Firestore for each user
        var promises = querySnapshot.docs.map(async (doc) => {
            var userRef = doc.ref;
            var notificationsRef = userRef.collection('notifications');
            var updatedMessage = { 
                ...cleanMessage, 
                read: false, 
                from: contactName || 'Unknown',
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            };
        
            await notificationsRef.add(updatedMessage);
            console.log(`Notification added to Firestore for user with companyId: ${companyId}`);
        });

        await Promise.all(promises);

        // Send FCM message to the topic
        await admin.messaging().send(fcmMessage);
        console.log(`FCM notification sent to topic '${companyId}'`);

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
        var media = await msg.downloadMedia();
        var transcription = await transcribeAudio(media.data);
        console.log('Transcription:', transcription);
                
        messageBody = transcription;
        audioData = media.data;
        console.log(msg);
    }
    var messageData = {
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
        var quotedMsg = await msg.getQuotedMessage();
        // Initialize the context and quoted_content structure
        messageData.text.context = {
          quoted_content: {
            body: quotedMsg.body
          }
        };
        var authorNumber = '+'+(quotedMsg.from).split('@')[0];
        var authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
        messageData.text.context.quoted_author = authorData ? authorData.contactName : authorNumber;
    }

    if((msg.from).includes('@g.us')){
        var authorNumber = '+'+(msg.author).split('@')[0];

        var authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
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
            var media = await msg.downloadMedia();
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
                    var videoUrl = await storeVideoData(media.data, msg._data.filename);
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

    var contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
    var messagesRef = contactRef.collection('messages');

    var messageDoc = messagesRef.doc(msg.id._serialized);
    await messageDoc.set(messageData, { merge: true });
    console.log(messageData);
    await addNotificationToUser(idSubstring, messageData, contactName);
}


async function getChatMetadata(chatId,) {
    var url = `https://gate.whapi.cloud/chats/${chatId}`;
    var headers = {
        'Authorization': `Bearer ${ghlConfig.whapiToken}`,
        'Accept': 'application/json'
    };

    try {
        var response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        console.error('Error fetching chat metadata:', error.response.data);
        throw error;
    }
}
async function transcribeAudio(audioData) {
    try {
        var formData = new FormData();
        formData.append('file', Buffer.from(audioData, 'base64'), {
            filename: 'audio.ogg',
            contentType: 'audio/ogg',
        });
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'json');

        var response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
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

const MESSAGE_BUFFER_TIME = 0; // 1 minute in milliseconds
const messageBuffers = new Map();

async function handleNewMessagesParty8(client, msg, botName, phoneIndex) {
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
 
        // Define contactRef and messagesRef
        const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
        const messagesRef = contactRef.collection('messages');
 
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
       /*  if (msg.fromMe){
            await handleOpenAIMyMessage(msg.body,threadID);
            return;
        }*/
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
 
         // Use messagesRef when saving the message
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
        // Set up the daily report schedule
      //  await checkAndScheduleDailyReport(client, idSubstring);

        const sender = {
            to: msg.from,
            name: msg.notifyName,
        };

        const extractedNumber = '+'+(sender.to).split('@')[0];

        // Define contactRef and messagesRef
        const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
        const messagesRef = contactRef.collection('messages');

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
                if(!(sender.to.includes('@g.us')) || (combinedMessage.toLowerCase().startsWith('@juta') && phoneIndex == 0)){
                    answer = await handleOpenAIAssistant(query, threadID, stopTag, extractedNumber, idSubstring, client,contactData.contactName);
                    console.log(answer);
                    parts = answer.split(/\s*\|\|\s*/);
                    
                    for (let i = 0; i < parts.length; i++) {
                        const part = parts[i].trim();   
                        const check = part.toLowerCase();
                        if (part) {
                            var sentMessage = await client.sendMessage(msg.from, part);
    
                            // Save the message to Firebase
                            var sentMessageData = {
                                chat_id: sentMessage.from,
                                from: sentMessage.from ?? "",
                                from_me: true,
                                id: sentMessage.id._serialized ?? "",
                                source: sentMessage.deviceType ?? "",
                                status: "delivered",
                                text: {
                                    body: part
                                },
                                timestamp: sentMessage.timestamp,
                                type: 'text',
                                ack: sentMessage.ack ?? 0,
                            };
    
                            var messageDoc = messagesRef.doc(sentMessage.id._serialized);
    
                            await messageDoc.set(sentMessageData, { merge: true });
                            if (part.includes('get back to you')) {
                   
                                
                                // Generate and send the special report
                                var { reportMessage, contactInfo } = await generateSpecialReport(threadID, ghlConfig.assistantId);
                                var sentMessage2 = await client.sendMessage('120363325228671809@g.us', reportMessage)
                                await addMessagetoFirebase(sentMessage2,idSubstring,'+120363325228671809')
                                

                                // Initialize the data object with basic contact information
                                let data = {
                                    phone: extractedNumber,
                                    contactName: contactName || null, // Use null if contactName is undefined
                                    threadid: threadID
                                };

                                // Now update the data object with the extracted contact info
                                data = removeUndefined({
                                    ...data,
                                    contactName: contactInfo.contactName || contactName, // Use contactInfo.contactName if available, otherwise use existing contactName
                                    country: contactInfo.country,
                                    highestEducation: contactInfo.highestEducation,
                                    programOfStudy: contactInfo.programOfStudy,
                                    intakePreference: contactInfo.intakePreference,
                                    englishProficiency: contactInfo.englishProficiency,
                                    passport: contactInfo.passport,
                                    nationality: contactInfo.nationality,
                                });

                                // Then use this data object to update Firestore
                                await db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber).set(data, {merge: true});    
                                await addtagbookedFirebase(extractedNumber, 'stop bot', idSubstring);
                            }
                            if (part.includes('check with the team')) {
                   
                                
                                // Generate and send the special report
                                var { reportMessage, contactInfo } = await generateSpecialReport2(threadID, ghlConfig.assistantId);
                                var sentMessage2 = await client.sendMessage('120363325228671809@g.us', reportMessage)
                                await addMessagetoFirebase(sentMessage2,idSubstring,'+120363325228671809')

                            }
                            
                        }
                    }
                }//
                
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

async function updateGoogleSheet(report) {
    var spreadsheetId = '1V1iCai1Uf_gbWzWxmx9JrN9iL66azsqIsZ7Vr6k_y10'; // Replace with your spreadsheet ID
    var range = 'Form_Responses!A:U'; // Adjust based on your sheet name and range
  
    // Parse the report
    var lines = report.split('\n');
    var data = {};
    lines.forEach(line => {
      var [key, value] = line.split(':').map(s => s.trim());
      if (key && value) {
        data[key] = value;
      }
    });
  //
    // Prepare the row data
    var rowData = [
      new Date().toISOString(), // Submission Date
      data['Name'] || 'N/A',
      data['Country'] || 'N/A',
      data['Highest Educational Qualification'] || 'N/A',
      data['Program'] || 'N/A',
      data['Intake'] || 'N/A',
      data['Certificate'] || 'N/A',

    ];
  
    try {
      var response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [rowData],
        },
      });
  
      console.log(`${response.data.updates.updatedCells} cells appended.`);
      return response;
    } catch (err) {
      console.error('The API returned an error: ' + err);
      throw err;
    }
  }
  

async function generateSpecialReport(threadID, assistantId) {
    try {
        var currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
        var reportInstruction = `Please generate a report in the following format based on our conversation:

New Form Has Been Submitted

Date : ${currentDate}
1) Name: [Extract from conversation or from the number that the user texted]
2) Phone Number: [Extract from from the number that the user texted]
3) Country: [Extract from conversation]
4) Nationality: [Extract from conversation]
5) Your highest educational qualification: [Extract from conversation]
6) What program do you want to study: [Extract from conversation]
7) Which intake you want to join: [Extract from conversation]
8) Do you have any English proficiency certificate such as TOEFL / IELTS?: [Extract from conversation]
9) Do you have a valid passport?: [Extract from conversation]

Fill in the information in square brackets with the relevant details from our conversation. If any information is not available, leave it blank. Do not change the Date field.`;

        var response = await openai.beta.threads.messages.create(threadID, {
            role: "user",
            content: reportInstruction
        });

        var assistantResponse = await openai.beta.threads.runs.create(threadID, {
            assistant_id: assistantId
        });

        // Wait for the assistant to complete the task
        let runStatus;
        do {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
            runStatus = await openai.beta.threads.runs.retrieve(threadID, assistantResponse.id);
        } while (runStatus.status !== 'completed');

        // Retrieve the assistant's response
        var messages = await openai.beta.threads.messages.list(threadID);
        var reportMessage = messages.data[0].content[0].text.value;

        var contactInfo = extractContactInfo(reportMessage);


        return { reportMessage, contactInfo };
    } catch (error) {
        console.error('Error generating special report:', error);
        return 'Error generating report';
    }
}

async function generateSpecialReport2(threadID, assistantId) {
    try {
        var currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
        var reportInstruction = `Please generate a enquiry notification in the following format based on our conversation:

New Enquiry Has Been Submitted

Date : ${currentDate}
1) Name: [Extract from conversation or from the number that the user texted]
2) Phone Number: [Extract from from the number that the user texted]
3) Enquiry: [Extract from conversation]

Fill in the information in square brackets with the relevant details from our conversation. If any information is not available, leave it blank. Do not change the Date field.`;

        var response = await openai.beta.threads.messages.create(threadID, {
            role: "user",
            content: reportInstruction
        });

        var assistantResponse = await openai.beta.threads.runs.create(threadID, {
            assistant_id: assistantId
        });

        // Wait for the assistant to complete the task
        let runStatus;
        do {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
            runStatus = await openai.beta.threads.runs.retrieve(threadID, assistantResponse.id);
        } while (runStatus.status !== 'completed');

        // Retrieve the assistant's response
        var messages = await openai.beta.threads.messages.list(threadID);
        var reportMessage = messages.data[0].content[0].text.value;

        var contactInfo = extractContactInfo2(reportMessage);


        return { reportMessage, contactInfo };
    } catch (error) {
        console.error('Error generating special report:', error);
        return 'Error generating report';
    }
}

function extractContactInfo(report) {
    var lines = report.split('\n');
    var contactInfo = {};

    for (var line of lines) {
        if (line.startsWith('1) Name:')) {  
            contactInfo.contactName = line.split(':')[1].trim();
        } 
        else if (line.startsWith('3) Country:')) {
            contactInfo.country = line.split(':')[1].trim();
        } else if (line.startsWith('4) Nationality:')) {
            contactInfo.nationality = line.split(':')[1].trim();
        } else if (line.startsWith('5) Your highest educational qualification:')) {
            contactInfo.highestEducation = line.split(':')[1].trim();
        } else if (line.startsWith('6) What program do you want to study:')) {
            contactInfo.programOfStudy = line.split(':')[1].trim();
        } else if (line.startsWith('7) Which intake you want to join:')) {
            contactInfo.intakePreference = line.split(':')[1].trim();
        } else if (line.startsWith('8) Do you have any English proficiency certificate')) {
            contactInfo.englishProficiency = line.split(':')[1].trim();
        } else if (line.startsWith('9) Do you have a valid passport?:')) {
            contactInfo.passport = line.split(':')[1].trim();
        } 
    }

    return contactInfo;
}

function extractContactInfo2(report) {
    var lines = report.split('\n');
    var contactInfo = {};

    for (var line of lines) {
        if (line.startsWith('1) Name:')) {  
            contactInfo.contactName = line.split(':')[1].trim();
        }
        else if (line.startsWith('3) Enquiry:')) {
            contactInfo.enquiry = line.split(':')[1].trim();
        }
    }

    return contactInfo;
}

async function removeTagBookedGHL(contactID, tag) {
    var options = {
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
        var response = await axios.request(options);
    } catch (error) {
        console.error('Error removing tag from contact:', error);
    }
}

async function storeVideoData(videoData, filename) {
    var bucket = admin.storage().bucket();
    var uniqueFilename = `${uuidv4()}_${filename}`;
    var file = bucket.file(`videos/${uniqueFilename}`);

    await file.save(Buffer.from(videoData, 'base64'), {
        metadata: {
            contentType: 'video/mp4', // Adjust this based on the actual video type
        },
    });

    var [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2500', // Adjust expiration as needed
    });

    return url;
}

async function getContactById(contactId) {
    var options = {
        method: 'GET',
        url: `https://services.leadconnectorhq.com/contacts/${contactId}`,
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-07-28',
            Accept: 'application/json'
        }
    };

    try {
        var response = await axios.request(options);
        return response.data.contact;
    } catch (error) {
        console.error(error);
    }
}

async function addtagbookedGHL(contactID, tag) {
    var contact = await getContactById(contactID);
    var previousTags = contact.tags || [];
    var options = {
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
    var thread = await openai.beta.threads.create();
    return thread;
}

async function addMessage(threadId, message) {
    var response = await openai.beta.threads.messages.create(
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
    var webhookUrl = webhook;
    var body = JSON.stringify({ senderText,thread}); // Include sender's text in the request body
    var response = await fetch(webhookUrl, {
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
        var contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
        var querySnapshot = await contactsRef.where('phone', '==', phoneNumber).get();

        if (querySnapshot.empty) {
            console.log('No matching documents.');
            return null;
        } else {
            var doc = querySnapshot.docs[0];
            var contactData = doc.data();
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
    var runObject = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
    );
    var status = runObject.status; 
    if(status == 'completed') {
        try{
            var messagesList = await openai.beta.threads.messages.list(threadId);
            var latestMessage = messagesList.body.data[0].content;

            console.log("Latest Message:");
            console.log(latestMessage[0].text.value);
            var answer = latestMessage[0].text.value;
            return answer;
        } catch(error){
            console.log("error from handleNewMessagesParty8: "+error)
            throw error;
        }
    }
    return null; // Return null if not completed
}

async function waitForCompletion(threadId, runId) {
    return new Promise((resolve, reject) => {
        var maxAttempts = 30; // Maximum number of attempts
        let attempts = 0;
        var pollingInterval = setInterval(async () => {
            attempts++;
            try {
                var answer = await checkingStatus(threadId, runId);
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
    var response = await openai.beta.threads.runs.create(
        threadId,
        {
            assistant_id: assistantID
        }
    );

    var runId = response.id;

    var answer = await waitForCompletion(threadId, runId);
    return answer;
}

async function handleOpenAIAssistant(message, threadID) {
    console.log(ghlConfig.assistantId);
    var assistantId = ghlConfig.assistantId;
    await addMessage(threadID, message);
    var answer = await runAssistant(assistantId,threadID);
    return answer;
}

async function sendWhapiRequest(endpoint, params = {}, method = 'POST') {
    console.log('Sending request to Whapi.Cloud...');
    var options = {
        method: method,
        headers: {
            Authorization: `Bearer ${ghlConfig.whapiToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
    };
    var url = `https://gate.whapi.cloud/${endpoint}`;
    var response = await fetch(url, options);
    var jsonResponse = await response.json();
    return jsonResponse;
}


async function saveThreadIDGHL(contactID,threadID){
    var options = {
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
    
    // varruct the Firestore document path
    var docPath = `companies/${idSubstring}/contacts/${contactID}`;

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
    var options = {
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
    var options = {
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
      var response = await axios.request(options);
      return(response.data.contact);
    } catch (error) {
        console.error(error);
    }
}


async function fetchConfigFromDatabase(idSubstring) {
    try {
        var docRef = db.collection('companies').doc(idSubstring);
        var doc = await docRef.get();
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

// Helper function to remove undefined values from an object
function removeUndefined(obj) {
    return Object.fromEntries(
        Object.entries(obj).filter(([_, v]) => v != null)
    );
}

module.exports = { handleNewMessagesParty8 };