// handleMessagesTIC.js
const OpenAI = require('openai');
const axios = require('axios').default;
const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();


let ghlConfig = {};
const timers = {};

// Schedule the task to run every 12 hours


const openai = new OpenAI({
    apiKey: process.env.OPENAIKEY,
});

const steps = {
    START: 'start',
    NEW_CONTACT: 'newContact',
    CREATE_CONTACT: 'createContact',
    POLL: 'poll',
};
const userState = new Map();

async function customWait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function handleNewMessagesArul(req, res) {
    try {
        // Initial fetch of config
        await fetchConfigFromDatabase();
        
        const receivedMessages = req.body.messages;
        for (const message of receivedMessages) {
            if (message.from_me) break;
            const sender = {
                to: message.chat_id,
                name: message.from_name
            };
            
            if (!message.chat_id.includes("whatsapp")) {
                break;
            }

            let contactName;
            let threadID;
            let botStatus;
            let query;
            let answer;
            let parts;

            const imageUrls = [
                "https://i.postimg.cc/L4CY9PFG/aee7bec5-9ccd-4f67-9f9b-692329186d64.jpg",
                "https://i.postimg.cc/59P2VMW3/fb8d692a-28bc-4a72-842c-260a10b04638.jpg",
                "https://i.postimg.cc/NjxgdhDm/5eaa5d1c-d7a6-453b-83c5-cfa130dda3d0.jpg",
                "https://i.postimg.cc/63vg1nKg/314a65f9-b585-4f69-893d-84932c611844.jpg",
                "https://i.postimg.cc/htCLQtw5/be013b81-81e4-46c2-b0e2-da67139afe6b.jpg",
            ];

            const senderTo = sender.to;
            const extractedNumber = '+' + senderTo.match(/\d+/)[0];
            const contactData = await getContactDataFromDatabaseByPhone(extractedNumber);
            const contactPresent = await getContact(extractedNumber);
            const chat = await getChatMetadata(message.chat_id);
            let  contactName2 = sender.name ?? extractedNumber;

            if (contactPresent !== null) {
                const stopTag = contactPresent.tags;
                console.log(stopTag);
                contactID = contactPresent.id;
                contactName = contactPresent.fullNameLowerCase;
                const threadIdField = contactPresent.customFields.find(field => field.id === 'DejFDCZJ74f0Dat1IsDL');
                if (threadIdField) {
                    threadID = threadIdField.value;
                } else {
                    const thread = await createThread();
                    threadID = thread.id;
                    await saveThreadIDGHL(contactID, threadID);
                }
            } else {
                await createContact(sender.name,extractedNumber);
                await customWait(2500);
                const contactPresent = await getContact(extractedNumber);
                const stopTag = contactPresent.tags;
               
                console.log(stopTag);

                contactID = contactPresent.id;
                contactName = contactPresent.fullNameLowerCase;

                const threadIdField = contactPresent.customFields.find(field => field.id === 'DejFDCZJ74f0Dat1IsDL');
                if (threadIdField) {
                    threadID = threadIdField.value;
                } else {
                    const thread = await createThread();
                    threadID = thread.id;
                    await saveThreadIDGHL(contactID,threadID);
                }
                console.log('sent new contact to create new contact')
                console.log('sent new contact to create new contact');
            }
            const contactPresent2 = await getContact(extractedNumber);
            let firebaseTags =[]
            if(contactData){
                firebaseTags=   contactData.tags??[];
            }
           const data = {
            additionalEmails: [],
            address1: null,
            assignedTo: null,
            businessId: null,
            phone:extractedNumber,
            tags:firebaseTags,
            chat: {
                chat_pic: chat.chat_pic ?? "",
                chat_pic_full: chat.chat_pic_full ?? "",
                contact_id: contactPresent2.id,
                id: message.chat_id,
                name: contactPresent2.firstName,
                not_spam: true,
                tags: contactPresent2.tags??[],
                timestamp: message.timestamp,
                type: 'contact',
                unreadCount: 0,
                last_message: {
                    chat_id: chat.id,
                    device_id: message.device_id ?? "",
                    from: message.from ?? "",
                    from_me: message.from_me ?? false,
                    id: message.id ?? "",
                    source: message.source ?? "",
                    status: "delivered",
                    text: message.text ?? "",
                    timestamp: message.timestamp ?? 0,
                    type: message.type ?? "",
                },
            },
            chat_id: message.chat_id,
            chat_pic: chat.chat_pic ?? "",
            chat_pic_full: chat.chat_pic_full ?? "",
            city: null,
            companyName: null,
            contactName: contactName2,
            country: contactPresent2.country ?? "",
            customFields: contactPresent2.customFields ?? {},
            last_message: {
                chat_id: chat.id,
                device_id: message.device_id ?? "",
                from: message.from ?? "",
                from_me: message.from_me ?? false,
                id: message.id ?? "",
                source: message.source ?? "",
                status: "delivered",
                text: message.text ?? "",
                timestamp: message.timestamp ?? 0,
                type: message.type ?? "",
            },
        };
        
        await  addNotificationToUser('003',message);
        // Add the data to Firestore
  await db.collection('companies').doc('003').collection('contacts').doc(extractedNumber).set(data); 
  if(firebaseTags !== undefined){
    if(firebaseTags.includes('stop bot')){
        console.log('bot stop');
    break;
    }
}
            if (message.type === 'text') {
                query = `${message.text.body} user_name: ${contactName}`;
                answer = await handleOpenAIAssistant(query, threadID);
                parts = answer.split(/\s*\|\|\s*/);
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].trim();
                    if (part) {
                        await sendWhapiRequest('messages/text', { to: sender.to, body: part });
                
                        if(part.includes('let me show you a few pictures.')){
                            const imagePath = 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Malls.jpeg?alt=media&token=cbe2425c-5aa5-407b-8f61-a077067308bf';
                            // Send the image
                            await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            const imagePath2 = 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Education.jpeg?alt=media&token=6ddeca65-d441-4709-8c3f-ed17a42e4d23';
                            // Send the image
                            await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath2 });
                            const imagePath3 = 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Hospitals.jpeg?alt=media&token=38d1a056-c5cd-4e12-98b5-2a421734f653';
                            // Send the image
                            await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath3 });
                        }
                        
                    }
                }
                console.log('Response sent.');
                await addtagbookedGHL(contactID, ['replied', 'hi ean here blast']);

                console.log('added tag replied')
            }

            if (message.type === 'image') {
                continue;
            }
            
        }
        res.send('All messages processed');
    } catch (e) {
        console.error('Error:', e.message);
        res.status(500).send('Internal Server Error');
    }
}


