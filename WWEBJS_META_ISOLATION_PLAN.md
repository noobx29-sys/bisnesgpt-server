# WWebJS and Meta Direct Isolation Plan

## Problem Statement

Currently, wwebjs (WhatsApp Web) and Meta Direct (Meta Cloud API) share the same server infrastructure and error handling mechanisms. When wwebjs bots fail, crash, or encounter errors, they appear to be affecting Meta Direct bots, preventing them from sending messages until the server is restarted.

### Root Causes Identified

1. **Shared Error Handlers**: Global `uncaughtException` and `unhandledRejection` handlers don't distinguish between wwebjs and Meta Direct errors
2. **Shared botMap**: Both connection types use the same `botMap` data structure
3. **Database Connection Pool**: Shared connection pool means database errors from wwebjs operations can exhaust connections needed by Meta Direct
4. **Shared Event Loop**: CPU-intensive wwebjs operations (Chromium/Puppeteer) can block the Node.js event loop, affecting Meta Direct API calls
5. **Global Process State**: Errors in wwebjs initialization/cleanup (`safeCleanup`, `destroyClient`) can trigger process-level interventions
6. **Shared Message Queue**: BullMQ queues might be affected by wwebjs failures

## Solution Architecture

### Option A: Process Isolation (Recommended)
Isolate wwebjs and Meta Direct into separate Node.js processes while sharing the same codebase.

**Pros:**
- Complete isolation: wwebjs crashes won't affect Meta Direct at all
- Resource isolation: Each can have its own memory, CPU limits
- Independent restart capabilities
- Maintains single codebase
- Better observability - separate logs/metrics per process

**Cons:**
- Slightly more complex deployment
- Need IPC (Inter-Process Communication) for coordination
- Need shared database and message queue coordination

### Option B: Service Layer Abstraction
Create isolated service layers within the same process using separate execution contexts.

**Pros:**
- Simpler deployment (single process)
- Shared resources (less overhead)
- Easier development

**Cons:**
- Not true isolation - major crashes still affect everything
- Event loop blocking still occurs
- Harder to debug cascading failures

**✅ RECOMMENDED: Option A - Process Isolation**

## Implementation Plan

### Phase 1: Code Restructuring (Week 1)

#### 1.1 Create Separate Entry Points
```
bisnesgpt-server/
├── server-wwebjs.js      # WWebJS bot server
├── server-meta.js        # Meta Direct API server
├── server-api.js         # Shared API server (current server.js)
└── server-orchestrator.js # Process manager
```

**Tasks:**
- [ ] Extract wwebjs-specific code to `server-wwebjs.js`
  - `initializeBot()`, `initializeWithTimeout()`
  - `safeCleanup()`, `destroyClient()`
  - `botMap` for wwebjs only
  - Puppeteer/Chromium handlers
  - Session management (`.wwebjs_auth`)
  
- [ ] Extract Meta Direct code to `server-meta.js`
  - Meta Direct webhook handlers
  - Meta API calls (`metaDirect.js` service)
  - Meta-specific botMap (or eliminate botMap for Meta)
  - Connection status tracking
  
- [ ] Keep shared code in `server-api.js`
  - Express API endpoints
  - Database connections (pool per process)
  - Authentication/authorization
  - Message storage and retrieval
  - Contact management
  - Analytics and reporting

#### 1.2 Create Shared Services Layer
```
src/
├── services/
│   ├── database/
│   │   └── connectionPool.js  # Per-process pool
│   ├── messaging/
│   │   ├── queue.js           # BullMQ setup
│   │   └── coordinator.js     # Cross-process coordination
│   ├── whatsapp/
│   │   ├── wwebjs/            # WWebJS-specific
│   │   │   ├── client.js
│   │   │   ├── session.js
│   │   │   └── handlers.js
│   │   └── metaDirect/        # Meta-specific
│   │       ├── api.js
│   │       ├── webhook.js
│   │       └── handlers.js
│   └── state/
│       └── botStatus.js       # Shared bot status (via DB)
```

