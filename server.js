require('dotenv').config();
const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const { Queue, Worker, QueueScheduler } = require('bullmq');
const Redis = require('ioredis');
const { google } = require('googleapis');
const cron = require('node-cron');
//const qrcode = require('qrcode-terminal');
const FirebaseWWebJS = require('./firebaseWweb.js');
const qrcode = require('qrcode');
const express = require('express');
const bodyParser = require('body-parser');
const csv = require('csv-parser');
const fetch = require('node-fetch');
const cors = require('cors');
const app = express();
const admin = require('./firebase.js');
const axios = require('axios');
const WebSocket = require('ws');
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });
const db = admin.firestore();
db.settings({
  ignoreUndefinedProperties: true,
  timestampsInSnapshots: true
});
const OpenAI = require('openai');
const { MessageMedia } = require('whatsapp-web.js');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const util = require('util');  // We'll use this to promisify fs functions
const path = require('path');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline)
const os = require('os');
const { exec } = require('child_process');
const url = require('url');
const ffmpeg = require('ffmpeg-static');
const execPromise = util.promisify(exec);
const CryptoJS = require("crypto-js");
const AutomatedMessaging = require('./blast/automatedMessaging');
const qrcodeTerminal = require('qrcode-terminal');
const schedule = require('node-schedule');
// Add this near the top of the file, after your require statements
require('events').EventEmitter.defaultMaxListeners = 200;  // Increase from 70
require('events').EventEmitter.prototype._maxListeners = 200;  // Increase from 70
require('events').defaultMaxListeners = 200;  // Increase from 70
process.setMaxListeners(200);


const botMap = new Map();
// Redis connection
const connection = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
  maxRetriesPerRequest: null,
  maxmemoryPolicy: 'noeviction'
});
const openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
});

// Initialize the Google Sheets API
const auth = new google.auth.GoogleAuth({
  keyFile: 'service_account.json', // Replace with the path to your Google API credentials file
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });


// Promisify the fs.readFile and fs.writeFile functions
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

//Save last processed row
const LAST_PROCESSED_ROW_FILE = 'last_processed_row.json';

// Create a queue
const messageQueue = new Queue('scheduled-messages', { connection });

// Ensure this directory exists in your project
const MEDIA_DIR = path.join(__dirname, 'public', 'media');

// Function to save media locally
async function saveMediaLocally(base64Data, mimeType, filename) {
  const writeFileAsync = util.promisify(fs.writeFile);
  const buffer = Buffer.from(base64Data, 'base64');
  const uniqueFilename = `${uuidv4()}_${filename}`;
  const filePath = path.join(MEDIA_DIR, uniqueFilename);

  await writeFileAsync(filePath, buffer);

  // Return the URL path to access this filez
  return `/media/${uniqueFilename}`;
}


