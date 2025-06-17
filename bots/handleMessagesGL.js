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
const steps = {
    START: 'start',
    FIRST: 'first',
    SECOND: 'second',
    THIRD: 'third',
    FOURTH: 'fourth',
};
const userState = new Map();

async function customWait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

const openai = new OpenAI({
    apiKey: process.env.OPENAIKEY,
});

async function addNotificationToUser(companyId, message) {
    try {
        const usersRef = db.collection('user');
        const querySnapshot = await usersRef.where('companyId', '==', companyId).get();

        if (querySnapshot.empty) {
            return;
        }

        querySnapshot.forEach(async (doc) => {
            const userRef = doc.ref;
            const userDoc = await userRef.get();
            const currentMessages = userDoc.data().messages || [];
            const updatedMessage = { ...message, read: false };
            const updatedMessages = [...currentMessages, updatedMessage];

            await userRef.set({ notifications: updatedMessages }, { merge: true });

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
            icon: 'https://firebasestorage.gooeapis.com/v0/b/onboarding-a5fcb.appspot.com/o/logo2.png?alt=media&token=d31d1696-1be8-44a8-b6c5-f6808eb78f6c',
            image: 'https://firebasestorage.gooeapis.com/v0/b/onboarding-a5fcb.appspot.com/o/211666_forward_icon.png?alt=media&token=597bb1cf-6ebc-4677-8729-08397df0eb36'
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

function getNextStep(currentStep) {
    switch (currentStep) {
        case steps.START: return steps.FIRST;
        case steps.FIRST: return steps.SECOND;
        case steps.SECOND: return steps.THIRD;
        case steps.THIRD: return steps.FOURTH;
        default: return steps.START;
    }
}

async function handleNewMessagesGL(req, res) {
    res.status(200).send('Messages sent successfully');
    try {
        await fetchConfigFromDatabase();
        const message = req.body.message['body'];
        console.log(message);
        const contactName = req.body['first_name'];
        const contactId = req.body['contact_id'];
        const type = req.body.customData['type'];
        const direction = req.body.message['direction']; // Get the message direction
        let threadID = req.body.customData ? req.body.customData['thread'] : '';

        if (!threadID) {
            const thread = await createThread();
            threadID = thread.id;
    
            await saveThreadIDGHL(contactId, threadID);
        } else {
        }

        let currentStep = userState.get(contactId) || steps.START;
        const contact = await getContactById(contactId);

        if(contact.tags.includes('stop bot')){
            
        }else{
            const query = `${message} user_name: ${contactName}`;
            const answer = await handleOpenAIAssistant(query, threadID);
            const parts = answer.split(/\s*\|\|\s*/);
    
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i].trim();
                if (part) {
                    const check = part.toLowerCase();
                    if (currentStep === steps.FIRST) {
                        await addtagbookedGHL(contactId, 'follow up');
                    }else{
                        await removeTagBookedGHL(contactId, 'follow up');
                    }
                    if (check.includes('patience')) {
                        await addtagbookedGHL(contactId, 'stop bot');
                        await customWait(20000);
                        await sendLeadConnectorMessage({
                            type: type,
                            contactId: contactId,
                            message: part
                        }, ghlConfig.ghl_accessToken);
                    } else {
                        await customWait(20000);
                        await sendLeadConnectorMessage({
                            type: type,
                            contactId: contactId,
                            message: part
                        }, ghlConfig.ghl_accessToken);
                    }
                }
            }
    
            // Only increment the step if the message direction is 'inbound'
            if (direction === 'inbound') {
                currentStep = getNextStep(currentStep);
                userState.set(contactId, currentStep);
            }
        }
        
     
       
    } catch (e) {
        console.error('Error:', e.message);
        res.status(200).send('Messages sent successfully');
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

async function callWebhookNotification(webhook, name, message) {
    const webhookUrl = webhook;
    const body = JSON.stringify({ name, message });
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
    const runObject = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
    );

    const status = runObject.status;
    if (status == 'completed') {
        clearInterval(pollingInterval);

        const messagesList = await openai.beta.threads.messages.list(threadId);
        const latestMessage = messagesList.body.data[0].content;

        const nameGen = latestMessage[0].text.value;
        return nameGen;
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
    console.log(status);
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
            console.log("error from handleNewMessagesgl: "+error)
        }
        
    }
}

async function waitForCompletion(threadId, runId) {
    return new Promise((resolve, reject) => {
        pollingInterval = setInterval(async () => {
            const answer = await checkingStatus(threadId, runId);
            console.log(answer);
            if (answer) {
                clearInterval(pollingInterval);
                resolve(answer);
            }
        }, 1000);
    });
}

async function runAssistant(assistantID, threadId) {
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
    const answer = await runAssistant(assistantId, threadID);
    return answer;
}

async function sendLeadConnectorMessage(params, accessToken) {
    const url = 'https://services.leadconnectorhq.com/conversations/messages';
    const options = {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-04-15',
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify(params)
    };
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
    }

    const jsonResponse = await response.json();
    return jsonResponse;
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

module.exports = { handleNewMessagesGL };
