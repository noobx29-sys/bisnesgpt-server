# Next Steps - Multi-Process Implementation

## ✅ What's Been Completed

All infrastructure for process isolation is now in place:

- **Process Orchestrator**: `server-orchestrator.js` (430 lines)
- **Message Queue**: `src/services/messaging/queue.js` with BullMQ
- **Process Coordinator**: `src/services/messaging/coordinator.js` with Redis pub/sub
- **Health Monitoring**: `src/services/health/monitoring.js`
- **Message Router**: `src/services/routing/messageRouter.js`
- **Database Migration**: `migrations/process_isolation.sql` (450+ lines)
- **PM2 Configuration**: `ecosystem.config.js` (updated)
- **Scripts**: Migration and startup automation
- **Documentation**: Comprehensive guides and references

## 🚨 Critical Next Step: Code Extraction

The stub files (`server-api.js`, `server-wwebjs.js`, `server-meta.js`) exist but need the actual logic from `server.js`. Here's what needs to be extracted:

### 1. server-wwebjs.js - Extract WWebJS Code

**From server.js, extract these sections:**

```javascript
// Lines ~930: Client configuration
const client = new Client({
    authStrategy: new LocalAuth({...}),
    puppeteer: {...}
});

// Lines ~1650-2200: Bot initialization and message handling
async function initializeBot(phoneNumber) { ... }
function setupMessageHandler(client, phoneNumber) { ... }

// Lines ~29540-30300: Client lifecycle management
async function initializeWithTimeout(...) { ... }
async function safeCleanup(...) { ... }
async function destroyClient(...) { ... }

// Global botMap for wwebjs instances
const botMap = new Map(); // Only for wwebjs bots
```

**Add these to server-wwebjs.js:**
- Import whatsapp-web.js
- Set up queue worker to consume from `wwebjs-messages` queue
- Initialize bots based on phone_configs where connection_type = 'wwebjs'
- Handle QR code generation and session management
- Report health status every 10 seconds

### 2. server-meta.js - Extract Meta Direct Code

**From server.js, extract these sections:**

```javascript
// Lines ~19885-19945: Meta webhook handlers
app.post('/webhooks/whatsapp/:phoneNumber', async (req, res) => {
    // Meta Direct webhook handling
});

// Meta Direct message sending
const metaDirect = require('./src/services/whatsapp/metaDirect');
await metaDirect.sendTemplateMessage(...);
await metaDirect.sendMessage(...);
```

**Add these to server-meta.js:**
- Import metaDirect service
- Set up queue worker to consume from `meta-messages` queue
- Handle Meta Cloud API webhooks
- Send messages via Meta API
- Report health status every 10 seconds

### 3. server-api.js - Extract API Routes

**From server.js, extract these sections:**

```javascript
// Lines ~200-500: Express setup and middleware
const express = require('express');
const app = express();
app.use(express.json());

// Lines ~21500-23500: Contact management routes
app.get('/contacts/:phoneNumber', ...);
app.post('/contacts/:phoneNumber', ...);

// Lines ~24000-25500: Message routes
app.post('/send-message', ...);
app.get('/chat-history/:phoneNumber', ...);

// Lines ~31500-33000: Analytics and reporting routes
app.get('/analytics/:phoneNumber', ...);
app.post('/tags/:phoneNumber', ...);
```

**Add these to server-api.js:**
- All HTTP routes
- Authentication middleware
- Message routing logic (use messageRouter service)
- Health check endpoints
- Database pool management

## 📋 Step-by-Step Implementation

### Step 1: Run the Migration (5 minutes)

```bash
# Set your database connection
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"

# Run migration
./scripts/migrate-process-isolation.sh
```

This will:
- Add process_name columns to phone_configs and phone_status
- Create health tracking tables
- Add helper functions and triggers
- Verify Redis is running

### Step 2: Extract WWebJS Code (1-2 hours)

```bash
# Open server.js and server-wwebjs.js side by side
code server.js server-wwebjs.js
```

Move these functions:
1. `initializeBot()` and all bot initialization logic
2. `setupMessageHandler()` for incoming messages
3. `safeCleanup()` and `destroyClient()` for cleanup
4. `botMap` management (filter for wwebjs only)

