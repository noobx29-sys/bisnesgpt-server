const OpenAI = require('openai');
const axios = require('axios').default;
const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();
const fs = require('fs');
const path = require('path');

let ghlConfig = {};

// Initialize OpenAI with the API key
const openai = new OpenAI({
    apiKey: process.env.OPENAIKEY,
});

// Schedule the task to run every 12 hours
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

async function addNotificationToUser(companyId, message) {
    try {
        const usersRef = db.collection('user');
        const querySnapshot = await usersRef.where('companyId', '==', companyId).get();

        if (querySnapshot.empty) return;

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

async function getChatMetadata(chatId) {
    const url = `https://gate.whapi.cloud/chats/${chatId}`;
    const headers = {
        'Authorization': `Bearer ${ghlConfig.whapiToken}`,
        'Accept': 'application/json'
    };

    try {
        const response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        throw error;
    }
}

async function fetchContact(contactID) {
    const url = `https://gate.whapi.cloud/contacts/${contactID}`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${ghlConfig.whapiToken}`
            }
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Error ${response.status}: ${errorData.error.message}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching contact:', error.message);
        return null;
    }
}

async function downloadFile(fileUrl, outputLocationPath) {
    const writer = fs.createWriteStream(outputLocationPath);
    const response = await axios({
        url: fileUrl,
        method: 'GET',
        responseType: 'stream'
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

function hasStopBotLabel(chat) {
    if (!chat.labels || !Array.isArray(chat.labels)) return false;
    return chat.labels.some(label => label.name.toLowerCase().includes('stop'));
}

async function handleNewMessagesJuta(req, res) {
    try {
        await fetchConfigFromDatabase();
        const receivedMessages = req.body.messages;
        for (const message of receivedMessages) {
            if (message.from_me) break;
     

            const sender = {
                to: message.chat_id,
                name: message.from_name
            };

            if (!message.chat_id.includes("whatsapp")) break;

            let contactName;
            let threadID;
            let botStatus;
            let query;
            let answer;
            let parts;
            const senderTo = sender.to;
            const extractedNumber = '+' + senderTo.match(/\d+/)[0];
            const contactData = await getContactDataFromDatabaseByPhone(extractedNumber);
                        const contactPresent = await getContact(extractedNumber);
            const chat = await getChatMetadata(message.chat_id);
                        if (contactPresent !== null) {
                const stopTag = contactPresent.tags;
                if (stopTag.includes('stop bot')) {
                                        continue;
                } else {
                    const contactID = contactPresent.id;
                    contactName = contactPresent.fullNameLowerCase;
                    const threadIdField = contactPresent.customFields.find(field => field.id === 'D5nDnjNBMtkzOt8ktHeC');
                    if (threadIdField) {
                        threadID = threadIdField.value;
                    } else {
                        const thread = await createThread();
                        threadID = thread.id;
                        await saveThreadIDGHL(contactID, threadID);
                    }
                }
            } else {
                await createContact(sender.name,extractedNumber);
                await customWait(2500);
                const contactPresent = await getContact(extractedNumber);
                const stopTag = contactPresent.tags;
                if (message.from_me){
                    if(stopTag.includes('idle')){
                    removeTagBookedGHL(contactPresent.id,'idle');
                    }
                    break;
                }
                
                contactID = contactPresent.id;
                contactName = contactPresent.fullNameLowerCase;

                const threadIdField = contactPresent.customFields.find(field => field.id === 'D5nDnjNBMtkzOt8ktHeC');
                if (threadIdField) {
                    threadID = threadIdField.value;
                } else {
                    const thread = await createThread();
                    threadID = thread.id;
                    await saveThreadIDGHL(contactID,threadID);
                }
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
                phone: extractedNumber,
                tags: firebaseTags,
                chat: {
                    chat_pic: chat.chat_pic ?? "",
                    chat_pic_full: chat.chat_pic_full ?? "",
                    contact_id: contactPresent2.id,
                    id: message.chat_id,
                    name: contactPresent2.firstName,
                    not_spam: true,
                    tags: contactPresent2.tags ?? [],
                    timestamp: message.timestamp,
                    type: 'contact',
                    unreadCount: 0,
                    last_message: message,
                },
                chat_id: message.chat_id,
                chat_pic: chat.chat_pic ?? "",
                chat_pic_full: chat.chat_pic_full ?? "",
                city: null,
                companyName: null,
                contactName: chat.name,
                country: contactPresent2.country ?? "",
                customFields: contactPresent2.customFields ?? {},
                last_message: message,
            };
     
            await addNotificationToUser('001', message);
            await db.collection('companies').doc('001').collection('contacts').doc(extractedNumber).set(data);
            
            if (firebaseTags.includes('stop bot')) {
                                break;
            }

            if (message.type === 'text') {
                query = `${message.text.body} user_name: ${contactName}`;
                const stopTag = contactPresent.tags;
                if (!stopTag.includes('team')) {
                    answer = await handleOpenAIAssistant(query, threadID);
                                    } else {
                                        query = `${message.text.body} `;
                    answer = await handleOpenAITeamAssistant(query, threadID);
                }

                parts = answer.split(/\s*\|\|\s*/);
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].trim();
                    if (part) {
                        await sendWhapiRequest('messages/text', { to: sender.to, body: part });
                    }
                }
                            } else if (message.type === 'document') {
                const stopTag = contactPresent.tags;
                if (!stopTag.includes('team')) {
                    answer = await handleOpenAIAssistant(query, threadID);
                } else {
                                        query = `${message.document.caption ?? ""} `;
                    const documentDetails = {
                        id: message.document.id,
                        mime_type: message.document.mime_type,
                        file_size: message.document.file_size,
                        sha256: message.document.sha256,
                        file_name: message.document.file_name,
                        link: message.document.link,
                        caption: message.document.caption
                    };
                    await addMessage(threadID, `Document received: ${documentDetails.file_name}`, documentDetails);
                    answer = await handleOpenAITeamAssistantFile(query, threadID, documentDetails);
                }

                parts = answer.split(/\s*\|\|\s*/);
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].trim();
                    if (part) {
                        await sendWhapiRequest('messages/text', { to: sender.to, body: part });
                    }
                }
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
        const thread = await openai.beta.threads.create();
    return thread;
}

async function uploadFile(filePath, purpose) {
    try {
        const response = await openai.files.create({
            file: fs.createReadStream(filePath),
            purpose: purpose
        });
        return response;
    } catch (error) {
        console.error('Error uploading file:', error);
        throw error;
    }
}

async function addMessage(threadId, message, documentDetails = null) {
    
    const requestBody = {
        role: "user",
        content: message
    };

    if (documentDetails) {
        const fileExtension = path.extname(documentDetails.file_name);
        const tempFilePath = path.join(__dirname, `tempfile${fileExtension}`);
        await downloadFile(documentDetails.link, tempFilePath);
        const uploadedFile = await uploadFile(tempFilePath, 'assistants');
        requestBody.attachments = [
            {
                file_id: uploadedFile.id,
                tools: [
                    {
                        type: "file_search",
                    }
                ]
            }
        ];

        // Clean up the downloaded file
        fs.unlinkSync(tempFilePath);
    }

        const response = await openai.beta.threads.messages.create(threadId, requestBody);
    return response;
}

async function saveNameToDatabase(phoneNumber, savedName) {
    try {
        const docRef = db.collection('companies').doc('001').collection('customers').doc(phoneNumber);
        await docRef.set({
            name: savedName
        }, { merge: true });
    } catch (error) {
        console.error('Error fetching or updating document:', error);
        throw error;
    }
}

async function callWebhook(webhook, senderText, senderNumber, senderName) {
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
    const response = await openai.beta.threads.runs.create(threadId, {
        assistant_id: assistantID
    });

    const runId = response.id;

    const nameGen = await waitForNameCompletion(threadId, runId);
    return nameGen;
}

async function handleOpenAINameAssistant(senderName) {
    const threadId = 'thread_z88KPYbsJ6IAMwPuXtdCw84R';
    const assistantId = 'asst_pE0gCfL3QcDMFrKzzrttxAR1';

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

                                    const answer = latestMessage[0].text.value;
            return answer;
        } catch(error){
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
    const response = await openai.beta.threads.runs.create(threadId, {
        assistant_id: assistantID
    });

    const runId = response.id;

    const answer = await waitForCompletion(threadId, runId);
    return answer;
}

async function handleOpenAIAssistant(message, threadID) {
    const assistantId = 'asst_pE0gCfL3QcDMFrKzzrttxAR1';
    await addMessage(threadID, message);
    const answer = await runAssistant(assistantId, threadID);
    return answer;
}

async function handleOpenAITeamAssistant(message, threadID) {
    const assistantId = 'asst_D9E2GeIpNC4qI5JOJgnqkIJG';
    await addMessage(threadID, message);
    const answer = await runAssistant(assistantId, threadID);
    return answer;
}

async function handleOpenAITeamAssistantFile(message, threadID, documentDetails = null) {
    const assistantId = 'asst_D9E2GeIpNC4qI5JOJgnqkIJG';
    await addMessage(threadID, message, documentDetails);
    const answer = await runAssistant(assistantId, threadID);
    return answer;
}

async function sendWhapiRequest(endpoint, params = {}, method = 'POST') {
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
                { key: 'thread_id', field_value: threadID }
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
        await fetchConfigFromDatabase();

        let threadID;
        let contactName;
        let bot_status;
        const docRef = db.collection('companies').doc('001').collection('contacts').doc(phoneNumber);
        const doc = await docRef.get();
        if (!doc.exists) {
            const contactPresent = await getContact(phoneNumber);
            if (contactPresent !== null) {
                contactName = contactPresent.fullNameLowerCase;
                const threadIdField = contactPresent.customFields.find(field => field.id === 'D5nDnjNBMtkzOt8ktHeC');
                if (threadIdField) {
                    threadID = threadIdField.value;
                } else {
                    const thread = await createThread();
                    threadID = thread.id;
                }
                const stopTag = contactPresent.tags;
                if (stopTag.includes('stop bot')) {
                    bot_status = 'off';
                } else {
                    bot_status = 'on';
                }
                await docRef.set({
                    thread_id: threadID,
                    bot_status: bot_status,
                    name: contactName
                });
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
                        return doc.data();
        }
    } catch (error) {
        console.error('Error fetching or updating document:', error);
        throw error;
    }
}

async function getContactDataFromDatabaseByPhone(phoneNumber) {
    try {
        if (!phoneNumber) throw new Error("Phone number is undefined or null");
        await fetchConfigFromDatabase();

        const contactsRef = db.collection('companies').doc('001').collection('contacts');
        const querySnapshot = await contactsRef.where('phone', '==', phoneNumber).get();

        if (querySnapshot.empty) {
                        return null;
        } else {
            const doc = querySnapshot.docs[0];
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
        const docRef = db.collection('companies').doc('001').collection('customers').doc(phoneNumber);
        await docRef.set({ bot_status: 'off' }, { merge: true });
    } catch (error) {
        console.error('Error fetching or updating document:', error);
        throw error;
    }
}

async function fetchConfigFromDatabase() {
    try {
        const docRef = db.collection('companies').doc('001');
        const doc = await docRef.get();
        if (!doc.exists) {
                        return;
        }
        ghlConfig = doc.data();
    } catch (error) {
        console.error('Error fetching config:', error);
        throw error;
    }
}

module.exports = { handleNewMessagesJuta };
