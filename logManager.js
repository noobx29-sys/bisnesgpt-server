const fs = require('fs');
const path = require('path');
const express = require('express');

class LogManager {
  constructor() {
    this.logDir = path.join(__dirname, 'logs');
    this.archiveDir = path.join(this.logDir, 'archive');
  }

  // Get all available log files
  getLogFiles() {
    const files = {
      current: [],
      archived: []
    };

    // Get current log files
    if (fs.existsSync(this.logDir)) {
      const currentFiles = fs.readdirSync(this.logDir).filter(file => 
        file.endsWith('.log') && !fs.statSync(path.join(this.logDir, file)).isDirectory()
      );
      
      files.current = currentFiles.map(file => ({
        name: file,
        path: path.join(this.logDir, file),
        size: this.getFileSize(path.join(this.logDir, file)),
        modified: fs.statSync(path.join(this.logDir, file)).mtime
      }));
    }

    // Get archived log files
    if (fs.existsSync(this.archiveDir)) {
      const archivedFiles = fs.readdirSync(this.archiveDir).filter(file => 
        file.endsWith('.log')
      );
      
      files.archived = archivedFiles.map(file => ({
        name: file,
        path: path.join(this.archiveDir, file),
        size: this.getFileSize(path.join(this.archiveDir, file)),
        modified: fs.statSync(path.join(this.archiveDir, file)).mtime
      }));
    }

    return files;
  }

  // Get file size in human readable format
  getFileSize(filePath) {
    const stats = fs.statSync(filePath);
    const bytes = stats.size;
    
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Read log file with optional filtering
  readLogFile(filename, options = {}) {
    const { lines = 100, filter = '', type = 'all' } = options;
    
    let filePath;
    if (filename.includes('archive/')) {
      filePath = path.join(this.logDir, filename);
    } else {
      filePath = path.join(this.logDir, filename);
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`Log file not found: ${filename}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    let logLines = content.split('\n').filter(line => line.trim());

    // Apply type filter
    if (type !== 'all') {
      const typePattern = new RegExp(`\\[${type.toUpperCase()}\\]`, 'i');
      logLines = logLines.filter(line => typePattern.test(line));
    }

    // Apply text filter
    if (filter) {
      const filterPattern = new RegExp(filter, 'i');
      logLines = logLines.filter(line => filterPattern.test(line));
    }

    // Get last N lines
    if (lines > 0) {
      logLines = logLines.slice(-lines);
    }

    return {
      filename,
      totalLines: content.split('\n').length,
      filteredLines: logLines.length,
      content: logLines.join('\n')
    };
  }

  // Get crash summary
  getCrashSummary() {
    const crashLogPath = path.join(this.logDir, 'crash.log');
    
    if (!fs.existsSync(crashLogPath)) {
      return { crashes: 0, restarts: 0, lastEvent: null };
    }

    const content = fs.readFileSync(crashLogPath, 'utf8');
    const crashes = (content.match(/UNCAUGHT EXCEPTION/g) || []).length;
    const restarts = (content.match(/GRACEFUL SHUTDOWN/g) || []).length;
    const startups = (content.match(/SERVER STARTUP/g) || []).length;
    
    // Find last event
    const lines = content.split('\n');
    let lastEvent = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('===')) {
        const eventLine = lines[i + 1];
        if (eventLine) {
          lastEvent = eventLine.trim();
          break;
        }
      }
    }

    return {
      crashes,
      restarts,
      startups,
      lastEvent,
      logSize: this.getFileSize(crashLogPath)
    };
  }

  // Search across all logs
  searchLogs(searchTerm, options = {}) {
    const { fileTypes = ['console', 'error', 'crash'], caseSensitive = false } = options;
    const results = [];

    fileTypes.forEach(type => {
      const filename = `${type}.log`;
      const filePath = path.join(this.logDir, filename);
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          const searchPattern = caseSensitive ? searchTerm : searchTerm.toLowerCase();
          const searchLine = caseSensitive ? line : line.toLowerCase();
          
          if (searchLine.includes(searchPattern)) {
            results.push({
              file: filename,
              lineNumber: index + 1,
              content: line.trim(),
              timestamp: this.extractTimestamp(line)
            });
          }
        });
      }
    });

    return results.sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return new Date(b.timestamp) - new Date(a.timestamp);
      }
      return 0;
    });
  }

  // Extract timestamp from log line
  extractTimestamp(line) {
    const timestampMatch = line.match(/\[([\d-T:.Z]+)\]/);
    return timestampMatch ? timestampMatch[1] : null;
  }

  // Get log statistics
  getLogStats() {
    const files = this.getLogFiles();
    const stats = {
      currentLogs: files.current.length,
      archivedLogs: files.archived.length,
      totalSize: 0,
      oldestLog: null,
      newestLog: null
    };

    const allFiles = [...files.current, ...files.archived];
    
    allFiles.forEach(file => {
      stats.totalSize += fs.statSync(file.path).size;
      
      if (!stats.oldestLog || file.modified < stats.oldestLog.modified) {
        stats.oldestLog = file;
      }
      
      if (!stats.newestLog || file.modified > stats.newestLog.modified) {
        stats.newestLog = file;
      }
    });

    stats.totalSize = this.formatBytes(stats.totalSize);
    
    return stats;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = LogManager;
