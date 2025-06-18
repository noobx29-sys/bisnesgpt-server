// handleMessagesTIC.js
const OpenAI = require('openai');
const axios = require('axios').default;

const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();

let ghlConfig = {};


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
async function handleNewMessagesTIC(req, res) {
    try {
        console.log('Handling new messages from TIC...');
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
            const chat = await getChatMetadata(message.chat_id);
            const contactData = await getContactDataFromDatabaseByPhone(extractedNumber);
            if (contactPresent !== null) {
                const stopTag = contactPresent.tags;
                if(stopTag.includes('stop bot')){
                    continue;
                }else {
                    contactID = contactPresent.id;
                    contactName = contactPresent.fullNameLowerCase;
                    const threadIdField = contactPresent.customFields.find(field => field.id === 'wvaA1ztX8cwGMk8POLcA');
                    if (threadIdField) {
                        threadID = threadIdField.value;
                    } else {
                        const thread = await createThread();
                        threadID = thread.id;
                        await saveThreadIDGHL(contactID,threadID);
                    }
                }
            }else{
              
                await createContact(sender.name,extractedNumber);
                await customWait(2500);

                const contactPresent = await getContact(extractedNumber);
                await tagContact(contactPresent.id);
                const stopTag = contactPresent.tags;
                if(stopTag.includes('stop bot')){
                    continue;
                }else {
                    contactID = contactPresent.id;
                    contactName = contactPresent.fullNameLowerCase;
                    const threadIdField = contactPresent.customFields.find(field => field.id === 'wvaA1ztX8cwGMk8POLcA');
                    if (threadIdField) {
                        threadID = threadIdField.value;
                    } else {
                        const thread = await createThread();
                        threadID = thread.id;
                        await saveThreadIDGHL(contactID,threadID);
                    }
                }
            }
            await callNotification('https://hook.us1.make.com/enapl8jjfhdkslqsdop8bcgu11le3mdl',message.text.body,chat.name);
            const firebaseTags = contactData.tags??[];
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
                 tags: contactPresent.tags??[],
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
         
         await addNotificationToUser('017', message);
         // Add the data to Firestore
   await db.collection('companies').doc('017').collection('contacts').doc(extractedNumber).set(data); 
            currentStep = userState.get(sender.to) || steps.START;
            switch (currentStep) {
                case steps.START:
                    query = `${message.text.body} user_name: ${contactName}`;
                    answer = await handleOpenAIAssistant(query,threadID);
                    parts = answer.split(/\s*\|\|\s*/);
                    const contactPresent = await getContact(extractedNumber);
                    const stopTag = contactPresent.tags;
                    if(stopTag.includes('follow up')){
                        await removeTagBookedGHL(contactID, 'follow up');
                    }    
                    await customWait(5000);
                    await addtagbookedGHL(contactPresent.id,'follow up');
                    for (let i = 0; i < parts.length; i++) {
                        const part = parts[i].trim();                
                        if (part) {
                            await sendWhapiRequest('messages/text', { to: sender.to, body: part });
                        }
                        if(part.includes('R2/344/4/0320')){
                            const imagePath = 'https://i.postimg.cc/KjxQdBQb/Whats-App-Image-2024-05-21-at-15-05-18-2927f973.jpg';
                            console.log("test")
                            // Send the image
                            saveMinat(contactID,'DIPLOMA PERAKAUNAN')
                          //  await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        } 
                        if(part.includes('R3/345/4/0878')){
                            const imagePath = 'https://i.postimg.cc/wTVJWnS7/Diploma-Pengurusan-Automotif-TIC.jpg';
                            console.log("test")
                            // Send the image
                            saveMinat(contactID,'DIPLOMA PENGURUSAN AUTOMOTIF')
                           // await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        } 
                        if(part.includes('R2/815/4/0014')){
                            const imagePath = 'https://i.postimg.cc/zfMTCW47/Diploma-Cantikkan-TIC.jpg';
                            console.log("test")
                            // Send the image
                            saveMinat(contactID,'DIPLOMA PENGURUSAN KECANTIKAN')
                           // await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        } 
                        if(part.includes('R3/340/4/0649')){
                            const imagePath = 'https://i.postimg.cc/P5VDHYfH/Diploma-Perniagaan-TIC.jpg';
                            console.log("test")
                            // Send the image
                            saveMinat(contactID,'DIPLOMA PENGURUSAN PERNIAGAAN')
                           // await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        } 
                        if(part.includes('R2/143/4/0018')){
                            const imagePath = 'https://i.postimg.cc/MKxVmz3C/Diploma-ECE-TIC.jpg';
                            console.log("test")
                            // Send the image
                          
                            saveMinat(contactID,'DIPLOMA PENDIDIKAN AWAL KANAK-KANAK')
                            //await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        } 
                        if(part.includes('N-DL/143/4/0164')){
                            const imagePath = 'https://i.postimg.cc/DwwGRBT5/Diploma-TESL-TIC.jpg';
                            console.log("test")
                            // Send the image
                            saveMinat(contactID,'DIPLOMA PENDIDIKAN (TESL)')
                            //await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        } 
                        if(part.includes('R2/345/4/0565')){
                            const imagePath = 'https://i.postimg.cc/qqHnYrJC/Diploma-HR-TIC.jpg';
                            // Send the image
                            saveMinat(contactID,'DIPLOMA PENGURUSAN SUMBER MANUSIA')
                            //await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        } 
                        if(part.includes('R2/481/4/0056')){
                            const imagePath = 'https://i.postimg.cc/QNcc7Fmg/Diploma-Teknologi-Maklumat-TIC.jpg';
                            // Send the image
                            saveMinat(contactID,'DIPLOMA TEKNOLOGI MAKLUMAT')
                            await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        } 
                        if(part.includes('R2/345/0393')){
                            const imagePath = 'https://i.postimg.cc/s2Bhgx1h/SIJIL-niagaan-TIC.jpg';
                            // Send the image
                            saveMinat(contactID,'CERTIFICATE IN BUSINESS MANAGEMENT')
                            //await sendWhapiRequest('messages/image', { to: sender.to, media: imagePath });
                        } 
                        if(part.includes('https://docs.google.com/forms/d/e/1FAIpQLSfom8Y21IOpWu53VU0k2VRva5O8FHxyIdQvf3zM-WXLCYDXKQ/viewform')){
                            await removeTagBookedGHL(contactID, 'follow up');
                            await addtagbookedGHL(contactID,'done');
                        }
                    }
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
        const contactsRef = db.collection('companies').doc('013').collection('contacts');
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

const teams = [
    "Low Guo Nan",
    "Shazwani",
    "Syamsul Faiz Ismail"
];

async function getCurrentTeamIndex() {
    const doc = await db.collection('companies').doc('017').get();
    return doc.exists ? doc.data().teamIndex : 0;
}

async function updateCurrentTeamIndex(index) {
    await db.collection('companies').doc('017').update({ teamIndex: index });
}

async function addTag(contactID, tag) {
    // Ensure the tag is a string before passing it to addtagbookedGHL
    if (Array.isArray(tag)) {
        tag = tag[0];
    }
    await addtagbookedGHL(contactID, tag);
}

async function tagContact(contactID) {
    let currentTeamIndex = await getCurrentTeamIndex();
    // Call the function to add the tag

    await addTag(contactID, teams[currentTeamIndex]);
    console.log(teams[currentTeamIndex]);

    // Update the team index
    currentTeamIndex = (currentTeamIndex + 1) % teams.length;

    // Save the current team index to Firestore
    await updateCurrentTeamIndex(currentTeamIndex);
}
async function addNotificationToUser(companyId, message) {
    console.log('noti');
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
        console.log(response);
        return response.data;
    } catch (error) {
        console.error('Error fetching chat metadata:', error.response.data);
        throw error;
    }
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
        console.log('Tag removed from contact:', response.data);
    } catch (error) {
        console.error('Error removing tag from contact:', error);
    }
}
async function createThread() {
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
      const response =  await axios.request(options);
      console.log(response);
    } catch (error) {
        console.error('Error adding tag to contact:', error);
    }
}
async function callWebhook(webhook,senderText,senderNumber,senderName) {
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
    const assistantId = 'asst_LGBkygKhS8VuLJtbsAkPZ5H8';

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
            console.log("error from handleNewMessagestic: "+error)
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
    const assistantId = 'asst_LGBkygKhS8VuLJtbsAkPZ5H8';
    await addMessage(threadID, message);
    const answer = await runAssistant(assistantId,threadID);
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
async function saveMinat(contactID,value){
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
                {id: 'W9D6BKoeQH8576FMEAd7', field_value: value}
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
        const docRef = db.collection('companies').doc('017');
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

module.exports = { handleNewMessagesTIC };