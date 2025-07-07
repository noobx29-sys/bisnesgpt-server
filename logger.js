const fs = require('fs');
const path = require('path');
const util = require('util');

class ServerLogger {
  constructor() {
    this.logDir = path.join(__dirname, 'logs');
    this.crashLogFile = path.join(this.logDir, 'crash.log');
    this.consoleLogFile = path.join(this.logDir, 'console.log');
    this.errorLogFile = path.join(this.logDir, 'error.log');
    
    // Create logs directory if it doesn't exist
    this.ensureLogDirectory();
    
    // Setup logging
    this.setupConsoleLogging();
    this.setupProcessListeners();
    
    // Log startup
    this.logStartup();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
      console.log(`Created logs directory: ${this.logDir}`);
    }
  }

  setupConsoleLogging() {
    // Store original console methods
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug
    };

    // Override console.log
    console.log = (...args) => {
      const timestamp = new Date().toISOString();
      const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
      const logEntry = `[${timestamp}] [LOG] ${message}\n`;
      
      // Write to file
      fs.appendFileSync(this.consoleLogFile, logEntry);
      
      // Call original console.log
      originalConsole.log(...args);
    };

    // Override console.error
    console.error = (...args) => {
      const timestamp = new Date().toISOString();
      const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
      const logEntry = `[${timestamp}] [ERROR] ${message}\n`;
      
      // Write to both error and console log files
      fs.appendFileSync(this.errorLogFile, logEntry);
      fs.appendFileSync(this.consoleLogFile, logEntry);
      
      // Call original console.error
      originalConsole.error(...args);
    };

    // Override console.warn
    console.warn = (...args) => {
      const timestamp = new Date().toISOString();
      const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
      const logEntry = `[${timestamp}] [WARN] ${message}\n`;
      
      // Write to file
      fs.appendFileSync(this.consoleLogFile, logEntry);
      
      // Call original console.warn
      originalConsole.warn(...args);
    };

    // Override console.info
    console.info = (...args) => {
      const timestamp = new Date().toISOString();
      const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
      const logEntry = `[${timestamp}] [INFO] ${message}\n`;
      
      // Write to file
      fs.appendFileSync(this.consoleLogFile, logEntry);
      
      // Call original console.info
      originalConsole.info(...args);
    };
  }

  setupProcessListeners() {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      const timestamp = new Date().toISOString();
      const crashLog = `
========================================
UNCAUGHT EXCEPTION - ${timestamp}
========================================
Error: ${error.message}
Stack: ${error.stack}
Process PID: ${process.pid}
Memory Usage: ${JSON.stringify(process.memoryUsage(), null, 2)}
========================================

`;
      
      fs.appendFileSync(this.crashLogFile, crashLog);
      console.error('FATAL: Uncaught Exception occurred. Check crash.log for details.');
      
      // Don't exit immediately, let PM2 handle the restart
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      const timestamp = new Date().toISOString();
      const crashLog = `
========================================
UNHANDLED PROMISE REJECTION - ${timestamp}
========================================
Reason: ${reason}
Promise: ${promise}
Process PID: ${process.pid}
Memory Usage: ${JSON.stringify(process.memoryUsage(), null, 2)}
========================================

`;
      
      fs.appendFileSync(this.crashLogFile, crashLog);
      console.error('FATAL: Unhandled Promise Rejection occurred. Check crash.log for details.');
    });

    // Handle SIGTERM (PM2 restart)
    process.on('SIGTERM', () => {
      const timestamp = new Date().toISOString();
      const shutdownLog = `
========================================
GRACEFUL SHUTDOWN (SIGTERM) - ${timestamp}
========================================
Process PID: ${process.pid}
Reason: PM2 restart or shutdown requested
Memory Usage: ${JSON.stringify(process.memoryUsage(), null, 2)}
========================================

`;
      
      fs.appendFileSync(this.crashLogFile, shutdownLog);
      console.log('SIGTERM received. Shutting down gracefully...');
      
      // Perform cleanup here if needed
      process.exit(0);
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      const timestamp = new Date().toISOString();
      const shutdownLog = `
========================================
MANUAL SHUTDOWN (SIGINT) - ${timestamp}
========================================
Process PID: ${process.pid}
Reason: Manual interruption (Ctrl+C)
Memory Usage: ${JSON.stringify(process.memoryUsage(), null, 2)}
========================================

`;
      
      fs.appendFileSync(this.crashLogFile, shutdownLog);
      console.log('SIGINT received. Shutting down gracefully...');
      process.exit(0);
    });

    // Handle exit events
    process.on('exit', (code) => {
      const timestamp = new Date().toISOString();
      const exitLog = `
========================================
PROCESS EXIT - ${timestamp}
========================================
Exit Code: ${code}
Process PID: ${process.pid}
Exit Reason: ${code === 0 ? 'Normal exit' : 'Abnormal exit'}
========================================

`;
      
      try {
        fs.appendFileSync(this.crashLogFile, exitLog);
      } catch (err) {
        // Can't log errors during exit
      }
    });
  }

  logStartup() {
    const timestamp = new Date().toISOString();
    const startupLog = `
========================================
SERVER STARTUP - ${timestamp}
========================================
Process PID: ${process.pid}
Node Version: ${process.version}
Platform: ${process.platform}
Architecture: ${process.arch}
Working Directory: ${process.cwd()}
Memory Usage: ${JSON.stringify(process.memoryUsage(), null, 2)}
Environment: ${process.env.NODE_ENV || 'development'}
========================================

`;
    
    fs.appendFileSync(this.crashLogFile, startupLog);
    fs.appendFileSync(this.consoleLogFile, `[${timestamp}] [STARTUP] Server started with PID ${process.pid}\n`);
    console.log('Server logging initialized. Logs will be saved to:', this.logDir);
  }

  // Method to manually log important events
  logEvent(type, message, data = null) {
    const timestamp = new Date().toISOString();
    const eventLog = `
========================================
${type.toUpperCase()} EVENT - ${timestamp}
========================================
Message: ${message}
${data ? `Data: ${JSON.stringify(data, null, 2)}` : ''}
Process PID: ${process.pid}
========================================

`;
    
    fs.appendFileSync(this.crashLogFile, eventLog);
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  // Method to rotate logs daily
  rotateLogs() {
    const today = new Date().toISOString().split('T')[0];
    const archiveDir = path.join(this.logDir, 'archive');
    
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    // Archive console log
    if (fs.existsSync(this.consoleLogFile)) {
      const archiveConsoleLog = path.join(archiveDir, `console-${today}.log`);
      fs.renameSync(this.consoleLogFile, archiveConsoleLog);
    }

    // Archive error log
    if (fs.existsSync(this.errorLogFile)) {
      const archiveErrorLog = path.join(archiveDir, `error-${today}.log`);
      fs.renameSync(this.errorLogFile, archiveErrorLog);
    }

    console.log(`Logs rotated for ${today}`);
  }

  // Method to clean old logs (keep last 30 days)
  cleanOldLogs() {
    const archiveDir = path.join(this.logDir, 'archive');
    if (!fs.existsSync(archiveDir)) return;

    const files = fs.readdirSync(archiveDir);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    files.forEach(file => {
      const filePath = path.join(archiveDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtime < thirtyDaysAgo) {
        fs.unlinkSync(filePath);
        console.log(`Deleted old log file: ${file}`);
      }
    });
  }
}

module.exports = ServerLogger;