**Tasks:**
- [ ] Refactor database service to support per-process pools
- [ ] Create separate wwebjs and meta directories
- [ ] Implement state synchronization via database
- [ ] Remove direct cross-dependencies

### Phase 2: Process Management (Week 1-2)

#### 2.1 Create Process Orchestrator
**File:** `server-orchestrator.js`

```javascript
const { fork } = require('child_process');
const path = require('path');

class ProcessOrchestrator {
  constructor() {
    this.processes = {
      api: null,
      wwebjs: null,
      meta: null
    };
    this.restartCounts = { api: 0, wwebjs: 0, meta: 0 };
  }

  start() {
    // Start API server (always needed)
    this.startProcess('api', './server-api.js');
    
    // Start WWebJS server (only if wwebjs bots configured)
    this.startProcess('wwebjs', './server-wwebjs.js');
    
    // Start Meta Direct server (only if meta bots configured)
    this.startProcess('meta', './server-meta.js');
  }

  startProcess(name, script) {
    const child = fork(path.join(__dirname, script), [], {
      env: { ...process.env, PROCESS_NAME: name },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    this.processes[name] = child;

    child.on('exit', (code) => {
      this.handleProcessExit(name, code);
    });

    child.on('message', (msg) => {
      this.handleProcessMessage(name, msg);
    });
  }

  handleProcessExit(name, code) {
    console.error(`Process ${name} exited with code ${code}`);
    
    // Don't restart if wwebjs crashes - only affects wwebjs bots
    if (name === 'wwebjs') {
      console.log('WWebJS process crashed - Meta Direct bots unaffected');
      // Optional: restart after delay
      setTimeout(() => this.startProcess(name, this.getScript(name)), 5000);
    }
    
    // Meta Direct should auto-restart
    if (name === 'meta') {
      console.log('Meta Direct process crashed - restarting...');
      this.startProcess(name, this.getScript(name));
    }

    // API server is critical
    if (name === 'api') {
      console.error('API server crashed - restarting immediately');
      this.startProcess(name, this.getScript(name));
    }
  }

  handleProcessMessage(name, msg) {
    // Handle IPC messages between processes
    if (msg.type === 'status_update') {
      // Broadcast to other processes
      this.broadcast(msg, name);
    }
  }

  broadcast(msg, exclude) {
    Object.entries(this.processes).forEach(([name, proc]) => {
      if (name !== exclude && proc) {
        proc.send(msg);
      }
    });
  }
}

const orchestrator = new ProcessOrchestrator();
orchestrator.start();

// Graceful shutdown
process.on('SIGINT', () => {
  Object.values(orchestrator.processes).forEach(proc => {
    if (proc) proc.kill('SIGTERM');
  });
  process.exit(0);
});
```

**Tasks:**
- [ ] Implement process orchestrator
- [ ] Add health checks per process
- [ ] Implement restart policies (exponential backoff)
- [ ] Add inter-process communication for status updates

#### 2.2 Process-Specific Error Handling

**WWebJS Process (`server-wwebjs.js`):**
```javascript
// Isolated error handlers for wwebjs
process.on('uncaughtException', (error) => {
  console.error('[WWEBJS] Uncaught exception:', error);
  
  // Only handle wwebjs-related errors
  if (error.message.includes('Protocol error') || 
      error.message.includes('Target closed') ||
      error.message.includes('Session closed')) {
    console.log('[WWEBJS] Browser/session error - cleaning up...');
    // Cleanup wwebjs sessions only
    return;
  }
  
  // For critical errors, restart process
  console.error('[WWEBJS] Critical error - process will restart');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[WWEBJS] Unhandled rejection:', reason);
  // Handle wwebjs-specific rejections
});
```

