# Quick Reference: Multi-Process Architecture

## 🚀 Quick Start

```bash
# 1. Migrate database
./scripts/migrate-process-isolation.sh

# 2. Start processes
node server-orchestrator.js

# OR with PM2
pm2 start ecosystem.config.js --only bisnesgpt-api,bisnesgpt-wwebjs,bisnesgpt-meta
```

## 📁 Key Files

| File | Purpose |
|------|---------|
| `server-orchestrator.js` | Process manager |
| `server-api.js` | HTTP API server (stub) |
| `server-wwebjs.js` | WWebJS process (stub) |
| `server-meta.js` | Meta Direct process (stub) |
| `src/services/messaging/queue.js` | Message queues |
| `src/services/routing/messageRouter.js` | Request routing |
| `migrations/process_isolation.sql` | Database changes |
| `ecosystem.config.js` | PM2 configuration |

## 🔌 Ports

- **3000** - API Server
- **3001** - WWebJS Server  
- **3002** - Meta Direct Server

## ⚙️ Environment Variables

```bash
# Required
DATABASE_URL=postgresql://...
REDIS_HOST=localhost
REDIS_PORT=6379

# Process Ports
API_PORT=3000
WWEBJS_PORT=3001
META_PORT=3002

# Enable/Disable
ENABLE_WWEBJS=true
ENABLE_META=true
```

## 🏥 Health Checks

```bash
# Individual processes
curl http://localhost:3000/health  # API
curl http://localhost:3001/health  # WWebJS
curl http://localhost:3002/health  # Meta

# All processes
curl http://localhost:3000/health/all
```

## 📊 PM2 Commands

```bash
pm2 status                # View process status
pm2 logs                  # View all logs
pm2 logs bisnesgpt-wwebjs # View specific process
pm2 restart all           # Restart all processes
pm2 restart bisnesgpt-meta # Restart specific process
pm2 stop all              # Stop all processes
pm2 monit                 # Monitor resources
```

## 🗄️ Database Queries

```sql
-- Process health overview
SELECT * FROM v_process_health_overview;

-- Recent errors
SELECT * FROM process_events 
WHERE severity = 'error' 
ORDER BY timestamp DESC 
LIMIT 10;

-- Process metrics
SELECT * FROM process_metrics 
WHERE process_name = 'wwebjs' 
ORDER BY timestamp DESC 
LIMIT 20;

-- Connection types
SELECT company_id, phone_index, connection_type, process_name 
FROM phone_configs;
```

## 🔄 Message Flow

```
HTTP Request
    ↓
API Server (checks connection_type)
    ↓
Message Router (routes to queue)
    ↓
    ├→ WWebJS Queue → WWebJS Process → WhatsApp Web
    └→ Meta Queue → Meta Process → Meta Cloud API
```

## 🐛 Troubleshooting

### WWebJS Not Working

```bash
# Check process status
pm2 logs bisnesgpt-wwebjs

# Check Chrome
which google-chrome

# Check sessions
ls -la .wwebjs_auth/

# Restart
pm2 restart bisnesgpt-wwebjs
```

### Meta Not Working

```bash
# Check logs
pm2 logs bisnesgpt-meta

# Check webhook
curl -X POST http://localhost:3002/api/meta/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Restart
pm2 restart bisnesgpt-meta
```

### Redis Issues

```bash
# Check Redis
redis-cli ping

# Start Redis
redis-server

# Check connections
redis-cli CLIENT LIST
```

### Database Issues

```bash
# Check connections
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# Run migration again
psql $DATABASE_URL -f migrations/process_isolation.sql
```

## 📝 NPM Scripts

```bash
npm run start                  # Legacy single process
npm run start:orchestrator     # Multi-process orchestrator
npm run start:multiprocess     # PM2 multi-process
npm run migrate                # Run DB migration
npm run pm2:multiprocess       # Start with PM2
npm run pm2:legacy             # Start legacy mode
```

## 🔐 Important Notes

1. **WWebJS must run as single instance** (session management)
2. **Meta can scale horizontally** (stateless)
3. **API can run in cluster mode** (load balancing)
4. **Redis is required** for message queue
5. **PostgreSQL 12+** required for migrations

## 📈 Monitoring Checklist

- [ ] All processes show "online" in PM2
- [ ] Health checks return 200 OK
- [ ] Redis is connected
- [ ] Database pool is healthy
- [ ] Logs show no errors
- [ ] Messages are being processed
- [ ] Queue is not backing up

## 🆘 Emergency Rollback

```bash
# Stop new processes
pm2 delete bisnesgpt-api bisnesgpt-wwebjs bisnesgpt-meta

# Start legacy
pm2 start ecosystem.config.js --only whatsapp-service-legacy

# Check status
pm2 status
curl http://localhost:8443/health
```

---

**For detailed information, see:**
- [WWEBJS_META_ISOLATION_PLAN.md](./WWEBJS_META_ISOLATION_PLAN.md) - Architecture plan
- [MULTIPROCESS_MIGRATION_GUIDE.md](./MULTIPROCESS_MIGRATION_GUIDE.md) - Migration guide
- [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) - Current status
