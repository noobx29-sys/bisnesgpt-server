#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const LogManager = require('./logManager');

class LogCLI {
  constructor() {
    this.logManager = new LogManager();
    this.commands = {
      list: this.listLogs.bind(this),
      view: this.viewLog.bind(this),
      search: this.searchLogs.bind(this),
      stats: this.showStats.bind(this),
      crash: this.showCrashSummary.bind(this),
      rotate: this.rotateLogs.bind(this),
      clean: this.cleanLogs.bind(this),
      tail: this.tailLog.bind(this),
      help: this.showHelp.bind(this)
    };
  }

  run() {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';
    
    if (this.commands[command]) {
      this.commands[command](args.slice(1));
    } else {
      console.error(`Unknown command: ${command}`);
      this.showHelp();
      process.exit(1);
    }
  }

  listLogs() {
    try {
      const files = this.logManager.getLogFiles();
      
      console.log('\n📁 Current Log Files:');
      console.log('==================');
      if (files.current.length === 0) {
        console.log('  No current log files found');
      } else {
        files.current.forEach(file => {
          console.log(`  📄 ${file.name} (${file.size})`);
        });
      }

      if (files.archived.length > 0) {
        console.log('\n📦 Archived Log Files:');
        console.log('====================');
        files.archived.forEach(file => {
          console.log(`  📄 ${file.name} (${file.size})`);
        });
      }
      console.log('');
    } catch (error) {
      console.error('Error listing logs:', error.message);
    }
  }

  viewLog(args) {
    const filename = args[0];
    if (!filename) {
      console.error('Usage: node logCLI.js view <filename> [lines] [type]');
      return;
    }

    const lines = parseInt(args[1]) || 50;
    const type = args[2] || 'all';

    try {
      const logData = this.logManager.readLogFile(filename, { lines, type });
      
      console.log(`\n📄 ${filename} (showing last ${lines} lines, type: ${type})`);
      console.log('='.repeat(80));
      console.log(logData.content);
      console.log('='.repeat(80));
      console.log(`Total lines: ${logData.totalLines} | Filtered: ${logData.filteredLines}\n`);
    } catch (error) {
      console.error('Error viewing log:', error.message);
    }
  }

  searchLogs(args) {
    const searchTerm = args[0];
    if (!searchTerm) {
      console.error('Usage: node logCLI.js search <search-term> [file-types]');
      return;
    }

    const fileTypes = args.slice(1);
    if (fileTypes.length === 0) {
      fileTypes.push('console', 'error', 'crash');
    }

    try {
      const results = this.logManager.searchLogs(searchTerm, { fileTypes });
      
      console.log(`\n🔍 Search Results for "${searchTerm}"`);
      console.log('='.repeat(80));
      
      if (results.length === 0) {
        console.log('No results found.\n');
        return;
      }

      results.forEach((result, index) => {
        console.log(`\n${index + 1}. ${result.file}:${result.lineNumber}`);
        if (result.timestamp) {
          console.log(`   Time: ${result.timestamp}`);
        }
        console.log(`   Content: ${result.content.trim()}`);
      });
      
      console.log(`\nFound ${results.length} matches.\n`);
    } catch (error) {
      console.error('Error searching logs:', error.message);
    }
  }

  showStats() {
    try {
      const stats = this.logManager.getLogStats();
      
      console.log('\n📊 Log Statistics');
      console.log('================');
      console.log(`Current Logs: ${stats.currentLogs}`);
      console.log(`Archived Logs: ${stats.archivedLogs}`);
      console.log(`Total Size: ${stats.totalSize}`);
      
      if (stats.oldestLog) {
        console.log(`Oldest Log: ${stats.oldestLog.name} (${stats.oldestLog.modified.toLocaleString()})`);
      }
      
      if (stats.newestLog) {
        console.log(`Newest Log: ${stats.newestLog.name} (${stats.newestLog.modified.toLocaleString()})`);
      }
      
      console.log('');
    } catch (error) {
      console.error('Error getting stats:', error.message);
    }
  }