**Meta Direct Process (`server-meta.js`):**
```javascript
// Isolated error handlers for Meta Direct
process.on('uncaughtException', (error) => {
  console.error('[META] Uncaught exception:', error);
  
  // Meta API errors are usually recoverable
  if (error.code === 'ECONNREFUSED' || 
      error.code === 'ETIMEDOUT' ||
      error.response?.status >= 500) {
    console.log('[META] Temporary API error - continuing...');
    return;
  }
  
  console.error('[META] Critical error - process will restart');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[META] Unhandled rejection:', reason);
  // Meta API errors should not crash the process
  if (reason?.response?.status < 500) {
    console.log('[META] Client error - continuing...');
    return;
  }
});
```

**Tasks:**
- [ ] Implement process-specific error handlers
- [ ] Add error classification (recoverable vs critical)
- [ ] Implement graceful degradation for each process
- [ ] Add error metrics/monitoring per process

### Phase 3: Database & State Management (Week 2)

#### 3.1 Connection Pool Per Process
Each process gets its own connection pool to prevent contention.

**Configuration:**
```javascript
// In each process
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.PROCESS_NAME === 'wwebjs' ? 10 : 20, // Less for wwebjs
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

**Tasks:**
- [ ] Configure separate connection pools
- [ ] Add connection pool monitoring
- [ ] Implement automatic reconnection per process
- [ ] Add connection limits based on process type

#### 3.2 Shared State via Database
Use database as single source of truth for bot status.

**Schema Updates:**
```sql
-- Add process_name column to track which process handles the bot
ALTER TABLE phone_configs ADD COLUMN process_name VARCHAR(20);
ALTER TABLE phone_status ADD COLUMN process_name VARCHAR(20);

-- Index for efficient queries
CREATE INDEX idx_phone_configs_process ON phone_configs(process_name, status);
CREATE INDEX idx_phone_status_process ON phone_status(process_name, status);

-- Add process health table
CREATE TABLE process_health (
  process_name VARCHAR(20) PRIMARY KEY,
  status VARCHAR(20) NOT NULL,
  last_heartbeat TIMESTAMP DEFAULT NOW(),
  error_count INTEGER DEFAULT 0,
  last_error TEXT,
  uptime_seconds INTEGER,
  memory_usage_mb INTEGER
);
```

**Tasks:**
- [ ] Add process tracking columns
- [ ] Implement heartbeat mechanism per process
- [ ] Create process health monitoring
- [ ] Add queries to route requests to correct process

### Phase 4: Message Routing & API Updates (Week 2-3)

#### 4.1 Smart Message Routing
API server routes requests to the appropriate process based on connection type.

**Implementation:**
```javascript
// In server-api.js
async function routeMessage(companyId, phoneIndex, messageData) {
  // Check connection type from database
  const config = await pool.query(
    'SELECT connection_type, process_name FROM phone_configs WHERE company_id = $1 AND phone_index = $2',
    [companyId, phoneIndex]
  );
  
  const connectionType = config.rows[0]?.connection_type;
  
  if (connectionType === 'wwebjs') {
    // Send to wwebjs process via IPC or message queue
    return await sendToWwebjsProcess(companyId, phoneIndex, messageData);
  } else if (['meta_direct', 'meta_embedded', '360dialog'].includes(connectionType)) {
    // Send to meta process via IPC or message queue
    return await sendToMetaProcess(companyId, phoneIndex, messageData);
  }
  
  throw new Error('Unknown connection type');
}

// Use BullMQ for reliable message passing
const wwebjsQueue = new Queue('wwebjs-messages', { connection: redis });
const metaQueue = new Queue('meta-messages', { connection: redis });

async function sendToWwebjsProcess(companyId, phoneIndex, messageData) {
  return await wwebjsQueue.add('send-message', {
    companyId,
    phoneIndex,
    messageData
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 }
  });
}

