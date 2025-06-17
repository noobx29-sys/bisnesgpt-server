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

const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();

let ghlConfig = {};
const { google } = require('googleapis');
const { group } = require('console');

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

// Keep the global declaration
let employees = [];
let sales = [];
let currentEmployeeIndex = 0;

async function fetchEmployeesFromFirebase(idSubstring) {
    try {
        const employeesRef = db.collection('companies').doc(idSubstring).collection('employee');
        const snapshot = await employeesRef.get();
        
        // Clear the global employees array
        employees = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.name) {
                employees.push({
                    name: data.name,
                    email: data.email,
                    phoneNumber: data.phoneNumber,
                    weightage: data.weightage || 0, // Add default weightage
                    group: data.group,
                    assignedContacts: data.assignedContacts || 0
                });
            }
        });

        console.log('Fetched employees:', employees);
        await loadAssignmentState(idSubstring);
        return employees; // Return for immediate use if needed
    } catch (error) {
        console.error('Error fetching employees:', error);
        employees = []; // Clear global array on error
        return employees;
    }
}

async function fetchSalesFromFirebase(idSubstring, group) {
    const salesRef = db.collection('companies').doc(idSubstring).collection('sales');
    const snapshot = await salesRef.where('group', '==', group).get();
    
    sales = [];
    
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.name && data.weightage) {
            sales.push({
                name: data.name,
                email: data.email,
                phoneNumber: data.phoneNumber,
                weightage: data.weightage,
                group: data.group
            });
        }
    });

    console.log('Fetched sales:', sales);
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

const BATCH_SIZE = 10;
const RESET_THRESHOLD = 100;
let assignmentCounts = {};
let totalAssignments = 0;

async function loadAssignmentCounts(idSubstring) {
    const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentCounts');
    const doc = await stateRef.get();
    if (doc.exists) {
        const data = doc.data();
        assignmentCounts = data.counts || {};
        totalAssignments = data.total || 0;
        console.log('Assignment counts loaded:', assignmentCounts);
        console.log('Total assignments:', totalAssignments);
    }
}

