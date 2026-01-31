// Lightweight Server Manager Daemon
// Runs independently on port 9000 to manage the main server

const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;
const cors = require('cors');

const execPromise = promisify(exec);
const app = express();
const PORT = 9000;

// Enable CORS for all origins (since this is a management tool)
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static('public'));

// Execute shell script
async function executeScript(scriptName) {
    try {
        const scriptPath = path.join(__dirname, 'scripts', scriptName);
        const { stdout, stderr } = await execPromise(`bash "${scriptPath}"`);
        return { 
            success: true, 
            stdout: stdout.trim(), 
            stderr: stderr.trim() 
        };
    } catch (error) {
        return { 
            success: false, 
            error: error.message, 
            stdout: error.stdout ? error.stdout.trim() : '',
            stderr: error.stderr ? error.stderr.trim() : ''
        };
    }
}

// Restart server
app.post('/api/server-manager/restart', async (req, res) => {
    console.log('Restart triggered...');
    const result = await executeScript('restart.sh');
    
    if (result.success) {
        res.json({
            message: 'Server restarted successfully',
            output: result.stdout
        });
    } else {
        res.status(500).json({
            error: 'Failed to restart server',
            details: result.error || result.stderr
        });
    }
});

// Git pull and restart
app.post('/api/server-manager/git-pull-restart', async (req, res) => {
    console.log('Git pull and restart triggered...');
    const result = await executeScript('git-pull-restart.sh');
    
    if (result.success) {
        res.json({
            message: 'Git pull and restart completed successfully',
            output: result.stdout
        });
    } else {
        res.status(500).json({
            error: 'Failed to pull and restart',
            details: result.error || result.stderr
        });
    }
});

// Stop server
app.post('/api/server-manager/stop', async (req, res) => {
    console.log('Stop triggered...');
    const result = await executeScript('stop.sh');
    
    if (result.success) {
        res.json({
            message: 'Server stopped successfully',
            output: result.stdout
        });
    } else {
        res.status(500).json({
            error: 'Failed to stop server',
            details: result.error || result.stderr
        });
    }
});

// Start server
app.post('/api/server-manager/start', async (req, res) => {
    console.log('Start triggered...');
    const result = await executeScript('start.sh');
    
    if (result.success) {
        res.json({
            message: 'Server started successfully',
            output: result.stdout
        });
    } else {
        res.status(500).json({
            error: 'Failed to start server',
            details: result.error || result.stderr
        });
    }
});

// Get server status
app.get('/api/server-manager/status', async (req, res) => {
    try {
        const { stdout } = await execPromise('pm2 jlist');
        const allProcesses = JSON.parse(stdout);
        const processes = allProcesses
            .filter(proc => proc.name === 'server' || proc.name === 'server.js')
            .map(proc => ({
                name: proc.name,
                pid: proc.pid,
                status: proc.pm2_env.status,
                uptime: formatUptime(proc.pm2_env.pm_uptime),
                memory: formatBytes(proc.monit.memory),
                cpu: proc.monit.cpu + '%'
            }));

        res.json({
            message: 'Status retrieved successfully',
            processes: processes
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get status',
            details: error.message
        });
    }
});

// Get git status
app.get('/api/server-manager/git-status', async (req, res) => {
    try {
        const [statusResult, branchResult, lastCommitResult] = await Promise.all([
            execPromise('git status'),
            execPromise('git branch --show-current'),
            execPromise('git log -1 --pretty=format:"%h - %an, %ar : %s"')
        ]);
        
        res.json({
            message: 'Git status retrieved',
            branch: branchResult.stdout.trim(),
            lastCommit: lastCommitResult.stdout.trim(),
            status: statusResult.stdout.trim()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get git status',
            details: error.message
        });
    }
});

// Get logs
app.get('/api/server-manager/logs', async (req, res) => {
    try {
        const lines = req.query.lines || 100;
        const { stdout } = await execPromise(`pm2 logs server --lines ${lines} --nostream`);
        
        res.json({
            message: 'Logs retrieved successfully',
            logs: stdout || 'No logs available'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get logs',
            details: error.message
        });
    }
});

// Get system info
app.get('/api/server-manager/system-info', async (req, res) => {
    try {
        const [diskResult, memoryResult, uptimeResult] = await Promise.all([
            execPromise('df -h /'),
            execPromise('vm_stat || free -h'),
            execPromise('uptime')
        ]);
        
        res.json({
            message: 'System info retrieved',
            disk: diskResult.stdout.trim(),
            memory: memoryResult.stdout.trim(),
            uptime: uptimeResult.stdout.trim()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get system info',
            details: error.message
        });
    }
});

