/**
 * Message Queue Service
 * Handles cross-process communication using BullMQ
 */

const { Queue, Worker, QueueScheduler } = require('bullmq');
const Redis = require('ioredis');

// Redis connection configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

// Create Redis connection
const connection = new Redis(redisConfig);

// Queue names
const QUEUE_NAMES = {
  WWEBJS_MESSAGES: 'wwebjs-messages',
  META_MESSAGES: 'meta-messages',
  STATUS_UPDATES: 'status-updates',
  WEBHOOK_EVENTS: 'webhook-events',
};

// Create queues
const queues = {
  wwebjs: new Queue(QUEUE_NAMES.WWEBJS_MESSAGES, { connection }),
  meta: new Queue(QUEUE_NAMES.META_MESSAGES, { connection }),
  status: new Queue(QUEUE_NAMES.STATUS_UPDATES, { connection }),
  webhook: new Queue(QUEUE_NAMES.WEBHOOK_EVENTS, { connection }),
};

// Create queue schedulers (for delayed jobs)
const schedulers = {
  wwebjs: new QueueScheduler(QUEUE_NAMES.WWEBJS_MESSAGES, { connection }),
  meta: new QueueScheduler(QUEUE_NAMES.META_MESSAGES, { connection }),
  status: new QueueScheduler(QUEUE_NAMES.STATUS_UPDATES, { connection }),
  webhook: new QueueScheduler(QUEUE_NAMES.WEBHOOK_EVENTS, { connection }),
};

/**
 * Add message to WWebJS queue
 */
async function addWwebjsMessage(data, options = {}) {
  return await queues.wwebjs.add('send-message', data, {
    attempts: options.attempts || 3,
    backoff: {
      type: 'exponential',
      delay: options.backoffDelay || 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
    ...options,
  });
}

/**
 * Add message to Meta Direct queue
 */
async function addMetaMessage(data, options = {}) {
  return await queues.meta.add('send-message', data, {
    attempts: options.attempts || 3,
    backoff: {
      type: 'exponential',
      delay: options.backoffDelay || 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
    ...options,
  });
}

/**
 * Add status update to queue
 */
async function addStatusUpdate(data, options = {}) {
  return await queues.status.add('status-update', data, {
    attempts: 1,
    removeOnComplete: true,
    ...options,
  });
}

/**
 * Add webhook event to queue
 */
async function addWebhookEvent(data, options = {}) {
  return await queues.webhook.add('webhook-event', data, {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
    ...options,
  });
}

/**
 * Create worker for WWebJS messages
 */
function createWwebjsWorker(processor, options = {}) {
  return new Worker(
    QUEUE_NAMES.WWEBJS_MESSAGES,
    processor,
    {
      connection,
      concurrency: options.concurrency || 5,
      limiter: {
        max: options.maxPerSecond || 10,
        duration: 1000,
      },
      ...options,
    }
  );
}

/**
 * Create worker for Meta Direct messages
 */
function createMetaWorker(processor, options = {}) {
  return new Worker(
    QUEUE_NAMES.META_MESSAGES,
    processor,
    {
      connection,
      concurrency: options.concurrency || 10,
      limiter: {
        max: options.maxPerSecond || 20,
        duration: 1000,
      },
      ...options,
    }
  );
}

/**
 * Create worker for status updates
 */
function createStatusWorker(processor, options = {}) {
  return new Worker(
    QUEUE_NAMES.STATUS_UPDATES,
    processor,
    {
      connection,
      concurrency: options.concurrency || 5,
      ...options,
    }
  );
}

/**
 * Create worker for webhook events
 */
function createWebhookWorker(processor, options = {}) {
  return new Worker(
    QUEUE_NAMES.WEBHOOK_EVENTS,
    processor,
    {
      connection,
      concurrency: options.concurrency || 10,
      ...options,
    }
  );
}

/**
 * Get queue statistics
 */
async function getQueueStats(queueName) {
  const queue = queues[queueName];
  if (!queue) {
    throw new Error(`Queue ${queueName} not found`);
  }

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed,
  };
}

/**
 * Get all queue statistics
 */
async function getAllQueueStats() {
  const stats = {};
  
  for (const [name, queue] of Object.entries(queues)) {
    stats[name] = await getQueueStats(name);
  }
  
  return stats;
}

/**
 * Clean old completed jobs
 */
async function cleanQueues(olderThan = 3600000) { // Default 1 hour
  const results = {};
  
  for (const [name, queue] of Object.entries(queues)) {
    const cleaned = await queue.clean(olderThan, 1000, 'completed');
    results[name] = cleaned.length;
  }
  
  return results;
}

/**
 * Pause all queues
 */
async function pauseAllQueues() {
  await Promise.all(Object.values(queues).map(q => q.pause()));
}

/**
 * Resume all queues
 */
async function resumeAllQueues() {
  await Promise.all(Object.values(queues).map(q => q.resume()));
}

/**
 * Close all connections
 */
async function closeAll() {
  // Close queues
  await Promise.all(Object.values(queues).map(q => q.close()));
  
  // Close schedulers
  await Promise.all(Object.values(schedulers).map(s => s.close()));
  
  // Close Redis connection
  await connection.quit();
}

/**
 * Health check
 */
async function healthCheck() {
  try {
    await connection.ping();
    return {
      healthy: true,
      redis: 'connected',
      queues: Object.keys(queues).length,
    };
  } catch (error) {
    return {
      healthy: false,
      redis: 'disconnected',
      error: error.message,
    };
  }
}

module.exports = {
  // Queue names
  QUEUE_NAMES,
  
  // Queues
  queues,
  
  // Add jobs
  addWwebjsMessage,
  addMetaMessage,
  addStatusUpdate,
  addWebhookEvent,
  
  // Create workers
  createWwebjsWorker,
  createMetaWorker,
  createStatusWorker,
  createWebhookWorker,
  
  // Stats and management
  getQueueStats,
  getAllQueueStats,
  cleanQueues,
  pauseAllQueues,
  resumeAllQueues,
  closeAll,
  healthCheck,
  
  // Redis connection
  connection,
};
