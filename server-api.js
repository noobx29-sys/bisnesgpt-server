// API Process
console.log('Starting API process router...');
process.env.PROCESS_NAME = 'api';

// Require the main server code
const serverModules = require('./server.js');

try {
    const { createRoutingMiddleware } = require('./src/services/routing/messageRouter');

    if (typeof createRoutingMiddleware === 'function' && serverModules.app && serverModules.sqlDb) {
        serverModules.app.use(createRoutingMiddleware(serverModules.sqlDb));
        console.log('[API ROUTER] message routing middleware initialized');
    }
} catch (error) {
    console.log('[API ROUTER] Optional routing middleware not started yet or errored:', error.message);
}