// Clear PM2 logs
app.post('/api/server-manager/clear-logs', async (req, res) => {
    try {
        const { stdout } = await execPromise('pm2 flush');
        res.json({
            message: 'PM2 logs cleared successfully',
            output: stdout.trim()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to clear logs',
            details: error.message
        });
    }
});

// NPM install
app.post('/api/server-manager/npm-install', async (req, res) => {
    try {
        const { stdout } = await execPromise('npm install');
        res.json({
            message: 'npm install completed',
            output: stdout.trim()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to run npm install',
            details: error.message
        });
    }
});

// List wwebjs folders
app.get('/api/server-manager/wwebjs-folders', async (req, res) => {
    try {
        const authPath = path.join(__dirname, '.wwebjs_auth');
        
        try {
            await fs.access(authPath);
        } catch (error) {
            return res.json({
                message: '.wwebjs_auth folder not found',
                folders: []
            });
        }

        const items = await fs.readdir(authPath, { withFileTypes: true });
        const folders = [];

        for (const item of items) {
            if (item.isDirectory()) {
                const folderPath = path.join(authPath, item.name);
                try {
                    const stats = await fs.stat(folderPath);
                    const { stdout } = await execPromise(`du -sh "${folderPath}" | cut -f1`);
                    
                    folders.push({
                        name: item.name,
                        size: stdout.trim() || 'Unknown',
                        modified: stats.mtime.toISOString(),
                        path: folderPath
                    });
                } catch (err) {
                    console.error(`Error reading folder ${item.name}:`, err);
                }
            }
        }

        folders.sort((a, b) => new Date(b.modified) - new Date(a.modified));

        res.json({
            message: 'Folders retrieved successfully',
            folders: folders,
            totalFolders: folders.length
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to list wwebjs folders',
            details: error.message
        });
    }
});

// Delete wwebjs folder
app.post('/api/server-manager/delete-wwebjs-folder', async (req, res) => {
    try {
        const { folderName } = req.body;
        
        if (!folderName) {
            return res.status(400).json({ error: 'Folder name is required' });
        }

        const authPath = path.join(__dirname, '.wwebjs_auth');
        const folderPath = path.join(authPath, folderName);

        if (!folderPath.startsWith(authPath)) {
            return res.status(400).json({ error: 'Invalid folder path' });
        }

        try {
            await fs.access(folderPath);
        } catch (error) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        console.log(`Deleting session folder: ${folderName}`);
        
        // Stop server
        await execPromise('pm2 stop server.js');
        
        // Kill Chrome
        await execPromise('pkill -9 chrome || pkill -9 Chrome || killall -9 "Google Chrome" || true');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Delete folder
        await fs.rm(folderPath, { recursive: true, force: true });
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Start server
        await execPromise('pm2 start server.js');

        res.json({
            message: `Folder '${folderName}' deleted successfully and server restarted`,
            output: 'Stop → Kill Chrome → Delete → Start: Completed'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to delete folder',
            details: error.message
        });
    }
});

// System restart
app.post('/api/server-manager/restart-system', async (req, res) => {
    try {
        await execPromise('pm2 startup');
        await execPromise('pm2 save');
        
        res.json({
            message: '⚠️ SYSTEM RESTART INITIATED. Server will be back online in ~2-3 minutes.',
            output: 'System reboot scheduled in 5 seconds...'
        });

        setTimeout(() => {
            execPromise('sudo reboot').catch(err => console.error('Reboot failed:', err));
        }, 5000);
    } catch (error) {
        res.status(500).json({
            error: 'Failed to restart system',
            details: error.message
        });
    }
});

// Helper functions
function formatUptime(timestamp) {
    if (!timestamp) return 'N/A';
    const uptime = Date.now() - timestamp;
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function formatBytes(bytes) {
    if (!bytes) return 'N/A';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
        return (mb / 1024).toFixed(2) + ' GB';
    }
    return mb.toFixed(2) + ' MB';
}

app.listen(PORT, () => {
    console.log(`🚀 Server Manager Daemon running on port ${PORT}`);
    console.log(`   Main server can be managed even when stopped`);
    console.log(`   Access at: http://localhost:${PORT}/server-manager.html`);
});