async function sendToMetaProcess(companyId, phoneIndex, messageData) {
  return await metaQueue.add('send-message', {
    companyId,
    phoneIndex,
    messageData
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
  });
}
```

**Tasks:**
- [ ] Implement message routing logic
- [ ] Create separate BullMQ queues per process
- [ ] Add queue workers in each process
- [ ] Implement retry logic per connection type
- [ ] Add request tracking and monitoring

#### 4.2 API Endpoint Updates
Update all message-sending endpoints to use routing.

**Endpoints to Update:**
- `POST /api/v2/messages/text/:companyId/:chatId`
- `POST /api/v2/messages/image/:companyId/:chatId`
- `POST /api/v2/messages/video/:companyId/:chatId`
- `POST /api/v2/messages/audio/:companyId/:chatId`
- `POST /api/v2/messages/document/:companyId/:chatId`
- `DELETE /api/v2/messages/:companyId/:chatId/:messageId`
- `PUT /api/v2/messages/:companyId/:chatId/:messageId`
- `POST /api/messages/react/:companyId/:messageId`

**Tasks:**
- [ ] Update all endpoints to use router
- [ ] Add connection type checking
- [ ] Implement fallback mechanisms
- [ ] Add response handling from worker processes
- [ ] Update error responses

### Phase 5: Deployment & Configuration (Week 3)

#### 5.1 PM2 Configuration
Use PM2 to manage multiple processes.

**ecosystem.config.js:**
```javascript
module.exports = {
  apps: [
    {
      name: 'bisnesgpt-api',
      script: './server-api.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PROCESS_NAME: 'api',
        PORT: 3000
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      max_memory_restart: '2G'
    },
    {
      name: 'bisnesgpt-wwebjs',
      script: './server-wwebjs.js',
      instances: 1, // Single instance for wwebjs (session management)
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PROCESS_NAME: 'wwebjs',
        PORT: 3001
      },
      error_file: './logs/wwebjs-error.log',
      out_file: './logs/wwebjs-out.log',
      max_memory_restart: '4G', // Higher memory for Chromium
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000
    },
    {
      name: 'bisnesgpt-meta',
      script: './server-meta.js',
      instances: 2, // Can scale horizontally
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PROCESS_NAME: 'meta',
        PORT: 3002
      },
      error_file: './logs/meta-error.log',
      out_file: './logs/meta-out.log',
      max_memory_restart: '1G',
      restart_delay: 1000,
      max_restarts: 20
    }
  ]
};
```

**Tasks:**
- [ ] Create PM2 ecosystem configuration
- [ ] Set up separate log files per process
- [ ] Configure memory limits per process type
- [ ] Set up restart policies per process
- [ ] Test multi-process deployment

#### 5.2 Environment Configuration
```bash
# .env updates
DATABASE_POOL_API_MAX=20
DATABASE_POOL_WWEBJS_MAX=10
DATABASE_POOL_META_MAX=20

REDIS_URL=redis://localhost:6379

API_PORT=3000
WWEBJS_PORT=3001
META_PORT=3002

# Health check endpoints
API_HEALTH_ENDPOINT=http://localhost:3000/health
WWEBJS_HEALTH_ENDPOINT=http://localhost:3001/health
META_HEALTH_ENDPOINT=http://localhost:3002/health
```

**Tasks:**
- [ ] Update environment variables
- [ ] Add health check endpoints per process
- [ ] Configure separate ports
- [ ] Set up nginx reverse proxy (if needed)

### Phase 6: Monitoring & Observability (Week 3-4)

#### 6.1 Process Health Monitoring
```javascript
// Shared health monitoring service
class ProcessHealthMonitor {
  async recordHeartbeat(processName) {
    await pool.query(`
      INSERT INTO process_health (process_name, status, last_heartbeat, uptime_seconds, memory_usage_mb)
      VALUES ($1, 'healthy', NOW(), $2, $3)
      ON CONFLICT (process_name) DO UPDATE SET
        status = 'healthy',
        last_heartbeat = NOW(),
        uptime_seconds = $2,
        memory_usage_mb = $3
    `, [
      processName,
      Math.floor(process.uptime()),
      Math.floor(process.memoryUsage().heapUsed / 1024 / 1024)
    ]);
  }

