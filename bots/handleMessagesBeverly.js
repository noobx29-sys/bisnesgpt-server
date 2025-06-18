// handleMessagesGL.js
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
    try {
        // Find the user with companyId 016
        const usersRef = db.collection('user');
        const querySnapshot = await usersRef.where('companyId', '==', companyId).get();

        if (querySnapshot.empty) {
            console.log('No matching documents.');
            return;
        }

        // Update the user's document with the new message
        querySnapshot.forEach(async (doc) => {
            const userRef = doc.ref;
            // Add read/unread fields to the message
            const updatedMessage = { ...message, read: false };
        
            // Add the new message directly to the notifications array
            await userRef.update({
                notifications: admin.firestore.FieldValue.arrayUnion(updatedMessage)
            });
            console.log(`Notification ${message} added to user with companyId: ${companyId}`);
        });
    } catch (error) {
        console.error('Error adding notification: ', error);
    }
}
const countryCodes = {
    AFGHANISTAN: '+93',
    ALBANIA: '+355',
    ALGERIA: '+213',
    ANDORRA: '+376',
    ANGOLA: '+244',
    ANTIGUA_AND_BARBUDA: '+1-268',
    ARGENTINA: '+54',
    ARMENIA: '+374',
    AUSTRALIA: '+61',
    AUSTRIA: '+43',
    AZERBAIJAN: '+994',
    BAHAMAS: '+1-242',
    BAHRAIN: '+973',
    BANGLADESH: '+880',
    BARBADOS: '+1-246',
    BELARUS: '+375',
    BELGIUM: '+32',
    BELIZE: '+501',
    BENIN: '+229',
    BHUTAN: '+975',
    BOLIVIA: '+591',
    BOSNIA_AND_HERZEGOVINA: '+387',
    BOTSWANA: '+267',
    BRAZIL: '+55',
    BRUNEI: '+673',
    BULGARIA: '+359',
    BURKINA_FASO: '+226',
    BURUNDI: '+257',
    CAMBODIA: '+855',
    CAMEROON: '+237',
    CANADA: '+1',
    CAPE_VERDE: '+238',
    CENTRAL_AFRICAN_REPUBLIC: '+236',
    CHAD: '+235',
    CHILE: '+56',
    CHINA: '+86',
    COLOMBIA: '+57',
    COMOROS: '+269',
    CONGO_DEMOCRATIC_REPUBLIC: '+243',
    CONGO_REPUBLIC: '+242',
    COSTA_RICA: '+506',
    CROATIA: '+385',
    CUBA: '+53',
    CYPRUS: '+357',
    CZECH_REPUBLIC: '+420',
    DENMARK: '+45',
    DJIBOUTI: '+253',
    DOMINICA: '+1-767',
    DOMINICAN_REPUBLIC: '+1-809, +1-829, +1-849',
    EAST_TIMOR: '+670',
    ECUADOR: '+593',
    EGYPT: '+20',
    EL_SALVADOR: '+503',
    EQUATORIAL_GUINEA: '+240',
    ERITREA: '+291',
    ESTONIA: '+372',
    ESWATINI: '+268',
    ETHIOPIA: '+251',
    FIJI: '+679',
    FINLAND: '+358',
    FRANCE: '+33',
    GABON: '+241',
    GAMBIA: '+220',
    GEORGIA: '+995',
    GERMANY: '+49',
    GHANA: '+233',
    GREECE: '+30',
    GRENADA: '+1-473',
    GUATEMALA: '+502',
    GUINEA: '+224',
    GUINEA_BISSAU: '+245',
    GUYANA: '+592',
    HAITI: '+509',
    HONDURAS: '+504',
    HUNGARY: '+36',
    ICELAND: '+354',
    INDIA: '+91',
    INDONESIA: '+62',
    IRAN: '+98',
    IRAQ: '+964',
    IRELAND: '+353',
    ISRAEL: '+972',
    ITALY: '+39',
    IVORY_COAST: '+225',
    JAMAICA: '+1-876',
    JAPAN: '+81',
    JORDAN: '+962',
    KAZAKHSTAN: '+7',
    KENYA: '+254',
    KIRIBATI: '+686',
    KOREA_NORTH: '+850',
    KOREA_SOUTH: '+82',
    KOSOVO: '+383',
    KUWAIT: '+965',
    KYRGYZSTAN: '+996',
    LAOS: '+856',
    LATVIA: '+371',
    LEBANON: '+961',
    LESOTHO: '+266',
    LIBERIA: '+231',
    LIBYA: '+218',
    LIECHTENSTEIN: '+423',
    LITHUANIA: '+370',
    LUXEMBOURG: '+352',
    MADAGASCAR: '+261',
    MALAWI: '+265',
    MALAYSIA: '+60',
    MALDIVES: '+960',
    MALI: '+223',
    MALTA: '+356',
    MARSHALL_ISLANDS: '+692',
    MAURITANIA: '+222',
    MAURITIUS: '+230',
    MEXICO: '+52',
    MICRONESIA: '+691',
    MOLDOVA: '+373',
    MONACO: '+377',
    MONGOLIA: '+976',
    MONTENEGRO: '+382',
    MOROCCO: '+212',
    MOZAMBIQUE: '+258',
    MYANMAR: '+95',
    NAMIBIA: '+264',
    NAURU: '+674',
    NEPAL: '+977',
    NETHERLANDS: '+31',
    NEW_ZEALAND: '+64',
    NICARAGUA: '+505',
    NIGER: '+227',
    NIGERIA: '+234',
    NORTH_MACEDONIA: '+389',
    NORWAY: '+47',
    OMAN: '+968',
    PAKISTAN: '+92',
    PALAU: '+680',
    PALESTINE: '+970',
    PANAMA: '+507',
    PAPUA_NEW_GUINEA: '+675',
    PARAGUAY: '+595',
    PERU: '+51',
    PHILIPPINES: '+63',
    POLAND: '+48',
    PORTUGAL: '+351',
    QATAR: '+974',
    ROMANIA: '+40',
    RUSSIA: '+7',
    RWANDA: '+250',
    SAINT_KITTS_AND_NEVIS: '+1-869',
    SAINT_LUCIA: '+1-758',
    SAINT_VINCENT_AND_THE_GRENADINES: '+1-784',
    SAMOA: '+685',
    SAN_MARINO: '+378',
    SAO_TOME_AND_PRINCIPE: '+239',
    SAUDI_ARABIA: '+966',
    SENEGAL: '+221',
    SERBIA: '+381',
    SEYCHELLES: '+248',
    SIERRA_LEONE: '+232',
    SINGAPORE: '+65',
    SLOVAKIA: '+421',
    SLOVENIA: '+386',
    SOLOMON_ISLANDS: '+677',
    SOMALIA: '+252',
    SOUTH_AFRICA: '+27',
    SOUTH_SUDAN: '+211',
    SPAIN: '+34',
    SRI_LANKA: '+94',
    SUDAN: '+249',
    SURINAME: '+597',
    SWEDEN: '+46',
    SWITZERLAND: '+41',
    SYRIA: '+963',
    TAIWAN: '+886',
    TAJIKISTAN: '+992',
    TANZANIA: '+255',
    THAILAND: '+66',
    TOGO: '+228',
    TONGA: '+676',
    TRINIDAD_AND_TOBAGO: '+1-868',
    TUNISIA: '+216',
    TURKEY: '+90',
    TURKMENISTAN: '+993',
    TUVALU: '+688',
    UGANDA: '+256',
    UKRAINE: '+380',
    UNITED_ARAB_EMIRATES: '+971',
    UNITED_KINGDOM: '+44',
    UNITED_STATES: '+1',
    URUGUAY: '+598',
    UZBEKISTAN: '+998',
    VANUATU: '+678',
    VATICAN_CITY: '+39',
    VENEZUELA: '+58',
    VIETNAM: '+84',
    YEMEN: '+967',
    ZAMBIA: '+260',
    ZIMBABWE: '+263'
};
async function handleNewEnquriryFormBeverly(req, res) {
    try {
        console.log('Incoming Enquiry Form:');
        await fetchConfigFromDatabase();
        
        // Extract relevant fields from the request body
        const { Name, Email, Tel, Country, Purpose, Treatment, 'Your Message': YourMessage } = req.body;
        console.log(req.body);
        
        // Normalize the country name to match the keys in countryCodes
        const normalizedCountry = Country.trim().toUpperCase().replace(/\s+/g, '_');

        // Get the country code
        const countryCode = countryCodes[normalizedCountry];

        // Check if the phone number already includes a country code
        let formattedNumber;
        const telDigitsOnly = Tel.replace(/[^0-9]/g, ''); 
        if (Tel.startsWith('+')) {
            formattedNumber = Tel;
        }else if (Object.values(countryCodes).some(code => telDigitsOnly.startsWith(code.replace('+', '')))) {
            formattedNumber = `+${telDigitsOnly}`;
        }  else {
            formattedNumber = `${countryCode}${Tel.replace(/[^0-9]/g, '')}`;
        }
        console.log(formattedNumber);

        // Check if the contact exists
        const contactPresent = await getContact(formattedNumber);
        if (contactPresent != null) {
            console.log('Contact already exists.');
        } else {
            console.log('Contact not found. Creating a new contact...');
            await createContactEnquiry(Name, formattedNumber, Email, Country, Purpose, Treatment, YourMessage);
        }

        res.status(200).send('Webhook received and processed successfully.');
    } catch (e) {
        console.error('Error:', e.message);
        res.status(500).send('An error occurred while processing the webhook.');
    }
}