async function getContactDataFromDatabaseByPhone(phoneNumber) {
    try {
        // Check if phoneNumber is defined
        if (!phoneNumber) {
            throw new Error("Phone number is undefined or null");
        }

        // Initial fetch of config
        await fetchConfigFromDatabase();

        let threadID;
        let contactName;
        let bot_status;
        const contactsRef = db.collection('companies').doc('003').collection('contacts');
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

            if (!threadID) {
                const thread = await createThread();
                threadID = thread.id;
                await doc.ref.update({
                    thread_id: threadID
                });
            }

        
            return { ...contactData, thread_id: threadID, };
        }
    } catch (error) {
        console.error('Error fetching or updating document:', error);
        throw error;
    }
}
async function addNotificationToUser(companyId, message) {
    console.log('added noti');
    try {
        // Find the user with the specified companyId
        const usersRef = db.collection('user');
        const querySnapshot = await usersRef.where('companyId', '==', companyId).get();

        if (querySnapshot.empty) {
          
            return;
        }

        // Add the new message to the notifications subcollection of the user's document
        querySnapshot.forEach(async (doc) => {
            const userRef = doc.ref;
            const notificationsRef = userRef.collection('notifications');
            const updatedMessage = { ...message, read: false };
        
            await notificationsRef.add(updatedMessage);
           
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
       // console.error('Error fetching chat metadata:', error.response.data);
        throw error;
    }
}
async function addtagbookedGHL(contactID, tag) {
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
            tags: tag,
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
    console.log('Adding a new message to thread: ' + threadId);
    const response = await openai.beta.threads.messages.create(
        threadId,
        {
            role: "user",
            content: message
        }
    );
    return response;
}

async function saveNameToDatabase(phoneNumber, savedName) {
    try {
        const docRef = db.collection('companies').doc('003').collection('customers').doc(phoneNumber);
        await docRef.set({
            name: savedName
        }, { merge: true });
    } catch (error) {
        console.error('Error fetching or updating document:', error);
        throw error;
    }
}

async function callWebhook(webhook, senderText, senderNumber, senderName) {
    console.log('Calling webhook...');
    const webhookUrl = webhook;
    const body = JSON.stringify({ senderText, senderNumber, senderName });
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: body
    });
    let responseData = "";
    if (response.status === 200) {
        responseData = await response.text();
    } else {
        responseData = 'stop';
    }
    console.log('Webhook response:', responseData);
    return responseData;
}

async function checkingNameStatus(threadId, runId) {
    const runObject = await openai.beta.threads.runs.retrieve(threadId, runId);
    const status = runObject.status;
    if (status == 'completed') {
        clearInterval(pollingInterval);

        const messagesList = await openai.beta.threads.messages.list(threadId);
        const latestMessage = messagesList.body.data[0].content;
        const nameGen = latestMessage[0].text.value;
        return nameGen;
    }
}

