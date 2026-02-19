/**
 * Health Monitoring Service
 * Tracks process health and provides health check endpoints
 */

const { Pool } = require('pg');

class HealthMonitoringService {
  constructor(pool) {
    this.pool = pool;
    this.processName = process.env.PROCESS_NAME || 'unknown';
    this.heartbeatInterval = null;
    this.metrics = {
      messagesProcessed: 0,
      errors: 0,
      activeConnections: 0,
    };
  }

  /**
   * Start health monitoring
   */
  start() {
    console.log(`[Health] Starting health monitoring for ${this.processName}`);
    
    // Send initial heartbeat
    this.sendHeartbeat();
    
    // Start heartbeat interval (every 10 seconds)
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat().catch(err => {
        console.error('[Health] Error sending heartbeat:', err);
      });
    }, 10000);
    
    // Log metrics every minute
    setInterval(() => {
      this.logMetrics();
    }, 60000);
  }

  /**
   * Stop health monitoring
   */
  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Send heartbeat to database
   */
  async sendHeartbeat() {
    try {
      const memUsage = process.memoryUsage();
      const uptime = Math.floor(process.uptime());
      
      await this.pool.query(
        `SELECT update_process_health($1, $2, $3, $4, $5, $6)`,
        [
          this.processName,
          'healthy',
          uptime,
          Math.floor(memUsage.heapUsed / 1024 / 1024),
          0, // CPU usage (would need separate calculation)
          this.metrics.activeConnections,
        ]
      );
    } catch (error) {
      console.error('[Health] Error updating process health:', error);
    }
  }

  /**
   * Record error
   */
  async recordError(error, severity = 'error') {
    this.metrics.errors++;
    
    try {
      await this.pool.query(
        `SELECT log_process_event($1, $2, $3, $4)`,
        [
          this.processName,
          'error',
          JSON.stringify({ 
            message: error.message, 
            stack: error.stack?.substring(0, 500),
            timestamp: Date.now(),
          }),
          severity,
        ]
      );
    } catch (err) {
      console.error('[Health] Error recording error:', err);
    }
  }

  /**
   * Record event
   */
  async recordEvent(eventType, eventData = {}, severity = 'info') {
    try {
      await this.pool.query(
        `SELECT log_process_event($1, $2, $3, $4)`,
        [
          this.processName,
          eventType,
          JSON.stringify(eventData),
          severity,
        ]
      );
    } catch (err) {
      console.error('[Health] Error recording event:', err);
    }
  }

  /**
   * Record metric
   */
  async recordMetric(metricName, value, type = 'gauge', metadata = {}) {
    try {
      await this.pool.query(
        `SELECT record_process_metric($1, $2, $3, $4, $5)`,
        [
          this.processName,
          metricName,
          value,
          type,
          JSON.stringify(metadata),
        ]
      );
    } catch (err) {
      console.error('[Health] Error recording metric:', err);
    }
  }

  /**
   * Increment message counter
   */
  incrementMessages() {
    this.metrics.messagesProcessed++;
  }

  /**
   * Increment error counter
   */
  incrementErrors() {
    this.metrics.errors++;
  }

  /**
   * Set active connections
   */
  setActiveConnections(count) {
    this.metrics.activeConnections = count;
  }

  /**
   * Log current metrics
   */
  logMetrics() {
    console.log(`[Health] Process Metrics:`, {
      processName: this.processName,
      uptime: Math.floor(process.uptime()),
      memory: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      messagesProcessed: this.metrics.messagesProcessed,
      errors: this.metrics.errors,
      activeConnections: this.metrics.activeConnections,
    });
  }

  /**
   * Get health status
   */
  async getHealth() {
    try {
      const result = await this.pool.query(
        `SELECT * FROM v_process_health_overview WHERE process_name = $1`,
        [this.processName]
      );
      
      if (result.rows.length === 0) {
        return {
          healthy: false,
          reason: 'No health record found',
        };
      }
      
      const health = result.rows[0];
      const isHealthy = health.computed_status === 'healthy';
      
      return {
        healthy: isHealthy,
        status: health.computed_status,
        lastHeartbeat: health.last_heartbeat,
        uptime: health.uptime_seconds,
        memory: health.memory_usage_mb,
        activeConnections: health.active_connections,
        errorCount: health.error_count,
        activeBots: health.active_bots,
      };
    } catch (error) {
      return {
        healthy: false,
        reason: error.message,
      };
    }
  }

  /**
   * Get all process health
   */
  async getAllHealth() {
    try {
      const result = await this.pool.query(
        `SELECT * FROM v_process_health_overview ORDER BY process_name`
      );
      
      return result.rows.map(row => ({
        processName: row.process_name,
        status: row.computed_status,
        lastHeartbeat: row.last_heartbeat,
        uptime: row.uptime_seconds,
        memory: row.memory_usage_mb,
        activeConnections: row.active_connections,
        errorCount: row.error_count,
        activeBots: row.active_bots,
        secondsSinceHeartbeat: row.seconds_since_heartbeat,
      }));
    } catch (error) {
      console.error('[Health] Error getting all health:', error);
      return [];
    }
  }
}

/**
 * Create health monitoring middleware for Express
 */
function createHealthMiddleware(healthService) {
  return async (req, res, next) => {
    // Add health service to request
    req.healthService = healthService;
    next();
  };
}

/**
 * Create health check endpoint handler
 */
function createHealthEndpoint(healthService) {
  return async (req, res) => {
    try {
      const health = await healthService.getHealth();
      
      const statusCode = health.healthy ? 200 : 503;
      
      res.status(statusCode).json({
        success: health.healthy,
        processName: process.env.PROCESS_NAME,
        pid: process.pid,
        ...health,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        processName: process.env.PROCESS_NAME,
        pid: process.pid,
      });
    }
  };
}

/**
 * Create all processes health endpoint
 */
function createAllHealthEndpoint(healthService) {
  return async (req, res) => {
    try {
      const allHealth = await healthService.getAllHealth();
      
      const allHealthy = allHealth.every(h => h.status === 'healthy');
      const statusCode = allHealthy ? 200 : 503;
      
      res.status(statusCode).json({
        success: allHealthy,
        processes: allHealth,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };
}

module.exports = {
  HealthMonitoringService,
  createHealthMiddleware,
  createHealthEndpoint,
  createAllHealthEndpoint,
};
