// handleMessages.js
const OpenAI = require('openai');
const axios = require('axios').default;
const fs = require('fs');
const path = require('path');
const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();
const { decode } = require('html-entities');

let ghlConfig = {};

// Schedule the task to run every 12 hours
setInterval(async () => {
    try {
        await ghlToken();
    } catch (error) {
        console.error('Error generating and updating token:', error);
    }
}, 12 * 60 * 60 * 1000);


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
    try {
        // Find the user with companyId 016
        const usersRef = db.collection('user');
        const querySnapshot = await usersRef.where('companyId', '==', companyId).get();

        if (querySnapshot.empty) {
           
            return;
        }

        // Update the user's document with the new message
        querySnapshot.forEach(async (doc) => {
            const userRef = doc.ref;
            const userDoc = await userRef.get();
            const currentMessages = userDoc.data().messages || [];

            // Add read/unread fields to the message
            const updatedMessage = { ...message, read: false };

            // Add the new message to the messages array
            const updatedMessages = [...currentMessages, updatedMessage];

            // Set the entire document with the updated messages array
            await userRef.set({ notifications: updatedMessages }, { merge: true });
            // Send push notification
            const fcmToken = userDoc.data().fcmToken;
            if (fcmToken) {
                await sendPushNotification(fcmToken, message);
            }
        });
    } catch (error) {
        console.error('Error adding notification: ', error);
    }
}
async function sendPushNotification(fcmToken, message) {
    const payload = {
        notification: {
            title: message.from_name || 'New Message',
            body: message.text.body || 'You have received a new message.',
            icon:'https://firebasestorage.gooeapis.com/v0/b/onboarding-a5fcb.appspot.com/o/logo2.png?alt=media&token=d31d1696-1be8-44a8-b6c5-f6808eb78f6c',
            image:'https://firebasestorage.gooeapis.com/v0/b/onboarding-a5fcb.appspot.com/o/211666_forward_icon.png?alt=media&token=597bb1cf-6ebc-4677-8729-08397df0eb36'
        },
        data: {
            message: JSON.stringify(message)
        }
    };

    try {
        await admin.messaging().sendToDevice(fcmToken, payload);
    } catch (error) {
        console.error('Error sending push notification:', error);
    }
}



async function handleNewMessages(req, res) {
    try {
                //sendtext()
        const encodedImageUrl = req.body.customData.attach; // Assuming the URL is in this field
        const decodedImageUrl = decode(encodedImageUrl);
        // Initial fetch of config
        await fetchConfigFromDatabase();
        
        const receivedMessages = req.body.message;
        for (const message of receivedMessages) {
            if (message.from_me) break;
            
            const sender = {
                to: message.chat_id,
                name: message.from_name
            };
        
            await addNotificationToUser('016', message);
            let contactName;
            let threadID;
            let botStatus;
            let query;
            let answer;
            let parts;

            const senderTo = sender.to;
            const extractedNumber = '+' + senderTo.match(/\d+/)[0];
            await callWebhookNotification('https://hook.us1.make.com/ra2r24bqbh8kul84vpjwgt8h7f7vatyo',sender.name,message.text.body);
            const dbData = await getDataFromDatabase(extractedNumber);
            threadID = dbData.thread_id;
            botStatus = dbData.bot_status;
            if (botStatus === 'on') {
                            } else {
                                continue;
            }
            if (dbData.name) {
                contactName = dbData.name;
                            } else {
                const name = `default_name: ${sender.name}`;
                const savedName = await handleOpenAINameAssistant(name);

                await createContact(savedName, extractedNumber);
                contactName = savedName;
                await saveNameToDatabase(extractedNumber, contactName);
                            }
            const contactPresent = await getContact(extractedNumber);

            if (contactPresent !== null) {
                const stopTag = contactPresent.tags;
                                if (stopTag.includes('stop bot')) {
                                        continue;
                } else {
                    contactID = contactPresent.id;
                    contactName = contactPresent.fullNameLowerCase;
                                                            const threadIdField = contactPresent.customFields.find(field => field.id === 'QaxE46r0sRtaFtCFaMrv');
                    if (threadIdField) {
                        threadID = threadIdField.value;
                    } else {
                        const thread = await createThread();
                        threadID = thread.id;
                        await saveThreadIDGHL(contactID, threadID);
                    }
                }
            } else {
                            }

            if (message.type === 'text') {
                query = `${message.text.body} user_name: ${contactName}`;
                answer = await handleOpenAIAssistant(query, threadID);
                parts = answer.split(/\s*\|\|\s*/);
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].trim();
                    if (part) {
                        await sendWhapiRequest('messages/text', { to: sender.to, body: part });
                        
                        if (part.includes('the number of travelers')) {
                            await addtagbookedGHL(contactID, 'stop bot');
                                                    }
                        

                        
                    }
                }
                            }

           
        }
        res.send('All messages processed');
        // Send a response with the image URL
        res.send(`All messages processed. Image URL: <a href="${decodedImageUrl}" target="_blank">${decodedImageUrl}</a>`);
    } catch (e) {
        console.error('Error:', e.message);
        res.status(500).send('Internal Server Error');
    }
}

