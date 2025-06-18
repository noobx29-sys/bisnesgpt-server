// handleMessagesTIC.js
const OpenAI = require('openai');
const axios = require('axios').default;
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
    NEW_CONTACT: 'newContact',
    CREATE_CONTACT: 'createContact',
    POLL: 'poll',
};
const userState = new Map();

async function customWait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function handleNewMessagesSunz(req, res) {
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
            const dbData = await getDataFromDatabase(extractedNumber);
            threadID = dbData.thread_id;
            botStatus = dbData.bot_status;
            if (botStatus === 'on') {
                console.log('bot is running for this contact');
            } else {
                console.log('bot is turned off for this contact');
                continue;
            }
            if (dbData.name) {
                contactName = dbData.name;
                console.log('name in true :', contactName);
            } else {
                const name = `default_name: ${sender.name}`;
                const savedName = await handleOpenAINameAssistant(name);

                await createContact(savedName, extractedNumber);
                contactName = savedName;
                await saveNameToDatabase(extractedNumber, contactName);
                console.log('name in false :', contactName);
            }
            const contactPresent = await getContact(extractedNumber);

            if (contactPresent !== null) {
                const stopTag = contactPresent.tags;
                console.log(stopTag);
                if (stopTag.includes('stop bot')) {
               
                    continue;
                } else {
                    contactID = contactPresent.id;
                    contactName = contactPresent.fullNameLowerCase;
                    const threadIdField = contactPresent.customFields.find(field => field.id === '6P53AGBMxRIpyV7XLI5J');
                    if (threadIdField) {
                        threadID = threadIdField.value;
                    } else {
                        const thread = await createThread();
                        threadID = thread.id;
                        await saveThreadIDGHL(contactID, threadID);
                    }
                }
            } else {
                console.log('sent new contact to create new contact');
            }

            if (message.type === 'text') {
                query = `${message.text.body} user_name: ${contactName}`;
                answer = await handleOpenAIAssistant(query, threadID);
                parts = answer.split(/\s*\|\|\s*/);
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].trim();
                    if (part) {
                        await sendWhapiRequest('messages/text', { to: sender.to, body: part });
                     

                        if (part.includes('minat pakej')) {
                            const senderTo = sender.to;
                            const extractedNumber = '+' + senderTo.match(/\d+/)[0];
                            const tags = contactPresent.tags;
                            
                            await changeBotStatusToDatabase(extractedNumber);
                        
                            await addtagbookedGHL(contactID, 'booked');
                        }
                        if(part.includes('*PHANTOM X4*')){
                            const imagePath = 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/14b24a56-b112-40f3-877e-6f1ee0a35283.jpeg?alt=media&token=2893cc59-a321-47a3-8f4b-5e73379d3442';
                            
                            // Send the image
                            await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        } 
                        
                        if(part.includes('*PHANTOM X3*')){
                            const imagePath = 'https://i.postimg.cc/59P2VMW3/fb8d692a-28bc-4a72-842c-260a10b04638.jpg';
                      
        
                            // Send the image
                            await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        }
                        if(part.includes('*PHANTOM X2*')){
                            const imagePath = 'https://i.postimg.cc/NjxgdhDm/5eaa5d1c-d7a6-453b-83c5-cfa130dda3d0.jpg';
                        
                            // Send the image
                            await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        } 
                        
                        if(part.includes('*PHANTOM X1*')){
                            const imagePath = 'https://i.postimg.cc/63vg1nKg/314a65f9-b585-4f69-893d-84932c611844.jpg';
                            
        
                            // Send the image
                            await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        }
                        if(part.includes('*PHANTOM X1*')){
                            const imagePath = 'https://i.postimg.cc/htCLQtw5/be013b81-81e4-46c2-b0e2-da67139afe6b.jpg';
                      
                            // Send the image
                            await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        }

                        
                    }
                }
                console.log('Response sent.');
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

async function saveNameToDatabase(phoneNumber, savedName) {
    try {
        const docRef = db.collection('companies').doc('004').collection('customers').doc(phoneNumber);
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
    const assistantId = 'asst_6Wr62RyZ6KMmwPy3Zcea1zE9';

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
            console.log("error from handleNewMessagessunz: "+error)
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
    const assistantId = 'asst_6Wr62RyZ6KMmwPy3Zcea1zE9';
    await addMessage(threadID, message);
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
        // Initial fetch of config
        await fetchConfigFromDatabase();

        let threadID;
        let contactName;
        let bot_status;
        const docRef = db.collection('companies').doc('004').collection('customers').doc(phoneNumber);
        const doc = await docRef.get();
        if (!doc.exists) {

            const contactPresent = await getContact(phoneNumber);
            if (contactPresent !== null) {
                contactName = contactPresent.fullNameLowerCase;
                
                const threadIdField = contactPresent.customFields.find(field => field.id === '6P53AGBMxRIpyV7XLI5J');
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
        const docRef = db.collection('companies').doc('004').collection('customers').doc(phoneNumber);
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
        const docRef = db.collection('companies').doc('004');
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

module.exports = { handleNewMessagesSunz };