wss.on('connection', (ws, req) => {
  const { pathname } = url.parse(req.url);
  ws.isLogsViewer = req.url === '/logs';
  if (pathname === '/status') {
    // Send initial status for all bots
    for (const [botName, botData] of botMap.entries()) {
      if (Array.isArray(botData)) {
        // Multiple phones
        botData.forEach((data, index) => {
          ws.send(JSON.stringify({
            type: 'status_update',
            botName,
            phoneIndex: index,
            status: data.status,
            qrCode: data.qrCode
          }));
        });
      } else {
        // Single phone
        ws.send(JSON.stringify({
          type: 'status_update',
          botName,
          status: botData.status,
          qrCode: botData.qrCode
        }));
      }
    }
  }
  if (pathname === '/logs') {
    //console.log('Logs client connected');

    // Override console methods to capture and broadcast logs
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info
    };

    // Function to broadcast log messages
    const broadcastLog = (type, args) => {
      if (ws.readyState === WebSocket.OPEN) {
        let message;
        // Special handling for errors to preserve stack trace
        if (args[0] instanceof Error) {
          message = args[0].stack || args[0].toString();
        } else if (args.length === 2 && args[1] instanceof Error) {
          // Handle cases like console.error('Error message:', error)
          message = `${args[0]} ${args[1].stack || args[1].toString()}`;
        } else {
          message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
          ).join(' ');
        }

        ws.send(JSON.stringify({
          type: 'log',
          logType: type,
          data: message
        }));
      }
    };

    // Override console methods
    console.log = (...args) => {
      originalConsole.log(...args);
      broadcastLog('info', args);
    };

    console.error = (...args) => {
      originalConsole.error(...args);
      broadcastLog('error', args);
    };

    console.warn = (...args) => {
      originalConsole.warn(...args);
      broadcastLog('warn', args);
    };

    console.info = (...args) => {
      originalConsole.info(...args);
      broadcastLog('info', args);
    };
    // Handle messages from client
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'deleteSessions') {
          if (data.password === 'P@ssw0rd') {
            try {
              // Track affected companies and their phone counts
              const affectedCompanies = new Map(); // Map<companyId, phoneCount>

              // Stop all WhatsApp clients for the selected sessions
              for (const session of data.sessions) {
                // Extract company ID and phone number from session name
                const match = session.match(/^(\d+)(?:_phone(\d+))?$/);
                if (match) {
                  const companyId = match[1];
                  const phoneNumber = match[2] ? parseInt(match[2]) : 1;

                  // Update the maximum phone count for this company
                  if (!affectedCompanies.has(companyId)) {
                    affectedCompanies.set(companyId, phoneNumber);
                  } else {
                    affectedCompanies.set(companyId, Math.max(affectedCompanies.get(companyId), phoneNumber));
                  }

                  // Destroy the client if it exists
                  if (botMap.has(companyId)) {
                    const botData = botMap.get(companyId);
                    for (const bot of botData) {
                      if (bot.client) {
                        try {
                          await bot.client.destroy();
                          console.log(`Destroyed client for company ${companyId}, session ${session}`);
                        } catch (err) {
                          console.error(`Error destroying client for company ${companyId}, session ${session}:`, err);
                        }
                      }
                    }
                    // Clear the bot data from the map
                    botMap.delete(companyId);
                  }
                }
              }

              // Wait for clients to fully close
              await new Promise(resolve => setTimeout(resolve, 3000));

              // Delete all selected sessions with retry mechanism
              const results = [];
              for (const session of data.sessions) {
                try {
                  const sessionPath = path.join(__dirname, '.wwebjs_auth', 'session-' + session);
                  await deleteWithRetry(sessionPath);
                  results.push(`Session ${session} deleted successfully`);
                } catch (err) {
                  results.push(`Failed to delete session ${session}: ${err.message}`);
                }
              }

              // Wait a bit more before reinitializing
              await new Promise(resolve => setTimeout(resolve, 3000));

              // Reinitialize affected companies one by one
              for (const [companyId, phoneCount] of affectedCompanies) {
                try {
                  console.log(`Reinitializing bot ${companyId} with ${phoneCount} phone(s)...`);

                  // Make sure the company is removed from botMap
                  if (botMap.has(companyId)) {
                    botMap.delete(companyId);
                  }

                  // Wait a bit between each initialization
                  await new Promise(resolve => setTimeout(resolve, 2000));

                  await initializeBot(companyId, phoneCount);
                  results.push(`Reinitialized bot ${companyId} successfully`);
                } catch (err) {
                  console.error(`Error reinitializing bot ${companyId}:`, err);
                  results.push(`Failed to reinitialize bot ${companyId}: ${err.message}`);
                }
              }

              ws.send(JSON.stringify({
                type: 'sessionsDeleted',
                success: true,
                message: `${results.join('\n')}`
              }));
            } catch (error) {
              ws.send(JSON.stringify({
                type: 'sessionsDeleted',
                success: false,
                message: 'Error during session deletion process: ' + error.message
              }));
            }
          } else {
            ws.send(JSON.stringify({
              type: 'sessionsDeleted',
              success: false,
              message: 'Invalid password'
            }));
          }
        }
        //Restart server
        if (data.type === 'restart') {
          // if (data.password === 'P@ssw0rd') {
          //   try {

          //     // Check for git changes
          //     const { stdout: statusOutput } = await execPromise('git status --porcelain');

          //     // Check if there are any remote changes
          //     await execPromise('git fetch');
          //     const { stdout: diffOutput } = await execPromise('git diff HEAD origin/main --name-only');

          //     if (statusOutput.trim() !== '') {
          //       console.log('Local changes detected, stashing changes...');
          //       ws.send(JSON.stringify({
          //         type: 'restart',
          //         success: true,
          //         message: 'Local changes detected, stashing changes...'
          //       }));

          //       // Stash local changes
          //       await execPromise('git stash');
          //     }

          //     if (diffOutput.trim() !== '') {
          //       // Changes detected, perform git pull
          //       console.log('Updates detected, pulling changes...');
          //       ws.send(JSON.stringify({
          //         type: 'restart',
          //         success: true,
          //         message: 'Updates detected, pulling changes...'
          //       }));

          //       await execPromise('git pull origin main');
          //       console.log('Pull completed successfully');
          //     } else {
          //       console.log('No updates available');
          //       ws.send(JSON.stringify({
          //         type: 'restart',
          //         success: true,
          //         message: 'No updates available'
          //       }));
          //     }

          //     // If we stashed changes earlier, pop them back
          //     if (statusOutput.trim() !== '') {
          //       console.log('Restoring local changes...');
          //       ws.send(JSON.stringify({
          //         type: 'restart',
          //         success: true,
          //         message: 'Restoring local changes...'
          //       }));

          //       await execPromise('git stash pop');
          //     }

          //     // Restart the server
          //     console.log('Restarting server...');
          //     exec('pm2 restart server.js', (error, stdout, stderr) => {
          //       if (error) {
          //         ws.send(JSON.stringify({
          //           type: 'restart',
          //           success: false,
          //           message: 'Restart failed: ' + error.message
          //         }));
          //         return;
          //       }
          //       ws.send(JSON.stringify({
          //         type: 'restart',
          //         success: true,
          //         message: 'Server restart initiated successfully'
          //       }));
          //     });

          //   } catch (error) {
          //     console.error('Error during git operations:', error);
          //     ws.send(JSON.stringify({
          //       type: 'restart',
          //       success: false,
          //       message: 'Error during git operations: ' + error.message
          //     }));
          //   }
          // } else {
          //   ws.send(JSON.stringify({
          //     type: 'restart',
          //     success: false,
          //     message: 'Invalid password'
          //   }));
          // }
          ws.send(JSON.stringify({
            type: 'restart',
            success: false,
            message: 'Do not restart here.'
          }));
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });
    ws.on('close', () => {
      console.log('Logs client disconnected');
      // Restore original console methods when client disconnects
      console.log = originalConsole.log;
      console.error = originalConsole.error;
      console.warn = originalConsole.warn;
      console.info = originalConsole.info;
    });
  } else {
    // Handle existing chat/company connections
    const [, , email, companyId] = pathname.split('/');
    ws.companyId = companyId;
    console.log('client connected:' + ws.companyId);

    ws.on('close', () => {
      console.log('Client disconnected');
    });
  }
});
// Add this helper function for retrying deletion
async function deleteWithRetry(path, maxRetries = 5, delayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Use rimraf command through cmd for Windows
      if (process.platform === 'win32') {
        await execPromise(`rmdir /s /q "${path}"`);
      } else {
        await fs.promises.rm(path, { recursive: true, force: true });
      }
      return; // Success
    } catch (error) {
      if (i === maxRetries - 1) {
        // If this was the last retry, throw the error
        throw error;
      }
      console.log(`Retry ${i + 1}/${maxRetries} for deleting ${path}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
app.get('/api/lalamove/quote', async (req, res) => {
  res.header('Access-Control-Allow-Origin', 'https://storeguru.com.my');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  try {
    // Get parameters from request
    const {
      user_latitude,
      user_longitude,
      pickup_street,
      pickup_city,
      pickup_state,
      pickup_postcode,
      store_location,
      vehicle_type,
      manpower = 'false' // New parameter, defaults to false
    } = req.query;

    // Map vehicle types to Lalamove service types
    const vehicleServiceMap = {
      'van': 'VAN',
      '1ton': 'TRUCK330',
      '3ton': 'TRUCK550',
      '5ton': 'TRUCK550'
    };
    console.log(vehicle_type);
    // Validate vehicle type
    const serviceType = vehicleServiceMap[vehicle_type?.toLowerCase()];
    if (!serviceType) {
      console.log('Invalid vehicle type:', vehicle_type);
      throw new Error('Invalid vehicle type');
    }

    // Determine special requests based on services selected
    const specialRequests = [];

    // Add appropriate manpower service
    const isManpower = manpower === 'true';
    if (isManpower) {
      if (serviceType === 'TRUCK330' || serviceType === 'TRUCK550') {
        // For trucks, manpower includes driver + 2 helpers
        specialRequests.push('DOOR_TO_DOOR_1DRIVER2HELPER');
        if (pickup_city.toLowerCase().includes('kuala lumpur')) {
          specialRequests.push('HOUSE_MOVING');
        }
      } else {
        // For vans, manpower includes driver + helper
        specialRequests.push('DOOR_TO_DOOR_1DRIVER1HELPER');
      }
    }

    // Add tailboard for all truck types
    if (serviceType === 'TRUCK330' || serviceType === 'TRUCK550') {
      specialRequests.push('TAILBOARD_VEHICLE');
    }

    // Validate required parameters
    if (!user_latitude || !user_longitude || !pickup_street) {
      console.log('Missing required parameters');
      throw new Error('Missing required parameters');
    }

    // Validate coordinate format
    const lat = parseFloat(user_latitude);
    const lng = parseFloat(user_longitude);
    if (isNaN(lat) || isNaN(lng)) {
      console.log('Invalid coordinates format');
      throw new Error('Invalid coordinates format');
    }

    // Store location coordinates mapping
    const storeCoordinates = {
      sentul: { lat: "3.173640", lng: "101.692897" },
      subang: { lat: "3.157191", lng: "101.544504" },
      nilai: { lat: "2.848007", lng: "101.805015" },
      gelang_patah: { lat: "1.371682", lng: "103.57636" },
      bayan_lepas: { lat: "5.315488", lng: "100.266468" },
      kuantan: { lat: "3.840118", lng: "103.289275" }
    };

    if (!storeCoordinates[store_location]) {
      console.log('Invalid store location:', store_location);
      throw new Error('Invalid store location');
    }
    const destinationCoords = storeCoordinates[store_location];

    // Lalamove API credentials
    const API_KEY = 'pk_test_293d571c2c2d519583326617750761e8';
    const SECRET = "sk_test_On8eL9w6N7hJBweWocmozS/KBWr9FBOsuAJsDWG2xeINEzMTo55mst2h2qEQas4u";
    const LALAMOVE_BASE_URL = "https://rest.sandbox.lalamove.com";

    const time = new Date().getTime().toString();
    const method = "POST";
    const path = "/v3/quotations";

    const requestBody = {
      data: {
        serviceType: serviceType,
        specialRequests: specialRequests,
        language: "en_MY",
        stops: [
          {
            coordinates: {
              lat: lat.toString(),
              lng: lng.toString()
            },
            address: `${pickup_street}, ${pickup_city}, ${pickup_state} ${pickup_postcode}, Malaysia`
          },
          {
            coordinates: {
              lat: destinationCoords.lat,
              lng: destinationCoords.lng
            },
            address: `${store_location.charAt(0).toUpperCase() + store_location.slice(1)} Storage Facility, Malaysia`
          }
        ]
      }
    };

    console.log('Request Configuration:');
    console.log('- Vehicle Type:', vehicle_type);
    if (serviceType === 'TRUCK330' || serviceType === 'TRUCK550') {
      console.log('- Manpower:', isManpower ? 'Driver + 2 Helpers' : 'Driver Only');
    } else {
      console.log('- Manpower:', isManpower ? 'Driver + Helper' : 'No Manpower');
    }
    console.log('- Special Requests Applied:', specialRequests);
    console.log('\nRequest body:', JSON.stringify(requestBody, null, 2));

    const rawSignature = `${time}\r\n${method}\r\n${path}\r\n\r\n${JSON.stringify(requestBody)}`;
    const signature = CryptoJS.HmacSHA256(rawSignature, SECRET).toString();

    console.log('Making request to Lalamove API...');
    const response = await axios.post(
      `${LALAMOVE_BASE_URL}${path}`,
      requestBody,
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `hmac ${API_KEY}:${time}:${signature}`,
          Accept: "application/json",
          Market: "MY",
        },
      }
    );

    console.log('Lalamove API response:', response.data);

    res.json({
      success: true,
      data: {
        totalFee: {
          amount: response.data.data.priceBreakdown.total,
          currency: "MYR"
        }
      }
    });

  } catch (error) {
    console.error('Lalamove API Error:', error);
    if (error.response) {
      console.error('Error response data:', error.response.data);
    }
    res.json({
      success: true,
      data: {
        totalFee: {
          amount: "0.00",
          currency: "MYR"
        }
      }
    });
  }
});
app.get('/api/cleanup-scheduled', async (req, res) => {
  try {
    const deletedMessages = [];
    const errors = [];

    // Get all companies
    const companiesSnapshot = await db.collection('companies').get();

    for (const companyDoc of companiesSnapshot.docs) {
      const companyId = companyDoc.id;

      // Skip if companyId is invalid
      if (!companyId || typeof companyId !== 'string') {
        console.log('Skipping invalid companyId:', companyId);
        continue;
      }

      try {
        // Get all contacts and their tags for this company
        const contactsSnapshot = await db.collection('companies')
          .doc(companyId)
          .collection('contacts')
          .get();

        // Create a set of all tags from all contacts
        const allContactTags = new Set();
        contactsSnapshot.docs.forEach(doc => {
          const contactTags = doc.data()?.tags || [];
          contactTags.forEach(tag => {
            if (tag && typeof tag === 'string') {
              allContactTags.add(tag);
            }
          });
        });

        // Get the company's scheduled messages
        const scheduledMessagesSnapshot = await db.collection('companies')
          .doc(companyId)
          .collection('scheduledMessages')
          .get();

        for (const messageDoc of scheduledMessagesSnapshot.docs) {
          const messageId = messageDoc.id;
          const message = messageDoc.data();

          // Check if message's trigger tags exist in any contact's tags
          const messageTriggerTags = message?.triggerTags || [];
          const hasMatchingTag = messageTriggerTags.some(tag =>
            tag && typeof tag === 'string' && allContactTags.has(tag)
          );

          // If no contact has any of the message's trigger tags, delete the message
          if (!hasMatchingTag) {
            try {
              // Remove jobs from the queue
              const jobs = await messageQueue.getJobs(['active', 'waiting', 'delayed', 'paused']);
              for (const job of jobs) {
                if (job.id.startsWith(messageId)) {
                  await job.remove();
                }
              }

              // Delete batches
              const batchesSnapshot = await messageDoc.ref.collection('batches').get();
              const batch = db.batch();
              batchesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
              batch.delete(messageDoc.ref);
              await batch.commit();

              deletedMessages.push({
                companyId,
                messageId,
                triggerTags: messageTriggerTags,
                scheduledTime: message.scheduledTime?.toDate()
              });
            } catch (error) {
              errors.push({
                companyId,
                messageId,
                triggerTags: messageTriggerTags,
                error: error.message
              });
            }
          }
        }
      } catch (companyError) {
        errors.push({
          companyId,
          error: `Error processing company: ${companyError.message}`
        });
        continue; // Skip to next company if there's an error
      }
    }

    res.json({
      success: true,
      deletedCount: deletedMessages.length,
      deletedMessages,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error cleaning up scheduled messages:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const authPath = path.join(__dirname, '.wwebjs_auth');
    const sessions = await fs.promises.readdir(authPath);
    const sessionNames = sessions
      .filter(name => name.startsWith('session-'))
      .map(name => name.replace('session-', ''));
    res.json(sessionNames);
  } catch (error) {
    console.error('Error reading sessions:', error);
    res.status(500).json({ error: 'Failed to read sessions' });
  }
});
function broadcastProgress(botName, action, progress, phoneIndex) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.companyId === botName) {
      client.send(JSON.stringify({
        type: 'progress',
        botName,
        action,
        progress,
        phoneIndex
      }));
    }
  });
}

const botStatusMap = new Map();
function broadcastAuthStatus(botName, status, qrCode = null, i = 0) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // Check the client's URL using the pathname property we set during connection
      if (client.pathname === '/status') {
        // Send to status monitor clients
        client.send(JSON.stringify({
          type: 'status_update',
          botName,
          status,
          qrCode: status === 'qr' ? qrCode : null,
          phoneIndex: i
        }));
      } else if (client.companyId === botName) {
        // Send to specific company clients
        client.send(JSON.stringify({
          type: 'auth_status',
          botName,
          status,
          qrCode: status === 'qr' ? qrCode : null,
          phoneIndex: i
        }));
      }
    }
  });
  botStatusMap.set(botName, status);
}




const { handleNewMessagesGL } = require('./bots/handleMessagesGL.js');
const { handleNewMessagesArul } = require('./bots/handleMessagesArul.js');
const { handleNewMessages } = require('./bots/handleMessages.js');
const { handleNewMessagesJuta } = require('./bots/handleMessagesJuta.js');
const { handleNewMessagesCallabio } = require('./bots/handleMessagesCallabio.js');
const { handleNewMessagesAQ } = require('./bots/handleMessagesAQ.js');
const { handleNewMessagesTIC } = require('./bots/handleMessagesTIC.js');
const { handleNewMessagesDemo } = require('./bots/handleMessagesDemo.js');
const { handleNewMessagesMadre } = require('./bots/handleMessagesMadre.js');
const { handleNewMessagesBeverly } = require('./bots/handleMessagesBeverly.js');
const { handleNewEnquriryFormBeverly } = require('./bots/handleMessagesBeverly.js');
const { handleNewMessagesSunz } = require('./bots/handleMessagesSunz.js');
const { handleNewMessagesBHQ } = require('./bots/handleMessagesBHQ.js');
const { handleNewMessagesTasty } = require('./bots/handleMessagesTasty.js');
const { handleNewMessagesTastyPuga } = require('./bots/handleMessagesPugaTasty.js');
const { handleNewMessagesBillert } = require('./bots/handleMessagesBillert.js');
const { handleNewMessagesCNB } = require('./bots/handleMessagesCNB.js');
const { handleNewMessagesMSU } = require('./bots/handleMessagesMSU.js');
const { handleNewMessagesApel } = require('./bots/handleMessagesApel.js');
const { handleNewMessagesTemplate } = require('./bots/handleMessagesTemplate.js');
const { handleNewMessagesTemplateWweb } = require('./bots/handleMessagesTemplateWweb.js');
const { handleNewMessagesZahinTravel } = require('./bots/handleMessagesZahinTravel.js');
const { handleNewMessagesJuta2 } = require('./bots/handleMessagesJuta2.js');
const { handleNewMessagesTest } = require('./bots/handleMessagesTest.js');
const { handleNewMessagesFirstPrint } = require('./bots/handleMessagesFirstPrint.js');
const { handleNewMessagesExtremeFitness } = require('./bots/handleMessagesExtremeFitness.js');
const { handleExtremeFitnessBlast } = require('./blast/extremeFitnessBlast.js');
const { handleHajoonCreateContact } = require('./blast/hajoonCreateContact.js');
const { handleZakatBlast } = require('./blast/zakatBlast.js');
const { handleJutaCreateContact } = require('./blast/jutaCreateContact.js');
const { handleNewMessagesVista } = require('./bots/handleMessagesVista.js');
const { handleNewMessagesHappyProjects } = require('./bots/handleMessagesHappyProjects.js');
const { handleNewMessagesBINA } = require('./bots/handleMessagesBINA.js');
const { handleBinaTag } = require('./blast/binaTag.js');
const { handleTagFollowUp } = require('./blast/tag.js');
const { handleNewMessagesMaha } = require('./bots/handleMessagesMaha.js');
const { handleNewMessagesMuhibbah } = require('./bots/handleMessagesMuhibbah.js');
const { handleNewMessagesNewTown } = require('./bots/handleMessagesNewTown.js');
const { handleNewMessagesDMAI } = require('./bots/handleMessagesDMAI.js');
const { handleNewMessagesEdward } = require('./bots/handleMessagesEdward.js');
const { handleEdwardTag } = require('./blast/edwardTag.js');
const { handleNewMessagesEduVille } = require('./bots/handleMessagesEduville.js');
const { handleNewMessagesAlist } = require('./bots/handleMessagesAList.js');
const { handleNewMessagesAlist2 } = require('./bots/handleMessagesAList2.js');
const { handleNewMessagesAlist3 } = require('./bots/handleMessagesAList3.js');
const { handleNewMessagesAlist4 } = require('./bots/handleMessagesAList4.js');
const { handleNewMessagesAlist5 } = require('./bots/handleMessagesAList5.js');
const { handleNewMessagesSSPower } = require('./bots/handleMessagesSSPower.js');
const { handleNewMessagesRasniaga } = require('./bots/handleMessagesRasniaga.js');
const { handleNewMessagesNTRM } = require('./bots/handleMessagesNTRM.js');
const { handleNewMessagesHartaland } = require('./bots/handleMessagesHartaland.js');
const { handleNewMessagesParty8 } = require('./bots/handleMessagesParty8.js');
const { handleNewMessagesLKSSB } = require('./bots/handleMessagesLKSSB.js');
const { handleNewMessagesPlayAgent } = require('./bots/handleMessagesPlayAgent.js');
const { handleNewMessagesMiko } = require('./bots/handleMessagesMiko.js');
const { handleNewMessagesYara } = require('./bots/handleMessagesYara.js');
const { handleNewMessagesHajoon } = require('./bots/handleMessagesHajoon.js');
const { scheduleFollowUpChecker } = require('./schedulers/followUpChecker.js');
const { handleNewMessagesRevotrend } = require('./bots/handleMessagesRevotrend.js');
const { handleConstantCoCreateContact } = require('./blast/constantCoCreateContact.js');
const { handleZahinHubspot } = require('./blast/zahinHubspot.js');



// Set JSON body parser with a limit
app.use(express.json({ limit: '50mb' }));

// Create a CORS configuration object
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://storeguru.com.my',
      'https://web.jutasoftware.co',
      'https://dmaimedia.vercel.app',
      'https://zakat-selangor.vercel.app',
      'https://zakat-pulau-pinang.vercel.app',
      'https://app.omniyal.com',
      'https://www.zahintravel.chat',
      'http://localhost:3000',
      'http://localhost:5173',
      'https://addbigspace.com',
      'https://addbigspace.com/',
      'https://www.addbigspace.com/',
      'https://theshipguru.com',
      'https://theshipguru.com/',
      'https://www.theshipguru.com/',
      'https://www.bookingcarcare.com/',
      'https://www.bookingcarcare.com',
      'https://app.wassapbot.com/',
      'https://app.wassapbot.com',
      'https://app.xyzaibot.com',
      'https://app.xyzaibot.com',
    ];

    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('.ngrok.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle OPTIONS preflight for all routes
app.options('', cors(corsOptions));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve static files from the 'public' directory
app.use(express.static('public'));

app.get('/', function (req, res) {
  res.send('Bot is running');
});

app.get('/logs', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'logs.html'));
});
app.get('/status', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'status.html'));
});
app.get('/queue', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'queue.html'));
});
app.post('/juta/hook/messages', handleNewMessagesJuta);
app.post('/arul/hook/messages', handleNewMessagesArul);
app.post('/aq/hook/messages', handleNewMessagesAQ);
app.post('/tic/hook/messages', handleNewMessagesTIC);
app.post('/tasty/hook/messages', handleNewMessagesTasty);
app.post('/tasty-puga/hook', handleNewMessagesTastyPuga);
app.post('/gl/hook', handleNewMessagesGL);
app.post('/gl', handleNewMessages)
app.post('/demo/hook/messages', handleNewMessagesDemo);
app.post('/callabios/hook/messages', handleNewMessagesCallabio);
app.post('/madre/hook/messages', handleNewMessagesMadre);
app.post('/beverly/hook/messages', handleNewMessagesBeverly);
app.post('/beverly/enquriry', handleNewEnquriryFormBeverly);
app.post('/sunz/hook/messages', handleNewMessagesSunz);
app.post('/bhq/hook/messages', handleNewMessagesBHQ);
app.post('/msu/hook/messages', handleNewMessagesMSU);
app.post('/apel/hook/messages', handleNewMessagesApel);
app.post('/:companyID/template/hook/messages', handleNewMessagesTemplate);


//webhooks/blast
app.post('/extremefitness/blast', async (req, res) => {
  const botData = botMap.get('074');

  if (!botData) {
    return res.status(404).json({ error: 'WhatsApp client not found for this company' });
  }

  const client = botData[0].client;
  await handleExtremeFitnessBlast(req, res, client);
});
app.post('/hajoon/blast', async (req, res) => {
  const botData = botMap.get('045');

  if (!botData) {
    return res.status(404).json({ error: 'WhatsApp client not found for this company' });
  }

  const client = botData[0].client;
  await handleHajoonCreateContact(req, res, client);
});
app.post('/juta/blast', async (req, res) => {
  const botData = botMap.get('001');

  if (!botData) {
    return res.status(404).json({ error: 'WhatsApp client not found for this company' });
  }

  const client = botData[0].client;
  await handleJutaCreateContact(req, res, client);
});

app.post('/constantco/blast', async (req, res) => {
  const botData = botMap.get('0148');

  if (!botData) {
    return res.status(404).json({ error: 'WhatsApp client not found for this company' });
  }

  const client = botData[0].client;
  await handleConstantCoCreateContact(req, res, client);
});

app.post('/zahin/hubspot', async (req, res) => {
  const getClient = () => {
    const botData = botMap.get('042');
    return botData ? botData[0].client : null;
  };
  handleZahinHubspot(req, res, getClient);
});

app.post('/api/bina/tag', async (req, res) => {
  await handleBinaTag(req, res);
});
app.post('/api/edward/tag', async (req, res) => {
  await handleEdwardTag(req, res);
});
app.post('/api/tag/followup', async (req, res) => {
  await handleTagFollowUp(req, res);
});

//spreadsheet
const msuSpreadsheet = require('./spreadsheet/msuspreadsheet.js');

// const applyRadarSpreadsheetLPUniten = require('./spreadsheet/applyradarspreadsheet(LP - UNITEN).js');
// const applyRadarSpreadsheetLPUnitenPK = require('./spreadsheet/applyradarspreadsheet(LP - UNITEN PK).js');
// const applyRadarSpreadsheetLPMMUPK = require('./spreadsheet/applyradarspreadsheet(LP - MMU PK).js');
// const applyRadarSpreadsheetLPAPUPK = require('./spreadsheet/applyradarspreadsheet(LP - APU PK).js');
const msuSpreadsheetPartTime = require('./spreadsheet/msuspreadsheet(PartTime).js');
// const msuSpreadsheetApel = require('./spreadsheet/msuspreadsheet(Apel).js');
const msuSpreadsheetCOL = require('./spreadsheet/msuspreadsheet(COL).js');
const msuSpreadsheetLeads = require('./spreadsheet/msuspreadsheet(Leads).js');
const bhqSpreadsheet = require('./spreadsheet/bhqspreadsheet.js');
const mtdcSpreadsheet = require('./spreadsheet/mtdcSpreadsheet.js');
const SKCSpreadsheet = require('./spreadsheet/SKCSpreadsheet.js');
const constantcoSpreadsheet = require('./spreadsheet/constantcoSpreadsheet.js');
const party8SpreadsheetWelcomeBirthdayMonth = require('./spreadsheet/party8Spreadsheet(welcome-birthdaymonth).js');
const party8SpreadsheetSuccessOrder = require('./spreadsheet/party8Spreadsheet(success-order).js');
const appointmentWatcher = require('./automations/appointmentWatcher.js');
const bookingCarCare = require('./blast/bookingCarCareGroup');



//custom bots
const customHandlers = {
  '003': handleNewMessagesVista,
  '042': handleNewMessagesZahinTravel,
  '044': handleNewMessagesApel,
  '057': handleNewMessagesTest,
  '059': handleNewMessagesFirstPrint,
  '066': handleNewMessagesMSU,
  '072': handleNewMessagesBillert,
  '067': handleNewMessagesMuhibbah,
  '081': handleNewMessagesDMAI,
  '088': handleNewMessagesNewTown,
  '093': handleNewMessagesEdward,

  '0100': handleNewMessagesSSPower,
  '0102': handleNewMessagesRasniaga,
  '094': handleNewMessagesHartaland,
  '075': handleNewMessagesBHQ,
  '0108': handleNewMessagesParty8,
  '0115': handleNewMessagesPlayAgent,
  '0112': handleNewMessagesMiko,
  '0146': handleNewMessagesYara,
  '045': handleNewMessagesHajoon,
  '0123': handleNewMessagesRevotrend,
  '0124': handleNewMessagesJuta2,
};

app.post('/bookingCarCare/booking', async (req, res) => {
  const carCareSpreadsheet = new bookingCarCare(botMap);
  await carCareSpreadsheet.handleBookingCarCareCreateGroup(req, res);
});

const port = process.env.PORT;
server.listen(port, function () {
  console.log(`Server is running on port ${port}`);
});
app.post('/zakat', async (req, res) => {
  try {
    // Your existing logging code...
    //console.log('=== New Zakat Form Submission ===');
    // console.log('Webhook Body:', JSON.stringify(req.body, null, 2));

    // Get the WhatsApp client
    const botData = botMap.get('0124'); // Make sure you have initialized this bot
    if (!botData) {
      throw new Error('WhatsApp client not found for zakat');
    }
    const client = botData[0].client;

    // Handle the blast message
    await handleZakatBlast(req, res, client);

  } catch (error) {
    console.error('Error processing zakat form:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const dailyReportCrons = new Map();

app.post('/api/daily-report/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const { enabled, time, groupId } = req.body;

  try {
    const settingsRef = db.collection('companies').doc(companyId).collection('settings').doc('reporting');

    if (enabled) {
      if (!time || !groupId) {
        return res.status(400).json({
          success: false,
          error: 'Time and groupId are required when enabling reports'
        });
      }

      await settingsRef.set({
        dailyReport: {
          enabled: true,
          time,
          groupId,
          lastRun: null
        }
      }, { merge: true });

      // Stop existing cron if running for this company
      if (dailyReportCrons.has(companyId)) {
        dailyReportCrons.get(companyId).stop();
      }

      // Start new cron job for this company
      const [hour, minute] = time.split(':');
      const newCron = cron.schedule(`${minute} ${hour} * * *`, async () => {
        try {
          const botData = botMap.get(companyId);
          if (!botData || !botData[0]?.client) {
            console.error(`No WhatsApp client found for company ${companyId}`);
            return;
          }

          const count = await countTodayLeads(companyId);
          const message = `📊 Daily Lead Report\n\nNew Leads Today: ${count}\nDate: ${new Date().toLocaleDateString()}`;

          await botData[0].client.sendMessage(groupId, message);

          // Update last run time
          await settingsRef.update({
            'dailyReport.lastRun': admin.firestore.FieldValue.serverTimestamp()
          });
        } catch (error) {
          console.error(`Error sending daily report for company ${companyId}:`, error);
        }
      });

      // Store the new cron job
      dailyReportCrons.set(companyId, newCron);

      res.json({
        success: true,
        message: 'Daily report enabled',
        nextRun: `${hour}:${minute}`
      });

    } else {
      // Disable reporting for this company
      if (dailyReportCrons.has(companyId)) {
        dailyReportCrons.get(companyId).stop();
        dailyReportCrons.delete(companyId);
      }

      await settingsRef.set({
        dailyReport: {
          enabled: false,
          time: null,
          groupId: null
        }
      }, { merge: true });

      res.json({
        success: true,
        message: 'Daily report disabled'
      });
    }

  } catch (error) {
    console.error(`Error managing daily report for company ${companyId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to count today's leads
async function countTodayLeads(companyId) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const contactsRef = db.collection('companies').doc(companyId).collection('contacts');
    const snapshot = await contactsRef
      .where('createdAt', '>=', today)
      .get();

    return snapshot.size;
  } catch (error) {
    console.error('Error counting leads:', error);
    return 0;
  }
}
app.get('/api/check-constantco-spreadsheet', async (req, res) => {
  try {
    // Get the spreadsheet handler instance
    const constantcoSpreadsheet = require('./spreadsheet/constantcoSpreadsheet');
    const spreadsheetHandler = new constantcoSpreadsheet(botMap);

    // Run the check
    await spreadsheetHandler.checkAndProcessNewRows();

    res.json({
      success: true,
      message: 'Spreadsheet check triggered successfully'
    });
  } catch (error) {
    console.error('Error triggering spreadsheet check:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Add this endpoint to manually trigger a report
app.post('/api/daily-report/:companyId/trigger', async (req, res) => {
  const { companyId } = req.params;

  try {
    const settingsRef = db.collection('companies').doc(companyId).collection('settings').doc('reporting');
    const settings = await settingsRef.get();

    if (!settings.exists || !settings.data()?.dailyReport?.enabled) {
      return res.status(400).json({
        success: false,
        error: 'Daily reporting is not enabled for this company'
      });
    }

    const { groupId } = settings.data().dailyReport;
    const botData = botMap.get(companyId);

    if (!botData || !botData[0]?.client) {
      throw new Error('WhatsApp client not found');
    }

    const count = await countTodayLeads(companyId);
    const message = `📊 Daily Lead Report (Manual Trigger)\n\nNew Leads Today: ${count}\nDate: ${new Date().toLocaleDateString()}`;

    await botData[0].client.sendMessage(groupId, message);

    res.json({
      success: true,
      message: 'Report triggered successfully',
      count
    });

  } catch (error) {
    console.error('Error triggering daily report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
async function createUserInFirebase(userData) {
  try {
    const userRecord = await admin.auth().createUser(userData);

    return userRecord.uid;
  } catch (error) {

    throw error;
  }
}
app.get('/assignments', async (req, res) => {
  try {
    const companyId = '072';

    // Calculate yesterday's date range
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    // Get all assignments from yesterday
    const assignmentsRef = db.collection('companies')
      .doc(companyId)
      .collection('assignments')
      .where('timestamp', '>=', yesterday)
      .where('timestamp', '<=', endOfYesterday);

    const assignmentsSnapshot = await assignmentsRef.get();

    // Count assignments per employee
    const employeeAssignments = {};

    assignmentsSnapshot.forEach(doc => {
      const data = doc.data();
      const employeeName = data.assigned;

      if (!employeeAssignments[employeeName]) {
        employeeAssignments[employeeName] = {
          count: 0,
          email: data.email || null,
          numbers: []
        };
      }

      employeeAssignments[employeeName].count++;
      employeeAssignments[employeeName].numbers.push(data.number);
    });

    // Format the response
    const response = Object.entries(employeeAssignments).map(([name, data]) => ({
      name,
      email: data.email,
      assignmentCount: data.count,
      numbers: data.numbers
    }));

    res.json({
      success: true,
      date: yesterday.toISOString().split('T')[0],
      totalAssignments: assignmentsSnapshot.size,
      assignments: response
    });

  } catch (error) {
    console.error('Error fetching assignment counts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assignment counts',
      message: error.message
    });
  }
});
app.get('/api/facebook-lead-webhook', (req, res) => {
  const VERIFY_TOKEN = 'test'; // Use the token you entered in the Facebook dashboard

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      // console.log('Webhook verified');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(404);
  }
});
app.put('/api/update-user', async (req, res) => {
  try {
    const { uid, email, phoneNumber, password, displayName } = req.body;
    const user = await admin.auth().getUserByEmail(uid);
    if (!uid) {
      return res.status(400).json({ error: 'UID is required' });
    }

    // Call the function to update the user

    await admin.auth().updateUser(user.uid, {
      email: email,
      phoneNumber: phoneNumber,
      password: password,
      displayName: displayName,
    });

    // Send success response
    res.json({ message: 'User updated successfully' });
  } catch (error) {
    // Handle other errors
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});
app.post('/api/create-user/:email/:phoneNumber/:password', async (req, res) => {
  try {
    // Extract user data from URL parameters
    const userData = {
      email: req.params.email,
      phoneNumber: req.params.phoneNumber,
      password: req.params.password,
    };

    // Call the function to create a user
    const uid = await createUserInFirebase(userData);

    // Send success response
    res.json({ message: 'User created successfully', uid });
  } catch (error) {
    // Handle errors
    console.error('Error creating user:', error);

    res.status(500).json({ error: error.code });
  }
});

app.post('/api/import-csv/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const { csvUrl, tags } = req.body;

  if (!csvUrl) {
    return res.status(400).json({ error: 'CSV URL is required' });
  }

  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: 'Tags must be an array' });
  }

  try {
    const tempFile = `temp_${Date.now()}.csv`;
    await downloadCSV(csvUrl, tempFile);
    await processCSV(tempFile, companyId, tags);
    fs.unlinkSync(tempFile); // Clean up temporary file
    res.json({ message: 'CSV processed successfully' });
  } catch (error) {
    console.error('Error processing CSV:', error);
    res.status(500).json({ error: 'Failed to process CSV' });
  }
});

async function downloadCSV(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unexpected response ${response.statusText}`);
  await pipeline(response.body, fs.createWriteStream(filename));
}

// Update the processCSV function to accept tags
async function processCSV(filename, companyId, tags) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filename)
      .pipe(csv())
      .on('data', async (row) => {
        try {
          await processContact(row, companyId, tags);
        } catch (error) {
          console.error('Error processing row:', error);
          // Continue processing other rows
        }
      })
      .on('end', () => {
        console.log('CSV file successfully processed');
        resolve();
      })
      .on('error', reject);
  });
}

// Update the processContact function to use the provided tags
async function processContact(row, companyId, tags) {
  let name, phone;

  if (companyId === '0124') {
    name = row['Nama Penuh'] || row['Nama Syarikat/Organisasi'];
    phone = await formatPhoneNumber(row['No Telefon'] || row['No Telefon Organisasi']);
  } else {
    name = row.Name;
    phone = await formatPhoneNumber(row.Phone);
  }

  if (!name) {
    name = phone;
    //  console.log("Saving contact with no name and phone ", phone)
  } else {
    // console.log("Saving contact with name ", name, " and phone ", phone)
  }

  let phoneWithPlus = phone.startsWith('+') ? phone : '+' + phone;
  const phoneWithoutPlus = phone.replace('+', '');

  if (phone) {
    const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(phoneWithPlus);
    const doc = await contactRef.get();

    if (doc.exists) {
      // Contact already exists, add new tags and update zakat data
      const updateData = {
        tags: admin.firestore.FieldValue.arrayUnion(...tags)
      };

      if (companyId === '0124') {
        updateData.zakatData = admin.firestore.FieldValue.arrayUnion(createZakatData(row));
      }

      await contactRef.update(updateData);
      // console.log(`Updated existing contact with new data: ${name} - ${phone}`);
    } else {
      const contactData = {
        additionalEmails: [],
        address1: null,
        assignedTo: null,
        businessId: null,
        phone: phoneWithPlus,
        tags: tags,
        chat: {
          contact_id: phoneWithoutPlus,
          id: phoneWithoutPlus + '@c.us',
          name: name,
          not_spam: true,
          tags: tags,
          timestamp: Date.now(),
          type: 'contact',
          unreadCount: 0,
          last_message: null,
        },
        chat_id: phoneWithoutPlus + '@c.us',
        city: null,
        phoneIndex: 0,
        companyName: null,
        contactName: name,
        threadid: '',
        last_message: null,
      };

      if (companyId === '079') {
        contactData.branch = row['BRANCH NAME'] || '-';
        contactData.address1 = row['ADDRESS'] || '-';
        contactData.expiryDate = row['PERIOD OF COVER'] || '-';
        contactData.email = row['EMAIL'] || '-';
        contactData.vehicleNumber = row['VEH. NO'] || '-';
        contactData.ic = row['IC/PASSPORT/BUSINESS REG. NO'] || '-';
      } else if (companyId === '0124') {
        // Common fields
        contactData.address1 = `${row['Alamat Penuh (Jalan)']} ${row['Alamat Penuh (Address Line 2)']}`.trim();
        contactData.city = row['Alamat Penuh (Bandar)'] || null;
        contactData.state = row['Alamat Penuh (Negeri)'] || null;
        contactData.postcode = row['Alamat Penuh (Poskod)'] || null;
        contactData.email = row['Emel'] || null;
        contactData.ic = row['No. Kad Pengenalan ( tanpa \'-\' )'] || null;

        // Initialize zakatData as an array with the first entry
        contactData.zakatData = [createZakatData(row)];
      }

      await contactRef.set(contactData);
      // console.log(`Added new contact: ${name} - ${phone}`);
    }
  } else {
    console.warn(`Skipping invalid phone number for ${name}`);
  }
}

function createZakatData(row) {
  const sourceUrl = row['Source Url'] || '';
  const zakatData = {
    // Common fields for all types
    paymentStatus: row['Payment Status'] || 'Processing',
    paymentDate: row['Payment Date'] || null,
    paymentAmount: row['Payment Amount'] || null,
    transactionId: row['Transaction Id'] || null,
    entryDate: row['Entry Date'] || null,
    dateUpdated: row['Date Updated'] || null,
    sourceUrl: sourceUrl,
    total: row['Total'] || null,
    productName: row['Product Name (Name)'] || null,
    productPrice: row['Product Name (Price)']?.replace('&#82;&#77; ', '') || null,
    productQuantity: row['Product Name (Quantity)'] || null,
    consent: row['Consent (Consent)'] || null,
    consentText: row['Consent (Text)'] || null,
    consentDescription: row['Consent (Description)'] || null
  };

  // Determine type and add specific fields
  if (sourceUrl.includes('zakat-simpanan')) {
    zakatData.type = 'Simpanan';
    zakatData.totalSavings = row['Jumlah Wang Simpanan'];
    zakatData.zakatAmount = row['Jumlah Zakat Simpanan Yang Perlu Ditunaikan'];
  }
  else if (sourceUrl.includes('zakat-perniagaan')) {
    zakatData.type = row['Nama Syarikat/Organisasi'] ? 'PerniagaanOrganisasi' : 'PerniagaanIndividu';
    zakatData.businessProfit = row['Untung Bersih Perniagaan'];
    zakatData.zakatAmount = row['Jumlah Zakat Perniagaan Yang Perlu Ditunaikan'];
    if (zakatData.type === 'PerniagaanOrganisasi') {
      zakatData.companyName = row['Nama Syarikat/Organisasi'];
      zakatData.ssmNumber = row['No. SSM'];
      zakatData.orgPhone = row['No Telefon Organisasi'];
      zakatData.officerName = row['Nama Pegawai Untuk Dihubungi'];
      zakatData.officerPhone = row['No. Telefon Pegawai'];
    }
  }
  else if (sourceUrl.includes('zakat-perak')) {
    zakatData.type = 'Perak';
    zakatData.silverValue = row['Nilai Simpanan'];
    zakatData.zakatAmount = row['Jumlah Zakat Perak Yang Perlu Ditunaikan'];
  }
  else if (sourceUrl.includes('zakat-pendapatan')) {
    zakatData.type = 'Pendapatan';
    zakatData.monthlyIncome = row['Pendapatan Bulanan'];
    zakatData.otherAnnualIncome = row['Lain-Lain Pendapatan Tahunan'];
    zakatData.monthlyZakat = row['Jumlah Zakat Bulanan'];
    zakatData.annualZakat = row['Jumlah Zakat Tahunan'];
    zakatData.paymentOption = row['Pilihan Bayaran'];
  }
  else if (sourceUrl.includes('zakat-pelaburan')) {
    zakatData.type = 'Pelaburan';
    zakatData.investmentTotal = row['Modal Asal + Untung Bersih'];
    zakatData.zakatAmount = row['Jumlah Zakat Pelaburan Yang Perlu Ditunaikan'];
  }
  else if (sourceUrl.includes('zakat-padi')) {
    zakatData.type = 'Padi';
    zakatData.year = row['Haul/Tahun'];
    zakatData.zakatAmount = row['Jumlah Zakat Padi Yang Hendak Ditunaikan'];
  }
  else if (sourceUrl.includes('zakat-kwsp')) {
    zakatData.type = 'KWSP';
    zakatData.epfAmount = row['Jumlah Yang Dikeluarkan Daripada KWSP'];
    zakatData.zakatAmount = row['Jumlah Zakat KWSP Yang Perlu Ditunaikan'];
  }
  else if (sourceUrl.includes('zakat-fitrah')) {
    zakatData.type = 'Fitrah';
    zakatData.riceType = row['Pilih Jenis Beras'];
    zakatData.dependents = row['Jumlah Tanggungan (orang)'];
    zakatData.zakatAmount = row['Zakat Fitrah Yang Perlu Ditunaikan'];
  }
  else if (sourceUrl.includes('zakat-emas')) {
    zakatData.type = 'Emas';
    zakatData.goldValue = row['Nilai Semasa Emas Yang Dimiliki'];
    zakatData.zakatAmount = row['Jumlah Zakat Emas Yang Perlu Ditunaikan'];
  }
  else if (sourceUrl.includes('zakat-ternakan')) {
    zakatData.type = 'Ternakan';
    zakatData.year = row['Haul/Tahun'];
    zakatData.zakatAmount = row['Jumlah Zakat Qadha Yang Hendak Ditunaikan'];
  }
  else if (sourceUrl.includes('qadha-zakat')) {
    zakatData.type = 'Qadha';
    zakatData.year = row['Haul/Tahun'];
    zakatData.zakatAmount = row['Jumlah Zakat Qadha Yang Hendak Ditunaikan'];
  }

  return zakatData;
}

function formatPhoneNumber(phone) {
  if (!phone) return '';

  // Remove all non-numeric characters
  phone = phone.toString().replace(/\D/g, '');

  // Remove leading zeros
  phone = phone.replace(/^0+/, '');

  // Ensure the number starts with '6'
  if (!phone.startsWith('6')) {
    phone = '6' + phone;
  }

  // Validate phone number length (should be between 10-14 digits after adding '6')
  if (phone.length < 10 || phone.length > 14) {
    console.warn(`Invalid phone number length: ${phone}`);
    return '';
  }

  return phone.startsWith('+') ? phone : '+' + phone;
}

async function getAITagResponses(idSubstring) {
  const responses = [];
  const aiTagResponsesRef = db.collection('companies').doc(idSubstring).collection('aiTagResponses');
  const snapshot = await aiTagResponsesRef.where('status', '==', 'active').get();

  snapshot.forEach(doc => {
    responses.push({
      keywords: doc.data().keywords || [], // Array of keywords
      tags: doc.data().tags || [], // Array of tags to add
      removeTags: doc.data().removeTags || [], // Optional array of tags to remove
      keywordSource: doc.data().keywordSource || "user", // Default to "user" if not specified
      tagActionMode: doc.data().tagActionMode || "add" // Default to "add" if not specified   
    });
  });
  return responses;
}

async function getAIImageResponses(idSubstring) {
  const responses = [];
  const aiResponsesRef = db.collection('companies').doc(idSubstring).collection('aiImageResponses');
  const snapshot = await aiResponsesRef.where('status', '==', 'active').get();

  snapshot.forEach(doc => {
    responses.push({
      keywords: doc.data().keywords || [], // Array of keywords
      imageUrls: doc.data().imageUrls || [], // Get array of image URLs
      keywordSource: doc.data().keywordSource || "user" // Default to "user" if not specified
    });
  });
  return responses;
}

async function getAIVideoResponses(idSubstring) {
  const responses = [];
  const aiVideoResponsesRef = db.collection('companies').doc(idSubstring).collection('aiVideoResponses');
  const snapshot = await aiVideoResponsesRef.where('status', '==', 'active').get();

  snapshot.forEach(doc => {
    responses.push({
      keywords: doc.data().keywords || [], // Array of keywords
      videoUrls: doc.data().videoUrls || [], // Array of video URLs
      captions: doc.data().captions || [], // Optional captions for each video
      keywordSource: doc.data().keywordSource || "user" // Default to "user" if not specified
    });
  });
  return responses;
}

async function getAIVoiceResponses(idSubstring) {
  const responses = [];
  const aiVoiceResponsesRef = db.collection('companies').doc(idSubstring).collection('aiVoiceResponses');
  const snapshot = await aiVoiceResponsesRef.where('status', '==', 'active').get();

  snapshot.forEach(doc => {
    responses.push({
      keywords: doc.data().keywords || [], // Array of keywords
      voiceUrls: doc.data().voiceUrls || [], // Array of voice message URLs
      captions: doc.data().captions || [], // Optional captions for each voice message
      language: doc.data().language || 'en', // Optional language setting
      keywordSource: doc.data().keywordSource || "user" // Default to "user" if not specified
    });
  });
  return responses;
}

async function getAIDocumentResponses(idSubstring) {
  const responses = [];
  const aiDocumentResponsesRef = db.collection('companies').doc(idSubstring).collection('aiDocumentResponses');
  const snapshot = await aiDocumentResponsesRef.where('status', '==', 'active').get();

  snapshot.forEach(doc => {
    responses.push({
      keywords: doc.data().keywords || [], // Array of keywords
      documentUrls: doc.data().documentUrls || [], // Array of document URLs
      documentNames: doc.data().documentNames || [], // Array of document names
      keywordSource: doc.data().keywordSource || "user" // Default to "user" if not specified
    });
  });
  return responses;
}

async function getAIAssignResponses(idSubstring) {
  console.log('Starting getAIAssignResponses for idSubstring:', idSubstring);
  const responses = [];

  try {
    const aiAssignResponsesRef = db.collection('companies').doc(idSubstring).collection('aiAssignResponses');
    console.log('Fetching active aiAssignResponses...');
    const snapshot = await aiAssignResponsesRef.where('status', '==', 'active').get();
    console.log('Found aiAssignResponses documents:', snapshot.size);

    for (const doc of snapshot.docs) {
      console.log('\nProcessing document:', doc.id);
      const data = doc.data();
      console.log('Document data:', data);

      // Get the assigned employees array
      const assignedEmployees = data.assignedEmployees || [];
      console.log('Assigned employees array:', assignedEmployees);

      if (assignedEmployees.length === 0) {
        console.log('No assigned employees found, skipping document');
        continue;
      }

      const responseObj = {
        keywords: Array.isArray(data.keywords) ? data.keywords : [data.keyword?.toLowerCase()].filter(Boolean), // Convert single keyword to array if needed
        keywordSource: data.keywordSource || "user", // Default to "user" if not specified
        assignedEmployees: assignedEmployees,
        description: data.description || '',
        createdAt: data.createdAt || null,
        status: data.status || 'active'
      };

      console.log('Adding response object:', responseObj);
      responses.push(responseObj);
    }

    console.log('\nFinal responses array:', responses);
    return responses;

  } catch (error) {
    console.error('Error in getAIAssignResponses:', error);
    console.error('Full error:', error.stack);
    throw error;
  }
}

async function getFollowUpTemplates(idSubstring) {
  const templates = [];
  const followUpTemplatesRef = db.collection('companies').doc(idSubstring).collection('followUpTemplates');
  const snapshot = await followUpTemplatesRef.where('status', '==', 'active').get();

  snapshot.forEach(doc => {
    templates.push({
      id: doc.id,
      triggerKeywords: doc.data().triggerKeywords || [],
      triggerTags: doc.data().triggerTags || [],
      name: doc.data().name,
      keywordSource: doc.data().keywordSource || "bot" // Default to "user" if not specified
    });
  });
  return templates;
}

// Add priority levels at the top of your file
const PRIORITY = {
  CRITICAL: 1,    // Highest priority
  HIGH: 2,
  NORMAL: 3,
  LOW: 4,
  BULK: 5        // Lowest priority
};
app.get('/api/requeue-scheduled-messages/:companyId', async (req, res) => {
  const { companyId } = req.params;

  try {
    console.log(`Starting scheduled messages requeue process for company ${companyId}`);

    // Initial response to prevent timeout
    res.status(202).json({
      message: 'Requeue process started',
      companyId,
      status: 'processing'
    });

    const CHUNK_SIZE = 50; // Process 50 batches at a time
    const results = {
      success: true,
      companyId,
      messagesRequeued: 0,
      messagesDeleted: 0,
      messagesSkipped: {
        tooOld: 0,
        outsideTimeWindow: 0
      },
      errors: []
    };

    const now = new Date();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(now.getDate() - 2);

    const spacingBetweenBatches = 5 * 60 * 1000; // 5 minutes
    let nextScheduleTime = getAdjustedScheduleTime(now);

    // Get all scheduled messages
    const messagesSnapshot = await db.collection('companies')
      .doc(companyId)
      .collection('scheduledMessages')
      .where('status', '==', 'scheduled')
      .get();

    // Process messages in chunks
    for (const messageDoc of messagesSnapshot.docs) {
      const messageId = messageDoc.id;
      const messageData = messageDoc.data();
      const messageTime = messageData.scheduledTime?.toDate().getTime() || 0;

      // Handle old messages
      if (messageTime < twoDaysAgo.getTime()) {
        await deleteOldMessage(messageDoc);
        results.messagesDeleted++;
        continue;
      }

      // Get all batches for this message
      const batchesSnapshot = await messageDoc.ref.collection('batches').get();
      let batchesArray = batchesSnapshot.docs.map(doc => ({
        companyId,
        messageId,
        batchId: doc.id,
        data: doc.data(),
        originalTime: doc.data().batchScheduledTime?.toDate().getTime() || 0
      }));

      // Sort batches by scheduled time
      batchesArray.sort((a, b) => a.originalTime - b.originalTime);

      // Process batches in chunks
      for (let i = 0; i < batchesArray.length; i += CHUNK_SIZE) {
        const batchChunk = batchesArray.slice(i, i + CHUNK_SIZE);
        await processBatchChunk(batchChunk, results, now, twoDaysAgo, nextScheduleTime);

        // Update nextScheduleTime
        nextScheduleTime = new Date(nextScheduleTime.getTime() + (spacingBetweenBatches * batchChunk.length));
        nextScheduleTime = getAdjustedScheduleTime(nextScheduleTime);

        // Add delay between chunks to prevent overwhelming Redis
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Update progress in Firestore
      await updateRequeueProgress(companyId, results);
    }

    // Final update
    await updateRequeueProgress(companyId, results, true);

  } catch (error) {
    console.error(`Error in requeue process for company ${companyId}:`, error);
    await updateRequeueProgress(companyId, {
      success: false,
      error: error.message
    }, true);
  }
});

// Helper functions
async function processBatchChunk(batches, results, now, twoDaysAgo, nextScheduleTime) {
  const queue = getQueueForBot(batches[0].companyId);

  for (const batch of batches) {
    try {
      const { messageId, batchId, originalTime } = batch;

      // Check if already queued
      const existingJobs = await queue.getJobs(['waiting', 'delayed', 'active']);
      const isQueued = existingJobs.some(job => job.id === batchId);

      if (!isQueued) {
        if (originalTime < twoDaysAgo.getTime()) {
          results.messagesSkipped.tooOld++;
          continue;
        }

        const scheduleTime = calculateScheduleTime(originalTime, now, nextScheduleTime);
        const delay = Math.max(scheduleTime - now.getTime(), 0);

        await queue.add('send-message-batch',
          { companyId: batch.companyId, messageId, batchId },
          {
            removeOnComplete: false,
            removeOnFail: false,
            delay,
            jobId: batchId
          }
        );

        results.messagesRequeued++;
      }
    } catch (error) {
      console.error(`Error processing batch ${batch.batchId}:`, error);
      results.errors.push({
        messageId: batch.messageId,
        batchId: batch.batchId,
        error: error.message
      });
    }
  }
}

function getAdjustedScheduleTime(date) {
  const hour = date.getHours();
  if (hour < 6) {
    date.setHours(6, 0, 0, 0);
  } else if (hour >= 22) {
    date.setDate(date.getDate() + 1);
    date.setHours(6, 0, 0, 0);
  }
  return date;
}

function calculateScheduleTime(originalTime, now, nextScheduleTime) {
  let scheduleTime = originalTime > now.getTime() ? originalTime : nextScheduleTime.getTime();
  const scheduleDate = new Date(scheduleTime);

  return getAdjustedScheduleTime(scheduleDate).getTime();
}

async function deleteOldMessage(messageDoc) {
  const batchesSnapshot = await messageDoc.ref.collection('batches').get();
  const batchDeletePromises = batchesSnapshot.docs.map(doc => doc.ref.delete());
  await Promise.all(batchDeletePromises);
  await messageDoc.ref.delete();
}

async function updateRequeueProgress(companyId, results, isComplete = false) {
  const progressRef = db.collection('companies')
    .doc(companyId)
    .collection('system')
    .doc('requeue-progress');

  await progressRef.set({
    ...results,
    lastUpdated: admin.firestore.Timestamp.now(),
    status: isComplete ? 'completed' : 'processing'
  }, { merge: true });
}

// Helper functions
function getAdjustedScheduleTime(now) {
  const currentHour = now.getHours();
  if (currentHour < 6) {
    return new Date(now.setHours(6, 0, 0, 0)).getTime();
  } else if (currentHour >= 22) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(6, 0, 0, 0);
    return tomorrow.getTime();
  }
  return now.getTime();
}

function getNextScheduleTime(currentTime, spacing) {
  const nextTime = new Date(currentTime + spacing);
  const nextHour = nextTime.getHours();

  if (nextHour >= 22 || (nextHour >= 0 && nextHour < 6)) {
    nextTime.setDate(nextTime.getDate() + 1);
    nextTime.setHours(6, 0, 0, 0);
  }

  return nextTime.getTime();
}

async function deleteOldMessage(messageDoc) {
  const batchesSnapshot = await messageDoc.ref.collection('batches').get();
  const batchDeletePromises = batchesSnapshot.docs.map(doc => doc.ref.delete());
  await Promise.all(batchDeletePromises);
  await messageDoc.ref.delete();
}

async function processBatches(messageDoc, companyId, messageId, now, twoDaysAgo, nextScheduleTime) {
  let requeued = 0;
  let skipped = 0;
  const queue = getQueueForBot(companyId);

  const batchesSnapshot = await messageDoc.ref.collection('batches').get();

  for (const batchDoc of batchesSnapshot.docs) {
    const batchId = batchDoc.id;
    const batchTime = batchDoc.data().batchScheduledTime?.toDate().getTime() || 0;

    // Skip if already queued
    const existingJobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    if (existingJobs.some(job => job.id === batchId)) {
      continue;
    }

    // Skip old batches
    if (batchTime < twoDaysAgo.getTime()) {
      skipped++;
      continue;
    }

    // Schedule the batch
    const scheduleTime = batchTime > now.getTime() ? batchTime : nextScheduleTime;
    const adjustedTime = getAdjustedScheduleTime(new Date(scheduleTime));
    const delay = Math.max(adjustedTime - now.getTime(), 0);

    await queue.add('send-message-batch',
      { companyId, messageId, batchId },
      {
        removeOnComplete: false,
        removeOnFail: false,
        delay,
        jobId: batchId
      }
    );

    requeued++;
  }

  return { requeued, skipped };
}
// Add a daily cron job to automatically requeue messages
const requeueCron = cron.schedule('*/30 * * * *', async () => { // Runs every 30 minutes
  try {
    console.log('Starting scheduled message requeue check');
    const response = await fetch('http://localhost:' + process.env.PORT + '/api/requeue-scheduled-messages', {
      method: 'POST'
    });

    const result = await response.json();
    console.log('Requeue check completed:', result);
  } catch (error) {
    console.error('Error in requeue cron:', error);
  }
});

// Start the cron job
//requeueCron.start();

// ... existing code ...

app.get('/api/requeue-scheduled-messages/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const BATCH_SIZE = 50; // Process 50 messages at a time
  const PROCESSING_DELAY = 1000; // 1 second delay between batches

  try {
    console.log(`Starting scheduled messages requeue process for company ${companyId}`);
    const results = {
      success: true,
      companyId,
      messagesRequeued: 0,
      messagesDeleted: 0,
      messagesSkipped: {
        tooOld: 0,
        outsideTimeWindow: 0
      },
      errors: []
    };

    // Get current time and time limits
    const now = new Date();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(now.getDate() - 2);

    // Configure spacing and time windows
    const spacingBetweenBatches = 5 * 60 * 1000; // 5 minutes between batches
    let nextScheduleTime = now.getTime();

    // Adjust nextScheduleTime if current time is outside allowed window
    const currentHour = now.getHours();
    if (currentHour < 6) {
      nextScheduleTime = new Date(now.setHours(6, 0, 0, 0)).getTime();
    } else if (currentHour >= 22) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(6, 0, 0, 0);
      nextScheduleTime = tomorrow.getTime();
    }

    // Get all scheduled messages for the specific company
    const messagesSnapshot = await db.collection('companies')
      .doc(companyId)
      .collection('scheduledMessages')
      .where('status', '==', 'scheduled')
      .get();

    const messages = messagesSnapshot.docs;
    const totalMessages = messages.length;
    let processedCount = 0;

    // Process messages in batches
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const messageBatch = messages.slice(i, i + BATCH_SIZE);

      for (const messageDoc of messageBatch) {
        const messageId = messageDoc.id;
        const messageData = messageDoc.data();
        const messageTime = messageData.scheduledTime?.toDate().getTime() || 0;

        // Delete messages older than 2 days
        if (messageTime < twoDaysAgo.getTime()) {
          try {
            // Delete all batches first
            const batchesSnapshot = await messageDoc.ref.collection('batches').get();
            const batchDeletePromises = batchesSnapshot.docs.map(batchDoc => batchDoc.ref.delete());
            await Promise.all(batchDeletePromises);

            // Then delete the message document
            await messageDoc.ref.delete();
            results.messagesDeleted++;
          } catch (error) {
            console.error(`Error deleting old message ${messageId}:`, error);
            results.errors.push({ messageId, error: error.message });
          }
          continue;
        }

        // Process batches for this message
        try {
          const batchesSnapshot = await messageDoc.ref.collection('batches').get();
          const queue = getQueueForBot(companyId);
          const existingJobs = await queue.getJobs(['waiting', 'delayed', 'active']);
          const existingJobIds = new Set(existingJobs.map(job => job.id));

          for (const batchDoc of batchesSnapshot.docs) {
            const batchId = batchDoc.id;
            if (existingJobIds.has(batchId)) continue;

            const batchScheduledTime = batchDoc.data().batchScheduledTime?.toDate().getTime() || 0;

            // Skip if batch is too old
            if (batchScheduledTime < twoDaysAgo.getTime()) {
              results.messagesSkipped.tooOld++;
              continue;
            }

            // Calculate scheduling time
            let scheduleTime = batchScheduledTime > now.getTime()
              ? batchScheduledTime
              : nextScheduleTime;

            // Adjust for time windows
            const scheduleDate = new Date(scheduleTime);
            const scheduleHour = scheduleDate.getHours();
            if (scheduleHour >= 22 || scheduleHour < 6) {
              scheduleDate.setDate(scheduleDate.getDate() + (scheduleHour >= 22 ? 1 : 0));
              scheduleDate.setHours(6, 0, 0, 0);
              scheduleTime = scheduleDate.getTime();
            }

            const delay = Math.max(scheduleTime - now.getTime(), 0);

            await queue.add('send-message-batch',
              { companyId, messageId, batchId },
              {
                removeOnComplete: false,
                removeOnFail: false,
                delay,
                jobId: batchId
              }
            );

            results.messagesRequeued++;
            nextScheduleTime = scheduleTime + spacingBetweenBatches;
          }
        } catch (error) {
          console.error(`Error processing message ${messageId}:`, error);
          results.errors.push({ messageId, error: error.message });
        }
      }

      processedCount += messageBatch.length;
      console.log(`Processed ${processedCount}/${totalMessages} messages`);

      // Add delay between batches to reduce system load
      if (i + BATCH_SIZE < messages.length) {
        await new Promise(resolve => setTimeout(resolve, PROCESSING_DELAY));
      }
    }

    results.schedulingSummary = {
      startTime: new Date(now).toISOString(),
      lastScheduledTime: new Date(nextScheduleTime).toISOString(),
      totalProcessed: processedCount,
      totalMessages: totalMessages,
      timeRestrictions: {
        allowedHours: '6 AM - 10 PM',
        maxAge: '2 days'
      }
    };

    res.json(results);

  } catch (error) {
    console.error(`Error in requeue process for company ${companyId}:`, error);
    res.status(500).json({
      success: false,
      companyId,
      error: error.message
    });
  }
});

app.post('/api/schedule-message/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const scheduledMessage = req.body;
  const phoneIndex = scheduledMessage.phoneIndex || 0;

  console.log('Received scheduling request:', {
    companyId,
    messageFormat: scheduledMessage.message ? 'single' : 'sequence',
    hasAdditionalMessages: Boolean(scheduledMessage.messages?.length),
    infiniteLoop: Boolean(scheduledMessage.infiniteLoop),
    hasMedia: Boolean(scheduledMessage.mediaUrl || scheduledMessage.documentUrl),
    hasCaption: Boolean(scheduledMessage.caption)
  });

  try {
    // Get or create company-specific queue
    const queue = getQueueForBot(companyId);

    // Add createdAt timestamp
    scheduledMessage.createdAt = admin.firestore.Timestamp.now();
    scheduledMessage.scheduledTime = new admin.firestore.Timestamp(
      scheduledMessage.scheduledTime.seconds,
      scheduledMessage.scheduledTime.nanoseconds
    );

    // Generate a unique ID for the message
    const messageId = uuidv4();

    // Process chatIds into individual message objects
    let processedMessages = [];

    // Check if this is a media message (image or document)
    const isMediaMessage = Boolean(scheduledMessage.mediaUrl || scheduledMessage.documentUrl);
    const messageCaption = scheduledMessage.caption || scheduledMessage.message || '';

    if (scheduledMessage.messages && Array.isArray(scheduledMessage.messages) && scheduledMessage.messages.length > 0) {
      // If we have an array of messages, use those
      scheduledMessage.chatIds.forEach(chatId => {
        scheduledMessage.messages.forEach((msg, index) => {
          processedMessages.push({
            chatId: chatId,
            message: msg.text || '',
            caption: msg.caption || msg.text || '',
            delay: scheduledMessage.messageDelays?.[index] || 0,
            phoneIndex: phoneIndex,
            isMedia: isMediaMessage,
            mediaUrl: scheduledMessage.mediaUrl || '',
            documentUrl: scheduledMessage.documentUrl || '',
            fileName: scheduledMessage.fileName || null
          });
        });
      });
    } else {
      // Otherwise use the single message field
      processedMessages = scheduledMessage.chatIds.map(chatId => ({
        chatId: chatId,
        message: isMediaMessage ? messageCaption : (scheduledMessage.message || ''),
        caption: messageCaption,
        phoneIndex: phoneIndex,
        delay: 0,
        isMedia: isMediaMessage,
        mediaUrl: scheduledMessage.mediaUrl || '',
        documentUrl: scheduledMessage.documentUrl || '',
        fileName: scheduledMessage.fileName || null
      }));
    }

    console.log('Processed messages:', {
      totalMessages: processedMessages.length,
      sampleMessage: processedMessages[0],
      isMediaMessage: isMediaMessage
    });

    // Calculate batches
    const totalMessages = processedMessages.length;
    const batchSize = scheduledMessage.batchQuantity || totalMessages;
    const numberOfBatches = Math.ceil(totalMessages / batchSize);

    // Create batches and save them to Firebase
    const batchesRef = db.collection('companies').doc(companyId)
      .collection('scheduledMessages').doc(messageId)
      .collection('batches');
    const batches = [];

    for (let batchIndex = 0; batchIndex < numberOfBatches; batchIndex++) {
      const startIndex = batchIndex * batchSize;
      const endIndex = Math.min((batchIndex + 1) * batchSize, totalMessages);
      const batchMessages = processedMessages.slice(startIndex, endIndex);

      const batchDelay = batchIndex * scheduledMessage.repeatInterval *
        getMillisecondsForUnit(scheduledMessage.repeatUnit);
      const batchScheduledTime = new Date(scheduledMessage.scheduledTime.toDate().getTime() + batchDelay);

      const batchData = {
        ...scheduledMessage,
        messages: batchMessages,
        batchIndex,
        batchScheduledTime: admin.firestore.Timestamp.fromDate(batchScheduledTime),
        // Add sequence-specific settings
        infiniteLoop: scheduledMessage.infiniteLoop || false,
        messageDelays: scheduledMessage.messageDelays || [],
        // Existing settings
        minDelay: scheduledMessage.minDelay || null,
        maxDelay: scheduledMessage.maxDelay || null,
        activateSleep: scheduledMessage.activateSleep || false,
        sleepAfterMessages: scheduledMessage.activateSleep ? scheduledMessage.sleepAfterMessages : null,
        sleepDuration: scheduledMessage.activateSleep ? scheduledMessage.sleepDuration : null,
        activeHours: scheduledMessage.activeHours || null,
        // Media settings
        isMedia: isMediaMessage,
        caption: messageCaption
      };

      // Remove unnecessary fields
      delete batchData.chatIds;
      if (isMediaMessage) {
        // For media messages, we keep both message and caption fields
        // but we might want to remove the original message field if it's redundant
        if (!scheduledMessage.message && scheduledMessage.caption) {
          delete batchData.message;
        }
      } else {
        // For text messages, we don't need the caption field
        delete batchData.caption;
      }

      const batchId = `${messageId}_batch_${batchIndex}`;
      await batchesRef.doc(batchId).set(batchData);
      batches.push({ id: batchId, scheduledTime: batchScheduledTime });
    }

    // Save the main scheduled message document
    const mainMessageData = {
      ...scheduledMessage,
      numberOfBatches,
      status: 'scheduled',
      infiniteLoop: scheduledMessage.infiniteLoop || false,
      messageDelays: scheduledMessage.messageDelays || [],
      minDelay: scheduledMessage.minDelay || null,
      maxDelay: scheduledMessage.maxDelay || null,
      activateSleep: scheduledMessage.activateSleep || false,
      sleepAfterMessages: scheduledMessage.activateSleep ? scheduledMessage.sleepAfterMessages : null,
      sleepDuration: scheduledMessage.activateSleep ? scheduledMessage.sleepDuration : null,
      activeHours: scheduledMessage.activeHours || null,
      // Media settings
      isMedia: isMediaMessage,
      caption: messageCaption
    };

    await db.collection('companies').doc(companyId)
      .collection('scheduledMessages').doc(messageId)
      .set(mainMessageData);

    // Schedule all batches in the company-specific queue
    for (const batch of batches) {
      const delay = Math.max(batch.scheduledTime.getTime() - Date.now(), 0);
      await queue.add('send-message-batch',
        {
          companyId,
          messageId,
          batchId: batch.id
        },
        {
          removeOnComplete: false,
          removeOnFail: false,
          delay,
          jobId: batch.id
        }
      );
    }

    // Get queue status for logging
    const queueStatus = await queue.getJobCounts();
    console.log(`Queue status for company ${companyId}:`, queueStatus);

    res.status(201).json({
      id: messageId,
      message: 'Message scheduled successfully',
      batches: batches.length,
      success: true,
      queueStatus
    });

  } catch (error) {
    console.error('Error scheduling message:', error);
    res.status(500).json({ error: 'Failed to schedule message' });
  }
});

app.put('/api/schedule-message/:companyId/:messageId', async (req, res) => {
  const { companyId, messageId } = req.params;
  const updatedMessage = req.body;
  const phoneIndex = updatedMessage.phoneIndex || 0;
  console.log('Received update request:', {
    companyId,
    messageId,
    messageFormat: updatedMessage.message ? 'single' : 'sequence',
    hasAdditionalMessages: Boolean(updatedMessage.messages?.length),
    infiniteLoop: Boolean(updatedMessage.infiniteLoop)
  });

  try {
    // Delete existing jobs and batches
    const jobs = await messageQueue.getJobs(['active', 'waiting', 'delayed', 'paused']);
    for (const job of jobs) {
      if (job.id.startsWith(messageId)) {
        await job.remove();
      }
    }

    // Initialize scheduledTime with a default value
    let scheduledTime = new Date();

    // Convert scheduledTime to Firestore Timestamp if provided
    if (updatedMessage.scheduledTime) {
      // Handle different timestamp formats
      if (updatedMessage.scheduledTime instanceof admin.firestore.Timestamp) {
        // Already a Firestore timestamp
        scheduledTime = updatedMessage.scheduledTime.toDate();
      } else if (updatedMessage.scheduledTime.seconds) {
        // Timestamp-like object with seconds
        scheduledTime = new admin.firestore.Timestamp(
          updatedMessage.scheduledTime.seconds,
          updatedMessage.scheduledTime.nanoseconds || 0
        ).toDate();
      } else {
        // Convert from string/number/Date to Firestore timestamp
        scheduledTime = new Date(updatedMessage.scheduledTime);
        updatedMessage.scheduledTime = admin.firestore.Timestamp.fromDate(scheduledTime);
      }
    } else {
      // If no scheduledTime provided, use current time and update the message
      updatedMessage.scheduledTime = admin.firestore.Timestamp.fromDate(scheduledTime);
    }

    // Process chatIds into individual message objects
    let processedMessages = [];

    if (updatedMessage.messages && Array.isArray(updatedMessage.messages) && updatedMessage.messages.length > 0) {
      // If we have an array of messages, use those
      updatedMessage.chatIds.forEach(chatId => {
        updatedMessage.messages.forEach((msg, index) => {
          processedMessages.push({
            chatId: chatId,
            message: msg.text || '',
            delay: updatedMessage.messageDelays?.[index] || 0,
            phoneIndex: phoneIndex
          });
        });
      });
    } else {
      // Otherwise use the single message field
      processedMessages = updatedMessage.chatIds.map(chatId => ({
        chatId: chatId,
        message: updatedMessage.message || '',
        phoneIndex: phoneIndex,
        delay: 0
      }));
    }

    // Calculate batches
    const totalMessages = processedMessages.length;
    const batchSize = updatedMessage.batchQuantity || totalMessages;
    const numberOfBatches = Math.ceil(totalMessages / batchSize);

    // Create batches and save them to Firebase
    const batchesRef = db.collection('companies').doc(companyId)
      .collection('scheduledMessages').doc(messageId)
      .collection('batches');
    const batches = [];

    // Delete existing batches
    const existingBatches = await batchesRef.get();
    const deleteBatch = db.batch();
    existingBatches.docs.forEach(doc => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();

    // Create new batches
    for (let batchIndex = 0; batchIndex < numberOfBatches; batchIndex++) {
      const startIndex = batchIndex * batchSize;
      const endIndex = Math.min((batchIndex + 1) * batchSize, totalMessages);
      const batchMessages = processedMessages.slice(startIndex, endIndex);

      const batchDelay = batchIndex * updatedMessage.repeatInterval *
        getMillisecondsForUnit(updatedMessage.repeatUnit);
      const batchScheduledTime = new Date(scheduledTime.getTime() + batchDelay);

      const batchData = {
        ...updatedMessage,
        messages: batchMessages,
        batchIndex,
        batchScheduledTime: admin.firestore.Timestamp.fromDate(batchScheduledTime),
        infiniteLoop: updatedMessage.infiniteLoop || false,
        messageDelays: updatedMessage.messageDelays || [],
        minDelay: updatedMessage.minDelay || null,
        maxDelay: updatedMessage.maxDelay || null,
        activateSleep: updatedMessage.activateSleep || false,
        sleepAfterMessages: updatedMessage.activateSleep ? updatedMessage.sleepAfterMessages : null,
        sleepDuration: updatedMessage.activateSleep ? updatedMessage.sleepDuration : null,
        activeHours: updatedMessage.activeHours || null
      };

      delete batchData.chatIds;
      delete batchData.message;

      const batchId = `${messageId}_batch_${batchIndex}`;
      await batchesRef.doc(batchId).set(batchData);
      batches.push({ id: batchId, scheduledTime: batchScheduledTime });
    }

    // Update main message document
    const mainMessageData = {
      ...updatedMessage,
      numberOfBatches,
      status: updatedMessage.status || 'scheduled',
      infiniteLoop: updatedMessage.infiniteLoop || false,
      messageDelays: updatedMessage.messageDelays || [],
      minDelay: updatedMessage.minDelay || null,
      maxDelay: updatedMessage.maxDelay || null,
      activateSleep: updatedMessage.activateSleep || false,
      sleepAfterMessages: updatedMessage.activateSleep ? updatedMessage.sleepAfterMessages : null,
      sleepDuration: updatedMessage.activateSleep ? updatedMessage.sleepDuration : null,
      activeHours: updatedMessage.activeHours || null
    };

    await db.collection('companies').doc(companyId)
      .collection('scheduledMessages').doc(messageId)
      .set(mainMessageData);

    // Schedule new batches
    if (mainMessageData.status === 'scheduled') {
      for (const batch of batches) {
        const delay = Math.max(batch.scheduledTime.getTime() - Date.now(), 0);
        await messageQueue.add('send-message-batch',
          {
            companyId,
            messageId,
            batchId: batch.id
          },
          {
            removeOnComplete: false,
            removeOnFail: false,
            delay,
            jobId: batch.id
          }
        );
      }
    }

    res.json({
      id: messageId,
      message: 'Message updated successfully',
      success: true,
      batches: batches.length
    });

  } catch (error) {
    console.error('Error updating scheduled message:', error);
    res.status(500).json({ error: 'Failed to update scheduled message' });
  }
});

app.delete('/api/schedule-message/:companyId/:messageId', async (req, res) => {
  const { companyId, messageId } = req.params;

  try {
    console.log('Received delete request:', { companyId, messageId });

    // Check if message exists
    const messageRef = db.collection('companies').doc(companyId)
      .collection('scheduledMessages').doc(messageId);
    const messageDoc = await messageRef.get();

    if (!messageDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Scheduled message not found'
      });
    }

    // Delete batches first
    const batchesRef = messageRef.collection('batches');
    const batchesSnapshot = await batchesRef.get();

    // Use a Firestore batch for atomic operation
    const batch = db.batch();

    // Add batch deletions
    batchesSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Add main document deletion to the same batch
    batch.delete(messageRef);

    // Execute the batch
    await batch.commit();

    // Remove jobs from queue - make sure to check all possible states
    const jobStates = ['active', 'waiting', 'delayed', 'paused', 'failed'];
    for (const state of jobStates) {
      const jobs = await messageQueue.getJobs([state]);
      for (const job of jobs) {
        if (job.id.startsWith(messageId) || job.data.messageId === messageId) {
          try {
            await job.remove();
            console.log(`Removed job ${job.id} in state ${state}`);
          } catch (err) {
            console.error(`Failed to remove job ${job.id}:`, err);
          }
        }
      }
    }

    // Double check the deletion
    const verifyDoc = await messageRef.get();
    if (verifyDoc.exists) {
      throw new Error('Message document still exists after deletion');
    }

    res.json({
      id: messageId,
      message: 'Message deleted successfully',
      success: true,
      batchesDeleted: batchesSnapshot.size
    });

  } catch (error) {
    console.error('Error deleting scheduled message:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete scheduled message',
      details: {
        companyId,
        messageId,
        errorCode: error.code
      }
    });
  }
});
// New route for syncing contacts
app.post('/api/sync-contacts/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const { phoneIndex } = req.body;

  try {
    const botData = botMap.get(companyId);
    if (!botData) {
      return res.status(404).json({ error: 'WhatsApp client not found for this company' });
    }

    let syncPromises = [];

    if (botData.length === 1) {
      const client = botData[0].client;
      if (!client) {
        return res.status(404).json({ error: 'WhatsApp client not found for this company' });
      }
      syncPromises.push(syncContacts(client, companyId, 0));
    } else if (phoneIndex !== undefined) {
      if (phoneIndex < 0 || phoneIndex >= botData.length) {
        return res.status(400).json({ error: 'Invalid phone index' });
      }
      const client = botData[phoneIndex].client;
      if (!client) {
        return res.status(404).json({ error: `WhatsApp client not found for phone index ${phoneIndex}` });
      }
      syncPromises.push(syncContacts(client, companyId, phoneIndex));
    } else {
      syncPromises = botData.map((data, index) => {
        if (data.client) {
          return syncContacts(data.client, companyId, index);
        }
      }).filter(Boolean);
    }

    if (syncPromises.length === 0) {
      return res.status(404).json({ error: 'No valid WhatsApp clients found for synchronization' });
    }

    // Start syncing process for all applicable clients
    syncPromises.forEach((promise, index) => {
      promise.then(() => {
        //console.log(`Contact synchronization completed for company ${companyId}, phone ${index}`);
      }).catch(error => {
        console.error(`Error during contact sync for company ${companyId}, phone ${index}:`, error);
      });
    });

    res.json({ success: true, message: 'Contact synchronization started', phonesToSync: syncPromises.length });
  } catch (error) {
    console.error(`Error starting contact sync for ${companyId}:`, error);
    res.status(500).json({ error: 'Failed to start contact synchronization' });
  }
});

app.post('/api/sync-a-contact/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const { phoneIndex, phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  try {
    const botData = botMap.get(companyId);
    if (!botData) {
      return res.status(404).json({ error: 'WhatsApp client not found for this company' });
    }

    let client;
    
    if (botData.length === 1) {
      client = botData[0].client;
      if (!client) {
        return res.status(404).json({ error: 'WhatsApp client not found for this company' });
      }
    } else if (phoneIndex !== undefined) {
      if (phoneIndex < 0 || phoneIndex >= botData.length) {
        return res.status(400).json({ error: 'Invalid phone index' });
      }
      client = botData[phoneIndex].client;
      if (!client) {
        return res.status(404).json({ error: `WhatsApp client not found for phone index ${phoneIndex}` });
      }
    } else {
      return res.status(400).json({ error: 'Phone index is required for companies with multiple phones' });
    }

    // Format the phone number for WhatsApp
    const formattedNumber = phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
    const chatId = `${formattedNumber}@c.us`;

    try {
      // Get contact by ID
      const contact = await client.getContactById(chatId);
      if (!contact) {
        return res.status(404).json({ error: 'Contact not found' });
      }

      // Get chat for this contact
      const chat = await contact.getChat();
      
      // Save the contact
      await saveContactWithRateLimit(companyId, contact, chat, phoneIndex || 0, client);
      
      res.json({ 
        success: true, 
        message: `Contact ${phoneNumber} synchronized successfully`,
        contactId: phoneNumber
      });
    } catch (error) {
      console.error(`Error syncing contact ${phoneNumber} for company ${companyId}:`, error);
      res.status(500).json({ 
        error: `Failed to sync contact: ${error.message}`,
        phoneNumber
      });
    }
  } catch (error) {
    console.error(`Error starting contact sync for ${companyId}:`, error);
    res.status(500).json({ error: 'Failed to start contact synchronization' });
  }
});

// New route for syncing contact names
app.post('/api/sync-contact-names/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const { phoneIndex } = req.body;

  try {
    const botData = botMap.get(companyId);
    if (!botData) {
      return res.status(404).json({ error: 'WhatsApp client not found for this company' });
    }

    let syncPromises = [];

    if (botData.length === 1) {
      const client = botData[0].client;
      if (!client) {
        return res.status(404).json({ error: 'WhatsApp client not found for this company' });
      }
      syncPromises.push(syncContactNames(client, companyId, 0));
    } else if (phoneIndex !== undefined) {
      if (phoneIndex < 0 || phoneIndex >= botData.length) {
        return res.status(400).json({ error: 'Invalid phone index' });
      }
      const client = botData[phoneIndex].client;
      if (!client) {
        return res.status(404).json({ error: `WhatsApp client not found for phone index ${phoneIndex}` });
      }
      syncPromises.push(syncContactNames(client, companyId, phoneIndex));
    } else {
      syncPromises = botData.map((data, index) => {
        if (data.client) {
          return syncContactNames(data.client, companyId, index);
        }
      }).filter(Boolean);
    }

    if (syncPromises.length === 0) {
      return res.status(404).json({ error: 'No valid WhatsApp clients found for synchronization' });
    }

    // Start syncing process for all applicable clients
    const results = await Promise.all(syncPromises);

    res.json({
      success: true,
      message: 'Contact name synchronization started',
      phonesToSync: syncPromises.length,
    });
  } catch (error) {
    console.error(`Error starting contact name sync for ${companyId}:`, error);
    res.status(500).json({ error: 'Failed to start contact name synchronization' });
  }
});

async function syncContactNames(client, companyId, phoneIndex = 0) {
  try {
    const chats = await client.getChats();
    const totalChats = chats.length;
    let processedChats = 0;
    let syncedCount = 0;
    let skippedCount = 0;
    let failedChats = [];

    console.log(`Found ${totalChats} chats for company ${companyId}, phone ${phoneIndex}`);

    // Process chats sequentially
    for (const chat of chats) {
      let success = false;
      let retries = 0;

      while (!success && retries < MAX_RETRIES) {
        try {
          const contact = await chat.getContact();
          const contactName = chat.name || contact.name || contact.pushname;

          if (contactName && !contactName.match(/^\+?[0-9]+$/)) {
            const chatID = contact.id.user;
            const phoneWithPlus = "+" + chatID.split("@")[0];
            await updateContactName(companyId, phoneWithPlus, contactName);
            syncedCount++;
          } else {
            skippedCount++;
          }

          success = true;
          processedChats++;

          // Add a small delay between each chat
          await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
          retries++;
          console.error(`Error processing chat (attempt ${retries}):`, error);

          if (retries === MAX_RETRIES) {
            console.error(`Failed to process chat after ${MAX_RETRIES} attempts`);
            failedChats.push(chat);
          } else {
            // Small delay before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      // Log progress at regular intervals
      if (processedChats % 10 === 0 || processedChats === totalChats) {
        console.log(`Processed ${processedChats} out of ${totalChats} chats for company ${companyId}, phone ${phoneIndex}`);
        console.log(`Synced: ${syncedCount}, Skipped: ${skippedCount}, Failed: ${failedChats.length}`);
      }
    }

    console.log(`Finished syncing contact names for company ${companyId}, phone ${phoneIndex}`);
    console.log(`Successfully processed: ${processedChats}/${totalChats} chats`);
    console.log(`Synced: ${syncedCount}, Skipped: ${skippedCount}, Failed: ${failedChats.length}`);

    return {
      success: true,
      syncedCount,
      skippedCount,
      failedChats: failedChats.length,
      totalChats
    };

  } catch (error) {
    console.error(`Error syncing contact names for company ${companyId}, phone ${phoneIndex}:`, error);
    throw error;
  }
}

async function updateContactName(companyId, contactId, contactName) {
  try {
    const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(contactId);
    const doc = await contactRef.get();

    if (doc.exists) {
      await contactRef.update({
        'chat.name': contactName,
        contactName: contactName
      });
      console.log(`Updated contact name for ${contactId}`);
    } else {
      // If the document doesn't exist, it will skip it
      console.log(`Contact ${contactId} has been skipped because it doesn't exist in firebase.`);
    }
  } catch (error) {
    console.error(`Error updating/creating contact name for ${contactId}:`, error);
    throw error;
  }
}

app.get('/api/search-messages/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const {
    query,
    contactId,
    dateFrom,
    dateTo,
    messageType,
    fromMe,
    page = '1',
    limit = '50'
  } = req.query;

  try {
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    // Convert pagination parameters to integers
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const startAt = (pageNum - 1) * limitNum;

    // Validate pagination parameters
    if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
      return res.status(400).json({ error: 'Invalid pagination parameters' });
    }

    let messagesQuery;

    if (contactId) {
      // Search within specific contact's messages
      messagesQuery = db.collection('companies')
        .doc(companyId)
        .collection('contacts')
        .doc(contactId)
        .collection('messages');
    } else {
      // Search across all messages for this company
      messagesQuery = db.collectionGroup('messages')
        .where('__name__', '>=', `companies/${companyId}`)
        .where('__name__', '<=', `companies/${companyId}\uf8ff`);
    }

    // Apply filters except timestamp initially
    if (messageType) {
      messagesQuery = messagesQuery.where('type', '==', messageType);
    }
    if (fromMe !== undefined) {
      messagesQuery = messagesQuery.where('from_me', '==', fromMe === 'true');
    }

    // Get all messages without timestamp restrictions first
    const allMessagesQuery = messagesQuery.orderBy('timestamp', 'desc');

    // Get messages in batches to search through more data
    const batchSize = 500; // Adjust this number based on your needs
    let lastDoc = null;
    let allResults = [];
    let hasMore = true;

    while (hasMore && allResults.length < limitNum * 2) { // Get more results than needed for better pagination
      const queryBatch = lastDoc
        ? allMessagesQuery.startAfter(lastDoc).limit(batchSize)
        : allMessagesQuery.limit(batchSize);

      const snapshot = await queryBatch.get();

      if (snapshot.empty) {
        hasMore = false;
        break;
      }

      // Filter messages by date range and search text
      const searchText = query.toLowerCase();
      const filteredDocs = snapshot.docs.filter(doc => {
        const messageText = doc.get('text.body')?.toLowerCase() || '';
        const timestamp = doc.get('timestamp');

        // Apply date filters if specified
        const matchesDateRange = (!dateFrom || timestamp >= parseInt(dateFrom)) &&
          (!dateTo || timestamp <= parseInt(dateTo));

        return matchesDateRange && messageText.includes(searchText);
      });

      allResults = [...allResults, ...filteredDocs];
      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      // Stop if we've collected enough results or no more documents
      if (snapshot.docs.length < batchSize) {
        hasMore = false;
      }
    }

    // Apply pagination to filtered results
    const paginatedResults = allResults
      .slice(startAt, startAt + limitNum)
      .map(doc => {
        const pathParts = doc.ref.path.split('/');
        const contactIndex = pathParts.indexOf('contacts');
        const contactId = contactIndex !== -1 ? pathParts[contactIndex + 1] : null;

        return {
          id: doc.id,
          contactId,
          ...doc.data()
        };
      });

    res.json({
      total: allResults.length,
      page: pageNum,
      totalPages: Math.ceil(allResults.length / limitNum),
      results: paginatedResults
    });

  } catch (error) {
    console.error('Error searching messages:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.get('/api/stats/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const { employeeId } = req.query;
  let agentName;

  if (!employeeId) {
    return res.status(400).json({ error: 'Employee ID is required' });
  }

  const employeeRef = db.collection('companies').doc(companyId).collection('employee').doc(employeeId);
  const employeeDoc = await employeeRef.get();

  if (employeeDoc.exists) {
    agentName = employeeDoc.data().name;
  } else {
    return res.status(400).json({ error: 'No employee found with the given ID' });
  }

  try {
    // Initialize stats object
    const stats = {
      conversationsAssigned: 0,
      outgoingMessagesSent: 0,
      averageResponseTime: 0,
      closedContacts: 0
    };

    // Query for contacts with the agent's name as a tag
    const contactsRef = db.collection('companies').doc(companyId).collection('contacts');
    const contactsSnapshot = await contactsRef.where('tags', 'array-contains', agentName).get();

    if (contactsSnapshot.empty) {
      return res.status(404).json({ error: 'No contacts found for the specified agent' });
    } else {
      stats.conversationsAssigned = contactsSnapshot.size;
      const closedContacts = contactsSnapshot.docs.filter(doc =>
        doc.data().tags.includes('closed')
      );
      stats.closedContacts = closedContacts.length;
    }

    let totalResponseTime = 0;
    let responseCount = 0;

    // Iterate over each contact to gather statistics
    for (const contactDoc of contactsSnapshot.docs) {
      const contactId = contactDoc.id;

      // Query for outgoing messages sent for this contact
      const messagesRef = contactsRef.doc(contactId).collection('messages');
      const messagesSnapshot = await messagesRef.get();
      stats.outgoingMessagesSent += messagesSnapshot.docs.filter(doc => doc.data().from_me).length;

      // Calculate first response time for this contact
      const messagesTimeSnapshot = await messagesRef.orderBy('timestamp').get();
      const sortedMessages = messagesTimeSnapshot.docs
        .map(doc => doc.data())
        .sort((a, b) => a.timestamp - b.timestamp);

      let firstAgentMessageTime = null;
      let firstContactMessageTime = null;

      for (const message of sortedMessages) {
        if (message.from_me && firstAgentMessageTime === null) {
          firstAgentMessageTime = message.timestamp;
        } else if (!message.from_me && firstContactMessageTime === null) {
          firstContactMessageTime = message.timestamp;
        }

        if (firstAgentMessageTime !== null && firstContactMessageTime !== null) {
          break;
        }
      }

      if (firstAgentMessageTime !== null && firstContactMessageTime !== null) {
        const responseTime = Math.abs(firstContactMessageTime - firstAgentMessageTime);
        totalResponseTime += responseTime;
        responseCount++;
      }
    }

    // Calculate average response time
    if (responseCount > 0) {
      stats.averageResponseTime = Math.floor(totalResponseTime / responseCount);
    }

    // Send the stats as a response
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

async function searchContactMessages(messagesRef, query, dateFrom, dateTo, messageType, fromMe) {
  let messagesQuery = messagesRef;

  // Apply filters if provided
  if (dateFrom) {
    messagesQuery = messagesQuery.where('timestamp', '>=', parseInt(dateFrom));
  }
  if (dateTo) {
    messagesQuery = messagesQuery.where('timestamp', '<=', parseInt(dateTo));
  }
  if (messageType) {
    messagesQuery = messagesQuery.where('type', '==', messageType);
  }
  if (fromMe !== undefined) {
    messagesQuery = messagesQuery.where('from_me', '==', fromMe === 'true');
  }

  const snapshot = await messagesQuery.get();
  const results = [];

  snapshot.forEach(doc => {
    const messageData = doc.data();
    const messageText = messageData.text?.body || messageData.caption || '';

    // Check if the message contains the search query (case-insensitive)
    if (messageText.toLowerCase().includes(query.toLowerCase())) {
      results.push({
        id: doc.id,
        ...messageData
      });
    }
  });

  return results;
}
const MAX_RETRIES = 3;
async function syncContacts(client, companyId, phoneIndex = 0) {

  try {
    const chats = await client.getChats();
    const totalChats = chats.length;
    let processedChats = 0;
    let failedChats = [];

    console.log(`Found ${totalChats} chats for company ${companyId}, phone ${phoneIndex}`);

    // Process chats sequentially
    for (const chat of chats) {
      let success = false;
      let retries = 0;

      while (!success && retries < MAX_RETRIES) {
        try {
          const contact = await chat.getContact();
          await saveContactWithRateLimit(companyId, contact, chat, phoneIndex, client);
          success = true;
          processedChats++;

          // Add a small delay between each chat
          await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
          retries++;
          console.error(`Error processing chat (attempt ${retries}):`, error);

          if (retries === MAX_RETRIES) {
            console.error(`Failed to process chat after ${MAX_RETRIES} attempts`);
            failedChats.push(chat);
          } else {
            // Small delay before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      // Log progress at regular intervals
      if (processedChats % 10 === 0 || processedChats === totalChats) {
        console.log(`Processed ${processedChats} out of ${totalChats} chats for company ${companyId}, phone ${phoneIndex}`);
        if (failedChats.length > 0) {
          console.log(`Failed chats so far: ${failedChats.length}`);
        }
      }
    }

    const successfulChats = totalChats - failedChats.length;
    console.log(`Finished syncing contacts for company ${companyId}, phone ${phoneIndex}`);
    console.log(`Successfully processed: ${successfulChats}/${totalChats} chats`);

    return {
      success: true,
      processedChats: successfulChats,
      failedChats: failedChats.length,
      totalChats
    };

  } catch (error) {
    console.error(`Error syncing contacts for company ${companyId}, phone ${phoneIndex}:`, error);
    throw error;
  }
}

function getMillisecondsForUnit(unit) {
  switch (unit) {
    case 'minutes': return 60 * 1000;
    case 'hours': return 60 * 60 * 1000;
    case 'days': return 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

// Add a timeout wrapper function
const withTimeout = async (promise, timeoutMs = 30000) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Operation timed out'));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
};

// Add this function to check document existence
async function verifyMessageDocument(messageId, companyId) {
  console.log('\n=== Verifying Message Document ===');
  console.log('Looking for message:', {
    messageId,
    companyId,
    timestamp: new Date().toISOString()
  });

  try {
    // Log all the paths we're checking
    const paths = [
      `companies/${companyId}/scheduledMessages/${messageId}`,
      `scheduled_messages/${messageId}`,
      `archived_messages/${messageId}`
    ];
    console.log('Checking paths:', paths);

    // Check in company's scheduledMessages collection
    const companyRef = db.collection('companies').doc(companyId);
    console.log('Checking company exists:', companyId);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      console.log(`Company ${companyId} not found`);
      return null;
    }

    // Check scheduled messages subcollection
    console.log('Checking company scheduled messages');
    const messageDoc = await companyRef
      .collection('scheduledMessages')
      .doc(messageId)
      .get();

    if (messageDoc.exists) {
      const data = messageDoc.data();
      console.log('Document found in company collection:', {
        path: `companies/${companyId}/scheduledMessages/${messageId}`,
        data: {
          id: messageDoc.id,
          status: data.status,
          createdAt: data.createdAt?.toDate(),
          batchCount: data.batches?.length || 0,
          v2: data.v2
        }
      });
      return messageDoc;
    }

    // If not found, check root collections
    console.log('Not found in company collection, checking root collections');

    const rootDoc = await db.collection('scheduled_messages').doc(messageId).get();
    if (rootDoc.exists) {
      console.log('Document found in root scheduled_messages collection');
      return rootDoc;
    }

    const archivedDoc = await db.collection('archived_messages').doc(messageId).get();
    if (archivedDoc.exists) {
      console.log('Document found in archived_messages collection');
      return archivedDoc;
    }

    // Document not found anywhere
    console.log('Document not found in any location. Checked paths:', {
      company: `companies/${companyId}/scheduledMessages/${messageId}`,
      root: `scheduled_messages/${messageId}`,
      archived: `archived_messages/${messageId}`
    });

    // List all documents in the scheduledMessages collection for debugging
    const allMessages = await companyRef.collection('scheduledMessages').get();
    console.log('All scheduled messages for company:', {
      companyId,
      totalDocs: allMessages.size,
      docIds: allMessages.docs.map(doc => doc.id)
    });

    return null;

  } catch (error) {
    console.error('Error verifying document:', {
      error: error.message,
      stack: error.stack,
      companyId,
      messageId
    });
    return null;
  }
}

// Create a worker factory function
const processingChatIds = new Map();

const createQueueAndWorker = (botId) => {
  const queue = new Queue(`scheduled-messages-${botId}`, {
    connection,
    defaultJobOptions: {
      removeOnComplete: false, // Keep completed jobs
      removeOnFail: false,     // Keep failed jobs
      attempts: 3,             // Number of retry attempts
    }
  });

  queue.on('active', async (job) => {
    if (job.name === 'send-message-batch') {
      const { companyId, messageId, batchId } = job.data;

      try {
        // Fetch the batch data from Firebase
        const batchRef = db.collection('companies').doc(companyId)
          .collection('scheduledMessages').doc(messageId)
          .collection('batches').doc(batchId);
        const batchSnapshot = await batchRef.get();

        if (!batchSnapshot.exists) {
          console.error(`Bot ${botId} - Batch ${batchId} not found`);
          return;
        }

        const batchData = batchSnapshot.data();

        if (batchData.messages && batchData.messages.length > 0) {
          const chatId = `${companyId}_${batchData.messages[0].chatId}`;

          // Check if this chatId is already being processed
          if (processingChatIds.has(chatId)) {
            const processingStartTime = processingChatIds.get(chatId);
            const currentTime = Date.now();
            const processingTime = (currentTime - processingStartTime) / 1000;

            console.log(`Bot ${botId} - Detected duplicate message for chatId ${chatId} (already processing for ${processingTime}s)`);

            if (processingTime < 300) {
              // Mark this job as a duplicate to be skipped
              job.data.isDuplicate = true;
              await job.updateData(job.data);

              // Update the batch status in Firebase
              await batchRef.update({
                status: 'skipped',
                skippedReason: 'Duplicate message for same chatId',
                skippedAt: admin.firestore.FieldValue.serverTimestamp()
              });

              console.log(`Bot ${botId} - Marked job ${job.id} as duplicate for chatId ${chatId}`);
            }
          } else {
            // Reserve this chatId
            processingChatIds.set(chatId, Date.now());
            console.log(`Bot ${botId} - Reserved chatId ${chatId} for processing`);
          }
        }
      } catch (error) {
        console.error(`Bot ${botId} - Error in pre-processing check:`, error);
      }
    }
  });

  const worker = new Worker(`scheduled-messages-${botId}`, async job => {
    if (job.name === 'send-message-batch') {
      const { companyId, messageId, batchId, isDuplicate } = job.data;
      console.log(`Bot ${botId} - Processing scheduled message batch:`, { messageId, batchId });

      if (isDuplicate) {
        console.log(`Bot ${botId} - Skipping duplicate job ${job.id} for batch ${batchId}`);
        return { skipped: true, reason: 'Duplicate message' };
      }

      try {
        // Fetch the batch data from Firebase
        const batchRef = db.collection('companies').doc(companyId)
          .collection('scheduledMessages').doc(messageId)
          .collection('batches').doc(batchId);
        const batchSnapshot = await batchRef.get();

        if (!batchSnapshot.exists) {
          console.error(`Bot ${botId} - Batch ${batchId} not found`);
          return;
        }

        const batchData = batchSnapshot.data();

        if (batchData.status === 'skipped') {
          console.log(`Bot ${botId} - Batch ${batchId} was already marked as skipped, not processing`);
          return { skipped: true, reason: batchData.skippedReason || 'Already skipped' };
        }

        try {
          console.log(`Bot ${botId} - Sending scheduled message batch:`, batchData);
          const result = await sendScheduledMessage(batchData);

          if (result.success) {
            await batchRef.update({ status: 'sent' });
            // Check if all batches are processed
            const batchesRef = db.collection('companies').doc(companyId)
              .collection('scheduledMessages').doc(messageId)
              .collection('batches');
            const batchesSnapshot = await batchesRef.get();
            const allBatchesSent = batchesSnapshot.docs.every(doc => doc.data().status === 'sent');

            if (allBatchesSent) {
              // Update main scheduled message status
              await db.collection('companies').doc(companyId)
                .collection('scheduledMessages').doc(messageId)
                .update({ status: 'completed' });
            }
          } else {
            console.error(`Bot ${botId} - Failed to send batch ${batchId}:`, result.error);
            await batchRef.update({ status: 'failed' });
            await db.collection('companies').doc(companyId)
              .collection('scheduledMessages').doc(messageId)
              .update({ status: 'failed' });
          }
        } catch (error) {
          console.error(`Bot ${botId} - Error processing scheduled message batch:`, error);
          throw error; // This will cause the job to be retried
        }

      } catch (error) {
        console.error(`Bot ${botId} - Error processing scheduled message batch:`, error);
        throw error; // This will cause the job to be retried
      }
    }
  }, {
    connection,
    concurrency: 50,
    limiter: {
      max: 100,
      duration: 1000
    },
    lockDuration: 30000,
    maxStalledCount: 1,
    settings: {
      stalledInterval: 15000,
      lockRenewTime: 10000
    }
  });  // Add error handling

  worker.on('completed', async (job) => {
    console.log(`Bot ${botId} - Job ${job.id} completed successfully`);

    // Release the chatId from processing
    if (job.name === 'send-message-batch' && job.data.companyId && job.data.batchId) {
      try {
        const batchRef = db.collection('companies').doc(job.data.companyId)
          .collection('scheduledMessages').doc(job.data.messageId)
          .collection('batches').doc(job.data.batchId);
        const batchSnapshot = await batchRef.get();

        if (batchSnapshot.exists && batchSnapshot.data().messages && batchSnapshot.data().messages.length > 0) {
          const chatId = `${job.data.companyId}_${batchSnapshot.data().messages[0].chatId}`;
          if (processingChatIds.has(chatId)) {
            processingChatIds.delete(chatId);
            console.log(`Bot ${botId} - Released chatId ${chatId} after processing`);
          }
        }
      } catch (error) {
        console.error(`Bot ${botId} - Error releasing chatId:`, error);
      }
    }

    // Keep the job data in Redis
    await job.updateProgress(100);
    await job.updateData({
      ...job.data,
      completedAt: new Date(),
      status: 'completed'
    });
  });

  worker.on('failed', async (job, err) => {
    console.error(`Bot ${botId} - Job ${job.id} failed:`, err);
    // Keep the job data in Redis
    await job.updateData({
      ...job.data,
      failedAt: new Date(),
      error: err.message,
      status: 'failed'
    });
  });

  // Store references
  botQueues.set(botId, queue);
  botWorkers.set(botId, worker);
  return { queue, worker };
};

setInterval(() => {
  const now = Date.now();
  for (const [chatId, timestamp] of processingChatIds.entries()) {
    if (now - timestamp > 300000) {
      console.log(`Releasing stale chatId reservation: ${chatId} (processing for ${(now - timestamp) / 1000}s)`);
      processingChatIds.delete(chatId);
    }
  }
}, 60000);


// Store queues and workers
const botQueues = new Map();
const botWorkers = new Map();

// Function to get or create a bot's queue
const getQueueForBot = (botId) => {
  if (!botQueues.has(botId)) {
    const { queue, worker } = createQueueAndWorker(botId);
    botQueues.set(botId, queue);
    botWorkers.set(botId, worker);
  }
  return botQueues.get(botId);
};

async function sendScheduledMessage(message) {
  const companyId = message.companyId;
  try {
    console.log(`\n=== [Company ${companyId}] Starting sendScheduledMessage ===`);

    // Add these validation checks at the start
    if (message.phoneIndex === null || message.phoneIndex === undefined) {
      message.phoneIndex = 0; // Default to first phone if not specified
    }

    // Ensure phoneIndex is a number
    message.phoneIndex = parseInt(message.phoneIndex);
    if (isNaN(message.phoneIndex)) {
      message.phoneIndex = 0; // Default to first phone if invalid
    }

    // Add debug logging for client verification
    const botData = botMap.get(companyId);
    console.log('Available phone indices:', botData ? botData.map((_, i) => i) : []);
    console.log('Client status:', {
      phoneIndex: message.phoneIndex,
      hasClient: Boolean(botData?.[message.phoneIndex]?.client),
      clientInfo: botData?.[message.phoneIndex]?.client ? 'Client exists' : null
    });

    if (!botData?.[message.phoneIndex]?.client) {
      throw new Error(`No active WhatsApp client found for phone index: ${message.phoneIndex}`);
    }
    if (message.v2 == true) {
      console.log(`\n=== [Company ${companyId}] Processing V2 Message ===`);

      // Initialize messages array if empty
      if (!message.messages || message.messages.length === 0) {
        message.messages = message.chatIds.map(chatId => ({
          chatId: chatId,
          message: message.message,
          delay: Math.floor(Math.random() * (message.maxDelay - message.minDelay + 1) + message.minDelay),
          // Include media properties for each message
          mediaUrl: message.mediaUrl || '',
          documentUrl: message.documentUrl || '',
          fileName: message.fileName || ''
        }));
      }

      console.log(`[Company ${companyId}] Batch details:`, {
        messageId: message.messageId,
        infiniteLoop: message.infiniteLoop,
        activeHours: message.activeHours,
        messages: message.messages.map(m => ({
          chatId: m.chatId,
          messageLength: m.message?.length,
          delay: m.delay,
          hasMedia: Boolean(m.mediaUrl || message.mediaUrl || m.documentUrl || message.documentUrl)
        }))
      });

      const processMessage = (messageText, contact) => {
        if (messageText === null || messageText === undefined || messageText === '') {
          return '';  // Return empty string for null/undefined/empty messageText
        }

        let processedMessage = messageText;
        const placeholders = {
            contactName: contact?.contactName || '',
            firstName: contact?.firstName || '',
            lastName: contact?.lastName || '',
            email: contact?.email || '',
            phone: contact?.phone || '',
            vehicleNumber: contact?.vehicleNumber || '',
            branch: contact?.branch || '',
            expiryDate: contact?.expiryDate || '',
            ic: contact?.ic || ''
        };

        // Replace all placeholders in the message
        Object.entries(placeholders).forEach(([key, value]) => {
          const placeholder = `@{${key}}`;
          if (typeof processedMessage === 'string') {
            processedMessage = processedMessage.replace(new RegExp(placeholder, 'g'), value);
          }
        });

        // Process custom fields if they exist
        if (contact?.customFields && typeof contact.customFields === 'object' && typeof processedMessage === 'string') {
          console.log(`[Custom Fields] Processing custom fields for contact:`, 
            Object.keys(contact.customFields).length > 0 ? 
            `Found ${Object.keys(contact.customFields).length} custom fields` : 
            'No custom fields found');
            
          Object.entries(contact.customFields).forEach(([key, value]) => {
            const customPlaceholder = `@{${key}}`;
            const stringValue = value !== null && value !== undefined ? String(value) : '';
            processedMessage = processedMessage.replace(new RegExp(customPlaceholder, 'g'), stringValue);
            
            if (processedMessage.indexOf(customPlaceholder) === -1) {
              console.log(`[Custom Fields] Replaced placeholder ${customPlaceholder} with value: ${stringValue}`);
            }
          });
        }

        return processedMessage;
      };

      const waitUntilNextDay = async () => {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        const timeUntilTomorrow = tomorrow - now;
        console.log(`Waiting ${timeUntilTomorrow / 1000 / 60} minutes until next day`);

        // Check if the message sequence should be stopped
        const messageDoc = await db.collection('companies')
          .doc(companyId)
          .collection('scheduledMessages')
          .doc(message.messageId)
          .get();

        if (!messageDoc.exists || messageDoc.data().status === 'stopped') {
          console.log('Message sequence stopped');
          return true;
        }

        // Wait until midnight
        await new Promise(resolve => setTimeout(resolve, timeUntilTomorrow));
        return false;
      };

      let currentMessageIndex = 0;
      let dayCount = 1;

      while (true) {
        console.log(`\n=== [Company ${companyId}] Processing Message Item ===`);
        const messageItem = message.messages[currentMessageIndex];
        console.log(`[Company ${companyId}] Current message item:`, {
          index: currentMessageIndex,
          chatId: messageItem.chatId,
          messageLength: messageItem.message?.length,
          delay: messageItem.delay
        });

        const { chatId, message: messageText, delay } = messageItem;
        const phone = chatId.split('@')[0];

        console.log(`[Company ${companyId}] Fetching contact data for:`, phone);
        const contactRef = db.collection('companies').doc(companyId)
          .collection('contacts').doc('+' + phone);
        const contactDoc = await contactRef.get();
        console.log(`[Company ${companyId}] Contact exists:`, contactDoc.exists);

        const contactData = contactDoc.exists ? contactDoc.data() : {};
        if (companyId === '0128' && contactData.tags && contactData.tags.includes('stop bot')) {
          console.log(`[Company ${companyId}] Skipping message - contact has 'stop bot' tag`);
          currentMessageIndex++;
          continue; // Skip to next message
        }
        const processedMessageText = processMessage(messageText || message.message, contactData);

        const sendCheckRef = db.collection('companies').doc(companyId).collection('sentFollowups').doc(chatId).collection('messages');
        const sendCheckSnapshot = await sendCheckRef.get();

        const today = new Date().toISOString().split('T')[0];
        const contentHash = Buffer.from(processedMessageText).toString('base64').substring(0, 20);
        const messageIdentifier = `${today}_${currentMessageIndex}_${contentHash}`;

        const messageAlreadySent = sendCheckSnapshot.docs.some(doc => doc.id === messageIdentifier);

        if (messageAlreadySent) {
          console.log(`[Company ${companyId}] Message already sent to ${chatId}, skipping...`);
          currentMessageIndex++;
          continue;
        }

        console.log(`[Company ${companyId}] Message prepared:`, {
          originalLength: messageText?.length,
          processedLength: processedMessageText?.length,
          hasPlaceholders: messageText !== processedMessageText,
          finalMessage: processedMessageText // Log the final message for debugging
        });

        if (delay > 0) {
          console.log(`[Company ${companyId}] Adding delay of ${delay} seconds`);
          await new Promise(resolve => setTimeout(resolve, delay * 1000));
        }

        try {
          console.log(`\n=== [Company ${companyId}] Sending Message ===`);
          
          // Check for media in both the individual message item and the parent message object
          const mediaUrl = messageItem.mediaUrl || message.mediaUrl || '';
          const documentUrl = messageItem.documentUrl || message.documentUrl || '';
          const fileName = messageItem.fileName || message.fileName || '';
          
          const endpoint = mediaUrl ? 'image' : 
                          documentUrl ? 'document' : 'text';
          
          const url = `${process.env.URL}api/v2/messages/${endpoint}/${companyId}/${chatId}`;
          
          console.log(`[Company ${companyId}] Request details:`, {
            endpoint,
            url,
            phoneIndex: message.phoneIndex,
            hasMedia: Boolean(mediaUrl || documentUrl),
            messageText: processedMessageText, // Log the message being sent
            mediaUrl: mediaUrl ? 'Present' : 'None',
            documentUrl: documentUrl ? 'Present' : 'None'
          });

          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              mediaUrl ? { 
                imageUrl: mediaUrl, 
                caption: processedMessageText, 
                phoneIndex: message.phoneIndex 
              } : documentUrl ? { 
                documentUrl: documentUrl, 
                filename: fileName, 
                caption: processedMessageText,
                phoneIndex: message.phoneIndex
              } : { 
                message: processedMessageText || message.message, // Fallback to original message
                phoneIndex: message.phoneIndex
              }
            )
          });

          console.log(`[Company ${companyId}] Send response:`, {
            status: response.status,
            ok: response.ok
          });

          if (!response.ok) {
            throw new Error(`Failed to send message: ${response.status}`);
          }

          await sendCheckRef.doc(messageIdentifier).set({
            sentAt: admin.firestore.Timestamp.now(),
            messageIndex: currentMessageIndex,
            messageContent: processedMessageText,
            messageType: endpoint,
            mediaUrl: mediaUrl || null,
            documentUrl: documentUrl || null
          });

          console.log(`[Company ${companyId}] Recorded message as sent with ID: ${messageIdentifier}`);

          if (companyId === '0148') {
            const messageTemplate = "Good day {customerName}!!! Will you be interested in giving try for our first trial session (60 minutes!!) for just RM99?? One step closer to achieving your goals 😊";

            const regexPattern = messageTemplate.replace('{customerName}', '.*');
            const regex = new RegExp(`^${regexPattern}$`);

            if (regex.test(processedMessageText)) {
              console.log(`[Company ${companyId}] Final message matches template. Adding 'Done Followup' tag.`);
              const phone = chatId.split('@')[0];
              const contactRef = db.collection('companies').doc(companyId)
                .collection('contacts').doc('+' + phone);

              await contactRef.update({
                tags: admin.firestore.FieldValue.arrayUnion('Done Followup')
              });

              console.log(`[Company ${companyId}] Added 'Done Followup' tag to contact ${phone}`);
            } else {
              console.log(`[Company ${companyId}] Final message does not match template. Skipping tag addition.`);
            }
          }

        } catch (error) {
          console.error(`\n=== [Company ${companyId}] Message Send Error ===`);
          console.error(`[Company ${companyId}] Error Type:`, error.name);
          console.error(`[Company ${companyId}] Error Message:`, error.message);
          console.error(`[Company ${companyId}] Stack:`, error.stack);
          throw error; // Propagate error to trigger job retry
        }

        currentMessageIndex++;
        console.log(`\n=== [Company ${companyId}] Sequence Status ===`);
        console.log({
          currentIndex: currentMessageIndex,
          totalMessages: message.messages.length,
          dayCount,
          willContinue: currentMessageIndex < message.messages.length || message.infiniteLoop
        });

        if (currentMessageIndex >= message.messages.length) {
          if (!message.infiniteLoop) {
            console.log(`[Company ${companyId}] Sequence complete - ending`);              
            break;
          }
          
          console.log(`[Company ${companyId}] Day ${dayCount} complete - preparing for next day`);
          const shouldStop = await waitUntilNextDay();
          if (shouldStop) {
            console.log(`[Company ${companyId}] Sequence stopped during day transition`);
            break;
          }
          
          currentMessageIndex = 0;
          dayCount++;
          console.log(`[Company ${companyId}] Starting day ${dayCount}`);
        }
      }
    } else {
      console.log(`[Company ${companyId}] Message is not V2 - skipping`);
    }
    
    console.log(`\n=== [Company ${companyId}] sendScheduledMessage Complete ===`);
    return { success: true };
  } catch (error) {
    console.error(`\n=== [Company ${companyId}] sendScheduledMessage Error ===`);
    console.error(`[Company ${companyId}] Error Type:`, error.name);
    console.error(`[Company ${companyId}] Error Message:`, error.message);
    console.error(`[Company ${companyId}] Stack:`, error.stack);
    
    // Log the error to the database for tracking
    try {
      await db.collection('companies')
        .doc(companyId)
        .collection('errors')
        .add({
          messageId: message.messageId || 'No messageId',
          errorType: error.name,
          errorMessage: error.message,
          stack: error.stack,
          timestamp: admin.firestore.Timestamp.now()
        });
    } catch (dbError) {
      console.error('Failed to log error to database:', dbError);
    }
    
    return { success: false, error };
  }
}

app.post('/api/schedule-message/:companyId/:messageId/stop', async (req, res) => {
  const { companyId, messageId } = req.params;

  try {
    await db.collection('companies')
      .doc(companyId)
      .collection('scheduledMessages')
      .doc(messageId)
      .update({
        status: 'stopped',
        stoppedAt: admin.firestore.Timestamp.now()
      });

    res.json({
      success: true,
      message: 'Message stopped successfully'
    });
  } catch (error) {
    console.error('Error stopping message:', error);
    res.status(500).json({
      error: 'Failed to stop message'
    });
  }
});

// Modify the scheduleAllMessages function
async function obiliterateAllJobs() {
  // Clear all existing jobs from the queue
  await messageQueue.obliterate({ force: true });
  console.log("Queue cleared successfully");

}

// Modify the scheduleAllMessages function
// Modify the scheduleAllMessages function
async function scheduleAllMessages() {
  const companiesSnapshot = await db.collection('companies').get();
  console.log('scheduleAllMessages');
  for (const companyDoc of companiesSnapshot.docs) {
    const companyId = companyDoc.id;
    const scheduledMessagesSnapshot = await companyDoc.ref.collection('scheduledMessages').get();

    for (const messageDoc of scheduledMessagesSnapshot.docs) {
      const messageId = messageDoc.id;
      const message = messageDoc.data();

      if (message.status === 'completed') {
        continue; // Skip completed messages
      }

      const batchesSnapshot = await messageDoc.ref.collection('batches').get();

      for (const batchDoc of batchesSnapshot.docs) {
        const batchId = batchDoc.id;
        const batchData = batchDoc.data();

        if (batchData.status === 'sent') {
          continue; // Skip sent batches
        }

        const delay = batchData.batchScheduledTime.toDate().getTime() - Date.now();

        // Check if the job already exists in the queue
        const existingJob = await messageQueue.getJob(batchId);
        if (!existingJob) {
          await messageQueue.add('send-message-batch',
            {
              companyId,
              messageId,
              batchId
            },
            {
              removeOnComplete: false,
              removeOnFail: false,
              delay: Math.max(delay, 0),
              jobId: batchId,
              priority: batchData.priority || PRIORITY.BULK
            }
          );
        }
      }
    }
  }
}


async function saveThreadIDFirebase(email, threadID,) {

  // Construct the Firestore document path
  const docPath = `user/${email}`;

  try {
    await db.doc(docPath).set({
      threadid: threadID
    }, { merge: true }); // merge: true ensures we don't overwrite the document, just update it
    //  console.log(`Thread ID saved to Firestore at ${docPath}`);
  } catch (error) {
    console.error('Error saving Thread ID to Firestore:', error);
  }
}

function setupMessageHandler(client, botName, phoneIndex) {
  client.on('message', async (msg) => {
    //console.log(`DEBUG: Message received for bot ${botName}`);
    try {
      // Check if there's a custom handler for this bot
      if (customHandlers[botName]) {
        await customHandlers[botName](client, msg, botName, phoneIndex);
      } else {
        // Use the default template handler if no custom handler is defined
        await handleNewMessagesTemplateWweb(client, msg, botName, phoneIndex);
      }
    } catch (error) {
      console.error(`ERROR in message handling for bot ${botName}:`, error);
    }
  });
}

function setupMessageCreateHandler(client, botName, phoneIndex) {
  client.on('message_create', async (msg) => {
    broadcastBotActivity(botName, true);
    try {
      const isFromHuman = msg.fromMe && msg.author;
      // Check if the message is from the current user (sent from another device)
      if (msg.fromMe) {
        const extractedNumber = '+' + msg.to.split('@')[0];

        let existingContact = await getContactDataFromDatabaseByPhone(extractedNumber, botName);
        const contactRef = db.collection('companies').doc(botName).collection('contacts').doc(extractedNumber);

        if (!existingContact) {
          const newContact = {
            additionalEmails: [],
            address1: null,
            assignedTo: null,
            businessId: null,
            chat: {
              contact_id: extractedNumber,
              id: msg.to,
              name: msg.to.split('@')[0],
              not_spam: true,
              tags: [],
              timestamp: Math.floor(Date.now() / 1000),
              type: 'contact',
              unreadCount: 0,
            },
            chat_id: msg.to,
            city: null,
            companyName: null,
            contactName: msg.to.split('@')[0],
            createdAt: admin.firestore.Timestamp.now(),
            id: extractedNumber,
            name: '',
            not_spam: false,
            phone: extractedNumber,
            phoneIndex: phoneIndex,
            pinned: false,
            profilePicUrl: '',
            tags: [],
            threadid: '',
            timestamp: 0,
            type: '',
            unreadCount: 0
          };

          await contactRef.set(newContact);
          existingContact = newContact;
          // console.log(`Created new contact for ${extractedNumber}`);
        }

        try {
          await addMessagetoFirebase(msg, botName, extractedNumber, phoneIndex);
          console.log('Message added to Firebase successfully');
        } catch (error) {
          console.error('Error adding message to Firebase:', error);
        }


        // Update last_message for the contact
        const lastMessage = {
          chat_id: msg.to,
          from: msg.from,
          from_me: true,
          id: msg.id._serialized,
          phoneIndex: phoneIndex,
          source: "",
          status: "sent",
          text: {
            body: msg.body
          },
          timestamp: Math.floor(Date.now() / 1000),
          phoneIndex: phoneIndex,
          type: msg.type === 'chat' ? 'text' : msg.type
        };

        try {
          await contactRef.update({
            last_message: lastMessage,
            timestamp: lastMessage.timestamp
          });
          console.log('Contact updated successfully');
        } catch (error) {
          console.error('Error updating contact:', error);
        }

        if (isFromHuman) {
          if (existingContact.threadid) {
            await handleOpenAIMyMessage(msg.body, existingContact.threadid);
          } else {
            try {
              const thread = await createThread();
              const threadID = thread.id;

              // Save thread ID to contact
              await contactRef.update({ threadid: threadID });
              await handleOpenAIMyMessage(msg.body, threadID);
            } catch (error) {
              console.error('Error creating AI thread:', error);
            }
          }

          const query = msg.body;
          const companyRef = db.collection("companies").doc(botName);
          const companyConfig = await companyRef.get();
          const aiTagResponses = companyConfig.statusAIResponses?.aiTag === true ? await getAITagResponses(botName) : [];
          const aiAssignResponses = companyConfig.statusAIResponses?.aiAssign === true ? await getAIAssignResponses(botName) : [];
          const aiImageResponses = companyConfig.statusAIResponses?.aiImage === true ? await getAIImageResponses(botName) : [];
          const aiVoiceResponses = companyConfig.statusAIResponses?.aiVoice === true ? await getAIVoiceResponses(botName) : [];
          const aiVideoResponses = companyConfig.statusAIResponses?.aiVideo === true ? await getAIVideoResponses(botName) : [];
          const aiDocumentResponses = companyConfig.statusAIResponses?.aiDocument === true ? await getAIDocumentResponses(botName) : [];
          const followUpTemplates = await getFollowUpTemplates(botName);

          let imageFound = false;
          let voiceFound = false;
          let videoFound = false;
          let tagFound = false;
          let documentFound = false;
          let assignFound = false;

          const botData = botMap.get(botName);
          if (!botData) {
            throw new Error(`WhatsApp client not found for this company: ${botName}`);
          }
          const client = botData[0].client;

          // For voice messages
          if (!voiceFound) {
            for (const response of aiVoiceResponses) {
              if (response.keywordSource === "own" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
                console.log('voice messages found for keywords:', response.keywords);
                for (let i = 0; i < response.voiceUrls.length; i++) {
                  try {
                    const caption = response.captions?.[i] || '';
                    const voiceMessage = await sendVoiceMessage(client, msg.from, response.voiceUrls[i], caption);
                    await addMessagetoFirebase(voiceMessage, botName, extractedNumber);
                    if (i < response.voiceUrls.length - 1) {
                      await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                  } catch (error) {
                    console.error(`Error sending voice message ${response.voiceUrls[i]}:`, error);
                    continue;
                  }
                }
              }
            }
          }

          // For images
          if (!imageFound) {
            for (const response of aiImageResponses) {
              if (response.keywordSource === "own" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
                console.log('images found for keywords:', response.keywords);
                for (const imageUrl of response.imageUrls) {
                  try {
                    const media = await MessageMedia.fromUrl(imageUrl);
                    const imageMessage = await client.sendMessage(msg.from, media);
                    await addMessagetoFirebase(imageMessage, botName, extractedNumber);
                  } catch (error) {
                    console.error(`Error sending image ${imageUrl}:`, error);
                    continue;
                  }
                }
              }
            }
          }

          // For assign
          if (!assignFound) {
            for (const response of aiAssignResponses) {
              if (response.keywordSource === "own" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
                console.log('Keyword match found:', response.keywords);
                try {
                  // Get the current assignment index
                  const stateRef = db.collection('companies').doc(botName).collection('botState').doc('assignmentState');
                  const stateDoc = await stateRef.get();
                  let currentIndex = 0;
                  if (stateDoc.exists) {
                    currentIndex = stateDoc.data().currentIndex || 0;
                  }

                  // Get employee list and calculate next employee
                  const employeeEmails = response.assignedEmployees;
                  if (employeeEmails.length === 0) {
                    console.log('No employees available for assignment');
                    continue;
                  }

                  const nextEmail = employeeEmails[currentIndex % employeeEmails.length];

                  // Find the matching keyword that triggered the assignment
                  const triggerKeyword = response.keywords.find(kw =>
                    query.toLowerCase().includes(kw.toLowerCase())
                  );

                  console.log('Trigger keyword found:', triggerKeyword);

                  // Fetch employee data
                  const employeeRef = db.collection('companies').doc(botName).collection('employee').doc(nextEmail);
                  const employeeDoc = await employeeRef.get();

                  if (employeeDoc.exists) {
                    const employeeData = employeeDoc.data();
                    console.log('Employee data:', employeeData);
                    console.log('Assigning with keyword:', triggerKeyword);

                    // Get contact name with fallback
                    const contactName = extractedNumber || 'Unknown Contact';
                    console.log('Using contact name:', contactName);

                    await assignToEmployee(
                      employeeData,
                      'Sales',
                      extractedNumber,
                      contactName,  // Changed from contactData.contactName to contactName
                      client,
                      botName,
                      triggerKeyword
                    );

                    // Update the assignment index for next time
                    const newIndex = (currentIndex + 1) % employeeEmails.length;
                    await stateRef.set({
                      currentIndex: newIndex,
                      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });

                    assignFound = true;
                    break;
                  } else {
                    console.log('Employee document not found:', nextEmail);
                  }
                } catch (error) {
                  console.error('Error in assignment process:', error);
                  console.error('Full error stack:', error.stack);
                  continue;
                }
              }
            }
          }

          // For video
          if (!videoFound) {
            for (const response of aiVideoResponses) {
              if (response.keywordSource === "own" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
                console.log('videos found for keywords:', response.keywords);
                for (let i = 0; i < response.videoUrls.length; i++) {
                  try {
                    const videoUrl = response.videoUrls[i];
                    const caption = response.captions?.[i] || '';
                    console.log(`Sending video ${i + 1}/${response.videoUrls.length}`);
                    console.log(`URL: ${videoUrl}`);

                    const media = await MessageMedia.fromUrl(videoUrl);
                    if (!media) {
                      throw new Error('Failed to load video from URL');
                    }

                    const videoMessage = await client.sendMessage(msg.from, media, {
                      caption: caption,
                      sendVideoAsGif: false // Set to true if you want to send as GIF
                    });
                    if (!videoMessage) {
                      throw new Error('Video send returned null');
                    }
                    await addMessagetoFirebase(videoMessage, botName, extractedNumber);
                    // Add delay between videos
                    await new Promise(resolve => setTimeout(resolve, 1000));
                  } catch (error) {
                    console.error(`Error sending video ${i}:`, error);
                    console.error('Full error:', error.stack);
                    continue;
                  }
                }
              }
            }
          }

          // For document
          if (!documentFound) {
            for (const response of aiDocumentResponses) {
              if (response.keywordSource === "own" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
                console.log('documents found for keyword ' + response.keywords);
                console.log('Document URLs:', response.documentUrls); // Debug log

                // Send all documents for this keyword
                for (let i = 0; i < response.documentUrls.length; i++) {
                  try {
                    const documentUrl = response.documentUrls[i];
                    console.log(`Sending document ${i + 1}/${response.documentUrls.length}`);
                    console.log(`URL: ${documentUrl}`);

                    const media = await MessageMedia.fromUrl(documentUrl);
                    if (!media) {
                      throw new Error('Failed to load document from URL');
                    }

                    // Use the document name from the response
                    const documentName = response.documentNames[i] || `document_${i + 1}`;
                    media.filename = documentName;

                    // If the mimetype is not set, try to infer it from the file extension
                    if (!media.mimetype) {
                      const ext = path.extname(documentName).toLowerCase();
                      switch (ext) {
                        case ".pdf":
                          media.mimetype = "application/pdf";
                          break;
                        case ".doc":
                        case ".docx":
                          media.mimetype = "application/msword";
                          break;
                        case ".xls":
                        case ".xlsx":
                          media.mimetype = "application/vnd.ms-excel";
                          break;
                        case ".ppt":
                        case ".pptx":
                          media.mimetype = "application/vnd.ms-powerpoint";
                          break;
                        case ".txt":
                          media.mimetype = "text/plain";
                          break;
                        case ".csv":
                          media.mimetype = "text/csv";
                          break;
                        case ".zip":
                          media.mimetype = "application/zip";
                          break;
                        case ".rar":
                          media.mimetype = "application/x-rar-compressed";
                          break;
                        default:
                          media.mimetype = "application/octet-stream";
                      }
                    }

                    const documentMessage = await client.sendMessage(msg.from, media, {
                      sendMediaAsDocument: true
                    });

                    if (!documentMessage) {
                      throw new Error('Document send returned null');
                    }

                    await addMessagetoFirebase(documentMessage, botName, extractedNumber);

                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
                  } catch (error) {
                    console.error(`Error sending document ${i}:`, error);
                    console.error('Full error:', error.stack);
                    continue;
                  }
                }
              }
            }
          }

          // For tags
          if (!tagFound) {
            for (const response of aiTagResponses) {
              if (
                response.keywordSource === "own" &&
                response.keywords.some((kw) => query.toLowerCase().includes(kw.toLowerCase()))
              ) {
                console.log("tags found for keywords:", response.keywords);
                try {
                  if (response.tagActionMode === "delete") {
                    // Delete specified tags from both response and firebaseTags
                    for (const tag of response.tags) {
                      // Remove from Firebase
                      await addtagbookedFirebase(extractedNumber, tag, botName, true);

                      console.log(`Removed tag: ${tag} from number: ${extractedNumber}`);

                      if (tag === 'pause followup') {
                        // Get the contact's current tags to find active followup templates
                        const contactDoc = await contactRef.get();
                        if (contactDoc.exists) {
                          const contactData = contactDoc.data();
                          const currentTags = contactData.tags || [];
                          
                          // Check each followup template to see if its tag is in the contact's tags
                          for (const template of followUpTemplates) {
                            // If the template has a tag that matches one of the contact's tags
                            if (template.triggerTags && template.triggerTags.some(templateTag => 
                              currentTags.includes(templateTag))) {
                              try {
                                // Call the API to resume follow-up sequence for this template
                                const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    requestType: "resumeTemplate",
                                    phone: extractedNumber,
                                    first_name: extractedNumber,
                                    phoneIndex: phoneIndex || 0,
                                    templateId: template.id,
                                    idSubstring: botName,
                                  }),
                                });

                                if (!apiResponse.ok) {
                                  console.error(
                                    `Failed to resume follow-up sequence for template ${template.id}:`,
                                    await apiResponse.text()
                                  );
                                } else {
                                  console.log(
                                    `Successfully resumed follow-up sequence for template ${template.id} with tag ${template.triggerTags.find(tag => currentTags.includes(tag))}`
                                  );
                                }
                              } catch (error) {
                                console.error(`Error resuming template messages:`, error);
                              }
                            }
                          }
                        }
                      }

                      // Check if any follow-up templates use this tag as a trigger tag
                      for (const template of followUpTemplates) {
                        if (template.triggerTags && template.triggerTags.includes(tag)) {
                          // Call the API to remove scheduled messages for this template
                          try {
                            const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                requestType: "removeTemplate",
                                phone: extractedNumber,
                                first_name: extractedNumber,
                                phoneIndex: phoneIndex || 0,
                                templateId: template.id,
                                idSubstring: botName,
                              }),
                            });

                            if (!apiResponse.ok) {
                              console.error(
                                `Failed to stop follow-up sequence for template ${template.id}:`,
                                await apiResponse.text()
                              );
                            } else {
                              console.log(
                                `Successfully removed follow-up sequence for template ${template.id} with tag ${tag}`
                              );
                            }
                          } catch (error) {
                            console.error(`Error removing template messages for tag ${tag}:`, error);
                          }
                        }
                      }
                    }
                  } else {
                    // Default behavior: remove specified tags first
                    for (const tagToRemove of response.removeTags || []) {
                      await addtagbookedFirebase(extractedNumber, tagToRemove, botName, true);

                      if (tagToRemove === 'pause followup') {
                        // Get the contact's current tags to find active followup templates
                        const contactDoc = await contactRef.get();
                        if (contactDoc.exists) {
                          const contactData = contactDoc.data();
                          const currentTags = contactData.tags || [];
                          
                          // Check each followup template to see if its tag is in the contact's tags
                          for (const template of followUpTemplates) {
                            // If the template has a tag that matches one of the contact's tags
                            if (template.triggerTags && template.triggerTags.some(templateTag => 
                              currentTags.includes(templateTag))) {
                              try {
                                // Call the API to resume follow-up sequence for this template
                                const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    requestType: "resumeTemplate",
                                    phone: extractedNumber,
                                    first_name: extractedNumber,
                                    phoneIndex: phoneIndex || 0,
                                    templateId: template.id,
                                    idSubstring: botName,
                                  }),
                                });

                                if (!apiResponse.ok) {
                                  console.error(
                                    `Failed to resume follow-up sequence for template ${template.id}:`,
                                    await apiResponse.text()
                                  );
                                } else {
                                  console.log(
                                    `Successfully resumed follow-up sequence for template ${template.id} with tag ${template.triggerTags.find(tag => currentTags.includes(tag))}`
                                  );
                                }
                              } catch (error) {
                                console.error(`Error resuming template messages:`, error);
                              }
                            }
                          }
                        }
                      }

                      // Check if any follow-up templates use this tag as a trigger tag
                      for (const template of followUpTemplates) {
                        if (template.triggerTags && template.triggerTags.includes(tagToRemove)) {
                          // Call the API to remove scheduled messages for this template
                          try {
                            const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                requestType: "removeTemplate",
                                phone: extractedNumber,
                                first_name: extractedNumber,
                                phoneIndex: phoneIndex || 0,
                                templateId: template.id,
                                idSubstring: botName,
                              }),
                            });

                            if (!apiResponse.ok) {
                              console.error(
                                `Failed to stop follow-up sequence for template ${template.id}:`,
                                await apiResponse.text()
                              );
                            } else {
                              console.log(
                                `Successfully removed follow-up sequence for template ${template.id} with tag ${tagToRemove}`
                              );
                            }
                          } catch (error) {
                            console.error(`Error removing template messages for tag ${tagToRemove}:`, error);
                          }
                        }
                      }
                    }

                    // Then add new tags
                    for (const tag of response.tags) {
                      await addtagbookedFirebase(extractedNumber, tag, botName);
                      console.log(`Added tag: ${tag} for number: ${extractedNumber}`);

                      // Check if any follow-up templates use this tag as a trigger tag
                      for (const template of followUpTemplates) {
                        if (template.triggerTags && template.triggerTags.includes(tag)) {
                          // Call the API to start follow-up sequence for this template
                          try {
                            const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                requestType: "startTemplate",
                                phone: extractedNumber,
                                first_name: extractedNumber,
                                phoneIndex: phoneIndex || 0,
                                templateId: template.id,
                                idSubstring: botName,
                              }),
                            });

                            if (!apiResponse.ok) {
                              console.error(
                                `Failed to start follow-up sequence for template ${template.id}:`,
                                await apiResponse.text()
                              );
                            } else {
                              console.log(
                                `Successfully started follow-up sequence for template ${template.id} with tag ${tag}`
                              );
                            }
                          } catch (error) {
                            console.error(`Error starting template messages for tag ${tag}:`, error);
                          }
                        }
                      }

                      if (tag === 'pause followup') {
                        // Get the contact's current tags to find active followup templates
                        const contactDoc = await contactRef.get();
                        if (contactDoc.exists) {
                          const contactData = contactDoc.data();
                          const currentTags = contactData.tags || [];
                          
                          // Check each followup template to see if its tag is in the contact's tags
                          for (const template of followUpTemplates) {
                            // If the template has a tag that matches one of the contact's tags
                            if (template.triggerTags && template.triggerTags.some(templateTag => 
                              currentTags.includes(templateTag))) {
                              try {
                                // Call the API to pause follow-up sequence for this template
                                const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    requestType: "pauseTemplate",
                                    phone: extractedNumber,
                                    first_name: extractedNumber,
                                    phoneIndex: phoneIndex || 0,
                                    templateId: template.id,
                                    idSubstring: botName,
                                  }),
                                });

                                if (!apiResponse.ok) {
                                  console.error(
                                    `Failed to pause follow-up sequence for template ${template.id}:`,
                                    await apiResponse.text()
                                  );
                                } else {
                                  console.log(
                                    `Successfully paused follow-up sequence for template ${template.id} with tag ${template.triggerTags.find(tag => currentTags.includes(tag))}`
                                  );
                                }
                              } catch (error) {
                                console.error(`Error pausing template messages:`, error);
                              }
                            }
                          }
                        }
                      }

                      if (tag === 'stop followup') {
                        // Get the contact's current tags to find active followup templates
                        const contactDoc = await contactRef.get();
                        if (contactDoc.exists) {
                          const contactData = contactDoc.data();
                          const currentTags = contactData.tags || [];
                          
                          // Check each followup template to see if its tag is in the contact's tags
                          for (const template of followUpTemplates) {
                            // If the template has a tag that matches one of the contact's tags
                            if (template.triggerTags && template.triggerTags.some(templateTag => 
                              currentTags.includes(templateTag))) {
                              try {
                                // Call the API to pause follow-up sequence for this template
                                const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    requestType: "removeTemplate",
                                    phone: extractedNumber,
                                    first_name: extractedNumber,
                                    phoneIndex: phoneIndex || 0,
                                    templateId: template.id,
                                    idSubstring: botName,
                                  }),
                                });

                                if (!apiResponse.ok) {
                                  console.error(
                                    `Failed to pause follow-up sequence for template ${template.id}:`,
                                    await apiResponse.text()
                                  );
                                } else {
                                  console.log(
                                    `Successfully paused follow-up sequence for template ${template.id} with tag ${template.triggerTags.find(tag => currentTags.includes(tag))}`
                                  );
                                }

                                await addtagbookedFirebase(extractedNumber, tag, botName, true);
                              } catch (error) {
                                console.error(`Error pausing template messages:`, error);
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                } catch (error) {
                  console.error(`Error handling tags for keywords ${response.keywords}:`, error);
                  continue;
                }
              }
            }
          }
        }

        const forceStopBotNames = [
          '001', '0100', '0101', '0102', '0119', 
          '0123', '0128', '0145', '0152', '0153', 
          '0156', '020', '040', '092'
        ];
        
        if (isFromHuman && forceStopBotNames.includes(botName)) {
          await contactRef.update({
            tags: admin.firestore.FieldValue.arrayUnion('stop bot')
          });
        }

        setTimeout(() => {
          broadcastBotActivity(botName, false);
        }, 10000);
      }
    } catch (error) {
      console.error(`ERROR in message_create handling for bot ${botName}:`, error);
    }
  });
}

