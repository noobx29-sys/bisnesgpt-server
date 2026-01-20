# Bot Mode Backend - Setup & Configuration

## ✅ Implementation Complete

The Bot Mode backend has been successfully implemented! This document provides setup instructions and usage guidelines.

## 🗄️ Database Setup

### 1. Run Migration

Run the SQL migration to create required tables and columns:

```bash
psql $DATABASE_URL -f migrations/create_bot_flows_tables.sql
```

Or manually run the SQL in your Neon PostgreSQL console.

### Tables Created:
- **`bot_flows`** - Stores bot flow configurations (nodes and edges)
- **`bot_flow_executions`** - Logs execution history for debugging/analytics
- **`companies.bot_mode`** - Column to track if company uses 'ai' or 'bot' mode

## 🔧 Environment Variables

Add these to your `.env` file:

```bash
# Database (already configured)
DATABASE_URL=your_neon_postgresql_connection_string

# OpenAI API Key (for AI Assistant blocks)
OPENAI_API_KEY=your_openai_api_key

# Server Configuration
PORT=3000
URL=https://your-server-url.com
```

### Getting OpenAI API Key:
1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Add it to your `.env` file
4. Ensure your account has credits

## 📦 Dependencies

Required NPM packages (add if missing):

```bash
npm install openai
```

Existing packages already support Bot Mode:
- `pg` - PostgreSQL client (already installed)
- `whatsapp-web.js` - WhatsApp integration (already installed)
- `express` - Web server (already installed)

## 🚀 API Endpoints

### 1. Load Bot Flow
```
GET /api/bot-flow?companyId=YOUR_COMPANY_ID
```

**Response:**
```json
{
  "success": true,
  "flow": {
    "id": 1,
    "companyId": "company123",
    "name": "Welcome Bot",
    "nodes": [...],
    "edges": [...],
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### 2. Save Bot Flow
```
POST /api/bot-flow
Content-Type: application/json

{
  "companyId": "company123",
  "name": "Welcome Bot",
  "nodes": [...],
  "edges": [...]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Bot flow saved successfully"
}
```

### 3. Set Company Mode
```
POST /api/company-mode
Content-Type: application/json

{
  "companyId": "company123",
  "mode": "bot"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Company mode set to bot",
  "companyId": "company123",
  "mode": "bot"
}
```

### 4. Get Company Mode
```
GET /api/company-mode?companyId=company123
```

**Response:**
```json
{
  "success": true,
  "companyId": "company123",
  "mode": "bot"
}
```

### 5. Get Execution History
```
GET /api/bot-flow-executions?companyId=company123&limit=50
```

**Response:**
```json
{
  "success": true,
  "executions": [
    {
      "id": 1,
      "companyId": "company123",
      "contactId": "60123456789@c.us",
      "flowId": 1,
      "startedAt": "2024-01-01T12:00:00Z",
      "completedAt": "2024-01-01T12:00:05Z",
      "status": "completed",
      "errorMessage": null,
      "nodesExecuted": [...],
      "variablesFinal": {...}
    }
  ]
}
```

### 6. Delete Bot Flow
```
DELETE /api/bot-flow?companyId=company123
```

**Response:**
```json
{
  "success": true,
  "message": "Bot flow deleted successfully"
}
```

## 🎯 How It Works

### Message Flow

1. **Message Received** → WhatsApp receives a message
2. **Check Mode** → System checks if company is in 'ai' or 'bot' mode
3. **Route to Handler**:
   - **AI Mode**: Routes to `handleNewMessagesTemplateWweb()` (existing)
   - **Bot Mode**: Routes to `handleBotFlowMessage()` (new)
4. **Execute Flow** → Bot flow handler executes nodes sequentially
5. **Send Responses** → Messages sent back to user via WhatsApp

### Execution Context

Each flow execution maintains a context object:

```javascript
{
  userMessage: "Hello",
  contactId: "60123456789@c.us",
  variables: {
    message: "Hello",
    name: "John Doe",
    phone: "60123456789",
    email: "",
    address: "",
    notes: "",
    // ... custom variables added during flow
  },
  visitedNodes: Set(['node-1', 'node-2'])
}
```

## 🧩 Supported Block Types

### 1. WhatsApp Trigger
Entry point for the flow when a message is received.

### 2. Send Message
Sends a text message to the user. Supports variable templating.

**Example:**
```
Hello {{name}}! You said: {{message}}
```

### 3. AI Assistant
Uses OpenAI GPT-4 to analyze data and generate responses.

**Configuration:**
- **Instruction**: What you want the AI to do
- **Variables**: Data to feed to AI (e.g., `{{message}}`, `{{name}}`)
- **Output Variable**: Where to store AI response

### 4. If/Else
Conditional branching based on message content or variables.

**Supported Conditions:**
- `{{message}} == 'yes'` - Equality check
- `{{message}} contains 'hello'` - Contains check
- `{{message}} != 'no'` - Not equal check

### 5. Delay
Waits for a specified duration before continuing.

**Units:** seconds, minutes, hours

### 6. Loop
Repeats actions multiple times.

**Configuration:**
- **Iterations**: Number of times to repeat

### 7. Set Variable
Stores values in variables for use throughout the flow.

**Example:**
```
Variable Name: customerName
Variable Value: {{name}}
```

## 🔍 Testing

### 1. Test Database Connection
```bash
node -e "const pool = require('./db'); pool.query('SELECT NOW()').then(r => console.log('✅ Connected:', r.rows[0].now)).catch(e => console.error('❌ Error:', e))"
```

### 2. Test Mode Switching
```bash
# Set to bot mode
curl -X POST http://localhost:3000/api/company-mode \
  -H "Content-Type: application/json" \
  -d '{"companyId":"test123","mode":"bot"}'

