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


const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();

let ghlConfig = {};

// Schedule the task to run every 12 hours

const openai = new OpenAI({
    apiKey: process.env.OPENAIKEY,
});

let employees = [];
let currentEmployeeIndex = 0;

// Add these new state tracking variables at the top with other globals
let assignmentCounts = {};
let totalAssignments = 0;
const RESET_THRESHOLD = 100;
const BATCH_SIZE = 10; // We'll distribute in smaller batches for better rotation

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
async function loadAssignmentState(idSubstring) {
    const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentState');
    const doc = await stateRef.get();
    if (doc.exists) {
        const data = doc.data();
        return {
            counts: data.counts || {},
            total: data.total || 0,
            lastAssignedEmployee: data.lastAssignedEmployee || null
        };
    }
    return {
        counts: {},
        total: 0,
        lastAssignedEmployee: null
    };
}

async function storeAssignmentState(idSubstring, counts, total, lastAssignedEmployee) {
    const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentState');
    const stateToStore = {
        counts,
        total,
        lastAssignedEmployee,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    };

    await stateRef.set(stateToStore);
    console.log('Assignment state stored in Firebase:', stateToStore);
}

async function assignNewContactToEmployee(contactID, idSubstring, client) {
    try {
        // Load both assignment counts and last assigned employee state
        await loadAssignmentCounts(idSubstring);
        const state = await loadAssignmentState(idSubstring);
        const lastAssignedEmployee = state.lastAssignedEmployee;
        
        const employees = await fetchEmployeesFromFirebase(idSubstring);
        console.log('All employees:', employees);

        // Filter out inactive employees and last assigned employee
        const availableEmployees = employees.filter(emp => 
            emp.weightage > 0 && 
            (!lastAssignedEmployee || emp.email !== lastAssignedEmployee)
        );
        console.log('Available employees:', availableEmployees);

        if (availableEmployees.length === 0) {
            // If no employees available after filtering out last assigned,
            // try again with all active employees
            const allActiveEmployees = employees.filter(emp => emp.weightage > 0);
            if (allActiveEmployees.length === 0) {
                console.log('No available employees found for assignment');
                return null;
            }
            availableEmployees.push(...allActiveEmployees);
        }

        // Validate total weightage
        const totalWeightage = availableEmployees.reduce((sum, emp) => sum + emp.weightage, 0);
        console.log('Total weightage:', totalWeightage);

        // Initialize counts for new employees
        availableEmployees.forEach(emp => {
            if (!assignmentCounts[emp.email]) {
                assignmentCounts[emp.email] = 0;
            }
        });

        // Calculate assignment percentages and targets
        const employeeAllocations = availableEmployees.map(emp => {
            const normalizedWeight = (emp.weightage / totalWeightage) * 100;
            const targetForBatch = Math.round((normalizedWeight / 100) * BATCH_SIZE);
            const totalTarget = Math.round((normalizedWeight / 100) * RESET_THRESHOLD);
            
            return {
                ...emp,
                normalizedWeight,
                allocated: assignmentCounts[emp.email] || 0,
                batchTarget: Math.max(1, targetForBatch), // Ensure at least 1
                totalTarget: Math.max(1, totalTarget), // Ensure at least 1
                batchAllocated: Math.floor((assignmentCounts[emp.email] || 0) % BATCH_SIZE)
            };
        });

        console.log('Employee allocations:', employeeAllocations.map(emp => ({
            name: emp.name,
            weight: emp.weightage,
            normalizedWeight: emp.normalizedWeight,
            allocated: emp.allocated,
            batchTarget: emp.batchTarget,
            batchAllocated: emp.batchAllocated
        })));

    // Find the employee who is furthest behind their proportional target
let assignedEmployee = employeeAllocations.reduce((prev, curr) => {
    // Skip the last assigned employee
    if (curr.email === lastAssignedEmployee) {
        return prev;
    }

    // Calculate how far behind target each employee is
    const prevBehindTarget = prev.batchTarget - prev.batchAllocated;
    const currBehindTarget = curr.batchTarget - curr.batchAllocated;
    
    // If current employee is more behind target than previous
    if (currBehindTarget > prevBehindTarget) {
        return curr;
    }
    
    // If equally behind, prefer the one with fewer total allocations
    if (currBehindTarget === prevBehindTarget) {
        if (curr.allocated < prev.allocated) {
            return curr;
        }
        // If allocations are equal, prefer higher weightage
        if (curr.allocated === prev.allocated && curr.weightage > prev.weightage) {
            return curr;
        }
    }
    
    return prev;
}, employeeAllocations[0]);

// If no valid employee found (all at or over target), pick the one with least allocations
if (!assignedEmployee || assignedEmployee.email === lastAssignedEmployee) {
    assignedEmployee = employeeAllocations
        .filter(emp => emp.email !== lastAssignedEmployee)
        .reduce((prev, curr) => 
            curr.allocated < prev.allocated ? curr : prev
        );
}

// Reset if all employees have reached their targets
if (!assignedEmployee || assignedEmployee.allocated >= assignedEmployee.totalTarget) {
    console.log('Resetting counts as all targets reached');
    assignmentCounts = {};
    totalAssignments = 0;
    
    // Prevent infinite recursion
    if (global.resetCount = (global.resetCount || 0) + 1 > 3) {
        console.error('Max reset attempts reached');
        global.resetCount = 0;
        return null;
    }
    
    // Clear both assignment counts and state
    await storeAssignmentCounts(idSubstring);
    await storeAssignmentState(idSubstring, {}, 0, null);
    return assignNewContactToEmployee(contactID, idSubstring, client);
}

        // Update counts
        assignmentCounts[assignedEmployee.email] = (assignmentCounts[assignedEmployee.email] || 0) + 1;
        totalAssignments++;

        // Store both updated counts and state
        await storeAssignmentCounts(idSubstring);
        await storeAssignmentState(
            idSubstring, 
            assignmentCounts, 
            totalAssignments, 
            assignedEmployee.email
        );

        console.log(`Assigned to ${assignedEmployee.name} (${assignmentCounts[assignedEmployee.email]}/${assignedEmployee.totalTarget} leads, Weight: ${assignedEmployee.weightage}%)`);
        
        // Add tag and prepare return data
        await addtagbookedFirebase(contactID, assignedEmployee.name, idSubstring);
        const employeeID = assignedEmployee.phoneNumber.replace(/\s+/g, '').split('+')[1] + '@c.us';
        const assignedName = assignedEmployee.email.split('@')[0];

        return {
            assigned: assignedName,
            number: employeeID,
            email: assignedEmployee.email
        };
    } catch (error) {
        console.error('Error in assignNewContactToEmployee:', error);
        return null;
    }
}


