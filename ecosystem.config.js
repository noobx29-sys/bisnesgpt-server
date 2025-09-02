module.exports = {
  apps: [{
    name: 'whatsapp-service',
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
    // Disable automatic restarts - only manual restarts allowed
    max_restarts: 0,
    autorestart: false,
    // Add this to prevent any other restart triggers
    min_uptime: '0s',
    restart_delay: 0,
  }]
};