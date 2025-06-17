// handleMessagesTasty.js
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

        // Add the new message to the notifications subcollection of the user's document
        querySnapshot.forEach(async (doc) => {
            const userRef = doc.ref;
            const notificationsRef = userRef.collection('notifications');
            const updatedMessage = { ...message, read: false };
        
            await notificationsRef.add(updatedMessage);
            console.log(`Notification ${message} added to user with companyId: ${companyId}`);
        });
    } catch (error) {
        console.error('Error adding notification: ', error);
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
        const contactsRef = db.collection('companies').doc('018').collection('contacts');
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
async function addTagToFirebase(phoneNumber, tag) {
    const contactsRef = db.collection('companies').doc('018').collection('contacts');
    const querySnapshot = await contactsRef.where('phone', '==', phoneNumber).get();

    if (querySnapshot.empty) {
        console.log('No matching documents.');
        return;
    } else {
        const doc = querySnapshot.docs[0];
        const contactRef = doc.ref;
        const contactData = doc.data();
        const tags = contactData.tags || [];

        if (!tags.includes(tag)) {
            tags.push(tag);
            await contactRef.update({ tags });
            console.log(`Tag ${tag} added to contact with phone number: ${phoneNumber}`);
        }
    }
}
async function handleNewMessagesTastyPuga(req, res) {
  
}
// ... existing code ...

async function removeTagFromFirebase(phoneNumber, tagToRemove) {
    const contactsRef = db.collection('companies').doc('018').collection('contacts');
    const querySnapshot = await contactsRef.where('phone', '==', phoneNumber).get();

    if (querySnapshot.empty) {
        console.log('No matching documents.');
        return;
    } else {
        const doc = querySnapshot.docs[0];
        const contactRef = doc.ref;
        const contactData = doc.data();
        const tags = contactData.tags || [];

        const updatedTags = tags.filter(tag => tag !== tagToRemove);

        if (tags.length !== updatedTags.length) {
            await contactRef.update({ tags: updatedTags });
            console.log(`Tag ${tagToRemove} removed from contact with phone number: ${phoneNumber}`);
        } else {
            console.log(`Tag ${tagToRemove} not found for contact with phone number: ${phoneNumber}`);
        }
    }
}

const rateLimitMap = new Map();
const messageQueue = new Map();
const processingThreads = new Set();

async function handleOpenAIAssistant2(message, threadID) {
    const assistantId = 'asst_ONO6YUxpCKM0PGEcv3ZyObmz';
    
    // Add message to queue
    if (!messageQueue.has(threadID)) {
        messageQueue.set(threadID, []);
    }
    messageQueue.get(threadID).push(message);

    // If the thread is already being processed, return a promise that will resolve when it's this message's turn
    if (processingThreads.has(threadID)) {
        return new Promise((resolve) => {
            const checkQueue = setInterval(() => {
                if (messageQueue.get(threadID)[0] === message) {
                    clearInterval(checkQueue);
                    resolve(processQueue(threadID, assistantId));
                }
            }, 100);
        });
    }

    // If the thread is not being processed, start processing
    processingThreads.add(threadID);
    return processQueue(threadID, assistantId);
}

async function processQueue(threadID, assistantId) {
    while (messageQueue.get(threadID).length > 0) {
        const currentMessage = messageQueue.get(threadID)[0];
        
        // Check if we've made a request for this threadID recently
        const lastRequestTime = rateLimitMap.get(threadID) || 0;
        const currentTime = Date.now();
        const timeSinceLastRequest = currentTime - lastRequestTime;

        // If less than 5 seconds have passed since the last request, wait
        if (timeSinceLastRequest < 5000) {
            const waitTime = 5000 - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        // Update the last request time for this threadID
        rateLimitMap.set(threadID, Date.now());

        // Add message to the thread
        await addMessage(threadID, currentMessage);

        // Run the assistant
        const answer = await runAssistant(assistantId, threadID);

        // Remove processed message from queue
        messageQueue.get(threadID).shift();

        // If this was the last message in the queue, remove the thread from processing
        if (messageQueue.get(threadID).length === 0) {
            processingThreads.delete(threadID);
        }

        // Return answer for the current message
        return answer;
    }
}

async function handleNewMessagesTasty(req, res) {
    try {
        console.log('Handling new messages from Tasty...');

        // Initial fetch of config
        await fetchConfigFromDatabase();

        const receivedMessages = req.body.messages;
        for (const message of receivedMessages) {

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
            let contactPresent = await getContact(extractedNumber);

            const chat = await getChatMetadata(message.chat_id);
         
            const contactData = await getContactDataFromDatabaseByPhone(extractedNumber);
            let firebaseTags =[]
            if(contactData){
                firebaseTags=   contactData.tags??[];
            }
            
           
            if (contactPresent !== null) {
                

           
                const stopTag = contactPresent.tags;
         
                
                         
             

    
                    contactID = contactPresent.id;
                    const threadIdField = contactPresent.customFields.find(field => field.id === 'lJqA7LbiNKXcHiK2iK5f');
                
                    if (threadIdField) {
                        threadID = threadIdField.value;
                        if(!threadID){
                            console.log('creating thread');
                            const thread = await createThread();
                            threadID = thread.id;
                            console.log(threadID);
                            await saveThreadIDGHL(contactID,threadID);
                        }
                        console.log(threadID);
                        await saveThreadIDGHL(contactID,threadID);
                    } else {
                        console.log('creating thread');
                        const thread = await createThread();
                        threadID = thread.id;
                        console.log(threadID);
                        await saveThreadIDGHL(contactID,threadID);
                    }
                    if (message.from_me){
                        if(firebaseTags.includes('stop bot')){
                            await handleOpenAIMyMessage(message.text.body,threadID);
                            }
                       
                        if(stopTag.includes('idle')){
                        removeTagBookedGHL(contactPresent.id,'idle');
                        }
                        break;
                    }
            }else{
             
                await createContact(sender.name,extractedNumber);
                await customWait(2500);
                let contactPresent = await getContact(extractedNumber);
                const stopTag = contactPresent.tags??[];
                if (message.from_me){
                    if(stopTag.includes('idle')){
                    removeTagBookedGHL(contactPresent.id,'idle');
                    }
                    break;
                }
                if(message.type == 'text'){
                    await callNotification('https://hook.us1.make.com/enapl8jjfhdkslqsdop8bcgu11le3mdl',message.text.body,chat.name);
                }
    

       
                    contactID = contactPresent.id;
                    contactName = contactPresent.fullNameLowerCase;
                    const threadIdField = contactPresent.customFields.find(field => field.id === 'lJqA7LbiNKXcHiK2iK5f');
                    console.log(threadIdField);
                    if (threadIdField) {
                        threadID = threadIdField.value;
                        if(!threadID){
                            console.log('creating thread');
                            const thread = await createThread();
                            threadID = thread.id;
                            console.log(threadID);
                            await saveThreadIDGHL(contactID,threadID);
                        }
                        console.log(threadID);
                        await saveThreadIDGHL(contactID,threadID);
                    } else {
                        console.log('creating thread');
                        const thread = await createThread();
                        threadID = thread.id;
                        console.log(threadID);
                        await saveThreadIDGHL(contactID,threadID);
                    }
           
                console.log('sent new contact to create new contact');
            }    

            contactPresent = await getContact(extractedNumber);    
            const stopTag = contactPresent.tags;
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
                    contact_id: contactPresent.id,
                    id: message.chat_id,
                    name: contactPresent.firstName,
                    not_spam: true,
                    tags:firebaseTags,
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
                contactName: chat.name??extractedNumber,
                country: contactPresent.country ?? "",
                customFields: contactPresent.customFields ?? {},
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
               
               await addNotificationToUser('018', message);
               // Add the data to Firestore
         await db.collection('companies').doc('018').collection('contacts').doc(extractedNumber).set(data);  
         if (message.text.body.includes('/resetbot')) {
            removeTagFromFirebase(extractedNumber,'stop bot')
            const thread = await createThread();
            threadID = thread.id;
            const res =await saveThreadIDGHL(contactID,threadID);
            console.log(res);
            await sendWhapiRequest('messages/text', { to: sender.to, body: "Bot is now restarting with new thread." });
            break;
        }
         if(firebaseTags.includes('stop bot')){
            console.log('Bot stopped for this message');
            continue;
        }
      
            currentStep = userState.get(sender.to) || steps.START;
            switch (currentStep) {
                case steps.START:
                    if(message.type == 'text'){
                        var context = "";
                        if (message.context?.quoted_content?.body != null) {
                            context = message.context.quoted_content.body;
                            query = `${message.text.body} user_name: ${sender.name} user replied to your previous message: ${context}`;
                        } else {
                            query = `${message.text.body} user_name: ${sender.name} `;
                        }
                  
                        answer = await handleOpenAIAssistant2(query,threadID);
                        parts = answer.split(/\s*\|\|\s*/);
                        for (let i = 0; i < parts.length; i++) {
                            const part = parts[i].trim();   
                            const check = part.toLowerCase();             
                            if (part) {
                               // await addtagbookedGHL(contactID, 'stop bot');
                               //await addTagToFirebase(extractedNumber,'stop bot');
                                await addtagbookedGHL(contactID, 'idle');
                                await sendWhapiRequest('messages/text', { to: sender.to, body: part });
                                if (check.includes('patience')) {
                                  //  await addtagbookedGHL(contactID, 'stop bot');
                                  await addTagToFirebase(extractedNumber,'stop bot');
                                } 
                                if(check.includes('get back to you as soon as possible')){
                                    console.log('check includes');
                                
                                   await callWebhook("https://hook.us1.make.com/qoq6221v2t26u0m6o37ftj1tnl0anyut",check,threadID,extractedNumber);
                                }
                            }
                        }
                    }else{
                        await sendWhapiRequest('messages/text', { to: sender.to, body: 'Sorry, as a bot, I am unable to directly access the document you provided.' });
                        await sendWhapiRequest('messages/text', { to: sender.to, body: 'I will get Ms. Rina to assist you with this right away' });
                        await sendWhapiRequest('messages/text', { to: sender.to, body: 'Thank you for your patience' });
                       // await addtagbookedGHL(contactID, 'stop bot');
                       await addTagToFirebase(extractedNumber,'stop bot');
                       continue;
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
                        query = `${message.text.body} user_name: ${sender.name}`;
                        answer = await handleOpenAIAssistant(query,threadID);
                        parts = answer.split(/\s*\|\|\s*/);
                        for (let i = 0; i < parts.length; i++) {
                            const part = parts[i].trim();                
                            if (part) {
                                await sendWhapiRequest('messages/text', { to: sender.to, body: part });
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
    console.log('adding tag');
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
}async function addMessageAssistant(threadId, message) {
    const response = await openai.beta.threads.messages.create(
        threadId,
        {
            role: "user",
            content: message
        }
    );
    console.log(response);
    return response;
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
async function callNotification(webhook,senderText,name) {
    console.log('calling notification')
    const webhookUrl = webhook;
    const body = JSON.stringify({ senderText,name}); // Include sender's text in the request body
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
async function callWebhook(webhook,senderText,thread,extractedNumber) {
    console.log('calling webhook')
    const webhookUrl = webhook;
    const body = JSON.stringify({ senderText,thread,extractedNumber}); // Include sender's text in the request body
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
async function checkingNameStatus(threadId, runId) {
    const runObject = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
    );

    const status = runObject.status;
    if(status == 'completed') {
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

async function runNameAssistant(assistantID,threadId) {
    const response = await openai.beta.threads.runs.create(
        threadId,
        {
            assistant_id: assistantID
        }
    );

    const runId = response.id;

    const nameGen = await waitForNameCompletion(threadId, runId);
    return nameGen;
}

async function handleOpenAINameAssistant(senderName) {
    const threadId = 'thread_z88KPYbsJ6IAMwPuXtdCw84R';
    const assistantId = 'asst_hR92f2R8chS2wPVCPAYjVOuj';

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
            console.log("error from handleNewMessagestasty: "+error)
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

    const answer = await waitForCompletion(threadId, runId);
    return answer;
}
async function runAssistantMy(assistantID,threadId) {
    console.log('Running assistant for thread: ' + threadId);
    const response = await openai.beta.threads.runs.create(
        threadId,
        {
            assistant_id: assistantID,
            instructions:"MS Rina sent the previous message to the user please remember and dont reply with anything"
        }
    );

    const runId = response.id;

    const answer = await waitForCompletion(threadId, runId);
    return answer;
}
async function handleOpenAIMyMessage(message, threadID) {
    console.log('messaging manual')
    query = `Ms Rina sent this to the user: ${message}. Please remember this for the next interaction. Do not re-send this query to the user, this is only for you to remember the interaction.`;
    await addMessageAssistant(threadID, query);
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
async function sendWhapiRequest2(endpoint, params = {}, method = 'POST') {
    console.log('Sending request to Whapi.Cloud...');
    const options = {
        method: method,
        headers: {
            Authorization: `Bearer ${ghlConfig.whapiToken2}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
    };
    const url = `https://gate.whapi.cloud/${endpoint}`;
    const response = await fetch(url, options);
    const jsonResponse = await response.json();
    return jsonResponse;
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
async function saveThreadIDGHL(contactID,threadID){
    console.log('saving thread');
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
async function saveThreadIDGHL2(contactID,threadID){
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
                {key: 'threadid2', field_value: threadID}
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
        const docRef = db.collection('companies').doc('018');
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

module.exports = {
    handleNewMessagesTasty,

};
