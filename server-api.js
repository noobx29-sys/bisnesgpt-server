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

// ─── WebSocket bridge ───────────────────────────────────────────────────────
// Forward status_update / bot_activity messages from isolated processes
// (wwebjs on 3001, meta on 3002) to the API WebSocket clients on port 3000
// so the status page always sees live updates regardless of which process
// generated them.
const WebSocket = require('ws');

function bridgeProcessWS(name, port) {
    function tryConnect() {
        const bridge = new WebSocket(`ws://localhost:${port}/status`);

        bridge.on('open', () => {
            console.log(`[API BRIDGE] Connected to ${name} WebSocket (port ${port})`);
        });

        bridge.on('message', (data) => {
            const wss = global.wss;
            if (!wss) return;
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && client.pathname === '/status') {
                    client.send(data.toString());
                }
            });
        });

        bridge.on('close', () => {
            console.log(`[API BRIDGE] ${name} WebSocket closed — reconnecting in 5s`);
            setTimeout(tryConnect, 5000);
        });

        bridge.on('error', () => {
            setTimeout(tryConnect, 5000);
        });
    }

    // Give the target process time to start its HTTP server
    setTimeout(tryConnect, 8000);
}

bridgeProcessWS('wwebjs', process.env.WWEBJS_PORT || 3001);
