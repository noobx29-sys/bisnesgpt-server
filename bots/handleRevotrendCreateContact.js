const fetch = require('node-fetch');
const admin = require('../firebase.js');
const db = admin.firestore();
const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAIKEY,
});

async function handleRevotrendCreateContact(req, res, client) {
    console.log('revotrend webhook');
    console.log(req.body);

    const { fields } = req.body;
    const first_name = fields.name?.value || '';
    let phone = fields.Number?.value || '';
    const serviceType = fields.serviceType?.value || ''; // For RSP, RSC, RST
    const note = fields.Note?.value || '';

    if (!phone || !first_name) {
        return res.status(400).json({ error: 'Phone number and name are required' });
    }

    // Format phone number
    phone = phone.replace(/\s+|-/g, '');
    let phoneWithPlus = phone;
    if(!phone.startsWith('+')){
        phoneWithPlus = "+"+phone;
    }else{
        phone = phone.replace('+', '');
    }

    const chatId = `${phone.replace(/^\+/, '')}@c.us`;

    try {
        const message = `New contact added. ${first_name} - ${phoneWithPlus}`;
        const msg = await client.sendMessage("601121677522@c.us", message);
        
        const tags = [serviceType];
        // Add message to assistant
        const messageData = await addMessagetoFirebase(msg, '0123', phoneWithPlus, first_name);

        const data = {
            phone: phoneWithPlus,
            tags: tags,
            chat: {
                contact_id: phoneWithPlus,
                id: chatId,
                name: first_name,
                not_spam: true,
                tags: tags,
                timestamp: Date.now(),
                type: 'contact',
                unreadCount: 0,
                last_message: {
                    chat_id: msg.from,
                    from: msg.from ?? "",
                    from_me: msg.fromMe ?? false,
                    id: msg.id._serialized ?? "",
                    source: "",
                    status: "delivered",
                    text: {
                        body: message ?? ""
                    },
                    timestamp: msg.timestamp ?? 0,
                    type:'text',
                },
            },
            chat_id: chatId,
            contactName: first_name,
            unreadCount: 0,
            threadid: "",
            phoneIndex: 0, // For Revotrend
            last_message: {
                chat_id: msg.from,
                from: msg.from ?? "",
                from_me: msg.fromMe ?? false,
                id: msg.id._serialized ?? "",
                source: "",
                status: "delivered",
                text: {
                    body: message ?? ""
                },
                timestamp: msg.timestamp ?? 0,
                type: 'text',
            },
        };

        data.createdAt = admin.firestore.Timestamp.now();

        await addNotificationToUser('0123', messageData, first_name);

        // Add the data to Firestore
        await db.collection('companies').doc('0123').collection('contacts').doc(phoneWithPlus).set(data, {merge: true});   

        res.json({ success: true });
    } catch (error) {
        console.error(`Error sending message to ${phone}:`, error);
        res.json({ phone, first_name, success: false, error: error.message });
    }
}

module.exports = { handleRevotrendCreateContact }; 