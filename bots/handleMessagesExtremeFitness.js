// handleMessagesTemplateWweb.js

//STEP BY STEP GUIDE
//1. CHANGE all handleMessagesTemplate to -> handleMessages<YourBotName>
//2. CHANGE all idSubstring to firebase collection name
//3. CHANGE all <assistant> to openai assistant id
//4. CHANGE all Template to your <YourBotName>

const OpenAI = require('openai');
const axios = require('axios').default;
const { Client } = require('whatsapp-web.js');
const { google } = require('googleapis');
const moment = require('moment-timezone');
const { MessageMedia } = require('whatsapp-web.js');
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

async function checkScheduleConflicts(startDateTime, endDateTime) {
    try {
      console.log('Checking for scheduling conflicts...');
      
      const userRef = db.collection('user').doc('cryan@fitpropella.com');
      const appointmentsCollectionRef = userRef.collection('appointments');
  
      const conflictingAppointments = await appointmentsCollectionRef
            .where('startTime', '<', endDateTime)
            .where('endTime', '>', startDateTime)
            .get();
    
  
      if (!conflictingAppointments.empty) {
        console.log('Scheduling conflict found');
        return { 
          conflict: true, 
          conflictingAppointments: conflictingAppointments.docs.map(doc => doc.data())
        };
      }
  
      console.log('No scheduling conflicts found');
      return { conflict: false };
    } catch (error) {
      console.error('Error checking for scheduling conflicts:', error);
      return { conflict: true, error: error.message };
    }
  }