# Check mode
curl http://localhost:3000/api/company-mode?companyId=test123
```

### 3. Test Flow Creation
```bash
curl -X POST http://localhost:3000/api/bot-flow \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "test123",
    "name": "Test Flow",
    "nodes": [
      {
        "id": "node-1",
        "type": "whatsappTrigger",
        "position": {"x": 0, "y": 0},
        "data": {"label": "Trigger"}
      },
      {
        "id": "node-2",
        "type": "sendMessage",
        "position": {"x": 0, "y": 100},
        "data": {"label": "Welcome", "message": "Hello {{name}}!"}
      }
    ],
    "edges": [
      {
        "id": "edge-1",
        "source": "node-1",
        "target": "node-2",
        "type": "smoothstep",
        "animated": true,
        "markerEnd": {"type": "arrowclosed"}
      }
    ]
  }'
```

### 4. Monitor Logs

When a message is received, you should see:

```
🔔 [MESSAGE_HANDLER] ===== INCOMING MESSAGE =====
🔔 [MESSAGE_HANDLER] Bot: test123
🔔 [MESSAGE_HANDLER] From: 60123456789@c.us
🔔 [MESSAGE_HANDLER] Company test123 mode: BOT
🔔 [MESSAGE_HANDLER] 🤖 Using BOT MODE - executing flow
🤖 [BOT_FLOW] ===== Starting bot flow execution =====
🤖 [BOT_FLOW] Company: test123
🤖 [BOT_FLOW] Flow loaded: "Test Flow" (2 nodes, 1 edges)
🤖 [BOT_FLOW] 📍 Executing node: sendMessage (node-2)
🤖 [BOT_FLOW] 💬 Sending message: "Hello John!"
🤖 [BOT_FLOW] ✅ Message sent successfully
🤖 [BOT_FLOW] ✅ Flow execution completed successfully
```

## 🐛 Troubleshooting

### Issue: "Bot is not configured yet"
**Solution:** Create a bot flow using the UI or API, ensure trigger node exists.

### Issue: "Company not found"
**Solution:** Ensure company exists in `companies` table with correct `company_id`.

### Issue: AI Assistant not working
**Solution:** 
- Check `OPENAI_API_KEY` is set in `.env`
- Verify API key has credits
- Check logs for API errors

### Issue: Variables not replacing
**Solution:** 
- Use correct syntax: `{{variableName}}`
- Ensure variable is set before use
- Check variable name matches exactly (case-sensitive)

### Issue: Flow not executing
**Solution:**
1. Check company mode: `GET /api/company-mode?companyId=xxx`
2. Verify flow exists: `GET /api/bot-flow?companyId=xxx`
3. Check logs for errors
4. Ensure trigger node is connected to first action

## 📊 Monitoring & Analytics

View execution history:
```bash
curl http://localhost:3000/api/bot-flow-executions?companyId=test123&limit=10
```

Check for errors:
```sql
SELECT * FROM bot_flow_executions 
WHERE company_id = 'test123' 
AND status = 'error' 
ORDER BY started_at DESC;
```

## 🔐 Security Notes

1. **API Keys**: Never expose OpenAI API key in frontend
2. **Input Validation**: All user inputs are sanitized
3. **Rate Limiting**: 1 second delay between messages to avoid WhatsApp rate limits
4. **Error Handling**: Graceful degradation - flow continues even if nodes fail

## 📈 Performance Tips

1. **Cache Flows**: Flows are loaded once per execution
2. **Connection Pooling**: Database connections are pooled automatically
3. **Async Execution**: All I/O operations are async
4. **Loop Limits**: Recommend max 100 iterations per loop

## 🔄 Migration from AI Mode to Bot Mode

1. Create bot flow in UI
2. Test flow using simulator
3. Switch company to bot mode: `POST /api/company-mode`
4. Monitor first few messages
5. Adjust flow as needed
6. Can switch back to AI mode anytime

## 📝 Example Flows

Check the main implementation guide for:
- Simple Welcome Bot
- AI-Powered Support Bot
- FAQ Bot with Conditions
- Lead Qualification Bot
- Appointment Booking Bot

## 🆘 Support

For issues or questions:
1. Check logs for detailed error messages
2. Verify database connection and tables
3. Test API endpoints individually
4. Review execution history for debugging

## ✨ Next Steps

1. ✅ Run database migration
2. ✅ Add OPENAI_API_KEY to .env
3. ✅ Restart server
4. 🎨 Create bot flows in UI
5. 🧪 Test with simulator
6. 🚀 Deploy to production

---

**Implementation Version:** 2.0  
**Last Updated:** 2024  
**Status:** Production Ready ✅
