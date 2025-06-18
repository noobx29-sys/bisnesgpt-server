const admin = require('../firebase.js');
const db = admin.firestore();

async function handleZakatBlast(req, res, client) {
    console.log('Zakat blast webhook triggered');
    console.log(req.body);

    // Extract personal information from the form submission
    const personalInfo = {
        name: req.body['11'],         // Name
        ic: req.body['12'],          // IC number
        phone: req.body['13'],       // Phone number
        email: req.body['14'],       // Email
        amount: req.body['28'],      // Payment amount
        paymentType: req.body['26']  // Tahunan
    };

    if (!personalInfo.phone || !personalInfo.name) {
        return res.status(400).json({ error: 'Phone number and name are required' });
    }

    // Format phone number
    let phone = personalInfo.phone.replace(/\s+|-/g, '');
    let phoneWithPlus = phone;
    if (!phone.startsWith('+')) {
        phoneWithPlus = "+" + phone;
    } else {
        phone = phone.replace('+', '');
    }

    const chatId = `${phone.replace(/^\+/, '')}@c.us`;
    console.log(`Sending zakat message to ${chatId} (${personalInfo.name})`);

    try {
        // Create personalized message
        const message = `Assalamualaikum ${personalInfo.name},\n\n`
            + `Terima kasih kerana membayar zakat sebanyak RM${personalInfo.amount} melalui Lembaga Zakat Selangor.\n\n`
            + `Kami akan memproses pembayaran anda dan menghantar resit dalam masa yang terdekat.\n\n`
            + `Semoga Allah memberkati harta dan kehidupan anda.`;

        // Send the message
        const msg = await client.sendMessage(chatId, message);
        
        // Log to group (optional)
        await client.sendMessage('120363178065670386@g.us', 
            `New Zakat Payment:\nName: ${personalInfo.name}\nAmount: RM${personalInfo.amount}`);

        // Add message to Firebase
        const messageData = {
            chat_id: msg.from,
            from: msg.from ?? "",
            from_me: msg.fromMe ?? false,
            id: msg.id._serialized ?? "",
            status: "delivered",
            text: {
                body: message ?? ""
            },
            timestamp: msg.timestamp ?? 0,
            type: 'text'
        };

        // Update contact in Firebase
        const contactData = {
            phone: phoneWithPlus,
            tags: ['zakat'],
            email: personalInfo.email,
            ic: personalInfo.ic,
            paymentAmount: personalInfo.amount,
            paymentType: personalInfo.paymentType,
            chat: {
                contact_id: phoneWithPlus,
                id: chatId,
                name: personalInfo.name,
                not_spam: true,
                tags: ['zakat'],
                timestamp: msg.timestamp ?? 0,
                type: 'contact',
                unreadCount: 0,
                last_message: messageData
            },
            chat_id: chatId,
            contactName: personalInfo.name,
            last_message: messageData,
            createdAt: admin.firestore.Timestamp.now()
        };

        // Save to Firebase
        await db.collection('companies')
            .doc('0124')
            .collection('contacts')
            .doc(phoneWithPlus)
            .set(contactData, { merge: true });

        // Save message to messages subcollection
        await db.collection('companies')
            .doc('0124')
            .collection('contacts')
            .doc(phoneWithPlus)
            .collection('messages')
            .doc(msg.id._serialized)
            .set(messageData);

        res.json({ 
            success: true, 
            message: `Zakat payment confirmation sent to ${personalInfo.name} (${phoneWithPlus})`
        });

    } catch (error) {
        console.error(`Error sending zakat message to ${phone}:`, error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            phone: personalInfo.phone,
            name: personalInfo.name 
        });
    }
}

module.exports = { handleZakatBlast };