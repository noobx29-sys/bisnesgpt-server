# Multi-Process Architecture Migration Guide

## Overview

The BisnessGPT server has been refactored to use a multi-process architecture that isolates WWebJS (WhatsApp Web) and Meta Direct (Meta Cloud API) into separate processes. This prevents crashes in one service from affecting the other.

## Architecture

```
┌─────────────────────────────────────────┐
│         Process Orchestrator            │
│      (server-orchestrator.js)           │
└──────────┬──────────────────────────────┘
           │
           ├──────────┬──────────┬─────────┐
           │          │          │         │
           ▼          ▼          ▼         ▼
    ┌───────────┐ ┌────────┐ ┌─────────┐ ┌──────┐
    │    API    │ │ WWebJS │ │  Meta   │ │ ...  │
    │  Server   │ │ Server │ │  Server │ │      │
    └───────────┘ └────────┘ └─────────┘ └──────┘
         │            │          │
         └────────────┴──────────┘
                  │
           ┌──────┴───────┐
           │              │
           ▼              ▼
     ┌──────────┐   ┌─────────┐
     │ Database │   │  Redis  │
     │(PostgreSQL)   │(Queue)  │
     └──────────┘   └─────────┘
```

### Processes

1. **API Server** (`server-api.js`) - Port 3000
   - Handles HTTP requests
   - Routes messages to appropriate worker process
   - Manages authentication and authorization
   - Serves health check endpoints

2. **WWebJS Server** (`server-wwebjs.js`) - Port 3001
   - Manages WhatsApp Web connections
   - Handles Chromium/Puppeteer sessions
   - Processes wwebjs-specific messages
   - Isolated failure domain

3. **Meta Direct Server** (`server-meta.js`) - Port 3002
   - Handles Meta Cloud API connections
   - Processes webhook events
   - Sends messages via Meta API
   - Isolated failure domain

## Benefits

✅ **Isolated Failures**: WWebJS crashes don't affect Meta Direct  
✅ **Independent Restarts**: Each process restarts independently  
✅ **Resource Isolation**: Separate memory/CPU per process  
✅ **Better Performance**: Event loop isolation prevents blocking  
✅ **Horizontal Scaling**: Meta process can scale independently  

## Installation

### 1. Run Migration Script

```bash
chmod +x scripts/migrate-process-isolation.sh
./scripts/migrate-process-isolation.sh
```

This will:
- Run database migrations
- Check dependencies (Redis, PM2)
- Create log directories
- Install required packages

### 2. Update Environment Variables

Copy the new environment template:

```bash
cp .env.example.multiprocess .env
```

Update with your values:

```bash
# Process Configuration
API_PORT=3000
WWEBJS_PORT=3001
META_PORT=3002

# Redis (required for message queue)
REDIS_HOST=localhost
REDIS_PORT=6379

# Database pools
DATABASE_POOL_API_MAX=20
DATABASE_POOL_WWEBJS_MAX=10
DATABASE_POOL_META_MAX=20

# Enable/disable processes
ENABLE_WWEBJS=true
ENABLE_META=true
```

### 3. Install Redis (if not already installed)

**macOS:**
```bash
brew install redis
brew services start redis
```

**Ubuntu/Debian:**
```bash
sudo apt-get install redis-server
sudo systemctl start redis
```

**Verify Redis:**
```bash
redis-cli ping
# Should return: PONG
```

## Usage

### Development Mode

Using orchestrator (recommended for development):

```bash
node server-orchestrator.js
```

### Production Mode

Using PM2 (recommended for production):

```bash
# Start all processes
pm2 start ecosystem.config.js --only bisnesgpt-api,bisnesgpt-wwebjs,bisnesgpt-meta

# Or use the convenience script
chmod +x scripts/start-multiprocess.sh
./scripts/start-multiprocess.sh
```

### PM2 Commands

```bash
# View status
pm2 status

# View logs
pm2 logs

# Monitor resources
pm2 monit

# Restart specific process
pm2 restart bisnesgpt-wwebjs

# Restart all
pm2 restart all

# Stop all
pm2 stop all

# Delete all
pm2 delete all
```

## Health Checks

### Individual Process Health

```bash
# API Server
curl http://localhost:3000/health

# WWebJS Server
curl http://localhost:3001/health

# Meta Server
curl http://localhost:3002/health
```