async function sendVoiceMessage(client, chatId, voiceUrl, caption = '') {
  try {
    console.log('Sending voice message:', { chatId, voiceUrl, caption });

    // Download the audio file
    const response = await axios.get(voiceUrl, { responseType: 'arraybuffer' });
    const audioBuffer = Buffer.from(response.data);

    // Create MessageMedia object
    const media = new MessageMedia(
      'audio/mpeg', // Default MIME type for voice messages
      audioBuffer.toString('base64'),
      `voice_${Date.now()}.mp3` // Generate unique filename
    );

    // Send the voice message with options
    const messageOptions = {
      sendAudioAsVoice: true, // This ensures it's sent as a voice message
    };

    if (caption) {
      messageOptions.caption = caption;
    }

    const sent = await client.sendMessage(chatId, media, messageOptions);
    console.log('Voice message sent successfully');

    return sent;
  } catch (error) {
    console.error('Error sending voice message:', error);
    // Log detailed error information
    if (error.response) {
      console.error('Response error:', {
        status: error.response.status,
        data: error.response.data
      });
    }
    throw new Error(`Failed to send voice message: ${error.message}`);
  }
}

async function assignToEmployee(employee, role, contactID, contactName, client, idSubstring, triggerKeyword = '') {
  const employeeID = employee.phoneNumber.split('+')[1] + '@c.us';

  // Get current date and time in Malaysia timezone
  const currentDateTime = new Date().toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'medium',
    timeStyle: 'medium'
  });

  // Different message format for 0245
  const message = idSubstring === '0245'
    ? `Hello ${employee.name}, a new contact has been assigned to you:

Name: ${contactName}
Phone: ${contactID}
      
Triggered keyword: ${triggerKeyword ? `*${triggerKeyword}*` : '[No keyword trigger found]'}
      
Date & Time: ${currentDateTime}`
    : `Hello ${employee.name}, a new contact has been assigned to you:

Name: ${contactName}
Phone: ${contactID}

Kindly login to https://web.jutasoftware.co/login

Thank you.

Juta Teknologi`;

  await client.sendMessage(employeeID, message);
  await addtagbookedFirebase(contactID, employee.name, idSubstring);
  console.log(`Assigned ${role}: ${employee.name}`);
}

