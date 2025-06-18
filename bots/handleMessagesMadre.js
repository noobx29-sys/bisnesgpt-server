// handleMessagesMadre.js
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
async function handleNewMessagesMadre(req, res) {
    try {
        console.log('Handling new messages from Madre...');

        // Initial fetch of config
        await fetchConfigFromDatabase();

        const receivedMessages = req.body.messages;
        for (const message of receivedMessages) {
        
            if (message.from_me) break;
          
            if(!message.chat_id.includes("whatsapp")){
                break;
            }

            const sender = {
                to: message.chat_id,
                name:message.from_name
            };

            let contactID;
            let contactName;
            let threadID;
            let query;
            let answer;
            let parts;
            let pollParams;
            let currentStep;
            const senderTo = sender.to;
            const extractedNumber = '+' + senderTo.match(/\d+/)[0];
            const contactPresent = await getContact(extractedNumber);

            if (contactPresent !== null) {
                const stopTag = contactPresent.tags;
                console.log(stopTag);
                if(stopTag.includes('stop bot')){
                    console.log('Bot stopped for this message');
                    continue;
                }else {
                    contactID = contactPresent.id;
                    contactName = contactPresent.fullNameLowerCase;
                    console.log(contactID);
                    console.log(contactPresent.id);
                    const threadIdField = contactPresent.customFields.find(field => field.id === 'vDuVoEthQJaWnqavu258');
                    if (threadIdField) {
                        threadID = threadIdField.value;
                    } else {
                        const thread = await createThread();
                        threadID = thread.id;
                        await saveThreadIDGHL(contactID,threadID);
                    }
                }
            }else{
                const savedName = await handleOpenAINameAssistant(sender.name);
                await createContact(savedName,extractedNumber);
                await customWait(2500);
                const contactPresent = await getContact(extractedNumber);
                const stopTag = contactPresent.tags;
                console.log(stopTag);
                if(stopTag.includes('stop bot')){
                    console.log('Bot stopped for this message');
                    continue;
                }else {
                    contactID = contactPresent.id;
                    contactName = contactPresent.fullNameLowerCase;
                    console.log(contactID);
                    console.log(contactPresent.id);
                    const threadIdField = contactPresent.customFields.find(field => field.id === 'vDuVoEthQJaWnqavu258');
                    if (threadIdField) {
                        threadID = threadIdField.value;
                    } else {
                        const thread = await createThread();
                        threadID = thread.id;
                        await saveThreadIDGHL(contactID,threadID);
                    }
                }
          
                console.log('sent new contact to create new contact');
            }

            currentStep = userState.get(sender.to) || steps.START;
            switch (currentStep) {
                case steps.START:
                    query = `${message.text.body} user_name: ${contactName}`;
                    answer = await handleOpenAIAssistant(query,threadID);
                    parts = answer.split(/\s*\|\|\s*/);
                    for (let i = 0; i < parts.length; i++) {
                        const part = parts[i].trim();                
                        if (part) {
                            await sendWhapiRequest('messages/text', { to: sender.to, body: part });
                            console.log('Part sent:', part);
                            if(part.includes('Untuk kasut Tihany, boleh tahu size sis?')){
                                const imagePath = 'https://i.postimg.cc/NM7pk8rD/05a1b76e-593c-4339-bbf7-59acf293cadd.jpg';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            } 
                            if(part.includes('Untuk kasut Cassy, boleh tahu size sis?')){
                                const imagePath = 'https://i.postimg.cc/NM7pk8rD/05a1b76e-593c-4339-bbf7-59acf293cadd.jpg';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            }
                            if(part.includes('Untuk kasut Donna, boleh tahu size sis?')){
                                const imagePath = 'https://i.postimg.cc/NM7pk8rD/05a1b76e-593c-4339-bbf7-59acf293cadd.jpg';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            }
                            if(part.includes('*Tan Tihany*')){
                                const imagePath = 'https://i.postimg.cc/rpCT2NFN/Tihany-tan.webp';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            } 
                            if(part.includes('*Beige Tihany*')){
                                const imagePath = 'https://i.postimg.cc/wBdzrGHB/Tihany-beige-1.webp';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            } 
                            if(part.includes('*Black Tihany*')){
                                const imagePath = 'https://i.postimg.cc/x1mYtSw7/Tihany-black.webp';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            } 
                            if(part.includes('*Black Cassy*')){
                                const imagePath = 'https://i.postimg.cc/m2JBYr5C/Cassy-Black1.webp';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            } 
                            if(part.includes('*Soft Pink Cassy*')){
                                const imagePath = 'https://i.postimg.cc/nVdHL2Kd/Cassy-Pink1.webp';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            } 
                            if(part.includes('*Nude Cassy*')){
                                const imagePath = 'https://i.postimg.cc/gJsG8qC2/Cassy-Nude-2.webp';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            } 
                            if(part.includes('*Brown Cassy*')){
                                const imagePath = 'https://i.postimg.cc/d3SvSQtM/Cassy-Brown1.webp';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            } 
                            if(part.includes('*Silky Black Donna*')){
                                const imagePath = 'https://i.postimg.cc/FzKNZkvg/Donna-Silky-Black-2.webp';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            } 
                            if(part.includes('*Dark Grey Donna*')){
                                const imagePath = 'https://i.postimg.cc/fTJMSdBM/Donna.webp';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            } 
                            if(part.includes('*Dark Brown Donna*')){
                                const imagePath = 'https://i.postimg.cc/4dsJYFF0/Donna-Dark-Brown-2.webp';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            } 
                            if(part.includes('*Rose Blush Donna*')){
                                const imagePath = 'https://i.postimg.cc/Jhbr4WKJ/Donna-Rose-Blush-2.webp';
                                console.log("test")
                                // Send the image
                                await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                            } 
                            
                        }
                    }
                    console.log('Response sent.');
                    userState.set(sender.to, steps.START);
                    break;                
                case steps.NEW_CONTACT:
                    await sendWhapiRequest('messages/text', { to: sender.to, body: 'Sebelum kita mula boleh saya dapatkan nama?' });
                    userState.set(sender.to, steps.START);
                    break;
                case steps.CREATE_CONTACT:
                    const name = `${message.text.body} default_name: ${sender.name}`;
                    const savedName = await handleOpenAINameAssistant(name);
                    await createContact(savedName,extractedNumber);
                    pollParams = {
                        to: sender.to,
                        title: 'Are you dreaming of your next getaway?',
                        options: ['Yes'],
                        count: 1,
                        view_once: true
                    };
                    webhook = await sendWhapiRequest('/messages/poll', pollParams);
                    await customWait(2500);
                    userState.set(sender.to, steps.POLL);
                    break;
                case steps.POLL:
                    let selectedOption = [];
                    for (const result of webhook.message.poll.results) {
                        selectedOption.push (result.id);
                    }    
                    if(message.action.votes[0]=== selectedOption[0]){
                        const contactDetails = await getContact(extractedNumber);
                        contactID = contactDetails.id;
                        contactName = contactDetails.fullNameLowerCase;
                        const thread = await createThread();
                        threadID = thread.id;
                        console.log('thread ID generated: ', threadID);
                        await saveThreadIDGHL(contactID,threadID);
                        query = `${message.text.body} user_name: ${contactName}`;
                        answer = await handleOpenAIAssistant(query,threadID);
                        parts = answer.split(/\s*\|\|\s*/);
                        for (let i = 0; i < parts.length; i++) {
                            const part = parts[i].trim();                
                            if (part) {
                                await sendWhapiRequest('messages/text', { to: sender.to, body: part });
                                console.log('Part sent:', part);
                            }
                        }
                        console.log('Response sent.');
                        userState.set(sender.to, steps.START);
                        break;
                    }
                default:
                    // Handle unrecognized step
                    console.error('Unrecognized step:', currentStep);
                    break;
            }
        }

        res.send('All messages processed');
    } catch (e) {
        console.error('Error:', e.message);
        res.send(e.message);
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
async function callWebhook(webhook,senderText,senderNumber,senderName) {
    console.log('Calling webhook...');
    const webhookUrl = webhook;
    const body = JSON.stringify({ senderText,senderNumber,senderName }); // Include sender's text in the request body
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
    console.log('Webhook response:', responseData); // Log raw response
 return responseData;
}
async function checkingNameStatus(threadId, runId) {
    const runObject = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
    );

    const status = runObject.status;
    console.log(runObject);
    console.log('Current status: ' + status);
    
    if(status == 'completed') {
        clearInterval(pollingInterval);

        const messagesList = await openai.beta.threads.messages.list(threadId);
        const latestMessage = messagesList.body.data[0].content;

        console.log("Latest Message:");
        console.log(latestMessage[0].text.value);
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

async function runNameAssistant(assistantID,threadId) {
    console.log('Running assistant for thread: ' + threadId);
    const response = await openai.beta.threads.runs.create(
        threadId,
        {
            assistant_id: assistantID
        }
    );

    const runId = response.id;
    console.log('Run ID:', runId);

    const nameGen = await waitForNameCompletion(threadId, runId);
    return nameGen;
}

async function handleOpenAINameAssistant(senderName) {
    const threadId = 'thread_z88KPYbsJ6IAMwPuXtdCw84R';
    const assistantId = 'asst_H2nQN3y4VBR4cBZxb9s94rSq';

    await addMessage(threadId, senderName);
    const response = await runNameAssistant(assistantId, threadId);

    return response;
}

async function checkingStatus(threadId, runId) {
    const runObject = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
    );

    const status = runObject.status;
    console.log(runObject);
    console.log('Current status: ' + status);
    
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
            console.log("error from handleNewMessagesMadre: "+error)
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

async function runAssistant(assistantID,threadId) {
    console.log('Running assistant for thread: ' + threadId);
    const response = await openai.beta.threads.runs.create(
        threadId,
        {
            assistant_id: assistantID
        }
    );

    const runId = response.id;
    console.log('Run ID:', runId);

    const answer = await waitForCompletion(threadId, runId);
    return answer;
}

async function handleOpenAIAssistant(message, threadID) {
    const assistantId = 'asst_H2nQN3y4VBR4cBZxb9s94rSq';
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
    console.log('Whapi response:', JSON.stringify(jsonResponse, null, 2));
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
                {key: 'thread_id', field_value: threadID}
            ],
        }
    };

    try {
        await axios.request(options);
    } catch (error) {
        console.error(error);
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

async function fetchConfigFromDatabase() {
    try {
        const docRef = db.collection('companies').doc('012');
        const doc = await docRef.get();
        if (!doc.exists) {
            console.log('No such document!');
            return;
        }
        ghlConfig = doc.data();
        console.log(doc.data);
    } catch (error) {
        console.error('Error fetching config:', error);
        throw error;
    }
}

module.exports = { handleNewMessagesMadre };