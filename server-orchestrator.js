/**
 * Process Orchestrator - Manages multiple Node.js processes for isolation
 * This is the main entry point that spawns separate processes for:
 * - API Server (handles HTTP requests and routing)
 * - WWebJS Server (handles WhatsApp Web connections)
 * - Meta Direct Server (handles Meta Cloud API connections)
 */

const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

class ProcessOrchestrator {
  constructor() {
    this.processes = {
      api: null,
      wwebjs: null,
      meta: null
    };
    
    this.restartCounts = {
      api: 0,
      wwebjs: 0,
      meta: 0
    };
    
    this.maxRestarts = {
      api: 5,
      wwebjs: 10,
      meta: 10
    };
    
    this.restartDelays = {
      api: 2000,
      wwebjs: 5000,
      meta: 3000
    };
    
    this.isShuttingDown = false;
    this.startTime = Date.now();
  }

  /**
   * Start all processes
   */
  start() {
    console.log('🚀 Starting Process Orchestrator...');
    console.log(`Process ID: ${process.pid}`);
    console.log(`Node Version: ${process.version}`);
    console.log(`Platform: ${process.platform}`);
    console.log('════════════════════════════════════════\n');
    
    // Start processes in order of dependency
    // API server first (handles routing)
    this.startProcess('api', './server-api.js', process.env.API_PORT || 3000);
    
    // Wait a bit for API server to initialize
    setTimeout(() => {
      // Start WWebJS server (if enabled)
      if (process.env.ENABLE_WWEBJS !== 'false') {
        this.startProcess('wwebjs', './server-wwebjs.js', process.env.WWEBJS_PORT || 3001);
      } else {
        console.log('⏭️  WWebJS process disabled via environment variable');
      }
      
      // Start Meta Direct server (if enabled)
      if (process.env.ENABLE_META !== 'false') {
        this.startProcess('meta', './server-meta.js', process.env.META_PORT || 3002);
      } else {
        console.log('⏭️  Meta Direct process disabled via environment variable');
      }
    }, 2000);
    
    // Setup graceful shutdown
    this.setupGracefulShutdown();
    
    // Start health monitoring
    this.startHealthMonitoring();
  }

  /**
   * Start a single process
   */
  startProcess(name, script, port) {
    const scriptPath = path.join(__dirname, script);
    
    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      console.error(`❌ Script not found: ${scriptPath}`);
      console.error(`   Creating stub file...`);
      this.createStubFile(scriptPath, name, port);
      return;
    }
    
    console.log(`\n🔄 Starting ${name.toUpperCase()} process...`);
    console.log(`   Script: ${script}`);
    console.log(`   Port: ${port}`);
    
    const child = fork(scriptPath, [], {
      env: {
        ...process.env,
        PROCESS_NAME: name,
        PORT: port,
        IS_CHILD_PROCESS: 'true'
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });

    this.processes[name] = {
      process: child,
      startTime: Date.now(),
      restarts: this.restartCounts[name],
      port: port
    };

    // Handle process exit
    child.on('exit', (code, signal) => {
      this.handleProcessExit(name, code, signal);
    });

    // Handle process errors
    child.on('error', (error) => {
      console.error(`❌ ${name.toUpperCase()} process error:`, error.message);
    });

    // Handle IPC messages
    child.on('message', (msg) => {
      this.handleProcessMessage(name, msg);
    });
    
    console.log(`✅ ${name.toUpperCase()} process started (PID: ${child.pid})`);
  }

