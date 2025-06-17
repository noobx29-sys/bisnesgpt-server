// handleMessagesMSU.js
const OpenAI = require('openai');
const axios = require('axios').default;
const path = require('path');
const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const fs = require('fs');
const AsyncLock = require('async-lock');
const lock = new AsyncLock();
const { MessageMedia } = require('whatsapp-web.js');
const pdfImgConvert = require('pdf-img-convert');
const { fromBuffer } = require('pdf2pic');
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

async function addNotificationToUser(companyId, message) {
    console.log('noti');
    try {
        const usersRef = db.collection('user');
        const querySnapshot = await usersRef.where('companyId', '==', companyId).get();

        if (querySnapshot.empty) {
            console.log('No matching documents.');
            return;
        }

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

async function getContactDataFromDatabaseByPhone(phoneNumber, idSubstring) {
    try {
        if (!phoneNumber) {
            throw new Error("Phone number is undefined or null");
        }

        await fetchConfigFromDatabase(idSubstring);

        const contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
        const querySnapshot = await contactsRef.where('phone', '==', phoneNumber).get();

        if (querySnapshot.empty) {
            console.log('No matching documents.');
            return null;
        } else {
            const doc = querySnapshot.docs[0];
            const contactData = doc.data();
            return { ...contactData };
        }
    } catch (error) {
        console.error('Error fetching or updating document:', error);
        throw error;
    }
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
}async function addtagbookedFirebase(contactID, tag, idSubstring) {
    const docPath = `companies/${idSubstring}/contacts/${contactID}`;
    const contactRef = db.doc(docPath);

    try {
        // Get the current document
        const doc = await contactRef.get();
        let currentTags = [];

        if (doc.exists) {
            currentTags = doc.data().tags || [];
        }

        // Add the new tag if it doesn't already exist
        if (!currentTags.includes(tag)) {
            currentTags.push(tag);

            // Update the document with the new tags
            await contactRef.set({
                tags: currentTags
            }, { merge: true });

            console.log(`Tag "${tag}" added to contact ${contactID} in Firebase`);
        } else {
            console.log(`Tag "${tag}" already exists for contact ${contactID} in Firebase`);
        }
    } catch (error) {
        console.error('Error adding tag to Firebase:', error);
    }
}
async function handleNewMessagesMSU(client, msg, botName, phoneIndex) {
    try {
        console.log('Handling new Messages MSU'+botName);

    const idSubstring = botName;

        await fetchConfigFromDatabase(idSubstring);

        if (msg.fromMe) return;

        const sender = {
            to: msg.from,
            name: msg.notifyName
        };

        let contactID;
        let contactName;
        let threadID;
        let query;
        let answer;
        let parts;
        let currentStep;
        const extractedNumber = '+' + (sender.to).split('@')[0];
       
        const contactData = await getContactDataFromDatabaseByPhone(extractedNumber, idSubstring);
        const chat = await msg.getChat();
        let firebaseTags = [];
        let unreadCount = 0;
        let stopTag = contactData?.tags || [];
        const contact = await chat.getContact();

        if (contactData) {
            firebaseTags = contactData.tags ?? [];
        }     
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
                
            }else{
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
     
        }else{
                
            await customWait(2500); 

            contactID = extractedNumber;
            contactName = contact.pushname || contact.name || extractedNumber;
           // client.sendMessage('120363178065670386@g.us', 'New Lead '+contactName +' '+contactID);

            const thread = await createThread();
            threadID = thread.id;
            console.log(threadID);
            await saveThreadIDFirebase(contactID, threadID, idSubstring)
            console.log('sent new contact to create new contact');
        }   
      
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
        let type = '';
        if(msg.type == 'chat'){
            type ='text'
          }else if(msg.type == 'e2e_notification' || msg.type == 'notification_template'){
            return;
        }else{
            type = msg.type;
          }
            
        if(extractedNumber.includes('status')){
            return;
        }

        // First, let's handle the transcription if it's an audio message
        let messageBody = msg.body;
        let audioData = null;

        if (msg.hasMedia && msg.type === 'audio') {
            console.log('Voice message detected');
            const media = await msg.downloadMedia();
            const transcription = await transcribeAudio(media.data);
            console.log('Transcription:', transcription);
                
            messageBody = transcription;
            audioData = media.data;
            console.log(msg);
        }
         
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
                    type:type,
                },
            },
            chat_id: msg.from,
            city: null,
            companyName: null,
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
        if (msg.type === 'audio') {
            messageData.audio = {
                mimetype: 'audio/ogg; codecs=opus', // Default mimetype for WhatsApp voice messages
                data: audioData // This is the base64 encoded audio data
            };
        }

        if (msg.hasMedia &&  msg.type !== 'audio') {
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
        await addNotificationToUser(idSubstring, messageData);

        // Add the data to Firestore
        await db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber).set(data, {merge: true});    
        if(messageData.type == 'sticker'){
            return;
        }
        if (msg.fromMe){
            if(stopTag.includes('idle')){
            }
            return;
        }
        if(stopTag.includes('stop bot')){
            console.log('Bot stopped for this message');
            return;
        }

        //reset bot command
        if (msg.body.includes('/resetbot')) {
            const thread = await createThread();
            threadID = thread.id;
            await saveThreadIDFirebase(contactID, threadID, idSubstring)
            const sentMessage = await client.sendMessage(msg.from, 'Bot is now restarting with new thread.');
            await addMessagetoFirebase(sentMessage, idSubstring, extractedNumber);
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

        currentStep = userState.get(sender.to) || steps.START;
        switch (currentStep) {
            case steps.START:
                if (msg.type === 'chat') {
                    if (msg.body.includes('/resetbot')) {
                        const thread = await createThread();
                        threadID = thread.id;
                        await saveThreadIDFirebase(contactID, threadID, idSubstring)
                        client.sendMessage(msg.from, 'Bot is now restarting with new thread.');
                        return;
                    }
                    await handleTextMessage(msg, sender, extractedNumber, contactName, threadID, client, idSubstring);
                    
                } else if (msg.type === 'document' ) {
                    await handleDocumentMessage(msg, sender, threadID, client, '001',extractedNumber);
                } else if (msg.type === 'image') {
                    await handleImageMessage(msg, sender, threadID, client,extractedNumber);
                } else {
                    const sentMessage = await client.sendMessage(msg.from, "Sorry, but we currently can't handle these types of files, we will forward your inquiry to our team!");
                    await addMessagetoFirebase(sentMessage, idSubstring, extractedNumber);
                    const sentMessage2 = await client.sendMessage(msg.from, "In the meantime, if you have any questions, feel free to ask!");
                    await addMessagetoFirebase(sentMessage2, idSubstring, extractedNumber);
                }
                console.log('Response sent.');
                await addtagbookedFirebase(contactID, 'replied', idSubstring);
                userState.set(sender.to, steps.START);
                break;

            case steps.NEW_CONTACT:
                await client.sendMessage(msg.from, 'Sebelum kita mula boleh saya dapatkan nama?');
                userState.set(sender.to, steps.START);
                break;

            case steps.CREATE_CONTACT:
                await createContact(sender.name, extractedNumber);
                // Note: Poll functionality is not directly available in WhatsApp Web client
                // You may need to implement an alternative approach or remove this feature
                userState.set(sender.to, steps.POLL);
                break;

            case steps.POLL:
                // Poll functionality needs to be reimplemented or removed
                break;

            default:
                console.error('Unrecognized step:', currentStep);
                break;
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}

async function handleTextMessage(msg, sender, extractedNumber, contactName, threadID, client, idSubstring) {
    const lockKey = `thread_${threadID}`;

    return lock.acquire(lockKey, async () => {
        const query = `${msg.body} user_name: ${contactName}`;
        const brochureFilePaths = {
            'Pharmacy': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUPharmacy.pdf?alt=media&token=c62cb344-2e92-4f1b-a6b0-e7ab0f5ae4f6',
            'Business Management': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUBusinessManagement.pdf?alt=media&token=ac8f2ebb-111e-4c5a-a278-72ed0d747243',
            'Education Social Sciences': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUEducationandSocialSciences.pdf?alt=media&token=6a3e95b8-80cc-4224-ad09-82014e3100c1',
            'Edu Socsc': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUEducationandSocialSciences.pdf?alt=media&token=6a3e95b8-80cc-4224-ad09-82014e3100c1',
            'Medicine': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUInternationalMedicalSchool.pdf?alt=media&token=5925b4cb-b8cf-4b65-98fc-4818b71ef480',
            'Hospitality Creativearts': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUHospitalityandCreativeArts.pdf?alt=media&token=a84d92f2-462a-4a81-87ec-b4b376e4c581',
            'Hospitality And Creative Arts': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUHospitalityandCreativeArts.pdf?alt=media&token=a84d92f2-462a-4a81-87ec-b4b376e4c581',
            'Information Science Engine': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUInformationSciencesandEngineering.pdf?alt=media&token=7c1aa152-72b4-4504-9e3b-9e92e982a563',
            'Information Science': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUInformationSciencesandEngineering.pdf?alt=media&token=7c1aa152-72b4-4504-9e3b-9e92e982a563',
            'Engineering': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUInformationSciencesandEngineering.pdf?alt=media&token=7c1aa152-72b4-4504-9e3b-9e92e982a563',
            'Health And Life Sciences': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUHealthandLifeSciences.pdf?alt=media&token=5f57551a-dfd1-4456-bf61-9e0bc4312fe1',
            'Informationsc Engin': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUInformationSciencesandEngineering.pdf?alt=media&token=7c1aa152-72b4-4504-9e3b-9e92e982a563',
            'Health Lifesc': 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSUHealthandLifeSciences.pdf?alt=media&token=5f57551a-dfd1-4456-bf61-9e0bc4312fe1',
        };
        const answer = await handleOpenAIAssistant(query, threadID);
        await sendResponseParts(answer, msg.from, brochureFilePaths, client, idSubstring, extractedNumber);
    }, { timeout: 60000 });
}

async function handleDocumentMessage(msg, sender, threadID, client, idSubstring, extractedNumber) {
    const lockKey = `thread_${threadID}`;
    return lock.acquire(lockKey, async () => {
        let query = "The file you just received is a document containing examination results. Please analyze the image and provide relevant information about the results.";
        if (msg.caption) {
            query += `\n\n${msg.caption}`;
        }
        try {
            const media = await msg.downloadMedia();
            if (media && media.data) {
                console.log("Has media");
                // Check if the base64 data is empty
                if (media.data.trim() === '') {
                    const sentMessage = await client.sendMessage(msg.from, "The PDF file you sent appears to be empty. Could you please try sending it again?");
                    await addMessagetoFirebase(sentMessage, idSubstring, extractedNumber);
                    return;
                }
                // Convert first page of PDF to image
                const imageBase64 = await convertPDFToImage(media.data);
                
                // Analyze the image using GPT-4 Vision
                const visionResponse = await analyzeImageWithGPT4Vision(imageBase64, query);

                // Add the vision analysis to the thread
                await addMessage(threadID, `Document Analysis: ${visionResponse}`);

                // Get the final response from the assistant
                const answer = await handleOpenAIAssistant(`Based on the document analysis: ${visionResponse}, ${query}`, threadID);
                await sendResponseParts(answer, msg.from, {}, client, idSubstring, extractedNumber);
            } else {
                const sentMessage = await client.sendMessage(msg.from, "Sorry, I couldn't analyze that document. Could you try sending it again as an image or asking a different question?");
                await addMessagetoFirebase(sentMessage, idSubstring, extractedNumber);
            }
        } catch (error) {
            console.error("Error in document processing:", error);
            let errorMessage = "Sorry, I couldn't analyze that document. Could you try sending it again or asking a different question?";
            if (error.message === "The PDF file is empty" || error.name === "InvalidPDFException") {
                errorMessage = "The PDF file you sent appears to be invalid or empty. Could you please try sending it again?";
            }
            const sentMessage = await client.sendMessage(msg.from, errorMessage);
            await addMessagetoFirebase(sentMessage, idSubstring, extractedNumber);
        }
    }, { timeout: 60000 });
}

async function convertPDFToImage(pdfBase64) {
    try {
        if (pdfBase64.trim() === '') {
            throw new Error("The PDF file is empty");
        }
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        const pdfArray = new Uint8Array(pdfBuffer);
        const outputImages = await pdfImgConvert.convert(pdfArray, {
            width: 600, // width in pixels
            height: 600, // height in pixels
            page_numbers: [1], // only convert the first page
            base64: true
        });
        
        if (outputImages && outputImages.length > 0) {
            return outputImages[0]; // Return the base64 string of the first page
        } else {
            throw new Error("No images were generated from the PDF");
        }
    } catch (error) {
        console.error("Error converting PDF to image:", error);
        throw error;
    }
}


async function handleImageMessage(msg, sender, threadID, client, idSubstring, extractedNumber) {
    const media = await msg.downloadMedia();
    let query = "The image you just received contains examination results. Please analyze the image and provide relevant information about this picture. Re-repeat the user's results and determine whether or not they are capable of enrolling in MSU";
    if (msg.caption) {
        query += `\n\n${msg.caption}`;
    }

    try {
        // Convert the image to base64
        const base64Image = media.data;

        // Call GPT-4 Vision API
        const visionResponse = await analyzeImageWithGPT4Vision(base64Image, query);

        // Add the vision analysis to the thread
        await addMessage(threadID, `Image Analysis: ${visionResponse}`);

        // Get the final response from the assistant
        const answer = await handleOpenAIAssistant(`Based on the image analysis: ${visionResponse}, ${query}`, threadID);
        await sendResponseParts(answer, msg.from, {}, client, idSubstring, extractedNumber);
    } catch (error) {
        console.error("Error in image processing:", error);
        const sentMessage = await client.sendMessage(msg.from, "Sorry, I couldn't analyze that image. Could you try sending it again or asking a different question?");
        await addMessagetoFirebase(sentMessage, idSubstring, extractedNumber);
    }
}

async function analyzeImageWithGPT4Vision(base64Image, query) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4-vision-preview",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: query },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/jpeg;base64,${base64Image}`,
                            },
                        },
                    ],
                },
            ],
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error analyzing image with GPT-4 Vision:", error);
        throw error;
    }
}

