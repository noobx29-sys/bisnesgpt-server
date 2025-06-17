const fetch = require('node-fetch');
const admin = require('../firebase.js');
const db = admin.firestore();
const OpenAI = require('openai');
const moment = require('moment-timezone');

let ghlConfig = {};
const openai = new OpenAI({
    apiKey: process.env.OPENAIKEY,
});
async function fetchConfigFromDatabase(idSubstring) {
    try {
        const docRef = db.collection('companies').doc(idSubstring);
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

const axios = require('axios');

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

async function handleEdwardTag(req, res) {
    console.log('edward webhook');
    console.log(req.body);
    const idSubstring = '093';

    await fetchConfigFromDatabase(idSubstring);

    const { requestType, phone, first_name } = req.body;

    if (!phone || !first_name) {
        return res.status(400).json({ error: 'Phone number, name, and quote date are required' });
    }

    let phoneWithPlus = phone.replace(/\s+|-/g, '');
    if (!phoneWithPlus.startsWith('+')) {
        phoneWithPlus = "+" + phoneWithPlus;
    }
    const phoneWithoutPlus = phoneWithPlus.replace('+', '');

    const chatId = `${phoneWithoutPlus}@c.us`;

    console.log(chatId);
    try {
        switch (requestType) {
            case 'removeFollowUp':
                await removeScheduledMessages(chatId, idSubstring, 'edwardfollowup');
                res.json({ success: true });
                break;
            default:
                res.status(400).json({ error: 'Invalid request type' });
        }
    } catch (error) {
        res.status(500).json({ phone: phoneWithPlus, first_name, success: false, error: error.message });
    }
}

async function pauseFollowUpMessages(chatId, idSubstring, type) {
    try {
        console.log(`Pausing follow-up messages for chat ${chatId}`);

        // 1. Fetch scheduled messages from Firebase
        const scheduledMessagesRef = db.collection('companies').doc(idSubstring)
            .collection('scheduledMessages');
        
        const snapshot = await scheduledMessagesRef
            .where('chatIds', 'array-contains', chatId)
            .where('status', '!=', 'completed')
            .where('type', '==', type)
            .get();

        if (snapshot.empty) {
            console.log('No scheduled messages found to pause.');
            return;
        }

        // 2. Update each scheduled message to 'paused' status
        for (const doc of snapshot.docs) {
            await pauseMessage(doc, idSubstring, chatId);
        }

        console.log(`Paused ${snapshot.size} scheduled messages for chat ${chatId}`);

        // 3. If type is '5daysfollowup', pause the staff reminder
        if (type === '5daysfollowup') {
            const staffReminderSnapshot = await scheduledMessagesRef
                .where('chatIds', 'array-contains', '60135186862@c.us')
                .where('status', '!=', 'completed')
                .where('type', '==', type)
                .get();

            for (const doc of staffReminderSnapshot.docs) {
                await pauseMessage(doc, idSubstring, '60135186862@c.us');
            }

            console.log(`Paused ${staffReminderSnapshot.size} staff reminder messages`);
        }
    } catch (error) {
        console.error('Error pausing follow-up messages:', error);
        throw error;
    }
}

async function pauseMessage(doc, idSubstring, chatId) {
    const messageId = doc.id;
    const messageData = doc.data();
    
    // Prepare the updated message data
    const updatedMessage = {
        ...messageData,
        status: 'paused'
    };
    
    // Ensure scheduledTime is properly formatted
    if (updatedMessage.scheduledTime && typeof updatedMessage.scheduledTime === 'object') {
        updatedMessage.scheduledTime = {
            seconds: Math.floor(updatedMessage.scheduledTime.seconds),
            nanoseconds: updatedMessage.scheduledTime.nanoseconds || 0
        };
    } else {
        // If scheduledTime is missing or invalid, use the current time
        updatedMessage.scheduledTime = {
            seconds: Math.floor(Date.now() / 1000),
            nanoseconds: 0
        };
    }
    
    // Call the API to update the message
    try {
        await axios.put(`http://localhost:8443/api/schedule-message/${idSubstring}/${messageId}`, updatedMessage);
        console.log(`Paused scheduled message ${messageId} for chatId: ${chatId}`);
    } catch (error) {
        console.error(`Error pausing scheduled message ${messageId}:`, error.response ? error.response.data : error.message);
    }
}

async function resumeFollowUpMessages(chatId, idSubstring, type) {
    try {
        console.log(`Resuming follow-up messages for chat ${chatId}`);

        const scheduledMessagesRef = db.collection('companies').doc(idSubstring)
            .collection('scheduledMessages');
        
        const snapshot = await scheduledMessagesRef
            .where('chatIds', 'array-contains', chatId)
            .where('status', '==', 'paused')
            .where('type', '==', type)
            .orderBy('scheduledTime', 'asc')
            .get();

        if (snapshot.empty) {
            console.log('No scheduled messages found to resume.');
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);  // Set to start of day
        const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const firstScheduledTime = messages[0].scheduledTime.toDate();
        const timeDifference = today.getTime() - firstScheduledTime.getTime();

        for (const message of messages) {
            const originalTime = message.scheduledTime.toDate();
            const newScheduledTime = new Date(originalTime.getTime() + timeDifference);

            const updatedMessage = {
                ...message,
                messages: message.chatIds.map(chatId => ({
                    chatId,
                    message: message.message // You might want to replace this with actual contact names if available
                  })),
                scheduledTime: {
                    seconds: Math.floor(newScheduledTime.getTime() / 1000),
                    nanoseconds: (newScheduledTime.getTime() % 1000) * 1e6
                },
                status: 'scheduled',
            };

            try {
                await axios.put(`http://localhost:8443/api/schedule-message/${idSubstring}/${message.id}`, updatedMessage);
                console.log(`Resumed and rescheduled message ${message.id} for chatId: ${chatId}`);
            } catch (error) {
                console.error(`Error resuming and rescheduling message ${message.id}:`, error.response ? error.response.data : error.message);
            }
        }

        console.log(`Resumed and rescheduled ${messages.length} messages for chat ${chatId}`);

        // Handle staff reminder
        if (type === '5daysfollowup') {
            const staffReminderSnapshot = await scheduledMessagesRef
                .where('chatIds', 'array-contains', '60135186862@c.us')
                .where('status', '==', 'paused')
                .where('type', '==', type)
                .orderBy('scheduledTime', 'desc')
                .limit(1)
                .get();

            if (!staffReminderSnapshot.empty) {
                const staffReminder = staffReminderSnapshot.docs[0];
                const originalStaffReminderTime = staffReminder.data().scheduledTime.toDate();
                const newStaffReminderTime = new Date(originalStaffReminderTime.getTime() + timeDifference);

                const updatedStaffReminder = {
                    ...staffReminder.data(),
                    messages: currentScheduledMessage.chatIds.map(chatId => ({
                        chatId,
                        message: staffReminder.data().message // You might want to replace this with actual contact names if available
                      })),
                    scheduledTime: {
                        seconds: Math.floor(newStaffReminderTime.getTime() / 1000),
                        nanoseconds: (newStaffReminderTime.getTime() % 1000) * 1e6
                    },
                    status: 'scheduled',
                };

                try {
                    await axios.put(`http://localhost:8443/api/schedule-message/${idSubstring}/${staffReminder.id}`, updatedStaffReminder);
                    console.log(`Resumed and rescheduled staff reminder message ${staffReminder.id}`);
                } catch (error) {
                    console.error(`Error resuming and rescheduling staff reminder message ${staffReminder.id}:`, error.response ? error.response.data : error.message);
                }
            }
        }
    } catch (error) {
        console.error('Error resuming follow-up messages:', error);
        throw error;
    }
}


async function scheduleFollowUpMessages(chatId, idSubstring, customerName, language) {
    let dailyMessages;
    if(language == 'english'){
        dailyMessages = [
            [
                { type: 'image', url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/binna%20%20english.jpeg?alt=media&token=f80a156a-3304-4cbb-9317-f721fcaf741b', caption: "" },
                "FREE Site Inspection Roofing, Slab Waterproofing with Senior Chinese Shifu & get a Quotation Immediately (For Klang Valley, KL, Seremban & JB areas only).",
                "Hi 😊 Snowy here from BINA Pasifik S/B. We specialized in Roofing & Waterproofing. Thank you for connecting us through Facebook.",
                "May I know which area are you from? How should I address you? 😊",
                "Any issues with your roof? Leaking while raining? Any photo?",
                "Is your house single or double-story? Is your roof roof tiles, metal roof, or concrete slab?"
            ],
            [
                { type: 'image', url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/binna%20%20english.jpeg?alt=media&token=f80a156a-3304-4cbb-9317-f721fcaf741b', caption: "" },
                "Hi, FREE Site Inspection Roofing and slab Waterproofing with Senior Chinese Shifu & get Quotation Immediately (For Klang Valley, KL, Seremban & JB areas only).",
                "May I know the condition of your roof? Is your roof leaking or do you want to refurbish/repaint your roof?"
            ],
            [
                "That day you pm me about the water leakage problem",
                "Is there a leak in your home or shop??🧐"
            ],
            [
                "Good day,",
                "We'd like to schedule a 🆓 FREE inspection at your place. We're available on Tuesday, Wednesday, Saturday, or Sunday.",
                "Which day works best for you???🤔"
            ],
            [
                "Hi",
                "You may contact +60193668776",
                "My manager will personally address your technical questions about the roof.",
            ],
            [
                "Morning",
                "Have you contacted my manager??",
                "You can contact him directly by calling +60193668776 ☺️",
            ]
        ];
    } else if(language == 'chinese'){
        dailyMessages = [
            [
                { type: 'image', url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/binna%20chinese.jpeg?alt=media&token=16e450f8-9a49-42ee-baea-ece2eb35347f', caption: "" },
                "你好, 华人师傅免费屋顶&地台防水检查，并立即获得报价 (只限Klang Valley, KL, Seremban & JB )",
                "您好😊 我是 snowy 来自 BINA Pasifik S/B。我们是屋顶和防水专业公司。感谢您通过Facebook联系我们。",
                "请问您是来自那一区？如何称呼您的名字？😊",
                "请问屋顶下雨漏水吗？有照片看看吗？屋顶是屋瓦片吗？单层还是双层？",
            ],
            [
                { type: 'image', url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/binna%20chinese.jpeg?alt=media&token=16e450f8-9a49-42ee-baea-ece2eb35347f', caption: "" },
                "你好, 华人师傅免费屋顶&地台防水检查，并立即获得报价 (只限Klang Valley, KL, Seremban & JB )。",
                "请问屋顶有什么问题吗？是漏水吗？还是想喷漆翻新屋顶呢?"
            ],
            [
                "那天你有pm过我关于漏水问题的",
                "请问你是住家还是店面漏水呢??🧐"
            ],
            [
                "你好",
                "我们星期二、三、六或日有时间帮你上门做🆓免费漏水检查哦",
                "你在哪一天方便呢？🤔"
            ],
            [
                "你可以联系 +60193668776 , 我的manager会亲自回答你屋顶技术上的问题",
            ],
            [
                "你contact我的manager了吗？",
                "可以直接call +60193668776 联系他哦☺️",
            ]
        ];
    } else if(language == 'malay'){
        dailyMessages = [
            [
                { type: 'image', url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/binna%20malay.jpeg?alt=media&token=c6916786-cc81-4626-ac5e-adf0550d2a33', caption: "" },
                "Hi, PERCUMA Pemeriksaan Tapak Bumbung, Kalis Air Papak dgn Senior Supervisor & dapatkan Quotation Segera (Klang Valley, KL ,Seremban & JB shj).",
                "Selamat sejahtera 😊 Saya Snowy dari BINA Pasifik S/B. Kami pakar kalis air dan bumbung. Terima kasih kerana menghubungi kami melalui Facebook.",
                "Nak tanya area dari mana kamu? KL ke? Apakah nama anda? 😊",
                "Bumbung bocor? Hujan baru air keluar ke? Ada gambar?",
                "Rumah 1 tingkat atau 2 tingkat ye? Bumbung itu tiles roof, metal roof atau concrete slab?",
            ],
            [
                { type: 'image', url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/binna%20malay.jpeg?alt=media&token=c6916786-cc81-4626-ac5e-adf0550d2a33', caption: "" },
                "Hi, PERCUMA Pemeriksaan Tapak Bumbung, Kalis Air Papak dgn Senior Supervisor & dapatkan Quotation Segera (Klang Valley, KL ,Seremban & JB sahaja).",
                "Boleh saya tahu, apakah masalah dengan bumbung? Adakah ia bocor? Atau adakah anda ingin mengecat semula bumbung tersebut?"
            ],
            [
                "Hari itu anda pm saya berkenaan masalah kebocoran bumbung.",
                "Adakah bocor di rumah atau kedai anda??🧐"
            ],
            [
                "Adakah bocor di rumah atau kedai anda??🧐",
                "Kami boleh mengatur kunjungan ke tempat anda untuk pemeriksaan secara 🆓PERCUMA pada hari Selasa, Rabu, Sabtu, atau Ahad yang akan datang.",
                "Hari mana yang sesuai untuk anda??🤔"
            ],
            [
                "Hi",
                "Anda boleh menghubungi +60193668776, manager saya akan menjawab secara peribadi mengenai isu teknikal bumbung tersebut.",
            ],
            [
                "Hi, nak tanya adakah kamu menghubungi Manager saya?",
                "Boleh terus call Manager saya ye (+60193668776) ☺️",
            ]
        ];
    }
    const numberOfDays = dailyMessages.length;

    for (let day = 0; day < numberOfDays; day++) {
        const messagesForDay = dailyMessages[day];
        for (let i = 0; i < messagesForDay.length; i++) {
            // Schedule messages starting at 10 AM, with 2-hour intervals
            const scheduledTime = moment().add(day, 'days').set({hour: 10 + (i * 2), minute: 0, second: 0});
            const message = messagesForDay[i];
            
            if (typeof message === 'object' && message.type === 'image') {
                await scheduleImageMessage(message.url, message.caption, scheduledTime.toDate(), chatId, idSubstring, '5daysfollowup');
            } else {
                await scheduleReminderMessage(message, scheduledTime.toDate(), chatId, idSubstring, '5daysfollowup');
            }
        }
    }

    // Schedule the staff reminder 2 hours after the last message of the last day
    const lastDay = dailyMessages[numberOfDays - 1];
    const scheduledTime = moment().add(numberOfDays - 1, 'days')
                                  .set({hour: 10 + (lastDay.length * 2), minute: 0, second: 0});
    const staffReminder = `Day ${numberOfDays} last follow up ${customerName}, ${chatId.split('@')[0]}`;
    await scheduleReminderMessage(staffReminder, scheduledTime.toDate(), '60135186862@c.us', idSubstring, '5daysfollowup');
}

async function scheduleFollowUpAfterQuoteMessages(chatId, idSubstring, customerName, language) {
    let dailyMessages
    if(language == 'english'){
        dailyMessages = [
            [
            `Hello, ${customerName}, have you reviewed the quotation and photos we sent you?`,
            "If you have any questions, feel free to ask in this group ya... 😊"
        ],
        [
            "Regarding the quotation we sent you the other day…",
            "Is there anything you would like us to explain to you in more detail? 🤔"
        ],
        [
            "Good day,",
            "We can schedule your work within the next two weeks",
            "We'd like to know if you're interested in repairing your roof? 🧐"
        ],
        [
            "Hi",
            "You can ask questions about your roof quotation in this group yaa",
            "Mr. Kelvin, who came to inspect your roof that day, can answer any technical questions regarding your roof 👌"
        ],
        [
            "Hello, although the quotation is valid for only 14 days, but if you're interested in proceeding with the roof repair, please let us know",
            "We can see what we can do to adjust the quotation for you again 😊",
        ]
    ];
    } else if(language == 'chinese'){
        dailyMessages = [
            [
            `你好，想知道 ${customerName}, 你有过目了我们发给你的报价和照片吗？`,
            "如果有任何疑问可以在这个群组问让我们知道哦 🤔"
        ],
        [
            "关于那天我们发给你的报价",
            "想请问你有什么需要我们详细解释给你知道的呢？🤔"
        ],
        [
            "你好,",
            "我们在下两个星期里面能够安排到你的工了",
            "想了解你有兴趣要维修你的屋顶吗？🧐"
        ],
        [
            "Hi",
            "你可以在这个群组询问关于你屋顶报价的问题",
            "Mr. Kelvin 那天来看你屋顶的可以解答你的屋顶技术上的问题哦"
        ],
        [
            "你好，虽然报价的有效期是14天。但如果你有兴趣想要进行这场屋顶维修工，可以再让我们知道。",
            "我们可以再帮你调整报价",
        ]
    ];
    } else if(language == 'malay'){
        dailyMessages = [
            [
            `Hello, Encik ${customerName}, adakah anda sudah meneliti sebut harga dan gambar yang kami hantar kepada anda?`,
            "Jika ada sebarang pertanyaan, anda boleh tanya dalam kumpulan ini ye.. 🤔"
        ],
        [
            "Tentang sebut harga yang kami hantar kepada anda hari itu,",
            "Adakah terdapat apa-apa yang anda ingin kami jelaskan dengan lebih terperinci? 🤔"
        ],
        [
            "Selamat sejahtera",
            "Kami boleh menjadualkan kerja anda dalam masa dua minggu akan datang...",
            "Kami ingin tahu jika anda berminat untuk membaiki bumbung anda ke? 🧐"
        ],
        [
            "Hi",
            "Anda boleh tanya soalan mengenai sebut harga bumbung anda dalam kumpulan ini ye",
            "Mr. Kelvin yang datang memeriksa bumbung anda boleh menjawab soalan teknikal mengenai bumbung anda."
        ],
        [
            "Hello, walaupun sebut harga ini sah untuk 14 hari, jika anda berminat untuk meneruskan kerja pembaikan bumbung, sila maklumkan kepada kami",
            "Kami boleh menyemak semula sebut harga untuk anda",
        ]
    ];
    }

    for (let day = 0; day < dailyMessages.length; day++) {
        for (let i = 0; i < dailyMessages[day].length; i++) {
            // Schedule messages starting at 10 AM, with 2-hour intervals
            const scheduledTime = moment().add(day, 'days').set({hour: 10 + (i * 2), minute: 0, second: 0});
            const message = dailyMessages[day][i];
            
            await scheduleReminderMessage(message, scheduledTime.toDate(), chatId, idSubstring, 'followUpAfterQuote');
            }
        }
}


async function scheduleFollowUpBeforeQuoteMessages(chatId, idSubstring, customerName, contactNumber) {
    const baseMessage = `Quotation reminder for ${customerName}, ${contactNumber}`;

    // Schedule the message once a day for 10 days
    for (let day = 1; day <= 10; day++) {
        const message = `Day ${day} ${baseMessage}`;
        const scheduledTime = moment().add(day, 'days').set({hour: 10, minute: 0, second: 0}); // Set to 10:00 AM each day
        await scheduleReminderMessage(message, scheduledTime.toDate(), '60135186862@c.us', idSubstring, 'followUpBeforeQuote');
    }
}

async function scheduleImageMessage(imageUrl, caption, scheduledTime, chatId, idSubstring, type) {
    const scheduledTimeSeconds = Math.floor(scheduledTime.getTime() / 1000);
    
    const scheduledMessage = {
        batchQuantity: 1,
        chatIds: [chatId],
        companyId: idSubstring,
        createdAt: admin.firestore.Timestamp.now(),
        documentUrl: "",
        fileName: null,
        mediaUrl: imageUrl,
        message: caption,
        type: type,
        messages: [
            {
              chatId: chatId,
              message: caption
            }
          ],
        mimeType: "image/jpeg", // Adjust if needed
        repeatInterval: 0,
        repeatUnit: "days",
        scheduledTime: {
            seconds: scheduledTimeSeconds,
            nanoseconds: 0
        },
        status: "scheduled",
        v2: true,
        whapiToken: null
    };

    try {
        const response = await axios.post(`http://localhost:8443/api/schedule-message/${idSubstring}`, scheduledMessage);
        console.log('Image message scheduled successfully:', response.data);
    } catch (error) {
        console.error('Error scheduling image message:', error.response ? error.response.data : error.message);
    }
}

async function scheduleReminderMessage(eventSummary, startDateTime, chatId, idSubstring, type) {
    // Convert to seconds and ensure it's an integer
    const scheduledTimeSeconds = Math.floor(startDateTime.getTime() / 1000);
  
    console.log('Scheduling reminder for:', moment(startDateTime).format());
    console.log('Scheduled time in seconds:', scheduledTimeSeconds);
    
    const scheduledMessage = {
        batchQuantity: 1,
        chatIds: [chatId],
        companyId: idSubstring,
        createdAt: admin.firestore.Timestamp.now(),
        documentUrl: "",
        type: type,
        fileName: null,
        mediaUrl: "",
        message: eventSummary,
        messages: [
            {
              chatId: chatId,
              message: eventSummary
            }
          ],        
        mimeType: null,
        repeatInterval: 0,
        repeatUnit: "days",
        scheduledTime: {
            seconds: scheduledTimeSeconds,
            nanoseconds: 0
        },
        status: "scheduled",
        v2: true,
        whapiToken: null
    };
  
    try {
      console.log('Sending schedule request:', JSON.stringify(scheduledMessage));
      const response = await axios.post(`http://localhost:8443/api/schedule-message/${idSubstring}`, scheduledMessage);
      console.log('Reminder scheduled successfully:', response.data);
    } catch (error) {
      console.error('Error scheduling reminder:', error.response ? error.response.data : error.message);
      if (error.response && error.response.data) {
        console.error('Server response:', error.response.data);
      }
    }
  }

  async function removeScheduledMessages(chatId, idSubstring, type) {
    try {
      const scheduledMessagesRef = db.collection('companies').doc(idSubstring).collection('scheduledMessages');
      
      const snapshot = await scheduledMessagesRef
        .where('chatIds', 'array-contains', chatId)
        .where('status', '!=', 'completed')
        .where('type', '==', type)
        .get();
      
      for (const doc of snapshot.docs) {
        const messageId = doc.id;
        
        // Call the API to delete the message
        try {
          await axios.delete(`http://localhost:8443/api/schedule-message/${idSubstring}/${messageId}`);
          console.log(`Deleted scheduled message ${messageId} for chatId: ${chatId}`);
        } catch (error) {
          console.error(`Error deleting scheduled message ${messageId}:`, error.response ? error.response.data : error.message);
        }
      }
      
      console.log(`Deleted ${snapshot.size} scheduled messages for chatId: ${chatId}`);
  
      // If type is '5daysfollowup', remove the staff reminder
      if (type === '5daysfollowup') {
        const staffReminderSnapshot = await scheduledMessagesRef
          .where('chatIds', 'array-contains', '60135186862@c.us')
          .where('status', '!=', 'completed')
          .where('type', '==', type)
          .get();
  
        for (const doc of staffReminderSnapshot.docs) {
          const messageId = doc.id;
          
          try {
            await axios.delete(`http://localhost:8443/api/schedule-message/${idSubstring}/${messageId}`);
            console.log(`Deleted staff reminder message ${messageId}`);
          } catch (error) {
            console.error(`Error deleting staff reminder message ${messageId}:`, error.response ? error.response.data : error.message);
          }
        }
  
        console.log(`Deleted ${staffReminderSnapshot.size} staff reminder messages`);
      }
    } catch (error) {
      console.error('Error removing scheduled messages:', error);
    }
  }




module.exports = { handleEdwardTag };