  /**
   * Handle process exit
   */
  handleProcessExit(name, code, signal) {
    if (this.isShuttingDown) {
      console.log(`   ${name.toUpperCase()} process exited during shutdown`);
      return;
    }
    
    console.error(`\n⚠️  ${name.toUpperCase()} process exited`);
    console.error(`   Exit code: ${code}`);
    console.error(`   Signal: ${signal}`);
    console.error(`   Restart count: ${this.restartCounts[name]}`);
    
    // Check if we should restart
    if (this.restartCounts[name] >= this.maxRestarts[name]) {
      console.error(`   ❌ Max restarts (${this.maxRestarts[name]}) reached for ${name}`);
      console.error(`   ${name.toUpperCase()} will not be restarted automatically`);
      
      // If API process fails permanently, shut down everything
      if (name === 'api') {
        console.error('   🛑 API process is critical - shutting down orchestrator');
        this.shutdown(1);
      }
      return;
    }
    
    // Increment restart count
    this.restartCounts[name]++;
    
    // Determine restart strategy based on process type
    const delay = this.getRestartDelay(name);
    
    console.log(`   🔄 Restarting ${name.toUpperCase()} in ${delay}ms...`);
    
    // Different handling for different process types
    if (name === 'wwebjs') {
      console.log('   ℹ️  WWebJS crash - Meta Direct bots unaffected');
    } else if (name === 'meta') {
      console.log('   ℹ️  Meta Direct crash - WWebJS bots unaffected');
    } else if (name === 'api') {
      console.log('   ⚠️  API server crash - attempting immediate restart');
    }
    
    setTimeout(() => {
      this.startProcess(name, this.getScript(name), this.processes[name]?.port);
    }, delay);
  }

  /**
   * Get restart delay with exponential backoff
   */
  getRestartDelay(name) {
    const baseDelay = this.restartDelays[name];
    const restartCount = this.restartCounts[name];
    
    // Exponential backoff: baseDelay * (2 ^ restartCount), max 60 seconds
    return Math.min(baseDelay * Math.pow(2, restartCount), 60000);
  }

  /**
   * Get script path for process name
   */
  getScript(name) {
    const scripts = {
      api: './server-api.js',
      wwebjs: './server-wwebjs.js',
      meta: './server-meta.js'
    };
    return scripts[name];
  }

  /**
   * Handle IPC messages from child processes
   */
  handleProcessMessage(name, msg) {
    try {
      // Log health messages
      if (msg.type === 'health') {
        // Heartbeat received - process is healthy
        if (this.processes[name]) {
          this.processes[name].lastHeartbeat = Date.now();
        }
        return;
      }
      
      // Status updates
      if (msg.type === 'status_update') {
        console.log(`📊 Status update from ${name.toUpperCase()}:`, msg.data);
        // Broadcast to other processes
        this.broadcast(msg, name);
        return;
      }
      
      // Ready signal
      if (msg.type === 'ready') {
        console.log(`✅ ${name.toUpperCase()} process is ready`);
        // Reset restart count on successful start
        this.restartCounts[name] = 0;
        return;
      }
      
      // Error signal
      if (msg.type === 'error') {
        console.error(`❌ ${name.toUpperCase()} process error:`, msg.error);
        return;
      }
      
      // Log other messages
      console.log(`📨 Message from ${name.toUpperCase()}:`, msg);
    } catch (error) {
      console.error(`Error handling message from ${name}:`, error);
    }
  }

  /**
   * Broadcast message to all other processes
   */
  broadcast(msg, exclude) {
    Object.entries(this.processes).forEach(([name, procData]) => {
      if (name !== exclude && procData && procData.process && procData.process.connected) {
        try {
          procData.process.send(msg);
        } catch (error) {
          console.error(`Error broadcasting to ${name}:`, error.message);
        }
      }
    });
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    
    signals.forEach(signal => {
      process.on(signal, () => {
        console.log(`\n\n🛑 Received ${signal} - initiating graceful shutdown...`);
        this.shutdown(0);
      });
    });
    
    // Handle uncaught exceptions in orchestrator
    process.on('uncaughtException', (error) => {
      console.error('\n❌ Orchestrator uncaught exception:', error);
      console.error('Stack:', error.stack);
      // Don't shutdown on orchestrator errors - just log
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('\n❌ Orchestrator unhandled rejection:', reason);
      // Don't shutdown on orchestrator errors - just log
    });
  }