async function sendResponseParts(answer, to, brochureFilePaths, client, idSubstring, extractedNumber) {
    const parts = answer.split(/\s*\|\|\s*/);
    for (const part of parts) {
        if (part.trim()) {
            const cleanedPart = await removeTextInsideDelimiters(part);
            const strippedPart = stripMarkdownLink(cleanedPart);
            const sentMessage = await client.sendMessage(to, strippedPart);
            await addMessagetoFirebase(sentMessage, idSubstring, extractedNumber);
            await handleSpecialResponses(strippedPart, to, brochureFilePaths, client, idSubstring, extractedNumber);
        }
    }
}

async function addMessagetoFirebase(msg, idSubstring, extractedNumber){
    console.log('Adding message to Firebase');
    console.log('idSubstring:', idSubstring);
    console.log('extractedNumber:', extractedNumber);
  
    if (!extractedNumber || !extractedNumber.startsWith('+60')) {
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
    if(msg.type === 'chat'){
        type ='text'
      }else{
        type = msg.type;
      }
    if (msg.hasMedia && msg.type === 'audio') {
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
  
    if((msg.from).includes('@g.us')){
        const authorNumber = '+'+(msg.author).split('@')[0];
  
        const authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
        if(authorData){
            messageData.author = authorData.contactName;
        }else{
            messageData.author = msg.author;
        }
    }
  
    if (msg.type === 'audio') {
        messageData.audio = {
            mimetype: 'audio/ogg; codecs=opus', // Default mimetype for WhatsApp voice messages
            data: audioData // This is the base64 encoded audio data
        };
    }
  
    if (msg.hasMedia &&  msg.type !== 'audio') {
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
  }

function stripMarkdownLink(text) {
    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const match = regex.exec(text);
    if (match && match[2]) {
        return match[2];
    }
    return text;
}
async function handleSpecialResponses(part, to, brochureFilePaths, client, idSubstring, extractedNumber) {
    if (part.includes('Sit back, relax and enjoy our campus tour!') || part.includes('Jom lihat fasiliti-fasiliti terkini')) {
        const vidPath = 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSU%20campus%20tour%20smaller%20size.mp4?alt=media&token=efb9496e-f2a8-4210-8892-5f3f21b9a061';
        const media = await MessageMedia.fromUrl(vidPath);
        const documentMessage = await client.sendMessage(to, media);
        await addMessagetoFirebase(documentMessage, idSubstring, extractedNumber);
    }
    if (part.includes('Check out our food video!') || part.includes('Jom makan makan!')) {
        const vidPath2 = 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/MSU%20FOOD%208%20ne.mp4?alt=media&token=a9d10097-6619-4031-8319-9e0a4af4e080';
        const media = await MessageMedia.fromUrl(vidPath2);
        const documentMessage = await client.sendMessage(to, media);
        await addMessagetoFirebase(documentMessage, idSubstring, extractedNumber);
    }
    if (part.includes('enjoy reading about the exciting')) {
        await addtagbookedFirebase(extractedNumber, 'idle', idSubstring);
        
        setTimeout(async () => {
            const contactPresent = await getContact(extractedNumber);
            const idleTags = contactPresent.tags
            if (idleTags && idleTags.includes('idle')) {
                console.log(`User ${contactID} has been idle for 1 hour`);
                const sentMessage = await client.sendMessage(to, "Would you like to check out our cool campus tour? It's got top-notch facilities and amazing student life.");
                await addMessagetoFirebase(sentMessage, idSubstring, extractedNumber);
            }
        }, 60 * 60 * 1000);
    }
    for (const [key, filePath] of Object.entries(brochureFilePaths)) {
        if (part.includes(key) && part.includes("Brochure")) {
            console.log(`${key} sending file, ${filePath}`);
            const media = await MessageMedia.fromUrl(filePath);
            const documentMessage = await client.sendMessage(to, media, {sendMediaAsDocument: true, filename: `${key}.pdf`});
            await addMessagetoFirebase(documentMessage, idSubstring, extractedNumber);
            break;
        }
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
        const response = await axios.request(options);
        console.log(response);
    } catch (error) {
        console.error('Error adding tag to contact:', error);
    }
}

async function createThread() {
    console.log('Creating a new thread...');
    const thread = await openai.beta.threads.create();
    return thread;
}

async function addMessage(threadId, message, documentDetails) {
    console.log('Adding a new message to thread: ' + threadId);

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

        fs.unlinkSync(tempFilePath);
    }

    const response = await openai.beta.threads.messages.create(threadId, requestBody);
    return response;
}

async function addMessageAssistant(threadId, message, documentDetails = null) {
    console.log('Adding a new message to thread: ' + threadId);

    const requestBody = {
        role: "assistant",
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

        fs.unlinkSync(tempFilePath);
    }

    const response = await openai.beta.threads.messages.create(threadId, requestBody);
    return response;
}

async function removeTextInsideDelimiters(text) {
    const cleanedText = text.replace(/【.*?】/g, '');
    return cleanedText;
}

async function callWebhook(webhook,senderText,senderNumber,senderName) {
    console.log('Calling webhook...');
    const webhookUrl = webhook;
    const body = JSON.stringify({ senderText,senderNumber,senderName });
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: body
    });  let responseData =""
    if(response.status === 200){
        responseData= await response.text();
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
    console.log(runObject);
    console.log('Current status: ' + status);
    
    if (status == 'completed') {
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

async function runNameAssistant(assistantID, threadId) {
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
    const assistantId = 'asst_tqVuJyl8gR1ZmV7OdBdQBNEF';

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
    
    if (status == 'completed') {
        clearInterval(pollingInterval);
        try {
            const messagesList = await openai.beta.threads.messages.list(threadId);
            const latestMessage = messagesList.body.data[0].content;

            console.log("Latest Message:");
            console.log(latestMessage[0].text.value);
            const answer = latestMessage[0].text.value;
            return answer;
        } catch (error) {
            console.log("error from handleNewMessagesMSU: " + error)
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

async function runAssistantFile(assistantID, threadId, query) {
    console.log('Running assistant for thread: ' + threadId);
    const response = await openai.beta.threads.runs.create(
        threadId,
        {
            assistant_id: assistantID,
            instructions: query
        }
    );

    const runId = response.id;
    console.log('Run ID:', runId);

    const answer = await waitForCompletion(threadId, runId);
    return answer;
}

const rateLimitMap = new Map();
const messageQueue = new Map();
const processingThreads = new Set();

async function handleOpenAIAssistant(message, threadID) {
    const assistantId = 'asst_tqVuJyl8gR1ZmV7OdBdQBNEF';
    
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

async function handleOpenAIAssistantFile(message, threadID, documentDetails = null) {
    const assistantId = 'asst_tqVuJyl8gR1ZmV7OdBdQBNEF';
    await addMessage(threadID, message, documentDetails);
    const answer = await runAssistantFile(assistantId, threadID, message);
    return answer;
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
        const run = await openai.beta.threads.runs.create(
            threadID,
            { assistant_id: assistantId }
        );

        // Wait for the run to complete
        let runStatus = await openai.beta.threads.runs.retrieve(threadID, run.id);
        while (runStatus.status !== "completed") {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
            runStatus = await openai.beta.threads.runs.retrieve(threadID, run.id);
        }

        // Retrieve the assistant's response
        const messages = await openai.beta.threads.messages.list(threadID);
        const answer = messages.data[0].content[0].text.value;

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


async function fetchConfigFromDatabase() {
    try {
        const docRef = db.collection('companies').doc('021');
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

module.exports = { handleNewMessagesMSU };