async function storeAssignmentCounts(idSubstring) {
    const stateRef = db.collection('companies').doc(idSubstring).collection('botState').doc('assignmentCounts');
    await stateRef.set({
        counts: assignmentCounts,
        total: totalAssignments,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
}

async function assignNewContactToEmployeeKereta(contactID, idSubstring, client, contactName) {
    try {
        // Load current assignment counts
        await loadAssignmentCounts(idSubstring);
        
        // Fetch the latest employee list from Firebase
        await fetchEmployeesFromFirebase(idSubstring);
        if (!employees || employees.length === 0) {
            console.log('No employees found');
            return [];
        }
        console.log('All employees:', employees);

        // Filter for employees in 'Kereta' group and with positive weightage
        const availableEmployees = employees.filter(emp => 
            emp.weightage > 0 && 
            emp.group === 'Kereta'
        );
        console.log('Available Kereta employees:', availableEmployees);

        if (availableEmployees.length === 0) {
            console.log('No available Kereta employees found for assignment');
            return [];
        }

        // Reset counts if we've reached the threshold
        if (totalAssignments >= RESET_THRESHOLD) {
            console.log('Resetting assignment counts after reaching threshold');
            assignmentCounts = {};
            totalAssignments = 0;
        }

        // Initialize counts for new employees
        availableEmployees.forEach(emp => {
            if (!assignmentCounts[emp.email]) {
                assignmentCounts[emp.email] = 0;
            }
        });

        // Calculate the current batch number
        const currentBatch = Math.floor(totalAssignments / BATCH_SIZE);

        // Calculate target distributions for the current batch
        const employeeAllocations = availableEmployees.map(emp => ({
            ...emp,
            allocated: assignmentCounts[emp.email] || 0,
            batchTarget: Math.round((emp.weightage / 100) * BATCH_SIZE),
            totalTarget: Math.round((emp.weightage / 100) * RESET_THRESHOLD),
            batchAllocated: Math.floor((assignmentCounts[emp.email] || 0) % BATCH_SIZE)
        }));

        // Find the employee who is furthest behind their target
        let assignedEmployee = employeeAllocations.reduce((prev, curr) => {
            const prevDiff = prev.batchTarget - prev.batchAllocated;
            const currDiff = curr.batchTarget - curr.batchAllocated;
            
            if (currDiff > prevDiff && curr.allocated < curr.totalTarget) {
                return curr;
            }
            if (currDiff === prevDiff) {
                return (curr.allocated < prev.allocated && curr.allocated < curr.totalTarget) ? curr : prev;
            }
            return prev;
        }, employeeAllocations[0]);

        // If no suitable employee found, reset counts and try again
        if (!assignedEmployee || assignedEmployee.allocated >= assignedEmployee.totalTarget) {
            console.log('Batch completed or all employees reached targets, resetting counts');
            assignmentCounts = {};
            totalAssignments = 0;
            return assignNewContactToEmployee(contactID, idSubstring, client, 0, contactName);
        }

        // Update counts
        assignmentCounts[assignedEmployee.email] = (assignmentCounts[assignedEmployee.email] || 0) + 1;
        totalAssignments++;

        // Store updated counts
        await storeAssignmentCounts(idSubstring);

        console.log(`Assigned employee: ${assignedEmployee.name} (${assignmentCounts[assignedEmployee.email]}/${assignedEmployee.totalTarget} leads)`);

        // Fetch contact data and send notifications
        const contactData = await getContactDataFromDatabaseByPhone(contactID, idSubstring);
        const updatedContactName = contactData?.contactName || contactName || 'Not provided';
        
        // Convert employee phone number to WhatsApp ID based on phone index
        const employeeID = assignedEmployee.phoneNumber.split('+')[1] + '@c.us';

        // Send message to assigned employee using phone1 (Kereta)
        const messageContent = `Hello ${assignedEmployee?.name || 'Employee'}, a new contact has been assigned to you:

Name: ${updatedContactName}
Phone: ${contactID}

Kindly login to https://web.jutasoftware.co/login

Thank you.

Juta Teknologi`;

        // Send using phone1 since this is for Kereta
        await client.sendMessage(employeeID, messageContent);

        // Add tag to contact
        await addtagbookedFirebase(contactID, assignedEmployee.name, idSubstring);

        return [assignedEmployee.name, assignedEmployee.phoneNumber];
    } catch (error) {
        console.error('Error in assignNewContactToEmployee:', error);
        return [];
    }
}

async function assignNewContactToEmployee(contactID, idSubstring, client, phoneIndex, contactName) {
    try {
        // Load current assignment counts
        await loadAssignmentCounts(idSubstring);

        let group;

        if (phoneIndex === 0){
            group = 'Kereta';
        }else if (phoneIndex === 1){
            group = 'Motor';
        }
        
        // Fetch the latest employee list from Firebase
        await fetchEmployeesFromFirebase(idSubstring);
        if (!employees || employees.length === 0) {
            console.log('No employees found');
            return [];
        }
        console.log('All employees:', employees);

        // Filter for employees in the specified group and with positive weightage
        const availableEmployees = employees.filter(emp => 
            emp.weightage > 0 && 
            emp.group === group
        );
        console.log(`Available ${group} employees:`, availableEmployees);

        if (availableEmployees.length === 0) {
            console.log(`No available ${group} employees found for assignment`);
            return [];
        }

        // Reset counts if we've reached the threshold
        if (totalAssignments >= RESET_THRESHOLD) {
            console.log('Resetting assignment counts after reaching threshold');
            assignmentCounts = {};
            totalAssignments = 0;
        }

        // Initialize counts for new employees
        availableEmployees.forEach(emp => {
            if (!assignmentCounts[emp.email]) {
                assignmentCounts[emp.email] = 0;
            }
        });

        // Calculate the current batch number
        const currentBatch = Math.floor(totalAssignments / BATCH_SIZE);

        // Calculate target distributions for the current batch
        const employeeAllocations = availableEmployees.map(emp => ({
            ...emp,
            allocated: assignmentCounts[emp.email] || 0,
            batchTarget: Math.round((emp.weightage / 100) * BATCH_SIZE),
            totalTarget: Math.round((emp.weightage / 100) * RESET_THRESHOLD),
            batchAllocated: Math.floor((assignmentCounts[emp.email] || 0) % BATCH_SIZE)
        }));

        // Find the employee who is furthest behind their target
        let assignedEmployee = employeeAllocations.reduce((prev, curr) => {
            const prevDiff = prev.batchTarget - prev.batchAllocated;
            const currDiff = curr.batchTarget - curr.batchAllocated;
            
            if (currDiff > prevDiff && curr.allocated < curr.totalTarget) {
                return curr;
            }
            if (currDiff === prevDiff) {
                return (curr.allocated < prev.allocated && curr.allocated < curr.totalTarget) ? curr : prev;
            }
            return prev;
        }, employeeAllocations[0]);

        // If no suitable employee found, reset counts and try again
        if (!assignedEmployee || assignedEmployee.allocated >= assignedEmployee.totalTarget) {
            console.log('Batch completed or all employees reached targets, resetting counts');
            assignmentCounts = {};
            totalAssignments = 0;
            return assignNewContactToEmployee(contactID, idSubstring, client, phoneIndex, contactName);
        }

        // Update counts
        assignmentCounts[assignedEmployee.email] = (assignmentCounts[assignedEmployee.email] || 0) + 1;
        totalAssignments++;

        // Store updated counts
        await storeAssignmentCounts(idSubstring);

        console.log(`Assigned employee: ${assignedEmployee.name} (${assignmentCounts[assignedEmployee.email]}/${assignedEmployee.totalTarget} leads)`);

        // Fetch contact data and send notifications
        const contactData = await getContactDataFromDatabaseByPhone(contactID, idSubstring);
        const updatedContactName = contactData?.contactName || contactName || 'Not provided';
        
        // Convert employee phone number to WhatsApp ID based on phone index
        const employeeID = assignedEmployee.phoneNumber.split('+')[phoneIndex] + '@c.us';

        // Send message to assigned employee
        const messageContent = `Hello ${assignedEmployee?.name || 'Employee'}, a new contact has been assigned to you:

Name: ${updatedContactName}
Phone: ${contactID}

Kindly login to https://web.jutasoftware.co/login

Thank you.

Juta Teknologi`;

        await client.sendMessage(employeeID, messageContent);

        // Add tag to contact
        await addtagbookedFirebase(contactID, assignedEmployee.name, idSubstring);

        return [assignedEmployee.name, assignedEmployee.phoneNumber];
    } catch (error) {
        console.error('Error in assignNewContactToEmployee:', error);
        return [];
    }
}

async function assignNewContactToEmployeeMotor(contactID, idSubstring, client, contactName) {
    try {
        // Load current assignment counts
        await loadAssignmentCounts(idSubstring);
        
        // Fetch the latest employee list from Firebase
        await fetchEmployeesFromFirebase(idSubstring);
        if (!employees || employees.length === 0) {
            console.log('No employees found');
            return [];
        }
        console.log('All employees:', employees);

        // Filter for employees in 'Motor' group and with positive weightage
        const availableEmployees = employees.filter(emp => 
            emp.weightage > 0 && 
            emp.group === 'Motor'
        );
        console.log('Available Motor employees:', availableEmployees);

        if (availableEmployees.length === 0) {
            console.log('No available Motor employees found for assignment');
            return [];
        }

        // Reset counts if we've reached the threshold
        if (totalAssignments >= RESET_THRESHOLD) {
            console.log('Resetting assignment counts after reaching threshold');
            assignmentCounts = {};
            totalAssignments = 0;
        }

        // Initialize counts for new employees
        availableEmployees.forEach(emp => {
            if (!assignmentCounts[emp.email]) {
                assignmentCounts[emp.email] = 0;
            }
        });

        // Calculate the current batch number
        const currentBatch = Math.floor(totalAssignments / BATCH_SIZE);

        // Calculate target distributions for the current batch
        const employeeAllocations = availableEmployees.map(emp => ({
            ...emp,
            allocated: assignmentCounts[emp.email] || 0,
            batchTarget: Math.round((emp.weightage / 100) * BATCH_SIZE),
            totalTarget: Math.round((emp.weightage / 100) * RESET_THRESHOLD),
            batchAllocated: Math.floor((assignmentCounts[emp.email] || 0) % BATCH_SIZE)
        }));

        // Find the employee who is furthest behind their target
        let assignedEmployee = employeeAllocations.reduce((prev, curr) => {
            const prevDiff = prev.batchTarget - prev.batchAllocated;
            const currDiff = curr.batchTarget - curr.batchAllocated;
            
            if (currDiff > prevDiff && curr.allocated < curr.totalTarget) {
                return curr;
            }
            if (currDiff === prevDiff) {
                return (curr.allocated < prev.allocated && curr.allocated < curr.totalTarget) ? curr : prev;
            }
            return prev;
        }, employeeAllocations[0]);

        // If no suitable employee found, reset counts and try again
        if (!assignedEmployee || assignedEmployee.allocated >= assignedEmployee.totalTarget) {
            console.log('Batch completed or all employees reached targets, resetting counts');
            assignmentCounts = {};
            totalAssignments = 0;
            //return assignNewContactToEmployee(contactID, idSubstring, client, contactName);
        }

        // Update counts
        assignmentCounts[assignedEmployee.email] = (assignmentCounts[assignedEmployee.email] || 0) + 1;
        totalAssignments++;

        // Store updated counts
        await storeAssignmentCounts(idSubstring);

        console.log(`Assigned employee: ${assignedEmployee.name} (${assignmentCounts[assignedEmployee.email]}/${assignedEmployee.totalTarget} leads)`);

        // Fetch contact data and send notifications
        const contactData = await getContactDataFromDatabaseByPhone(contactID, idSubstring);
        const updatedContactName = contactData?.contactName || contactName || 'Not provided';
        
        // Convert employee phone number to WhatsApp ID based on phone index
        const employeeID = assignedEmployee.phoneNumber.split('+')[1] + '@c.us';

        // Send message to assigned employee using phone2 (Motor)
        const messageContent = `Hello ${assignedEmployee?.name || 'Employee'}, a new contact has been assigned to you:

Name: ${updatedContactName}
Phone: ${contactID}

Kindly login to https://web.jutasoftware.co/login

Thank you.

Juta Teknologi`;

        // Send using phone2 since this is for Motor
        await client.sendMessage(employeeID, messageContent);

        // Add tag to contact
        await addtagbookedFirebase(contactID, assignedEmployee.name, idSubstring);

        return [assignedEmployee.name, assignedEmployee.phoneNumber];
    } catch (error) {
        console.error('Error in assignNewContactToEmployeeMotor:', error);
        return [];
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
const imageKeywords = {
    '4593': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FHonda%20NBOX%20Turbo%20GL%20Honda%20Sensing%202019%20(chasis%204593)%2FISC08652.jpg?alt=media&token=f6a65f14-822b-482a-a6ae-fffea54431f4',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FHonda%20NBOX%20Turbo%20GL%20Honda%20Sensing%202019%20(chasis%204593)%2FISC08661.jpg?alt=media&token=7657cd8b-4617-4fc5-a4d1-fb74e0133261'
    ],
    '2383': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FHonda%20Stepwagon%20Spada%202019%20(chasis%202383)%2FISC05915.jpg?alt=media&token=e6a6a91e-730d-4839-a2c7-5cc72a8b026b',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FHonda%20Stepwagon%20Spada%202019%20(chasis%202383)%2FISC05923.jpg?alt=media&token=c140c6ba-34dd-4975-8d44-0be1b4a5d016'
    ],
    '4378': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FHonda%20Stepwagon%20Spada%20Cool%20Spirit%202019%20(chasis%204378)%2FISC03122.jpg?alt=media&token=6deee3c0-6ff6-4319-985e-891b7d7c955f',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FHonda%20Stepwagon%20Spada%20Cool%20Spirit%202019%20(chasis%204378)%2FISC03131.jpg?alt=media&token=dee4c0d7-a6eb-4200-92c3-fb5f7c4f53fd'
    ],
    '4052': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FLexus%20RX300%202019%20(chasis%204052)%2FISC01974.jpg?alt=media&token=ee46cdba-190e-456c-9a17-e5bcde535e6f',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FLexus%20RX300%202019%20(chasis%204052)%2FISC01981.jpg?alt=media&token=6764569e-e178-4808-8d26-dafcb0f7cfe9'
    ],
    '8363': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Alphard%20SC%202020%20(chasis%208363)%2FISC03113.jpg?alt=media&token=40a4125e-7369-4f50-b898-082c3aaa77d8',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Alphard%20SC%202020%20(chasis%208363)%2FISC03119.jpg?alt=media&token=7f4d94a6-968f-432a-93a5-d2944c535511'
    ],
    '1019': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Alphard%20SC%202021%20(chasis%201019)%2FISC06823.jpg?alt=media&token=d38fe10f-4fe6-4802-bda9-7e1069fa63f0',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Alphard%20SC%202021%20(chasis%201019)%2FISC06834.jpg?alt=media&token=771699c0-74c0-4385-99bf-d3b2fde01cb1'
    ],
    '4301': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Alphard%20SC%202021%20(chasis%204301)%2FISC07997.jpg?alt=media&token=2797d2e2-ae05-41af-b5cd-be1f09d1426a',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Alphard%20SC%202021%20(chasis%204301)%2FISC08005.jpg?alt=media&token=a3409cfe-0cb5-4d02-aac0-42181bed6af8'
    ],
    '1744': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Harrier%20Z%20JBL%202020%20(%20chasis%201744)%2FISC04774-Recovered.jpg?alt=media&token=3adc7832-9b8d-4c62-b2e3-b4586aef2b4d',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Harrier%20Z%20JBL%202020%20(%20chasis%201744)%2FISC04781.jpg?alt=media&token=6cff594b-1bb7-4712-ad43-acb694798fe2'
    ],
    '4053': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Vellfire%20ZG%20%202018%20(chasis%204053)%2FISC07839.JPG.jpg?alt=media&token=f800704d-b7b5-478d-9032-05bdb828d5e7',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Vellfire%20ZG%20%202018%20(chasis%204053)%2FISC07845.JPG.jpg?alt=media&token=a61fed94-5df8-4bc1-aa58-b3849a87701c'
    ],
    '2050': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Vellfire%20ZG%20%202019%20(chasis%202050)%2FISC06401.jpg?alt=media&token=a26f1203-bbfb-441f-8320-038792f9a071',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Vellfire%20ZG%20%202019%20(chasis%202050)%2FISC06410.jpg?alt=media&token=b6e9f340-a794-4211-84d5-950d9757f358'
    ],
    '5282': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Vellfire%20ZG%202019%20(chasis%205282)%2FISC09910.JPG?alt=media&token=6383d64b-1066-498a-abaa-8d3bf2505fc0',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Vellfire%20ZG%202019%20(chasis%205282)%2FISC09916.JPG?alt=media&token=39254bec-960f-42ed-9b91-bda23218cb48'
    ],
    '4600': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Vellfire%20ZG%203.5%20V6%202018%20(chasis%204600)%2FISC07533.JPG.jpg?alt=media&token=25ceec8f-5c1d-4a1e-92ae-0fa811914c71',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Vellfire%20ZG%203.5%20V6%202018%20(chasis%204600)%2FISC07546.JPG.jpg?alt=media&token=934516f7-f0b4-45be-b797-4c46d304b9dc'
    ],
    '8058': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Voxy%20Kirameki%203%202021%20(chasis%208058)%2FISC01321.jpg?alt=media&token=1eaee3cc-5d08-4a97-b506-f9e4b088cc27',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FToyota%20Voxy%20Kirameki%203%202021%20(chasis%208058)%2FISC01334.jpg?alt=media&token=27649071-c737-48cf-b69e-fbcb13e5f4b1'
    ],
    '8629': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F8629%2FISC05665.jpg?alt=media&token=9431ad09-08a9-4ec8-a206-058efcba0116',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F8629%2FISC05659.jpg?alt=media&token=a1ba5a0a-5c2a-42c5-bf3d-14fd19cf596c'
    ],
    '8170': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F8170%2F5.jpg?alt=media&token=0e8ee539-9ded-405b-a4da-4f6147052c3f',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F8170%2F2.jpg?alt=media&token=5067c763-0ac3-4327-8143-f5d659df9329'
    ],
    '6234': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F6234%2FISC05720.jpg?alt=media&token=648bcf20-af5e-41b0-9fb6-c644ce3f0dc1',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F6234%2FISC05713.jpg?alt=media&token=c08bd44d-1915-446c-bcf5-a97dfef188ac'
    ],
    '4105': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F4105%2FISC04956.jpg?alt=media&token=7dcd60d1-7c6c-4b62-8cc0-4c76e912714e',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F4105%2FISC04947.jpg?alt=media&token=52ed27c9-6a2f-44d3-986a-7366c9002005'
    ],
    '2888': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F2888%2FISC06352.jpg?alt=media&token=0347f020-14ce-484a-80eb-eec3f1134500',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F2888%2FISC06344.jpg?alt=media&token=114f9780-24e0-463d-a361-f8fb7f267910'
    ],
    '2314': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F2314%2F01022233_03.jpg?alt=media&token=88e37308-7e84-469c-a442-1dc0a216a113',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F2314%2F01022233_01.jpg?alt=media&token=9b16de13-9d57-4323-b120-bdc0e7f28115'
    ],

    
    //BMW Motorcycles
    '1971': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F1971%2FISC08421.JPG?alt=media&token=6a427828-8768-4b58-a5c5-37ad4820d788',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F1971%2FISC03337.JPG?alt=media&token=157e443d-0ce7-435b-9d42-49cc6fb99971'
    ],
    '1169': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F1169%2FWhatsApp%20Image%202024-08-20%20at%2011.46.15_ebf9c31b.jpg?alt=media&token=8c691fe2-c982-4d66-9fe9-13e436483272',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FBMW%2F1169%2FWhatsApp%20Image%202024-08-20%20at%2011.46.13_e3f5d6ff.jpg?alt=media&token=da855918-140d-4dde-a304-056bf19710b3'
    ],
    // Harley Davidson Motorcycles
    '9457': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F9457%2FISC07832.jpg?alt=media&token=136a05ab-99ad-4738-aee1-54197e890e92',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F9457%2FISC07829.jpg?alt=media&token=1899be0f-08e3-4d7d-a43c-2cb56c0a8e36'
    ],
    '9397': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F9397%2FISC07872.jpg?alt=media&token=23d243ca-2c21-4ec4-a9f8-bd7ee7ed3a70',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F9397%2FISC07869.jpg?alt=media&token=c070be25-f37a-4809-a8c5-f594dd7058f5'
    ],
    '937': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F937%2FScreenshot_2%20(1).jpg?alt=media&token=67547a8a-f1cc-4640-ab00-c0546bdabfc4',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F937%2FScreenshot_18.jpg?alt=media&token=248fc2e0-fa9f-4baf-9812-625f6ddd9fde'
    ],
    // Continuing Harley Davidson entries...
    '9205': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F9205%2FISC07905.jpg?alt=media&token=34b20752-a869-480d-a88d-892fa00e7f74',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F9205%2FISC07903.jpg?alt=media&token=a1b4da02-e34b-40d3-b895-f524b60b2005'
    ],
    '9183': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F9183%2FISC02784.jpg?alt=media&token=845068d9-08d3-401e-a375-125faf7ed9dd',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F9183%2FISC02774.jpg?alt=media&token=024312ad-b41b-48b7-bb65-4ab7d63ae34f'
    ],
    '9095': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F9095%2FISC00930.JPG?alt=media&token=8a26adcb-31d0-4431-aa2a-28ff1609ddc5'
    ],
    '8581': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F8581%2FISC05001.jpg?alt=media&token=6f83b9c1-a8f8-404a-8b2a-6d814f6564c6',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F8581%2FISC04995.jpg?alt=media&token=6b026af1-8ac5-4bac-a758-1ba8f1b7f85f'
    ],
    '8192': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F8192%2FWhatsApp%20Image%202024-09-02%20at%2012.45.44_dbb4dba7.jpg?alt=media&token=15919523-fe85-4ef8-b825-2fd67ebbcff7',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F8192%2FWhatsApp%20Image%202024-09-02%20at%2012.45.43_7c6a9880.jpg?alt=media&token=bb2710c7-bcf1-45d2-b728-244ee36c8833'
    ],
    '8140': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F8140%2FScreenshot%202024-11-05%20at%204.49.13%E2%80%AFPM.png?alt=media&token=815ba207-a1e8-4fb1-9cea-7b03482c1754',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F8140%2FScreenshot%202024-11-05%20at%204.49.08%E2%80%AFPM.png?alt=media&token=267a1c8a-5cd0-4c02-ab16-22a4cb390885'
    ],
    '7370': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F7370%2FISC02867.jpg?alt=media&token=e3e0a972-6039-4cc8-b927-81b32eab137e',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F7370%2FISC02855.jpg?alt=media&token=be17a64d-b9f9-4f54-9085-05c4db6776fb'
    ],
    '7207': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F7207%2FISC04097.jpg?alt=media&token=f19d30c3-eba0-4654-a309-b3fa5ab66aee',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F7207%2FISC04092%20(1).jpg?alt=media&token=1f5a077a-fc31-422f-9347-273d14c5f9f1'
    ],
    '6952': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F6952%2FISC09177.jpg?alt=media&token=b06cf076-e5b6-46a7-b23b-16327fc4631d',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F6952%2FISC09173.jpg?alt=media&token=5e2f5921-24d5-41e3-a609-be058d059044'
    ],
    '5731': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F5731%2F01070599_07.jpg?alt=media&token=0f22bf42-afec-46e3-87b0-5c6e57a852e3',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F5731%2F01070599_02.jpg?alt=media&token=26873100-7951-4831-8d49-d51f1cc4d64b'
    ],
    '4296': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F4296%2FScreenshot_3.jpg?alt=media&token=0670b698-3a0b-4bce-9381-24aaa404e61b',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F4296%2FScreenshot_2%20(2).jpg?alt=media&token=07796a63-f55c-44d7-8d4b-c857a3a1811c'
    ],
    '3957': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F3957%2FScreenshot_7.jpg?alt=media&token=ae17ca22-cb60-4b57-b96d-2931312a7295',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F3957%2FScreenshot_2.jpg?alt=media&token=a1a4429d-b5d7-42a8-bf27-b5c1afcc897c'
    ],
    '2865': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F2865%2F01067701_05.jpg?alt=media&token=b67fa561-a7cd-4b58-99d7-2e97612c59a3',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F2865%2F01067701_01.jpg?alt=media&token=990a2cfb-4105-4918-8e21-0e82a12612ff'
    ],
    '2796': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F2796%2FISC09037.jpg?alt=media&token=eda17e41-66f2-4b0c-82fb-30c0a6468c6d',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F2796%2FISC09027.jpg?alt=media&token=156ce032-c037-4089-94f0-6272aec053be'
    ],
    '2387': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F2387%2FScreenshot%202024-11-05%20at%204.50.01%E2%80%AFPM.png?alt=media&token=42133329-0390-4adf-9873-a616b6a18f0e',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F2387%2FScreenshot%202024-11-05%20at%204.49.56%E2%80%AFPM.png?alt=media&token=8dc067f2-de65-4018-884c-105ee1fd393d'
    ],
    '1861': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F1861%2FISC07949.jpg?alt=media&token=95dcca72-14e7-47e4-81b1-b6a8b5182b56',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F1861%2FISC07942.jpg?alt=media&token=13b8f3e3-773b-4029-a2e4-0036e0321fe8'
    ],
    '0670': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F0670%2FISC01502.JPG?alt=media&token=9515d727-003f-425a-862e-17727b5d91de',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHARLEY%20DAVIDSON%2F0670%2FISC01493.JPG.jpg?alt=media&token=b9bc23e0-3daa-483d-a740-f430cd78947f'
    ],    
    // Kawasaki Motorcycles
    '1691': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FKAWASAKI%2F1691%2FISC03898.jpg?alt=media&token=6401439a-f8f1-4686-a029-d6ecacfcd6c8',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FKAWASAKI%2F1691%2FISC03886.jpg?alt=media&token=4f018e8d-13c7-49a7-98b1-663224241163'
    ],
    //
    // Honda Motorcycles
    '932': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHONDA%2F932%2FISC08716.jpg?alt=media&token=aa2b6409-fbb5-4843-aae3-4291fff8c033',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHONDA%2F932%2FISC08707.jpg?alt=media&token=d3628e2b-de23-4c8b-bc14-45a1d70f5090'
    ],
    '2463': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHONDA%2F2463%2FISC04852.jpg?alt=media&token=38ee450f-f8c8-4602-852c-23addc35df0b',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FHONDA%2F2463%2FISC04847.jpg?alt=media&token=15024db7-74ad-4e32-9b38-e635d4327d1b'
    ],
    
    // Ducati Motorcycles
    '4233': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FDUCATI%2F4233%2FISC02275.jpg?alt=media&token=03e97917-dd62-4011-911f-6f60cbcc36e1',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FDUCATI%2F4233%2FISC02263.jpg?alt=media&token=00322f94-b88e-41f0-9e1f-24ce918711f5'
    ],
    '4021': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FDUCATI%2F4021%2FISC07711.jpg?alt=media&token=8c907b4d-6b4b-4774-a0e2-21d0f71f3c0a',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FMotor%2FDUCATI%2F4021%2FISC07697.jpg?alt=media&token=7a37988a-e1e2-4a0e-a507-9b2ad47a48c2'
    ],
    // Car entries
    '8676': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F8676%2FISC09603.jpg?alt=media&token=8705a253-89e1-45c9-9f88-3c375efcd801',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F8676%2FISC09593.jpg?alt=media&token=65750544-9e83-4485-99c5-0c3aed405074'
    ],
    '8470': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F8470%2FISC07591.JPG?alt=media&token=d6d78184-6512-45b9-a7b3-a6f91e4a11b3',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F8470%2FISC07582.JPG.jpg?alt=media&token=4892ee28-0c18-46ff-ab6d-848eb667d21d'
    ],
    '8362': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F8362%2FISC06423.jpg?alt=media&token=9c95c38a-6068-435f-92cd-870f20070b56',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F8362%2F3331.jpg?alt=media&token=5346590c-185e-4dfd-b825-7c4578bd54a8'
    ],
    '8051': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F8051%2FISC05048.jpg?alt=media&token=c67fbe97-f81e-4cab-ac9b-be96790e40fd',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F8051%2FISC05023.jpg?alt=media&token=efbee702-1e03-4039-a5aa-df85b1b59962'
    ],
    '7940': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F7940%2FTESLA_M3_7940_IPHONE_CAMERA%2000-14.jpg?alt=media&token=f84dd4f6-6b2c-4865-9968-b8b74474f713',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F7940%2FTESLA_M3_7940_IPHONE_CAMERA%2000-12.jpg?alt=media&token=334be171-efdf-4e50-9851-51490d3acb4d'
    ],
    '7706': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F7706%2FISC08526.jpg?alt=media&token=841f0362-8d03-4bee-af38-675a73f5f6ca',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F7706%2FISC08508.jpg?alt=media&token=4488d7c8-d250-45ff-bc6d-c60017bd6571'
    ],
    '5545': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F5545%2F1157722_3.jpg?alt=media&token=703e521f-d4ae-4c20-8c84-b04e9baa4ed8',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F5545%2F1157722_1.jpg?alt=media&token=fa73eec8-886f-463f-90fb-8cac600c7d72'
    ],
    '5364': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F5364%2FISC02694.jpg?alt=media&token=d31042ec-5ac1-4620-82eb-6ef0f39a8774',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F5364%2FISC02684.jpg?alt=media&token=75077845-58b1-45f6-a6fb-c1f0dd0a698d'
    ],
    '5164': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F5164%2FISC01029.jpg?alt=media&token=94e461f3-95a9-4188-b86c-6ebca6bed879',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F5164%2F21321.jpg?alt=media&token=bc03eecf-91b4-454f-90ea-040ae9756bf9'
    ],
    '4309': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F4309%2FISC00874.JPG?alt=media&token=d716a54c-750b-46fc-b47d-de914b30aa42',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F4309%2FISC00865.JPG?alt=media&token=96627431-5ad8-4612-8edf-8183ba2f519c'
    ],
    '3793': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F3793%2FISC06886.JPG?alt=media&token=99edb040-0e59-4458-a4d8-870599f4b0ad',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F3793%2FISC06895.JPG?alt=media&token=23f8637a-361f-43fb-923c-ce09ebb8970f'
    ],
    '3650': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F3650%2FISC01123.jpg?alt=media&token=8c5ce882-665a-44fc-a802-186c6900596f',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F3650%2FISC01106.jpg?alt=media&token=13fc7b8b-1a44-4a53-b75b-9a694fd430b1'
    ],
    '3427': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F3427%2FISC08848.JPG?alt=media&token=77498a15-9828-4ef0-a611-92fe70220e96',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F3427%2FISC08832.JPG?alt=media&token=149a4aca-9e6e-4326-abe8-7f3c1780421b'
    ],
    '2716': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F2716%2FISC07465.jpg?alt=media&token=10a85a75-b736-4ffd-9b0f-527a5762cecd',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F2716%2FISC07448.jpg?alt=media&token=5ab6a513-9068-4851-a889-6e5a49a86f59'
    ],
    '2067': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F2067%2FISC03234.jpg?alt=media&token=02db2729-4e5c-4dd1-8ccc-0713890d8a2b',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F2067%2FISC03221-Recovered.jpg?alt=media&token=23dd3f79-c307-4745-88b2-0d9c9e367fa8'
    ],
    '1662': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F1662%2FISC01808.jpg?alt=media&token=0d1776f7-f138-4fce-a081-3abe30bde27d',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F1662%2FISC01798.jpg?alt=media&token=3c3d6683-9970-4815-b0b7-10c3e75d09da'
    ],
    '0961': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F0961%2FISC01708.jpg?alt=media&token=c45bf493-99e8-4d23-925b-231b8361f2be',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F0961%2FISC01699.jpg?alt=media&token=f1f711a5-9673-4afd-9093-e4369786e103'
    ],
    '02017': [
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F02017%2FISC07280.JPG?alt=media&token=91307551-def3-4552-a633-db09a7f3c8ea',
        'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Rasniaga%2FCar%2F02017%2FISC07272.JPG?alt=media&token=71b24b53-0755-44a0-8d1e-9f456f2a47fd'
    ],
};