  /**
   * Graceful shutdown of all processes
   */
  async shutdown(exitCode = 0) {
    if (this.isShuttingDown) {
      console.log('Already shutting down...');
      return;
    }
    
    this.isShuttingDown = true;
    
    console.log('\n════════════════════════════════════════');
    console.log('🛑 Shutting down all processes...');
    console.log('════════════════════════════════════════\n');
    
    const shutdownPromises = [];
    
    // Send shutdown signal to all processes
    Object.entries(this.processes).forEach(([name, procData]) => {
      if (procData && procData.process && procData.process.connected) {
        console.log(`   Stopping ${name.toUpperCase()}...`);
        
        const promise = new Promise((resolve) => {
          const timeout = setTimeout(() => {
            console.log(`   ⚠️  ${name.toUpperCase()} did not exit gracefully, forcing...`);
            try {
              procData.process.kill('SIGKILL');
            } catch (e) {
              // Process might already be dead
            }
            resolve();
          }, 10000); // 10 second timeout
          
          procData.process.once('exit', () => {
            clearTimeout(timeout);
            console.log(`   ✅ ${name.toUpperCase()} stopped`);
            resolve();
          });
          
          try {
            // Send graceful shutdown signal
            procData.process.send({ type: 'shutdown' });
            // Also send SIGTERM
            procData.process.kill('SIGTERM');
          } catch (e) {
            console.error(`   Error stopping ${name}:`, e.message);
            resolve();
          }
        });
        
        shutdownPromises.push(promise);
      }
    });
    
    // Wait for all processes to exit
    await Promise.all(shutdownPromises);
    
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    console.log(`\n✅ All processes stopped`);
    console.log(`Total uptime: ${uptime} seconds`);
    console.log('════════════════════════════════════════\n');
    
    process.exit(exitCode);
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    setInterval(() => {
      const now = Date.now();
      
      Object.entries(this.processes).forEach(([name, procData]) => {
        if (!procData || !procData.process) return;
        
        // Check if process is still running
        try {
          process.kill(procData.process.pid, 0);
        } catch (e) {
          console.error(`⚠️  ${name.toUpperCase()} process (PID ${procData.process.pid}) is not running`);
        }
        
        // Check heartbeat (if implemented)
        if (procData.lastHeartbeat && (now - procData.lastHeartbeat) > 60000) {
          console.warn(`⚠️  ${name.toUpperCase()} hasn't sent heartbeat in ${Math.floor((now - procData.lastHeartbeat) / 1000)}s`);
        }
      });
    }, 30000); // Check every 30 seconds
  }

  /**
   * Create stub file if script doesn't exist
   */
  createStubFile(scriptPath, name, port) {
    const stub = `/**
 * ${name.toUpperCase()} Process - Auto-generated stub
 * TODO: Implement actual ${name} functionality
 */

console.log('⚠️  ${name.toUpperCase()} process stub - not fully implemented yet');
console.log('   This is a placeholder. Actual implementation needed.');
console.log('   Port: ${port}');

// Send ready signal to orchestrator
if (process.send) {
  process.send({ type: 'ready' });
}

// Keep process alive
setInterval(() => {
  if (process.send) {
    process.send({ type: 'health' });
  }
}, 10000);

// Handle shutdown signal
process.on('message', (msg) => {
  if (msg.type === 'shutdown') {
    console.log('${name.toUpperCase()} process shutting down...');
    process.exit(0);
  }
});

// Handle termination signals
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    console.log(\`${name.toUpperCase()} received \${signal}\`);
    process.exit(0);
  });
});
`;
    
    try {
      fs.writeFileSync(scriptPath, stub);
      console.log(`   ✅ Created stub file: ${scriptPath}`);
    } catch (error) {
      console.error(`   ❌ Failed to create stub file:`, error.message);
    }
  }

  /**
   * Get process status
   */
  getStatus() {
    const status = {};
    
    Object.entries(this.processes).forEach(([name, procData]) => {
      if (!procData) {
        status[name] = 'not_started';
      } else {
        try {
          process.kill(procData.process.pid, 0);
          status[name] = 'running';
        } catch (e) {
          status[name] = 'stopped';
        }
      }
    });
    
    return status;
  }
}

// Start orchestrator if this is the main process
if (require.main === module) {
  const orchestrator = new ProcessOrchestrator();
  orchestrator.start();
  
  // Export for status checking
  global.orchestrator = orchestrator;
}

module.exports = ProcessOrchestrator;
