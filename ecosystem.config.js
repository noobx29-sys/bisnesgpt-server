module.exports = {
  apps: [{
    name: 'whatsapp-service',
    script: 'server.js',
    instances: 4,
    exec_mode: 'cluster',
    wait_ready: true,
    listen_timeout: 50000,
    kill_timeout: 15000,
    max_memory_restart: '2G',
    env: {
      NODE_ENV: 'production',
      PORT: 8443
    },
    exp_backoff_restart_delay: 100,
    restart_delay: 4000
  }]
}; 