const MESSAGE_BUFFER_TIME = 10000; // 1 minute in milliseconds
const messageBuffers = new Map();

async function handleNewMessagesRasniaga(client, msg, botName, phoneIndex) {
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
         await fetchConfigFromDatabase(idSubstring, phoneIndex);
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

            const group = await assignNewContactToEmployee(contactID, idSubstring, client, phoneIndex, contactName);
            console.log(`New contact assigned to employee ${group}`);
            
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
async function processMessage(client, msg, botName, phoneIndex, combinedMessage) {
    console.log(`Processing buffered messages for ${botName} on phone ${phoneIndex}`);
    
    const idSubstring = botName;
    
    // Validate phone index (only 0 or 1 are valid)
    if (phoneIndex !== 0 && phoneIndex !== 1) {
        console.error(`Invalid phone index: ${phoneIndex}, defaulting to phone 0`);
        phoneIndex = 0;
    }
    
    console.log(`Using phone ${phoneIndex} with config:`, {
        phone1: ghlConfig.phone1,
        phone2: ghlConfig.phone2,
        assistantId: phoneIndex === 0 ? ghlConfig.assistantId : ghlConfig.assistantId2
    });
    
    try {
        // Initial fetch of config
        await fetchConfigFromDatabase(idSubstring, phoneIndex); // Ensure phoneIndex is passed
        if(ghlConfig.stopbot){
            if(ghlConfig.stopbot == true){
                console.log('bot stop all');
                return;
            }
        }

        const sender = {
            to: msg.from,
            name: msg.notifyName,
            phoneIndex: phoneIndex // Add phoneIndex to sender object
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
                if(msg.type === 'image'){
                    var image = await handleImageMessage(msg, sender, threadID, client,idSubstring,extractedNumber);
                    query = `${combinedMessage} The user image analysis is: ${image}]`;
                    console.log(query);
                    answer = await handleOpenAIAssistant(query, threadID, stopTag, extractedNumber, idSubstring, client,contactData.contactName,phoneIndex);
                    parts = answer.split(/\s*\|\|\s*/);
                        
                        for (let i = 0; i < parts.length; i++) {
                            const part = parts[i].trim();   
                            const check = part.toLowerCase();
                            if (part) {
                                if (part) {
                                    if (msg.type === 'audio' || msg.type === 'ptt') {
                                       continue;
                                    }else{

                                        const check = part.toLowerCase();
                                        if (part.includes('~')) {
                                            await addtagbookedFirebase(extractedNumber, 'stop bot', idSubstring);
                                            await notifyEmployee(part, client, idSubstring, contactData, extractedNumber, phoneIndex);
                                            console.log('Added tags: stop bot, and notified employee with short summary');
                                            continue;
                                        }

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
                }else{
                    query = `${combinedMessage}`;
                    if(!(sender.to.includes('@g.us')) || (combinedMessage.toLowerCase().startsWith('@juta') && sender.phoneIndex == phoneIndex)){
                        answer = await handleOpenAIAssistant(query, threadID, stopTag, extractedNumber, idSubstring, client, contactData.contactName, phoneIndex);
                        console.log(answer);
                        parts = answer.split(/\s*\|\|\s*/);
                        
                        for (let i = 0; i < parts.length; i++) {
                            const part = parts[i].trim();   
                            const check = part.toLowerCase();
                            if (part) {
                                if (part.includes('~')) {
                                    await addtagbookedFirebase(extractedNumber, 'stop bot', idSubstring);
                                    await notifyEmployee(part, client, idSubstring, contactData, extractedNumber, phoneIndex);
                                    console.log('Added tags: stop bot, and notified employee with short summary');
                                    continue;
                                }

                                // Ensure we're using the correct client for this phoneIndex
                                const sentMessage = await client.sendMessage(msg.from, part);
                                
                                // Add phoneIndex to message data
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
                                    phoneIndex: phoneIndex // Add phoneIndex to message data
                                };
    
                                const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
                                const messagesRef = contactRef.collection('messages');
                        
                                const messageDoc = messagesRef.doc(sentMessage.id._serialized);
    
                                await messageDoc.set(sentMessageData, { merge: true });
    
                                // Check for chassis numbers and send images
                                for (const [chassisNumber, imageUrls] of Object.entries(imageKeywords)) {
                                    if (part.includes(chassisNumber)) {
                                        for (const imageUrl of imageUrls) {
                                            const media = await MessageMedia.fromUrl(imageUrl);
                                            const imageMessage = await client.sendMessage(msg.from, media);
                                            await addMessagetoFirebase(imageMessage, idSubstring, extractedNumber, contactName);
                                        }
                                    }
                                }
    
                                // Check for specific phrases and add tags
                                if (check.includes('team side kereta')) {
                                    await removeEmployeeTags(extractedNumber, idSubstring);
                                    await addtagbookedFirebase(extractedNumber, 'Assigned (Kereta)', idSubstring);
                                    await addtagbookedFirebase(extractedNumber, 'stop bot', idSubstring);
                                    await assignNewContactToEmployee(extractedNumber, idSubstring, client, phoneIndex, contactName);
                                    console.log('Added tags: Assigned (Kereta), stop bot');
                                }
                                if (check.includes('team side motor')) {
                                    await removeEmployeeTags(extractedNumber, idSubstring);
                                    await addtagbookedFirebase(extractedNumber, 'Assigned (Motor)', idSubstring);
                                    await addtagbookedFirebase(extractedNumber, 'stop bot', idSubstring);
                                    await assignNewContactToEmployee(extractedNumber, idSubstring, client, phoneIndex, contactName);
                                    console.log('Added tags: Assigned (Motor), stop bot');
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

async function notifyEmployee(part, client, idSubstring, contactData, extractedNumber, phoneIndex) {
    try {
        let group;
        if (phoneIndex === 0) {
            group = 'Kereta';
        }else if (phoneIndex === 1) {
            group = 'Motor';
        }

        // Extract the summary following the '~' symbol
        const summaryIndex = part.indexOf('~');
        if (summaryIndex !== -1) {
            const summary = part.substring(summaryIndex + 1).trim();

            // Fetch the latest employee list from Firebase
            await fetchEmployeesFromFirebase(idSubstring);
            if (!employees || employees.length === 0) {
                console.log('No employees found');
                return;
            }
            console.log('All employees:', employees);

            // Filter for employees in based on the group and with positive weightage
            const availableEmployees = employees.filter(emp => 
                emp.weightage > 0 && 
                emp.group === group
            );
            if (availableEmployees.length === 0) {
                console.log(`No available ${group} employees found for assignment`);
                return;
            }

            // Iterate through each tag in contactData.tags
            for (const tag of contactData.tags) {
                // Search for a matching employee in availableEmployees
                const matchedEmployee = availableEmployees.find(emp => tag.includes(emp.name));
                if (matchedEmployee) {
                    // Prepare the notification message
                    const notificationMessage = `Notification for ${contactData.contactName} ${extractedNumber}: ${summary}`;

                    // Send notification to the matched employee
                    const employeeNumber = matchedEmployee.phoneNumber.split('+')[1] + '@c.us';
                    await client.sendMessage(employeeNumber, notificationMessage);
                    console.log(`Notification sent to employee: ${notificationMessage}`);
                    return; // Exit after sending the notification
                }
            }

            console.log('No matching employee found in tags');
        }
    } catch (error) {
        console.error('Error notifying employee:', error);
    }
}

async function spreadsheetCheck(client, phoneNumber, vehicleType, model, year, idSubstring) {
    console.log('Checking spreadsheet...');
    let matchingVehicles = [];
    sheetName = vehicleType.toUpperCase();
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: '1LvMroRy-Ls8PbHmMwnAIgV5Zn-IckFmiLvKWgw8W6R8',
        range: `${this.sheetName}!A:G`
    });
  
    const rows = response.data.values;
    if (!rows) {
        console.log('No data found.');
        return 'No data found in the spreadsheet.';
    }
  
    // Split the model into words and convert to lowercase
    const modelWords = model.toLowerCase().split(/\s+/);
  
    for (const row of rows) {
        if (row.length < 4) {
            console.log('Skipping row due to insufficient data:', row);
            continue;
        }
        let modelInSheet, yearInSheet, chasisInSheet, mileageInSheet, linkInSheet, stockNoInSheet;

        if (sheetName === 'CAR') {
            [_, modelInSheet, yearInSheet, chasisInSheet, stockNoInSheet, mileageInSheet, linkInSheet] = row;
        } else if (sheetName === 'MOTOR') {
            [_, modelInSheet, yearInSheet, chasisInSheet, mileageInSheet, linkInSheet] = row;
        }

        // Convert the model in sheet to lowercase and split into words
        const modelInSheetWords = modelInSheet.toLowerCase().split(/\s+/);
  
        // Check if all words from the search model are present in the sheet model
        const allWordsPresent = modelWords.every(word => 
            modelInSheetWords.some(sheetWord => sheetWord.includes(word))
        );
  
        if (allWordsPresent && (year === undefined || String(yearInSheet).includes(String(year)))) {
            matchingVehicles.push({
                model: modelInSheet,
                year: yearInSheet,
                chasis: chasisInSheet,
                mileage: mileageInSheet,
                link: linkInSheet
            });
        }
    }
  
    if (matchingVehicles.length > 0) {
        console.log(`Found ${matchingVehicles.length} matching vehicles.`);
        return JSON.stringify(matchingVehicles);
    } else {
        console.log(`No vehicles found matching model "${model}"${year ? ` and year "${year}"` : ''}.`);
        return `No vehicles found matching model "${model}"${year ? ` and year "${year}"` : ''}.`;
    }
}

async function handleToolCalls(toolCalls, idSubstring, client,phoneNumber) {
    console.log('Handling tool calls...');
    console.log('Phone Number in handleToolCalls...'+phoneNumber);
    const toolOutputs = [];
    for (const toolCall of toolCalls) {
        console.log(`Processing tool call: ${toolCall.function.name}`);
        switch (toolCall.function.name) {
            case 'checkSpreadsheet':
                try {
                  console.log('Checking Spreadsheet...');
                  const args = JSON.parse(toolCall.function.arguments);
                  const result = await spreadsheetCheck(client, phoneNumber, args.vehicleType, args.model, args.modelYear, idSubstring);
                  toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: result,
                  });
                } catch (error) {
                  console.error('Error in handleToolCalls for checkSpreadsheet:', error);
                  toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({ error: error.message }),
                  });
                }
                break;
            default:
                console.warn(`Unknown function called: ${toolCall.function.name}`);
        }
    }
    console.log('Finished handling tool calls');
    return toolOutputs;
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

async function removeEmployeeTags(contactID, idSubstring) {
    console.log(`Removing employee tags from contact ${contactID}`);
    const docPath = `companies/${idSubstring}/contacts/${contactID}`;
    const contactRef = db.doc(docPath);

    try {
        // Fetch the latest employee list from Firebase
        await fetchEmployeesFromFirebase(idSubstring);
        if (!employees || employees.length === 0) {
            console.log('No employees found');
            return;
        }

        // Get the list of employee names
        const employeeNames = employees.map(emp => emp.name);

        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(contactRef);
            if (!doc.exists) {
                throw new Error("Contact document does not exist!");
            }

            let currentTags = doc.data().tags || [];
            // Filter out tags that match any employee name
            const updatedTags = currentTags.filter(tag => !employeeNames.includes(tag));
            transaction.update(contactRef, { tags: updatedTags });
            console.log(`Employee tags removed successfully from contact ${contactID}`);
        });
    } catch (error) {
        console.error('Error removing employee tags from Firebase:', error);
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
            console.log("error from handleNewMessagesMaha: "+error)
            throw error;
        }
    }
    return null; // Return null if not completed
}

async function waitForCompletion(threadId, runId, idSubstring, client, depth = 0,phoneNumber) {
    const maxDepth = 5; // Maximum recursion depth
    const maxAttempts = 30;
    const pollingInterval = 2000; // 2 seconds
    console.log('Phone Number in waitForCompletion...'+phoneNumber);
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
          return await waitForCompletion(threadId, runId, idSubstring, client, depth + 1,phoneNumber);
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

async function runAssistant(assistantID, threadId, tools,idSubstring,client,phoneNumber) {
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

async function handleOpenAIAssistant(message, threadID, tags, phoneNumber, idSubstring, client,name,phoneIndex){
    // Use assistantId for phone 0 and assistantId2 for phone 1
    const assistantId = phoneIndex === 0 ? ghlConfig.assistantId : ghlConfig.assistantId2;
    
    if (!assistantId) {
        console.error(`No assistant ID configured for phone ${phoneIndex}`);
        return "I apologize, but I'm not properly configured for this phone number yet.";
    }
    
    console.log(`Using assistant ID for phone ${phoneIndex}: ${assistantId}`);
    
    await addMessage(threadID, message);

    const tools = [
        {
            type: "function",
            function: {
              name: "checkSpreadsheet",
              description: "Check for model in spreadsheet. If present, then say its in stock. If not, then say it's out of stock, and we can import it.",
              parameters: {
                type: "object",
                properties: {
                    vehicleType: {
                        type: "string",
                        description: "Type of vehicle, either MOTOR or CAR"
                    },
                    model: {
                        type: "string",
                        description: "Model of the vehicle"
                    },
                    modelYear: {
                        type: "string",
                        description: "The year of the vehicle"
                    },
                },
                required: ["model"]
              }
            }
        },
    ]

    const answer = await runAssistant(assistantId, threadID, tools, idSubstring, client,phoneNumber);
    return answer;
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

async function fetchConfigFromDatabase(idSubstring, phoneIndex) {
    try {
        const docRef = db.collection('companies').doc(idSubstring);
        const doc = await docRef.get();
        if (!doc.exists) {
            console.log('No such document!');
            return;
        }
        ghlConfig = doc.data();
        console.log(`Config loaded for phone ${phoneIndex}:`, ghlConfig);
        
        // Validate assistant IDs
        if (phoneIndex === 1 && !ghlConfig.assistantId) {
            console.error('Missing assistantId for phone 1');
        } else if (phoneIndex === 2 && !ghlConfig.assistantId2) {
            console.error('Missing assistantId2 for phone 2');
        }
    } catch (error) {
        console.error('Error fetching config:', error);
        throw error;
    }
}

module.exports = { handleNewMessagesRasniaga };