// Make sure this function is updated to return the correct employee data structure
async function fetchEmployeesFromFirebase(idSubstring) {
    const employeesRef = db.collection('companies').doc(idSubstring).collection('employee');
    const snapshot = await employeesRef.get();

    const employees = [];

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.name && data.phoneNumber) {
            employees.push({
                name: data.name,
                phoneNumber: data.phoneNumber,
                weightage: data.weightage || 0,
                email: data.email || '',
                // Add other fields as needed
            });
        }
    });

    console.log('Fetched employees:', employees);
    return employees;
}

const steps = {
    START: 'start',
};
const userState = new Map();

async function customWait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
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
                      pageCount: msg._data.pageCount || 0,
                      fileSize: msg._data.size || 0,
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

const messageQueue = new Map();
const MAX_QUEUE_SIZE = 5;
const RATE_LIMIT_DELAY = 5000; // 5 seconds

async function handleNewMessagesBillert(client, msg, botName, phoneIndex) {
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
                            pageCount: msg._data.pageCount || 0,
                            fileSize: msg._data.size || 0,
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
            if (contactData !== null) {
                console.log('Existing contact, no assignment needed');

            }else{

                // New contact, check if already assigned
            const assignmentRef = db.collection('companies').doc(idSubstring).collection('assignments').doc(extractedNumber);
            const assignmentDoc = await assignmentRef.get();

            if (!assignmentDoc.exists) {
                // Contact not yet assigned, proceed with assignment
                await customWait(2500); 

                contactID = extractedNumber;
                contactName = contact.pushname || contact.name || extractedNumber;

                const assignmentResult = await assignNewContactToEmployee(contactID, idSubstring, client);
                let assigned = assignmentResult.assigned;
                let number = assignmentResult.number;
                let email = assignmentResult.email;
                console.log("assigned: "+assigned);
                console.log("number: "+number);
                console.log("email: "+email);
                
                // Save the assignment first
                await assignmentRef.set({
                    assigned: assigned,
                    number: number,
                    email: email,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                // Add retry logic for sending media and notes
                let retryCount = 0;
                const maxRetries = 3;
                let mediaSuccess = false;
                let notesSuccess = false;

                while (((!mediaSuccess || !notesSuccess) && retryCount < maxRetries)) {
                    try {
                        // Fetch user data from Firebase
                        const userRef = db.collection('user').doc(email);
                        const userDoc = await userRef.get();
                        let userImageUrl = '';
                        let userNotes = '';

                        if (userDoc.exists) {
                            const userData = userDoc.data();
                            userImageUrl = userData.imageUrl || '';
                            userNotes = userData.notes || '';
                        }

                        console.log("userImageUrl: "+userImageUrl);
                        console.log("userNotes: "+userNotes);

                        // Send user's image if available and not already sent
                        if (userImageUrl && !mediaSuccess) {
                            await customWait(3000); // Wait before sending media
                            const media = await MessageMedia.fromUrl(userImageUrl);
                            const imageMessage = await client.sendMessage(sender.to, media);
                            await addMessagetoFirebase(imageMessage, idSubstring, extractedNumber, contactName);
                            mediaSuccess = true;
                            await customWait(2000); // Wait after sending media
                        } else {
                            mediaSuccess = true; // Skip if no image
                        }

                        // Send user's notes if available and not already sent
                        if (userNotes && !notesSuccess) {
                            const formattedNotes = userNotes
                                .replace(/<p>/g, '') // Remove opening <p> tags
                                .replace(/<\/p>/g, '\n') // Replace closing </p> tags with newline
                                .replace(/&nbsp;/g, '\n') // Replace &nbsp; with newline
                                .replace(/\*([^*]+)\*/g, '*$1*') // Preserve WhatsApp bold formatting
                                .replace(/\n\s*\n\s*\n/g, '\n\n') // Replace triple newlines with double
                                .replace(/\n\s*\n/g, '\n\n') // Standardize double newlines
                                .trim(); // Remove leading/trailing whitespace

                            const notesMessage = await client.sendMessage(sender.to, formattedNotes);
                            await addMessagetoFirebase(notesMessage, idSubstring, extractedNumber, contactName);
                            notesSuccess = true;
                        } else {
                            notesSuccess = true; // Skip if no notes
                        }

                    } catch (error) {
                        console.error(`Retry ${retryCount + 1} failed:`, error);
                        retryCount++;
                        await customWait(2000 * (retryCount + 1)); // Exponential backoff
                    }
                }

                // Send assignment notification message
                try {
                    function getCurrentDate() {
                        const date = new Date();
                        const options = { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric' };
                        const [day, month, year] = date.toLocaleDateString('en-GB', options).split('/');
                        return `${day}/${month}/${year}`;
                    }
                    const currentDate = getCurrentDate();
                    const custNumber = sender.to.split('@')[0];
                    const message2 = `Hi *${assigned}*\n\n` +
                        `Anda terima Leads baru 🚀\n\n` +
                        `No Phone : *+${custNumber}*\n\n`+
                        `Tarikh : *${currentDate}*\n\n`+
                        `Good Luck !`;
                    const msg2 = await client.sendMessage(number, message2);
                    await addMessagetoFirebase(msg2, idSubstring, number, assigned);
                } catch (error) {
                    console.error('Error sending assignment notification:', error);
                }

                console.log('New contact assigned and messages sent');
            } else {
                console.log('Contact already assigned, skipping reassignment');
            }



            }    
            return;
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


                    answer= await handleOpenAIAssistant(query,threadID);
                    parts = answer.split(/\s*\|\|\s*/);

                    await customWait(10000);
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
            console.log("error from handleNewMessagesBillert: "+error)
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

async function attemptAssignment(client, sender, extractedNumber, idSubstring, contact, retries = 3) {
    const assignmentRef = db.collection('companies').doc(idSubstring).collection('assignments').doc(extractedNumber);
    
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            // Wait for a short period before attempting assignment
            await customWait(2000 * (attempt + 1));  // Increasing wait time for each retry

            const assigned = await db.runTransaction(async (transaction) => {
                const assignmentDoc = await transaction.get(assignmentRef);
                
                if (!assignmentDoc.exists) {
                    const contactID = extractedNumber;
                    const contactName = contact.pushname || contact.name || extractedNumber;

                    const assignmentResult = await assignNewContactToEmployee(contactID, idSubstring, client);
                    let assigned = assignmentResult.assigned;
                    let number = assignmentResult.number;
                    let email = assignmentResult.email;
                    
                    console.log(`Attempt ${attempt + 1} - Assigned: ${assigned}, Number: ${number}, Email: ${email}`);
                    
                    // Save the assignment within the transaction
                    transaction.set(assignmentRef, {
                        assigned: assigned,
                        number: number,
                        email: email,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });

                    return { assigned, number, email, contactName };
                } else {
                    console.log(`Contact already assigned (checked on attempt ${attempt + 1})`);
                    return null;  // No assignment needed
                }
            });

            if (assigned) {
                // Perform the rest of the assignment tasks outside the transaction
                await performAssignmentTasks(client, sender, assigned.assigned, assigned.number, assigned.email, extractedNumber, idSubstring, assigned.contactName);
                console.log(`New contact assigned on attempt ${attempt + 1}`);
                return;  // Exit the function after successful assignment
            } else if (assigned === null) {
                return;  // Exit the function if already assigned
            }
            // If assigned is undefined, it means the transaction failed, so we'll retry
        } catch (error) {
            console.error(`Assignment attempt ${attempt + 1} failed:`, error);
            if (attempt === retries - 1) {
                throw new Error('Max retries reached for assignment');
            }
        }
    }
}

module.exports = { handleNewMessagesBillert };