  showCrashSummary() {
    try {
      const summary = this.logManager.getCrashSummary();
      
      console.log('\n💥 Crash Summary');
      console.log('===============');
      console.log(`Crashes: ${summary.crashes}`);
      console.log(`Restarts: ${summary.restarts}`);
      console.log(`Startups: ${summary.startups}`);
      console.log(`Log Size: ${summary.logSize}`);
      
      if (summary.lastEvent) {
        console.log(`Last Event: ${summary.lastEvent}`);
      }
      
      console.log('');
    } catch (error) {
      console.error('Error getting crash summary:', error.message);
    }
  }

  rotateLogs() {
    try {
      // This would need to import the logger
      console.log('Log rotation initiated...');
      console.log('Note: Use the web interface or API for log rotation.');
    } catch (error) {
      console.error('Error rotating logs:', error.message);
    }
  }

  cleanLogs() {
    try {
      // This would need to import the logger
      console.log('Log cleaning initiated...');
      console.log('Note: Use the web interface or API for log cleaning.');
    } catch (error) {
      console.error('Error cleaning logs:', error.message);
    }
  }

  tailLog(args) {
    const filename = args[0];
    if (!filename) {
      console.error('Usage: node logCLI.js tail <filename> [lines]');
      return;
    }

    const lines = parseInt(args[1]) || 50;
    const logPath = path.join(__dirname, 'logs', filename);

    if (!fs.existsSync(logPath)) {
      console.error(`Log file not found: ${filename}`);
      return;
    }

    console.log(`\n📄 Tailing ${filename} (last ${lines} lines)`);
    console.log('='.repeat(80));
    console.log('Press Ctrl+C to stop\n');

    // Use tail command on Unix systems, or implement file watching
    if (process.platform === 'win32') {
      // Windows implementation - read file periodically
      this.watchFileWindows(logPath, lines);
    } else {
      // Unix systems - use tail command
      const tailProcess = exec(`tail -f -n ${lines} "${logPath}"`);
      
      tailProcess.stdout.on('data', (data) => {
        process.stdout.write(data);
      });

      tailProcess.stderr.on('data', (data) => {
        console.error('Error:', data);
      });
    }
  }

  watchFileWindows(filePath, lines) {
    let lastSize = 0;
    
    // Read initial content
    try {
      const logData = this.logManager.readLogFile(path.basename(filePath), { lines });
      console.log(logData.content);
      lastSize = fs.statSync(filePath).size;
    } catch (error) {
      console.error('Error reading initial content:', error.message);
      return;
    }

    // Watch for changes
    const interval = setInterval(() => {
      try {
        const stats = fs.statSync(filePath);
        if (stats.size > lastSize) {
          const stream = fs.createReadStream(filePath, { start: lastSize });
          stream.on('data', (chunk) => {
            process.stdout.write(chunk);
          });
          lastSize = stats.size;
        }
      } catch (error) {
        console.error('Error watching file:', error.message);
        clearInterval(interval);
      }
    }, 1000);

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log('\n\nStopped tailing log file.');
      process.exit(0);
    });
  }

  showHelp() {
    console.log(`
🔧 Log Management CLI

Usage: node logCLI.js <command> [options]

Commands:
  list                     List all log files (current and archived)
  view <file> [lines] [type]   View log file content
  search <term> [types...]     Search across log files
  stats                    Show log statistics
  crash                    Show crash summary
  tail <file> [lines]      Follow log file in real-time
  rotate                   Rotate current logs (archives them)
  clean                    Clean old archived logs
  help                     Show this help message

Examples:
  node logCLI.js list
  node logCLI.js view console.log 100 error
  node logCLI.js search "error connecting"
  node logCLI.js tail console.log 50
  node logCLI.js stats

Log Types: all, error, warn, info, log
File Types: console, error, crash
`);
  }
}

// Run CLI if called directly
if (require.main === module) {
  const cli = new LogCLI();
  cli.run();
}

module.exports = LogCLI;
