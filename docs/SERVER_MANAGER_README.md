# Server Manager

A comprehensive web-based interface for managing your PM2 server operations without touching the server directly.

## Features

### Core Operations
- **Restart Server**: Stops server.js, kills all Chrome processes, and restarts server.js
- **Git Pull & Restart**: Pulls latest code from master, installs dependencies if needed, and restarts server
- **Stop Server**: Stops the server.js PM2 process
- **Start Server**: Starts the server.js PM2 process

### Monitoring
- **Server Status**: View current PM2 process status including uptime, memory, and CPU usage
- **Git Status**: Check current branch, last commit, and working tree status
- **View Logs**: View recent PM2 logs (configurable number of lines)
- **System Info**: Check disk space, memory usage, and system uptime

### Maintenance
- **Clear PM2 Logs**: Flush all PM2 logs to free up space
- **NPM Install**: Run npm install to update dependencies
- **Restart System (PC)**: ⚠️ Reboot the entire system with automatic PM2 process recovery
- **WhatsApp Sessions**: View and delete WhatsApp Web.js session folders

## WhatsApp Session Management

The server manager allows you to view and delete WhatsApp Web.js session folders stored in `.wwebjs_auth`. This is useful for:
- Cleaning up old or unused session folders
- Fixing authentication issues by removing corrupted sessions
- Freeing up disk space
- Managing multiple WhatsApp instances

### Session Deletion Process
When you delete a session folder:
1. Server is stopped with PM2
2. All Chrome processes are killed
3. The selected session folder is permanently deleted
4. Server is restarted with PM2

Each session folder shows:
- 📂 Folder name (e.g., `session-0149_phone1`)
- File size on disk
- Last modified date/time

**⚠️ Warning**: Deleted sessions cannot be recovered and will require re-authentication for that WhatsApp instance.

## Access

Once your server is running, access the Server Manager at:

```
http://your-server-address/server-manager.html
```

For local development:
```
http://localhost:3000/server-manager.html
```

## API Endpoints

The server manager uses the following API endpoints:

### GET Endpoints
- `GET /api/server-manager/status` - Get server status
- `GET /api/server-manager/git-status` - Get git repository status
- `GET /api/server-manager/logs?lines=100` - Get recent logs
- `GET /api/server-manager/system-info` - Get system information
- `GET /api/server-manager/wwebjs-folders` - List WhatsApp session folders

### POST Endpoints
- `POST /api/server-manager/restart` - Restart the server
- `POST /api/server-manager/git-pull-restart` - Pull from git and restart
- `POST /api/server-manager/stop` - Stop the server
- `POST /api/server-manager/start` - Start the server
- `POST /api/server-manager/restart-system` - Restart the entire system (⚠️ DANGEROUS)
- `POST /api/server-manager/clear-logs` - Clear PM2 logs
- `POST /api/server-manager/npm-install` - Run npm install
- `POST /api/server-manager/delete-wwebjs-folder` - Delete a WhatsApp session folder

## How It Works

### Restart Operation
1. Stops `server.js` using PM2
2. Kills all Chrome/Chromium processes (useful for clearing WhatsApp Web sessions)
3. Waits 2 seconds for cleanup
4. Starts `server.js` using PM2

### Git Pull & Restart Operation (⭐ Recommended for Updates)
1. Checks git status for uncommitted changes (warning if any)
2. Pulls latest code from master branch
3. Checks if package.json changed
4. Runs `npm install` if dependencies were updated
5. Stops server.js
6. Kills all Chrome processes
7. Waits for cleanup
8. Starts server.js with the new code

**Perfect for hands-off updates!** Just click and your server updates itself.

### System Restart Operation (⚠️ USE WITH CAUTION)
1. Configures PM2 to start on system boot (`pm2 startup`)
2. Saves current PM2 process list (`pm2 save`)
3. Waits 5 seconds
4. Reboots the entire system
5. **Automatically restarts all PM2 processes** when system comes back up

