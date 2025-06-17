const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function cleanDirectory(dir) {
    try {
        if (fs.existsSync(dir)) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch (err) {
                console.log('Could not remove directory, trying alternative method...');
                if (process.platform === 'win32') {
                    await new Promise((resolve) => {
                        exec(`rd /s /q "${dir}"`, (error) => {
                            if (error) {
                                console.warn('Warning: Could not remove directory, continuing anyway...');
                            }
                            resolve();
                        });
                    });
                }
            }
        }
    } catch (error) {
        console.warn('Warning: Directory cleanup failed, continuing with build...');
    }
    fs.mkdirSync(dir, { recursive: true });
}

// Create client distribution directory
const clientDir = 'client-dist';

// Build process
(async () => {
    try {
        console.log('Cleaning up previous build...');
        await cleanDirectory(clientDir);
        
        console.log('Creating client files...');
        
        // Copy your existing .env file instead of creating a new one
        fs.copyFileSync('.env', path.join(clientDir, '.env'));

        // Build command for client version
        const buildCmd = `pkg . --target node16-win-x64 --output ${clientDir}/server.exe --public`;
        
        console.log('Building client executable...');
        exec(buildCmd, async (error, stdout, stderr) => {
            if (error) {
                console.error(`Error during build:`, error);
                return;
            }
            
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);
            
            // Files to copy
            const filesToCopy = [
                'node_modules',
                'sa_firebase.json',
                'spreadsheet'
            ];

            console.log('Copying necessary files...');

            for (const file of filesToCopy) {
                const sourcePath = path.join(__dirname, file);
                const destPath = path.join(__dirname, clientDir, file);
                
                if (fs.existsSync(sourcePath)) {
                    console.log(`Copying ${file}...`);
                    fs.mkdirSync(path.dirname(destPath), { recursive: true });
                    
                    if (fs.lstatSync(sourcePath).isDirectory()) {
                        fs.cpSync(sourcePath, destPath, { recursive: true });
                    } else {
                        fs.copyFileSync(sourcePath, destPath);
                    }
                } else {
                    console.warn(`Warning: ${file} not found`);
                }
            }

            // Create start script
            const startScript = `@echo off
echo Starting server...
server.exe
pause`;
            
            fs.writeFileSync(path.join(clientDir, 'start.bat'), startScript);

            console.log('\nClient build completed successfully!');
            console.log(`\nDistribution files are in the '${clientDir}' directory`);
        });
    } catch (error) {
        console.error('Error during build process:', error);
    }
})();