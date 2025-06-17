// handleMessagesTemplateWweb.js

//STEP BY STEP GUIDE
//1. CHANGE all handleMessagesTemplate to -> handleMessages<YourBotName>
//2. CHANGE all idSubstring to firebase collection name
//3. CHANGE all <assistant> to openai assistant id
//4. CHANGE all Template to your <YourBotName>

const OpenAI = require('openai');
const axios = require('axios').default;
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
const responseTimers = new Map();

const userState = new Map();

async function customWait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

let employeeGroups = {};
let groupOrder = ['QueAD PRO v2', 'QueAD', 'KI-v2'];
let currentGroupIndex = 0;
let currentEmployeeIndices = {};

async function fetchEmployeesFromFirebase(idSubstring) {
    const employeesRef = db.collection('companies').doc(idSubstring).collection('employee');
    const snapshot = await employeesRef.get();
    
    employeeGroups = {};
    
    console.log(`Total documents in employee collection: ${snapshot.size}`);

    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`Processing employee document:`, data);

        if (data.group && data.name) {
            if (!employeeGroups[data.group]) {
                employeeGroups[data.group] = [];
            }
            employeeGroups[data.group].push({
                name: data.name,
                email: data.email,
                phoneNumber: data.phoneNumber,
                assignedContacts: data.assignedContacts || 0,
                employeeId: data.employeeId
            });
            console.log(`Added employee ${data.name} to group ${data.group}`);
        } else {
            console.log(`Skipped employee due to missing group or name:`, data);
        }
    });

    console.log('Fetched employee groups:', employeeGroups);
    console.log('Group order:', groupOrder);

    // Ensure all groups from groupOrder exist in employeeGroups
    groupOrder.forEach(group => {
        if (!employeeGroups[group]) {
            console.log(`Warning: Group ${group} from groupOrder not found in employee data`);
            employeeGroups[group] = [];
        }
    });

    // Load the previous assignment state
    await loadAssignmentState(idSubstring);
}

async function loadAssignmentState(idSubstring) {
    const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentState');
    const doc = await stateRef.get();
    if (doc.exists) {
        const data = doc.data();
        currentGroupIndex = data.currentGroupIndex;
        currentEmployeeIndices = data.currentEmployeeIndices;
        console.log('Assignment state loaded from Firebase:', data);
    } else {
        console.log('No previous assignment state found');
    }

    // Ensure all groups from groupOrder have an index
    for (const group of groupOrder) {
        if (currentEmployeeIndices[group] === undefined) {
            currentEmployeeIndices[group] = 0;
        }
    }
}

async function storeAssignmentState(idSubstring) {
    const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentState');
    const stateToStore = {
        currentGroupIndex: currentGroupIndex,
        currentEmployeeIndices: {},
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    };

    // Ensure all groups from groupOrder are included
    for (const group of groupOrder) {
        stateToStore.currentEmployeeIndices[group] = currentEmployeeIndices[group] || 0;
    }

    await stateRef.set(stateToStore);
    console.log('Assignment state stored in Firebase:', stateToStore);
}