**Important**: This ensures your server comes back online automatically after a system restart. PM2 will restore all saved processes.

### Safety Features
- Confirmation dialogs before executing any action (especially critical for system restart)
- Loading indicators during operations
- Detailed status messages with command output
- Error handling with detailed error messages
- Automatic dependency installation detection

## Requirements

- PM2 must be installed (`npm install -g pm2`)
- Server must be running with PM2 (`pm2 start server.js`)
- Git repository must be properly configured
- Appropriate permissions to execute PM2 commands
- **For System Restart**: `sudo` access may be required (configure passwordless sudo for reboot)

### Setting Up Passwordless Sudo for Reboot (Optional but Recommended)

To allow the server to reboot without password prompt:

```bash
# Edit sudoers file
sudo visudo

# Add this line (replace 'yourusername' with your actual username):
yourusername ALL=(ALL) NOPASSWD: /sbin/reboot
```

This allows only the `reboot` command to run without password.

## Usage Tips

1. **For code updates**: Use "Git Pull & Restart" - it's completely automated!
2. Always check the server status before performing operations
3. Use "View Logs" to debug issues before restarting
4. Check "Git Status" to see if you have uncommitted changes
5. Use "System Info" to monitor disk space and memory before major operations
6. The restart function is helpful when you need to clear Chrome processes (WhatsApp Web issues)
7. **System Restart should be a last resort** - use regular restart for most cases
8. All actions are logged to the server console

## Security Note

This interface performs critical server operations. In a production environment, you should:
- Add authentication to protect access
- Use HTTPS
- Restrict access by IP address
- Add rate limiting to prevent abuse

## Troubleshooting

If operations fail:
1. Check that PM2 is installed: `pm2 --version`
2. Verify server.js is managed by PM2: `pm2 list`
3. Check server logs: `pm2 logs server`
4. Ensure proper permissions for PM2 commands
5. For git operations: ensure remote repository is accessible
6. For system restart: verify PM2 startup is configured: `pm2 startup`
7. Check disk space if operations fail: `df -h`

### Common Issues

**Git Pull fails:**
- Check if you have uncommitted changes
- Verify git remote is accessible: `git remote -v`
- Ensure you're on the correct branch

**System won't auto-restart after reboot:**
- Run `pm2 startup` and follow the instructions
- Run `pm2 save` to save the process list
- Verify with `pm2 resurrect` after manual restart

**NPM Install takes too long:**
- This is normal for large dependency trees
- Check your internet connection
- Consider running it during off-peak hours

## Example Output

When you click "Check Server Status", you'll see:
```
Process: server
Status: online
PID: 12345
Uptime: 2h 30m
Memory: 245.32 MB
CPU: 5.2%
```

When you click "Git Status", you'll see:
```
🌿 Git Status:

Branch: master
Last Commit: a1b2c3d - John Doe, 2 hours ago : Fix server restart issue

Status:
On branch master
Your branch is up to date with 'origin/master'.

nothing to commit, working tree clean
```

## Workflow Examples

### Standard Code Update (No Server Access Needed)
1. Commit and push your changes to master from your development machine
2. Open Server Manager on any browser
3. Click "Git Pull & Restart"
4. Wait 30-60 seconds
5. Done! Server is running latest code

### Troubleshooting Performance Issues
1. Click "Server Status" - check memory/CPU
2. Click "System Info" - check disk space
3. Click "View Logs" - look for errors
4. Click "Restart Server" if needed
### Cleaning Up WhatsApp Sessions
1. Click "WhatsApp Sessions"
2. Review the list of session folders
3. Select old/unused sessions (look at modified date)
4. Click "Delete" on unwanted sessions
5. Confirm deletion
6. Server automatically restarts with sessions cleaned
### After System Update
1. Click "System Restart (PC)"
2. Wait 2-3 minutes
3. Server automatically comes back online with all processes
