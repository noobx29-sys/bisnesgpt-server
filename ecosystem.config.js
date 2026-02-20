module.exports = {
  apps: [
    // ============================================
    // LEGACY: Original single-process server
    // ============================================
    {
      name: 'whatsapp-service-legacy',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      wait_ready: true,
      listen_timeout: 50000,
      kill_timeout: 15000,
      env: {
        NODE_ENV: 'production',
        PORT: 8443,
      },
      max_restarts: 0,
      autorestart: false,
      min_uptime: '0s',
      restart_delay: 0,
    },
    
    // ============================================
    // NEW: Multi-Process Architecture
    // ============================================
    
    // API Server - Main HTTP API
    {
      name: 'bisnesgpt-api',
      script: './server-api.js',
      instances: process.env.API_INSTANCES || 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PROCESS_NAME: 'api',
        PORT: process.env.API_PORT || 3000,
        ENABLE_WWEBJS: process.env.ENABLE_WWEBJS !== 'false',
        ENABLE_META: process.env.ENABLE_META !== 'false',
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '2G',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 2000,
      autorestart: true,
      watch: false,
    },

    // WWebJS Server - WhatsApp Web Connection
    {
      name: 'bisnesgpt-wwebjs',
      script: './server-wwebjs.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PROCESS_NAME: 'wwebjs',
        PORT: process.env.WWEBJS_PORT || 3001,
        CHROME_PATH: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      },
      error_file: './logs/wwebjs-error.log',
      out_file: './logs/wwebjs-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '4G',
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 5000,
      autorestart: true,
      watch: false,
      kill_timeout: 10000,
      wait_ready: true,
    },

    // Meta Direct Server - Meta Cloud API
    {
      name: 'bisnesgpt-meta',
      script: './server-meta.js',
      instances: process.env.META_INSTANCES || 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PROCESS_NAME: 'meta',
        PORT: process.env.META_PORT || 3002,
      },
      error_file: './logs/meta-error.log',
      out_file: './logs/meta-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '1G',
      min_uptime: '10s',
      max_restarts: 20,
      restart_delay: 1000,
      autorestart: true,
      watch: false,
    },
    
    // Ngrok tunnel (optional)
    {
      name: 'ngrok-tunnel',
      script: 'ngrok',
      args: 'start whatsapp-service',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};