async function assignNewContactToEmployee(contactID, idSubstring, client) {
    if (Object.keys(employeeGroups).length === 0) {
        await fetchEmployeesFromFirebase(idSubstring);
    }

    console.log('Employee Groups:', employeeGroups);
    console.log('Group Order:', groupOrder);
    console.log('Current Group Index:', currentGroupIndex);
    console.log('Current Employee Indices:', currentEmployeeIndices);

    if (Object.keys(employeeGroups).length === 0) {
        console.log('No employee groups found for assignment');
        return [];
    }
    
    let assignedEmployee = null;
    let currentGroup = null;

    // Check if the contact has the 'Big Trip' tag
    const contactData = await getContactDataFromDatabaseByPhone(contactID, idSubstring);
    const hasBigTripTag = contactData && contactData.tags && contactData.tags.includes('Big Trip');

    // If 'Big Trip' tag is present, only consider 'QueAD PRO v2' group
    const groupsToConsider = hasBigTripTag ? ['QueAD PRO v2'] : groupOrder;

    // Iterate through all groups in order, starting from the current index
    for (let i = 0; i < groupsToConsider.length; i++) {
        const groupIndex = hasBigTripTag ? 0 : (currentGroupIndex + i) % groupsToConsider.length;
        currentGroup = groupsToConsider[groupIndex];
        const employees = employeeGroups[currentGroup];

        console.log(`Checking group: ${currentGroup}`);

        if (employees && employees.length > 0) {
            if (currentEmployeeIndices[currentGroup] === undefined) {
                currentEmployeeIndices[currentGroup] = 0;
            }

            assignedEmployee = employees[currentEmployeeIndices[currentGroup]];
            
            // Move to the next employee in this group
            currentEmployeeIndices[currentGroup] = (currentEmployeeIndices[currentGroup] + 1) % employees.length;
            
            // Update the current group index for the next assignment
            if (!hasBigTripTag) {
                currentGroupIndex = (groupIndex + 1) % groupOrder.length;
            }
            
            console.log(`Assigned employee: ${assignedEmployee.name} from group: ${currentGroup}`);

            console.log(`Next group index: ${currentGroupIndex}`);
            break;
        } else {
            console.log(`Group ${currentGroup} is empty or undefined, moving to next group`);
        }
    }

    if (!assignedEmployee) {
        console.log('No available employees in any group');
        return [];
    }
    let tags;
    if(assignedEmployee.employeeId){
        tags = [currentGroup, assignedEmployee.name, assignedEmployee.employeeId];
    }else{
        tags = [currentGroup, assignedEmployee.name, assignedEmployee.phoneNumber];
    }
    
    
    console.log(`Contact ${contactID} assigned to ${assignedEmployee.name} in group ${currentGroup}`);

    // Store the current state in Firebase
    await storeAssignmentState(idSubstring);

    return tags;
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

const RESPONSE_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

// Add this function at the top level of your file
function setResponseTimer(chatId, client) {
    return setTimeout(async () => {
        const reminderMessage = "Maaf mengganggu. Adakah anda masih berminat untuk meneruskan perbualan? Jika ya, sila balas mesej ini. Jika tidak, tiada masalah. Terima kasih atas masa anda!";
        await client.sendMessage(chatId, reminderMessage);

    }, RESPONSE_TIMEOUT);
}


const messageQueue = new Map();
const MAX_QUEUE_SIZE = 5;
const RATE_LIMIT_DELAY = 5000; // 5 seconds

async function handleNewMessagesFirstPrint(client, msg, botName, phoneIndex) {
    console.log('Handling new Messages '+botName);

    // Clear any existing timer for this chat
    if (responseTimers.has(msg.from)) {
        clearTimeout(responseTimers.get(msg.from));
        responseTimers.delete(msg.from);
    }

    const idSubstring = botName;
    try {
        // Initial fetch of config
        await fetchConfigFromDatabase(idSubstring);

        if (msg.fromMe){
            return;
        }

        const sender = {
            to: msg.from,
            name: msg.notifyName,
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
        
        let firebaseTags = [];
        let unreadCount = 0;
        let stopTag = contactData?.tags || [];
        const contact = await chat.getContact()

        if (contactData === null) {
            const thread = await createThread();
            threadID = thread.id;
            contactID = extractedNumber;
            contactName = contact.pushname || contact.name || extractedNumber;
            await saveThreadIDFirebase(contactID, threadID, idSubstring)
            
            if ((sender.to).includes('@g.us')) {
                firebaseTags = ['stop bot'];
                
            }
        } else {
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
                    
                    firebaseTags = contactData.tags ?? [];
                    // Remove 'snooze' tag if present
                if(firebaseTags.includes('snooze')){
                    firebaseTags = firebaseTags.filter(tag => tag !== 'snooze');
                }
                
            
        }

        if(extractedNumber.includes('status')){
            return;
        }

        // Handle audio messages (including PTT)
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
        }

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

        const data = {
            additionalEmails: [],
            address1: null,
            assignedTo: null,
            businessId: null,
            phone:extractedNumber,
            tags:firebaseTags,
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
                    id: msg._data.id.id ?? "",
                    source: chat.deviceType ?? "",
                    status: "delivered",
                    text: {
                        body:msg.body ?? ""
                    },
                    timestamp: msg.timestamp ?? 0,
                    type: type,
                },
            },
            chat_id: msg.from,
            city: null,
            companyName: null,
            contactName: contactName || contact.name || contact.pushname || extractedNumber,
            unreadCount: unreadCount + 1,
            phoneIndex: phoneIndex,
            threadid: threadID ?? "",
            last_message: {
                chat_id: msg.from,
                from: msg.from ?? "",
                from_me: msg.fromMe ?? false,
                id: msg._data.id.id ?? "",
                source: chat.deviceType ?? "",
                status: "delivered",
                text: {
                    body:msg.body ?? ""
                },
                timestamp: msg.timestamp ?? 0,
                type: type,
            },
        };

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
            source: msg.deviceType ?? "",
            status: "delivered",
            text: {
                body: messageBody ?? ""
            },
            timestamp: msg.timestamp ?? 0,
            type: type,
            phoneIndex: phoneIndex,
        };
        if((sender.to).includes('@g.us')){
            const authorNumber = '+'+(msg.author).split('@')[0];

            const authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
            if(authorData){
                messageData.author = authorData.contactName;
            }else{
                messageData.author = msg.author;
            }

        }
        if (msg.type === 'audio') {
            messageData.audio = {
                mimetype: 'audio/ogg; codecs=opus', // Default mimetype for WhatsApp voice messages
                data: audioData // This is the base64 encoded audio data
            };
        }

        if (msg.hasMedia &&  msg.type !== 'audio') {
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
    
                    console.log('messageData: ',messageData)
                    console.log('media: ',media)
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

                query = `${messageBody} user_name: ${contact.pushname} `;
                
                answer = await handleOpenAIAssistant(query, threadID);
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
                            phoneIndex: phoneIndex,
                            ack: sentMessage.ack ?? 0,
                        };

                        const messageDoc = messagesRef.doc(sentMessage.id._serialized);
                        await messageDoc.set(sentMessageData, { merge: true });

                        
                        if(check.includes('terima kasih atas kerjasama anda')){
                            await addtagbookedFirebase(contactID, 'stop bot', idSubstring);
                            await addtagbookedFirebase(contactID, 'sent detail', idSubstring);
                            
                            const phoneName = await getPhoneName(ghlConfig, phoneIndex)
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
                                phoneIndex:phoneIndex,
                                ack: sentMessage.ack ?? 0,
                            };

                            const messageDoc = messagesRef.doc(sentMessage.id._serialized);
                            await messageDoc.set(sentMessageData, { merge: true });
                            const extractedInfo = await extractInfoFromAnswer(answer);
                            // Get formatted information from the assistant
                            const groupMessage = await getFormattedInfoFromAssistant(
                                threadID,
                                phoneName, 
                                extractedInfo,
                            );

                            // Send message to group chat
                            //const groupChatId = ghlConfig.groupChatId; // Assuming you have this in your config
                            await client.sendMessage('120363307039232399@g.us', groupMessage);
                        }
                    }
                }
                console.log('Response sent.');
                userState.set(sender.to, steps.START);
                break;
            default:
                console.error('Unrecognized step:', currentStep);
                break;
        }
        return('All messages processed');
    } catch (e) {
        console.error('Error:', e.message);
        return(e.message);
    }
}

