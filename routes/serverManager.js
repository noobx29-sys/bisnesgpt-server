const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execPromise = promisify(exec);

// Utility function to execute shell commands
async function executeCommand(command) {
    try {
        const { stdout, stderr } = await execPromise(command);
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

// Restart server (stop, kill chrome, start)
router.post('/restart', async (req, res) => {
    try {
        console.log('Server restart initiated...');
        
        // Step 1: Stop server.js with PM2
        console.log('Step 1: Stopping server.js...');
        const stopResult = await executeCommand('pm2 stop server.js');
        
        if (!stopResult.success) {
            console.error('Failed to stop server:', stopResult.error);
            return res.status(500).json({
                error: 'Failed to stop server',
                details: stopResult.error
            });
        }

        // Step 2: Kill all Chrome processes
        console.log('Step 2: Killing Chrome processes...');
        const killChromeResult = await executeCommand('pkill -9 chrome || pkill -9 Chrome || killall -9 "Google Chrome" || true');
        
        // Note: pkill might return an error if no processes found, but we continue anyway
        console.log('Chrome processes terminated');

        // Wait a moment for cleanup
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 3: Start server.js with PM2
        console.log('Step 3: Starting server.js...');
        const startResult = await executeCommand('pm2 start server.js');
        
        if (!startResult.success) {
            console.error('Failed to start server:', startResult.error);
            return res.status(500).json({
                error: 'Server stopped and Chrome killed, but failed to restart server',
                details: startResult.error
            });
        }

        console.log('Server restarted successfully');

        res.json({
            message: 'Server restarted successfully',
            output: `Stop: ${stopResult.stdout}\nKill Chrome: Completed\nStart: ${startResult.stdout}`
        });

    } catch (error) {
        console.error('Error during server restart:', error);
        res.status(500).json({
            error: 'Failed to restart server',
            details: error.message
        });
    }
});

// Git pull and restart
router.post('/git-pull-restart', async (req, res) => {
    try {
        console.log('Git pull and restart initiated...');
        
        // Step 1: Check git status
        console.log('Step 1: Checking git status...');
        const statusResult = await executeCommand('git status --porcelain');
        
        if (statusResult.stdout) {
            console.warn('Warning: Uncommitted changes detected');
        }

        // Step 2: Pull from master
        console.log('Step 2: Pulling from master...');
        const pullResult = await executeCommand('git pull origin master');
        
        if (!pullResult.success && !pullResult.stdout.includes('Already up to date')) {
            console.error('Failed to pull from git:', pullResult.error);
            return res.status(500).json({
                error: 'Failed to pull from git',
                details: pullResult.error || pullResult.stderr
            });
        }

        // Step 3: Install dependencies if package.json changed
        console.log('Step 3: Checking for dependency updates...');
        const gitDiffResult = await executeCommand('git diff HEAD@{1} HEAD -- package.json');
        
        if (gitDiffResult.stdout) {
            console.log('package.json changed, installing dependencies...');
            const npmResult = await executeCommand('npm install');
            if (!npmResult.success) {
                console.warn('npm install had issues:', npmResult.stderr);
            }
        }

        // Step 4: Stop server.js with PM2
        console.log('Step 4: Stopping server.js...');
        const stopResult = await executeCommand('pm2 stop server.js');
        
        if (!stopResult.success) {
            console.error('Failed to stop server:', stopResult.error);
            return res.status(500).json({
                error: 'Code pulled but failed to stop server',
                details: stopResult.error
            });
        }

        // Step 5: Kill all Chrome processes
        console.log('Step 5: Killing Chrome processes...');
        await executeCommand('pkill -9 chrome || pkill -9 Chrome || killall -9 "Google Chrome" || true');
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 6: Start server.js with PM2
        console.log('Step 6: Starting server.js...');
        const startResult = await executeCommand('pm2 start server.js');
        
        if (!startResult.success) {
            console.error('Failed to start server:', startResult.error);
            return res.status(500).json({
                error: 'Code pulled and server stopped, but failed to restart',
                details: startResult.error
            });
        }

        console.log('Git pull and restart completed successfully');

        res.json({
            message: 'Git pull and restart completed successfully',
            output: `Pull: ${pullResult.stdout}\n\nRestart: Completed`
        });

    } catch (error) {
        console.error('Error during git pull and restart:', error);
        res.status(500).json({
            error: 'Failed to pull and restart',
            details: error.message
        });
    }
});

// Stop server
router.post('/stop', async (req, res) => {
    try {
        console.log('Server stop initiated...');
        
        const stopResult = await executeCommand('pm2 stop server.js');
        
        if (!stopResult.success) {
            return res.status(500).json({
                error: 'Failed to stop server',
                details: stopResult.error
            });
        }

        console.log('Server stopped successfully');

        res.json({
            message: 'Server stopped successfully',
            output: stopResult.stdout
        });

    } catch (error) {
        console.error('Error during server stop:', error);
        res.status(500).json({
            error: 'Failed to stop server',
            details: error.message
        });
    }
});

// Start server
router.post('/start', async (req, res) => {
    try {
        console.log('Server start initiated...');
        
        const startResult = await executeCommand('pm2 start server.js');
        
        if (!startResult.success) {
            return res.status(500).json({
                error: 'Failed to start server',
                details: startResult.error
            });
        }

        console.log('Server started successfully');

        res.json({
            message: 'Server started successfully',
            output: startResult.stdout
        });

    } catch (error) {
        console.error('Error during server start:', error);
        res.status(500).json({
            error: 'Failed to start server',
            details: error.message
        });
    }
});

// Get server status
router.get('/status', async (req, res) => {
    try {
        const statusResult = await executeCommand('pm2 jlist');
        
        if (!statusResult.success) {
            return res.status(500).json({
                error: 'Failed to get server status',
                details: statusResult.error
            });
        }

        let processes = [];
        try {
            const allProcesses = JSON.parse(statusResult.stdout);
            // Filter for server.js
            processes = allProcesses
                .filter(proc => proc.name === 'server' || proc.name === 'server.js')
                .map(proc => ({
                    name: proc.name,
                    pid: proc.pid,
                    status: proc.pm2_env.status,
                    uptime: formatUptime(proc.pm2_env.pm_uptime),
                    memory: formatBytes(proc.monit.memory),
                    cpu: proc.monit.cpu + '%'
                }));
        } catch (parseError) {
            console.error('Error parsing PM2 output:', parseError);
        }

        res.json({
            message: 'Status retrieved successfully',
            processes: processes
        });

    } catch (error) {
        console.error('Error getting server status:', error);
        res.status(500).json({
            error: 'Failed to get server status',
            details: error.message
        });
    }
});

// Helper function to format uptime
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

// System restart (dangerous - ensure PM2 starts on boot)
router.post('/restart-system', async (req, res) => {
    try {
        console.log('⚠️  SYSTEM RESTART INITIATED...');
        
        // Step 1: Ensure PM2 is set to start on boot
        console.log('Step 1: Setting up PM2 startup...');
        const startupResult = await executeCommand('pm2 startup');
        console.log('Startup command output:', startupResult.stdout);
        
        // Step 2: Save current PM2 process list
        console.log('Step 2: Saving PM2 process list...');
        const saveResult = await executeCommand('pm2 save');
        
        if (!saveResult.success) {
            console.error('Failed to save PM2 processes:', saveResult.error);
            return res.status(500).json({
                error: 'Failed to save PM2 configuration before restart',
                details: saveResult.error
            });
        }

        console.log('PM2 configuration saved. System will restart in 5 seconds...');
        
        // Send response before reboot
        res.json({
            message: '⚠️ SYSTEM RESTART INITIATED. Server will be back online in ~2-3 minutes. PM2 will auto-start all processes.',
            output: 'System reboot scheduled in 5 seconds...'
        });

        // Schedule reboot after response is sent
        setTimeout(async () => {
            console.log('Executing system reboot...');
            await executeCommand('sudo reboot');
        }, 5000);

    } catch (error) {
        console.error('Error during system restart:', error);
        res.status(500).json({
            error: 'Failed to restart system',
            details: error.message
        });
    }
});

// View recent logs
router.get('/logs', async (req, res) => {
    try {
        const lines = req.query.lines || 100;
        const logsResult = await executeCommand(`pm2 logs server --lines ${lines} --nostream`);
        
        res.json({
            message: 'Logs retrieved successfully',
            logs: logsResult.stdout || logsResult.stderr || 'No logs available'
        });

    } catch (error) {
        console.error('Error getting logs:', error);
        res.status(500).json({
            error: 'Failed to get logs',
            details: error.message
        });
    }
});

// Clear PM2 logs
router.post('/clear-logs', async (req, res) => {
    try {
        console.log('Clearing PM2 logs...');
        const clearResult = await executeCommand('pm2 flush');
        
        res.json({
            message: 'PM2 logs cleared successfully',
            output: clearResult.stdout
        });

    } catch (error) {
        console.error('Error clearing logs:', error);
        res.status(500).json({
            error: 'Failed to clear logs',
            details: error.message
        });
    }
});

// Get git status
router.get('/git-status', async (req, res) => {
    try {
        const statusResult = await executeCommand('git status');
        const branchResult = await executeCommand('git branch --show-current');
        const lastCommitResult = await executeCommand('git log -1 --pretty=format:"%h - %an, %ar : %s"');
        
        res.json({
            message: 'Git status retrieved',
            branch: branchResult.stdout,
            lastCommit: lastCommitResult.stdout,
            status: statusResult.stdout
        });

    } catch (error) {
        console.error('Error getting git status:', error);
        res.status(500).json({
            error: 'Failed to get git status',
            details: error.message
        });
    }
});

// Get system info
router.get('/system-info', async (req, res) => {
    try {
        const diskResult = await executeCommand('df -h /');
        const memoryResult = await executeCommand('free -h || vm_stat');
        const uptimeResult = await executeCommand('uptime');
        
        res.json({
            message: 'System info retrieved',
            disk: diskResult.stdout,
            memory: memoryResult.stdout,
            uptime: uptimeResult.stdout
        });

    } catch (error) {
        console.error('Error getting system info:', error);
        res.status(500).json({
            error: 'Failed to get system info',
            details: error.message
        });
    }
});

// NPM install
router.post('/npm-install', async (req, res) => {
    try {
        console.log('Running npm install...');
        const npmResult = await executeCommand('npm install');
        
        res.json({
            message: 'npm install completed',
            output: npmResult.stdout
        });

    } catch (error) {
        console.error('Error running npm install:', error);
        res.status(500).json({
            error: 'Failed to run npm install',
            details: error.message
        });
    }
});

// List .wwebjs_auth folders
router.get('/wwebjs-folders', async (req, res) => {
    try {
        const authPath = path.join(__dirname, '..', '.wwebjs_auth');
        
        // Check if directory exists
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
                    
                    // Calculate folder size
                    const sizeResult = await executeCommand(`du -sh "${folderPath}" | cut -f1`);
                    
                    folders.push({
                        name: item.name,
                        size: sizeResult.stdout.trim() || 'Unknown',
                        modified: stats.mtime.toISOString(),
                        path: folderPath
                    });
                } catch (err) {
                    console.error(`Error reading folder ${item.name}:`, err);
                }
            }
        }

        // Sort by modified date, newest first
        folders.sort((a, b) => new Date(b.modified) - new Date(a.modified));

        res.json({
            message: 'Folders retrieved successfully',
            folders: folders,
            totalFolders: folders.length
        });

    } catch (error) {
        console.error('Error listing wwebjs folders:', error);
        res.status(500).json({
            error: 'Failed to list wwebjs folders',
            details: error.message
        });
    }
});

