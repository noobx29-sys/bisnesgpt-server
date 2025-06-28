const chatSubscriptions = require('./chatSubscriptions');
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
module.exports = { broadcastNewMessageToChat };
  
  module.exports = { broadcastNewMessageToChat };