// Add this function to extract information from the answer
async function extractInfoFromAnswer(answer) {
    const lines = answer.split('\n');
    const extractedInfo = {};

    for (const line of lines) {
        if (line.startsWith('Nama :')) {
            extractedInfo.name = line.split(':')[1].trim();
        } else if (line.startsWith('Quantity')) {
            extractedInfo.quantity = line.split(':')[1].trim();
        } else if (line.startsWith('Type :')) {
            extractedInfo.type = line.split(':')[1].trim();
        } else if (line.startsWith('Date :')) {
            extractedInfo.date = line.split(':')[1].trim();
        }
    }

    return extractedInfo;
}
// Function to get the phone name based on the phoneIndex
async function getPhoneName(config, phoneIndex) {
    const adjustedIndex = phoneIndex + 1; // Add 1 to phoneIndex
    const phoneField = `phone${adjustedIndex}`;
    return config[phoneField] || `Unknown Phone ${adjustedIndex}`;
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

async function getFormattedInfoFromAssistant(threadId, phoneName, extractedInfo) {
    const assistantId = ghlConfig.assistantId;
    
    // Add a message to the thread asking for the formatted information
    await addMessage(threadId, `Please format the following information into the template:

    [Phone Name] telah menerima maklumat tempahan jersey:
    - Nama: [name]
    - Quantity: [quantity]
    - Type: [type]
    - Date: [date]
    Terima kasih atas kerjasama anda

    Use the following information:
    Phone Name: ${phoneName}
    Name: ${extractedInfo.name || 'N/A'}
    Quantity: ${extractedInfo.quantity || 'N/A'}
    Type: ${extractedInfo.type || 'N/A'}
    Date: ${extractedInfo.date || 'N/A'}

    Provide ONLY the formatted output without any additional text or explanations.`);

    // Run the assistant to process this request
    const formattedInfo = await runAssistant(assistantId, threadId);
    return formattedInfo.trim(); // Trim any leading or trailing whitespace
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
const FormData = require('form-data');

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
            console.log("Messages list:", messagesList); // Add this line for debugging
            
            if (!messagesList.body || !messagesList.body.data || messagesList.body.data.length === 0) {
                console.log("No messages found in the thread");
                return null;
            }
            
            const latestMessage = messagesList.body.data[0].content;
            
            if (!latestMessage || latestMessage.length === 0) {
                console.log("Latest message is empty");
                return null;
            }
            
            console.log("Latest Message:");
            console.log(latestMessage[0].text.value);
            const answer = latestMessage[0].text.value;
            return answer;
        } catch(error){
            console.log("Error in checkingStatus: ", error);
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

async function addNewContactToFirebase(phone, name, tags, idSubstring) {
    const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(phone);
    
    const newContactData = {
        phone: phone,
        contactName: name || phone,
        tags: tags,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    try {
        await contactRef.set(newContactData);
        console.log(`New contact added to Firebase: ${phone}`);
    } catch (error) {
        console.error('Error adding new contact to Firebase:', error);
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

module.exports = { handleNewMessagesFirstPrint };