// Delete .wwebjs_auth folder with server restart
router.post('/delete-wwebjs-folder', async (req, res) => {
    try {
        const { folderName } = req.body;
        
        if (!folderName) {
            return res.status(400).json({
                error: 'Folder name is required'
            });
        }

        const authPath = path.join(__dirname, '..', '.wwebjs_auth');
        const folderPath = path.join(authPath, folderName);

        // Security check: ensure folder is within .wwebjs_auth
        if (!folderPath.startsWith(authPath)) {
            return res.status(400).json({
                error: 'Invalid folder path'
            });
        }

        // Check if folder exists
        try {
            await fs.access(folderPath);
        } catch (error) {
            return res.status(404).json({
                error: 'Folder not found'
            });
        }

        console.log(`Deleting session folder: ${folderName}`);
        
        // Step 1: Stop server.js with PM2
        console.log('Step 1: Stopping server.js...');
        const stopResult = await executeCommand('pm2 stop server.js');
        
        if (!stopResult.success) {
            console.error('Failed to stop server:', stopResult.error);
            return res.status(500).json({
                error: 'Failed to stop server',
                details: stopResult.error
            });
        }

        // Step 2: Kill all Chrome processes
        console.log('Step 2: Killing Chrome processes...');
        await executeCommand('pkill -9 chrome || pkill -9 Chrome || killall -9 "Google Chrome" || true');
        
        console.log('Chrome processes terminated');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 3: Delete the folder
        console.log(`Step 3: Deleting folder ${folderName}...`);
        await fs.rm(folderPath, { recursive: true, force: true });
        console.log('Folder deleted successfully');

        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 4: Start server.js with PM2
        console.log('Step 4: Starting server.js...');
        const startResult = await executeCommand('pm2 start server.js');
        
        if (!startResult.success) {
            console.error('Failed to start server:', startResult.error);
            return res.status(500).json({
                error: 'Folder deleted but failed to restart server',
                details: startResult.error,
                warning: 'You may need to manually start the server'
            });
        }

        console.log(`Folder ${folderName} deleted and server restarted successfully`);

        res.json({
            message: `Folder '${folderName}' deleted successfully and server restarted`,
            output: 'Stop → Kill Chrome → Delete → Start: Completed'
        });

    } catch (error) {
        console.error('Error deleting wwebjs folder:', error);
        res.status(500).json({
            error: 'Failed to delete folder',
            details: error.message
        });
    }
});

// Helper function to format bytes
function formatBytes(bytes) {
    if (!bytes) return 'N/A';
    
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
        return (mb / 1024).toFixed(2) + ' GB';
    }
    return mb.toFixed(2) + ' MB';
}

module.exports = router;