async function createThread() {
    const thread = await openai.beta.threads.create();
    return thread;
}
async function saveNameToDatabase(phoneNumber, savedName) {
    try {
        const docRef = db.collection('companies').doc('016').collection('customers').doc(phoneNumber);
        await docRef.set({
            name: savedName
        }, { merge: true });
    } catch (error) {
        console.error('Error fetching or updating document:', error);
        throw error;
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
async function getDataFromDatabase(phoneNumber) {
    try {
        // Initial fetch of config
        await fetchConfigFromDatabase();

        let threadID;
        let contactName;
        let bot_status;
        const docRef = db.collection('companies').doc('016').collection('customers').doc(phoneNumber);
        const doc = await docRef.get();
        if (!doc.exists) {
            
            const contactPresent = await getContact(phoneNumber);
            if (contactPresent !== null) {
                contactName = contactPresent.fullNameLowerCase;
                
                const threadIdField = contactPresent.customFields.find(field => field.id === 'QaxE46r0sRtaFtCFaMrv');
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

async function callWebhookNotification(webhook,name,message) {
    
    const webhookUrl = webhook;
    const body = JSON.stringify({ name,message }); // Include sender's text in the request body
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
     // Log raw response
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
    const assistantId = 'asst_lMkTF4mTO4aFKTHUUcSQsp1w';

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
    const assistantId = 'asst_uydYTPbo2gUOBwojBMp5LdBi';
    await addMessage(threadID, message);
    const answer = await runAssistant(assistantId,threadID);
    return answer;
}

async function sendWhapiRequest(endpoint, params = {}, method = 'POST') {
    
    const options = {
        method: method,
        headers: {
            Authorization: `Bearer ${ghlConfig.whapi_token}`,
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

async function ghlToken() {
    try {
        await fetchConfigFromDatabase();
        const { ghl_id, ghl_secret, refresh_token } = ghlConfig;

        // Generate new token using fetched credentials and refresh token
        const encodedParams = new URLSearchParams();
        encodedParams.set('client_id', ghl_id);
        encodedParams.set('client_secret', ghl_secret);
        encodedParams.set('grant_type', 'refresh_token');
        encodedParams.set('refresh_token', refresh_token);
        encodedParams.set('user_type', 'Location');

        const options = {
            method: 'POST',
            url: 'https://services.leadconnectorhq.com/oauth/token',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json'
            },
            data: encodedParams,
        };

        const { data: newTokenData } = await axios.request(options);

        await db.collection('companies').doc('016').set({
            ghl_accessToken: newTokenData.ghl_accessToken,
            refresh_token: newTokenData.refresh_token,
        }, { merge: true });

        
    } catch (error) {
        console.error('Error generating and updating token:', error);
        throw error;
    }
}

async function fetchConfigFromDatabase() {
    try {
        const docRef = db.collection('companies').doc('016');
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

module.exports = { handleNewMessages };