async function addtagbookedFirebase(contactID, tag, idSubstring, remove = false) {
  console.log(`${remove ? 'Removing' : 'Adding'} tag "${tag}" ${remove ? 'from' : 'to'} Firebase for contact ${contactID}`);
  const docPath = `companies/${idSubstring}/contacts/${contactID}`;
  const contactRef = db.doc(docPath);

  try {
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(contactRef);
      if (!doc.exists) {
        throw new Error("Contact document does not exist!");
      }

      let currentTags = doc.data().tags || [];
      if (remove) {
        // Remove tag if it exists
        if (currentTags.includes(tag)) {
          currentTags = currentTags.filter(t => t !== tag);
          transaction.update(contactRef, { tags: currentTags });
          console.log(`Tag "${tag}" removed successfully from contact ${contactID}`);
        } else {
          console.log(`Tag "${tag}" doesn't exist for contact ${contactID}`);
        }
      } else {
        // Add tag if it doesn't exist
        if (!currentTags.includes(tag)) {
          currentTags.push(tag);
          transaction.update(contactRef, { tags: currentTags });
          console.log(`Tag "${tag}" added successfully to contact ${contactID}`);
        } else {
          console.log(`Tag "${tag}" already exists for contact ${contactID}`);
        }
      }
    });
  } catch (error) {
    console.error('Error managing tags in Firebase:', error);
  }
}