  async checkProcessHealth(processName) {
    const result = await pool.query(`
      SELECT * FROM process_health 
      WHERE process_name = $1 
        AND last_heartbeat > NOW() - INTERVAL '60 seconds'
    `, [processName]);
    
    return result.rows[0]?.status === 'healthy';
  }

  async getAllProcessHealth() {
    const result = await pool.query(`
      SELECT 
        process_name,
        status,
        last_heartbeat,
        uptime_seconds,
        memory_usage_mb,
        error_count,
        CASE 
          WHEN last_heartbeat > NOW() - INTERVAL '30 seconds' THEN 'healthy'
          WHEN last_heartbeat > NOW() - INTERVAL '60 seconds' THEN 'degraded'
          ELSE 'down'
        END as computed_status
      FROM process_health
    `);
    
    return result.rows;
  }
}
```

**Tasks:**
- [ ] Implement health monitoring service
- [ ] Add heartbeat mechanism (every 10-30 seconds)
- [ ] Create health check API endpoints
- [ ] Add alerting for unhealthy processes
- [ ] Create dashboard for process status

#### 6.2 Metrics & Logging
```javascript
// Per-process metrics
const processMetrics = {
  wwebjs: {
    sessionsActive: 0,
    messagesSent: 0,
    messagesReceived: 0,
    errors: 0,
    avgResponseTime: 0
  },
  meta: {
    botsActive: 0,
    messagesSent: 0,
    messagesReceived: 0,
    apiErrors: 0,
    avgResponseTime: 0
  }
};