async function handleNewMessagesBeverly(req, res) {
    try {
        console.log('Handling new messages from Beverly...');

        // Initial fetch of config
        await fetchConfigFromDatabase();

        const receivedMessages = req.body.messages;
        for (const message of receivedMessages) {
        
            if (message.from_me) break;
            const companyRef = db.collection('message').doc(message.chat_id);
            // Get the current messages array
            const doc = await companyRef.get();
            const currentMessages = doc.data()?.messages || [];
            // Add the new message to the messages array
            const updatedMessages = [...currentMessages, message];
            // Set the entire document with the updated messages array
            await companyRef.set({
                messages: updatedMessages
            });
            if(!message.chat_id.includes("whatsapp")){
                break;
            }
            addNotificationToUser('014',message);
            const sender = {
                to: message.chat_id,
                name:message.from_name
            };
            const senderTo = sender.to;
            const extractedNumber = '+' + senderTo.match(/\d+/)[0];
            const contactPresent = await getContact(extractedNumber);
            if (contactPresent !== null) {
            await createContact(sender.name,extractedNumber);
            }else{
                
            }
break;
            let contactID;
            let contactName;
            let threadID;
            let query;
            let answer;
            let parts;
            let pollParams;

      
   

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
                    const threadIdField = contactPresent.customFields.find(field => field.id === 'rtR7WAYTjcarBn6DASLV');
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
                    const threadIdField = contactPresent.customFields.find(field => field.id === 'g0fsQ4s0Bqg3t2rSuMCD');
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
    const assistantId = 'asst_3TM9L6vQ4apPmbhMJfp95YZ0';

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
            console.log("error from handleNewMessagesbeverly: "+error)
        }
        
    }
}

async function waitForCompletion(threadId, runId) {
    return new Promise((resolve) => {
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
    const assistantId = 'asst_3TM9L6vQ4apPmbhMJfp95YZ0';
    await addMessage(threadID, message);
    const answer = await runAssistant(assistantId,threadID);
    return answer;
}

async function sendWhapiRequest(endpoint, params = {}, method = 'POST') {
    console.log('Sending request to Whapi.Cloud...');
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

async function createContactEnquiry(name, number, email, country, purpose, treatment, message) {
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
            email: email,
            tags:[
                treatment,
            ],
            customFields: [
                {
                    id: "z585UG5O6WUl3KBBbbQY",
                    value: message
                },
                {
                    id: "OALyKM1qHpBgpXEbnSkt",
                    value: [
                        treatment
                    ]
                },
                {
                    id: "CQ4uvW7H5sQReMwrFryM",
                    value: purpose
                }
            ]
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
        const docRef = db.collection('companies').doc('014');
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
module.exports = {
    handleNewMessagesBeverly,
    handleNewEnquriryFormBeverly
};