async function createCalendarEvent(summary, description, startDateTime, endDateTime, contactPhone, contactName) {
    try {
      console.log('Checking for conflicts before creating appointment...');
      const conflictCheck = await checkScheduleConflicts(startDateTime, endDateTime);
  
      if (conflictCheck.conflict) {
        if (conflictCheck.error) {
          return { error: `Failed to check for conflicts: ${conflictCheck.error}` };
        }
        return { 
          error: 'Scheduling conflict detected', 
          conflictingAppointments: conflictCheck.conflictingAppointments 
        };
      }
  
      console.log('Creating appointment...');

      const userRef = db.collection('user').doc('cryan@fitpropella.com');
      const appointmentsCollectionRef = userRef.collection('appointments');
      const newAppointmentRef = appointmentsCollectionRef.doc(); 
  
      const newAppointment = {
        id: newAppointmentRef.id,
        title: summary,
        startTime: startDateTime,
        endTime: endDateTime,
        address: description || "",
        appointmentStatus: 'new',
        staff: ["Conor"],
        color: "#1F3A8A", // Default color
        packageId: "",
        dateAdded: new Date().toISOString(),
        contacts: contactPhone && contactName ? [{
          id: contactPhone,
          name: contactName,
          session: null
        }] : [],
      };
  
      await newAppointmentRef.set(newAppointment);
  
      console.log('Appointment created successfully:', newAppointment);

      console.log('Appointment created successfully in Firebase:', newAppointment);

        // Create event in Google Calendar
        const auth = new google.auth.GoogleAuth({
            keyFile: './service_account.json', // Update this path
            scopes: ['https://www.googleapis.com/auth/calendar'],
        });

        const calendar = google.calendar({ version: 'v3', auth });

        const event = {
            summary: summary,
            description: `${description}\n\nContact: ${contactName} (${contactPhone})`,
            start: {
                dateTime: startDateTime,
                timeZone: 'Asia/Kuala_Lumpur', // Adjust timezone as needed
            },
            end: {
                dateTime: endDateTime,
                timeZone: 'Asia/Kuala_Lumpur', // Adjust timezone as needed
            },
        };

        const calendarResponse = await calendar.events.insert({
            calendarId: '8a46c8b8bae4bbf8732bc6b613272a6b3fcc79507e66de49bfc51a18b1aa146d@group.calendar.google.com', // Use 'primary' for the user's primary calendar
            resource: event,
        });

        // Format the date and time for better readability
        const startDate = new Date(startDateTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const startTime = new Date(startDateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const endTime = new Date(endDateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        return {
        success: true,
        message: 'Appointment created successfully',
        appointmentDetails: {
            title: summary,
            date: startDate,
            time: `${startTime} - ${endTime}`,
            description: description || "No description provided",
            contact: contactName ? `${contactName} (${contactPhone})` : "No contact information provided",
            staff: newAppointment.staff.join(", ")
        }
        };
    } catch (error) {
      console.error('Error in createCalendarEvent:', error);
      return { error: `Failed to create appointment: ${error.message}` };
    }
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

async function handleToolCalls(toolCalls, idSubstring, client,phoneNumber) {
    console.log('Handling tool calls...');
    const toolOutputs = [];
    for (const toolCall of toolCalls) {
        console.log(`Processing tool call: ${toolCall.function.name}`);
        switch (toolCall.function.name) {
            case 'createCalendarEvent':
                try {
                    console.log('Parsing arguments for createCalendarEvent...');
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log('Arguments:', args);
                    
                    console.log('Calling createCalendarEvent...');
                    const result = await createCalendarEvent(
                        args.summary, 
                        args.description, 
                        args.startDateTime, 
                        args.endDateTime,
                        args.contactPhone,
                        args.contactName
                    );
                    
                    if (result.error) {
                        if (result.error === 'Scheduling conflict detected') {
                            console.log('Scheduling conflict detected, preparing conflict information...');
                            toolOutputs.push({
                                tool_call_id: toolCall.id,
                                output: JSON.stringify({
                                    error: result.error,
                                    conflictingAppointments: result.conflictingAppointments
                                }),
                            });
                        } else {
                            console.error('Error creating event:', result.error);
                            toolOutputs.push({
                                tool_call_id: toolCall.id,
                                output: JSON.stringify({ error: result.error }),
                            });
                        }
                    } else {
                        console.log('Event created successfully, preparing tool output...');
                        toolOutputs.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify(result),
                        });
                    }
                } catch (error) {
                    console.error('Error in handleToolCalls for createCalendarEvent:');
                    console.error(error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }      
                break;
            case 'getTodayDate':
                console.log('Getting today\'s date...');
                const todayDate = getTodayDate();
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({ date: todayDate }),
                });
                break;
            default:
                console.warn(`Unknown function called: ${toolCall.function.name}`);
        }
    }
    console.log('Finished handling tool calls');
    return toolOutputs;
}

function getTodayDate() {
    return moment().tz('Asia/Kuala_Lumpur').format('YYYY-MM-DD');
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

async function assignNewContactToEmployee(contactID, idSubstring, client) {
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
    await client.sendMessage(employeeID, 'You have been assigned to ' + contactID);
    await addtagbookedFirebase(contactID, assignedEmployee.name, idSubstring);
    // Store the current state in Firebase
    await storeAssignmentState(idSubstring);

    return tags;
}

async function addNotificationToUser(companyId, message, contactName) {
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

const messageQueue = new Map();
const MAX_QUEUE_SIZE = 5;
const RATE_LIMIT_DELAY = 3000; // 5 seconds

async function handleNewMessagesExtremeFitness(client, msg, botName, phoneIndex) {
    console.log('Handling new Messages '+botName);

    //const url=req.originalUrl

    // Find the positions of the '/' characters
    //const firstSlash = url.indexOf('/');
    //const secondSlash = url.indexOf('/', firstSlash + 1);

    // Extract the substring between the first and second '/'
    //const idSubstring = url.substring(firstSlash + 1, secondSlash);
    const idSubstring = botName;
    try {

        // Initial fetch of config
        await fetchConfigFromDatabase(idSubstring);

        //const receivedMessages = req.body.messages;
            if (msg.fromMe){
                return;
            }

            const sender = {
                to: msg.from,
                name:msg.notifyName,
            };

            
            let contactID;
            let contactName;
            let threadID;
            let query;
            let answer;
            let parts;
            let currentStep;
            const extractedNumber = '+'+(sender.to).split('@')[0];
            const chat = await msg.getChat();
            const contactData = await getContactDataFromDatabaseByPhone(extractedNumber, idSubstring);
            let unreadCount = 0;
            let stopTag = contactData?.tags || [];
            const contact = await chat.getContact()

            console.log(contactData);
            if (contactData !== null) {
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
                        //await saveThreadIDGHL(contactID,threadID);
                    }
                
            }else{
                
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

            
                
            let type = '';
            if(msg.type == 'chat'){
                type ='text'
            }else if(msg.type == 'e2e_notification' || msg.type == 'notification_template'){
                return;
            }else{
                type = msg.type;
            }
                
            if(extractedNumber.includes('status')){
                return;
            }

            // First, let's handle the transcription if it's an audio message
            let messageBody = msg.body;
            let audioData = null;

            if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {
                console.log('Voice message detected');
                const media = await msg.downloadMedia();
                const transcription = await transcribeAudio(media.data);
                console.log('Transcription:', transcription);
                    
                messageBody = transcription;
                audioData = media.data;
                console.log(msg);
            }
            
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
                        type:type,
                    },
                },
                chat_id: msg.from,
                city: null,
                companyName: null,
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
            await addNotificationToUser(idSubstring, messageData);

            // Add the data to Firestore
            await db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber).set(data, {merge: true});    
        
            if (msg.fromMe){
                if(stopTag.includes('idle')){
                }
                return;
            }
            if(stopTag.includes('stop bot')){
                console.log('Bot stopped for this message');
                return;
            }

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

            currentStep = userState.get(sender.to) || steps.START;
            switch (currentStep) {
                case steps.START:
                    var context = "";

                    query = `${msg.body} user_name: ${contactName} `;
                    
                    
                    answer = await handleOpenAIAssistant(query, threadID, firebaseTags, extractedNumber, idSubstring,client);
                    parts = answer.split(/\s*\|\|\s*/);
                    
                    await customWait(3000);
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
                                timestamp: sentMessage.timestamp,
                                type: 'text',
                                ack: sentMessage.ack ?? 0,
                            };
    
                            const messageDoc = messagesRef.doc(sentMessage.id._serialized);
    
                            await messageDoc.set(sentMessageData, { merge: true });

                          
                            if(check.includes('helped over 1000 people')){
                                console.log("check")
                                const imagePath = 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/extremefitness.jpg?alt=media&token=4a8e6e55-dc29-40f3-b3ac-f955aa5d65ed'; // Update this URL to your image URL
                                const media = await MessageMedia.fromUrl(imagePath);
                                const imageMessage = await client.sendMessage(msg.from, media);
                                await addMessagetoFirebase(imageMessage, idSubstring, extractedNumber, contactName);
                            }

                            if(check.includes('let me get someone from our team to assist you with that ')){
                                await addtagbookedFirebase(extractedNumber,'stop bot',idSubstring);
                                await assignNewContactToEmployee(extractedNumber,idSubstring);

                            }
                            if (check.includes('patience')) {
                            } 
                            
                            if(check.includes('get back to you as soon as possible')){
                                console.log('check includes');
                            
                               await callWebhook("https://hook.us1.make.com/qoq6221v2t26u0m6o37ftj1tnl0anyut",check,threadID);
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
        return('All messages processed');
    } catch (e) {
        console.error('Error:', e.message);
        return(e.message);
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
    await addNotificationToUser(idSubstring, messageData, contactName);
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

async function addtagbookedFirebase(contactID, tag, idSubstring) {
    const docPath = `companies/${idSubstring}/contacts/${contactID}`;
    const contactRef = db.doc(docPath);

    try {
        // Get the current document
        const doc = await contactRef.get();
        let currentTags = [];

        if (doc.exists) {
            currentTags = doc.data().tags || [];
        }

        // Add the new tag if it doesn't already exist
        if (!currentTags.includes(tag)) {
            currentTags.push(tag);

            // Update the document with the new tags
            await contactRef.set({
                tags: currentTags
            }, { merge: true });

            console.log(`Tag "${tag}" added to contact ${contactID} in Firebase`);
        } else {
            console.log(`Tag "${tag}" already exists for contact ${contactID} in Firebase`);
        }
    } catch (error) {
        console.error('Error adding tag to Firebase:', error);
    }
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
            console.log("error from handleNewMessagesExtremeFitness: "+error)
            throw error;
        }
    }
    return null; // Return null if not completed
}

async function waitForCompletion(threadId, runId, idSubstring, client, depth = 0,phoneNumber) {
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
          const toolCalls = runObject.required_action.submit_tool_outputs.tool_calls;
          const toolOutputs = await handleToolCalls(toolCalls, idSubstring, client,phoneNumber);
          console.log('Submitting tool outputs...');
          await openai.beta.threads.runs.submitToolOutputs(threadId, runId, { tool_outputs: toolOutputs });
          console.log('Tool outputs submitted, restarting wait for completion...');
          return await waitForCompletion(threadId, runId, idSubstring, client, depth + 1);
        } else if (['failed', 'cancelled', 'expired'].includes(runObject.status)) {
          console.error(`Run ${runId} ended with status: ${runObject.status}`);
          return `I encountered an error (${runObject.status}). Please try your request again.`;
        }
  
        await new Promise(resolve => setTimeout(resolve, pollingInterval));
      } catch (error) {
        console.error(`Error in waitForCompletion (depth: ${depth}, runId: ${runId}): ${error}`);
        return "I'm sorry, but I encountered an error while processing your request. Please try again.";
      }
    }
  
    console.error(`Timeout: Assistant did not complete in time (depth: ${depth}, runId: ${runId})`);
    return "I'm sorry, but it's taking longer than expected to process your request. Please try again or rephrase your question.";
  }

