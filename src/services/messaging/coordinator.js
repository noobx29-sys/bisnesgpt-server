/**
 * Cross-Process Coordinator
 * Manages coordination between different processes using Redis pub/sub
 */

const Redis = require('ioredis');
const EventEmitter = require('events');

class ProcessCoordinator extends EventEmitter {
  constructor() {
    super();
    
    this.processName = process.env.PROCESS_NAME || 'unknown';
    this.processId = process.pid;
    
    // Create Redis connections for pub/sub
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
    };
    
    this.publisher = new Redis(redisConfig);
    this.subscriber = new Redis(redisConfig);
    
    // Channel names
    this.channels = {
      STATUS: 'process:status',
      HEARTBEAT: 'process:heartbeat',
      BOT_EVENT: 'bot:event',
      MESSAGE: 'process:message',
      SHUTDOWN: 'process:shutdown',
    };
    
    this.isInitialized = false;
    this.heartbeatInterval = null;
  }

  /**
   * Initialize coordinator
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }
    
    console.log(`[Coordinator] Initializing for ${this.processName} process (PID: ${this.processId})`);
    
    // Subscribe to all channels
    await Promise.all([
      this.subscriber.subscribe(this.channels.STATUS),
      this.subscriber.subscribe(this.channels.HEARTBEAT),
      this.subscriber.subscribe(this.channels.BOT_EVENT),
      this.subscriber.subscribe(this.channels.MESSAGE),
      this.subscriber.subscribe(this.channels.SHUTDOWN),
    ]);
    
    // Handle incoming messages
    this.subscriber.on('message', (channel, message) => {
      this.handleMessage(channel, message);
    });
    
    // Handle Redis errors
    this.publisher.on('error', (err) => {
      console.error('[Coordinator] Publisher error:', err);
    });
    
    this.subscriber.on('error', (err) => {
      console.error('[Coordinator] Subscriber error:', err);
    });
    
    // Start sending heartbeats
    this.startHeartbeat();
    
    // Announce process start
    await this.publishStatus('started');
    
    this.isInitialized = true;
    console.log(`[Coordinator] Initialized successfully`);
  }

  /**
   * Handle incoming pub/sub messages
   */
  handleMessage(channel, message) {
    try {
      const data = JSON.parse(message);
      
      // Ignore messages from self
      if (data.processId === this.processId) {
        return;
      }
      
      // Emit event for application to handle
      this.emit(channel, data);
      
      // Log important events
      if (channel === this.channels.SHUTDOWN) {
        console.log(`[Coordinator] Received shutdown signal from ${data.processName}`);
      }
    } catch (error) {
      console.error(`[Coordinator] Error handling message from ${channel}:`, error);
    }
  }

  /**
   * Publish status update
   */
  async publishStatus(status, metadata = {}) {
    const message = {
      processName: this.processName,
      processId: this.processId,
      status,
      timestamp: Date.now(),
      ...metadata,
    };
    
    await this.publisher.publish(
      this.channels.STATUS,
      JSON.stringify(message)
    );
  }

  /**
   * Publish heartbeat
   */
  async publishHeartbeat() {
    const message = {
      processName: this.processName,
      processId: this.processId,
      timestamp: Date.now(),
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    };
    
    await this.publisher.publish(
      this.channels.HEARTBEAT,
      JSON.stringify(message)
    );
  }

  /**
   * Publish bot event (connection, disconnection, etc.)
   */
  async publishBotEvent(eventType, botData) {
    const message = {
      processName: this.processName,
      processId: this.processId,
      eventType,
      timestamp: Date.now(),
      ...botData,
    };
    
    await this.publisher.publish(
      this.channels.BOT_EVENT,
      JSON.stringify(message)
    );
  }

  /**
   * Send message to other processes
   */
  async sendMessage(messageType, data) {
    const message = {
      processName: this.processName,
      processId: this.processId,
      messageType,
      timestamp: Date.now(),
      data,
    };
    
    await this.publisher.publish(
      this.channels.MESSAGE,
      JSON.stringify(message)
    );
  }

  /**
   * Publish shutdown signal
   */
  async publishShutdown(reason = 'graceful') {
    const message = {
      processName: this.processName,
      processId: this.processId,
      reason,
      timestamp: Date.now(),
    };
    
    await this.publisher.publish(
      this.channels.SHUTDOWN,
      JSON.stringify(message)
    );
  }

  /**
   * Start heartbeat interval
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.publishHeartbeat().catch(err => {
        console.error('[Coordinator] Error publishing heartbeat:', err);
      });
    }, 10000); // Every 10 seconds
  }

  /**
   * Stop heartbeat interval
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Subscribe to specific event type
   */
  onStatus(callback) {
    this.on(this.channels.STATUS, callback);
  }

  onHeartbeat(callback) {
    this.on(this.channels.HEARTBEAT, callback);
  }

  onBotEvent(callback) {
    this.on(this.channels.BOT_EVENT, callback);
  }

  onMessage(callback) {
    this.on(this.channels.MESSAGE, callback);
  }

  onShutdown(callback) {
    this.on(this.channels.SHUTDOWN, callback);
  }

  /**
   * Close coordinator
   */
  async close() {
    console.log(`[Coordinator] Closing ${this.processName} coordinator`);
    
    this.stopHeartbeat();
    
    // Announce shutdown
    await this.publishStatus('stopped');
    
    // Close Redis connections
    await this.subscriber.quit();
    await this.publisher.quit();
    
    console.log(`[Coordinator] Closed successfully`);
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      await this.publisher.ping();
      return {
        healthy: true,
        processName: this.processName,
        processId: this.processId,
      };
    } catch (error) {
      return {
        healthy: false,
        processName: this.processName,
        processId: this.processId,
        error: error.message,
      };
    }
  }
}

// Create singleton instance
let coordinatorInstance = null;

/**
 * Get coordinator instance
 */
function getCoordinator() {
  if (!coordinatorInstance) {
    coordinatorInstance = new ProcessCoordinator();
  }
  return coordinatorInstance;
}

/**
 * Initialize coordinator (should be called once per process)
 */
async function initializeCoordinator() {
  const coordinator = getCoordinator();
  await coordinator.initialize();
  
  // Setup graceful shutdown
  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, async () => {
      console.log(`[Coordinator] Received ${signal}, closing...`);
      await coordinator.close();
    });
  });
  
  return coordinator;
}

module.exports = {
  ProcessCoordinator,
  getCoordinator,
  initializeCoordinator,
};
