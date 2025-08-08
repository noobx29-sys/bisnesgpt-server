const chatSubscriptions = require('./chatSubscriptions');

// Chat-specific broadcast function (existing)
function broadcastNewMessageToChat(chatId, message, whapiToken) {
  if (chatSubscriptions.has(chatId)) {
    for (const ws of chatSubscriptions.get(chatId)) {
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "new_message",
            chatId,
            message,
            whapiToken,
          })
        );
      }
    }
  }
}

// Company-wide broadcast function (new)
function broadcastNewMessageToCompany(companyId, messageData) {
  console.log(`🔔 [BROADCAST] ===== COMPANY BROADCAST START =====`);
  console.log(`🔔 [BROADCAST] Company ID: ${companyId}`);
  console.log(`🔔 [BROADCAST] Message Data:`, JSON.stringify(messageData, null, 2));
  
  // Get all WebSocket connections for this company
  const companySubscribers = new Set();
  
  // Find all WebSocket connections that belong to this company
  const wss = global.wss;
  
  if (wss && wss.clients) {
    console.log(`🔔 [BROADCAST] Checking ${wss.clients.size} total WebSocket connections`);
    
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) {
        // Check if this WebSocket belongs to the target company
        const wsCompanyId = ws.companyId;
        console.log(`🔔 [BROADCAST] WebSocket companyId: ${wsCompanyId}, target companyId: ${companyId}`);
        
        if (wsCompanyId === companyId) {
          console.log(`🔔 [BROADCAST] ✅ Found company subscriber for company: ${companyId}`);
          companySubscribers.add(ws);
        }
      }
    }
  }
  
  console.log(`🔔 [BROADCAST] Found ${companySubscribers.size} company subscribers`);
  
  // Send message to all company subscribers
  let messagesSent = 0;
  for (const ws of companySubscribers) {
    if (ws.readyState === ws.OPEN) {
      console.log(`🔔 [BROADCAST] Sending to company subscriber`);
      ws.send(JSON.stringify({
        type: "new_message",
        chatId: messageData.chatId,
        message: messageData.message,
        extractedNumber: messageData.extractedNumber,
        contactId: messageData.contactId,
        fromMe: messageData.fromMe,
        timestamp: messageData.timestamp,
        messageType: messageData.messageType,
        contactName: messageData.contactName
      }));
      console.log(`🔔 [BROADCAST] ✅ Message sent to company subscriber`);
      messagesSent++;
    }
  }
  
  console.log(`🔔 [BROADCAST] Total messages sent to company subscribers: ${messagesSent}`);
  console.log(`🔔 [BROADCAST] ===== COMPANY BROADCAST END =====`);
}

module.exports = { 
  broadcastNewMessageToChat,
  broadcastNewMessageToCompany
};