async function waitForNameCompletion(threadId, runId) {
    return new Promise((resolve, reject) => {
        pollingInterval = setInterval(async () => {
            const name = await checkingNameStatus(threadId, runId);
            if (name) {
                clearInterval(pollingInterval);
                resolve(name);
            }
        }, 1000);
    });
}

async function runNameAssistant(assistantID, threadId) {
    console.log('Running assistant for thread: ' + threadId);
    const response = await openai.beta.threads.runs.create(threadId, {
        assistant_id: assistantID
    });

    const runId = response.id;

    const nameGen = await waitForNameCompletion(threadId, runId);
    return nameGen;
}

async function handleOpenAINameAssistant(senderName) {
    const threadId = 'thread_z88KPYbsJ6IAMwPuXtdCw84R';
    const assistantId = 'asst_gKi1F9Deo9rj1rq4uBaELDod';

    await addMessage(threadId, senderName);
    const response = await runNameAssistant(assistantId, threadId);

    return response;
}

async function checkingStatus(threadId, runId) {
    const runObject = await openai.beta.threads.runs.retrieve(threadId, runId);
    const status = runObject.status;
    if(status == 'completed') {
        clearInterval(pollingInterval);
        try{
            const messagesList = await openai.beta.threads.messages.list(threadId);
            const latestMessage = messagesList.body.data[0].content;

            console.log("Latest Message:");
            console.log(latestMessage[0].text.value);
            const answer = latestMessage[0].text.value;
            return answer;
        } catch(error){
            console.log("error from handleNewMessagesArul: "+error)
        }
        
    }
}

async function waitForCompletion(threadId, runId) {
    return new Promise((resolve, reject) => {
        pollingInterval = setInterval(async () => {
            const answer = await checkingStatus(threadId, runId);
            if (answer) {
                clearInterval(pollingInterval);
                resolve(answer);
            }
        }, 1000);
    });
}

async function runAssistant(assistantID, threadId) {
    console.log('Running assistant for thread: ' + threadId);
    const response = await openai.beta.threads.runs.create(threadId, {
        assistant_id: assistantID
    });

    const runId = response.id;
    console.log('Run ID:', runId);

    const answer = await waitForCompletion(threadId, runId);
    return answer;
}

async function handleOpenAIAssistant(message, threadID) {
    const assistantId = 'asst_gKi1F9Deo9rj1rq4uBaELDod';
    await addMessage(threadID, message);
    const answer = await runAssistant(assistantId, threadID);
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

async function saveThreadIDGHL(contactID, threadID) {
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
                { key: 'threadid', field_value: threadID }
            ],
        }
    };

    try {
        await axios.request(options);
    } catch (error) {
        console.error(error);
    }
}

async function createContact(name, number) {
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

async function getDataFromDatabase(phoneNumber) {
    try {
        // Initial fetch of config
        await fetchConfigFromDatabase();

        let threadID;
        let contactName;
        let bot_status;
        const docRef = db.collection('companies').doc('003').collection('contacts').doc(phoneNumber);
        const doc = await docRef.get();
        if (!doc.exists) {
            const contactPresent = await getContact(phoneNumber);
            if (contactPresent !== null) {
                contactName = contactPresent.fullNameLowerCase;
                const threadIdField = contactPresent.customFields.find(field => field.id === 'DejFDCZJ74f0Dat1IsDL');
                if (threadIdField) {
                    threadID = threadIdField.value;
                } else {
                    const thread = await createThread();
                    threadID = thread.id;
                }
             
            } else {
                const thread = await createThread();
                threadID = thread.id;
                await docRef.set({
                    thread_id: threadID,
                    bot_status: 'on'
                });
            }
            const updatedData = await docRef.get();
            return updatedData.data();
        } else {
            console.log('Document found. Returning thread_id.');
            return doc.data();
        }
    } catch (error) {
        console.error('Error fetching or updating document:', error);
        throw error;
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
        return (response.data.contact);
    } catch (error) {
        console.error(error);
    }
}



async function changeBotStatusToDatabase(phoneNumber) {
    try {
        const docRef = db.collection('companies').doc('003').collection('customers').doc(phoneNumber);
        await docRef.set({
            bot_status: 'off'
        }, { merge: true });
    } catch (error) {
        console.error('Error fetching or updating document:', error);
        throw error;
    }
}

async function fetchConfigFromDatabase() {
    try {
        const docRef = db.collection('companies').doc('003');
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

module.exports = { handleNewMessagesArul };