app.get('/api/storage-pricing', async (req, res) => {
  try {
    const pricingRef = db.collection('companies').doc('0123').collection('pricing').doc('storage');
    const doc = await pricingRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Pricing data not found' });
    }

    const pricingData = doc.data();
    res.json({ success: true, data: pricingData });
  } catch (error) {
    console.error('Error fetching storage pricing:', error);
    res.status(500).json({ error: 'Failed to fetch pricing data' });
  }
});
async function handleOpenAIMyMessage(message, threadID) {
  // console.log('messaging manual')
  query = `You sent this to the user: ${message}. Please remember this for the next interaction. Do not re-send this query to the user, this is only for you to remember the interaction.`;
  await addMessageAssistant(threadID, query);
}
async function addMessageAssistant(threadId, message) {
  const response = await openai.beta.threads.messages.create(
    threadId,
    {
      role: "user",
      content: message
    }
  );
  //console.log(response);
  return response;
}
async function addMessagetoFirebase(msg, idSubstring, extractedNumber) {
  //console.log('Adding message to Firebase');
  //console.log('idSubstring:', idSubstring);
  //console.log('extractedNumber:', extractedNumber);

  if (!extractedNumber) {
    console.error('Invalid extractedNumber for Firebase document path:', extractedNumber);
    return;
  }

  if (!idSubstring) {
    console.error('Invalid idSubstring for Firebase document path');
    return;
  }
  let messageBody = msg.body;
  let audioData = null;
  let type = '';
  if (msg.type == 'chat') {
    type = 'text'
  } else if (msg.type == 'e2e_notification' || msg.type == 'notification_template') {
    return;
  } else {
    type = msg.type;
  }

  if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {
    //console.log('Voice message detected');
    const media = await msg.downloadMedia();
    const transcription = await transcribeAudio(media.data);
    //console.log('Transcription:', transcription);

    messageBody = transcription;
    audioData = media.data;
    // console.log(msg);
  }
  const messageData = {
    chat_id: msg.from,
    from: msg.from ?? "",
    from_me: msg.fromMe ?? false,
    id: msg.id._serialized ?? "",
    status: "delivered",
    text: {
      body: messageBody ?? ""
    },
    timestamp: msg.timestamp ?? 0,
    type: type,
  };

  if (msg.hasQuotedMsg) {
    const quotedMsg = await msg.getQuotedMessage();
    // Initialize the context and quoted_content structure
    messageData.text.context = {
      quoted_content: {
        body: quotedMsg.body
      }
    };
    const authorNumber = '+' + (quotedMsg.from).split('@')[0];
    const authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
    messageData.text.context.quoted_author = authorData ? authorData.contactName : authorNumber;
  }

  if ((msg.from).includes('@g.us')) {
    const authorNumber = '+' + (msg.author).split('@')[0];

    const authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
    if (authorData) {
      messageData.author = authorData.contactName;
    } else {
      messageData.author = msg.author;
    }
  }

  if (msg.type === 'audio' || msg.type === 'ptt') {
    messageData.audio = {
      mimetype: 'audio/ogg; codecs=opus', // Default mimetype for WhatsApp voice messages
      data: audioData // This is the base64 encoded audio data
    };
  }

  if (msg.hasMedia && (msg.type !== 'audio' || msg.type !== 'ptt')) {
    try {
      const media = await msg.downloadMedia();
      if (media) {
        if (msg.type === 'image') {
          messageData.image = {
            mimetype: media.mimetype,
            data: media.data,  // This is the base64-encoded data
            filename: msg._data.filename || "",
            caption: msg._data.caption || "",
          };
          // Add width and height if available
          if (msg._data.width) messageData.image.width = msg._data.width;
          if (msg._data.height) messageData.image.height = msg._data.height;
        } else if (msg.type === "document") {
          messageData.document = {
            mimetype: media.mimetype,
            data: media.data, // This is the base64-encoded data
            filename: msg._data?.filename || "document",
            caption: msg._data?.caption || "",
          };
          
          // Safely add optional document properties
          if (msg._data?.pageCount) messageData.document.pageCount = msg._data.pageCount;
          if (msg._data?.size) messageData.document.fileSize = msg._data.size;
        } else if (msg.type === 'video') {
          messageData.video = {
            mimetype: media.mimetype,
            filename: msg._data.filename || "",
            caption: msg._data.caption || "",
          };
          // Store video data separately or use a cloud storage solution
          const videoUrl = await storeVideoData(media.data, msg._data.filename);
          messageData.video.link = videoUrl;
        } else {
          messageData[msg.type] = {
            mimetype: media.mimetype,
            data: media.data,
            filename: msg._data.filename || "",
            caption: msg._data.caption || "",
          };
        }

        // Add thumbnail information if available
        if (msg._data.thumbnailHeight && msg._data.thumbnailWidth) {
          messageData[msg.type].thumbnail = {
            height: msg._data.thumbnailHeight,
            width: msg._data.thumbnailWidth,
          };
        }

        // Add media key if available
        if (msg.mediaKey) {
          messageData[msg.type].mediaKey = msg.mediaKey;
        }


      } else {
        // console.log(`Failed to download media for message: ${msg.id._serialized}`);
        messageData.text = { body: "Media not available" };
      }
    } catch (error) {
      // console.error(`Error handling media for message ${msg.id._serialized}:`, error);
      messageData.text = { body: "Error handling media" };
    }
  }

  const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
  const messagesRef = contactRef.collection('messages');

  const messageDoc = messagesRef.doc(msg.id._serialized);
  await messageDoc.set(messageData, { merge: true });
  // console.log('message saved');
}
async function transcribeAudio(audioData) {
  try {
    const formData = new FormData();
    formData.append('file', Buffer.from(audioData, 'base64'), {
      filename: 'audio.ogg',
      contentType: 'audio/ogg',
    });
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json');

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${process.env.OPENAIKEY}`,
      },
    });

    return response.data.text;
  } catch (error) {
    console.error('Error transcribing audio:', error);
    return '';
  }
}
async function storeVideoData(videoData, filename) {
  const bucket = admin.storage().bucket();
  const uniqueFilename = `${uuidv4()}_${filename}`;
  const file = bucket.file(`videos/${uniqueFilename}`);

  await file.save(Buffer.from(videoData, 'base64'), {
    metadata: {
      contentType: 'video/mp4', // Adjust this based on the actual video type
    },
  });

  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: '03-01-2500', // Adjust expiration as needed
  });

  return url;
}
//console.log('Server starting - version 2'); // Add this line at the beginning of the file
app.delete('/api/auth/user', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required in request body' });
  }

  try {
    // Get the user by email
    const userRecord = await admin.auth().getUserByEmail(email);

    // Delete the user
    await admin.auth().deleteUser(userRecord.uid);

    // Also delete the user's data from Firestore if needed
    await db.collection('user').doc(email).delete();

    // console.log(`Successfully deleted user with email: ${email}`);
    res.json({ success: true, message: 'User deleted successfully' });

  } catch (error) {
    console.error('Error deleting user:', error);

    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(500).json({
      error: 'Failed to delete user',
      code: error.code,
      message: error.message
    });
  }
});

async function saveContactWithRateLimit(botName, contact, chat, phoneIndex, client, retryCount = 0) {
  try {
    let phoneNumber = contact.number;
    let contactID = contact.id._serialized;
    const msg = chat.lastMessage || {};
    if (Object.keys(msg).length === 0) {
      return; // Skip if there's no last message
    }

    let idsuffix = chat.isGroup ? '@g.us' : '@c.us';
    if (chat.isGroup) {
      phoneNumber = contactID.split('@')[0];
    }

    if (contactID === '0@c.us' || phoneNumber === 'status') {
      return; // Skip system contacts
    }

    const extractedNumber = '+' + contactID.split('@')[0];

    // Fetch existing contact data
    const existingContact = await getContactDataFromDatabaseByPhone(extractedNumber, botName);
    let tags = existingContact?.tags || [];

    let type = msg.type === 'chat' ? 'text' :
      (msg.type === 'e2e_notification' || msg.type === 'notification_template') ? null :
        msg.type;

    if (!type) return; // Skip if message type is not valid

    const contactData = {
      additionalEmails: existingContact?.additionalEmails || [],
      address1: existingContact?.address1 || null,
      assignedTo: existingContact?.assignedTo || null,
      businessId: existingContact?.businessId || null,
      phone: extractedNumber,
      tags: tags,
      chat: {
        contact_id: existingContact?.chat?.contact_id || '+' + phoneNumber,
        id: existingContact?.chat?.id || contactID || contact.id.user + idsuffix,
        name: existingContact?.chat?.name || contact.name || contact.pushname || chat.name || phoneNumber,
        not_spam: existingContact?.chat?.not_spam ?? true,
        tags: tags,
        timestamp: chat.timestamp || Date.now(),
        type: existingContact?.chat?.type || 'contact',
        unreadCount: chat.unreadCount || existingContact?.chat?.unreadCount || 0,
        last_message: {
          chat_id: contact.id.user + idsuffix,
          from: msg.from || contact.id.user + idsuffix,
          from_me: msg.fromMe || false,
          id: msg._data?.id?.id || '',
          source: chat.deviceType || '',
          status: "delivered",
          text: {
            body: msg.body || ''
          },
          timestamp: chat.timestamp || Date.now(),
          type: type,
        },
      },
      chat_id: existingContact?.chat_id || contact.id.user + idsuffix,
      city: existingContact?.city || null,
      companyName: existingContact?.companyName || null,
      contactName: existingContact?.contactName || contact.name || contact.pushname || chat.name || phoneNumber,
      unreadCount: chat.unreadCount || existingContact?.unreadCount || 0,
      threadid: existingContact?.threadid || '',
      phoneIndex: existingContact?.phoneIndex || phoneIndex,
      last_message: {
        chat_id: contact.id.user + idsuffix,
        from: msg.from || contact.id.user + idsuffix,
        from_me: msg.fromMe || false,
        id: msg._data?.id?.id || '',
        source: chat.deviceType || '',
        status: "delivered",
        text: {
          body: msg.body || ''
        },
        timestamp: chat.timestamp || Date.now(),
        type: type,
      },
    };

    // Fetch profile picture URL
    try {
      contactData.profilePicUrl = existingContact?.profilePicUrl || await contact.getProfilePicUrl() || "";
    } catch (error) {
      console.error(`Error getting profile picture URL for ${contact.id.user}:`, error);
      contactData.profilePicUrl = existingContact?.profilePicUrl || "";
    }

    // Save contact data
    const contactRef = db.collection('companies').doc(botName).collection('contacts').doc(extractedNumber);
    await contactRef.set(contactData, { merge: true });

    const companyRef = db.collection('companies').doc(botName);
    const companySnapshot = await companyRef.get();
    const companyData = companySnapshot.data();
    const trial = !companyData?.trialEndDate;
    let messages;

    if (trial) {
      messages = await chat.fetchMessages();
    } else {
      messages = await chat.fetchMessages({ limit: 200 });
    }

    if (messages && messages.length > 0) {
      await saveMessages(botName, extractedNumber, messages, chat.isGroup);
    }

  } catch (error) {
    console.error(`Error saving contact for bot ${botName}:`, error);
    if (retryCount < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      await saveContactWithRateLimit(botName, contact, chat, phoneIndex, client, retryCount + 1);
    }
  }
}

async function saveMessages(botName, phoneNumber, messages, isGroup) {
  const contactRef = db.collection('companies').doc(botName).collection('contacts').doc(phoneNumber);
  const messagesRef = contactRef.collection('messages');
  const sortedMessages = messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  let batch = db.batch();
  let count = 0;

  for (const message of sortedMessages) {
    const type = message.type === 'chat' ? 'text' : message.type;

    const messageData = {
      chat_id: message.from,
      from: message.from ?? "",
      from_me: message.fromMe ?? false,
      id: message.id._serialized ?? "",
      source: message.deviceType ?? "",
      status: "delivered",
      timestamp: message.timestamp ?? 0,
      type: type,
      ack: message.ack ?? 0,
    };

    if (isGroup && message.author) {
      messageData.author = message.author;
    }

    // Handle different message types
    if (type === 'text') {
      messageData.text = { body: message.body ?? "" };
    } else if (['image', 'video', 'document'].includes(type) && message.hasMedia) {
      try {
        const media = await message.downloadMedia();
        if (media) {
          const url = await saveMediaLocally(media.data, media.mimetype, media.filename || `${type}.${media.mimetype.split('/')[1]}`);
          messageData[type] = {
            mimetype: media.mimetype,
            url: url,
            filename: media.filename ?? "",
            caption: message.body ?? "",
          };
          if (type === 'image') {
            messageData[type].width = message._data.width;
            messageData[type].height = message._data.height;
          }
        } else {
          messageData.text = { body: "Media not available" };
        }
      } catch (error) {
        console.error(`Error handling media for message ${message.id._serialized}:`, error);
        messageData.text = { body: "Error handling media" };
      }
    } else {
      messageData.text = { body: message.body ?? "" };
    }

    const messageDoc = messagesRef.doc(message.id._serialized);
    batch.set(messageDoc, messageData, { merge: true });

    count++;
    if (count >= 500) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }

    broadcastProgress(botName, 'saving_messages', count / sortedMessages.length);
  }

  if (count > 0) {
    await batch.commit();
  }

  // console.log(`Saved ${sortedMessages.length} messages for contact ${phoneNumber}`);
  broadcastProgress(botName, 'saving_messages', 1);
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getContactDataFromDatabaseByPhone(phoneNumber, idSubstring) {
  try {
    // Check if phoneNumber is defined
    if (!phoneNumber) {
      throw new Error("Phone number is undefined or null");
    }

    // Initial fetch of config
    //await fetchConfigFromDatabase(idSubstring);

    let threadID;
    let contactName;
    let bot_status;
    const contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
    const querySnapshot = await contactsRef.where('phone', '==', phoneNumber).get();

    if (querySnapshot.empty) {
      //console.log('No matching documents.');
      return null;
    } else {
      const doc = querySnapshot.docs[0];
      const contactData = doc.data();

      return { ...contactData };
    }
  } catch (error) {
    // console.error('Error fetching or updating document:', error);
    throw error;
  }
}

async function getContactDataFromDatabaseByPhone(phoneNumber, idSubstring) {
  try {
    // Check if phoneNumber is defined
    if (!phoneNumber) {
      throw new Error("Phone number is undefined or null");
    }

    // Initial fetch of config
    //await fetchConfigFromDatabase(idSubstring);

    let threadID;
    let contactName;
    let bot_status;
    const contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
    const querySnapshot = await contactsRef.where('phone', '==', phoneNumber).get();

    if (querySnapshot.empty) {
      // console.log('No matching documents.');
      return null;
    } else {
      const doc = querySnapshot.docs[0];
      const contactData = doc.data();
      contactName = contactData.name;
      threadID = contactData.thread_id;
      bot_status = contactData.bot_status;
      return { ...contactData };
    }
  } catch (error) {
    console.error('Error fetching or updating document:', error);
    throw error;
  }
}

async function processChats(client, botName, phoneIndex) {
  try {
    const chats = await client.getChats();
    const totalChats = chats.length;
    let processedChats = 0;

    for (const chat of chats) {
      if (chat.isGroup) {
        processedChats++;
        continue;
      }
      const contact = await chat.getContact();
      await saveContactWithRateLimit(botName, contact, chat, phoneIndex, client);
      processedChats++;

      broadcastProgress(botName, 'processing_chats', processedChats / totalChats, phoneIndex);
    }
    console.log(`Finished saving contacts for bot ${botName} Phone ${phoneIndex + 1}`);
  } catch (error) {
    // console.error(`Error processing chats for bot ${botName} Phone ${phoneIndex + 1}:`, error);
  }
}

async function recoverScheduledJobs() {
  const CHUNK_SIZE = 200; // Increased from 50 to 200
  const COMPANY_CONCURRENCY = 3; // Process multiple companies simultaneously
  console.log('Starting scheduled jobs recovery process');

  try {
    const companiesSnapshot = await db.collection('companies').get();
    const companies = companiesSnapshot.docs;

    // Process companies in parallel
    for (let i = 0; i < companies.length; i += COMPANY_CONCURRENCY) {
      const companyChunk = companies.slice(i, i + COMPANY_CONCURRENCY);
      await Promise.all(companyChunk.map(async (companyDoc) => {
        const companyId = companyDoc.id;
        console.log(`Processing company ${companyId}`);

        // Get scheduled messages and valid batches in one query
        const now = Date.now();
        const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000);

        const scheduledMessagesSnapshot = await companyDoc.ref
          .collection('scheduledMessages')
          .where('status', '==', 'scheduled')
          .where('scheduledTime', '>=', admin.firestore.Timestamp.fromMillis(twoDaysAgo))
          .get();

        const queue = getQueueForBot(companyId);
        const existingJobs = await queue.getJobs(['waiting', 'delayed', 'active']);
        const existingJobIds = new Set(existingJobs.map(job => job.id));

        // Process messages in parallel
        await Promise.all(scheduledMessagesSnapshot.docs.map(async (messageDoc) => {
          const batchesSnapshot = await messageDoc.ref.collection('batches').get();
          const batches = batchesSnapshot.docs
            .map(batchDoc => ({
              companyId,
              messageId: messageDoc.id,
              batchId: batchDoc.id,
              scheduledTime: batchDoc.data().batchScheduledTime.toDate().getTime(),
              priority: batchDoc.data().priority || 0
            }))
            .filter(batch => !existingJobIds.has(batch.batchId))
            .sort((a, b) => a.scheduledTime - b.scheduledTime);

          // Process batches in chunks
          for (let j = 0; j < batches.length; j += CHUNK_SIZE) {
            const batchChunk = batches.slice(j, j + CHUNK_SIZE);
            await processJobChunk(batchChunk, queue);

            // Minimal delay between chunks
            if (batchChunk.length === CHUNK_SIZE) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }));
      }));
    }

    console.log('Job recovery completed successfully');
  } catch (error) {
    console.error('Error in job recovery:', error);
    throw error;
  }
}

async function processJobChunk(batches, queue) {
  const operations = batches.map(batch => {
    const { companyId, messageId, batchId, scheduledTime, priority } = batch;
    const delay = Math.max(scheduledTime - Date.now(), 0);

    return queue.add(
      'send-message-batch',
      { companyId, messageId, batchId },
      {
        delay,
        jobId: batchId,
        priority,
        removeOnComplete: false,
        removeOnFail: false
      }
    ).catch(error => {
      console.error(`Error processing batch ${batchId}:`, error);
      return null;
    });
  });

  await Promise.all(operations);
}


async function main(reinitialize = false) {
  console.log('Initialization starting...');

  // 1. Fetch companies in parallel with other initialization tasks
  const companiesPromise = db.collection('companies').get();


  // 2. If reinitializing, start cleanup early
  const cleanupPromise = reinitialize ? (async () => {
    console.log('Reinitializing, clearing existing bot instances...');
    await Promise.all([...botMap.entries()].map(async ([_, botData]) => {
      if (Array.isArray(botData)) {
        await Promise.all(botData.map(async (clientData) => {
          if (clientData.client) await clientData.client.destroy();
        }));
      } else if (botData?.client) {
        await botData.client.destroy();
      }
    })); g
    botMap.clear();
  })() : Promise.resolve();

  // 3. Clear existing jobs first
  console.log('Clearing existing jobs...');
  await obiliterateAllJobs();

  // 4. Recover jobs in chunks
  console.log('Starting job recovery...');
  await recoverScheduledJobs();

  // 4. Wait for initial setup tasks
  const [snapshot] = await Promise.all([
    companiesPromise,
    cleanupPromise
  ]);
  // Helper function to check if all bots are initialized
  const checkBotsInitialized = async (maxAttempts = 30) => {
    let failedBots = new Set();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Track newly initialized bots
      let newlyInitialized = false;

      // Check each bot's status
      [...botMap.entries()].forEach(([botName, botData]) => {
        if (Array.isArray(botData)) {
          botData.forEach((data, index) => {
            const key = `${botName}[${index}]`;
            if (!failedBots.has(key) && (!data.client || !data.client.ready)) {
              if (attempt === maxAttempts - 1) {
                failedBots.add(key);
              }
            } else if (failedBots.has(key) && data.client && data.client.ready) {
              failedBots.delete(key);
              newlyInitialized = true;
            }
          });
        } else {
          if (!failedBots.has(botName) && (!botData?.client || !botData?.client.ready)) {
            if (attempt === maxAttempts - 1) {
              failedBots.add(botName);
            }
          } else if (failedBots.has(botName) && botData?.client && botData?.client.ready) {
            failedBots.delete(botName);
            newlyInitialized = true;
          }
        }
      });

      // If all bots are initialized
      if (failedBots.size === 0) {
        console.log('All bots successfully initialized');
        return true;
      }

      // If we have new initializations, log progress
      if (newlyInitialized) {
        console.log(`${failedBots.size} bots remaining to initialize...`);
      }

      // On last attempt, log failed bots but don't throw error
      if (attempt === maxAttempts - 1) {
        console.warn('Some bots failed to initialize:');
        failedBots.forEach(bot => console.warn(`- ${bot}`));
        console.warn('Continuing server startup with partial bot initialization');
        return false;
      }

      console.log(`Waiting for bots to initialize... Attempt ${attempt + 1}/${maxAttempts}`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }

    return false;
  };

  if (process.env.URL?.includes('mighty-dane-newly.ngrok-free.app')) {
    const botConfigs = snapshot.docs
      .filter(doc => {
        const data = doc.data();
        return data.v2 && data.ec2 == null && data.apiUrl == null;
      })
      .map(doc => ({
        botName: doc.id,
        phoneCount: doc.data().phoneCount || 1,
        v2: true
      }))
      .sort((a, b) => {
        const aNum = parseFloat(a.botName);
        const bNum = parseFloat(b.botName);

        if (!isNaN(aNum) && !isNaN(bNum)) {
          return aNum - bNum;
        }
        return a.botName.localeCompare(b.botName, undefined, { numeric: true, sensitivity: 'base' });
      });

    console.log(`Found ${botConfigs.length} bots to initialize (excluding EC2 instances)`);

    const initializeBotsWithDelay = async (botConfigs) => {
      console.log(`Starting concurrent initialization of ${botConfigs.length} bots...`);

      const initializationPromises = botConfigs.map(config => {
        console.log(`Starting initialization of bot ${config.botName} with ${config.phoneCount} phone(s)...`);

        return initializeBot(config.botName, config.phoneCount)
          .then(() => {
            console.log(`Successfully initialized bot ${config.botName}`);
          })
          .catch(error => {
            console.error(`Error in initialization of bot ${config.botName}:`, error.message);
          });
      });

      await Promise.all(initializationPromises);
      console.log('Completed initialization of all bots');
    };

    await initializeBotsWithDelay(botConfigs);
  } else {
    const botConfigs = snapshot.docs
      .filter(doc => {
        const data = doc.data();
        return data.v2 && (data.apiUrl === 'https://juta.ngrok.app');
      })
      .map(doc => ({
        botName: doc.id,
        phoneCount: doc.data().phoneCount || 1,
        v2: true
      }))
      .sort((a, b) => {
        const aNum = parseFloat(a.botName);
        const bNum = parseFloat(b.botName);

        if (!isNaN(aNum) && !isNaN(bNum)) {
          return aNum - bNum;
        }
        return a.botName.localeCompare(b.botName, undefined, { numeric: true, sensitivity: 'base' });
      });

    console.log(`Found ${botConfigs.length} bots to initialize (excluding EC2 instances)`);
    const initializeBotsWithDelay = async (botConfigs) => {
      console.log(`Starting batch initialization of ${botConfigs.length} bots...`);
      const BATCH_SIZE = 50;
      const BATCH_DELAY = 30000; // 10 seconds

      try {
        // Split configs into batches of 10
        for (let i = 0; i < botConfigs.length; i += BATCH_SIZE) {
          const batch = botConfigs.slice(i, i + BATCH_SIZE);
          const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
          const totalBatches = Math.ceil(botConfigs.length / BATCH_SIZE);

          console.log(`\n=== Starting Batch ${batchNumber}/${totalBatches} (${batch.length} bots) ===`);
          console.log('Batch contents:', batch.map(b => b.botName).join(', '));

          // Start all bots in current batch without waiting for completion
          batch.forEach(config => {
            initializeBot(config.botName, config.phoneCount)
              .then(() => {
                console.log(`Successfully initialized bot ${config.botName}`);
              })
              .catch(error => {
                console.error(`Error initializing bot ${config.botName}:`, error);
              });
          });

          // Wait 10 seconds before starting next batch, regardless of completion
          if (i + BATCH_SIZE < botConfigs.length) {
            console.log(`Waiting ${BATCH_DELAY / 1000} seconds before starting next batch...`);
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
          }
        }

        console.log('\n=== Started initialization of all bot batches ===');
      } catch (error) {
        console.error('Fatal error in batch initialization:', error);
        throw error;
      }
    };

    await initializeBotsWithDelay(botConfigs);
  }

  try {
    // Wait for all bots to be fully initialized
    await checkBotsInitialized();

    await initializeAutomations(botMap);
    // Requeue messages after everything is ready
    console.log('Starting initial message requeue after initialization');
    /* try {
         const response = await fetch(`http://localhost:${process.env.PORT}/api/requeue-scheduled-messages`, {
           method: 'POST',
           timeout: 60000 // 30 second timeout
         });
         
         if (!response.ok) {
           throw new Error(`HTTP error! status: ${response.status}`);
         }
         
         const result = await response.json();
         console.log('Initial requeue completed:', result);
       } catch (requeueError) {
         console.error('Error during message requeue:', requeueError);
         // Continue execution even if requeue fails
       }*/

    console.log('Initialization complete');
    if (process.send) process.send('ready');
  } catch (error) {
    console.error('Error during final initialization steps:', error);
    // You might want to handle this error appropriately
    throw error;
  }
}

const automationInstances = {
  bhqSpreadsheet: new bhqSpreadsheet(botMap),
  mtdcSpreadsheet: new mtdcSpreadsheet(botMap),
  appointmentWatcher: new appointmentWatcher()
};

// Define the function to initialize automations
async function initializeAutomations(botMap) {
  console.log('Starting automation systems initialization...');
  const initPromises = [
    scheduleAllMessages(),
    automationInstances.bhqSpreadsheet.initialize(),
    automationInstances.mtdcSpreadsheet.initialize(),
    automationInstances.appointmentWatcher.initialize(),
    initializeDailyReportCrons(),
    initializeDuplicateCheckAndRemove(),
  ];

  await Promise.all(initPromises);
  console.log('All automation systems initialized');
}

async function initializeDailyReportCrons() {
  const companiesSnapshot = await db.collection('companies').get();
  for (const companyDoc of companiesSnapshot.docs) {
    const companyId = companyDoc.id;
    const settingsRef = companyDoc.ref.collection('settings').doc('reporting');
    const settingsSnapshot = await settingsRef.get();
    const settings = settingsSnapshot.data();
    if (settings && settings.dailyReport && settings.dailyReport.enabled) {
      const { time, groupId } = settings.dailyReport;
      const [hour, minute] = time.split(':');
      const newCron = cron.schedule(`${minute} ${hour} * * *`, async () => {
        try {
          const botData = botMap.get(companyId);
          if (!botData || !botData[0]?.client) {
            console.error(`No WhatsApp client found for company ${companyId}`);
            return;
          }

          const count = await countTodayLeads(companyId);
          const message = `📊 Daily Lead Report\n\nNew Leads Today: ${count}\nDate: ${new Date().toLocaleDateString()}`;

          await botData[0].client.sendMessage(groupId, message);

          // Update last run time
          await settingsRef.update({
            'dailyReport.lastRun': admin.firestore.FieldValue.serverTimestamp()
          });
        } catch (error) {
          console.error(`Error sending daily report for company ${companyId}:`, error);
        }
      });
      dailyReportCrons.set(companyId, newCron);
    }
  }
}

async function initializeDuplicateCheckAndRemove() {
  console.log('Starting duplicate check and removal process');

  schedule.scheduleJob('0 0 * * *', checkAndRemoveDuplicates);

  console.log('Scheduled duplicate check and removal process to run every hour');
}

async function checkAndRemoveDuplicates() {
  const startTime = new Date();
  const dateString = startTime.toISOString().split('T')[0];
  const timeString = startTime.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
  const logRef = db.collection('duplicateCheckLogs').doc(dateString).collection(timeString);

  const logs = [];

  function log(message) {
    console.log(message);
    logs.push(message);
  }

  function logError(message) {
    console.error(message);
    logs.push(`ERROR: ${message}`);
  }

  log('Starting duplicate check and removal process');

  try {
    for (const [companyId, botData] of botMap.entries()) {
      const companyStartTime = new Date();
      const companyLogs = [];

      log(`Checking company: ${companyId}`);

      const queue = getQueueForBot(companyId);
      const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'paused']);

      const messageMap = new Map();
      let duplicatesFound = 0;
      let duplicatesRemoved = 0;
      let messagesRemoved = 0;

      for (const job of jobs) {
        const { messageId, batchId } = job.data;

        const batchRef = db.collection('companies').doc(companyId)
          .collection('scheduledMessages').doc(messageId)
          .collection('batches').doc(batchId);

        const batchDoc = await batchRef.get();

        if (batchDoc.exists) {
          const batchData = batchDoc.data();
          const key = JSON.stringify({
            messages: batchData.messages,
            scheduledTime: batchData.batchScheduledTime.toDate().getTime()
          });

          if (messageMap.has(key)) {
            // Duplicate found
            duplicatesFound++;
            companyLogs.push(`Duplicate found: message ${messageId}, batch ${batchId}`);

            // Remove the duplicate job from the queue
            await job.remove();

            // Remove the duplicate batch from Firebase
            await batchRef.delete();
            duplicatesRemoved++;

            // Check if all batches for this message are removed
            const remainingBatches = await db.collection('companies').doc(companyId)
              .collection('scheduledMessages').doc(messageId)
              .collection('batches').get();

            if (remainingBatches.empty) {
              // Remove the main message document if all batches are removed
              await db.collection('companies').doc(companyId)
                .collection('scheduledMessages').doc(messageId)
                .delete();
              companyLogs.push(`Removed main message document due to being empty: ${messageId}`);
              messagesRemoved++;
            }
          } else {
            messageMap.set(key, { jobId: job.id, messageId, batchId });
          }
        }
      }

      const companyEndTime = new Date();
      const companyDuration = (companyEndTime - companyStartTime) / 1000; // in seconds

      await logRef.doc(companyId).set({
        startTime: companyStartTime.toISOString(),
        endTime: companyEndTime.toISOString(),
        duration: companyDuration,
        duplicatesFound,
        duplicatesRemoved,
        messagesRemoved,
        logs: companyLogs
      });

      log(`Completed check for company ${companyId}`);
    }

    const endTime = new Date();
    const duration = (endTime - startTime) / 1000; // in seconds
    log('Duplicate check and removal process completed');

    await logRef.doc('summary').set({
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration,
      logs
    });

  } catch (error) {
    logError(`Error in duplicate check and removal process: ${error.message}`);

    await logRef.doc('error').set({
      startTime: startTime.toISOString(),
      endTime: new Date().toISOString(),
      error: error.message,
      logs
    });
  }
}

// Create an API endpoint to initialize automations
app.post('/api/initialize-automations', async (req, res) => {
  try {
    // Just await the function directly since it already handles Promise.all internally
    await initializeAutomations(botMap);
    res.json({ success: true, message: 'Automations initialized successfully' });
  } catch (error) {
    console.error('Error initializing automations:', error);
    res.status(500).json({ error: 'Failed to initialize automations' });
  }
});
// Remove the duplicate route handler and keep only this one
// ... existing code ...