// Update metrics endpoint
app.get('/metrics/:process', (req, res) => {
  const processName = req.params.process;
  res.json(processMetrics[processName]);
});
```

**Tasks:**
- [ ] Add metrics collection per process
- [ ] Implement structured logging
- [ ] Set up log aggregation
- [ ] Create alerting rules
- [ ] Add performance tracking

### Phase 7: Testing & Validation (Week 4)

#### 7.1 Isolation Testing
**Test Cases:**
1. WWebJS process crash should not affect Meta Direct
   - Kill wwebjs process
   - Verify Meta Direct bots still send/receive messages
   - Verify API remains accessible

2. Meta Direct process crash should not affect WWebJS
   - Kill meta process
   - Verify wwebjs bots still send/receive messages
   - Verify API remains accessible

3. Database connection failure in one process
   - Simulate DB connection loss in wwebjs
   - Verify meta process maintains its connections
   - Verify both recover independently

4. Memory leak in WWebJS
   - Simulate memory growth in wwebjs
   - Verify it restarts without affecting meta
   - Verify no message loss

5. API server restart
   - Restart API server
   - Verify both wwebjs and meta maintain connections
   - Verify no message loss (queued in BullMQ)

**Tasks:**
- [ ] Create automated test suite
- [ ] Implement chaos testing scenarios
- [ ] Verify message delivery guarantees
- [ ] Test graceful restarts
- [ ] Validate no cascading failures

#### 7.2 Performance Testing
**Metrics to Track:**
- Message throughput per process
- Latency per connection type
- Memory usage over time
- CPU usage per process
- Database connection utilization

**Tasks:**
- [ ] Run load tests per process
- [ ] Measure baseline performance
- [ ] Compare with current architecture
- [ ] Identify bottlenecks
- [ ] Optimize based on results

### Phase 8: Migration & Rollout (Week 4-5)

#### 8.1 Migration Strategy
**Approach: Blue-Green Deployment**

1. **Preparation Phase:**
   - Deploy new multi-process architecture alongside current server
   - Run both in parallel with traffic duplication
   - Monitor for discrepancies

2. **Gradual Migration:**
   - Phase 1: Move 10% of Meta Direct bots to new architecture
   - Phase 2: Move 50% of Meta Direct bots
   - Phase 3: Move all Meta Direct bots
   - Phase 4: Move 10% of wwebjs bots
   - Phase 5: Move remaining wwebjs bots

3. **Rollback Plan:**
   - Keep old server running for 1 week
   - Quick rollback via PM2 or nginx config change
   - Data synchronization between old and new

**Tasks:**
- [ ] Set up staging environment
- [ ] Deploy new architecture to staging
- [ ] Test with subset of real bots
- [ ] Create rollback procedures
- [ ] Document migration steps

#### 8.2 Monitoring During Migration
**Key Metrics:**
- Message delivery success rate
- Error rates per process
- Response times
- Bot connectivity status
- Database performance

**Tasks:**
- [ ] Set up real-time monitoring dashboard
- [ ] Create alerting thresholds
- [ ] Implement automatic rollback triggers
- [ ] Monitor for 48 hours post-migration
- [ ] Validate all functionality

## Expected Benefits

### Reliability
- ✅ **Isolated Failures**: WWebJS crashes won't affect Meta Direct
- ✅ **Independent Restarts**: Each process can restart without affecting others
- ✅ **Graceful Degradation**: If one service is down, others continue working

### Performance
- ✅ **Resource Allocation**: Each process gets dedicated CPU/memory
- ✅ **Event Loop Isolation**: Heavy wwebjs operations don't block Meta API calls
- ✅ **Scalability**: Meta Direct can scale horizontally independently

### Observability
- ✅ **Clear Logs**: Separate log files per process
- ✅ **Process-Level Metrics**: Track performance per service
- ✅ **Easier Debugging**: Isolate issues to specific processes

### Operational
- ✅ **Targeted Updates**: Update wwebjs without restarting meta
- ✅ **Independent Deployment**: Deploy fixes to affected service only
- ✅ **Better Resource Management**: Allocate resources based on needs

## Alternative Solutions (Not Recommended)

### Alternative 1: Try-Catch Everything
Wrap all wwebjs code in try-catch blocks.

**Why Not:**
- Doesn't prevent event loop blocking
- Still shares resources
- Harder to maintain
- Doesn't solve root cause

### Alternative 2: Separate Servers
Run completely separate servers (different codebases).

**Why Not:**
- Double maintenance burden
- Code duplication
- Harder to keep in sync
- More complex deployment

### Alternative 3: Containerization
Use Docker containers for isolation.

**Why Not:**
- Overkill for this problem
- Adds complexity
- Still need process-level changes
- Higher resource overhead

## Timeline Summary

- **Week 1**: Code restructuring + Process management setup
- **Week 2**: Database updates + Message routing implementation
- **Week 3**: Deployment configuration + Monitoring setup
- **Week 4**: Testing + Validation
- **Week 5**: Migration + Production rollout

**Total Estimated Time: 4-5 weeks**

## Success Criteria

1. ✅ WWebJS process can crash without affecting Meta Direct
2. ✅ Meta Direct process can crash without affecting WWebJS
3. ✅ No message loss during process restarts
4. ✅ 99.9% uptime for Meta Direct (independent of wwebjs)
5. ✅ Response time < 500ms for Meta Direct API calls
6. ✅ Zero cascading failures between processes
7. ✅ Clear process health visibility in monitoring

## Risk Assessment

### High Risk
- **Data Loss During Migration**: Mitigate with careful testing and rollback plan
- **Process Communication Failures**: Use reliable queue (BullMQ with Redis)
- **Database Connection Exhaustion**: Configure appropriate pool sizes

### Medium Risk
- **Performance Regression**: Monitor during migration, optimize as needed
- **Deployment Complexity**: Document thoroughly, automate with PM2
- **State Synchronization Issues**: Use database as single source of truth

### Low Risk
- **IPC Latency**: Minimal impact with proper queue configuration
- **Log Management**: Use log rotation and aggregation
- **Monitoring Overhead**: Minimal with proper configuration

## Next Steps

1. **Review this plan** with team and stakeholders
2. **Set up development environment** for testing multi-process architecture
3. **Create proof of concept** with minimal wwebjs + meta setup
4. **Validate approach** before full implementation
5. **Begin Phase 1** implementation

---

**Document Version:** 1.0  
**Last Updated:** 2026-02-14  
**Status:** Draft - Awaiting Review
