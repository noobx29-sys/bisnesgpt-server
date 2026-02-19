/**
 * Message Router Service
 * Routes messages to appropriate process (wwebjs or meta) based on connection type
 */

const { addWwebjsMessage, addMetaMessage } = require('./messaging/queue');
const { Pool } = require('pg');

class MessageRouter {
  constructor(pool) {
    this.pool = pool;
    this.cache = new Map(); // Cache connection types to avoid DB queries
    this.cacheTimeout = 60000; // 1 minute cache
  }

  /**
   * Get connection type for a company/phone
   */
  async getConnectionType(companyId, phoneIndex = 0) {
    const cacheKey = `${companyId}-${phoneIndex}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached.connectionType;
    }
    
    // Query database
    try {
      const result = await this.pool.query(
        `SELECT connection_type, process_name 
         FROM phone_configs 
         WHERE company_id = $1 AND phone_index = $2`,
        [companyId, phoneIndex]
      );
      
      if (result.rows.length === 0) {
        throw new Error(`No configuration found for ${companyId} phone ${phoneIndex}`);
      }
      
      const connectionType = result.rows[0].connection_type || 'wwebjs';
      const processName = result.rows[0].process_name;
      
      // Cache result
      this.cache.set(cacheKey, {
        connectionType,
        processName,
        timestamp: Date.now(),
      });
      
      return connectionType;
    } catch (error) {
      console.error('[Router] Error getting connection type:', error);
      throw error;
    }
  }

  /**
   * Route message to appropriate process
   */
  async routeMessage(messageData) {
    const { companyId, phoneIndex = 0 } = messageData;
    
    try {
      const connectionType = await this.getConnectionType(companyId, phoneIndex);
      
      // Determine which process should handle this
      if (connectionType === 'wwebjs' || connectionType === null) {
        return await this.routeToWwebjs(messageData);
      } else if (['meta_direct', 'meta_embedded', '360dialog'].includes(connectionType)) {
        return await this.routeToMeta(messageData);
      } else {
        throw new Error(`Unknown connection type: ${connectionType}`);
      }
    } catch (error) {
      console.error('[Router] Error routing message:', error);
      throw error;
    }
  }

  /**
   * Route to WWebJS process
   */
  async routeToWwebjs(messageData) {
    console.log(`[Router] Routing to WWebJS process:`, {
      companyId: messageData.companyId,
      phoneIndex: messageData.phoneIndex,
    });
    
    try {
      const job = await addWwebjsMessage(messageData, {
        priority: messageData.priority || 5,
        attempts: 3,
        backoffDelay: 2000,
      });
      
      return {
        success: true,
        jobId: job.id,
        process: 'wwebjs',
        queueName: 'wwebjs-messages',
      };
    } catch (error) {
      console.error('[Router] Error adding to WWebJS queue:', error);
      throw error;
    }
  }

  /**
   * Route to Meta Direct process
   */
  async routeToMeta(messageData) {
    console.log(`[Router] Routing to Meta process:`, {
      companyId: messageData.companyId,
      phoneIndex: messageData.phoneIndex,
    });
    
    try {
      const job = await addMetaMessage(messageData, {
        priority: messageData.priority || 5,
        attempts: 3,
        backoffDelay: 1000,
      });
      
      return {
        success: true,
        jobId: job.id,
        process: 'meta',
        queueName: 'meta-messages',
      };
    } catch (error) {
      console.error('[Router] Error adding to Meta queue:', error);
      throw error;
    }
  }

  /**
   * Clear cache for specific company/phone
   */
  clearCache(companyId, phoneIndex = 0) {
    const cacheKey = `${companyId}-${phoneIndex}`;
    this.cache.delete(cacheKey);
  }

  /**
   * Clear all cache
   */
  clearAllCache() {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }
}

// Create singleton instance
let routerInstance = null;

/**
 * Get router instance
 */
function getRouter(pool) {
  if (!routerInstance) {
    routerInstance = new MessageRouter(pool);
  }
  return routerInstance;
}

/**
 * Create Express middleware for message routing
 */
function createRoutingMiddleware(pool) {
  const router = getRouter(pool);
  
  return async (req, res, next) => {
    req.messageRouter = router;
    next();
  };
}

module.exports = {
  MessageRouter,
  getRouter,
  createRoutingMiddleware,
};