app.post('/api/bots/reinitialize', async (req, res) => {
  try {
    const { botName } = req.body;

    // Get existing bot data
    const botData = botMap.get(botName);

    // Get the phone count from the company document
    const companyDoc = await db.collection('companies').doc(botName).get();
    if (!companyDoc.exists) {
      throw new Error('Company not found in database');
    }

    const phoneCount = companyDoc.data().phoneCount || 1;
    let sessionsCleaned = false;

    // First try normal reinitialization
    try {
      if (botData && Array.isArray(botData)) {
        // Bot exists - destroy clients carefully
        await Promise.all(botData.map(async (data, index) => {
          if (data?.client) {
            try {
              // Check if client is in a valid state before destroying
              if (data.client.pupPage && !data.client.pupPage.isClosed()) {
                await data.client.destroy();
              }
              // Initialize new client
              await data.client.initialize();
              console.log(`Reinitialized client ${index} for bot ${botName}`);
            } catch (error) {
              console.error(`Error handling client ${index} for ${botName}:`, error);
              // Don't throw - continue with other clients
            }
          }
        }));
      }

      // Wait a bit before continuing
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (initError) {
      console.error(`Initial reinitialization failed for ${botName}, cleaning sessions and retrying...`, initError);
      sessionsCleaned = true;
    }

    res.json({
      success: true,
      message: sessionsCleaned ?
        'Bot reinitialized successfully with clean session' :
        'Bot reinitialized successfully',
      phoneCount,
      sessionsCleaned
    });

  } catch (error) {
    console.error('Error reinitializing bot:', error);
    res.status(500).json({
      error: 'Failed to reinitialize bot',
      details: error.message
    });
  }
});
async function getContactDataFromDatabaseByEmail(email) {
  try {
    // Check if email is defined
    if (!email) {
      throw new Error("Email is undefined or null");
    }

    // Reference to the user document
    const userDocRef = db.collection('user').doc(email);
    const doc = await userDocRef.get();

    if (!doc.exists) {
      console.log('No matching document.');
      return null;
    } else {
      const userData = doc.data();
      return { ...userData };
    }
  } catch (error) {
    console.error('Error fetching or updating document:', error);
    throw error;
  }
}
async function createThread() {

  const thread = await openai.beta.threads.create();
  return thread;
}
async function addMessage(threadId, message) {
  const response = await openai.beta.threads.messages.create(
    threadId,
    {
      role: "user",
      content: message
    }
  );
  return response;
}
async function runAssistant(assistantID, threadId) {

  const response = await openai.beta.threads.runs.create(
    threadId,
    {
      assistant_id: assistantID
    }
  );

  const runId = response.id;

  const answer = await waitForCompletion(threadId, runId);
  return answer;
}
async function checkingStatus(threadId, runId) {
  const runObject = await openai.beta.threads.runs.retrieve(
    threadId,
    runId
  );
  const status = runObject.status;
  if (status == 'completed') {
    clearInterval(pollingInterval);

    const messagesList = await openai.beta.threads.messages.list(threadId);
    const latestMessage = messagesList.body.data[0].content;
    const answer = latestMessage[0].text.value;
    return answer;
  }
}
async function waitForCompletion(threadId, runId) {
  return new Promise((resolve, reject) => {
    pollingInterval = setInterval(async () => {
      const answer = await checkingStatus(threadId, runId);
      if (answer) {
        clearInterval(pollingInterval);
        resolve(answer);
      }
    }, 1000);
  });
}
// Extract user data from URL parameters
async function handleOpenAIAssistant(message, threadID, assistantid) {
  const assistantId = assistantid;
  await addMessage(threadID, message);
  const answer = await runAssistant(assistantId, threadID);
  return answer;
}
app.get('/api/assistant-test/', async (req, res) => {
  const message = req.query.message;
  const email = req.query.email;
  const assistantid = req.query.assistantid;
  console.log(`assistant-test for ${email}`);
  try {
    let threadID;
    const contactData = await getContactDataFromDatabaseByEmail(email);
    if (contactData.threadid) {
      threadID = contactData.threadid;
    } else {
      const thread = await createThread();
      threadID = thread.id;
      await saveThreadIDFirebase(email, threadID)
    }
    console.log(`assistant-test threadID for ${email}: ${threadID}`);

    const answer = await handleOpenAIAssistant(message, threadID, assistantid);
    console.log(`assistant-test answer for ${email}: ${answer}`);
    // Send success response
    res.json({ message: 'Assistant replied success', answer });
  } catch (error) {
    // Handle errors
    console.error('Assistant replied user:', error);

    res.status(500).json({ error: error.code });
  }
});
// ... existing code ...

app.get('/api/assistant-test-guest/', async (req, res) => {
  const message = req.query.message;
  const sessionId = req.query.sessionId; // Changed from email
  const assistantid = req.query.assistantid;

  try {
    let threadID;
    const sessionData = await getSessionDataFromDatabase(sessionId); // New function

    if (sessionData?.threadid) {
      threadID = sessionData.threadid;
    } else {
      const thread = await createThread();
      threadID = thread.id;
      await saveThreadIDForSession(sessionId, threadID); // New function
    }

    answer = await handleOpenAIAssistant(message, threadID, assistantid);

    // Send success response
    res.json({ message: 'Assistant replied success', answer });
  } catch (error) {
    // Handle errors
    console.error('Assistant replied user:', error);
    res.status(500).json({ error: error.code });
  }
});

// New function to get session data
async function getSessionDataFromDatabase(sessionId) {
  try {
    if (!sessionId) {
      throw new Error("Session ID is undefined or null");
    }

    const sessionRef = db.collection('sessions').doc(sessionId);
    const doc = await sessionRef.get();

    if (!doc.exists) {
      return null;
    }

    return doc.data();
  } catch (error) {
    console.error('Error fetching session data:', error);
    throw error;
  }
}

// New function to save thread ID for session
async function saveThreadIDForSession(sessionId, threadID) {
  try {
    const sessionRef = db.collection('sessions').doc(sessionId);
    await sessionRef.set({
      threadid: threadID,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('Error saving Thread ID for session:', error);
    throw error;
  }
}

// ... rest of existing code ...
app.post('/api/prompt-engineer/', async (req, res) => {
  try {
    const userInput = req.query.message;
    const email = req.query.email;
    const { currentPrompt } = req.body;

    // Log only relevant data
    console.log('Prompt Engineer Request:', {
      userInput,
      email,
      currentPrompt
    });

    let threadID;
    const contactData = await getContactDataFromDatabaseByEmail(email);

    if (contactData?.threadid) {
      threadID = contactData.threadid;
    } else {
      const thread = await createThread();
      threadID = thread.id;
      await saveThreadIDFirebase(email, threadID);
    }

    const promptInstructions = `As a prompt engineering expert, help me with the following prompt request. 
  
      When modifying an existing prompt:
      - Return the COMPLETE prompt with all sections
      - Only modify the specific elements requested by the user
      - Keep all other sections exactly as they are, word for word
      - Do not omit or summarize any sections
      - Do not add [AI's primary function] style placeholders to unchanged sections
      - Preserve all formatting, line breaks and structure
      
      Your response must be structured in two clearly separated parts using these exact markers:
      [ANALYSIS_START]
      Briefly explain what specific changes you made and why
      [ANALYSIS_END]
      
      [PROMPT_START]
      ${currentPrompt ? 'The complete prompt with ONLY the requested changes:' :
        'Create a new prompt using this structure:'}
      ${currentPrompt || `#ROLE: [AI's primary function and identity]
      #CONTEXT: [Business context and background]
      #CAPABILITIES: [Specific tasks and functions]
      #CONSTRAINTS: [Boundaries and limitations]
      #COMMUNICATION STYLE: [Tone and interaction approach]
      #WORKFLOW: [Process for handling requests]`}
      [PROMPT_END]
      
      ${currentPrompt ?
        `Current Prompt:\n${currentPrompt}\n\nRequested Changes:\n${userInput}` :
        `Create a new prompt with these requirements:\n${userInput}`}`;

    // Call OpenAI with o1-mini model
    const completion = await openai.chat.completions.create({
      model: "o1-mini",
      messages: [
        {
          role: "user",
          content: promptInstructions
        }
      ],
    });

    const answer = completion.choices[0].message.content;

    // Parse the response to separate analysis and prompt
    const analysisMatch = answer.match(/\[ANALYSIS_START\]([\s\S]*?)\[ANALYSIS_END\]/);
    const promptMatch = answer.match(/\[PROMPT_START\]([\s\S]*?)\[PROMPT_END\]/);

    const analysis = analysisMatch ? analysisMatch[1].trim() : '';
    const updatedPrompt = promptMatch ? promptMatch[1].trim() : '';

    // Save the interaction to the thread
    await addMessageAssistant(threadID, `User Request: ${userInput}\nCurrent Prompt: ${currentPrompt || 'None'}\nResponse: ${answer}`);

    // Send structured response
    res.json({
      success: true,
      data: {
        analysis: analysis,
        updatedPrompt: updatedPrompt,
        originalPrompt: currentPrompt || null
      }
    });

  } catch (error) {
    console.error('Prompt engineering error:', {
      name: error.name,
      message: error.message,
      code: error.code
    });
    res.status(500).json({
      success: false,
      error: error.code,
      details: error.message
    });
  }
});

app.get('/api/chats/:token/:locationId/:accessToken/:userName/:userRole/:userEmail/:companyId', async (req, res) => {
  const { token, locationId, accessToken, userName, userRole, userEmail, companyId } = req.params;


  let allChats = [];
  let count = 500;
  let offset = 0;
  let totalChats = 0;
  let contactsData = [];
  let fetchedChats = 0; // Track the number of fetched chats
  try {
    // Fetch user data to get notifications and pinned chats
    const userDocRef = db.collection('user').doc(userEmail);

    const notificationsRef = userDocRef.collection('notifications');
    const notificationsSnapshot = await notificationsRef.get();
    const notifications = notificationsSnapshot.docs.map(doc => doc.data());

    const pinnedChatsRef = userDocRef.collection('pinned');
    const pinnedChatsSnapshot = await pinnedChatsRef.get();
    const pinnedChats = pinnedChatsSnapshot.docs.map(doc => doc.data());
    let whapiToken2 = token;
    const companyDocRef = db.collection('companies').doc(companyId);
    const companyDoc = await companyDocRef.get();
    const companyData = companyDoc.data();
    whapiToken2 = companyData.whapiToken2 || token;

    // Fetch all chats from WhatsApp API
    if (token !== 'none') {

      while (true) {
        const response = await fetch(`https://gate.whapi.cloud/chats?count=${count}&offset=${offset}`, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await response.json();

        if (offset === 0 && data.total) {
          totalChats = data.total;
        }
        if (data.chats.length === 0) break;
        allChats = allChats.concat(data.chats);
        fetchedChats += data.chats.length; // Update the number of fetched chats
        offset += count;
      }
      count = 500;
      offset = 0;
      if (companyId === '018') {
        while (true) {
          const response = await fetch(`https://gate.whapi.cloud/chats?count=${count}&offset=${offset}`, {
            headers: { 'Authorization': 'Bearer ' + whapiToken2 }
          });
          const data = await response.json();
          if (offset === 0 && data.total) {
            totalChats = data.total;
          }
          if (data.chats.length === 0) break;
          allChats = allChats.concat(data.chats);
          fetchedChats += data.chats.length; // Update the number of fetched chats
          offset += count;
        }

      }
    }
    let totalContacts = 0;
    let lastContactId = null;
    let maxContacts = 3000;
    let maxRetries = 3;
    while (totalContacts < maxContacts) {
      let retries = 0;
      let contacts = [];  // Initialize contacts outside the retry loop

      const params = {
        locationId: locationId,
        limit: 100,
      };

      if (lastContactId) {
        params.startAfterId = lastContactId;
      }

      const response = await axios.get('https://services.leadconnectorhq.com/contacts/', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: '2021-07-28',
        },
        params: params
      });



      const metaTotal = response.data.meta.total;
      // console.log(metaTotal);
      if (metaTotal < maxContacts) {
        maxContacts = metaTotal;
      }

      contacts = response.data.contacts;
      contactsData.push(...contacts);
      totalContacts += contacts.length;

      if (contacts.length === 0 || totalContacts >= maxContacts) break;
      lastContactId = contacts[contacts.length - 1].id;

      if (contacts.length === 0) {
        console.log("No more contacts to fetch.");
        break;
      }

      if (totalContacts >= maxContacts) break;
    }


    // Ensure the contactsData does not exceed 3000 contacts
    if (contactsData.length > maxContacts) {
      contactsData.length = maxContacts;
    }
    // Ensure the contactsData does not exceed 3000 contacts
    if (contactsData.length > maxContacts) {
      contactsData.length = maxContacts;
    }

    // Process and merge chat and contact data
    const mappedChats = allChats.map(chat => {
      if (!chat.id) return null;
      const phoneNumber = `+${chat.id.split('@')[0]}`;
      const contact = contactsData.find(contact => contact.phone === phoneNumber);
      let unreadCount = notifications.filter(notif => notif.chat_id === chat.id && !notif.read).length;

      if (contact) {
        return {
          ...chat,
          tags: contact.tags || [],
          name: contact.contactName || chat.name,
          contact_id: contact.id,
          unreadCount,
          chat_pic: chat.chat_pic || null,
          chat_pic_full: chat.chat_pic_full || null,
        };
      } else {
        return {
          ...chat,
          tags: [],
          name: chat.name,
          contact_id: "",
          unreadCount,
          chat_pic: chat.chat_pic || null,
          chat_pic_full: chat.chat_pic_full || null,
        };
      }
    }).filter(Boolean);

    // Merge WhatsApp contacts with existing contacts
    mappedChats.forEach(chat => {
      const phoneNumber = `+${chat.id.split('@')[0]}`;
      const existingContact = contactsData.find(contact => contact.phone === phoneNumber);
      if (existingContact) {
        existingContact.chat_id = chat.id;
        existingContact.last_message = chat.last_message || existingContact.last_message;
        existingContact.chat = chat;
        existingContact.unreadCount = (existingContact.unreadCount || 0) + chat.unreadCount;
        existingContact.tags = [...new Set([...existingContact.tags, ...chat.tags])];
        existingContact.chat_pic = chat.chat_pic;
        existingContact.chat_pic_full = chat.chat_pic_full;
      } else {
        contactsData.push({
          id: chat.contact_id,
          phone: phoneNumber,
          contactName: chat.name,
          chat_id: chat.id,
          last_message: chat.last_message || null,
          chat: chat,
          tags: chat.tags,
          conversation_id: chat.id,
          unreadCount: chat.unreadCount,
          chat_pic: chat.chat_pic,
          chat_pic_full: chat.chat_pic_full,
        });
      }
    });

    // Add pinned status to contactsData
    contactsData.forEach(contact => {
      contact.pinned = pinnedChats.some(pinned => pinned.chat_id === contact.chat_id);
    });

    // Sort contactsData by pinned status and last_message timestamp
    contactsData.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      const dateA = a.last_message?.createdAt
        ? new Date(a.last_message.createdAt)
        : a.last_message?.timestamp
          ? new Date(a.last_message.timestamp * 1000)
          : new Date(0);
      const dateB = b.last_message?.createdAt
        ? new Date(b.last_message.createdAt)
        : b.last_message?.timestamp
          ? new Date(b.last_message.timestamp * 1000)
          : new Date(0);
      return dateB - dateA;
    });

    // Filter contacts by user role if necessary
    let filteredContacts = contactsData;
    //console.log(filteredContacts.length);
    if (userRole === '2') {
      filteredContacts = contactsData.filter(contact => contact.tags.some(tag => typeof tag === 'string' && tag.toLowerCase().includes(userName.toLowerCase())));
      const groupChats = contactsData.filter(contact => contact.chat_id && contact.chat_id.includes('@g.us'));
      filteredContacts = filteredContacts.concat(groupChats);
    }

    // Include group chats regardless of the role

    // Remove duplicate contacts
    filteredContacts = filteredContacts.reduce((unique, contact) => {
      if (!unique.some(c => c.phone === contact.phone)) {
        unique.push(contact);
      }
      return unique;
    }, []);
    // console.log(filteredContacts.length);
    res.json({ contacts: filteredContacts, totalChats });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});
app.get('/api/dashboard/:companyId', async (req, res) => {
  const { companyId } = req.params;

  try {
    // Fetch company data
    const companyRef = db.collection('companies').doc(companyId);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Fetch contacts
    const contactsRef = db.collection('companies').doc(companyId).collection('contacts');
    const contactsSnapshot = await contactsRef.get();

    let totalContacts = 0;
    let closedContacts = 0;
    let openContacts = 0;
    let todayContacts = 0;
    let weekContacts = 0;
    let monthContacts = 0;
    let numReplies = 0;

    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const employeePerformance = {};

    // Process contacts
    for (const doc of contactsSnapshot.docs) {
      const contactData = doc.data();
      const dateAdded = contactData.dateAdded ? new Date(contactData.dateAdded) : null;

      totalContacts++;
      if (contactData.tags && contactData.tags.includes('closed')) {
        closedContacts++;
      } else {
        openContacts++;
      }

      if (dateAdded) {
        if (dateAdded >= startOfDay) todayContacts++;
        if (dateAdded >= startOfWeek) weekContacts++;
        if (dateAdded >= startOfMonth) monthContacts++;
      }

      // Process tags for employee performance
      if (contactData.tags) {
        contactData.tags.forEach(tag => {
          if (tag !== 'closed') {
            employeePerformance[tag] = employeePerformance[tag] || { assignedContacts: 0, outgoingMessages: 0, closedContacts: 0 };
            employeePerformance[tag].assignedContacts++;
            if (contactData.tags.includes('closed')) {
              employeePerformance[tag].closedContacts++;
            }
          }
        });
      }

      // Count messages
      const messagesRef = contactsRef.doc(doc.id).collection('messages');
      const messagesSnapshot = await messagesRef.get();
      messagesSnapshot.forEach(messageDoc => {
        const messageData = messageDoc.data();
        if (!messageData.from_me) {
          numReplies++;
        } else if (messageData.userName) {
          employeePerformance[messageData.userName] = employeePerformance[messageData.userName] || { assignedContacts: 0, outgoingMessages: 0, closedContacts: 0 };
          employeePerformance[messageData.userName].outgoingMessages++;
        }
      });
    }

    // Calculate metrics
    const responseRate = totalContacts > 0 ? (numReplies / totalContacts) * 100 : 0;
    const averageRepliesPerLead = totalContacts > 0 ? numReplies / totalContacts : 0;
    const engagementScore = (responseRate * 0.4) + (averageRepliesPerLead * 0.6);
    const conversionRate = totalContacts > 0 ? (closedContacts / totalContacts) * 100 : 0;

    // Fetch and process employee data
    const employeesRef = db.collection('companies').doc(companyId).collection('employee');
    const employeesSnapshot = await employeesRef.get();
    const employees = employeesSnapshot.docs.map(doc => {
      const employeeData = doc.data();
      const performance = employeePerformance[employeeData.name] || { assignedContacts: 0, outgoingMessages: 0, closedContacts: 0 };
      return {
        id: doc.id,
        ...employeeData,
        ...performance
      };
    }).sort((a, b) => b.assignedContacts - a.assignedContacts);

    // Prepare the response
    const dashboardData = {
      kpi: { totalContacts, numReplies, closedContacts, openContacts },
      engagementMetrics: {
        responseRate: responseRate.toFixed(2),
        averageRepliesPerLead: averageRepliesPerLead.toFixed(2),
        engagementScore: engagementScore.toFixed(2),
        conversionRate: conversionRate.toFixed(2)
      },
      leadsOverview: { total: totalContacts, today: todayContacts, week: weekContacts, month: monthContacts },
      employeePerformance: employees
    };

    res.json(dashboardData);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.post('/api/create-contact', async (req, res) => {
  const { contactName, lastName, email, phone, address1, companyName, companyId } = req.body;

  try {
    if (!phone) {
      return res.status(400).json({ error: "Phone number is required." });
    }

    // Format the phone number
    const formattedPhone = formatPhoneNumber(phone);

    const contactsCollectionRef = db.collection(`companies/${companyId}/contacts`);

    // Use the formatted phone number as the document ID
    const contactDocRef = contactsCollectionRef.doc(formattedPhone);

    // Check if a contact with this phone number already exists
    const existingContact = await contactDocRef.get();
    if (existingContact.exists) {
      return res.status(409).json({ error: "A contact with this phone number already exists." });
    }

    const chat_id = formattedPhone.split('+')[1] + "@c.us";

    // Prepare the contact data with the formatted phone number
    const contactData = {
      id: formattedPhone,
      chat_id: chat_id,
      contactName: contactName,
      lastName: lastName,
      email: email,
      phone: formattedPhone,
      companyName: companyName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      unreadCount: 0
    };

    // Add new contact to Firebase
    await contactDocRef.set(contactData);

    res.status(201).json({ message: "Contact added successfully!", contact: contactData });
  } catch (error) {
    console.error('Error adding contact:', error);
    res.status(500).json({ error: "An error occurred while adding the contact: " + error.message });
  }
});

app.get('/api/messages/:chatId/:token/:email', async (req, res) => {
  const chatId = req.params.chatId;
  const whapiToken = req.params.token; // Access token from query parameters
  const email = req.params.email;
  try {
    const response = await fetch(`https://gate.whapi.cloud/messages/list/${chatId}`, {
      headers: { 'Authorization': `Bearer ${whapiToken}` }
    });
    const whapiMessagesData = await response.json();
    const messagesRef = db.collection(`companies/011/messages`);
    const firestoreMessagesSnapshot = await messagesRef.get();

    const firestoreMessages = {};
    firestoreMessagesSnapshot.forEach(doc => {
      firestoreMessages[doc.id] = doc.data();
    });
    // console.log(firestoreMessages);
    const whapiMessages = whapiMessagesData.messages.map(whapiMsg => {
      const firestoreMessage = firestoreMessages[whapiMsg.id];
      if (firestoreMessage) {
        // console.log('found');
        whapiMsg.name = firestoreMessage.from;
      }
      return whapiMsg;
    });

    res.json({ messages: whapiMessages, count: whapiMessagesData.count, total: whapiMessagesData.total });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});
// ... existing code ...
app.get('/api/bots', async (req, res) => {
  try {
    const snapshot = await db.collection('companies').get();
    const botsPromises = snapshot.docs
      .filter(doc => doc.data().v2)
      .map(async doc => {
        const botData = botMap.get(doc.id);
        const docData = doc.data();
        const phoneCount = docData.phoneCount || 1;
        let phoneInfoArray = [];

        // Get phone info for each client if available
        if (Array.isArray(botData)) {
          phoneInfoArray = await Promise.all(
            botData.map(async (data, index) => {
              if (data?.client) {
                try {
                  const info = await data.client.info;
                  return info?.wid?.user || null;
                } catch (err) {
                  console.error(`Error getting client info for bot ${doc.id} phone ${index}:`, err);
                  return null;
                }
              }
              return null;
            })
          );
        }

        // Fetch employee emails from subcollection
        const employeeSnapshot = await db.collection('companies')
          .doc(doc.id)
          .collection('employee')
          .get();

        const employeeEmails = employeeSnapshot.docs.map(empDoc => empDoc.data().email).filter(Boolean);

        return {
          botName: doc.id,
          phoneCount: phoneCount,
          name: docData.name,
          v2: true,
          clientPhones: phoneInfoArray,
          assistantId: docData.assistantId || null,
          trialEndDate: docData.trialEndDate ? docData.trialEndDate.toDate() : null,
          trialStartDate: docData.trialStartDate ? docData.trialStartDate.toDate() : null,
          plan: docData.plan || null,
          employeeEmails: employeeEmails,
          category: docData.category || 'juta',
          apiUrl: docData.apiUrl ? docData.apiUrl : null
        };
      });

    const bots = await Promise.all(botsPromises);
    res.json(bots);
  } catch (error) {
    console.error('Error fetching bots:', error);
    res.status(500).json({ error: 'Failed to fetch bots' });
  }
});
app.put('/api/bots/:botId/category', async (req, res) => {
  const { botId } = req.params;
  const { category } = req.body;

  try {
    // Validate input
    if (!category) {
      return res.status(400).json({
        error: 'Category is required in request body'
      });
    }

    // Reference to company document
    const companyRef = db.collection('companies').doc(botId);

    // Check if company exists
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      return res.status(404).json({
        error: 'Company not found'
      });
    }

    // Update the category
    await companyRef.update({
      category: category
    });

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: {
        botId,
        category
      }
    });

  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({
      error: 'Failed to update category',
      details: error.message
    });
  }
});
function broadcastBotActivity(botName, isActive) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'bot_activity',
        botName,
        isActive
      }));
    }
  });
}
// New endpoint to delete trial end date
app.delete('/api/bots/:botId/trial-end-date', async (req, res) => {
  try {
    const { botId } = req.params;

    // Reference to the company document
    const companyRef = db.collection('companies').doc(botId);

    // Check if company exists
    const doc = await companyRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // Delete the trialEndDate field
    await companyRef.update({
      trialEndDate: admin.firestore.FieldValue.delete()
    });

    res.json({
      success: true,
      message: 'Trial end date deleted successfully',
      botId
    });

  } catch (error) {
    console.error('Error deleting trial end date:', error);
    res.status(500).json({
      error: 'Failed to delete trial end date',
      details: error.message
    });
  }
});

