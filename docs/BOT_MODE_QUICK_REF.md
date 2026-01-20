# Bot Mode - Quick Reference

## 🚀 Quick Start

### 1. Run Migration
```bash
psql $DATABASE_URL -f migrations/create_bot_flows_tables.sql
```

### 2. Test Implementation
```bash
node test-bot-mode.js
```

### 3. Restart Server
```bash
npm start
# or
pm2 restart all
```

## 📋 API Cheat Sheet

### Load Flow
```bash
curl "http://localhost:3000/api/bot-flow?companyId=YOUR_COMPANY_ID"
```

### Save Flow
```bash
curl -X POST http://localhost:3000/api/bot-flow \
  -H "Content-Type: application/json" \
  -d '{"companyId":"xxx","name":"My Flow","nodes":[],"edges":[]}'
```

### Switch to Bot Mode
```bash
curl -X POST http://localhost:3000/api/company-mode \
  -H "Content-Type: application/json" \
  -d '{"companyId":"xxx","mode":"bot"}'
```

### Switch to AI Mode
```bash
curl -X POST http://localhost:3000/api/company-mode \
  -H "Content-Type: application/json" \
  -d '{"companyId":"xxx","mode":"ai"}'
```

### Check Current Mode
```bash
curl "http://localhost:3000/api/company-mode?companyId=YOUR_COMPANY_ID"
```

### View Execution History
```bash
curl "http://localhost:3000/api/bot-flow-executions?companyId=YOUR_COMPANY_ID&limit=10"
```

## 🎯 Block Types

| Block | Purpose | Key Data Fields |
|-------|---------|----------------|
| WhatsApp Trigger | Entry point | None |
| Send Message | Send text | `message` |
| AI Assistant | AI analysis | `instruction`, `variables`, `outputVariable` |
| If/Else | Conditional | `condition` |
| Delay | Wait | `delay`, `unit` |
| Loop | Repeat | `iterations` |
| Set Variable | Store data | `variableName`, `variableValue` |

## 🔤 Variable Syntax

Use `{{variableName}}` in messages and conditions.

**Built-in variables:**
- `{{message}}` - User's message
- `{{name}}` - Contact name
- `{{phone}}` - Contact phone
- `{{email}}` - Contact email
- `{{address}}` - Contact address
- `{{notes}}` - Contact notes
- `{{loopIndex}}` - Current loop iteration (in loops)

**Custom variables:**
Created using "Set Variable" blocks.

## ✅ Condition Examples

```javascript
// Equality
{{message}} == 'yes'
{{message}} == 'no'

// Contains
{{message}} contains 'hello'
{{message}} contains 'help'

// Not equal
{{message}} != 'cancel'

// Variable comparison
{{customerType}} == 'premium'
```

## 📊 Flow Structure

```json
{
  "companyId": "company123",
  "name": "Welcome Bot",
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
      "data": {
        "label": "Welcome",
        "message": "Hello {{name}}!"
      }
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
}
```

## 🔍 Debugging

### Check Logs
```bash
# Filter for bot flow logs
pm2 logs | grep "BOT_FLOW"

# Or view all logs
pm2 logs
```

### Log Patterns

**Success:**
```
🤖 [BOT_FLOW] ===== Starting bot flow execution =====
🤖 [BOT_FLOW] Flow loaded: "My Flow" (5 nodes, 4 edges)
🤖 [BOT_FLOW] 📍 Executing node: sendMessage
🤖 [BOT_FLOW] 💬 Sending message: "Hello!"
🤖 [BOT_FLOW] ✅ Flow execution completed successfully
```

**Error:**
```
🤖 [BOT_FLOW] ❌ Error executing bot flow: [error details]
```

### Database Queries

**Check if tables exist:**
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_name IN ('bot_flows', 'bot_flow_executions');
```

**Check company mode:**
```sql
SELECT company_id, bot_mode 
FROM companies 
WHERE company_id = 'YOUR_COMPANY_ID';
```

**View flows:**
```sql
SELECT id, company_id, name, 
       jsonb_array_length(nodes) as node_count,
       jsonb_array_length(edges) as edge_count,
       created_at, updated_at
FROM bot_flows;
```

**Recent executions:**
```sql
SELECT * FROM bot_flow_executions 
ORDER BY started_at DESC 
LIMIT 10;
```

**Failed executions:**
```sql
SELECT * FROM bot_flow_executions 
WHERE status = 'error' 
ORDER BY started_at DESC;
```

## 🚨 Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Bot is not configured yet" | No flow exists | Create flow in UI |
| "Company not found" | Invalid company ID | Check company_id in database |
| AI Assistant fails | Missing API key | Add OPENAI_API_KEY to .env |
| Variables not replacing | Wrong syntax | Use `{{variableName}}` |
| Flow not executing | Wrong mode | Set mode to 'bot' |

## 📁 File Structure

```
server/
├── server.js                  # Main server (modified)
├── botFlowHandler.js          # Bot flow execution (new)
├── db.js                      # Database connection
├── test-bot-mode.js          # Test script (new)
├── BOT_MODE_SETUP.md         # Full setup guide (new)
├── BOT_MODE_QUICK_REF.md     # This file (new)
└── migrations/
    └── create_bot_flows_tables.sql  # Database migration (new)
```

## 🔄 Mode Switching

Companies can switch between modes anytime:

**AI Mode (Default):**
- Uses OpenAI for intelligent responses
- Processes messages through AI handlers
- Learns from conversations

**Bot Mode (New):**
- Uses predefined flows
- Executes blocks sequentially
- Deterministic responses

## ⚡ Performance

- Flow loading: Cached per execution
- Message delay: 1 second (avoid rate limits)
- Database queries: Connection pooled
- AI calls: ~2-5 seconds response time
- Loop limit: Recommend max 100 iterations

## 🎨 Best Practices

1. **Keep flows simple**: Break complex logic into multiple blocks
2. **Test thoroughly**: Use simulator before deploying
3. **Handle errors**: Add fallback messages
4. **Use variables**: Store data for reuse
5. **Monitor logs**: Watch for errors and performance issues

## 📈 Next Steps

1. ✅ Complete setup
2. 🎨 Create first flow in UI
3. 🧪 Test with simulator
4. 🔄 Switch to bot mode
5. 📱 Test with real WhatsApp
6. 📊 Monitor execution history

---

**Quick Links:**
- Full Setup Guide: `BOT_MODE_SETUP.md`
- Database Migration: `migrations/create_bot_flows_tables.sql`
- Test Script: `test-bot-mode.js`
- Main Handler: `botFlowHandler.js`