async function runAssistant(assistantID,threadId, tools, idSubstring, client, phoneNumber) {
    console.log('Running assistant for thread: ' + threadId);
    const response = await openai.beta.threads.runs.create(
        threadId,
        {
            assistant_id: assistantID,
            tools: tools,
        }
    );

    const runId = response.id;

    const answer = await waitForCompletion(threadId, runId,idSubstring,client, 0,phoneNumber);
    return answer;
}

async function handleOpenAIAssistant(message, threadID, tags, phoneNumber, idSubstring, client) {
    console.log(ghlConfig.assistantId);
    let assistantId = ghlConfig.assistantId;
    if (tags !== undefined && tags.includes('team')) { 
        assistantId = ghlConfig.assistantIdTeam;
    } else if (tags !== undefined && tags.includes('demo')) {
        const contactData = await getContactDataFromDatabaseByPhone(phoneNumber, idSubstring);
        if (contactData && contactData.assistantId) {
            assistantId = contactData.assistantId;
        } else {
            console.warn(`Demo assistant not found for company: ${contactData?.companyName}`);
            // Fallback to default assistant if no matching demo assistant is found
            assistantId = ghlConfig.assistantIdTeam;
        }
    }
   
    await addMessage(threadID, message);
    

    const tools = [
        {
            type: "function",
            function: {
                name: "createCalendarEvent",
                description: "Schedule a meeting in Calendar. Always call getTodayDate first to get the current date as a reference.The contact name should be included in the title of the event.",
                parameters: {
                    type: "object",
                    properties: {
                        summary: { type: "string", description: "Title of the event" },
                        description: { type: "string", description: "Description or address of the event" },
                        startDateTime: { type: "string", description: "Start date and time in ISO 8601 format" },
                        endDateTime: { type: "string", description: "End date and time in ISO 8601 format" },
                        contactPhone: { type: "string", description: "Phone number of the contact" },
                        contactName: { type: "string", description: "Name of the contact" },
                    },
                    required: ["summary", "startDateTime", "endDateTime","contactName"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "getTodayDate",
                description: "Get today's date in YYYY-MM-DD format",
                parameters: {
                    type: "object",
                    properties: {},
                },
            },
        },
    ];
  
    const answer = await runAssistant(assistantId, threadID, tools, idSubstring, client,phoneNumber);
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

module.exports = { handleNewMessagesExtremeFitness };