// ... existing code ...
// Modify the API route to get the QR code or authentication status
app.get('/api/bot-status/:botName', async (req, res) => {
  const { botName } = req.params;
  const botData = botMap.get(botName);

  try {
    if (botData && Array.isArray(botData)) {
      if (botData.length === 1) {
        // Single phone
        const { status, qrCode } = botData[0];
        let phoneInfo = null;

        // Get phone info if client is available
        if (botData[0]?.client) {
          try {
            const info = await botData[0].client.info;
            phoneInfo = info?.wid?.user || null;
          } catch (err) {
            console.error(`Error getting client info for bot ${botName}:`, err);
          }
        }

        res.json({ status, qrCode, phoneInfo });
      } else {
        // Multiple phones
        const statusArray = await Promise.all(botData.map(async (phone, index) => {
          let phoneInfo = null;

          // Get phone info if client is available
          if (phone?.client) {
            try {
              const info = await phone.client.info;
              phoneInfo = info?.wid?.user || null;
            } catch (err) {
              console.error(`Error getting client info for bot ${botName} phone ${index}:`, err);
            }
          }

          return {
            phoneIndex: index,
            status: phone.status,
            qrCode: phone.qrCode,
            phoneInfo
          };
        }));

        res.json(statusArray);
      }
    } else if (botData) {
      // Fallback for unexpected data structure
      res.json([{
        status: botData.status,
        qrCode: botData.qrCode,
        phoneInfo: null
      }]);
    } else {
      res.status(404).json({ error: 'Bot status not available' });
    }
  } catch (error) {
    console.error(`Error getting bot status for ${botName}:`, error);
    res.status(500).json({ error: 'Failed to get bot status' });
  }
});
app.post('/api/v2/messages/ghl/:companyId/:chatId', async (req, res) => {
  console.log('\n=== New Custom Message Request ===');
  const companyId = req.params.companyId;
  const chatId = req.params.chatId;
  const { first_name, text } = req.body.customData;

  console.log('Request details:', {
    companyId,
    chatId,
    messageLength: text?.length,
    firstName: first_name
  });

  try {
    // 1. Get the client for this company from botMap
    console.log('\n=== Client Validation ===');
    const botData = botMap.get(companyId);
    console.log('Bot data found:', Boolean(botData));

    if (!botData) {
      console.error('WhatsApp client not found for company:', companyId);
      return res.status(404).send('WhatsApp client not found for this company');
    }

    const client = botData[0]?.client; // Using default phone index 0

    if (!client) {
      console.error('No active WhatsApp client found');
      return res.status(404).send('No active WhatsApp client found for this company');
    }

    // 2. Send the message
    console.log('\n=== Sending Message ===');
    let sentMessage;
    try {
      console.log('Sending regular message');
      sentMessage = await client.sendMessage(chatId, text);
      console.log('Message sent successfully:', {
        messageId: sentMessage.id._serialized,
        timestamp: sentMessage.timestamp,
        type: sentMessage.type
      });
    } catch (sendError) {
      console.error('\n=== Message Send Error ===');
      console.error('Error:', sendError);
      throw sendError;
    }

    // 3. Process response and save to Firebase
    console.log('\n=== Saving to Firebase ===');
    const phoneNumber = '+' + (chatId).split('@')[0];
    const type2 = sentMessage.type === 'chat' ? 'text' : sentMessage.type;

    const messageData = {
      chat_id: sentMessage.from,
      from: sentMessage.from ?? "",
      from_me: true,
      id: sentMessage.id._serialized ?? "",
      source: sentMessage.deviceType ?? "",
      status: "delivered",
      text: {
        body: text
      },
      timestamp: sentMessage.timestamp ?? 0,
      type: type2,
      userName: first_name,
      ack: sentMessage.ack ?? 0,
      phoneIndex: 0,
    };

    // 4. Save to Firebase
    try {
      const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(phoneNumber);
      const messagesRef = contactRef.collection('messages');
      const messageDoc = messagesRef.doc(sentMessage.id._serialized);

      await messageDoc.set(messageData, { merge: true });
      console.log('Message saved to Firebase');

      console.log('\n=== Message Processing Complete ===');
      res.json({
        success: true,
        messageId: sentMessage.id._serialized,
        timestamp: sentMessage.timestamp
      });
    } catch (dbError) {
      console.error('\n=== Database Error ===');
      console.error('Error:', dbError);
      throw dbError;
    }
  } catch (error) {
    console.error('\n=== Request Error ===');
    console.error('Error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
app.post('/api/v2/messages/text/:companyId/:chatId', async (req, res) => {
  console.log('\n=== New Text Message Request ===');
  const companyId = req.params.companyId;
  const chatId = req.params.chatId;
  const { message, quotedMessageId, phoneIndex: requestedPhoneIndex, userName: requestedUserName } = req.body;

  console.log('Request details:', {
    companyId,
    chatId,
    messageLength: message?.length,
    hasQuotedMessage: Boolean(quotedMessageId),
    requestedPhoneIndex,
    userName: requestedUserName
  });

  const phoneIndex = requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;
  const userName = requestedUserName !== undefined ? requestedUserName : '';

  try {
    // 1. Get the client for this company from botMap
    console.log('\n=== Client Validation ===');
    const botData = botMap.get(companyId);
    console.log('Bot data found:', Boolean(botData));
    console.log('Available phone indices:', botData ? botData.map((_, i) => i) : []);

    if (!botData) {
      console.error('WhatsApp client not found for company:', companyId);
      return res.status(404).send('WhatsApp client not found for this company');
    }

    const client = botData[phoneIndex]?.client;
    console.log('Client status:', {
      phoneIndex,
      hasClient: Boolean(client),
      clientInfo: client ? {
        info: (() => {
          try {
            return client.info;
          } catch (e) {
            return 'Error getting info';
          }
        })(),
        isConnected: client.isConnected
      } : null
    });

    if (!client) {
      console.error('No active WhatsApp client found for phone index:', phoneIndex);
      return res.status(404).send('No active WhatsApp client found for this company');
    }

    // 2. Send the message
    console.log('\n=== Sending Message ===');
    let sentMessage;
    try {
      if (quotedMessageId) {
        console.log('Sending with quoted message:', quotedMessageId);
        sentMessage = await client.sendMessage(chatId, message, { quotedMessageId });
      } else {
        console.log('Sending regular message');
        sentMessage = await client.sendMessage(chatId, message);
      }
      console.log('Message sent successfully:', {
        messageId: sentMessage.id._serialized,
        timestamp: sentMessage.timestamp,
        type: sentMessage.type
      });
    } catch (sendError) {
      console.error('\n=== Message Send Error ===');
      console.error('Error Type:', sendError.name);
      console.error('Error Message:', sendError.message);
      console.error('Stack:', sendError.stack);
      throw sendError;
    }

    // 2.5 Process any AI Responses set for the companyID (if any)
    const query = message;
    const companyRef = db.collection("companies").doc(companyId);
    const companyDoc = await companyRef.get();
    const companyConfig = companyDoc.data();
    const aiTagResponses = companyConfig.statusAIResponses?.aiTag === true ? await getAITagResponses(companyId) : [];
    const aiAssignResponses = companyConfig.statusAIResponses?.aiAssign === true ? await getAIAssignResponses(companyId) : [];
    const aiImageResponses = companyConfig.statusAIResponses?.aiImage === true ? await getAIImageResponses(companyId) : [];
    const aiVoiceResponses = companyConfig.statusAIResponses?.aiVoice === true ? await getAIVoiceResponses(companyId) : [];
    const aiVideoResponses = companyConfig.statusAIResponses?.aiVideo === true ? await getAIVideoResponses(companyId) : [];
    const aiDocumentResponses = companyConfig.statusAIResponses?.aiDocument === true ? await getAIDocumentResponses(companyId) : [];
    const followUpTemplates = await getFollowUpTemplates(companyId);

    let imageFound = false;
    let voiceFound = false;
    let videoFound = false;
    let tagFound = false;
    let documentFound = false;
    let assignFound = false;
    const extractedNumber = '+' + (chatId).split('@')[0];

    // For voice messages
    if (!voiceFound) {
      for (const response of aiVoiceResponses) {
        if (response.keywordSource === "own" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
          console.log('voice messages found for keywords:', response.keywords);
          for (let i = 0; i < response.voiceUrls.length; i++) {
            try {
              const caption = response.captions?.[i] || '';
              const voiceMessage = await sendVoiceMessage(client, chatId, response.voiceUrls[i], caption);
              await addMessagetoFirebase(voiceMessage, companyId, extractedNumber);
              if (i < response.voiceUrls.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            } catch (error) {
              console.error(`Error sending voice message ${response.voiceUrls[i]}:`, error);
              continue;
            }
          }
        }
      }
    }

    // For images
    if (!imageFound) {
      for (const response of aiImageResponses) {
        if (response.keywordSource === "own" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
          console.log('images found for keywords:', response.keywords);
          for (const imageUrl of response.imageUrls) {
            try {
              const media = await MessageMedia.fromUrl(imageUrl);
              const imageMessage = await client.sendMessage(chatId, media);
              await addMessagetoFirebase(imageMessage, companyId, extractedNumber);
            } catch (error) {
              console.error(`Error sending image ${imageUrl}:`, error);
              continue;
            }
          }
        }
      }
    }

    // For assign
    if (!assignFound) {
      for (const response of aiAssignResponses) {
        if (response.keywordSource === "own" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
          console.log('Keyword match found:', response.keywords);
          try {
            // Get the current assignment index
            const stateRef = db.collection('companies').doc(companyId).collection('botState').doc('assignmentState');
            const stateDoc = await stateRef.get();
            let currentIndex = 0;
            if (stateDoc.exists) {
              currentIndex = stateDoc.data().currentIndex || 0;
            }

            // Get employee list and calculate next employee
            const employeeEmails = response.assignedEmployees;
            if (employeeEmails.length === 0) {
              console.log('No employees available for assignment');
              continue;
            }

            const nextEmail = employeeEmails[currentIndex % employeeEmails.length];

            // Find the matching keyword that triggered the assignment
            const triggerKeyword = response.keywords.find(kw =>
              query.toLowerCase().includes(kw.toLowerCase())
            );

            console.log('Trigger keyword found:', triggerKeyword);

            // Fetch employee data
            const employeeRef = db.collection('companies').doc(companyId).collection('employee').doc(nextEmail);
            const employeeDoc = await employeeRef.get();

            if (employeeDoc.exists) {
              const employeeData = employeeDoc.data();
              console.log('Employee data:', employeeData);
              console.log('Assigning with keyword:', triggerKeyword);

              // Get contact name with fallback
              const contactName = extractedNumber || 'Unknown Contact';
              console.log('Using contact name:', contactName);

              await assignToEmployee(
                employeeData,
                'Sales',
                extractedNumber,
                contactName,  // Changed from contactData.contactName to contactName
                client,
                companyId,
                triggerKeyword
              );

              // Update the assignment index for next time
              const newIndex = (currentIndex + 1) % employeeEmails.length;
              await stateRef.set({
                currentIndex: newIndex,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });

              assignFound = true;
              break;
            } else {
              console.log('Employee document not found:', nextEmail);
            }
          } catch (error) {
            console.error('Error in assignment process:', error);
            console.error('Full error stack:', error.stack);
            continue;
          }
        }
      }
    }

    // For video
    if (!videoFound) {
      for (const response of aiVideoResponses) {
        if (response.keywordSource === "own" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
          console.log('videos found for keywords:', response.keywords);
          for (let i = 0; i < response.videoUrls.length; i++) {
            try {
              const videoUrl = response.videoUrls[i];
              const caption = response.captions?.[i] || '';
              console.log(`Sending video ${i + 1}/${response.videoUrls.length}`);
              console.log(`URL: ${videoUrl}`);

              const media = await MessageMedia.fromUrl(videoUrl);
              if (!media) {
                throw new Error('Failed to load video from URL');
              }

              const videoMessage = await client.sendMessage(chatId, media, {
                caption: caption,
                sendVideoAsGif: false // Set to true if you want to send as GIF
              });
              if (!videoMessage) {
                throw new Error('Video send returned null');
              }
              await addMessagetoFirebase(videoMessage, companyId, extractedNumber);
              // Add delay between videos
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
              console.error(`Error sending video ${i}:`, error);
              console.error('Full error:', error.stack);
              continue;
            }
          }
        }
      }
    }

    // For document
    if (!documentFound) {
      for (const response of aiDocumentResponses) {
        if (response.keywordSource === "own" && response.keywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()))) {
          console.log('documents found for keyword ' + response.keywords);
          console.log('Document URLs:', response.documentUrls); // Debug log

          // Send all documents for this keyword
          for (let i = 0; i < response.documentUrls.length; i++) {
            try {
              const documentUrl = response.documentUrls[i];
              console.log(`Sending document ${i + 1}/${response.documentUrls.length}`);
              console.log(`URL: ${documentUrl}`);

              const media = await MessageMedia.fromUrl(documentUrl);
              if (!media) {
                throw new Error('Failed to load document from URL');
              }

              // Use the document name from the response
              const documentName = response.documentNames[i] || `document_${i + 1}`;
              media.filename = documentName;

              // If the mimetype is not set, try to infer it from the file extension
              if (!media.mimetype) {
                const ext = path.extname(documentName).toLowerCase();
                switch (ext) {
                  case ".pdf":
                    media.mimetype = "application/pdf";
                    break;
                  case ".doc":
                  case ".docx":
                    media.mimetype = "application/msword";
                    break;
                  case ".xls":
                  case ".xlsx":
                    media.mimetype = "application/vnd.ms-excel";
                    break;
                  case ".ppt":
                  case ".pptx":
                    media.mimetype = "application/vnd.ms-powerpoint";
                    break;
                  case ".txt":
                    media.mimetype = "text/plain";
                    break;
                  case ".csv":
                    media.mimetype = "text/csv";
                    break;
                  case ".zip":
                    media.mimetype = "application/zip";
                    break;
                  case ".rar":
                    media.mimetype = "application/x-rar-compressed";
                    break;
                  default:
                    media.mimetype = "application/octet-stream";
                }
              }

              const documentMessage = await client.sendMessage(chatId, media, {
                sendMediaAsDocument: true
              });

              if (!documentMessage) {
                throw new Error('Document send returned null');
              }

              await addMessagetoFirebase(documentMessage, companyId, extractedNumber);

              await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
            } catch (error) {
              console.error(`Error sending document ${i}:`, error);
              console.error('Full error:', error.stack);
              continue;
            }
          }
        }
      }
    }

    // For tags
    if (!tagFound) {
      for (const response of aiTagResponses) {
        if (
          response.keywordSource === "own" &&
          response.keywords.some((kw) => query.toLowerCase().includes(kw.toLowerCase()))
        ) {
          console.log("tags found for keywords:", response.keywords);
          try {
            if (response.tagActionMode === "delete") {
              // Delete specified tags from both response and firebaseTags
              for (const tag of response.tags) {
                // Remove from Firebase
                await addtagbookedFirebase(extractedNumber, tag, companyId, true);

                console.log(`Removed tag: ${tag} from number: ${extractedNumber}`);

                if (tag === 'pause followup') {
                  // Get the contact's current tags to find active followup templates
                  const contactRef = db.collection('companies').doc(companyId).collection('contact').doc(extractedNumber);
                  const contactDoc = await contactRef.get();
                  if (contactDoc.exists) {
                    const contactData = contactDoc.data();
                    const currentTags = contactData.tags || [];
                    
                    // Check each followup template to see if its tag is in the contact's tags
                    for (const template of followUpTemplates) {
                      // If the template has a tag that matches one of the contact's tags
                      if (template.triggerTags && template.triggerTags.some(templateTag => 
                        currentTags.includes(templateTag))) {
                        try {
                          // Call the API to resume follow-up sequence for this template
                          const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              requestType: "resumeTemplate",
                              phone: extractedNumber,
                              first_name: extractedNumber,
                              phoneIndex: phoneIndex || 0,
                              templateId: template.id,
                              idSubstring: companyId,
                            }),
                          });

                          if (!apiResponse.ok) {
                            console.error(
                              `Failed to resume follow-up sequence for template ${template.id}:`,
                              await apiResponse.text()
                            );
                          } else {
                            console.log(
                              `Successfully resumed follow-up sequence for template ${template.id} with tag ${template.triggerTags.find(tag => currentTags.includes(tag))}`
                            );
                          }
                        } catch (error) {
                          console.error(`Error resuming template messages:`, error);
                        }
                      }
                    }
                  }
                }

                // Check if any follow-up templates use this tag as a trigger tag
                for (const template of followUpTemplates) {
                  if (template.triggerTags && template.triggerTags.includes(tag)) {
                    // Call the API to remove scheduled messages for this template
                    try {
                      const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          requestType: "removeTemplate",
                          phone: extractedNumber,
                          first_name: extractedNumber,
                          phoneIndex: phoneIndex || 0,
                          templateId: template.id,
                          idSubstring: companyId,
                        }),
                      });

                      if (!apiResponse.ok) {
                        console.error(
                          `Failed to stop follow-up sequence for template ${template.id}:`,
                          await apiResponse.text()
                        );
                      } else {
                        console.log(
                          `Successfully removed follow-up sequence for template ${template.id} with tag ${tag}`
                        );
                      }
                    } catch (error) {
                      console.error(`Error removing template messages for tag ${tag}:`, error);
                    }
                  }
                }
              }
            } else {
              // Default behavior: remove specified tags first
              for (const tagToRemove of response.removeTags || []) {
                await addtagbookedFirebase(extractedNumber, tagToRemove, companyId, true);

                if (tagToRemove === 'pause followup') {
                  // Get the contact's current tags to find active followup templates
                  const contactRef = db.collection('companies').doc(companyId).collection('contact').doc(extractedNumber);
                  const contactDoc = await contactRef.get();
                  if (contactDoc.exists) {
                    const contactData = contactDoc.data();
                    const currentTags = contactData.tags || [];
                    
                    // Check each followup template to see if its tag is in the contact's tags
                    for (const template of followUpTemplates) {
                      // If the template has a tag that matches one of the contact's tags
                      if (template.triggerTags && template.triggerTags.some(templateTag => 
                        currentTags.includes(templateTag))) {
                        try {
                          // Call the API to resume follow-up sequence for this template
                          const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              requestType: "resumeTemplate",
                              phone: extractedNumber,
                              first_name: extractedNumber,
                              phoneIndex: phoneIndex || 0,
                              templateId: template.id,
                              idSubstring: companyId,
                            }),
                          });

                          if (!apiResponse.ok) {
                            console.error(
                              `Failed to resume follow-up sequence for template ${template.id}:`,
                              await apiResponse.text()
                            );
                          } else {
                            console.log(
                              `Successfully resumed follow-up sequence for template ${template.id} with tag ${template.triggerTags.find(tag => currentTags.includes(tag))}`
                            );
                          }
                        } catch (error) {
                          console.error(`Error resuming template messages:`, error);
                        }
                      }
                    }
                  }
                }

                // Check if any follow-up templates use this tag as a trigger tag
                for (const template of followUpTemplates) {
                  if (template.triggerTags && template.triggerTags.includes(tagToRemove)) {
                    // Call the API to remove scheduled messages for this template
                    try {
                      const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          requestType: "removeTemplate",
                          phone: extractedNumber,
                          first_name: extractedNumber,
                          phoneIndex: phoneIndex || 0,
                          templateId: template.id,
                          idSubstring: companyId,
                        }),
                      });

                      if (!apiResponse.ok) {
                        console.error(
                          `Failed to stop follow-up sequence for template ${template.id}:`,
                          await apiResponse.text()
                        );
                      } else {
                        console.log(
                          `Successfully removed follow-up sequence for template ${template.id} with tag ${tagToRemove}`
                        );
                      }
                    } catch (error) {
                      console.error(`Error removing template messages for tag ${tagToRemove}:`, error);
                    }
                  }
                }
              }

              // Then add new tags
              for (const tag of response.tags) {
                await addtagbookedFirebase(extractedNumber, tag, companyId);
                console.log(`Added tag: ${tag} for number: ${extractedNumber}`);

                // Check if any follow-up templates use this tag as a trigger tag
                for (const template of followUpTemplates) {
                  if (template.triggerTags && template.triggerTags.includes(tag)) {
                    // Call the API to start follow-up sequence for this template
                    try {
                      const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          requestType: "startTemplate",
                          phone: extractedNumber,
                          first_name: extractedNumber,
                          phoneIndex: phoneIndex || 0,
                          templateId: template.id,
                          idSubstring: companyId,
                        }),
                      });

                      if (!apiResponse.ok) {
                        console.error(
                          `Failed to start follow-up sequence for template ${template.id}:`,
                          await apiResponse.text()
                        );
                      } else {
                        console.log(
                          `Successfully started follow-up sequence for template ${template.id} with tag ${tag}`
                        );
                      }
                    } catch (error) {
                      console.error(`Error starting template messages for tag ${tag}:`, error);
                    }
                  }
                }

                if (tag === 'pause followup') {
                  // Get the contact's current tags to find active followup templates
                  const contactRef = db.collection('companies').doc(companyId).collection('contact').doc(extractedNumber);
                  const contactDoc = await contactRef.get();
                  if (contactDoc.exists) {
                    const contactData = contactDoc.data();
                    const currentTags = contactData.tags || [];
                    
                    // Check each followup template to see if its tag is in the contact's tags
                    for (const template of followUpTemplates) {
                      // If the template has a tag that matches one of the contact's tags
                      if (template.triggerTags && template.triggerTags.some(templateTag => 
                        currentTags.includes(templateTag))) {
                        try {
                          // Call the API to pause follow-up sequence for this template
                          const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              requestType: "pauseTemplate",
                              phone: extractedNumber,
                              first_name: extractedNumber,
                              phoneIndex: phoneIndex || 0,
                              templateId: template.id,
                              idSubstring: companyId,
                            }),
                          });

                          if (!apiResponse.ok) {
                            console.error(
                              `Failed to pause follow-up sequence for template ${template.id}:`,
                              await apiResponse.text()
                            );
                          } else {
                            console.log(
                              `Successfully paused follow-up sequence for template ${template.id} with tag ${template.triggerTags.find(tag => currentTags.includes(tag))}`
                            );
                          }
                        } catch (error) {
                          console.error(`Error pausing template messages in ai responses:`, error);
                        }
                      }
                    }
                  }
                }

                if (tag === 'stop followup') {
                  // Get the contact's current tags to find active followup templates
                  const contactRef = db.collection('companies').doc(companyId).collection('contact').doc(extractedNumber);
                  const contactDoc = await contactRef.get();
                  if (contactDoc.exists) {
                    const contactData = contactDoc.data();
                    const currentTags = contactData.tags || [];
                    
                    // Check each followup template to see if its tag is in the contact's tags
                    for (const template of followUpTemplates) {
                      // If the template has a tag that matches one of the contact's tags
                      if (template.triggerTags && template.triggerTags.some(templateTag => 
                        currentTags.includes(templateTag))) {
                        try {
                          // Call the API to pause follow-up sequence for this template
                          const apiResponse = await fetch("https://juta.ngrok.app/api/tag/followup", {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              requestType: "removeTemplate",
                              phone: extractedNumber,
                              first_name: extractedNumber,
                              phoneIndex: phoneIndex || 0,
                              templateId: template.id,
                              idSubstring: companyId,
                            }),
                          });

                          if (!apiResponse.ok) {
                            console.error(
                              `Failed to pause follow-up sequence for template ${template.id}:`,
                              await apiResponse.text()
                            );
                          } else {
                            console.log(
                              `Successfully paused follow-up sequence for template ${template.id} with tag ${template.triggerTags.find(tag => currentTags.includes(tag))}`
                            );
                          }

                          await addtagbookedFirebase(extractedNumber, tag, botName, true);
                        } catch (error) {
                          console.error(`Error stopping template messages in ai responses:`, error);
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.error(`Error handling tags for keywords ${response.keywords}:`, error);
            continue;
          }
        }
      }
    }

    // 3. Process response and save to Firebase
    console.log('\n=== Saving to Firebase ===');
    const phoneNumber = '+' + (chatId).split('@')[0];
    const type2 = sentMessage.type === 'chat' ? 'text' : sentMessage.type;

    const messageData = {
      chat_id: sentMessage.from,
      from: sentMessage.from ?? "",
      from_me: true,
      id: sentMessage.id._serialized ?? "",
      source: sentMessage.deviceType ?? "",
      status: "delivered",
      text: {
        body: message
      },
      timestamp: sentMessage.timestamp ?? 0,
      type: type2,
      userName: userName,
      ack: sentMessage.ack ?? 0,
      phoneIndex: phoneIndex,
    };

    console.log('Message data prepared:', {
      messageId: messageData.id,
      type: messageData.type,
      timestamp: messageData.timestamp
    });

    // 4. Save to Firebase
    try {
      const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(phoneNumber);
      const messagesRef = contactRef.collection('messages');
      const messageDoc = messagesRef.doc(sentMessage.id._serialized);

      await messageDoc.set(messageData, { merge: true });
      console.log('Message saved to Firebase');

      // 5. Update contact data if needed
      const contactDoc = await contactRef.get();
      const contactData = contactDoc.data();
      console.log('Contact data retrieved:', {
        exists: contactDoc.exists,
        currentPhoneIndex: contactData?.phoneIndex,
        hasThreadId: Boolean(contactData?.threadid)
      });

      if (requestedPhoneIndex !== undefined &&
        (contactData?.phoneIndex === undefined || contactData.phoneIndex !== requestedPhoneIndex)) {
        console.log('Updating contact phone index:', requestedPhoneIndex);
        await contactRef.update({
          phoneIndex: requestedPhoneIndex,
          chat_id: chatId
        });
      }

      // 6. Handle OpenAI integration
      if (contactData?.threadid) {
        console.log('Using existing thread:', contactData.threadid);
        await handleOpenAIMyMessage(message, contactData.threadid);
      } else {
        console.log('Creating new OpenAI thread');
        try {
          const thread = await createThread();
          const threadID = thread.id;
          console.log('New thread created:', threadID);

          await contactRef.update({ threadid: threadID });
          await handleOpenAIMyMessage(message, threadID);
        } catch (aiError) {
          console.error('Error creating AI thread:', aiError);
        }

        // 7. Handle bot tags
        if (companyId === '020' || companyId === '001' || companyId === '0123' || companyId === '0119') {
          console.log('Adding stop bot tag for company:', companyId);
          await contactRef.update({
            tags: admin.firestore.FieldValue.arrayUnion('stop bot')
          });
        }
      }

      console.log('\n=== Message Processing Complete ===');
      res.json({
        success: true,
        messageId: sentMessage.id._serialized,
        timestamp: sentMessage.timestamp
      });
    } catch (dbError) {
      console.error('\n=== Database Error ===');
      console.error('Error Type:', dbError.name);
      console.error('Error Message:', dbError.message);
      console.error('Stack:', dbError.stack);
      throw dbError;
    }
  } catch (error) {
    console.error('\n=== Request Error ===');
    console.error('Error Type:', error.name);
    console.error('Error Message:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      error: 'Internal Server Error',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

//react to message
app.post('/api/messages/react/:companyId/:messageId', async (req, res) => {
  const { companyId, messageId } = req.params;
  const { reaction, phoneIndex = 0 } = req.body;

  try {
    // Validate the reaction
    if (reaction === undefined) {
      return res.status(400).json({ error: 'Reaction emoji is required' });
    }

    // Get the bot client
    const botData = botMap.get(companyId);
    if (!botData || !botData[phoneIndex] || !botData[phoneIndex].client) {
      return res.status(404).json({ error: 'WhatsApp client not found' });
    }

    const client = botData[phoneIndex].client;

    // Get the message by ID
    const message = await client.getMessageById(messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Send the reaction
    await message.react(reaction);

    // If successful, save the reaction to Firestore
    // First, find the contact document that contains this message
    const contactsRef = db.collection('companies').doc(companyId).collection('contacts');
    const contactsSnapshot = await contactsRef.get();

    let messageDoc = null;
    for (const contactDoc of contactsSnapshot.docs) {
      const messageRef = contactDoc.ref.collection('messages').doc(messageId);
      const msgDoc = await messageRef.get();
      if (msgDoc.exists) {
        messageDoc = msgDoc;
        // Update the message document with the reaction
        await messageRef.update({
          reaction: reaction || null,
          reactionTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        break;
      }
    }

    if (!messageDoc) {
      console.warn(`Message ${messageId} found in WhatsApp but not in Firestore`);
    }

    res.json({
      success: true,
      message: reaction ? 'Reaction added successfully' : 'Reaction removed successfully',
      messageId,
      reaction
    });

  } catch (error) {
    console.error('Error reacting to message:', error);
    res.status(500).json({
      error: 'Failed to react to message',
      details: error.message
    });
  }
});

// Edit message route
app.put('/api/v2/messages/:companyId/:chatId/:messageId', async (req, res) => {
  console.log('Edit message');
  const { companyId, chatId, messageId } = req.params;
  const { newMessage } = req.body;

  try {
    // Get the client for this company from botMap
    const botData = botMap.get(companyId);
    if (!botData || !botData[0] || !botData[0].client) {
      return res.status(404).send('WhatsApp client not found for this company');
    }
    const client = botData[0].client;

    // Get the chat
    const chat = await client.getChatById(chatId);

    // Fetch the message
    const messages = await chat.fetchMessages({ limit: 1, id: messageId });
    if (messages.length === 0) {
      return res.status(404).send('Message not found');
    }
    const message = messages[0];

    // Edit the message
    const editedMessage = await message.edit(newMessage);

    if (editedMessage) {
      // Update the message in Firebase
      let phoneNumber = '+' + (chatId).split('@')[0];
      const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(phoneNumber);
      const messageRef = contactRef.collection('messages').doc(messageId);

      await messageRef.update({
        'text.body': newMessage,
        edited: true,
        editedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      res.json({ success: true, messageId: messageId });
    } else {
      res.status(400).json({ success: false, error: 'Failed to edit message' });
    }
  } catch (error) {
    console.error('Error editing message:', error);
    res.status(500).send('Internal Server Error');
  }
});
// Delete message route
app.delete('/api/v2/messages/:companyId/:chatId/:messageId', async (req, res) => {
  console.log('Delete message');
  const { companyId, chatId, messageId } = req.params;
  const { deleteForEveryone, phoneIndex: requestedPhoneIndex } = req.body; // Added phoneIndex to the request body

  const phoneIndex = requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0; // Determine phoneIndex

  try {
    // Get the client for this company from botMap
    const botData = botMap.get(companyId);
    if (!botData || !botData[phoneIndex] || !botData[phoneIndex].client) { // Use phoneIndex to access the client
      return res.status(404).send('WhatsApp client not found for this company');
    }
    const client = botData[phoneIndex].client; // Get the client using phoneIndex

    // Get the chat
    const chat = await client.getChatById(chatId);

    // Fetch the message
    const messages = await chat.fetchMessages({ limit: 1, id: messageId });
    if (messages.length === 0) {
      return res.status(404).send('Message not found');
    }
    const message = messages[0];

    // Delete the message
    await message.delete(deleteForEveryone);

    // Delete the message from Firebase
    let phoneNumber = '+' + (chatId).split('@')[0];
    const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(phoneNumber);
    const messageRef = contactRef.collection('messages').doc(messageId);
    await messageRef.delete();

    res.json({ success: true, messageId: messageId });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/messages/text/:chatId/:token', async (req, res) => {
  console.log('send message');
  const chatId = req.params.chatId;
  const token = req.params.token; // Access token from query parameters
  const message = req.body.message;
  const quotedMessageId = req.body.quotedMessageId; // Extract quotedMessageId from the request body
  console.log(req.body);

  const requestBody = {
    to: chatId,
    body: message
  };

  // Include quotedMessageId if it is provided
  if (quotedMessageId) {
    requestBody.quoted = quotedMessageId;
  }

  try {
    const response = await fetch(`https://gate.whapi.cloud/messages/text`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    //console.log(response);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/v2/messages/image/:companyId/:chatId', async (req, res) => {
  const companyId = req.params.companyId;
  const chatId = req.params.chatId;
  const { imageUrl, caption, phoneIndex: requestedPhoneIndex, userName: requestedUserName } = req.body;
  const phoneIndex = requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;
  const userName = requestedUserName !== undefined ? requestedUserName : '';

  try {
    let client;
    // 1. Get the client for this company from botMap
    const botData = botMap.get(companyId);
    if (!botData) {
      return res.status(404).send('WhatsApp client not found for this company');
    }
    client = botData[phoneIndex].client;

    if (!client) {
      return res.status(404).send('No active WhatsApp client found for this company');
    }
    // 2. Use wwebjs to send the image message
    const media = await MessageMedia.fromUrl(imageUrl);
    const sentMessage = await client.sendMessage(chatId, media, { caption });
    let phoneNumber = '+' + (chatId).split('@')[0];

    // 3. Save the message to Firebase
    const messageData = {
      chat_id: sentMessage.from,
      from: sentMessage.from ?? "",
      from_me: true,
      id: sentMessage.id._serialized ?? "",
      source: sentMessage.deviceType ?? "",
      status: "delivered",
      image: {
        mimetype: media.mimetype,
        link: imageUrl,
        caption: caption ?? "",
      },
      timestamp: sentMessage.timestamp ?? 0,
      userName: userName,
      type: 'image',
      ack: sentMessage.ack ?? 0,
    };

    const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(phoneNumber);
    const messagesRef = contactRef.collection('messages');

    const messageDoc = messagesRef.doc(sentMessage.id._serialized);
    await messageDoc.set(messageData, { merge: true });

    res.json({ success: true, messageId: sentMessage.id._serialized });
  } catch (error) {
    console.error('Error sending image message:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/v2/messages/audio/:companyId/:chatId', async (req, res) => {
  const companyId = req.params.companyId;
  const chatId = req.params.chatId;
  const { audioUrl, caption, phoneIndex: requestedPhoneIndex, userName: requestedUserName } = req.body;

  const phoneIndex = requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;
  const userName = requestedUserName !== undefined ? requestedUserName : '';

  try {
    let client;
    // 1. Get the client for this company from botMap
    const botData = botMap.get(companyId);
    if (!botData) {
      return res.status(404).send('WhatsApp client not found for this company');
    }
    client = botData[phoneIndex].client;

    if (!client) {
      return res.status(404).send('No active WhatsApp client found for this company');
    }

    if (!audioUrl) {
      return res.status(400).send('No audio URL provided');
    }

    // 2. Download the WebM file
    const tempWebmPath = path.join(os.tmpdir(), `temp_${Date.now()}.webm`);
    const tempMp4Path = path.join(os.tmpdir(), `temp_${Date.now()}.mp4`);
    const response = await axios({
      method: 'get',
      url: audioUrl,
      responseType: 'arraybuffer'
    });
    await fs.promises.writeFile(tempWebmPath, response.data);
    await new Promise((resolve, reject) => {
      exec(`${ffmpeg} -i ${tempWebmPath} -c:a aac -b:a 128k ${tempMp4Path}`, (error, stdout, stderr) => {
        if (error) {
          console.error(`FFmpeg error: ${error.message}`);
          reject(error);
        } else {
          resolve();
        }
      });
    });
    const media = MessageMedia.fromFilePath(tempMp4Path);
    media.mimetype = 'audio/mp4';


    const sentMessage = await client.sendMessage(chatId, media, { sendAudioAsVoice: true });

    // Clean up temporary files
    await fs.promises.unlink(tempWebmPath);
    await fs.promises.unlink(tempMp4Path);

    let phoneNumber = '+' + chatId.split('@')[0];

    // 5. Save the message to Firebase
    const messageData = {
      chat_id: sentMessage.from,
      from: sentMessage.from ?? "",
      from_me: true,
      id: sentMessage.id._serialized ?? "",
      source: sentMessage.deviceType ?? "",
      status: "delivered",
      audio: {
        mimetype: media.mimetype,
        url: audioUrl, // Store the original URL
      },
      timestamp: sentMessage.timestamp ?? 0,
      userName: userName,
      type: 'ptt', // Push To Talk (voice message)
      ack: sentMessage.ack ?? 0,
    };

    const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(phoneNumber);
    const messagesRef = contactRef.collection('messages');
    const messageDoc = messagesRef.doc(sentMessage.id._serialized);
    await messageDoc.set(messageData, { merge: true });

    res.json({ success: true, messageId: sentMessage.id._serialized });
  } catch (error) {
    console.error('Error sending audio message:', error);
    if (error.stack) {
      console.error('Error stack:', error.stack);
    }
    res.status(500).send(`Internal Server Error: ${error.message}`);
  }
});

app.post('/api/request-pairing-code/:botName', async (req, res) => {
  const { botName } = req.params;
  const { phoneNumber, phoneIndex = 0 } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  // Remove any non-digit characters from the phone number
  const cleanedPhoneNumber = phoneNumber.replace(/\D/g, '');

  // Check if the cleaned phone number starts with a '+' and remove it
  const formattedPhoneNumber = cleanedPhoneNumber.startsWith('+')
    ? cleanedPhoneNumber.slice(1)
    : cleanedPhoneNumber;

  try {
    const botData = botMap.get(botName);
    if (!botData || !Array.isArray(botData) || !botData[phoneIndex]) {
      return res.status(404).json({ error: 'Bot or phone not found' });
    }

    const { client } = botData[phoneIndex];
    if (!client) {
      return res.status(404).json({ error: 'WhatsApp client not initialized' });
    }

    // Request the pairing code with the formatted phone number
    const pairingCode = await client.requestPairingCode(formattedPhoneNumber);

    // Update the bot status
    botData[phoneIndex] = {
      ...botData[phoneIndex],
      status: 'pairing_code',
      pairingCode
    };
    botMap.set(botName, botData);

    // Broadcast the new status
    broadcastAuthStatus(botName, 'pairing_code', pairingCode, phoneIndex);

    // Send the pairing code back to the client
    res.json({ pairingCode });
  } catch (error) {
    console.error(`Error requesting pairing code for ${botName}:`, error);
    res.status(500).json({ error: 'Failed to request pairing code', details: error.message });
  }
});

// Add this with your other API endpoints
app.post('/api/scheduled-messages/:botName/cleanup', async (req, res) => {
  try {
    const { botName } = req.params;
    const { contactNumber, messageType } = req.body;

    if (!contactNumber || !messageType) {
      return res.status(400).json({
        error: 'Missing required parameters: contactNumber and messageType'
      });
    }

    console.log(`Cleaning up ${messageType} messages for ${contactNumber} in bot ${botName}`);

    // Get reference to the scheduled messages collection
    const scheduledMessagesRef = db.collection('companies')
      .doc(botName)
      .collection('scheduledMessages');

    // Query for messages that match our criteria
    const querySnapshot = await scheduledMessagesRef
      .where('status', '==', 'scheduled')
      .get();

    let deletedCount = 0;

    // Batch delete to improve performance
    const batch = db.batch();

    for (const doc of querySnapshot.docs) {
      const messageData = doc.data();

      // Check if this message matches our criteria
      if (messageData.messages?.some(msg => msg.chatId === contactNumber) &&
        messageData.metadata?.type === messageType) {

        batch.delete(doc.ref);
        deletedCount++;

        // Also delete any associated batches
        const batchesSnapshot = await doc.ref.collection('batches').get();
        batchesSnapshot.docs.forEach(batchDoc => {
          batch.delete(batchDoc.ref);
        });
      }
    }

    // Commit the batch delete
    if (deletedCount > 0) {
      await batch.commit();
    }

    console.log(`Deleted ${deletedCount} scheduled messages`);

    res.json({
      success: true,
      deletedCount,
      message: `Removed ${deletedCount} scheduled messages for ${contactNumber}`
    });

  } catch (error) {
    console.error('Error cleaning up scheduled messages:', error);
    res.status(500).json({
      error: 'Failed to cleanup scheduled messages',
      details: error.message
    });
  }
});

app.post('/api/messages/image/:token', async (req, res) => {
  const { chatId, imageUrl, caption } = req.body;
  const token = req.params.token;
  try {
    const response = await fetch(`https://gate.whapi.cloud/messages/image`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to: chatId, media: imageUrl, caption })
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error sending image message:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/v2/messages/document/:companyId/:chatId', async (req, res) => {
  const companyId = req.params.companyId;
  const chatId = req.params.chatId;
  const { documentUrl, filename, caption, phoneIndex: requestedPhoneIndex, userName: requestedUserName } = req.body;
  const phoneIndex = requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;
  const userName = requestedUserName !== undefined ? requestedUserName : '';

  try {
    let client;
    // 1. Get the client for this company from botMap
    const botData = botMap.get(companyId);
    if (!botData) {
      return res.status(404).send('WhatsApp client not found for this company');
    }
    client = botData[phoneIndex].client;

    if (!client) {
      return res.status(404).send('No active WhatsApp client found for this company');
    }

    // 2. Use wwebjs to send the document message
    const media = await MessageMedia.fromUrl(documentUrl, { unsafeMime: true, filename: filename });
    const sentMessage = await client.sendMessage(chatId, media, { caption });
    let phoneNumber = '+' + (chatId).split('@')[0];

    // 3. Save the message to Firebase
    const messageData = {
      chat_id: sentMessage.from,
      from: sentMessage.from ?? "",
      from_me: true,
      id: sentMessage.id._serialized ?? "",
      source: sentMessage.deviceType ?? "",
      status: "delivered",
      document: {
        mimetype: media.mimetype,
        link: documentUrl,
        filename: filename,
        caption: caption ?? "",
      },
      timestamp: sentMessage.timestamp ?? 0,
      type: 'document',
      userName: userName,
      ack: sentMessage.ack ?? 0,
    };

    const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(phoneNumber);
    const messagesRef = contactRef.collection('messages');

    const messageDoc = messagesRef.doc(sentMessage.id._serialized);
    await messageDoc.set(messageData, { merge: true });

    res.json({ success: true, messageId: sentMessage.id._serialized });
  } catch (error) {
    console.error('Error sending document message:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/messages/document/:token', async (req, res) => {
  const { chatId, imageUrl, caption, mimeType, fileName } = req.body;
  const token = req.params.token;
  try {
    const response = await fetch(`https://gate.whapi.cloud/messages/document`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to: chatId, media: imageUrl, caption, filename: fileName, mimeType: mimeType })
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error sending image message:', error);
    res.status(500).send('Internal Server Error');
  }
});

// ... existing code ...

// Add these helper functions
async function backupSessionFolder(clientName) {
  try {
    const sessionPath = path.join(__dirname, '.wwebjs_auth', 'session-' + clientName);
    const backupPath = path.join(__dirname, '.wwebjs_auth', 'backup-session-' + clientName);

    // Only backup if session folder exists
    if (fs.existsSync(sessionPath)) {
      // Remove old backup if exists
      if (fs.existsSync(backupPath)) {
        await fs.promises.rm(backupPath, { recursive: true, force: true });
      }

      // Create backup
      await fs.promises.cp(sessionPath, backupPath, { recursive: true });
      console.log(`Session backup created for ${clientName}`);
    }
  } catch (error) {
    console.error(`Error backing up session for ${clientName}:`, error);
  }
}

async function checkAndReinitializeClient(client, botName, phoneIndex, clientName) {
  try {
    // Check client status
    const isInvalidState = !client ||
      (clients[phoneIndex].status !== 'ready' &&
        clients[phoneIndex].status !== 'authenticated' &&
        clients[phoneIndex].status !== 'qr');

    if (isInvalidState) {
      console.log(`Invalid client state detected for ${botName} Phone ${phoneIndex + 1}. Reinitializing...`);

      // Destroy existing client if it exists
      if (client) {
        await client.destroy();
      }

      // Delete the session folder
      const sessionPath = path.join(__dirname, '.wwebjs_auth', 'session-' + clientName);
      if (fs.existsSync(sessionPath)) {
        await fs.promises.rm(sessionPath, { recursive: true, force: true });
        console.log(`Deleted session folder for ${clientName}`);
      }

      // Wait before reinitializing
      await customWait(5000);

      // Reinitialize client
      await client.initialize();
      console.log(`Client reinitialized for ${botName} Phone ${phoneIndex + 1}`);
    }
  } catch (error) {
    console.error(`Error in checkAndReinitializeClient for ${botName} Phone ${phoneIndex + 1}:`, error);
    throw error;
  }
}



app.post('/api/fetch-users', async (req, res) => {
  const { accessToken, locationId } = req.body;
  const maxRetries = 5;
  const baseDelay = 5000;

  const fetchData = async (url, retries = 0) => {
    const options = {
      method: 'GET',
      url: url,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
      params: {
        locationId: locationId,
      }
    };
    try {
      const response = await axios.request(options);
      return response;
    } catch (error) {
      if (error.response && error.response.status === 429 && retries < maxRetries) {
        const delay = baseDelay * Math.pow(2, retries);
        console.warn(`Rate limit hit, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchData(url, retries + 1);
      } else {
        console.error('Error during fetchData:', error);
        throw error;
      }
    }
  };

  try {
    const url = `https://services.leadconnectorhq.com/users/`;
    const response = await fetchData(url);
    res.json(response.data.users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).send('Error fetching users');
  }
});

app.post('/api/contacts/remove-tags', async (req, res) => {
  const { companyId, contactPhone, tagsToRemove } = req.body;

  if (!companyId || !contactPhone || !tagsToRemove || !Array.isArray(tagsToRemove)) {
    return res.status(400).json({
      error: 'Missing required fields. Please provide companyId, contactPhone, and tagsToRemove array'
    });
  }

  try {
    const contactRef = db.collection('companies')
      .doc(companyId)
      .collection('contacts')
      .doc(contactPhone);

    const contactDoc = await contactRef.get();
    if (!contactDoc.exists) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Remove the specified tags using arrayRemove
    await contactRef.update({
      tags: admin.firestore.FieldValue.arrayRemove(...tagsToRemove)
    });

    // Get the updated contact data
    const updatedContact = await contactRef.get();

    res.json({
      success: true,
      message: 'Tags removed successfully',
      updatedTags: updatedContact.data().tags
    });

  } catch (error) {
    console.error('Error removing tags:', error);
    res.status(500).json({
      error: 'Failed to remove tags',
      details: error.message
    });
  }
});
async function customWait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
app.post('/api/v2/messages/video/:companyId/:chatId', async (req, res) => {
  const companyId = req.params.companyId;
  const chatId = req.params.chatId;
  const { videoUrl, caption, phoneIndex: requestedPhoneIndex, userName: requestedUserName } = req.body;
  const phoneIndex = requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;
  const userName = requestedUserName !== undefined ? requestedUserName : '';

  try {
    let client;
    // 1. Get the client for this company from botMap
    const botData = botMap.get(companyId);
    if (!botData) {
      return res.status(404).send('WhatsApp client not found for this company');
    }
    client = botData[phoneIndex].client;

    if (!client) {
      return res.status(404).send('No active WhatsApp client found for this company');
    }

    // 2. Use wwebjs to send the video message
    const media = await MessageMedia.fromUrl(videoUrl);
    const sentMessage = await client.sendMessage(chatId, media, { caption });
    let phoneNumber = '+' + (chatId).split('@')[0];

    // 3. Save the message to Firebase
    const messageData = {
      chat_id: sentMessage.from,
      from: sentMessage.from ?? "",
      from_me: true,
      id: sentMessage.id._serialized ?? "",
      source: sentMessage.deviceType ?? "",
      status: "delivered",
      video: {
        mimetype: media.mimetype,
        link: videoUrl,
        caption: caption ?? "",
      },
      timestamp: sentMessage.timestamp ?? 0,
      type: 'video',
      userName: userName,
      ack: sentMessage.ack ?? 0,
    };

    const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(phoneNumber);
    const messagesRef = contactRef.collection('messages');

    const messageDoc = messagesRef.doc(sentMessage.id._serialized);
    await messageDoc.set(messageData, { merge: true });

    res.json({ success: true, messageId: sentMessage.id._serialized });
  } catch (error) {
    console.error('Error sending video message:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/api/update-phone-indices/:companyId', async (req, res) => {
  const { companyId } = req.params;

  try {
    console.log(`Starting phone index update for company ${companyId}...`);

    // Get reference to contacts collection
    const contactsRef = db.collection('companies')
      .doc(companyId)
      .collection('contacts');

    // Get all contacts with phoneIndex 2
    const snapshot = await contactsRef
      .where('phoneIndex', '==', 2)
      .get();

    let updatedCount = 0;
    let errors = [];

    // Process each contact
    for (const doc of snapshot.docs) {
      try {
        const updateData = {
          phoneIndex: 0,
          'last_message.phoneIndex': 0
        };

        await contactsRef.doc(doc.id).update(updateData);
        updatedCount++;

        if (updatedCount % 100 === 0) {
          console.log(`Processed ${updatedCount} contacts...`);
        }
      } catch (docError) {
        errors.push({
          contactId: doc.id,
          error: docError.message
        });
      }
    }

    const response = {
      success: true,
      message: `Update complete for company ${companyId}`,
      stats: {
        totalProcessed: snapshot.size,
        updated: updatedCount,
        errors: errors.length
      }
    };

    if (errors.length > 0) {
      response.errors = errors;
    }

    console.log(`Completed updating phone indices for ${companyId}`);
    res.json(response);

  } catch (error) {
    console.error('Error updating phone indices:', error);
    res.status(500).json({
      error: 'Failed to update phone indices',
      details: error.message
    });
  }
});
app.post('/api/channel/create/:companyID', async (req, res) => {
  const { companyID } = req.params;
  const phoneCount = 1;
  //
  try {
    // Create the assistant
    await createAssistant(companyID);

    // Initialize only the new bot
    await initializeBot(companyID, phoneCount);

    res.json({ message: 'Channel created successfully and new bot initialized', newBotId: companyID });
  } catch (error) {
    console.error('Error creating channel and initializing new bot:', error);
    res.status(500).json({ error: 'Failed to create channel and initialize new bot', details: error.message });
  }
});

async function initializeBot(botName, phoneCount = 1, specificPhoneIndex) {
  try {
    console.log(`Starting initialization for bot: ${botName} with ${phoneCount} phone(s)${specificPhoneIndex !== undefined ? `, phone ${specificPhoneIndex + 1}` : ''}`);

    let clients = botMap.get(botName) || Array(phoneCount).fill(null).map(() => ({
      client: null,
      status: null,
      qrCode: null,
      initializationStartTime: null
    }));

    const indicesToInitialize = specificPhoneIndex !== undefined
      ? [specificPhoneIndex]
      : Array.from({ length: phoneCount }, (_, i) => i);
    for (const phoneIndex of indicesToInitialize) {
      const statusDoc = await getPhoneStatus(botName, phoneIndex);

      if (statusDoc?.status === 'error' || statusDoc?.status === 'cleanup') {
        console.log(`${botName} Phone ${phoneIndex + 1} - Found ${statusDoc.status} status, cleaning up...`);

        try {
          console.log(`${botName} Phone ${phoneIndex + 1} - Reinitializing...`);
          const botData = botMap.get(botName);
          if (botData?.[phoneIndex]?.client) {
            await botData[phoneIndex].client.destroy();
            await botData[phoneIndex].client.initialize();
          }
        } catch (error) {
          console.error(`${botName} Phone ${phoneIndex + 1} - Error reinitializing:`, error);
          const clients = botMap.get(botName);
          if (clients) {
            clients[phoneIndex] = {
              ...clients[phoneIndex],
              status: 'error',
              qrCode: null,
              error: error.message
            };
            botMap.set(botName, clients);
            broadcastAuthStatus(botName, 'error', null, clients.length > 1 ? phoneIndex : undefined);
          }
        }
      }
    }

    // Initialize all phones in parallel
    const initializationPromises = indicesToInitialize.map(async (i) => {
      try {
        let clientName = phoneCount == 1 ? botName : `${botName}_phone${i + 1}`;

        // Remove stagger delay and initialize immediately
        return initializeWithTimeout(botName, i, clientName, clients);
      } catch (phoneError) {
        console.error(`Error initializing bot ${botName} Phone ${i + 1}:`, phoneError);
        clients[i] = {
          client: null,
          status: 'error',
          qrCode: null,
          error: phoneError.message,
          initializationStartTime: null
        };
        botMap.set(botName, clients);
        broadcastStatus(botName, 'error', i);
      }
    });

    // Wait for all initializations to complete
    await Promise.allSettled(initializationPromises);

    console.log(`Bot ${botName} initialization attempts completed for all phones`);


  } catch (error) {
    console.error(`Error in initializeBot for ${botName}:`, error);
    handleInitializationError(botName, phoneCount, specificPhoneIndex, error);
  }
}
// Add this utility function for retrying operations
const retry = async (operation, retries = 3, delay = 1000) => {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
};

// Improved copyDirectory function
// ... existing code ...

async function copyDirectory(source, target, concurrency = 50) {
  try {
    // Remove existing backup if it exists
    if (await fs.promises.access(target).then(() => true).catch(() => false)) {
      await fs.promises.rm(target, { recursive: true, force: true });
    }

    // Create target directory
    await fs.promises.mkdir(target, { recursive: true });

    // Get all files to copy
    const files = await fs.promises.readdir(source);

    // Process files in batches to limit concurrent operations
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);

      await Promise.all(batch.map(async file => {
        const sourcePath = path.join(source, file);
        const targetPath = path.join(target, file);

        try {
          // Skip known problematic files
          if (file === 'CrashpadMetrics.pma' ||
            file.endsWith('.lock') ||
            file.endsWith('.tmp')) {
            console.log(`Skipping potentially locked file: ${file}`);
            return;
          }

          const stat = await fs.promises.stat(sourcePath).catch(() => null);
          if (!stat) {
            console.log(`Unable to access file: ${file}`);
            return;
          }

          if (stat.isDirectory()) {
            await copyDirectory(sourcePath, targetPath, concurrency);
          } else {
            await retry(async () => {
              return new Promise((resolve, reject) => {
                const readStream = fs.createReadStream(sourcePath);
                const writeStream = fs.createWriteStream(targetPath);

                const cleanup = () => {
                  readStream.destroy();
                  writeStream.destroy();
                };

                readStream.on('error', (error) => {
                  cleanup();
                  // Don't fail on permission errors, just log and continue
                  if (error.code === 'EPERM' || error.code === 'EBUSY') {
                    console.log(`Permission/busy error on file ${file}, skipping`);
                    resolve();
                  } else {
                    reject(error);
                  }
                });

                writeStream.on('error', (error) => {
                  cleanup();
                  reject(error);
                });

                writeStream.on('finish', () => {
                  cleanup();
                  resolve();
                });

                readStream.pipe(writeStream);
              });
            }, 3, 1000).catch(error => {
              console.log(`Failed to copy file ${file} after retries: ${error.message}`);
            });
          }
        } catch (error) {
          // Log the error but don't fail the entire operation
          console.warn(`Warning: Failed to copy ${sourcePath}: ${error.message}`);
        }
      }));
    }
  } catch (error) {
    console.error(`Error in copyDirectory (${source} -> ${target}):`, error);
    // Don't throw the error, allow the backup process to continue
    console.log('Continuing with partial backup...');
  }
}

// ... rest of the code ...
// Add new function to manage phone status in Firebase
async function updatePhoneStatus(companyId, phoneIndex, status, details = {}) {
  try {
    const phoneStatusRef = db.collection('companies')
      .doc(companyId)
      .collection('phoneStatus')
      .doc(`phone${phoneIndex}`);

    await phoneStatusRef.set({
      status,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      ...details
    }, { merge: true });


    // Broadcast the new status
    broadcastStatus(companyId, status, phoneIndex);

  } catch (error) {
    console.error(`Error updating phone status in Firebase for ${companyId} Phone ${phoneIndex + 1}:`, error);
  }
}

// Add function to check phone status from Firebase
async function getPhoneStatus(companyId, phoneIndex) {
  try {
    const phoneStatusRef = db.collection('companies')
      .doc(companyId)
      .collection('phoneStatus')
      .doc(`phone${phoneIndex}`);

    const doc = await phoneStatusRef.get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error(`Error getting phone status from Firebase for ${companyId} Phone ${phoneIndex + 1}:`, error);
    return null;
  }
}
const monitoringIntervals = new Map();

function startPhoneMonitoring(botName, phoneIndex) {
  // Clear any existing interval for this bot/phone combination
  if (monitoringIntervals.has(`${botName}_${phoneIndex}`)) {
    clearInterval(monitoringIntervals.get(`${botName}_${phoneIndex}`));
  }

  console.log(`Starting daily phone monitoring for ${botName} Phone ${phoneIndex + 1}`);

  // Calculate initial delay to next midnight
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const initialDelay = tomorrow - now;

  // Schedule first check at next midnight
  const timeoutId = setTimeout(() => {
    // Start the daily interval after the initial delay
    const intervalId = setInterval(async () => {
      try {
        console.log(`Running daily status check for ${botName} Phone ${phoneIndex + 1}`);
        const statusDoc = await db.collection('companies')
          .doc(botName)
          .collection('phoneStatus')
          .doc(`phone${phoneIndex}`)
          .get();

        if (statusDoc.exists && statusDoc.data().status === 'initializing') {
          try {
            console.log(`${botName} Phone ${phoneIndex + 1} - Reinitializing...`);
            const botData = botMap.get(botName);
            if (botData?.[phoneIndex]?.client) {
              await botData[phoneIndex].client.destroy();
              await botData[phoneIndex].client.initialize();
            }
          } catch (error) {
            console.error(`${botName} Phone ${phoneIndex + 1} - Error reinitializing:`, error);
            const clients = botMap.get(botName);
            if (clients) {
              clients[phoneIndex] = {
                ...clients[phoneIndex],
                status: 'error',
                qrCode: null,
                error: error.message
              };
              botMap.set(botName, clients);
              broadcastAuthStatus(botName, 'error', null, clients.length > 1 ? phoneIndex : undefined);
            }
          }
        }
      } catch (error) {
        console.error(`Error checking initialization status for ${botName} Phone ${phoneIndex + 1}:`, error);
      }
    }, 24 * 60 * 60 * 1000); // Run every 24 hours

    // Store the interval ID
    monitoringIntervals.set(`${botName}_${phoneIndex}`, intervalId);
  }, initialDelay);

  // Store the initial timeout ID with a special prefix
  monitoringIntervals.set(`init_${botName}_${phoneIndex}`, timeoutId);
}
// Modify initializeWithTimeout to include Firebase status checks
async function initializeWithTimeout(botName, phoneIndex, clientName, clients) {
  return new Promise(async (resolve, reject) => {
    let isResolved = false;
    const sessionDir = path.join(__dirname, '.wwebjs_auth', `session-${clientName}`);
    const backupDir = path.join(__dirname, '.wwebjs_auth_backup', `session-${clientName}`);

    // Backup logic for 'ready' status
    const doc = await db.collection('companies')
      .doc(botName)
      .collection('phoneStatus')
      .doc(`phone${phoneIndex}`)
      .get();

    if (doc.exists && doc.data().status === 'ready' && fs.existsSync(sessionDir)) {
      console.log(`${botName} Phone ${phoneIndex + 1} - Previous status was ready, creating backup...`);
      try {
        // await fs.promises.mkdir(path.dirname(backupDir), { recursive: true });
        //  await copyDirectory(sessionDir, backupDir);
        console.log(`${botName} Phone ${phoneIndex + 1} - Backup created successfully`);
      } catch (backupError) {
        console.error(`${botName} Phone ${phoneIndex + 1} - Error creating backup:`, backupError);
      }
    }

    try {
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: clientName,
        }),
        puppeteer: {
          headless: true,
          executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
          ignoreHTTPSErrors: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-extensions",
            '--disable-gpu',
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            '--disable-dev-shm-usage'
          ],
          timeout: 120000,
        }
      });

      // Set initial status to initializing
      console.log(`Initializing ${botName} Phone ${phoneIndex + 1}...`);
      clients[phoneIndex] = {
        client,
        status: 'initializing',
        qrCode: null,
        initializationStartTime: Date.now()
      };
      botMap.set(botName, clients);
      await updatePhoneStatus(botName, phoneIndex, 'initializing');
      console.log(`Starting monitoring for bot ${botName} Phone ${phoneIndex + 1}`);
      startPhoneMonitoring(botName, phoneIndex);
      // Start checking for stuck initialization
      const checkInitialization = setInterval(async () => {
        try {
          const statusDoc = await db.collection('companies')
            .doc(botName)
            .collection('phoneStatus')
            .doc(`phone${phoneIndex}`)
            .get();

          if (statusDoc.exists && statusDoc.data().status === 'initializing') {
            console.log(`${botName} Phone ${phoneIndex + 1} - Still initializing, marking as error and running cleanup...`);
            try {
              console.log(`${botName} Phone ${phoneIndex + 1} - Reinitializing...`);
              await client.destroy();
              await client.initialize();
            } catch (error) {
              console.error(`${botName} Phone ${phoneIndex + 1} - Error reinitializing:`, error);
              clients[i] = { ...clients[i], status: 'error', qrCode: null, error: error.message };
              botMap.set(botName, clients);
              broadcastAuthStatus(botName, 'error', null, phoneCount > 1 ? phoneIndex : undefined);
            }
          }
        } catch (error) {
          console.error(`Error checking initialization status: ${error}`);
        }
      }, 300000); // Check every 30 seconds

      client.on('qr', async (qr) => {
        try {
          const qrCodeData = await qrcode.toDataURL(qr);
          clients[phoneIndex] = {
            ...clients[phoneIndex],
            client,
            status: 'qr',
            qrCode: qrCodeData,
            initializationStartTime: null
          };
          botMap.set(botName, clients);
          await updatePhoneStatus(botName, phoneIndex, 'qr', { qrCode: qrCodeData });
          broadcastAuthStatus(botName, 'qr', qrCodeData, clients.length > 1 ? phoneIndex : undefined);
        } catch (err) {
          console.error('Error generating QR code:', err);
        }
      });

      client.on('authenticated', async () => {
        console.log(`${botName} Phone ${phoneIndex + 1} - AUTHENTICATED`);
        clients[phoneIndex] = {
          ...clients[phoneIndex],
          status: 'authenticated',
          qrCode: null
        };
        botMap.set(botName, clients);
        await updatePhoneStatus(botName, phoneIndex, 'authenticated');
      });

      client.on('ready', async () => {
        clearInterval(checkInitialization);
        console.log(`${botName} Phone ${phoneIndex + 1} - READY`);
        clients[phoneIndex] = {
          ...clients[phoneIndex],
          status: 'ready',
          qrCode: null
        };
        botMap.set(botName, clients);
        setupMessageHandler(client, botName, phoneIndex);
        setupMessageCreateHandler(client, botName, phoneIndex);
        await updatePhoneStatus(botName, phoneIndex, 'ready');
        if (!isResolved) {
          isResolved = true;
          resolve();
        }
      });

      client.on('error', async (error) => {
        clearInterval(checkInitialization);
        console.error(`${botName} Phone ${phoneIndex + 1} - Client error:`, error);
        try {

          console.log(`${botName} Phone ${phoneIndex + 1} - Reinitializing...`);
          await client.destroy();
          await client.initialize();
        } catch (error) {
          console.error(`${botName} Phone ${phoneIndex + 1} - Error reinitializing:`, error);
          clients[i] = { ...clients[i], status: 'error', qrCode: null, error: error.message };
          botMap.set(botName, clients);
          broadcastAuthStatus(botName, 'error', null, phoneCount > 1 ? phoneIndex : undefined);
        }
      });

      client.on('disconnected', async (reason) => {
        clearInterval(checkInitialization);
        console.log(`${botName} Phone ${phoneIndex + 1} - DISCONNECTED:`, reason);

        const attemptReinitialization = async () => {
          try {
            await updatePhoneStatus(botName, phoneIndex, 'disconnected', {
              reason: reason
            });

            const botData = botMap.get(botName);
            console.log(`${botName} Phone ${phoneIndex + 1} - Reinitializing...`);

            // Wrap destroy in try-catch to handle EPERM errors
            try {
              await botData[phoneIndex].client.destroy();
            } catch (destroyError) {
              console.log(`${botName} Phone ${phoneIndex + 1} - Could not destroy client:`, destroyError.message);
              // Continue anyway - the error is expected sometimes
            }

            try {
              await botData[phoneIndex].client.initialize();
            } catch (initError) {
              console.error(`${botName} Phone ${phoneIndex + 1} - Error initializing:`, initError);
              const clients = botMap.get(botName);
              if (clients) {
                clients[phoneIndex] = { ...clients[phoneIndex], status: 'error', qrCode: null, error: initError.message };
                botMap.set(botName, clients);
                broadcastAuthStatus(botName, 'error', null, clients.length > 1 ? phoneIndex : undefined);

                // Wait and retry
                console.log(`${botName} Phone ${phoneIndex + 1} - Retrying initialization in 5 seconds...`);
                setTimeout(attemptReinitialization, 5000);
              }
            }
          } catch (error) {
            console.error(`${botName} Phone ${phoneIndex + 1} - Error in disconnection handler:`, error);
            // Wait and retry
            console.log(`${botName} Phone ${phoneIndex + 1} - Retrying in 5 seconds...`);
            setTimeout(attemptReinitialization, 5000);
          }
        };

        // Start the first attempt and catch any unhandled rejections
        attemptReinitialization().catch(error => {
          console.error(`${botName} Phone ${phoneIndex + 1} - Reinitialization attempt failed:`, error);
          // Retry after error
          setTimeout(attemptReinitialization, 5000);
        });
      });

      await client.initialize();
      console.log(`Bot ${botName} Phone ${phoneIndex + 1} initialization complete`);

    } catch (error) {
      // clearInterval(checkInitialization);
      await updatePhoneStatus(botName, phoneIndex, 'error', {
        error: error.message
      });
      try {
        const statusDoc = await db.collection('companies')
          .doc(botName)
          .collection('phoneStatus')
          .doc(`phone${phoneIndex}`)
          .get();
        if (statusDoc.exists && statusDoc.data().status === 'initializing') {
          try {
            console.log(`${botName} Phone ${phoneIndex + 1} - Reinitializing...`);
            await client.destroy();
            await client.initialize();
          } catch (error) {
            console.error(`${botName} Phone ${phoneIndex + 1} - Error reinitializing:`, error);
            clients[i] = { ...clients[i], status: 'error', qrCode: null, error: error.message };
            botMap.set(botName, clients);
            broadcastAuthStatus(botName, 'error', null, phoneCount > 1 ? phoneIndex : undefined);
          }
        }
      } catch (error) {
        console.error(`Error checking initialization status for ${botName} Phone ${phoneIndex + 1}:`, error);
      }
      reject(error);
    }
  });
}
async function reinitializeClient(client, botName, phoneIndex) {
  try {
    console.log(`${botName} Phone ${phoneIndex + 1} - Reinitializing...`);
    await client.destroy();
    await client.initialize();
  } catch (error) {
    console.error(`${botName} Phone ${phoneIndex + 1} - Error reinitializing:`, error);
    // Handle the error, possibly retry or log for further investigation
  }
}
async function sendAlertToEmployees(companyId) {
  try {
    // Ensure the client for bot 001 is initialized and ready
    const botData = botMap.get('0210');
    if (!botData || !botData[0]?.client || botData[0].status !== 'ready') {
      console.error('Client for bot 001 is not initialized or not ready.');
      return;
    }

    const client = botData[0].client;

    // Fetch employees from the target companyId
    const employeesSnapshot = await db.collection('companies').doc(companyId).collection('employee').get();
    console.log(`Fetched ${employeesSnapshot.size} employees for company ${companyId}.`);

    if (employeesSnapshot.empty) {
      console.warn(`No employees found for company ${companyId}.`);
      return;
    }

    const employees = employeesSnapshot.docs.map(doc => doc.data()).filter(emp => emp.role === '1');
    console.log(`Filtered ${employees.length} employees with role '1'.`);

    if (employees.length === 0) {
      console.warn(`No employees with role '1' found for company ${companyId}.`);
      return;
    }

    const alertMessage = `[ALERT] WhatsApp Connection Disconnected\n\nACTION REQUIRED:\n\n1. Navigate to web.jutasoftware.co.\n2. Log in to your account.\n3. Scan the QR code to reinitialize your WhatsApp connection.\n\nFor support, please contact +601121677672`;

    for (const emp of employees) {
      if (emp.phoneNumber) {
        const employeeID = emp.phoneNumber.replace('+', '') + '@c.us';
        console.log(`Sending alert to ${emp.phoneNumber}`);
        try {
          await client.sendMessage(employeeID, alertMessage);
          console.log(`Alert sent to ${emp.phoneNumber} about ${companyId} QR status`);
        } catch (sendError) {
          console.error(`Failed to send message to ${emp.phoneNumber}:`, sendError);
        }
      } else {
        console.warn(`Employee ${emp.name} does not have a phone number.`);
      }
    }
  } catch (error) {
    console.error('Error sending alert to employees:', error);
  }
}
function broadcastStatus(botName, status, phoneIndex = 0) {


  // Get client info if available
  const botData = botMap.get(botName);
  let clientPhone = null;

  if (botData?.[phoneIndex]?.client?.info?.wid) {
    clientPhone = botData[phoneIndex].client.info.wid.user;
  }

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.isLogsViewer) {
      client.send(JSON.stringify({
        type: 'status_update',
        botName,
        status,
        phoneIndex,
        clientPhone,
        timestamp: new Date().toISOString()
      }));
    }
  });
}
async function createAssistant(companyID) {
  const OPENAI_API_KEY = process.env.OPENAIKEY; // Ensure your environment variable is set
  const payload = {
    name: companyID,
    model: 'gpt-4o-mini', // Ensure this model is supported and available
  };

  try {
    const response = await axios.post('https://api.openai.com/v1/assistants', payload, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
    });

    const assistantId = response.data.id;
    const companiesCollection = db.collection('companies');


    // Save the whapiToken to a new document
    await companiesCollection.doc(companyID).set({
      assistantId: assistantId,
      v2: true
    }, { merge: true });
    return;

  } catch (error) {
    console.error('Error creating OpenAI assistant:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to create assistant' });
  }
}

main().catch(error => {
  console.error('Error during initialization:', error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n=== Graceful Shutdown Initiated ===');

  try {
    // 1. Close Queue Workers
    console.log('Closing queue workers...');
    const workerShutdownPromises = [];
    for (const [botId, worker] of botWorkers.entries()) {
      workerShutdownPromises.push(
        worker.close()
          .then(() => console.log(`Queue worker closed for bot ${botId}`))
          .catch(err => console.error(`Error closing queue worker for bot ${botId}:`, err))
      );
    }

    // 2. Close WhatsApp Clients
    console.log('Closing WhatsApp clients...');
    const clientShutdownPromises = [];

    for (const [botName, botData] of botMap.entries()) {
      if (Array.isArray(botData)) {
        // Multiple clients for this bot
        for (let i = 0; i < botData.length; i++) {
          const { client } = botData[i] || {};
          if (client) {
            try {
              clientShutdownPromises.push(
                client.destroy()
                  .then(() => console.log(`WhatsApp client destroyed for bot ${botName} phone ${i}`))
                  .catch(err => console.error(`Error destroying WhatsApp client for bot ${botName} phone ${i}:`, err))
              );

              // Handle Puppeteer browser cleanup if available
              if (client.pupPage?.browser()) {
                clientShutdownPromises.push(
                  client.pupPage.browser().close()
                    .then(() => console.log(`Browser closed for bot ${botName} phone ${i}`))
                    .catch(err => console.error(`Error closing browser for bot ${botName} phone ${i}:`, err))
                );
              }
            } catch (error) {
              console.error(`Error initiating shutdown for ${botName} phone ${i}:`, error);
            }
          }
        }
      }
    }

    // 3. Wait for all cleanup operations to complete
    console.log('Waiting for all cleanup operations...');
    await Promise.allSettled([
      ...workerShutdownPromises,
      ...clientShutdownPromises
    ]);

    // 4. Clear all maps and connections
    botWorkers.clear();
    botQueues.clear();
    botMap.clear();

    // 5. Close Redis connection
    if (connection) {
      console.log('Closing Redis connection...');
      await connection.disconnect();
    }

    console.log('\n=== Cleanup Complete ===');
    console.log('Workers closed:', botWorkers.size === 0);
    console.log('Queues cleared:', botQueues.size === 0);
    console.log('WhatsApp clients cleared:', botMap.size === 0);

    // Small delay to ensure all logs are written
    await new Promise(resolve => setTimeout(resolve, 1000));

    process.exit(0);
  } catch (error) {
    console.error('\n=== Shutdown Error ===');
    console.error('Error Type:', error.name);
    console.error('Error Message:', error.message);
    console.error('Stack:', error.stack);

    // Force exit after error
    process.exit(1);
  }
});

// Also handle other termination signals
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  process.emit('SIGINT');
});

process.on('uncaughtException', (error) => {
  console.error('\n=== Uncaught Exception ===');
  console.error('Error:', error);

});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n=== Unhandled Rejection ===');
  console.error('Reason:', reason);

});



async function cleanupAndWait(dirPath, maxRetries = 5) {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      // Check if directory exists first
      if (!fs.existsSync(dirPath)) {
        return;
      }

      if (process.platform === 'win32') {
        // For Windows, use rimraf or force delete
        await exec(`rmdir /s /q "${dirPath}"`);
      } else {
        // For Unix-based systems
        await fs.promises.rm(dirPath, { recursive: true, force: true });
      }

      // Wait a bit to ensure cleanup is complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify directory is gone
      if (!fs.existsSync(dirPath)) {
        console.log(`Successfully cleaned up directory: ${dirPath}`);
        return;
      }

      throw new Error('Directory still exists after deletion attempt');
    } catch (error) {
      attempt++;
      console.warn(`Attempt ${attempt}/${maxRetries} failed to clean up ${dirPath}:`, error);

      if (attempt === maxRetries) {
        throw new Error(`Failed to clean up directory after ${maxRetries} attempts: ${dirPath}`);
      }

      // Exponential backoff wait between attempts
      await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 10000)));
    }
  }
}

// Add a function to clean up locked files
async function cleanupLockedFiles(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      return;
    }

    const files = await fs.promises.readdir(dirPath);

    for (const file of files) {
      const filePath = path.join(dirPath, file);

      // Handle locked database files
      if (file.endsWith('.db-journal') || file.endsWith('.db-wal') || file.endsWith('.db-shm')) {
        try {
          await fs.promises.unlink(filePath);
          console.log(`Cleaned up locked file: ${filePath}`);
        } catch (err) {
          console.warn(`Warning: Could not delete locked file ${filePath}:`, err);
        }
      }
    }
  } catch (error) {
    console.warn(`Warning: Error cleaning up locked files in ${dirPath}:`, error);
  }
}
async function scheduleAppointmentReminder(appointment, companyId) {
  try {
    console.log(`Scheduling reminder for appointment ${appointment.id}`);

    // Get the appointment time
    const appointmentTime = new Date(appointment.endTime);

    // Schedule reminder for 24 hours before appointment
    const reminderTime = new Date(appointmentTime);
    reminderTime.setHours(reminderTime.getHours() - 24);

    // Get the contact's phone number from the appointment
    const contactPhone = appointment.contacts[0]?.phone;
    if (!contactPhone) {
      console.error('No contact phone found for appointment:', appointment.id);
      return;
    }

    // Format the reminder message
    const scheduledMessage = {
      companyId,
      scheduledTime: admin.firestore.Timestamp.fromDate(reminderTime),
      message: `Reminder: You have an appointment scheduled for ${appointmentTime.toLocaleString()}. Please be on time.`,
      chatIds: [contactPhone], // Phone numbers should include country code
      batchQuantity: 1,
      repeatInterval: 0,
      repeatUnit: 'minutes',
      v2: true,
      minDelay: 0,
      maxDelay: 1,
      phoneIndex: 0,
      type: 'appointment_reminder',
      appointmentId: appointment.id
    };

    // Use the existing scheduling API endpoint
    const response = await fetch(`http://localhost:${process.env.PORT}/api/schedule-message/${companyId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(scheduledMessage)
    });

    if (!response.ok) {
      throw new Error(`Failed to schedule reminder: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`Reminder scheduled successfully for appointment ${appointment.id}`, result);

    return result.id; // Return the scheduled message ID

  } catch (error) {
    console.error('Error scheduling appointment reminder:', error);
    throw error;
  }
}