Update imports and add queue worker.

### Step 3: Extract Meta Direct Code (1 hour)

```bash
code server.js server-meta.js
```

Move these:
1. Meta webhook endpoint handlers
2. `metaDirect` service usage
3. Template message sending
4. Meta-specific error handling

Add queue worker for meta-messages.

### Step 4: Extract API Routes (2-3 hours)

```bash
code server.js server-api.js
```

Move these:
1. All Express routes
2. Middleware (auth, validation, error handling)
3. Update message sending to use messageRouter
4. Keep database pool management

### Step 5: Test Locally (30 minutes)

```bash
# Test orchestrator (creates stubs if needed)
node server-orchestrator.js

# Test with PM2
npm run pm2:multiprocess

# Check status
pm2 status
pm2 logs bisnesgpt-api
pm2 logs bisnesgpt-wwebjs
pm2 logs bisnesgpt-meta
```

### Step 6: Integration Testing (1-2 hours)

Test scenarios:
1. Send message via wwebjs → Verify delivery
2. Send message via meta → Verify delivery
3. Kill wwebjs process → Verify meta still works
4. Kill meta process → Verify wwebjs still works
5. Restart process → Verify messages queue and deliver

### Step 7: Monitor and Optimize (Ongoing)

```bash
# Monitor health
curl http://localhost:3000/health/overview

# Check queue stats
curl http://localhost:3000/health/queue-stats

# View process metrics
psql $DATABASE_URL -c "SELECT * FROM v_process_health_overview;"
```

## 🔍 Testing Checklist

- [ ] Database migration runs without errors
- [ ] All three processes start via orchestrator
- [ ] WWebJS bot initializes and shows QR code
- [ ] Meta webhooks receive and process messages
- [ ] API routes respond correctly
- [ ] Messages route to correct process
- [ ] Process isolation works (kill one, others continue)
- [ ] Automatic restart works with exponential backoff
- [ ] Health monitoring updates database
- [ ] PM2 cluster mode works for API/Meta
- [ ] Memory limits are respected
- [ ] No message loss during restarts

## 📚 Documentation Reference

- **Architecture**: `WWEBJS_META_ISOLATION_PLAN.md`
- **Migration Guide**: `MULTIPROCESS_MIGRATION_GUIDE.md`
- **Implementation Details**: `IMPLEMENTATION_STATUS.md`
- **Quick Reference**: `QUICK_REFERENCE.md`

## 🚀 Production Deployment

Once local testing passes:

```bash
# On production server
git pull
npm install

# Run migration
export DATABASE_URL="your-prod-db-url"
./scripts/migrate-process-isolation.sh

# Deploy with PM2
npm run pm2:multiprocess

# Monitor
pm2 monit
```

## 🐛 Troubleshooting

**Process won't start:**
- Check `pm2 logs <process-name>`
- Verify environment variables in `.env`
- Check database and Redis connectivity

**Messages not routing:**
- Verify phone_configs has correct connection_type
- Check queue worker is running: `messageQueue.getQueueStats()`
- Inspect Redis: `redis-cli KEYS "*"`

**WWebJS session issues:**
- Check `.wwebjs_auth` directory permissions
- Clear sessions: `rm -rf .wwebjs_auth/<phone>` and restart
- Check Chrome/Puppeteer dependencies

**Meta Direct not receiving:**
- Verify webhook URL is publicly accessible
- Check Meta Cloud API dashboard for delivery status
- Verify verify_token in webhook configuration

## 💡 Pro Tips

1. **Start with one process:** Test each process independently before running all together
2. **Use PM2 logs:** Real-time monitoring with `pm2 logs --lines 100`
3. **Database-first debugging:** Check process_health table for heartbeat issues
4. **Redis visibility:** Use `redis-cli MONITOR` to see all queue activity
5. **Gradual rollout:** Test with a few phone numbers before migrating all

## 📞 Need Help?

Refer to:
- Implementation summary in `IMPLEMENTATION_STATUS.md`
- Quick command reference in `QUICK_REFERENCE.md`
- Detailed architecture in `WWEBJS_META_ISOLATION_PLAN.md`

---

**Status:** Infrastructure complete ✅ | Code extraction pending ⏳ | Estimated time: 4-6 hours