### All Processes Health

```bash
curl http://localhost:3000/health/all
```

Response example:
```json
{
  "success": true,
  "processes": [
    {
      "processName": "api",
      "status": "healthy",
      "uptime": 3600,
      "memory": 512,
      "activeBots": 0
    },
    {
      "processName": "wwebjs",
      "status": "healthy",
      "uptime": 3590,
      "memory": 2048,
      "activeBots": 5
    },
    {
      "processName": "meta",
      "status": "healthy",
      "uptime": 3595,
      "memory": 256,
      "activeBots": 3
    }
  ]
}
```

## Monitoring

### Database Queries

Check process health:
```sql
SELECT * FROM v_process_health_overview;
```

View recent events:
```sql
SELECT * FROM process_events 
WHERE severity IN ('error', 'critical')
ORDER BY timestamp DESC 
LIMIT 10;
```

View metrics:
```sql
SELECT * FROM process_metrics 
WHERE process_name = 'wwebjs' 
ORDER BY timestamp DESC 
LIMIT 20;
```

### Message Queue Stats

```javascript
const { getAllQueueStats } = require('./src/services/messaging/queue');

const stats = await getAllQueueStats();
console.log(stats);
```

## Troubleshooting

### WWebJS Process Keeps Crashing

1. Check memory limits:
```bash
pm2 describe bisnesgpt-wwebjs
```

2. Increase memory limit in `ecosystem.config.js`:
```javascript
max_memory_restart: '8G'  // Increase if needed
```

3. Check Chrome installation:
```bash
which google-chrome
/usr/bin/google-chrome --version
```

### Meta Direct Not Receiving Messages

1. Check process status:
```bash
pm2 logs bisnesgpt-meta --lines 50
```

2. Verify connection type in database:
```sql
SELECT company_id, phone_index, connection_type, process_name 
FROM phone_configs 
WHERE connection_type IN ('meta_direct', 'meta_embedded', '360dialog');
```

3. Check message queue:
```javascript
const { getQueueStats } = require('./src/services/messaging/queue');
const stats = await getQueueStats('meta');
```

### Redis Connection Issues

1. Check if Redis is running:
```bash
redis-cli ping
```

2. Check Redis connection in logs:
```bash
pm2 logs | grep -i redis
```

3. Verify Redis config in `.env`:
```bash
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Database Connection Pool Exhausted

1. Check active connections:
```sql
SELECT count(*) FROM pg_stat_activity;
```

2. Adjust pool sizes in `.env`:
```bash
DATABASE_POOL_API_MAX=30
DATABASE_POOL_WWEBJS_MAX=15
DATABASE_POOL_META_MAX=30
```

## Rollback to Single Process

If you need to rollback:

1. Stop multi-process setup:
```bash
pm2 delete bisnesgpt-api bisnesgpt-wwebjs bisnesgpt-meta
```

2. Start legacy process:
```bash
pm2 start ecosystem.config.js --only whatsapp-service-legacy
```

3. The database changes are backward compatible

## Performance Tuning

### API Server Scaling

Increase API instances for higher load:
```bash
API_INSTANCES=4 pm2 restart bisnesgpt-api
```

### Meta Server Scaling

Meta can scale horizontally:
```bash
META_INSTANCES=4 pm2 restart bisnesgpt-meta
```

### WWebJS Optimization

WWebJS must run as single instance, but you can:
- Increase memory: `max_memory_restart: '8G'`
- Adjust Chrome args in `.env`
- Limit concurrent bot connections

## Migration Checklist

- [ ] Redis installed and running
- [ ] Database migration completed
- [ ] Environment variables updated
- [ ] PM2 installed globally
- [ ] Log directory created
- [ ] Tested health check endpoints
- [ ] Verified message routing works
- [ ] Monitored for 24 hours
- [ ] Backup and rollback plan ready

## Support

For issues or questions:
1. Check logs: `pm2 logs`
2. Check health: `curl http://localhost:3000/health/all`
3. Review database: `SELECT * FROM v_process_health_overview`
4. Check the main plan: `WWEBJS_META_ISOLATION_PLAN.md`

---

**Last Updated:** 2026-02-14  
**Version:** 1.0