// Add a function to watch for new appointments
function watchNewAppointments() {
  const appointmentsRef = db.collectionGroup('appointments');

  appointmentsRef.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added' || change.type === 'modified') {
        const appointment = {
          id: change.doc.id,
          ...change.doc.data()
        };
        const companyId = appointment.companyId;

        // Only process new appointments that don't have a reminder scheduled
        if (appointment.appointmentStatus === 'new' && !appointment.reminderMessageId) {
          console.log(`New appointment detected: ${appointment.id}`);

          try {
            // Schedule the reminder
            const reminderMessageId = await scheduleAppointmentReminder(appointment, companyId);

            // Update appointment with reminder information
            await change.doc.ref.update({
              appointmentStatus: 'reminder_scheduled',
              reminderMessageId: reminderMessageId,
              reminderScheduledAt: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`Appointment ${appointment.id} updated with reminder information`);
          } catch (error) {
            console.error(`Failed to process appointment ${appointment.id}:`, error);

            // Update appointment to indicate failure
            await change.doc.ref.update({
              appointmentStatus: 'reminder_failed',
              reminderError: error.message
            });
          }
        }
      }
    });
  }, (error) => {
    console.error('Error watching appointments:', error);
  });
}
// Modify the existing cleanupAndWait call in your route to include locked file cleanup
async function cleanupSession(sessionDir, authDir, botName, phoneIndex) {
  try {
    // Get clients from botMap
    const botData = botMap.get(botName);
    if (botData && botData[phoneIndex]?.client) {
      try {
        // First destroy the client
        await botData[phoneIndex].client.destroy();

        // Then close the browser
        const browser = botData[phoneIndex].client.pupPage?.browser();
        if (browser) {
          await browser.close();
        }

        // Clear the client reference
        botData[phoneIndex].client = null;

        console.log('Browser instance closed successfully');
      } catch (browserError) {
        console.warn('Error closing browser:', browserError);
      }
    }

    // Wait for browser to fully close
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Handle lockfile specifically
    const lockfilePath = path.join(sessionDir, 'lockfile');
    if (await fs.promises.access(lockfilePath).then(() => true).catch(() => false)) {
      try {
        // Try multiple times to delete the lockfile
        for (let i = 0; i < 3; i++) {
          try {
            await fs.promises.unlink(lockfilePath);
            console.log(`Deleted lockfile: ${lockfilePath}`);
            break;
          } catch (lockError) {
            if (i < 2) {
              console.log(`Attempt ${i + 1} to delete lockfile failed, waiting...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
              throw lockError;
            }
          }
        }
      } catch (lockError) {
        console.warn(`Warning: Could not delete lockfile: ${lockError.message}`);
        // Continue even if lockfile deletion fails
      }
    }

    // Now try to delete the directories
    if (await fs.promises.access(sessionDir).then(() => true).catch(() => false)) {
      try {
        await fs.promises.rm(sessionDir, { recursive: true, force: true });
        console.log(`Deleted session directory: ${sessionDir}`);
      } catch (rmError) {
        // If directory deletion fails, try to delete files individually
        const files = await fs.promises.readdir(sessionDir);
        for (const file of files) {
          try {
            const filePath = path.join(sessionDir, file);
            await fs.promises.unlink(filePath);
          } catch (fileError) {
            console.warn(`Warning: Could not delete file ${file}: ${fileError.message}`);
          }
        }
        // Try to remove the directory one last time
        await fs.promises.rmdir(sessionDir);
      }
    }

    if (authDir && await fs.promises.access(authDir).then(() => true).catch(() => false)) {
      await fs.promises.rm(authDir, { recursive: true, force: true });
      console.log(`Deleted auth directory: ${authDir}`);
    }
  } catch (error) {
    console.error('Error during session cleanup:', error);
    // Continue execution even if cleanup fails
  }
}
// New endpoint to fetch message details from Firebase
app.get('/api/queue/message-details/:companyId/:messageId', async (req, res) => {
  try {
    const { companyId, messageId } = req.params;

    // Get the main message document
    const messageDoc = await db.collection('companies')
      .doc(companyId)
      .collection('scheduledMessages')
      .doc(messageId)
      .get();

    if (!messageDoc.exists) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Get all batches for this message
    const batchesSnapshot = await db.collection('companies')
      .doc(companyId)
      .collection('scheduledMessages')
      .doc(messageId)
      .collection('batches')
      .get();

    const messageData = messageDoc.data();
    const batches = [];

    batchesSnapshot.forEach(doc => {
      batches.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      messageDetails: {
        id: messageId,
        ...messageData,
        batches
      }
    });
  } catch (error) {
    console.error('Error fetching message details:', error);
    res.status(500).json({ error: 'Failed to fetch message details' });
  }
});
app.get('/api/queue/diagnose', async (req, res) => {
  try {
    const diagnosis = {
      queues: {}
    };

    for (const [botId, queue] of botQueues.entries()) {
      // Get all job types including completed with higher limits
      const counts = await queue.getJobCounts();

      // Fetch more historical jobs
      const completedJobs = await queue.getJobs(['completed'], 0, 1000); // Get last 1000 completed jobs
      const activeJobs = await queue.getJobs(['active']);
      const delayedJobs = await queue.getJobs(['delayed']);
      const failedJobs = await queue.getJobs(['failed']);
      const waitingJobs = await queue.getJobs(['waiting']);

      // Process jobs to ensure all data is included
      const processJobs = async (jobs) => {
        return Promise.all(jobs.map(async (job) => {
          // Ensure we have the job data
          if (!job) return null;

          const jobData = {
            id: job.id,
            name: job.name,
            timestamp: job.timestamp,
            processedOn: job.processedOn,
            finishedOn: job.finishedOn,
            attemptsMade: job.attemptsMade,
            failedReason: job.failedReason,
            opts: job.opts,
            data: job.data || {},
            progress: job.progress,
            status: job.status
          };

          return jobData;
        })).then(jobs => jobs.filter(job => job !== null));
      };

      diagnosis.queues[botId] = {
        counts,
        worker: {
          isRunning: botWorkers.get(botId)?.isRunning() || false,
          concurrency: botWorkers.get(botId)?.concurrency || 0
        },
        activeJobs: await processJobs(activeJobs),
        delayedJobs: await processJobs(delayedJobs),
        failedJobs: await processJobs(failedJobs),
        waitingJobs: await processJobs(waitingJobs),
        completedJobs: await processJobs(completedJobs)
      };
    }

    res.json(diagnosis);
  } catch (error) {
    console.error('Queue diagnosis error:', error);
    res.status(500).json({ error: 'Failed to diagnose queues' });
  }
});
// Update the reset endpoint as well
app.post('/api/queue/reset', async (req, res) => {
  try {
    console.log('\n=== Starting Queue Reset ===');
    const status = {};

    // Reset all queues and workers
    for (const [botId, queue] of botQueues.entries()) {
      const worker = botWorkers.get(botId);

      // Stop the worker
      if (worker) {
        await worker.close();
        console.log(`Worker closed for bot ${botId}`);
      }

      // Clear all jobs
      await queue.obliterate({ force: true });
      console.log(`Queue obliterated for bot ${botId}`);

      // Restart the worker
      const { worker: newWorker } = createQueueAndWorker(botId);
      botWorkers.set(botId, newWorker);
      console.log(`Worker restarted for bot ${botId}`);

      // Get current status
      status[botId] = await queue.getJobCounts();
    }

    res.json({
      message: 'Queue reset complete',
      status
    });
  } catch (error) {
    console.error('Error resetting queue:', error);
    res.status(500).json({ error: 'Failed to reset queue' });
  }
});

// Update the force process endpoint
app.post('/api/queue/force-process', async (req, res) => {
  try {
    console.log('\n=== Force Processing Queues ===');
    const results = {};

    for (const [botId, queue] of botQueues.entries()) {
      const jobs = await queue.getJobs(['active', 'delayed', 'waiting']);
      console.log(`Found ${jobs.length} jobs for bot ${botId}`);

      for (const job of jobs) {
        try {
          await job.moveToFailed(new Error('Force reset'), true);
          await job.retry();
        } catch (jobError) {
          console.error(`Error processing job ${job.id} for bot ${botId}:`, jobError);
        }
      }

      results[botId] = {
        processedCount: jobs.length,
        newStatus: await queue.getJobCounts()
      };
    }

    res.json({
      message: 'Force processing complete',
      results
    });
  } catch (error) {
    console.error('Force processing error:', error);
    res.status(500).json({ error: 'Failed to force process queues' });
  }
});

// ... existing code ...
