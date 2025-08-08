// ======================
// 1. CORE IMPORTS
// ======================

// Core Node.js Modules
const path = require("path");
const os = require("os");
const url = require("url");
const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");
const { pipeline } = require("stream/promises");
const { createServer } = require("http");
const FormData = require('form-data');
const { Readable } = require('stream');

// Third-party Libraries
// Framework & Middleware
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { setupNeonWebhooks } = require('./neon-webhook-integration');

// API Clients & Communication
const axios = require("axios");
const fetch = require("node-fetch");
const WebSocket = require("ws");
const { google } = require("googleapis");
const OpenAI = require("openai");
const {
  Client,
  LocalAuth,
  RemoteAuth,
  MessageMedia,
} = require("whatsapp-web.js");

// Database & Storage
const Redis = require("ioredis");
const { neon, neonConfig } = require("@neondatabase/serverless");
const { Pool } = require("pg");
const multer = require('multer');

// Queue & Scheduling
const { Queue, Worker, QueueScheduler } = require("bullmq");
const cron = require("node-cron");
const schedule = require("node-schedule");

// Utilities
require("dotenv").config();
const moment = require("moment-timezone");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const CryptoJS = require("crypto-js");
const { v4: uuidv4 } = require("uuid");
const csv = require("csv-parser");
const ffmpeg = require("ffmpeg-static");

// Custom Modules
const FirebaseWWebJS = require("./firebaseWweb.js");
const admin = require("./firebase.js");
const AutomatedMessaging = require("./blast/automatedMessaging");
const sqlDb = require("./db");
const {
  handleNewMessagesTemplateWweb,
} = require("./bots/handleMessagesTemplateWweb.js");
const { handleTagFollowUp } = require("./blast/tag.js");

// Import logging system
const ServerLogger = require('./logger');
const LogManager = require('./logManager');
const feedbackFormsRouter = require('./routes/feedbackForms.js');
const eventsRouter = require('./routes/events');
const enrolleesRouter = require('./routes/enrollees');
const participantsRouter = require('./routes/participants');
const attendanceEventsRouter = require('./routes/attendanceEvents');
const feedbackResponsesRouter = require('./routes/feedbackResponse');

// Initialize logger
const logger = new ServerLogger();
const logManager = new LogManager();

// Add rate limiting configuration at the top of the file
const RATE_LIMIT_DELAY = 5000; // 5 seconds between requests
const MAX_REQUESTS_PER_MINUTE = 60;
const requestCounts = new Map();

// Rate limiting function
function checkRateLimit(identifier) {
  const now = Date.now();
  const minuteAgo = now - 60000;
  
  if (!requestCounts.has(identifier)) {
    requestCounts.set(identifier, []);
  }
  
  const requests = requestCounts.get(identifier);
  const recentRequests = requests.filter(time => time > minuteAgo);
  
  if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  
  recentRequests.push(now);
  requestCounts.set(identifier, recentRequests);
  return true;
}

// ======================
// 2. CONFIGURATION
// ======================

// Event listeners configuration
require("events").EventEmitter.defaultMaxListeners = 70;
require("events").EventEmitter.prototype._maxListeners = 70;
require("events").defaultMaxListeners = 70;

// Configure Neon for WebSocket pooling
neonConfig.webSocketConstructor = WebSocket;

// File System Utilities
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const LAST_PROCESSED_ROW_FILE = "last_processed_row.json";
const MEDIA_DIR = path.join(__dirname, "public", "media");
// Ensure media directory exists
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}
let companyConfig = {};

// ======================
// 3. SERVICE CONNECTIONS
// ======================

// Database connections
// Database connections
const sql = neon(process.env.DATABASE_URL); // // ======================
// ENHANCED DATABASE CONNECTION MANAGEMENT
// ======================

// Improved database pool configuration with better limits
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5, // Reduced from 10 to prevent overwhelming
  min: 1, // Reduced from 2
  idleTimeoutMillis: 30000, // 30 seconds
  connectionTimeoutMillis: 5000, // 5 seconds - reduced from 10000
  acquireTimeoutMillis: 10000, // 10 seconds - reduced from 30000
  createTimeoutMillis: 5000, // 5 seconds - reduced from 10000
  destroyTimeoutMillis: 5000,
  reapIntervalMillis: 1000,
  createRetryIntervalMillis: 100,
  allowExitOnIdle: false,
  connectionRetryInterval: 500,
  maxConnectionRetries: 5, // Reduced from 10
  // Add statement timeout to prevent long-running queries
  statement_timeout: 15000, // 15 seconds - reduced from 30000
  // Add query timeout
  query_timeout: 15000, // 15 seconds - reduced from 30000
  // Add idle in transaction timeout
  idle_in_transaction_session_timeout: 15000, // 15 seconds - reduced from 30000
});

// Enhanced connection management functions
async function safeRollback(sqlClient) {
  if (sqlClient && typeof sqlClient.query === 'function') {
    try {
      await sqlClient.query("ROLLBACK");
      console.log("Transaction rolled back successfully");
    } catch (rollbackError) {
      console.error("Error during rollback:", rollbackError);
    }
  }
}

async function safeRelease(sqlClient) {
  if (sqlClient && typeof sqlClient.release === 'function') {
    try {
      await sqlClient.release();
      console.log("Database connection released successfully");
    } catch (releaseError) {
      console.error("Error releasing connection:", releaseError);
    }
  }
}

// Enhanced connection acquisition with timeout and retry
async function getDatabaseConnection(timeoutMs = 5000) {
  const startTime = Date.now();
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      console.log(`Attempting to get database connection (attempt ${attempts + 1}/${maxAttempts})`);
      
      const client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
        )
      ]);

      console.log(`Database connection acquired successfully in ${Date.now() - startTime}ms`);
      return client;
    } catch (error) {
      attempts++;
      console.error(`Database connection attempt ${attempts} failed:`, error.message);
      
      if (attempts >= maxAttempts) {
        throw new Error(`Failed to get database connection after ${maxAttempts} attempts: ${error.message}`);
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
    }
  }
}

// Enhanced worker creation with better // ======================
// COMPLETE FIXED WORKER CODE WITH SAFE JSON PARSING
// ======================

const createQueueAndWorker = (botId) => {
  const queue = new Queue(`scheduled-messages-${botId}`, {
    connection: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
    },
    defaultJobOptions: {
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000, // Increased from 2000
      },
    },
  });

  // Enhanced worker with better concurrency control and safe JSON parsing
 // ======================
// FIXED WORKER CODE - HANDLE BOTH JSON STRINGS AND PARSED ARRAYS
// ======================

// Enhanced worker with better concurrency control and safe JSON parsing
const worker = new Worker(
  `scheduled-messages-${botId}`,
  async (job) => {
    if (job.name === "send-message-batch") {
      const { companyId, messageId, batchId, isDuplicate } = job.data;
      console.log(`Bot ${botId} - Processing scheduled message batch:`, {
        messageId,
        batchId,
      });

      if (isDuplicate) {
        console.log(`Bot ${botId} - Skipping duplicate job ${job.id} for batch ${batchId}`);
        return { skipped: true, reason: "Duplicate message" };
      }

      let client = null;
      try {
        // Get database connection with timeout
        client = await getDatabaseConnection(5000);
        
        await client.query("BEGIN");

        const batchQuery = `
          SELECT * FROM scheduled_messages 
          WHERE id = $1 AND company_id = $2
          FOR UPDATE
        `;
        const batchResult = await client.query(batchQuery, [batchId, companyId]);

        if (batchResult.rowCount === 0) {
          throw new Error(`Batch ${batchId} not found in database`);
        }

        const batchData = batchResult.rows[0];

        if (batchData.status === "skipped") {
          console.log(`Bot ${botId} - Batch ${batchId} was already marked as skipped`);
          return {
            skipped: true,
            reason: batchData.skipped_reason || "Already skipped",
          };
        }

        if (batchData.status === "sent") {
          console.log(`Bot ${botId} - Batch ${batchId} was already sent`);
          return {
            skipped: true,
            reason: "Already sent",
          };
        }

        // FIXED: Handle both JSON strings and parsed arrays for chat_ids
        let chatIdsCount = 0;
        let chatIds = [];
        
        try {
          if (batchData.chat_ids) {
            // Check if it's already an array (parsed by database driver)
            if (Array.isArray(batchData.chat_ids)) {
              chatIds = batchData.chat_ids;
              chatIdsCount = chatIds.length;
              console.log(`Bot ${botId} - chat_ids is already an array with ${chatIdsCount} items`);
            } else if (typeof batchData.chat_ids === 'string') {
              // It's a JSON string, parse it
              chatIds = JSON.parse(batchData.chat_ids);
              chatIdsCount = Array.isArray(chatIds) ? chatIds.length : 0;
              console.log(`Bot ${botId} - chat_ids parsed from JSON string with ${chatIdsCount} items`);
            } else {
              console.warn(`Bot ${botId} - chat_ids is neither array nor string:`, typeof batchData.chat_ids);
              chatIdsCount = 0;
            }
          }
        } catch (parseError) {
          console.error(`Bot ${botId} - Error parsing chat_ids for batch ${batchId}:`, {
            error: parseError.message,
            chat_ids: batchData.chat_ids,
            chat_ids_type: typeof batchData.chat_ids,
            batchId: batchId
          });
          
          // Mark this batch as failed due to malformed data
          await client.query(
            "UPDATE scheduled_messages SET status = $1, skipped_reason = $2 WHERE id = $3",
            ["failed", `Malformed chat_ids data: ${parseError.message}`, batchId]
          );
          
          await client.query("COMMIT");
          return {
            skipped: true,
            reason: `Malformed data: ${parseError.message}`,
          };
        }

        console.log(`Bot ${botId} - Sending scheduled message batch:`, {
          batchId,
          messageId,
          status: batchData.status,
          chatIds: chatIdsCount,
          chatIdsSample: chatIds.slice(0, 3), // Show first 3 chat IDs for debugging
        });

        const result = await sendScheduledMessage(batchData);

        if (result.success) {
          console.log(`Bot ${botId} - Successfully sent batch ${batchId} for message ${messageId}`);
          
          await client.query(
            "UPDATE scheduled_messages SET status = $1, sent_at = NOW() WHERE id = $2",
            ["sent", batchId]
          );
          
          // Check if all batches are now processed
          const batchesCheckQuery = `
            SELECT COUNT(*) as pending_count,
                   (SELECT status FROM scheduled_messages WHERE id = $1::uuid) as main_status
            FROM scheduled_messages 
            WHERE schedule_id = $1::uuid
            AND company_id = $2 
            AND status != 'sent'
            AND id::uuid != schedule_id::uuid
          `;
          const batchesCheck = await client.query(batchesCheckQuery, [messageId, companyId]);

          console.log(`Bot ${botId} - Batch status check:`, {
            pendingCount: batchesCheck.rows[0].pending_count,
            mainStatus: batchesCheck.rows[0].main_status
          });
          
          if (batchesCheck.rows[0].pending_count === 0) {
            if (batchesCheck.rows[0].main_status !== 'sent') {
              await client.query(
                "UPDATE scheduled_messages SET status = $1, sent_at = NOW() WHERE id = $2",
                ["sent", messageId]
              );
              console.log(`Bot ${botId} - All batches completed for message ${messageId}`);
            }
          }
        } else {
          throw new Error(`Failed to send batch: ${result.error || 'Unknown error'}`);
        }

        await client.query("COMMIT");
      } catch (error) {
        if (client) {
          await safeRollback(client);
        }
        console.error(`Bot ${botId} - Error processing scheduled message batch:`, {
          error: error.message,
          stack: error.stack,
          batchId: batchId,
          messageId: messageId,
        });
        throw error;
      } finally {
        if (client) {
          await safeRelease(client);
        }
      }

      } else if (job.name === "send-single-message") {
        const { companyId, messageId } = job.data;
        console.log(`Bot ${botId} - Processing scheduled single message:`, {
          messageId,
        });

        let client = null;
        try {
          // Get database connection with timeout
          client = await getDatabaseConnection(5000);
          
          await client.query("BEGIN");

          const messageQuery = `
            SELECT * FROM scheduled_messages 
            WHERE id = $1 AND company_id = $2
            FOR UPDATE
          `;
          const messageResult = await client.query(messageQuery, [messageId, companyId]);

          if (messageResult.rowCount === 0) {
            throw new Error(`Message ${messageId} not found in database`);
          }

          const messageData = messageResult.rows[0];

          if (messageData.status === "skipped" || messageData.status === "sent") {
            console.log(`Bot ${botId} - Message ${messageId} was already ${messageData.status}`);
            return {
              skipped: true,
              reason: `Already ${messageData.status}`,
            };
          }

          console.log(`Bot ${botId} - Sending scheduled single message:`, {
            messageId,
            status: messageData.status,
          });

          const result = await sendScheduledMessage(messageData);

          if (result.success) {
            await client.query(
              "UPDATE scheduled_messages SET status = $1, sent_at = NOW() WHERE id = $2",
              ["sent", messageId]
            );
          } else {
            throw new Error(`Failed to send message: ${result.error || 'Unknown error'}`);
          }

          await client.query("COMMIT");
        } catch (error) {
          if (client) {
            await safeRollback(client);
          }
          console.error(`Bot ${botId} - Error processing scheduled single message:`, {
            error: error.message,
            stack: error.stack,
            messageId: messageId,
          });
          throw error;
        } finally {
          if (client) {
            await safeRelease(client);
          }
        }
      }
    },
    {
      connection: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD,
      },
      concurrency: 1, // Reduced to 1 to prevent overwhelming database
      limiter: {
        max: 3, // Reduced from 5
        duration: 1000,
      },
      lockDuration: 30000,
      maxStalledCount: 1,
      settings: {
        stalledInterval: 15000,
        lockRenewTime: 10000,
      },
    }
  );

  // Enhanced completed event handler
  worker.on("completed", async (job) => {
    console.log(`Bot ${botId} - Job ${job.id} completed successfully`);
    
    try {
      await job.updateProgress(100);
      await job.updateData({
        ...job.data,
        completedAt: new Date().toISOString(),
        status: "completed",
        success: true,
      });
    } catch (error) {
      console.error(`Bot ${botId} - Error updating completed job data:`, error);
    }
  });

  // Enhanced failed event handler
  worker.on("failed", async (job, err) => {
    console.error(`Bot ${botId} - Job ${job.id} failed:`, {
      error: err.message,
      stack: err.stack,
      attempts: job.attemptsMade,
      maxAttempts: job.opts?.attempts || 3,
    });
    
    try {
      await job.updateData({
        ...job.data,
        failedAt: new Date().toISOString(),
        error: {
          message: err?.message || 'Unknown error',
          stack: err?.stack || 'No stack trace',
          name: err?.name || 'Error',
        },
        status: "failed",
        finalAttempt: job.attemptsMade >= (job.opts?.attempts || 3),
      });
    } catch (updateError) {
      console.error(`Bot ${botId} - Error updating failed job data:`, updateError);
    }
  });

  // Enhanced error event handler
  worker.on("error", async (err) => {
    console.error(`Bot ${botId} - Worker error:`, {
      message: err.message,
      stack: err.stack,
      name: err.name,
      timestamp: new Date().toISOString(),
    });
  });

  // Enhanced stalled event handler
  worker.on("stalled", async (jobId) => {
    console.warn(`Bot ${botId} - Job ${jobId} stalled`);
  });

  // Store references
  botQueues.set(botId, queue);
  botWorkers.set(botId, worker);
  return { queue, worker };
};


// Add pool error handling to prevent crashes
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // Don't exit the process, just log the error
});

pool.on('connect', (client) => {
  console.log('New database connection established');
});

pool.on('acquire', (client) => {
  console.log('Database connection acquired from pool');
});

pool.on('release', (client) => {
  console.log('Database connection released back to pool');
});

// Redis connection
const connection = new Redis(process.env.REDIS_URL || "redis://redis:6379", {
  maxRetriesPerRequest: null,
  maxmemoryPolicy: "noeviction",
});

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
});

// Google Sheets API Configuration
const auth = new google.auth.GoogleAuth({
  keyFile: "service_account.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

// ======================
// 4. APPLICATION STATE
// ======================

const botMap = new Map();
const chatSubscriptions = new Map();
const dailyReportCrons = new Map();
const messageQueue = new Queue("scheduled-messages", { connection });

// ======================
// 5. EXPRESS SETUP
// ======================

const app = express();
const server = createServer(app);
const wss = new WebSocket.Server({ server });
const db = admin.firestore();
global.wss = wss;
// CORS Configuration
const whitelist = ['https://juta-crm-v3.vercel.app','http://localhost:5173', 'https://juta-dev.ngrok.dev', 'https://juta-dev.ngrok.dev', 'https://d178-2001-e68-5409-64f-f850-607e-e056-2a9e.ngrok-free.app','https://web.jutateknologi.com','https://app.omniyal.com'];
const corsOptions = {
  origin: function (origin, callback) {
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "ngrok-skip-browser-warning",
    "x-requested-with"
  ],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use('/media', express.static(MEDIA_DIR));
app.use(express.static("public"));

// Handle preflight requests
app.options('*', cors());

// Configure Multer storage
const storage = multer.diskStorage({
  destination: MEDIA_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    const uniqueName = `${uuidv4()}_${baseName}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB file size limit
    fieldSize: 200 * 1024 * 1024, // 200MB field size limit (for non-file fields)
    files: 1, // Limit to 1 file per upload
    fields: 10 // Limit to 10 non-file fields
  },
});

// ======================
// 6. ROUTES
// ======================

// Basic Routes
app.get("/", (req, res) => res.send("Bot is running"));
app.get("/logs", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "logs.html"))
);
app.get("/log-manager", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "log-manager.html"))
);
app.get("/status", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "status.html"))
);
app.get("/queue", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "queue.html"))
);

// Webhook Handlers
// app.post("/extremefitness/blast", async (req, res) => {
//   const botData = botMap.get("074");
//   if (!botData)
//     return res.status(404).json({ error: "WhatsApp client not found" });
//   await handleExtremeFitnessBlast(req, res, botData[0].client);
// });

// app.post("/hajoon/blast", async (req, res) => {
//   const botData = botMap.get("045");
//   if (!botData)
//     return res.status(404).json({ error: "WhatsApp client not found" });
//   await handleHajoonCreateContact(req, res, botData[0].client);
// });

// app.post("/juta/blast", async (req, res) => {
//   const botData = botMap.get("001");
//   if (!botData)
//     return res.status(404).json({ error: "WhatsApp client not found" });
//   await handleJutaCreateContact(req, res, botData[0].client);
// });

// app.post("/zahin/hubspot", (req, res) => {
//   const getClient = () => botMap.get("042")?.[0].client;
//   handleZahinHubspot(req, res, getClient);
// });

// API Handlers
// app.post("/api/bina/tag", handleBinaTag);
// app.post("/api/edward/tag", handleEdwardTag);
app.post("/api/tag/followup", handleTagFollowUp);

// ============================================
// LOG MANAGEMENT API ENDPOINTS
// ============================================

// Get all log files
app.get('/api/logs/files', async (req, res) => {
  try {
    const files = logManager.getLogFiles();
    res.json({ success: true, files });
  } catch (error) {
    console.error('Error fetching log files:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
app.use('/api/feedback-forms', feedbackFormsRouter);

app.use('/api/events', eventsRouter);
app.use('/api/enrollees', enrolleesRouter);
app.use('/api/participants', participantsRouter);
app.use('/api/attendance-events', attendanceEventsRouter);
app.use('/api/feedback-responses', feedbackResponsesRouter);
// Read specific log file
app.get('/api/logs/read/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const { lines = 100, filter = '', type = 'all' } = req.query;
    
    const options = {
      lines: parseInt(lines),
      filter,
      type
    };
    
    const logData = logManager.readLogFile(filename, options);
    res.json({ success: true, data: logData });
  } catch (error) {
    console.error('Error reading log file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get crash summary
app.get('/api/logs/crash-summary', async (req, res) => {
  try {
    const summary = logManager.getCrashSummary();
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Error getting crash summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search logs
app.post('/api/logs/search', async (req, res) => {
  try {
    const { searchTerm, fileTypes = ['console', 'error', 'crash'], caseSensitive = false } = req.body;
    
    if (!searchTerm) {
      return res.status(400).json({ success: false, error: 'Search term is required' });
    }
    
    const results = logManager.searchLogs(searchTerm, { fileTypes, caseSensitive });
    res.json({ success: true, results });
  } catch (error) {
    console.error('Error searching logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get log statistics
app.get('/api/logs/stats', async (req, res) => {
  try {
    const stats = logManager.getLogStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error getting log stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download log file
app.get('/api/logs/download/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, 'logs', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Log file not found' });
    }
    
    res.download(filePath, filename);
  } catch (error) {
    console.error('Error downloading log file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manually rotate logs
app.post('/api/logs/rotate', async (req, res) => {
  try {
    logger.rotateLogs();
    res.json({ success: true, message: 'Logs rotated successfully' });
  } catch (error) {
    console.error('Error rotating logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clean old logs
app.post('/api/logs/clean', async (req, res) => {
  try {
    logger.cleanOldLogs();
    res.json({ success: true, message: 'Old logs cleaned successfully' });
  } catch (error) {
    console.error('Error cleaning old logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Log a custom event
app.post('/api/logs/event', async (req, res) => {
  try {
    const { type, message, data } = req.body;
    
    if (!type || !message) {
      return res.status(400).json({ success: false, error: 'Type and message are required' });
    }
    
    logger.logEvent(type, message, data);
    res.json({ success: true, message: 'Event logged successfully' });
  } catch (error) {
    console.error('Error logging event:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get real-time logs (WebSocket endpoint would be better, but this works for polling)
app.get('/api/logs/tail/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const { lines = 50 } = req.query;
    
    const logData = logManager.readLogFile(filename, { lines: parseInt(lines) });
    res.json({ success: true, data: logData });
  } catch (error) {
    console.error('Error tailing log file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// END LOG MANAGEMENT API ENDPOINTS
// ============================================

// // Custom Bots
// const customHandlers = {};
// app.post("/zakat", async (req, res) => {
//   try {
//     const botData = botMap.get("0124");
//     if (!botData) throw new Error("WhatsApp client not found for zakat");
//     await handleZakatBlast(req, res, botData[0].client);
//   } catch (error) {
//     console.error("Error processing zakat form:", error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// ======================
// 7. SERVER INITIALIZATION
// ======================

const port = process.env.PORT;
server.listen(port, () => console.log(`Server is running on port ${port}`));


// ======================
// 8. LOG BROADCASTING SETUP
// ======================

// Function to broadcast logs to WebSocket clients
function broadcastLog(logData) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.isLogsViewer) {
      client.send(JSON.stringify({
        type: "log",
        data: logData,
        timestamp: new Date().toISOString()
      }));
    }
  });
}

// Override console methods to capture logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = function(...args) {
  const logMessage = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  originalConsoleLog.apply(console, args);
  broadcastLog(logMessage);
};

console.error = function(...args) {
  const logMessage = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  originalConsoleError.apply(console, args);
  broadcastLog(`ERROR: ${logMessage}`);
};

console.warn = function(...args) {
  const logMessage = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  originalConsoleWarn.apply(console, args);
  broadcastLog(`WARN: ${logMessage}`);
};

// ============================================
// AUTOMATED LOG MANAGEMENT
// ============================================

// Schedule daily log rotation at midnight
const scheduleLogRotation = () => {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0); // Next midnight
  
  const msUntilMidnight = midnight.getTime() - now.getTime();
  
  setTimeout(() => {
    logger.rotateLogs();
    logger.cleanOldLogs();
    
    // Schedule next rotation in 24 hours
    setInterval(() => {
      logger.rotateLogs();
      logger.cleanOldLogs();
    }, 24 * 60 * 60 * 1000); // 24 hours
    
  }, msUntilMidnight);
  
  console.log(`Log rotation scheduled for ${midnight.toISOString()}`);
};

// Initialize log rotation scheduling
scheduleLogRotation();

// Monitor server health and log important events
const monitorServerHealth = () => {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Log if memory usage is high (over 500MB)
    if (memUsage.heapUsed > 500 * 1024 * 1024) {
      logger.logEvent('PERFORMANCE', 'High memory usage detected', {
        memoryUsage: memUsage,
        timestamp: new Date().toISOString()
      });
    }
    
    // Log server health every hour
    if (new Date().getMinutes() === 0) {
      logger.logEvent('HEALTH_CHECK', 'Server health check', {
        memoryUsage: memUsage,
        cpuUsage: cpuUsage,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    }
  }, 60000); // Check every minute
};

// Initialize server health monitoring
monitorServerHealth();

// ============================================
// END AUTOMATED LOG MANAGEMENT
// ============================================

// Function to save media locally
async function saveMediaLocally(base64Data, mimeType, filename) {
  const writeFileAsync = promisify(fs.writeFile);
  const buffer = Buffer.from(base64Data, "base64");
  const uniqueFilename = `${uuidv4()}_${filename}`;
  const filePath = path.join(MEDIA_DIR, uniqueFilename);
  const baseUrl = 'https://juta-dev.ngrok.dev';

  await writeFileAsync(filePath, buffer);

  // Return the URL path to access this file
  return `${baseUrl}/media/${uniqueFilename}`;
}

app.post('/api/upload-media', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const baseUrl = 'https://juta-dev.ngrok.dev';
  const fileUrl = `${baseUrl}/media/${req.file.filename}`;
  res.json({ url: fileUrl });
});



// Handle WebSocket connections
wss.on("connection", (ws, req) => {
  // The URL parsing here might be simplified if you only have a single client type
  // that connects to '/ws/email/companyId'.
  // If you also have general WebSocket connections, you might need more robust parsing.
  const urlParts = req.url.split("/");
  const email = urlParts[2];
  const companyId = urlParts[3];

  // Add these two lines to set the properties
  ws.pathname = req.url.startsWith("/status") ? "/status" : 
                req.url.startsWith("/logs") ? "/logs" : "/ws";
  ws.companyId = companyId;
  ws.subscribedChatId = null;

  // Mark logs viewers
  if (ws.pathname === "/logs") {
    ws.isLogsViewer = true;
  }

  // If this is a status page connection, send current bot statuses
  if (ws.pathname === "/status") {
    // Send current statuses for all bots
    setTimeout(async () => {
      try {
        for (const [botName, botData] of botMap.entries()) {
          if (Array.isArray(botData)) {
            botData.forEach((phoneData, phoneIndex) => {
              if (phoneData && phoneData.status) {
                const statusMessage = {
                  type: "status_update",
                  botName,
                  status: phoneData.status,
                  phoneIndex,
                  qrCode: phoneData.qrCode || null,
                  timestamp: new Date().toISOString(),
                };
                
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify(statusMessage));
                }
              }
            });
          }
        }
      } catch (error) {
        console.error("Error sending initial status to status page client:", error);
      }
    }, 100); // Small delay to ensure connection is fully established
  }

  // Handle messages from client
  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);
      // Handle chat subscription
      if (data.type === "subscribe" && data.companyId) {
        ws.companyId = data.companyId;
        console.log(`WebSocket subscribed to company: ${data.companyId}`);
        ws.send(JSON.stringify({ 
          type: "subscribed", 
          companyId: data.companyId 
        }));
        return;
      }
      if (data.type === "subscribe" && data.chatId) {
        ws.subscribedChatId = data.chatId;

        if (!chatSubscriptions.has(data.chatId)) {
          chatSubscriptions.set(data.chatId, new Set());
        }
        chatSubscriptions.get(data.chatId).add(ws);

        ws.send(JSON.stringify({ type: "subscribed", chatId: data.chatId }));
        return;
      }

      if (data.action === "fetch_chats") {
        // Start fetching chats
        const totalChats = await sqlDb.getRow(
          "SELECT COUNT(*) as count FROM contacts WHERE company_id = $1",
          [companyId]
        );

        ws.send(
          JSON.stringify({
            type: "progress",
            status: "processing",
            action: "fetching_chats",
            totalChats: totalChats.count,
          })
        );

        // Process chats in batches
        let processed = 0;
        const batchSize = 10;

        while (processed < totalChats.count) {
          const chats = await sqlDb.getRows(
            "SELECT * FROM contacts WHERE company_id = $1 LIMIT $2 OFFSET $3",
            [companyId, batchSize, processed]
          );

          processed += chats.length;

          ws.send(
            JSON.stringify({
              type: "progress",
              status: "processing",
              action: "processing_chats",
              fetchedChats: processed,
              totalChats: totalChats.count,
            })
          );

          // Add delay between batches
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        ws.send(
          JSON.stringify({
            type: "progress",
            status: "ready",
            action: "done_process",
          })
        );
      }

      // Handle logs WebSocket messages
      if (ws.pathname === "/logs") {
        if (data.type === "restart" && data.password) {
          // Verify password (you should use environment variable for this)
          const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "P@ssw0rd123";
          
          if (data.password === ADMIN_PASSWORD) {
            try {
              // Execute PM2 restart command
              const { exec } = require("child_process");
              exec("pm2 restart all", (error, stdout, stderr) => {
                if (error) {
                  console.error("Restart error:", error);
                  ws.send(JSON.stringify({
                    type: "restart",
                    success: false,
                    message: `Restart failed: ${error.message}`
                  }));
                } else {
                  console.log("PM2 restart successful:", stdout);
                  ws.send(JSON.stringify({
                    type: "restart",
                    success: true,
                    message: "Server restart initiated successfully"
                  }));
                }
              });
            } catch (error) {
              ws.send(JSON.stringify({
                type: "restart",
                success: false,
                message: `Restart failed: ${error.message}`
              }));
            }
          } else {
            ws.send(JSON.stringify({
              type: "restart",
              success: false,
              message: "Invalid password"
            }));
          }
        }

        if (data.type === "deleteSessions" && data.password && data.sessions) {
          const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "P@ssw0rd123";
          
          if (data.password === ADMIN_PASSWORD) {
            try {
              const fs = require("fs");
              const path = require("path");
              let deletedCount = 0;
              
              for (const session of data.sessions) {
                const sessionPath = path.join(__dirname, ".wwebjs_auth", session);
                try {
                  if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    deletedCount++;
                  }
                } catch (err) {
                  console.error(`Error deleting session ${session}:`, err);
                }
              }
              
              ws.send(JSON.stringify({
                type: "sessionsDeleted",
                success: true,
                message: `Successfully deleted ${deletedCount} session(s)`
              }));
            } catch (error) {
              ws.send(JSON.stringify({
                type: "sessionsDeleted",
                success: false,
                message: `Delete failed: ${error.message}`
              }));
            }
          } else {
            ws.send(JSON.stringify({
              type: "sessionsDeleted",
              success: false,
              message: "Invalid password"
            }));
          }
        }
      }
    } catch (error) {
      console.error("WebSocket error:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          message: "An error occurred while processing your request",
        })
      );
    }
  });

  ws.on("close", () => {
    // Remove ws from any chat subscriptions
    if (ws.subscribedChatId && chatSubscriptions.has(ws.subscribedChatId)) {
      chatSubscriptions.get(ws.subscribedChatId).delete(ws);
      if (chatSubscriptions.get(ws.subscribedChatId).size === 0) {
        chatSubscriptions.delete(ws.subscribedChatId);
      }
    }
    console.log(`WebSocket closed for ${email}`);
  });
});
// ... existing code ...

app.post('/api/prompt-engineer-neon/', async (req, res) => {
  try {
    const userInput = req.query.message;
    const email = req.query.email;
    const { currentPrompt } = req.body;

    // Log only relevant data
    console.log('Prompt Engineer Neon Request:', {
      userInput,
      email,
      currentPrompt
    });

    let threadID;
    const contactData = await getContactDataFromDatabaseByEmail(email);

    if (contactData?.thread_id) {
      threadID = contactData.thread_id;
    } else {
      const thread = await createThread();
      threadID = thread.id;
      await saveThreadIDPostgres(email, threadID);
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
      model: "gpt-4.1-mini",
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
    console.error('Prompt engineering Neon error:', {
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

// ... existing code ...
app.get("/api/lalamove/quote", async (req, res) => {
  res.header("Access-Control-Allow-Origin", "https://storeguru.com.my");
  res.header("Access-Control-Allow-Methods", "GET, POST");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept"
  );
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
      manpower = "false", // New parameter, defaults to false
    } = req.query;

    // Map vehicle types to Lalamove service types
    const vehicleServiceMap = {
      van: "VAN",
      "1ton": "TRUCK330",
      "3ton": "TRUCK550",
      "5ton": "TRUCK550",
    };
    console.log(vehicle_type);
    // Validate vehicle type
    const serviceType = vehicleServiceMap[vehicle_type?.toLowerCase()];
    if (!serviceType) {
      console.log("Invalid vehicle type:", vehicle_type);
      throw new Error("Invalid vehicle type");
    }

    // Determine special requests based on services selected
    const specialRequests = [];

    // Add appropriate manpower service
    const isManpower = manpower === "true";
    if (isManpower) {
      if (serviceType === "TRUCK330" || serviceType === "TRUCK550") {
        // For trucks, manpower includes driver + 2 helpers
        specialRequests.push("DOOR_TO_DOOR_1DRIVER2HELPER");
        if (pickup_city.toLowerCase().includes("kuala lumpur")) {
          specialRequests.push("HOUSE_MOVING");
        }
      } else {
        // For vans, manpower includes driver + helper
        specialRequests.push("DOOR_TO_DOOR_1DRIVER1HELPER");
      }
    }

    // Add tailboard for all truck types
    if (serviceType === "TRUCK330" || serviceType === "TRUCK550") {
      specialRequests.push("TAILBOARD_VEHICLE");
    }

    // Validate required parameters
    if (!user_latitude || !user_longitude || !pickup_street) {
      console.log("Missing required parameters");
      throw new Error("Missing required parameters");
    }

    // Validate coordinate format
    const lat = parseFloat(user_latitude);
    const lng = parseFloat(user_longitude);
    if (isNaN(lat) || isNaN(lng)) {
      console.log("Invalid coordinates format");
      throw new Error("Invalid coordinates format");
    }

    // Store location coordinates mapping
    const storeCoordinates = {
      sentul: { lat: "3.173640", lng: "101.692897" },
      subang: { lat: "3.157191", lng: "101.544504" },
      nilai: { lat: "2.848007", lng: "101.805015" },
      gelang_patah: { lat: "1.371682", lng: "103.57636" },
      bayan_lepas: { lat: "5.315488", lng: "100.266468" },
      kuantan: { lat: "3.840118", lng: "103.289275" },
    };

    if (!storeCoordinates[store_location]) {
      console.log("Invalid store location:", store_location);
      throw new Error("Invalid store location");
    }
    const destinationCoords = storeCoordinates[store_location];

    // Lalamove API credentials
    const API_KEY = "pk_test_293d571c2c2d519583326617750761e8";
    const SECRET =
      "sk_test_On8eL9w6N7hJBweWocmozS/KBWr9FBOsuAJsDWG2xeINEzMTo55mst2h2qEQas4u";
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
              lng: lng.toString(),
            },
            address: `${pickup_street}, ${pickup_city}, ${pickup_state} ${pickup_postcode}, Malaysia`,
          },
          {
            coordinates: {
              lat: destinationCoords.lat,
              lng: destinationCoords.lng,
            },
            address: `${
              store_location.charAt(0).toUpperCase() + store_location.slice(1)
            } Storage Facility, Malaysia`,
          },
        ],
      },
    };

    console.log("Request Configuration:");
    console.log("- Vehicle Type:", vehicle_type);
    if (serviceType === "TRUCK330" || serviceType === "TRUCK550") {
      console.log(
        "- Manpower:",
        isManpower ? "Driver + 2 Helpers" : "Driver Only"
      );
    } else {
      console.log(
        "- Manpower:",
        isManpower ? "Driver + Helper" : "No Manpower"
      );
    }
    console.log("- Special Requests Applied:", specialRequests);
    console.log("\nRequest body:", JSON.stringify(requestBody, null, 2));

    const rawSignature = `${time}\r\n${method}\r\n${path}\r\n\r\n${JSON.stringify(
      requestBody
    )}`;
    const signature = CryptoJS.HmacSHA256(rawSignature, SECRET).toString();

    console.log("Making request to Lalamove API...");
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

    console.log("Lalamove API response:", response.data);

    res.json({
      success: true,
      data: {
        totalFee: {
          amount: response.data.data.priceBreakdown.total,
          currency: "MYR",
        },
      },
    });
  } catch (error) {
    console.error("Lalamove API Error:", error);
    if (error.response) {
      console.error("Error response data:", error.response.data);
    }
    res.json({
      success: true,
      data: {
        totalFee: {
          amount: "0.00",
          currency: "MYR",
        },
      },
    });
  }
});

app.get("/api/sessions", async (req, res) => {
  try {
    const authPath = path.join(__dirname, ".wwebjs_auth");
    const sessions = await fs.promises.readdir(authPath);
    const sessionNames = sessions
      .filter((name) => name.startsWith("session-"))
      .map((name) => name.replace("session-", ""));
    res.json(sessionNames);
  } catch (error) {
    console.error("Error reading sessions:", error);
    res.status(500).json({ error: "Failed to read sessions" });
  }
});

function broadcastProgress(botName, action, progress, phoneIndex) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.companyId === botName) {
      client.send(
        JSON.stringify({
          type: "progress",
          botName,
          action,
          progress,
          phoneIndex,
        })
      );
    }
  });
}

const botStatusMap = new Map();
function broadcastAuthStatus(botName, status, qrCode = null, i = 0) {
  wss.clients.forEach((client) => {
    try {
      if (client.readyState === WebSocket.OPEN) {
        if (client.pathname === "/status") {
          const message = JSON.stringify({
            type: "status_update",
            botName,
            status,
            qrCode: status === "qr" ? qrCode : null,
            phoneIndex: i,
          });
          client.send(message);
        } else if (client.companyId === botName) {
          const message = JSON.stringify({
            type: "auth_status",
            botName,
            status,
            qrCode: status === "qr" ? qrCode : null,
            phoneIndex: i,
          });
          client.send(message);
        }
      }
    } catch (error) {
      console.error("Error sending to client:", error);
    }
  });
  botStatusMap.set(botName, status);
}

app.post("/api/daily-report/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const { enabled, time, groupId } = req.body;

  try {
    if (enabled) {
      if (!time || !groupId) {
        return res.status(400).json({
          success: false,
          error: "Time and groupId are required when enabling reports",
        });
      }

      const settingValue = {
        enabled: true,
        time,
        groupId,
        lastRun: null,
      };

      const checkQuery = `
        SELECT id FROM public.settings 
        WHERE company_id = $1 AND setting_type = 'reporting' AND setting_key = 'dailyReport'
      `;
      const checkResult = await sqlDb.query(checkQuery, [companyId]);

      if (checkResult.rows.length > 0) {
        const updateQuery = `
          UPDATE public.settings 
          SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
          WHERE company_id = $2 AND setting_type = 'reporting' AND setting_key = 'dailyReport'
        `;
        await sqlDb.query(updateQuery, [
          JSON.stringify(settingValue),
          companyId,
        ]);
      } else {
        const insertQuery = `
          INSERT INTO public.settings (company_id, setting_type, setting_key, setting_value, created_at, updated_at)
          VALUES ($1, 'reporting', 'dailyReport', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `;
        await sqlDb.query(insertQuery, [
          companyId,
          JSON.stringify(settingValue),
        ]);
      }

      if (dailyReportCrons.has(companyId)) {
        dailyReportCrons.get(companyId).stop();
      }

      const [hour, minute] = time.split(":");
      const cronJob = cron.schedule(
        `${minute} ${hour} * * *`,
        async () => {
          try {
            const botData = botMap.get(companyId);
            if (!botData || !botData[0]?.client) {
              console.error(
                `No WhatsApp client found for company ${companyId}`
              );
              return;
            }

            const count = await countTodayLeads(companyId);
            const message = `📊 Daily Lead Report\n\nNew Leads Today: ${count}\nDate: ${new Date().toLocaleDateString()}`;

            await botData[0].client.sendMessage(groupId, message);

            const updateLastRunQuery = `
            UPDATE public.settings 
            SET setting_value = jsonb_set(setting_value, '{lastRun}', to_jsonb($1::text), true),
                updated_at = CURRENT_TIMESTAMP
            WHERE company_id = $2 AND setting_type = 'reporting' AND setting_key = 'dailyReport'
          `;
            await sqlDb.query(updateLastRunQuery, [
              new Date().toISOString(),
              companyId,
            ]);
          } catch (error) {
            console.error(
              `Error sending daily report for company ${companyId}:`,
              error
            );
          }
        },
        {
          timezone: "Asia/Kuala_Lumpur",
        }
      );

      dailyReportCrons.set(companyId, cronJob);

      res.json({
        success: true,
        message: "Daily report enabled",
        nextRun: `${hour}:${minute}`,
      });
    } else {
      if (dailyReportCrons.has(companyId)) {
        dailyReportCrons.get(companyId).stop();
        dailyReportCrons.delete(companyId);
      }

      const settingValue = {
        enabled: false,
        time: null,
        groupId: null,
      };

      const updateQuery = `
        UPDATE public.settings 
        SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $2 AND setting_type = 'reporting' AND setting_key = 'dailyReport'
      `;

      await sqlDb.query(updateQuery, [JSON.stringify(settingValue), companyId]);

      res.json({
        success: true,
        message: "Daily report disabled",
      });
    }
  } catch (error) {
    console.error("Error managing daily report:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

async function countTodayLeads(companyId) {
  try {
    const today = moment()
      .tz("Asia/Kuala_Lumpur")
      .startOf("day")
      .format("YYYY-MM-DD HH:mm:ss");

    const query = `
      SELECT COUNT(*) as count 
      FROM public.contacts 
      WHERE company_id = $1 AND created_at >= $2
    `;

    const result = await sqlDb.query(query, [companyId, today]);
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    console.error("Error counting leads:", error);
    return 0;
  }
}

app.post("/api/daily-report/:companyId/trigger", async (req, res) => {
  const { companyId } = req.params;

  try {
    const settingsQuery = `
      SELECT setting_value 
      FROM public.settings 
      WHERE company_id = $1 
      AND setting_type = 'reporting' 
      AND setting_key = 'dailyReport'
    `;

    const settingsResult = await sqlDb.query(settingsQuery, [companyId]);

    if (settingsResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Daily reporting is not configured for this company",
      });
    }

    const settings = settingsResult.rows[0].setting_value;

    if (!settings || !settings.enabled) {
      return res.status(400).json({
        success: false,
        error: "Daily reporting is not enabled for this company",
      });
    }

    const { groupId } = settings;
    const botData = botMap.get(companyId);

    if (!botData || !botData[0]?.client) {
      throw new Error("WhatsApp client not found");
    }

    const count = await countTodayLeads(companyId);
    const message = `📊 Daily Lead Report (Manual Trigger)\n\nNew Leads Today: ${count}\nDate: ${new Date().toLocaleDateString()}`;

    await botData[0].client.sendMessage(groupId, message);

    const updateLastRunQuery = `
      UPDATE public.settings 
      SET setting_value = jsonb_set(setting_value, '{lastRun}', to_jsonb($1::text), true),
          updated_at = CURRENT_TIMESTAMP
      WHERE company_id = $2 AND setting_type = 'reporting' AND setting_key = 'dailyReport'
    `;
    await sqlDb.query(updateLastRunQuery, [
      new Date().toISOString(),
      companyId,
    ]);

    res.json({
      success: true,
      message: "Report triggered successfully",
      count,
    });
  } catch (error) {
    console.error("Error triggering daily report:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/api/facebook-lead-webhook", (req, res) => {
  const VERIFY_TOKEN = "test"; // Use the token you entered in the Facebook dashboard

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      // console.log('Webhook verified');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(404);
  }
});

app.put("/api/update-user", async (req, res) => {
  try {
    const { 
      contactId, // email of user to update
      name,
      phoneNumber,
      email,
      password,
      role,
      companyId,
      group,
      employeeId,
      notes,
      quotaLeads,
      invoiceNumber,
      imageUrl,
      viewEmployees,
      phoneAccess,
      weightages
    } = req.body;

    if (!contactId) {
      return res.status(400).json({ error: "Contact ID (email) is required" });
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update users table - only update if values are provided
      const userUpdateFields = [];
      const userUpdateValues = [];
      let paramIndex = 1;

      if (name) {
        userUpdateFields.push(`name = $${paramIndex++}`);
        userUpdateValues.push(name);
      }
      if (role) {
        userUpdateFields.push(`role = $${paramIndex++}`);
        userUpdateValues.push(role);
      }
      if (password) {
        userUpdateFields.push(`password = $${paramIndex++}`);
        userUpdateValues.push(password);
      }

      if (userUpdateFields.length > 0) {
        userUpdateFields.push(`last_updated = CURRENT_TIMESTAMP`);
        userUpdateValues.push(contactId, companyId);
        
        const userUpdateQuery = `
          UPDATE users 
          SET ${userUpdateFields.join(', ')}
          WHERE email = $${paramIndex++} AND company_id = $${paramIndex++}
        `;
        
        await client.query(userUpdateQuery, userUpdateValues);
      }

      // Update or insert into employees table
      const employeeCheckQuery = `
        SELECT id FROM employees WHERE email = $1 AND company_id = $2
      `;
      const employeeCheck = await client.query(employeeCheckQuery, [contactId, companyId]);

      if (employeeCheck.rows.length > 0) {
        // Update existing employee
        const empUpdateFields = [];
        const empUpdateValues = [];
        let empParamIndex = 1;

        if (name) {
          empUpdateFields.push(`name = $${empParamIndex++}`);
          empUpdateValues.push(name);
        }
        if (role) {
          empUpdateFields.push(`role = $${empParamIndex++}`);
          empUpdateValues.push(role);
        }
        if (phoneNumber) {
          empUpdateFields.push(`phone_number = $${empParamIndex++}`);
          empUpdateValues.push(phoneNumber);
        }
        if (employeeId !== undefined) {
          empUpdateFields.push(`employee_id = $${empParamIndex++}`);
          empUpdateValues.push(employeeId);
        }
        if (phoneAccess !== undefined) {
          empUpdateFields.push(`phone_access = $${empParamIndex++}`);
          empUpdateValues.push(JSON.stringify(phoneAccess));
        }
        if (weightages !== undefined) {
          empUpdateFields.push(`weightages = $${empParamIndex++}`);
          empUpdateValues.push(JSON.stringify(weightages));
        }
        if (imageUrl !== undefined) {
          empUpdateFields.push(`image_url = $${empParamIndex++}`);
          empUpdateValues.push(imageUrl);
        }
        if (notes !== undefined) {
          empUpdateFields.push(`notes = $${empParamIndex++}`);
          empUpdateValues.push(notes);
        }
        if (quotaLeads !== undefined) {
          empUpdateFields.push(`quota_leads = $${empParamIndex++}`);
          empUpdateValues.push(quotaLeads);
        }
        if (viewEmployees !== undefined) {
          empUpdateFields.push(`view_employees = $${empParamIndex++}`);
          empUpdateValues.push(JSON.stringify(viewEmployees));
        }
        if (invoiceNumber !== undefined) {
          empUpdateFields.push(`invoice_number = $${empParamIndex++}`);
          empUpdateValues.push(invoiceNumber);
        }
        if (group !== undefined) {
          empUpdateFields.push(`emp_group = $${empParamIndex++}`);
          empUpdateValues.push(group);
        }

        if (empUpdateFields.length > 0) {
          empUpdateFields.push(`last_updated = CURRENT_TIMESTAMP`);
          empUpdateValues.push(contactId, companyId);
          
          const employeeUpdateQuery = `
            UPDATE employees 
            SET ${empUpdateFields.join(', ')}
            WHERE email = $${empParamIndex++} AND company_id = $${empParamIndex++}
          `;
          
          await client.query(employeeUpdateQuery, empUpdateValues);
        }
      } else {
        // Insert new employee record if it doesn't exist
        const employeeInsertQuery = `
          INSERT INTO employees (
            company_id, name, email, role, phone_number, employee_id,
            phone_access, weightages, image_url, notes, quota_leads,
            view_employees, invoice_number, emp_group
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `;
        
        await client.query(employeeInsertQuery, [
          companyId, name, contactId, role, phoneNumber, employeeId || null,
          JSON.stringify(phoneAccess || {}), JSON.stringify(weightages || {}),
          imageUrl || null, notes || null, quotaLeads || 0,
          JSON.stringify(viewEmployees || []), invoiceNumber || null, group || null
        ]);
      }

      // Update Firebase Auth if password is provided
      if (password) {
        try {
          const user = await admin.auth().getUserByEmail(contactId);
          await admin.auth().updateUser(user.uid, {
            password: password,
            displayName: name
          });
        } catch (authError) {
          console.error("Error updating Firebase Auth:", authError);
          // Don't fail the entire operation for auth errors
        }
      }

      await client.query('COMMIT');
      res.json({ message: "User updated successfully" });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await safeRelease(client);
    }

  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// Delete user endpoint
app.delete("/api/delete-user", async (req, res) => {
  try {
    const { email, companyId } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    if (!companyId) {
      return res.status(400).json({ error: "Company ID is required" });
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete from employees table
      await client.query(
        'DELETE FROM employees WHERE email = $1 AND company_id = $2',
        [email, companyId]
      );

      // Deactivate user in users table (soft delete)
      await client.query(
        'UPDATE users SET active = false, last_updated = CURRENT_TIMESTAMP WHERE email = $1 AND company_id = $2',
        [email, companyId]
      );

      await client.query('COMMIT');
      res.json({ success: true, message: "User deleted successfully" });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await safeRelease(client);
    }

  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ success: false, error: "Failed to delete user" });
  }
});

async function createNeonAuthUser(email, name) {
  const response = await axios.post(
    "https://console.neon.tech/api/v2/projects/auth/user",
    {
      auth_provider: "stack",
      project_id: "calm-math-47167505", // or your project id string
      email,
      name,
    },
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${process.env.NEON_API_KEY}`,
        "content-type": "application/json",
      },
    }
  );
  return response.data;
}

app.post("/api/channel/create/:companyID", async (req, res) => {
  const { companyID } = req.params;
  const phoneCount = 1;

  // Get additional data from request body
  const {
    name,
    companyName,
    phoneNumber,
    email,
    password,
    plan = 'blaster', // Default plan
    country
  } = req.body || {};

  try {
    // Check if company exists first
    let companyResult = await sqlDb.query(
      "SELECT * FROM companies WHERE company_id = $1",
      [companyID]
    );
    
    let company = companyResult.rows[0];
    let companyCreated = false;

    // If company doesn't exist, create it with the provided data
    if (!company) {
      console.log(`Company ${companyID} not found, creating new company...`);
      
      try {
        // Create company with the provided information including apiUrl
        await sqlDb.query(
          `INSERT INTO companies (
            company_id, 
            name, 
            email, 
            phone, 
            status, 
            enabled, 
            created_at, 
            updated_at,
            plan,
            company,
            api_url
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $7, $8, $9)`,
          [
            companyID,
            name || `Company_${companyID}`, // Use provided name or default
            email || `company_${companyID}@example.com`, // Use provided email or default
            phoneNumber || "", // Use provided phone or empty
            "active",
            true,
            plan, // Store the selected plan
            companyName || `Company_${companyID}`, // Use provided company name or default
            "https://juta-dev.ngrok.dev", // Set the API URL
          ]
        );
        
        // Fetch the newly created company
        companyResult = await sqlDb.query(
          "SELECT * FROM companies WHERE company_id = $1",
          [companyID]
        );
        company = companyResult.rows[0];
        companyCreated = true;
        
        console.log(`Company ${companyID} created successfully with plan: ${plan} and apiUrl: https://juta-dev.ngrok.dev/`);
      } catch (createError) {
        console.error("Error creating company:", createError);
        return res.status(500).json({
          success: false,
          error: "Failed to create company",
          details: createError.message,
        });
      }
    } else {
      // If company exists, update it with the new information if provided
      if (name || email || phoneNumber || plan || companyName) {
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;

        if (name) {
          updateFields.push(`name = $${paramIndex++}`);
          updateValues.push(name);
        }
        if (email) {
          updateFields.push(`email = $${paramIndex++}`);
          updateValues.push(email);
        }
        if (phoneNumber) {
          updateFields.push(`phone = $${paramIndex++}`);
          updateValues.push(phoneNumber);
        }
        if (plan) {
          updateFields.push(`plan = $${paramIndex++}`);
          updateValues.push(plan);
        }
        if (companyName) {
          updateFields.push(`company = $${paramIndex++}`);
          updateValues.push(companyName);
        }

        // Always update apiUrl for existing companies too
        updateFields.push(`api_url = $${paramIndex++}`);
        updateValues.push("https://juta-dev.ngrok.dev/");

        if (updateFields.length > 0) {
          updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
          updateValues.push(companyID);

          await sqlDb.query(
            `UPDATE companies SET ${updateFields.join(', ')} WHERE company_id = $${paramIndex}`,
            updateValues
          );

          // Fetch the updated company
          companyResult = await sqlDb.query(
            "SELECT * FROM companies WHERE company_id = $1",
            [companyID]
          );
          company = companyResult.rows[0];
        }
      }
    }

    // Create the assistant with proper error handling
    let assistantId;
    try {
      assistantId = await createAssistant(companyID);
    } catch (assistantError) {
      console.error("Failed to create assistant:", assistantError);
      // Continue without assistant - don't fail the entire request
      assistantId = null;
    }

    // Respond to the client immediately
    res.json({
      success: true,
      message: companyCreated 
        ? "Company and channel created successfully. Bot initialization in progress."
        : "Channel created successfully. Bot initialization in progress.",
      companyId: companyID,
      company: company,
      botStatus: "initializing",
      assistantId: assistantId,
      companyCreated: companyCreated,
      plan: plan,
      apiUrl: "https://juta-dev.ngrok.dev/",
    });

    // Now initialize the bot in the background
    initializeBot(companyID, phoneCount)
      .then(() => {
        console.log(`Bot initialized for company ${companyID}`);
      })
      .catch((error) => {
        console.error(
          `Error initializing bot for company ${companyID}:`,
          error
        );
        // Optionally: log to DB or notify admin
      });
  } catch (error) {
    console.error("Error creating channel and initializing new bot:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create channel and initialize new bot",
      details: error.message,
    });
  }
});
app.post(
  "/api/create-user/:email/:phoneNumber/:password/:role/:companyId",
  async (req, res) => {
    try {
      const decodedEmail = decodeURIComponent(req.params.email);
      if (!decodedEmail || !decodedEmail.includes("@")) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      const userData = {
        email: decodedEmail,
        phoneNumber: req.params.phoneNumber,
        password: req.params.password,
        role: req.params.role,
        companyId: req.params.companyId, // Get companyId from params
      };
      const name = decodedEmail.split("@")[0];
      console.log("Creating user in Neon Auth:", userData, name);
      
      // Create user in Neon Auth
      const neonUser = await createNeonAuthUser(decodedEmail, name);

      // Generate a unique user ID
      const userId = uuidv4();

      // Create company in database if it doesn't exist
      const companyCheck = await sqlDb.query(
        "SELECT company_id FROM companies WHERE company_id = $1",
        [userData.companyId]
      );

      if (companyCheck.rows.length === 0) {
        // Create company if it doesn't exist
        await sqlDb.query(
          `INSERT INTO companies (company_id, name, email, phone, status, enabled, created_at) 
          VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
          [
            userData.companyId,
            userData.email.split("@")[0],
            userData.email,
            userData.phoneNumber,
            "active",
            true,
          ]
        );
      }

      // Create user in database
      await sqlDb.query(
        `INSERT INTO users (user_id, company_id, email, phone, role, active, created_at, password) 
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7)`,
        [
          userId,
          userData.companyId,
          userData.email,
          0,
          userData.role,
          true,
          userData.password,
        ]
      );
      
      res.json({
        message: "User created successfully",
        userId,
        companyId: userData.companyId,
        neonUserId: neonUser.id,
        role: userData.role,
        email: userData.email,
      });
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({
        error: error.code || "Failed to create user",
        details: error.message,
      });
    }
  }
);

// New API to add a user under an existing company
app.post(
  "/api/add-user/:companyId/:email/:phoneNumber/:password/:role",
  async (req, res) => {
    try {
      const { companyId, email, phoneNumber, password, role } = req.params;
      const decodedEmail = decodeURIComponent(email);

      // Get optional fields from request body
      const {
        name: providedName,
        employeeId,
        phoneAccess,
        weightages,
        company,
        imageUrl,
        notes,
        quotaLeads,
        viewEmployees,
        invoiceNumber,
        empGroup,
        profile,
        threadId
      } = req.body || {};

      if (!decodedEmail || !decodedEmail.includes("@")) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      // Check if company exists
      const companyResult = await sqlDb.query(
        "SELECT * FROM companies WHERE company_id = $1",
        [companyId]
      );
      if (companyResult.rows.length === 0) {
        return res.status(404).json({ error: "Company not found" });
      }

      // Create user in Neon Auth
      const name = providedName || decodedEmail.split("@")[0];
      const neonUser = await createNeonAuthUser(decodedEmail, name);

      // Generate unique IDs
      const userId = uuidv4();
      const finalEmployeeId = employeeId || uuidv4();

      // Insert into users table with flexible field handling
      const userFields = ['user_id', 'company_id', 'email', 'phone', 'role', 'active', 'created_at', 'password'];
      const userValues = [userId, companyId, decodedEmail, 0, role, true, password];
      let userPlaceholders = '$1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7';
      let paramIndex = 8;

      // Add optional user fields
      if (providedName) {
        userFields.push('name');
        userValues.push(name);
        userPlaceholders += `, $${paramIndex++}`;
      }
      if (profile) {
        userFields.push('profile');
        userValues.push(JSON.stringify(profile));
        userPlaceholders += `, $${paramIndex++}`;
      }
      if (threadId) {
        userFields.push('thread_id');
        userValues.push(threadId);
        userPlaceholders += `, $${paramIndex++}`;
      }

      const userQuery = `
        INSERT INTO users (${userFields.join(', ')}) 
        VALUES (${userPlaceholders})
      `;

      await sqlDb.query(userQuery, userValues);

      // Insert into employees table with flexible field handling
      const empFields = ['employee_id', 'company_id', 'name', 'email', 'role', 'active', 'created_at'];
      const empValues = [finalEmployeeId, companyId, name, decodedEmail, role, true];
      let empPlaceholders = '$1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP';
      paramIndex = 7;

      // Add optional employee fields
      if (phoneNumber) {
        empFields.push('phone_number');
        empValues.push(phoneNumber);
        empPlaceholders += `, $${paramIndex++}`;
      }
      if (phoneAccess) {
        empFields.push('phone_access');
        empValues.push(JSON.stringify(phoneAccess));
        empPlaceholders += `, $${paramIndex++}`;
      }
      if (weightages) {
        empFields.push('weightages');
        empValues.push(JSON.stringify(weightages));
        empPlaceholders += `, $${paramIndex++}`;
      }
      if (company) {
        empFields.push('company');
        empValues.push(company);
        empPlaceholders += `, $${paramIndex++}`;
      }
      if (imageUrl) {
        empFields.push('image_url');
        empValues.push(imageUrl);
        empPlaceholders += `, $${paramIndex++}`;
      }
      if (notes) {
        empFields.push('notes');
        empValues.push(notes);
        empPlaceholders += `, $${paramIndex++}`;
      }
      if (quotaLeads !== undefined) {
        empFields.push('quota_leads');
        empValues.push(quotaLeads);
        empPlaceholders += `, $${paramIndex++}`;
      }
      if (viewEmployees) {
        empFields.push('view_employees');
        empValues.push(JSON.stringify(viewEmployees));
        empPlaceholders += `, $${paramIndex++}`;
      }
      if (invoiceNumber) {
        empFields.push('invoice_number');
        empValues.push(invoiceNumber);
        empPlaceholders += `, $${paramIndex++}`;
      }
      if (empGroup) {
        empFields.push('emp_group');
        empValues.push(empGroup);
        empPlaceholders += `, $${paramIndex++}`;
      }

      const empQuery = `
        INSERT INTO employees (${empFields.join(', ')}) 
        VALUES (${empPlaceholders})
      `;

      await sqlDb.query(empQuery, empValues);

      res.json({
        message: "User added successfully",
        userId,
        employeeId: finalEmployeeId,
        companyId,
        neonUserId: neonUser.id,
        role,
        email: decodedEmail,
        name
      });
    } catch (error) {
      console.error("Error adding user:", error);
      res.status(500).json({
        error: error.code || "Failed to add user",
        details: error.message,
      });
    }
  }
);

app.post("/api/import-csv/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const { csvUrl, tags } = req.body;

  if (!csvUrl) {
    return res.status(400).json({ error: "CSV URL is required" });
  }

  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: "Tags must be an array" });
  }

  try {
    const tempFile = `temp_${Date.now()}.csv`;
    await downloadCSV(csvUrl, tempFile);
    await processCSV(tempFile, companyId, tags);
    fs.unlinkSync(tempFile); // Clean up temporary file
    res.json({ message: "CSV processed successfully" });
  } catch (error) {
    console.error("Error processing CSV:", error);
    res.status(500).json({ error: "Failed to process CSV" });
  }
});

async function downloadCSV(url, filename) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Unexpected response ${response.statusText}`);
  await pipeline(response.body, fs.createWriteStream(filename));
}

// Update the processCSV function to accept tags
async function processCSV(filename, companyId, tags) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filename)
      .pipe(csv())
      .on("data", async (row) => {
        try {
          await processContact(row, companyId, tags);
        } catch (error) {
          console.error("Error processing row:", error);
        }
      })
      .on("end", () => {
        console.log("CSV file successfully processed");
        resolve();
      })
      .on("error", reject);
  });
}

async function processContact(row, companyId, tags) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let name, phone;

    if (companyId === "0124") {
      name = row["Nama Penuh"] || row["Nama Syarikat/Organisasi"];
      phone = await formatPhoneNumber(
        row["No Telefon"] || row["No Telefon Organisasi"]
      );
    } else {
      name = row.Name;
      phone = await formatPhoneNumber(row.Phone);
    }

    if (!name) {
      name = phone;
    }

    let phoneWithPlus = phone.startsWith("+") ? phone : "+" + phone;
    const phoneWithoutPlus = phone.replace("+", "");
    const contactId = `${companyId}-${phoneWithoutPlus}`;

    if (phone) {
      // Check if contact exists
      const checkQuery =
        "SELECT id FROM contacts WHERE contact_id = $1 AND company_id = $2";
      const checkResult = await client.query(checkQuery, [
        contactId,
        companyId,
      ]);

      if (checkResult.rows.length > 0) {
        // Contact exists - update tags and possibly zakat data
        const updateData = {
          tags: [...tags],
          updated_at: new Date(),
        };

        if (companyId === "0124") {
          // For zakat data, we need to handle the JSONB array
          const zakatData = createZakatData(row);
          const updateZakatQuery = `
            UPDATE contacts 
            SET tags = tags || $1::jsonb, 
                custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object('zakatData', COALESCE(custom_fields->'zakatData', '[]'::jsonb) || $2::jsonb),
                updated_at = $3
            WHERE contact_id = $4 AND company_id = $5
          `;
          await client.query(updateZakatQuery, [
            JSON.stringify(tags),
            JSON.stringify([zakatData]),
            new Date(),
            contactId,
            companyId,
          ]);
        } else {
          // Regular update for non-zakat contacts
          const updateQuery = `
            UPDATE contacts 
            SET tags = tags || $1::jsonb, 
                updated_at = $2
            WHERE contact_id = $3 AND company_id = $4
          `;
          await client.query(updateQuery, [
            JSON.stringify(tags),
            new Date(),
            contactId,
            companyId,
          ]);
        }
      } else {
        // Contact doesn't exist - create new record
        const contactData = {
          contact_id: contactId,
          company_id: companyId,
          name: name,
          contact_name: name,
          phone: phoneWithPlus,
          email: null,
          thread_id: "",
          tags: JSON.stringify(tags),
          chat_id: `${phoneWithoutPlus}@c.us`,
          chat_data: JSON.stringify({
            contact_id: phoneWithoutPlus,
            id: `${phoneWithoutPlus}@c.us`,
            name: name,
            not_spam: true,
            tags: tags,
            timestamp: Date.now(),
            type: "contact",
            unreadCount: 0,
            last_message: null,
          }),
          unread_count: 0,
          not_spam: true,
          last_message: null,
          custom_fields: {},
        };

        if (companyId === "079") {
          contactData.branch = row["BRANCH NAME"] || "-";
          contactData.address1 = row["ADDRESS"] || "-";
          contactData.expiry_date = row["PERIOD OF COVER"] || "-";
          contactData.email = row["EMAIL"] || "-";
          contactData.vehicle_number = row["VEH. NO"] || "-";
          contactData.ic = row["IC/PASSPORT/BUSINESS REG. NO"] || "-";
        } else if (companyId === "0124") {
          contactData.address1 =
            `${row["Alamat Penuh (Jalan)"]} ${row["Alamat Penuh (Address Line 2)"]}`.trim();
          contactData.city = row["Alamat Penuh (Bandar)"] || null;
          contactData.state = row["Alamat Penuh (Negeri)"] || null;
          contactData.postcode = row["Alamat Penuh (Poskod)"] || null;
          contactData.email = row["Emel"] || null;
          contactData.ic = row["No. Kad Pengenalan ( tanpa '-' )"] || null;

          // Add zakat data to custom_fields
          contactData.custom_fields = JSON.stringify({
            zakatData: [createZakatData(row)],
          });
        }

        const insertQuery = `
          INSERT INTO contacts (
            contact_id, company_id, name, contact_name, phone, email, thread_id, 
            tags, chat_id, chat_data, unread_count, not_spam, last_message, 
            custom_fields, branch, address1, expiry_date, vehicle_number, ic,
            city, state, postcode, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
          )
        `;

        await client.query(insertQuery, [
          contactData.contact_id,
          contactData.company_id,
          contactData.name,
          contactData.contact_name,
          contactData.phone,
          contactData.email,
          contactData.thread_id,
          contactData.tags,
          contactData.chat_id,
          contactData.chat_data,
          contactData.unread_count,
          contactData.not_spam,
          contactData.last_message,
          contactData.custom_fields,
          contactData.branch,
          contactData.address1,
          contactData.expiry_date,
          contactData.vehicle_number,
          contactData.ic,
          contactData.city,
          contactData.state,
          contactData.postcode,
          new Date(),
          new Date(),
        ]);
      }
    } else {
      console.warn(`Skipping invalid phone number for ${name}`);
    }

    await client.query("COMMIT");
  } catch (error) {
    await safeRollback(client);
    console.error("Error processing contact:", error);
    throw error;
  } finally {
    await safeRelease(client);
  }
}

function createZakatData(row) {
  const sourceUrl = row["Source Url"] || "";
  const zakatData = {
    // Common fields for all types
    paymentStatus: row["Payment Status"] || "Processing",
    paymentDate: row["Payment Date"] || null,
    paymentAmount: row["Payment Amount"] || null,
    transactionId: row["Transaction Id"] || null,
    entryDate: row["Entry Date"] || null,
    dateUpdated: row["Date Updated"] || null,
    sourceUrl: sourceUrl,
    total: row["Total"] || null,
    productName: row["Product Name (Name)"] || null,
    productPrice:
      row["Product Name (Price)"]?.replace("&#82;&#77; ", "") || null,
    productQuantity: row["Product Name (Quantity)"] || null,
    consent: row["Consent (Consent)"] || null,
    consentText: row["Consent (Text)"] || null,
    consentDescription: row["Consent (Description)"] || null,
  };

  // Determine type and add specific fields
  if (sourceUrl.includes("zakat-simpanan")) {
    zakatData.type = "Simpanan";
    zakatData.totalSavings = row["Jumlah Wang Simpanan"];
    zakatData.zakatAmount = row["Jumlah Zakat Simpanan Yang Perlu Ditunaikan"];
  } else if (sourceUrl.includes("zakat-perniagaan")) {
    zakatData.type = row["Nama Syarikat/Organisasi"]
      ? "PerniagaanOrganisasi"
      : "PerniagaanIndividu";
    zakatData.businessProfit = row["Untung Bersih Perniagaan"];
    zakatData.zakatAmount =
      row["Jumlah Zakat Perniagaan Yang Perlu Ditunaikan"];
    if (zakatData.type === "PerniagaanOrganisasi") {
      zakatData.companyName = row["Nama Syarikat/Organisasi"];
      zakatData.ssmNumber = row["No. SSM"];
      zakatData.orgPhone = row["No Telefon Organisasi"];
      zakatData.officerName = row["Nama Pegawai Untuk Dihubungi"];
      zakatData.officerPhone = row["No. Telefon Pegawai"];
    }
  } else if (sourceUrl.includes("zakat-perak")) {
    zakatData.type = "Perak";
    zakatData.silverValue = row["Nilai Simpanan"];
    zakatData.zakatAmount = row["Jumlah Zakat Perak Yang Perlu Ditunaikan"];
  } else if (sourceUrl.includes("zakat-pendapatan")) {
    zakatData.type = "Pendapatan";
    zakatData.monthlyIncome = row["Pendapatan Bulanan"];
    zakatData.otherAnnualIncome = row["Lain-Lain Pendapatan Tahunan"];
    zakatData.monthlyZakat = row["Jumlah Zakat Bulanan"];
    zakatData.annualZakat = row["Jumlah Zakat Tahunan"];
    zakatData.paymentOption = row["Pilihan Bayaran"];
  } else if (sourceUrl.includes("zakat-pelaburan")) {
    zakatData.type = "Pelaburan";
    zakatData.investmentTotal = row["Modal Asal + Untung Bersih"];
    zakatData.zakatAmount = row["Jumlah Zakat Pelaburan Yang Perlu Ditunaikan"];
  } else if (sourceUrl.includes("zakat-padi")) {
    zakatData.type = "Padi";
    zakatData.year = row["Haul/Tahun"];
    zakatData.zakatAmount = row["Jumlah Zakat Padi Yang Hendak Ditunaikan"];
  } else if (sourceUrl.includes("zakat-kwsp")) {
    zakatData.type = "KWSP";
    zakatData.epfAmount = row["Jumlah Yang Dikeluarkan Daripada KWSP"];
    zakatData.zakatAmount = row["Jumlah Zakat KWSP Yang Perlu Ditunaikan"];
  } else if (sourceUrl.includes("zakat-fitrah")) {
    zakatData.type = "Fitrah";
    zakatData.riceType = row["Pilih Jenis Beras"];
    zakatData.dependents = row["Jumlah Tanggungan (orang)"];
    zakatData.zakatAmount = row["Zakat Fitrah Yang Perlu Ditunaikan"];
  } else if (sourceUrl.includes("zakat-emas")) {
    zakatData.type = "Emas";
    zakatData.goldValue = row["Nilai Semasa Emas Yang Dimiliki"];
    zakatData.zakatAmount = row["Jumlah Zakat Emas Yang Perlu Ditunaikan"];
  } else if (sourceUrl.includes("zakat-ternakan")) {
    zakatData.type = "Ternakan";
    zakatData.year = row["Haul/Tahun"];
    zakatData.zakatAmount = row["Jumlah Zakat Qadha Yang Hendak Ditunaikan"];
  } else if (sourceUrl.includes("qadha-zakat")) {
    zakatData.type = "Qadha";
    zakatData.year = row["Haul/Tahun"];
    zakatData.zakatAmount = row["Jumlah Zakat Qadha Yang Hendak Ditunaikan"];
  }

  return zakatData;
}

function formatPhoneNumber(phone) {
  if (!phone) return "";

  // Remove all non-numeric characters
  phone = phone.toString().replace(/\D/g, "");

  // Remove leading zeros
  phone = phone.replace(/^0+/, "");

  // Ensure the number starts with '6'
  if (!phone.startsWith("6")) {
    phone = "6" + phone;
  }

  // Validate phone number length (should be between 10-14 digits after adding '6')
  if (phone.length < 10 || phone.length > 14) {
    console.warn(`Invalid phone number length: ${phone}`);
    return "";
  }

  //console.log('Formatted phone:', phone);
  return phone;
}

function toPgTimestamp(firestoreTimestamp) {
  if (!firestoreTimestamp) return null;

  // If it's already a JS Date
  if (firestoreTimestamp instanceof Date) return firestoreTimestamp;

  // If it's a string, try to parse it
  if (typeof firestoreTimestamp === "string") {
    const date = new Date(firestoreTimestamp);
    if (!isNaN(date.getTime())) return date;
    return null;
  }

  // If it's a Firestore timestamp object
  if (
    typeof firestoreTimestamp === "object" &&
    typeof firestoreTimestamp.seconds === "number" &&
    typeof firestoreTimestamp.nanoseconds === "number"
  ) {
    return new Date(
      firestoreTimestamp.seconds * 1000 +
        firestoreTimestamp.nanoseconds / 1000000
    );
  }

  // If it's a number (milliseconds since epoch)
  if (typeof firestoreTimestamp === "number") {
    return new Date(firestoreTimestamp);
  }

  // Fallback
  return null;
}

// POST endpoint to schedule a message
app.post("/api/schedule-message/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const scheduledMessage = req.body;
  const phoneIndex = scheduledMessage.phoneIndex || 0;

  console.log("Received scheduling request:", {
    companyId,
    messageFormat: scheduledMessage.message ? "single" : "sequence",
    hasAdditionalMessages: Boolean(scheduledMessage.messages?.length),
    infiniteLoop: Boolean(scheduledMessage.infiniteLoop),
    hasMedia: Boolean(
      scheduledMessage.mediaUrl || scheduledMessage.documentUrl
    ),
    hasCaption: Boolean(scheduledMessage.caption),
    multiple: Boolean(scheduledMessage.multiple),
    contactCount: Array.isArray(scheduledMessage.contactId) ? scheduledMessage.contactId.length : 1,
  });

  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const messageId = uuidv4();
      const isMediaMessage = Boolean(
        scheduledMessage.mediaUrl || scheduledMessage.documentUrl
      );
      const messageCaption =
        scheduledMessage.caption || scheduledMessage.message || "";

      // Handle multiple vs single contact logic
      const isMultiple = Boolean(scheduledMessage.multiple);
      const contactIds = Array.isArray(scheduledMessage.contact_id) 
        ? scheduledMessage.contact_id 
        : [scheduledMessage.contact_id].filter(Boolean);
      
      console.log("Contact processing:", {
        isMultiple,
        contactIds,
        originalContactId: scheduledMessage.contact_id
      });
      
      // Validation: ensure we have contacts
      if (!contactIds.length) {
        throw new Error("No valid contacts provided");
      }
      
      // For single contact, store in contact_id field
      // For multiple contacts, store in contact_ids field
      const singleContactId = !isMultiple && contactIds.length > 0 ? contactIds[0] : null;
      const multipleContactIds = isMultiple && contactIds.length > 0 ? contactIds : null;

      const chatIds = scheduledMessage.chatIds || [];
      
      // Calculate batching based on CONTACTS (not messages)
      const totalContacts = contactIds.length;
      const contactsPerBatch = scheduledMessage.batchQuantity || totalContacts;
      const numberOfBatches = Math.ceil(totalContacts / contactsPerBatch);

      console.log("Batch calculation:", {
        totalContacts,
        contactsPerBatch,
        numberOfBatches,
        isMultiple,
        contactIds
      });

      const mainMessageQuery = `
        INSERT INTO scheduled_messages (
          id, schedule_id, company_id, contact_id, contact_ids, multiple, message_content, media_url, 
          scheduled_time, status, created_at, chat_id, phone_index, is_media,
          document_url, file_name, caption, chat_ids, batch_quantity, repeat_interval,
          repeat_unit, message_delays, infinite_loop, min_delay, max_delay, activate_sleep,
          sleep_after_messages, sleep_duration, active_hours, from_me, messages, template_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 
          $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
      `;
      const scheduledTime = toPgTimestamp(scheduledMessage.scheduledTime);
      await client.query(mainMessageQuery, [
        messageId,
        messageId,
        companyId,
        singleContactId,
        multipleContactIds ? JSON.stringify(multipleContactIds) : null,
        isMultiple,
        scheduledMessage.message || null,
        scheduledMessage.mediaUrl || null,
        scheduledTime,
        "scheduled",
        new Date(),
        chatIds[0] || null,
        phoneIndex,
        isMediaMessage,
        scheduledMessage.documentUrl || null,
        scheduledMessage.fileName || null,
        messageCaption,
        JSON.stringify(chatIds),
        scheduledMessage.batchQuantity || null,
        scheduledMessage.repeatInterval || null,
        scheduledMessage.repeatUnit || null,
        scheduledMessage.messageDelays
          ? JSON.stringify(scheduledMessage.messageDelays)
          : null,
        scheduledMessage.infiniteLoop || false,
        scheduledMessage.minDelay || null,
        scheduledMessage.maxDelay || null,
        scheduledMessage.activateSleep || false,
        scheduledMessage.sleepAfterMessages || null,
        scheduledMessage.sleepDuration || null,
        scheduledMessage.activeHours
          ? JSON.stringify(scheduledMessage.activeHours)
          : null,
        true,
        scheduledMessage.messages
          ? JSON.stringify(scheduledMessage.messages)
          : null,
        scheduledMessage.template_id || null,
      ]);

      const queue = getQueueForBot(companyId);        
      const batches = [];
        
      // Create batches if there are multiple contacts requiring batching
      if (isMultiple && numberOfBatches > 1) {
        for (let batchIndex = 0; batchIndex < numberOfBatches; batchIndex++) {
          const startIndex = batchIndex * contactsPerBatch;
          const endIndex = Math.min((batchIndex + 1) * contactsPerBatch, totalContacts);

          const batchDelay =
            batchIndex *
            (scheduledMessage.repeatInterval || 0) *
            getMillisecondsForUnit(scheduledMessage.repeatUnit || 'minutes');
          const batchScheduledTime = new Date(
            toPgTimestamp(scheduledMessage.scheduledTime).getTime() + batchDelay
          );

          const batchId = uuidv4(); // generate a valid UUID for each batch

          // Get contact IDs for this batch
          const batchContactIds = contactIds.slice(startIndex, endIndex);
          const batchChatIds = chatIds.slice(startIndex, endIndex);

          // Prepare messages for this batch
          const batchMessages = batchChatIds.map(chatId => ({
            chatId: chatId,
            message: scheduledMessage.message || null,
            delay: scheduledMessage.messageDelays 
              ? (JSON.parse(scheduledMessage.messageDelays)[0] || 0)
              : Math.floor(Math.random() * ((scheduledMessage.maxDelay || 5) - (scheduledMessage.minDelay || 1) + 1) + (scheduledMessage.minDelay || 1)),
            mediaUrl: scheduledMessage.mediaUrl || "",
            documentUrl: scheduledMessage.documentUrl || "",
            fileName: scheduledMessage.fileName || "",
            caption: scheduledMessage.caption || ""
          }));
          
          const batchQuery = `
          INSERT INTO scheduled_messages (
            id, schedule_id, company_id, scheduled_time, status, created_at,
            batch_index, chat_ids, phone_index, from_me, message_content, media_url, document_url, file_name, caption,
            messages, min_delay, max_delay, infinite_loop, repeat_interval, repeat_unit, active_hours,
            multiple, contact_id, contact_ids
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
        `;
          await client.query(batchQuery, [
            batchId,
            messageId,
            companyId,
            batchScheduledTime,
            "scheduled",
            new Date(),
            batchIndex,
            JSON.stringify(batchChatIds),
            phoneIndex,
            true,
            scheduledMessage.message || null,
            scheduledMessage.mediaUrl || null,
            scheduledMessage.documentUrl || null,
            scheduledMessage.fileName || null,
            scheduledMessage.caption || null,
            JSON.stringify(batchMessages),
            scheduledMessage.minDelay || null,
            scheduledMessage.maxDelay || null,
            scheduledMessage.infiniteLoop || false,
            scheduledMessage.repeatInterval || null,
            scheduledMessage.repeatUnit || null,
            scheduledMessage.activeHours ? JSON.stringify(scheduledMessage.activeHours) : null,
            isMultiple, // Use the defined variable
            null, // For batches, contact_id is always null
            JSON.stringify(batchContactIds), // Store the batch contacts in contact_ids
          ]);
          batches.push({ id: batchId, scheduledTime: batchScheduledTime });
        }
      }

      await client.query("COMMIT");

      // Add jobs to queue
      if (batches.length > 0) {
        // Add batch jobs only (not the main entry as per requirements)
        for (const batch of batches) {
          const delay = Math.max(batch.scheduledTime.getTime() - Date.now(), 0);
          await queue.add(
            "send-message-batch",
            {
              companyId,
              messageId,
              batchId: batch.id,
            },
            {
              removeOnComplete: false,
              removeOnFail: false,
              delay,
              jobId: batch.id,
            }
          );
        }
      } else {
        // Add single message job (no batching needed)
        const delay = Math.max(scheduledTime.getTime() - Date.now(), 0);
        await queue.add(
          "send-single-message",
          {
            companyId,
            messageId,
          },
          {
            removeOnComplete: false,
            removeOnFail: false,
            delay,
            jobId: messageId,
          }
        );
      }

      res.status(201).json({
        id: messageId,
        message: "Message scheduled successfully",
        batches: batches.length,
        success: true,
      });
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      await safeRelease(client);
    }
  } catch (error) {
    console.error("Error scheduling message:", error);
    res.status(500).json({ error: "Failed to schedule message" });
  }
});

// PUT endpoint to update a scheduled message
app.put("/api/schedule-message/:companyId/:messageId", async (req, res) => {
  const { companyId, messageId } = req.params;
  const updatedMessage = req.body;
  const phoneIndex = updatedMessage.phoneIndex || 0;

  console.log("PUT /api/schedule-message/:companyId/:messageId called");
  console.log("Params:", { companyId, messageId });
  console.log("Updated message body:", updatedMessage);

  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Get existing message to access its properties
      const existingMessageQuery = "SELECT * FROM scheduled_messages WHERE id = $1 AND company_id = $2";
      const existingMessageResult = await client.query(existingMessageQuery, [messageId, companyId]);

      if (existingMessageResult.rowCount === 0) {
        console.log("Scheduled message not found");
        return res.status(404).json({
          success: false,
          error: "Scheduled message not found",
        });
      }

      const existingMessage = existingMessageResult.rows[0];

      // Do not delete any records - we will update them all instead
      console.log("Updating all messages with schedule_id:", messageId);

      // We'll only update the content-related fields that can be changed in the frontend
      // Keeping the batch structure, recipients, and scheduling intact
      const updateQuery = `
        UPDATE scheduled_messages SET
          message_content = $1,
          media_url = $2,
          is_media = $3,
          document_url = $4,
          file_name = $5,
          caption = $6,
          status = $7
        WHERE (id::text = $8::text OR schedule_id::text = $8::text) AND company_id = $9
      `;

      const isMediaMessage = Boolean(
        updatedMessage.mediaUrl || updatedMessage.documentUrl
      );
      const messageCaption =
        updatedMessage.caption || updatedMessage.message || "";

      console.log("Updating content for all scheduled message records with schedule_id:", messageId);
      await client.query(updateQuery, [
        updatedMessage.message || null,
        updatedMessage.mediaUrl || null,
        isMediaMessage,
        updatedMessage.documentUrl || null,
        updatedMessage.fileName || null,
        messageCaption,
        updatedMessage.status || "scheduled",
        messageId,
        companyId,
      ]);

      // No need to modify the queue jobs or recreate batches
      // Just update the content of the existing messages
      // The existing job scheduling remains intact
      
      // If the status has changed to something other than "scheduled", 
      // we should remove any pending jobs from the queue
      if (updatedMessage.status && updatedMessage.status !== "scheduled") {
        console.log(`Message status changed to ${updatedMessage.status}, removing jobs from queue if they exist`);
        
        // Get all batch IDs associated with this message
        const batchesQuery = "SELECT id FROM scheduled_messages WHERE (id::text = $1::text OR schedule_id = $1) AND company_id = $2";
        const batchesResult = await client.query(batchesQuery, [messageId, companyId]);
        const batchIds = batchesResult.rows.map(row => row.id);
        
        // Remove jobs from queue
        const queue = getQueueForBot(companyId);
        for (const id of batchIds) {
          try {
            await queue.remove(id);
            console.log(`Removed job with ID ${id} from queue`);
          } catch (e) {
            // Job might not exist, which is fine
            console.log(`Job with ID ${id} not found in queue or already processed`);
          }
        }
      } else {
        console.log("Message status remains 'scheduled', keeping existing jobs in the queue");
      }

      await client.query("COMMIT");

      console.log("Scheduled message updated successfully:", messageId);
      res.json({
        id: messageId,
        message: "Message updated successfully",
        success: true,
      });
    } catch (error) {
      await safeRollback(client);
      console.error("Error during scheduled message update transaction:", error);
      throw error;
    } finally {
      await safeRelease(client);
    }
  } catch (error) {
    console.error("Error updating scheduled message:", error);
    res.status(500).json({ error: "Failed to update scheduled message" });
  }
});

// DELETE endpoint to remove a scheduled message
app.delete("/api/schedule-message/:companyId/:messageId", async (req, res) => {
  const { companyId, messageId } = req.params;

  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const checkQuery =
        "SELECT id FROM scheduled_messages WHERE schedule_id = $1 AND company_id = $2";
      const checkResult = await client.query(checkQuery, [
        messageId,
        companyId,
      ]);

      if (checkResult.rowCount === 0) {
        return res.status(404).json({
          success: false,
          error: "Scheduled message not found",
        });
      }

      // First, get all batch IDs associated with this message for queue job removal
      const getBatchesQuery = 
        "SELECT id FROM scheduled_messages WHERE (id::text = $1::text OR schedule_id = $1) AND company_id = $2";
      const batchesResult = await client.query(getBatchesQuery, [
        messageId,
        companyId,
      ]);
      
      const batchIds = batchesResult.rows.map(row => row.id);
      
      // Delete the message records from database
      const deleteQuery =
        "DELETE FROM scheduled_messages WHERE (id::text = $1::text OR schedule_id = $1) AND company_id = $2";
      const deleteResult = await client.query(deleteQuery, [
        messageId,
        companyId,
      ]);
      
      // Get the queue and remove all related jobs
      const queue = getQueueForBot(companyId);
      
      // Remove main message job if it exists
      await queue.removeRepeatableByKey(messageId);
      try {
        await queue.remove(messageId);
      } catch (e) {
        // Job might not exist, which is fine
        console.log(`Job with ID ${messageId} not found in queue or already processed`);
      }
      
      // Remove all batch jobs if they exist
      for (const batchId of batchIds) {
        if (batchId !== messageId) {
          try {
            await queue.remove(batchId);
          } catch (e) {
            // Job might not exist, which is fine
            console.log(`Batch job with ID ${batchId} not found in queue or already processed`);
          }
        }
      }

      await client.query("COMMIT");

      res.json({
        id: messageId,
        message: "Message deleted successfully",
        success: true,
        batchesDeleted: deleteResult.rowCount - 1,
        jobsRemoved: batchIds.length
      });
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      await safeRelease(client);
    }
  } catch (error) {
    console.error("Error deleting scheduled message:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to delete scheduled message",
    });
  }
});

// DELETE endpoint to remove scheduled messages by template_id
app.delete("/api/schedule-message/:companyId/template/:templateId/contact/:contactId", async (req, res) => {
  const { companyId, templateId, contactId } = req.params;

  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Find all scheduled messages for this template and contact
      const findQuery = `
        SELECT id FROM scheduled_messages
        WHERE company_id = $1
          AND template_id = $2
          AND (
            contact_id = $3
            OR (contact_ids IS NOT NULL AND contact_ids::jsonb ? $3)
          )
      `;
      const findResult = await client.query(findQuery, [companyId, templateId, contactId]);
      const messageIds = findResult.rows.map(row => row.id);

      if (messageIds.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          error: "No scheduled messages found for this template and contact",
        });
      }

      // Delete from database
      const deleteQuery = `
        DELETE FROM scheduled_messages
        WHERE company_id = $1
          AND template_id = $2
          AND (
            contact_id = $3
            OR (contact_ids IS NOT NULL AND contact_ids::jsonb ? $3)
          )
      `;
      const deleteResult = await client.query(deleteQuery, [companyId, templateId, contactId]);

      // Remove jobs from queue
      const queue = getQueueForBot(companyId);
      for (const id of messageIds) {
        try {
          await queue.remove(id);
        } catch (e) {
          // Job might not exist, which is fine
        }
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        deletedCount: deleteResult.rowCount,
        jobsRemoved: messageIds.length,
        message: `Deleted ${deleteResult.rowCount} scheduled message(s) for template and contact`,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error deleting scheduled messages by template/contact:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to delete scheduled messages",
    });
  }
});

app.post(
  "/api/schedule-message/:companyId/:messageId/stop",
  async (req, res) => {
    const { companyId, messageId } = req.params;

    try {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const updateQuery = `
        UPDATE scheduled_messages 
        SET 
          status = 'stopped',
          stopped_at = NOW()
        WHERE id = $1 AND company_id = $2
        RETURNING id
      `;

        const result = await client.query(updateQuery, [messageId, companyId]);

        if (result.rowCount === 0) {
          return res.status(404).json({
            success: false,
            error: "Scheduled message not found",
          });
        }

        const updateBatchesQuery = `
        UPDATE scheduled_messages 
        SET 
          status = 'stopped',
          stopped_at = NOW()
        WHERE schedule_id = $1 
          AND company_id = $2
          AND status = 'scheduled'
      `;

        await client.query(updateBatchesQuery, [messageId, companyId]);

        await client.query("COMMIT");

        const queue = getQueueForBot(companyId);
        const jobs = await queue.getJobs(["waiting", "delayed", "active"]);

        for (const job of jobs) {
          if (job.data.messageId === messageId) {
            try {
              await job.remove();
              console.log(`Removed job ${job.id} for message ${messageId}`);
            } catch (err) {
              console.error(`Failed to remove job ${job.id}:`, err);
            }
          }
        }

        res.json({
          success: true,
          message: "Message stopped successfully",
        });
      } catch (error) {
        await safeRollback(client);
        throw error;
      } finally {
        await safeRelease(client);
      }
    } catch (error) {
      console.error("Error stopping message:", error);
      res.status(500).json({
        success: false,
        error: "Failed to stop message",
        details: error.message,
      });
    }
  }
);

// New route for syncing contacts
app.post("/api/sync-contacts/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const { phoneIndex } = req.body;

  try {
    const botData = botMap.get(companyId);
    if (!botData) {
      return res
        .status(404)
        .json({ error: "WhatsApp client not found for this company" });
    }

    let syncPromises = [];

    if (botData.length === 1) {
      const client = botData[0].client;
      if (!client) {
        return res
          .status(404)
          .json({ error: "WhatsApp client not found for this company" });
      }
      syncPromises.push(syncContacts(client, companyId, 0));
    } else if (phoneIndex !== undefined) {
      if (phoneIndex < 0 || phoneIndex >= botData.length) {
        return res.status(400).json({ error: "Invalid phone index" });
      }
      const client = botData[phoneIndex].client;
      if (!client) {
        return res.status(404).json({
          error: `WhatsApp client not found for phone index ${phoneIndex}`,
        });
      }
      syncPromises.push(syncContacts(client, companyId, phoneIndex));
    } else {
      syncPromises = botData
        .map((data, index) => {
          if (data.client) {
            return syncContacts(data.client, companyId, index);
          }
        })
        .filter(Boolean);
    }

    if (syncPromises.length === 0) {
      return res
        .status(404)
        .json({ error: "No valid WhatsApp clients found for synchronization" });
    }

    // Start syncing process for all applicable clients
    syncPromises.forEach((promise, index) => {
      promise
        .then(() => {
          console.log(
            `Contact synchronization completed for company ${companyId}, phone ${index}`
          );
        })
        .catch((error) => {
          console.error(
            `Error during contact sync for company ${companyId}, phone ${index}:`,
            error
          );
        });
    });

    res.json({
      success: true,
      message: "Contact synchronization started",
      phonesToSync: syncPromises.length,
    });
  } catch (error) {
    console.error(`Error starting contact sync for ${companyId}:`, error);
    res.status(500).json({ error: "Failed to start contact synchronization" });
  }
});

// New route for syncing only contact names for all contacts
app.post("/api/sync-contact-names/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const { phoneIndex } = req.body;

  try {
    const botData = botMap.get(companyId);
    if (!botData) {
      return res
        .status(404)
        .json({ error: "WhatsApp client not found for this company" });
    }

    let syncPromises = [];

    if (botData.length === 1) {
      const client = botData[0].client;
      if (!client) {
        return res
          .status(404)
          .json({ error: "WhatsApp client not found for this company" });
      }
      syncPromises.push(syncContactNames(client, companyId, 0));
    } else if (phoneIndex !== undefined) {
      if (phoneIndex < 0 || phoneIndex >= botData.length) {
        return res.status(400).json({ error: "Invalid phone index" });
      }
      const client = botData[phoneIndex].client;
      if (!client) {
        return res.status(404).json({
          error: `WhatsApp client not found for phone index ${phoneIndex}`,
        });
      }
      syncPromises.push(syncContactNames(client, companyId, phoneIndex));
    } else {
      syncPromises = botData
        .map((data, index) => {
          if (data.client) {
            return syncContactNames(data.client, companyId, index);
          }
        })
        .filter(Boolean);
    }

    if (syncPromises.length === 0) {
      return res
        .status(404)
        .json({ error: "No valid WhatsApp clients found for synchronization" });
    }

    // Start syncing process for all applicable clients
    syncPromises.forEach((promise, index) => {
      promise
        .then(() => {
          console.log(
            `Contact names synchronization completed for company ${companyId}, phone ${index}`
          );
        })
        .catch((error) => {
          console.error(
            `Error during contact names sync for company ${companyId}, phone ${index}:`,
            error
          );
        });
    });

    res.json({
      success: true,
      message: "Contact names synchronization started",
      phonesToSync: syncPromises.length,
    });
  } catch (error) {
    console.error(`Error starting contact names sync for ${companyId}:`, error);
    res.status(500).json({ error: "Failed to start contact names synchronization" });
  }
});

// New route for syncing single contact with messages
app.post("/api/sync-single-contact/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const { phoneIndex, contactPhone } = req.body;

  if (!contactPhone) {
    return res.status(400).json({ error: "Contact phone number is required" });
  }

  try {
    const botData = botMap.get(companyId);
    if (!botData) {
      return res
        .status(404)
        .json({ error: "WhatsApp client not found for this company" });
    }

    const selectedPhoneIndex = phoneIndex !== undefined ? phoneIndex : 0;

    if (selectedPhoneIndex < 0 || selectedPhoneIndex >= botData.length) {
      return res.status(400).json({ error: "Invalid phone index" });
    }

    const client = botData[selectedPhoneIndex].client;
    if (!client) {
      return res.status(404).json({
        error: `WhatsApp client not found for phone index ${selectedPhoneIndex}`,
      });
    }

    try {
      await syncSingleContact(client, companyId, contactPhone, selectedPhoneIndex);
      console.log(
        `Single contact synchronization completed for company ${companyId}, phone ${selectedPhoneIndex}, contact ${contactPhone}`
      );
      res.json({
        success: true,
        message: "Single contact synchronization finished",
        contactPhone,
        phoneIndex: selectedPhoneIndex,
      });
    } catch (error) {
      console.error(
        `Error during single contact sync for company ${companyId}, phone ${selectedPhoneIndex}, contact ${contactPhone}:`,
        error
      );
      res.status(500).json({ error: "Failed to sync single contact", details: error.message });
    }
  } catch (error) {
    console.error(`Error starting single contact sync for ${companyId}:`, error);
    res.status(500).json({ error: "Failed to start single contact synchronization" });
  }
});

// New route for syncing single contact name only
app.post("/api/sync-single-contact-name/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const { phoneIndex, contactPhone } = req.body;

  if (!contactPhone) {
    return res.status(400).json({ error: "Contact phone number is required" });
  }

  try {
    const botData = botMap.get(companyId);
    if (!botData) {
      return res
        .status(404)
        .json({ error: "WhatsApp client not found for this company" });
    }

    const selectedPhoneIndex = phoneIndex !== undefined ? phoneIndex : 0;

    if (selectedPhoneIndex < 0 || selectedPhoneIndex >= botData.length) {
      return res.status(400).json({ error: "Invalid phone index" });
    }

    const client = botData[selectedPhoneIndex].client;
    if (!client) {
      return res.status(404).json({
        error: `WhatsApp client not found for phone index ${selectedPhoneIndex}`,
      });
    }

    try {
      await syncSingleContactName(client, companyId, contactPhone, selectedPhoneIndex);
      console.log(
        `Single contact name synchronization completed for company ${companyId}, phone ${selectedPhoneIndex}, contact ${contactPhone}`
      );
      res.json({
        success: true,
        message: "Single contact name synchronization finished",
        contactPhone,
        phoneIndex: selectedPhoneIndex,
      });
    } catch (error) {
      console.error(
        `Error during single contact name sync for company ${companyId}, phone ${selectedPhoneIndex}, contact ${contactPhone}:`,
        error
      );
      res.status(500).json({ error: "Failed to sync single contact name", details: error.message });
    }
  } catch (error) {
    console.error(`Error starting single contact name sync for ${companyId}:`, error);
    res.status(500).json({ error: "Failed to start single contact name synchronization" });
  }
});

app.get("/api/search-messages/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const {
    query,
    contactId,
    dateFrom,
    dateTo,
    messageType,
    fromMe,
    page = 1,
    limit = 50,
  } = req.query;

  if (!query) {
    return res.status(400).json({ error: "Search query is required" });
  }

  // Build SQL WHERE conditions
  let whereClauses = ["company_id = $1", "content ILIKE $2"];
  let values = [companyId, `%${query}%`];
  let idx = 3;

  if (contactId) {
    whereClauses.push(`contact_id = $${idx++}`);
    values.push(contactId);
  }
  if (dateFrom) {
    whereClauses.push(`timestamp >= to_timestamp($${idx++})`);
    values.push(dateFrom);
  }
  if (dateTo) {
    whereClauses.push(`timestamp <= to_timestamp($${idx++})`);
    values.push(dateTo);
  }
  if (messageType) {
    whereClauses.push(`type = $${idx++}`);
    values.push(messageType);
  }
  if (fromMe !== undefined) {
    whereClauses.push(`from_me = $${idx++}`);
    values.push(fromMe === "true");
  }

  const offset = (page - 1) * limit;

  const whereSQL = whereClauses.length
    ? "WHERE " + whereClauses.join(" AND ")
    : "";

  try {
    // Get total count for pagination
    const countResult = await sqlDb.query(
      `SELECT COUNT(*) FROM messages ${whereSQL}`,
      values
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Get paginated results
    const resultsResult = await sqlDb.query(
      `
      SELECT * FROM messages
      ${whereSQL}
      ORDER BY timestamp DESC
      LIMIT $${idx++} OFFSET $${idx}
      `,
      [...values, limit, offset]
    );

    res.json({
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      results: resultsResult.rows,
    });
  } catch (error) {
    console.error("Error searching messages:", error);
    res.status(500).json({ error: "Failed to search messages" });
  }
});

app.get("/api/stats/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const { employeeId } = req.query;
  const monthKey = getCurrentMonthKey();

  if (!employeeId) {
    return res.status(400).json({ error: "Employee ID is required" });
  }

  try {
    const employeeQuery = `
      SELECT id, name, role, weightages
      FROM employees 
      WHERE employee_id = $1 AND company_id = $2
    `;
    const employeeResult = await pool.query(employeeQuery, [employeeId, companyId]);

    if (employeeResult.rows.length === 0) {
      return res.status(400).json({ error: "No employee found with the given ID" });
    }

    const employee = employeeResult.rows[0];

    const stats = {
      employeeName: employee.name,
      employeeRole: employee.role,
      conversationsAssigned: 0,
      outgoingMessagesSent: 0,
      averageResponseTime: 0,
      closedContacts: 0,
      currentMonthAssignments: 0,
      weightageUsed: employee.weightages || {},
      phoneAssignments: {},
      responseTimes: [],
      medianResponseTime: [],
    };

    const assignmentsQuery = `
      SELECT COUNT(*) as count
      FROM assignments
      WHERE employee_id = $1 
        AND company_id = $2
        AND month_key = $3
    `;
    const assignmentsResult = await pool.query(assignmentsQuery, [
      employeeId, 
      companyId,
      monthKey
    ]);
    stats.currentMonthAssignments = parseInt(assignmentsResult.rows[0].count) || 0;

    const assignedContactsQuery = `
      SELECT a.contact_id, c.tags
      FROM assignments a
      LEFT JOIN contacts c ON a.contact_id = c.contact_id AND a.company_id = c.company_id
      WHERE a.employee_id = $1 AND a.company_id = $2
    `;
    const assignedContactsResult = await pool.query(assignedContactsQuery, [employeeId, companyId]);
    stats.conversationsAssigned = assignedContactsResult.rows.length;

    if (assignedContactsResult.rows.length === 0) {
      return res.json(stats);
    }

    const closedContacts = assignedContactsResult.rows.filter(row => {
      try {
        const tags = row.tags || [];
        return tags.includes('closed');
      } catch (e) {
        return false;
      }
    });
    stats.closedContacts = closedContacts.length;

    let totalResponseTime = 0;
    let responseCount = 0;
    let outgoingMessages = 0;

    for (const row of assignedContactsResult.rows) {
      const contactId = row.contact_id;

      const messagesQuery = `
        SELECT timestamp, from_me
        FROM messages
        WHERE company_id = $1 AND contact_id = $2
        ORDER BY timestamp ASC
      `;
      const messagesResult = await pool.query(messagesQuery, [companyId, contactId]);

      outgoingMessages += messagesResult.rows.filter(msg => msg.from_me).length;

      let firstAgentMessageTime = null;
      let firstCustomerMessageTime = null;

      for (const message of messagesResult.rows) {
        const timestamp = new Date(message.timestamp).getTime();
        
        if (message.from_me) {
          if (!firstAgentMessageTime) {
            firstAgentMessageTime = timestamp;
          }
        } else if (!firstCustomerMessageTime) {
          firstCustomerMessageTime = timestamp;
        }

        if (firstAgentMessageTime && firstCustomerMessageTime) {
          const responseTime = Math.abs(firstAgentMessageTime - firstCustomerMessageTime);
          stats.responseTimes.push({
            contactId,
            responseTime,
            timestamp: message.timestamp
          });
          totalResponseTime += responseTime;
          responseCount++;
          break;
        }
      }
    }

    stats.outgoingMessagesSent = outgoingMessages;
    
    if (responseCount > 0) {
      stats.averageResponseTime = Math.floor(totalResponseTime / responseCount);
      
      const sortedTimes = stats.responseTimes.map(rt => rt.responseTime).sort((a, b) => a - b);
      const mid = Math.floor(sortedTimes.length / 2);
      stats.medianResponseTime = sortedTimes.length % 2 !== 0 
        ? sortedTimes[mid] 
        : (sortedTimes[mid - 1] + sortedTimes[mid]) / 2;
    }

    const metricsQuery = `
      SELECT 
        phone_index,
        COUNT(*) as assignment_count
      FROM assignments
      WHERE employee_id = $1 
        AND company_id = $2
        AND month_key = $3
      GROUP BY phone_index
    `;
    const metricsResult = await pool.query(metricsQuery, [
      employeeId, 
      companyId,
      monthKey
    ]);

    metricsResult.rows.forEach(row => {
      stats.phoneAssignments[`phone${row.phone_index}`] = parseInt(row.assignment_count) || 0;
    });

    res.json(stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ 
      error: "Failed to fetch stats",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Helper function
function getCurrentMonthKey() {
  const date = new Date();
  const month = date.toLocaleString('default', { month: 'short' });
  const year = date.getFullYear();
  return `${month}-${year}`;
}

// ... existing code ...

function mapFirestoreContactToNeon(contact, companyId) {
  // Fix timestamp handling for last_message
  if (contact.last_message && contact.last_message.timestamp) {
    const timestamp = contact.last_message.timestamp;
    let timestampMs;
    
    // Handle different timestamp formats
    if (typeof timestamp === 'string') {
      // Try to parse as ISO string first
      const parsedDate = new Date(timestamp);
      if (!isNaN(parsedDate.getTime())) {
        timestampMs = parsedDate.getTime();
      } else {
        // If it's an invalid string, use current time
        timestampMs = Date.now();
      }
    } else if (typeof timestamp === 'number') {
      // Check if it's seconds or milliseconds
      timestampMs = timestamp < 1000000000000 ? timestamp * 1000 : timestamp;
    } else {
      // Fallback to current time
      timestampMs = Date.now();
    }
    
    const messageDate = new Date(timestampMs);
    const now = new Date();
    
    // If timestamp is in the future or invalid, use current time
    if (messageDate > now || isNaN(messageDate.getTime())) {
      timestampMs = Date.now();
    }
    
    // Update the timestamp in the contact data
    contact.last_message.timestamp = timestampMs;
  }
  
  // Handle customFields properly
  let customFieldsJson = null;
  if (contact.customFields) {
    // If customFields is already an object, stringify it
    if (typeof contact.customFields === 'object' && contact.customFields !== null) {
      customFieldsJson = JSON.stringify(contact.customFields);
    } else if (typeof contact.customFields === 'string') {
      // If it's already a string, use it as is
      customFieldsJson = contact.customFields;
    }
  }
  
// ... existing code ...
return {
  contact_id: companyId + "-" + contact.phone.split("+")[1] || null,
  company_id: companyId,
  name: contact.name || contact.contactName || null,
  contact_name: contact.contactName || contact.name || null,
  phone: contact.phone || null,
  email: contact.email || null,
  phone_index: contact.phoneIndex || 0,
  chat_id: contact.chat_id || contact.id || null,
  tags: JSON.stringify(contact.tags || []),
  unread_count: contact.unreadCount || 0,
  last_message: contact.last_message ? JSON.stringify({
    ...contact.last_message,
    phone_index: contact.last_message.phoneIndex || 0,
    timestamp: contact.last_message.timestamp
  }) : null,
  profile_pic_url: contact.profilePicUrl || null,
  not_spam: contact.not_spam || false,
  pinned: contact.pinned || false,
  address1: contact.address1 || null,
  assigned_to: contact.assignedTo || null,
  business_id: contact.businessId || null,
  thread_id: contact.threadid || contact.thread_id || null,
  branch: contact.branch || null,
  expiry_date: contact.expiryDate || null,
  vehicle_number: contact.vehicleNumber || null,
  ic: contact.ic || null,
  lead_number: contact.leadNumber || null,
  custom_fields: customFieldsJson,
  created_at: new Date(),
  updated_at: new Date(),
};
// ... existing code ...
}
// ... existing code ...

function mapFirestoreMessageToNeon(msg, companyId, contactId) {

  
  // Fix timestamp handling for messages
  let messageTimestamp;
  
  if (msg.timestamp) {
    if (typeof msg.timestamp === 'string') {
      // Try to parse as ISO string first
      const parsedDate = new Date(msg.timestamp);
      if (!isNaN(parsedDate.getTime())) {
        messageTimestamp = parsedDate;
      } else {
        // If it's an invalid string, use current time
        messageTimestamp = new Date();
      }
    } else if (typeof msg.timestamp === 'number') {
      // Check if it's seconds or milliseconds
      const timestampMs = msg.timestamp < 1000000000000 ? msg.timestamp * 1000 : msg.timestamp;
      messageTimestamp = new Date(timestampMs);
    } else {
      // Fallback to current time
      messageTimestamp = new Date();
    }
    
    // Validate the timestamp
    if (isNaN(messageTimestamp.getTime()) || messageTimestamp > new Date()) {
      messageTimestamp = new Date();
    }
  } else {
    messageTimestamp = new Date();
  }

  // Handle different message types and extract content appropriately
  let content = "";
  let mediaUrl = null;
  let mediaData = null;
  let mediaMetadata = null;
  let messageType = msg.type || "text";

  // Handle image messages - check multiple possible structures
  if (msg.type === "image") {
   
    
    // Check if image data is in msg.image object
    if (msg.image) {
     
      content = msg.image.caption || "";
      mediaUrl = msg.image.data || null;
      mediaData = msg.image.data || null;
      mediaMetadata = {
        filename: msg.image.filename || "",
        height: msg.image.height || null,
        width: msg.image.width || null,
        mimetype: msg.image.mimetype || "image/jpeg",
        mediaKey: msg.image.mediaKey || null
      };
    }
    // Check if image data is directly in msg
    else if (msg.data) {
     // console.log(`Found image data directly in msg.data`);
      content = msg.caption || "";
      mediaUrl = msg.data || null;
      mediaData = msg.data || null;
      mediaMetadata = {
        filename: msg.filename || "",
        height: msg.height || null,
        width: msg.width || null,
        mimetype: msg.mimetype || "image/jpeg",
        mediaKey: msg.mediaKey || null
      };
    }
    // Check if image data is in msg.text (some structures have this)
    else if (msg.text && msg.text.data) {
      //console.log(`Found image data in msg.text.data`);
      content = msg.text.body || "";
      mediaUrl = msg.text.data || null;
      mediaData = msg.text.data || null;
      mediaMetadata = {
        filename: msg.text.filename || "",
        height: msg.text.height || null,
        width: msg.text.width || null,
        mimetype: msg.text.mimetype || "image/jpeg",
        mediaKey: msg.text.mediaKey || null
      };
    }
    // If no image data found, treat as text with image type
    else {
     // console.log(`No image data found, treating as text with image type`);
      content = msg.text?.body || msg.body || "";
      messageType = "text"; // Change to text since no media data
    }
    messageType = "image";
  }
  // Handle document messages
  else if (msg.type === "document") {
   // console.log(`Processing document message: ${msg.id}`);
    
    if (msg.document) {
     // console.log(`Found document data in msg.document:`, msg.document);
      content = msg.document.caption || "";
      mediaUrl = msg.document.data || null;
      mediaData = msg.document.data || null;
      mediaMetadata = {
        filename: msg.document.filename || "",
        mimetype: msg.document.mimetype || "application/octet-stream",
        mediaKey: msg.document.mediaKey || null
      };
    } else if (msg.data) {
      //console.log(`Found document data directly in msg.data`);
      content = msg.caption || "";
      mediaUrl = msg.data || null;
      mediaData = msg.data || null;
      mediaMetadata = {
        filename: msg.filename || "",
        mimetype: msg.mimetype || "application/octet-stream",
        mediaKey: msg.mediaKey || null
      };
    } else {
      //console.log(`No document data found, treating as text with document type`);
      content = msg.text?.body || msg.body || "";
      messageType = "text"; // Change to text since no media data
    }
    messageType = "document";
  }
  // Handle video messages
  else if (msg.type === "video") {
   // console.log(`Processing video message: ${msg.id}`);
    
    if (msg.video) {
    //  console.log(`Found video data in msg.video:`, msg.video);
      content = msg.video.caption || "";
      mediaUrl = msg.video.data || null;
      mediaData = msg.video.data || null;
      mediaMetadata = {
        filename: msg.video.filename || "",
        height: msg.video.height || null,
        width: msg.video.width || null,
        mimetype: msg.video.mimetype || "video/mp4",
        mediaKey: msg.video.mediaKey || null
      };
    } else if (msg.data) {
     // console.log(`Found video data directly in msg.data`);
      content = msg.caption || "";
      mediaUrl = msg.data || null;
      mediaData = msg.data || null;
      mediaMetadata = {
        filename: msg.filename || "",
        height: msg.height || null,
        width: msg.width || null,
        mimetype: msg.mimetype || "video/mp4",
        mediaKey: msg.mediaKey || null
      };
    } else {
     // console.log(`No video data found, treating as text with video type`);
      content = msg.text?.body || msg.body || "";
      messageType = "text"; // Change to text since no media data
    }
    messageType = "video";
  }
  // Handle audio messages
  else if (msg.type === "audio") {
    // console.log(`Processing audio message: ${msg.id}`);
    
    if (msg.audio) {
     // console.log(`Found audio data in msg.audio:`, msg.audio);
      content = msg.audio.caption || "";
      mediaUrl = msg.audio.data || null;
      mediaData = msg.audio.data || null;
      mediaMetadata = {
        filename: msg.audio.filename || "",
        mimetype: msg.audio.mimetype || "audio/ogg",
        mediaKey: msg.audio.mediaKey || null
      };
    } else if (msg.data) {
     // console.log(`Found audio data directly in msg.data`);
      content = msg.caption || "";
      mediaUrl = msg.data || null;
      mediaData = msg.data || null;
      mediaMetadata = {
        filename: msg.filename || "",
        mimetype: msg.mimetype || "audio/ogg",
        mediaKey: msg.mediaKey || null
      };
    } else {
     // console.log(`No audio data found, treating as text with audio type`);
      content = msg.text?.body || msg.body || "";
      messageType = "text"; // Change to text since no media data
    }
    messageType = "audio";
  }
  // Handle text messages
  else {
    content = msg.text?.body || msg.body || "";
    messageType = "text";
  }
 
  
  return {
    message_id: msg.id || msg.message_id || null,
    company_id: companyId,
    contact_id: contactId,
    content: content,
    message_type: messageType,
    media_url: mediaUrl,
    media_data: mediaData,
    media_metadata: mediaMetadata ? JSON.stringify(mediaMetadata) : null,
    timestamp: messageTimestamp,
    direction: msg.from_me ? "outbound" : "inbound",
    status: msg.status || "delivered",
    from_me: msg.from_me || false,
    chat_id: msg.chat_id || null,
    author: msg.author || null,
    phone_index: msg.phoneIndex || 0,
    quoted_message: msg.quoted_message ? JSON.stringify(msg.quoted_message) : null,
    thread_id: msg.threadid || msg.thread_id || null,
    customer_phone: msg.customer_phone || null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

// ... existing code ...

// ... existing code ...
// ... existing code ...

// ... existing code ...

function mapFirestorePrivateNoteToNeon(note, companyId, contactId) {
  // Fix timestamp handling for private notes
  let noteTimestamp;
  
  if (note.timestamp || note.createdAt) {
    const timestamp = note.timestamp || note.createdAt;
    
    if (typeof timestamp === 'string') {
      // Try to parse as ISO string first
      const parsedDate = new Date(timestamp);
      if (!isNaN(parsedDate.getTime())) {
        noteTimestamp = parsedDate;
      } else {
        // If it's an invalid string, use current time
        noteTimestamp = new Date();
      }
    } else if (typeof timestamp === 'number') {
      // Check if it's seconds or milliseconds
      const timestampMs = timestamp < 1000000000000 ? timestamp * 1000 : timestamp;
      noteTimestamp = new Date(timestampMs);
    } else {
      // Fallback to current time
      noteTimestamp = new Date();
    }
    
    // Validate the timestamp
    if (isNaN(noteTimestamp.getTime()) || noteTimestamp > new Date()) {
      noteTimestamp = new Date();
    }
  } else {
    noteTimestamp = new Date();
  }
  
  return {
    id: note.id || uuidv4(),
    company_id: companyId,
    contact_id: contactId,
    text: note.text?.body || note.text || "",
    from: note.from || note.from_name || null,
    from_email: note.fromEmail || null,
    timestamp: noteTimestamp,
    type: "privateNote",
    created_at: new Date(),
    updated_at: new Date(),
  };
}

// ... existing code ...

// ... existing code ...
async function syncContactsFromFirebaseToNeon(companyId, phoneIndex = 0) {
  console.log(`=== Starting Firebase to Neon sync for company: ${companyId}, phone: ${phoneIndex} ===`);
  
  try {
    const contactsRef = db.collection("companies").doc(companyId).collection("contacts");
    const contactsSnapshot = await contactsRef.get();
    console.log(`Found ${contactsSnapshot.docs.length} contacts in Firestore`);

    let processedContacts = 0;
    let processedMessages = 0;
    let processedPrivateNotes = 0;
    let errors = [];

    // Process contacts in batches of 10 concurrently
    const batchSize = 10;
    const contactBatches = [];
    
    for (let i = 0; i < contactsSnapshot.docs.length; i += batchSize) {
      contactBatches.push(contactsSnapshot.docs.slice(i, i + batchSize));
    }

    for (let batchIndex = 0; batchIndex < contactBatches.length; batchIndex++) {
      const batch = contactBatches[batchIndex];
      console.log(`Processing batch ${batchIndex + 1}/${contactBatches.length} (${batch.length} contacts)`);
      
      // Process contacts in current batch concurrently
      const contactPromises = batch.map(async (doc) => {
        try {
          const contact = doc.data();
          let contactId = contact.contact_id || contact.id || doc.id;
          if (!contactId) {
            console.warn(`Skipping contact with missing contact_id. Firestore doc ID: ${doc.id}`);
            errors.push({ type: 'missing_contact_id', docId: doc.id });
            return { processed: false };
          }
          
          const neonContact = mapFirestoreContactToNeon(contact, companyId);
          console.log(`---> Syncing contact: ${neonContact.contact_id} (Firestore doc ID: ${doc.id})`);

          if (!neonContact.contact_id || !neonContact.company_id) {
            console.warn(`Skipping contact with missing required fields. contact_id: ${neonContact.contact_id}, company_id: ${neonContact.company_id}`);
            errors.push({ type: 'missing_required_fields', contactId, neonContact });
            return { processed: false };
          }

          // Upsert contact
          const contactFields = Object.keys(neonContact);
          const contactValues = Object.values(neonContact);
          const contactPlaceholders = contactFields.map((_, i) => `$${i + 1}`);
          const contactUpdateSet = contactFields
            .filter(f => f !== "contact_id" && f !== "company_id" && f !== "created_at" && f !== "updated_at")
            .map(f => `${f} = EXCLUDED.${f}`)
            .join(", ");

          const contactQuery = `
            INSERT INTO contacts (${contactFields.join(", ")})
            VALUES (${contactPlaceholders.join(", ")})
            ON CONFLICT (contact_id, company_id) DO UPDATE SET
            ${contactUpdateSet}${contactUpdateSet ? ', ' : ''}updated_at = CURRENT_TIMESTAMP
          `;
          await sqlDb.query(contactQuery, contactValues);
          
          // Fetch and upsert messages for this contact
          const messagesRef = contactsRef.doc(doc.id).collection("messages");
          const messagesSnapshot = await messagesRef.get();
          
          // Limit to 50 messages max per contact
          const limitedMessages = messagesSnapshot.docs.slice(0, 50);
          
          if (limitedMessages.length > 0) {
            // Process messages in smaller batches of 10 concurrently
            const messageBatchSize = 10;
            const messageBatches = [];
            
            for (let j = 0; j < limitedMessages.length; j += messageBatchSize) {
              messageBatches.push(limitedMessages.slice(j, j + messageBatchSize));
            }
            
            for (const messageBatch of messageBatches) {
              const messagePromises = messageBatch.map(async (msgDoc) => {
                try {
                  const msg = msgDoc.data();
                  
                  // Handle private notes separately
                  if (msg.type === "privateNote") {
                    const neonNote = mapFirestorePrivateNoteToNeon(msg, companyId, neonContact.contact_id);
                    
                    if (!neonNote.id || !neonNote.company_id || !neonNote.contact_id) {
                      console.warn(`  Skipping private note with missing required fields. id: ${neonNote.id}, company_id: ${neonNote.company_id}, contact_id: ${neonNote.contact_id}`);
                      errors.push({ type: 'missing_private_note_fields', msgDocId: msgDoc.id });
                      return { processed: false };
                    }

                    // Upsert private note
                    const noteFields = Object.keys(neonNote);
                    const noteValues = Object.values(neonNote);
                    const notePlaceholders = noteFields.map((_, i) => `$${i + 1}`);
                    const noteUpdateSet = noteFields
                      .filter(f => f !== "id" && f !== "company_id" && f !== "created_at" && f !== "updated_at")
                      .map(f => `${f} = EXCLUDED.${f}`)
                      .join(", ");
                  
                    const noteQuery = `
                      INSERT INTO private_notes (${noteFields.join(", ")})
                      VALUES (${notePlaceholders.join(", ")})
                      ON CONFLICT (id) DO UPDATE SET
                      ${noteUpdateSet}${noteUpdateSet ? ', ' : ''}updated_at = CURRENT_TIMESTAMP
                    `;
                    await sqlDb.query(noteQuery, noteValues);
                    
                    // Also insert as a message for compatibility
                    const neonMsg = mapFirestoreMessageToNeon(msg, companyId, neonContact.contact_id);
                    const msgFields = Object.keys(neonMsg).filter(f => f !== "updated_at");
                    const msgValues = msgFields.map(f => neonMsg[f]);
                    const msgPlaceholders = msgFields.map((_, i) => `$${i + 1}`);
                    const msgUpdateSet = msgFields
                      .filter(f => f !== "message_id" && f !== "company_id" && f !== "created_at")
                      .map(f => `${f} = EXCLUDED.${f}`)
                      .join(", ");
                  
                    const msgQuery = `
                      INSERT INTO messages (${msgFields.join(", ")})
                      VALUES (${msgPlaceholders.join(", ")})
                      ON CONFLICT (message_id, company_id) DO UPDATE SET
                      ${msgUpdateSet}
                    `;
                    await sqlDb.query(msgQuery, msgValues);
                    
                    return { processed: true, type: 'private_note' };
                  } else {
                    // Handle regular messages
                    const neonMsg = mapFirestoreMessageToNeon(msg, companyId, neonContact.contact_id);

                    if (!neonMsg.message_id || !neonMsg.company_id || !neonMsg.contact_id) {
                      console.warn(`  Skipping message with missing required fields. message_id: ${neonMsg.message_id}, company_id: ${neonMsg.company_id}, contact_id: ${neonMsg.contact_id}`);
                      errors.push({ type: 'missing_message_fields', msgDocId: msgDoc.id });
                      return { processed: false };
                    }

                    // Remove updated_at from both fields and values for messages
                    const msgFields = Object.keys(neonMsg).filter(f => f !== "updated_at");
                    const msgValues = msgFields.map(f => neonMsg[f]);
                    const msgPlaceholders = msgFields.map((_, i) => `$${i + 1}`);
                    const msgUpdateSet = msgFields
                      .filter(f => f !== "message_id" && f !== "company_id" && f !== "created_at")
                      .map(f => `${f} = EXCLUDED.${f}`)
                      .join(", ");
                  
                    const msgQuery = `
                      INSERT INTO messages (${msgFields.join(", ")})
                      VALUES (${msgPlaceholders.join(", ")})
                      ON CONFLICT (message_id, company_id) DO UPDATE SET
                      ${msgUpdateSet}
                    `;
                    await sqlDb.query(msgQuery, msgValues);
                    return { processed: true, type: 'message' };
                  }
                  
                } catch (msgError) {
                  console.error(`  Error processing message ${msgDoc.id}: ${msgError.message}`);
                  errors.push({ type: 'message_error', msgDocId: msgDoc.id, error: msgError.message });
                  return { processed: false };
                }
              });
              
              // Wait for current message batch to complete
              const messageResults = await Promise.all(messagePromises);
              processedMessages += messageResults.filter(r => r.processed && r.type === 'message').length;
              processedPrivateNotes += messageResults.filter(r => r.processed && r.type === 'private_note').length;
              
              // Small delay between message batches
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
          
          return { processed: true };
          
        } catch (contactError) {
          console.error(`Error processing contact ${doc.id}: ${contactError.message}`);
          errors.push({ type: 'contact_error', docId: doc.id, error: contactError.message });
          return { processed: false };
        }
      });
      
      // Wait for current contact batch to complete
      const contactResults = await Promise.all(contactPromises);
      processedContacts += contactResults.filter(r => r.processed).length;
      
      // Small delay between contact batches
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`=== Sync Summary ===`);
    console.log(`Processed: ${processedContacts} contacts, ${processedMessages} messages, ${processedPrivateNotes} private notes`);
    if (errors.length > 0) {
      console.warn(`Encountered ${errors.length} errors. See above for details.`);
    } else {
      console.log(`No errors encountered.`);
    }

    return {
      success: true,
      processedContacts,
      processedMessages,
      processedPrivateNotes,
      errors
    };

  } catch (error) {
    console.error(`Fatal sync error: ${error.message}`);
    throw error;
  }
}
// ... existing code ...

// ... existing code ...

// ... existing code ...
app.post("/api/sync-firebase-to-neon/:companyId", async (req, res) => {
  const { companyId } = req.params;
  try {
    await syncContactsFromFirebaseToNeon(companyId);
    res.json({ success: true, message: "Contacts and messages synced from Firebase to Neon." });
  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});
async function syncContacts(client, companyId, phoneIndex = 0) {
  try {
    const chats = await client.getChats();
    console.log(
      `Found ${chats.length} chats for company ${companyId}, phone ${phoneIndex}. Processing all chats.`
    );

    for (const chat of chats) {
      try {
        const contact = await chat.getContact();
        const contactPhone = contact.id.user;
        const contactID = `${companyId}-${contactPhone}`;

        const profilePicUrl = await contact.getProfilePicUrl();

        // Upsert contact
        const contactQuery = `
          INSERT INTO public.contacts (
            contact_id, company_id, name, phone, tags, unread_count, created_at, last_updated, 
            chat_data, company, chat_id, last_message, profile_pic_url
          ) VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, NOW(), NOW(), $6, $7, $8, '{}'::jsonb, $9)
          ON CONFLICT (contact_id, company_id) DO UPDATE SET
            last_updated = NOW(),
            profile_pic_url = EXCLUDED.profile_pic_url,
            unread_count = EXCLUDED.unread_count,
            last_message = EXCLUDED.last_message,
            chat_data = EXCLUDED.chat_data;
        `;
        await sqlDb.query(contactQuery, [
          contactID,
          companyId,
          contact.name || contact.pushname || contact.shortName || contactPhone,
          contactPhone,
          chat.unreadCount,
          JSON.stringify(chat),
          contact.name,
          chat.id._serialized,
          profilePicUrl,
        ]);

        // Fetch and insert messages using the same method as addMessageToPostgres
        const messages = await chat.fetchMessages();
        let lastMessage = null;

        for (const msg of messages) {
          try {
            // Use the same comprehensive message saving as addMessageToPostgres
            const basicInfo = await extractBasicMessageInfo(msg);
            const messageData = await prepareMessageData(msg, companyId, phoneIndex);

            // Get message body (with audio transcription if applicable)
            let messageBody = messageData.text?.body || "";
            if (msg.hasMedia && (msg.type === "audio" || msg.type === "ptt")) {
              console.log("Voice message detected during sync");
              try {
                const media = await msg.downloadMedia();
                const transcription = await transcribeAudio(media.data);
                if (transcription && transcription !== "Audio transcription failed. Please try again.") {
                  messageBody += transcription;
                } else {
                  messageBody += "Audio message";
                }
              } catch (error) {
                console.error("Error transcribing audio during sync:", error);
                messageBody += "Audio message";
              }
            }

            // Prepare media data
            let mediaUrl = null;
            let mediaData = null;
            let mediaMetadata = {};

            if (msg.hasMedia) {
              if (msg.type === "video") {
                mediaUrl = messageData.video?.link || null;
              } else if (msg.type !== "audio" && msg.type !== "ptt") {
                const mediaTypeData = messageData[msg.type];
                if (mediaTypeData) {
                  mediaData = mediaTypeData.data || null;
                  mediaUrl = mediaTypeData.link || null;
                  mediaMetadata = {
                    mimetype: mediaTypeData.mimetype,
                    filename: mediaTypeData.filename || "",
                    caption: mediaTypeData.caption || "",
                    thumbnail: mediaTypeData.thumbnail || null,
                    mediaKey: mediaTypeData.media_key || null,
                    ...(msg.type === "image" && {
                      width: mediaTypeData.width,
                      height: mediaTypeData.height
                    }),
                    ...(msg.type === "document" && {
                      pageCount: mediaTypeData.page_count,
                      fileSize: mediaTypeData.file_size
                    })
                  };
                }
              } else if (msg.type === "audio" || msg.type === "ptt") {
                mediaData = messageData.audio?.data || null;
              }
            }

            // Prepare quoted message
            const quotedMessage = messageData.text?.context || null;

            // Determine author
            let author = null;
            if (msg.from.includes("@g.us") && basicInfo.author) {
              const authorData = await getContactDataFromDatabaseByPhone(basicInfo.author, companyId);
              author = authorData ? authorData.contactName : basicInfo.author;
            }

            const messageQuery = `
              INSERT INTO public.messages (
                message_id, company_id, contact_id, content, message_type,
                media_url, media_data, media_metadata, timestamp, direction,
                status, from_me, chat_id, author, phone_index, quoted_message,
                thread_id, customer_phone
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
              ON CONFLICT (message_id, company_id) DO NOTHING;
            `;

            await sqlDb.query(messageQuery, [
              basicInfo.idSerialized,
              companyId,
              contactID,
              messageBody,
              basicInfo.type,
              mediaUrl,
              mediaData,
              Object.keys(mediaMetadata).length > 0 ? JSON.stringify(mediaMetadata) : null,
              new Date(basicInfo.timestamp * 1000),
              msg.fromMe ? "outbound" : "inbound",
              "delivered",
              msg.fromMe || false,
              msg.from,
              author || contactID,
              phoneIndex,
              quotedMessage ? JSON.stringify(quotedMessage) : null,
              msg.to,
              contactPhone
            ]);

            // Keep track of the most recent message for last_message
            if (!lastMessage || basicInfo.timestamp > lastMessage.timestamp) {
              lastMessage = {
                chat_id: basicInfo.chatId,
                from: basicInfo.from,
                from_me: basicInfo.fromMe,
                id: basicInfo.idSerialized,
                phoneIndex: phoneIndex,
                source: basicInfo.deviceType,
                status: "delivered",
                text: { body: messageBody },
                timestamp: basicInfo.timestamp,
                type: basicInfo.type
              };
            }
          } catch (error) {
            console.error(`Error processing message ${msg.id._serialized} during sync:`, error);
          }
        }

        // Update contact with the actual last message
        if (lastMessage) {
          const updateContactQuery = `
            UPDATE public.contacts SET
              last_message = $1,
              last_updated = NOW()
            WHERE contact_id = $2 AND company_id = $3;
          `;
          await sqlDb.query(updateContactQuery, [
            JSON.stringify(lastMessage),
            contactID,
            companyId,
          ]);
        }
      } catch (error) {
        console.error(`Error processing chat ${chat.id._serialized}:`, error);
      }
    }

    console.log(
      `Finished syncing contacts for company ${companyId}, phone ${phoneIndex}`
    );
  } catch (error) {
    console.error(
      `Error syncing contacts for company ${companyId}, phone ${phoneIndex}:`,
      error
    );
  }
}

async function syncContactNames(client, companyId, phoneIndex = 0) {
  try {
    const chats = await client.getChats();
    console.log(
      `Found ${chats.length} chats for company ${companyId}, phone ${phoneIndex}. Syncing contact names only.`
    );

    for (const chat of chats) {
      try {
        const contact = await chat.getContact();
        const contactPhone = contact.id.user;
        const contactID = `${companyId}-${contactPhone}`;

        const profilePicUrl = await contact.getProfilePicUrl();

        const potentialName = contact.name || contact.pushname || contact.shortName || contactPhone;
        
        // Function to check if a string is just a phone number
        function isJustPhoneNumber(str) {
          if (!str) return false;
          const cleanStr = str.replace(/[\s\-\(\)\+]/g, '');
          return /^[\+]?\d+$/.test(cleanStr);
        }
        
        // Function to check if name contains both text and numbers (mixed content)
        function hasMixedContent(str) {
          if (!str) return false;
          const hasLetters = /[a-zA-Z]/.test(str);
          const hasNumbers = /\d/.test(str);
          return hasLetters && hasNumbers;
        }
        
        let shouldSaveName = false;
        let nameToSave = potentialName;
        
        if (isJustPhoneNumber(potentialName)) {
          console.log(`Skipping name sync for ${contactID} - name is just a phone number: ${potentialName}`);
          shouldSaveName = false;
        } else if (hasMixedContent(potentialName)) {
          shouldSaveName = true;
        } else if (potentialName !== contactPhone) {
          shouldSaveName = true;
        }

        if (shouldSaveName) {
          const contactQuery = `
            UPDATE public.contacts SET
              name = $1,
              last_updated = NOW(),
              profile_pic_url = $2
            WHERE contact_id = $3 AND company_id = $4;
          `;
          
          const result = await sqlDb.query(contactQuery, [
            nameToSave,
            profilePicUrl,
            contactID,
            companyId,
          ]);

          if (result.rowCount === 0) {
            console.log(`Contact ${contactID} not found in database, skipping name sync`);
          } else {
            console.log(`Updated name for ${contactID}: ${nameToSave}`);
          }
        } else {
          const profileQuery = `
            UPDATE public.contacts SET
              last_updated = NOW(),
              profile_pic_url = $1
            WHERE contact_id = $2 AND company_id = $3;
          `;
          
          await sqlDb.query(profileQuery, [
            profilePicUrl,
            contactID,
            companyId,
          ]);
        }

      } catch (error) {
        console.error(`Error processing contact name for chat ${chat.id._serialized}:`, error);
      }
    }

    console.log(
      `Finished syncing contact names for company ${companyId}, phone ${phoneIndex}`
    );
  } catch (error) {
    console.error(
      `Error syncing contact names for company ${companyId}, phone ${phoneIndex}:`,
      error
    );
  }
}

async function syncSingleContact(client, companyId, contactPhone, phoneIndex = 0) {
  try {
    console.log(
      `Syncing single contact ${contactPhone} for company ${companyId}, phone ${phoneIndex}`
    );

    const phoneWithPlus = contactPhone.startsWith("+") ? contactPhone : `+${contactPhone}`;
    const phoneWithoutPlus = contactPhone.startsWith("+") ? contactPhone.slice(1) : contactPhone;
    const chatId = `${phoneWithoutPlus}@c.us`;
    
    try {
      const sync = await client.syncHistory(chatId);
      if (sync){
        console.log('Synced Chat ID history');
      } else {
        console.log('Sync Failed');
      }
      const chat = await client.getChatById(chatId);
      const contact = await chat.getContact();
      const contactID = `${companyId}-${phoneWithoutPlus}`;

      const profilePicUrl = await contact.getProfilePicUrl();

      // Upsert contact
      const contactQuery = `
        INSERT INTO public.contacts (
          contact_id, company_id, name, phone, tags, unread_count, created_at, last_updated, 
          chat_data, company, chat_id, last_message, profile_pic_url
        ) VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, NOW(), NOW(), $6, $7, $8, '{}'::jsonb, $9)
        ON CONFLICT (contact_id, company_id) DO UPDATE SET
          last_updated = NOW(),
          profile_pic_url = EXCLUDED.profile_pic_url,
          unread_count = EXCLUDED.unread_count,
          chat_data = EXCLUDED.chat_data,
          chat_id = EXCLUDED.chat_id,
          last_message = EXCLUDED.last_message;
      `;
      await sqlDb.query(contactQuery, [
        contactID,
        companyId,
        contact.name || contact.pushname || contact.shortName || contactPhone,
        phoneWithPlus,
        chat.unreadCount,
        JSON.stringify(chat),
        contact.name,
        chat.id._serialized,
        profilePicUrl,
      ]);

      // Fetch and insert messages using the same method as addMessageToPostgres
      const messages = await chat.fetchMessages(); // Fetch more messages for single contact
      let lastMessage = null;

      const totalMessages = messages.length;
      console.log(`Found ${totalMessages} messages for contact ${contactPhone} in company ${companyId}, phone ${phoneIndex}`);
      let processedMessages = 0;
      let lastProgress = 0;

      for (const msg of messages) {
        try {
          // Use the same comprehensive message saving as addMessageToPostgres
          const basicInfo = await extractBasicMessageInfo(msg);
          const messageData = await prepareMessageData(msg, companyId, phoneIndex);

          // Get message body (with audio transcription if applicable)
          let messageBody = messageData.text?.body || "";
          if (msg.hasMedia && (msg.type === "audio" || msg.type === "ptt")) {
            // Voice message detected during single contact sync
            try {
              const media = await msg.downloadMedia();
              const transcription = await transcribeAudio(media.data);
              if (transcription && transcription !== "Audio transcription failed. Please try again.") {
                messageBody += transcription;
              } else {
                messageBody += "Audio message";
              }
            } catch (error) {
              messageBody += "Audio message";
            }
          }

          // Prepare media data
          let mediaUrl = null;
          let mediaData = null;
          let mediaMetadata = {};

          if (msg.hasMedia) {
            if (msg.type === "video") {
              mediaUrl = messageData.video?.link || null;
            } else if (msg.type !== "audio" && msg.type !== "ptt") {
              const mediaTypeData = messageData[msg.type];
              if (mediaTypeData) {
                mediaData = mediaTypeData.data || null;
                mediaUrl = mediaTypeData.link || null;
                mediaMetadata = {
                  mimetype: mediaTypeData.mimetype,
                  filename: mediaTypeData.filename || "",
                  caption: mediaTypeData.caption || "",
                  thumbnail: mediaTypeData.thumbnail || null,
                  mediaKey: mediaTypeData.media_key || null,
                  ...(msg.type === "image" && {
                    width: mediaTypeData.width,
                    height: mediaTypeData.height
                  }),
                  ...(msg.type === "document" && {
                    pageCount: mediaTypeData.page_count,
                    fileSize: mediaTypeData.file_size
                  })
                };
              }
            } else if (msg.type === "audio" || msg.type === "ptt") {
              mediaData = messageData.audio?.data || null;
            }
          }

          // Prepare quoted message
          const quotedMessage = messageData.text?.context || null;

          // Determine author
          let author = null;
          if (msg.from.includes("@g.us") && basicInfo.author) {
            const authorData = await getContactDataFromDatabaseByPhone(basicInfo.author, companyId);
            author = authorData ? authorData.contactName : basicInfo.author;
          }

          const messageQuery = `
            INSERT INTO public.messages (
              message_id, company_id, contact_id, content, message_type,
              media_url, media_data, media_metadata, timestamp, direction,
              status, from_me, chat_id, author, phone_index, quoted_message,
              thread_id, customer_phone
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            ON CONFLICT (message_id, company_id) DO NOTHING;
          `;

          await sqlDb.query(messageQuery, [
            basicInfo.idSerialized,
            companyId,
            contactID,
            messageBody,
            basicInfo.type,
            mediaUrl,
            mediaData,
            Object.keys(mediaMetadata).length > 0 ? JSON.stringify(mediaMetadata) : null,
            new Date(basicInfo.timestamp * 1000),
            msg.fromMe ? "outbound" : "inbound",
            "delivered",
            msg.fromMe || false,
            msg.from,
            author || contactID,
            phoneIndex,
            quotedMessage ? JSON.stringify(quotedMessage) : null,
            msg.to,
            contactPhone
          ]);

          // Keep track of the most recent message for last_message
          if (!lastMessage || basicInfo.timestamp > lastMessage.timestamp) {
            lastMessage = {
              chat_id: basicInfo.chatId,
              from: basicInfo.from,
              from_me: basicInfo.fromMe,
              id: basicInfo.idSerialized,
              phoneIndex: phoneIndex,
              source: basicInfo.deviceType,
              status: "delivered",
              text: { body: messageBody },
              timestamp: basicInfo.timestamp,
              type: basicInfo.type
            };
          }
        } catch (error) {
          // Error processing message
        }

        processedMessages++;
        // Calculate progress in 10% steps
        const progress = Math.floor((processedMessages / totalMessages) * 100);
        if (progress >= lastProgress + 10 || progress === 100) {
          console.log(`Sync progress for ${contactPhone}: ${progress}% (${processedMessages}/${totalMessages})`);
          lastProgress = progress;
        }
      }

      // Update contact with the actual last message
      if (lastMessage) {
        const updateContactQuery = `
          UPDATE public.contacts SET
            last_message = $1,
            last_updated = NOW()
          WHERE contact_id = $2 AND company_id = $3;
        `;
        await sqlDb.query(updateContactQuery, [
          JSON.stringify(lastMessage),
          contactID,
          companyId,
        ]);
      }

      console.log(
        `Successfully synced contact ${contactPhone} with ${messages.length} messages for company ${companyId}, phone ${phoneIndex}`
      );
    } catch (error) {
      console.error(`Error processing single contact ${contactPhone}:`, error);
      throw error;
    }

  } catch (error) {
    console.error(
      `Error syncing single contact for company ${companyId}, phone ${phoneIndex}, contact ${contactPhone}:`,
      error
    );
    throw error;
  }
}

async function syncSingleContactName(client, companyId, contactPhone, phoneIndex = 0) {
  try {
    console.log(
      `Syncing single contact name ${contactPhone} for company ${companyId}, phone ${phoneIndex}`
    );

    // Format the contact ID to match WhatsApp format
    const phoneWithPlus = contactPhone.startsWith("+") ? contactPhone : `+${contactPhone}`;
    const phoneWithoutPlus = contactPhone.startsWith("+") ? contactPhone.slice(1) : contactPhone;
    const chatId = `${phoneWithoutPlus}@c.us`;

    try {
      const chat = await client.getChatById(chatId);
      const contact = await chat.getContact();
      const contactID = `${companyId}-${phoneWithoutPlus}`;

      const profilePicUrl = await contact.getProfilePicUrl();
      const potentialName = contact.name || contact.pushname || contact.shortName || phoneWithPlus;

      // Helper: is just a phone number
      function isJustPhoneNumber(str) {
        if (!str) return false;
        const cleanStr = str.replace(/[\s\-\(\)\+]/g, '');
        return /^[\+]?\d+$/.test(cleanStr);
      }
      // Helper: has mixed content (letters and numbers)
      function hasMixedContent(str) {
        if (!str) return false;
        const hasLetters = /[a-zA-Z]/.test(str);
        const hasNumbers = /\d/.test(str);
        return hasLetters && hasNumbers;
      }

      let shouldSaveName = false;
      let nameToSave = potentialName;

      if (isJustPhoneNumber(potentialName)) {
        console.log(`Skipping name sync for ${contactID} - name is just a phone number: ${potentialName}`);
        shouldSaveName = false;
      } else if (hasMixedContent(potentialName)) {
        shouldSaveName = true;
      } else if (potentialName !== phoneWithPlus) {
        shouldSaveName = true;
      }

      if (shouldSaveName) {
        const contactQuery = `
          UPDATE public.contacts SET
            name = $1,
            last_updated = NOW(),
            profile_pic_url = $2
          WHERE contact_id = $3 AND company_id = $4;
        `;
        const result = await sqlDb.query(contactQuery, [
          nameToSave,
          profilePicUrl,
          contactID,
          companyId,
        ]);
        if (result.rowCount === 0) {
          console.log(`Contact ${contactID} not found in database, cannot sync name`);
          throw new Error(`Contact ${contactPhone} not found in database`);
        }
        console.log(
          `Successfully synced contact name for ${contactPhone} in company ${companyId}, phone ${phoneIndex}: ${nameToSave}`
        );
      } else {
        // Only update profile picture and last_updated
        const profileQuery = `
          UPDATE public.contacts SET
            last_updated = NOW(),
            profile_pic_url = $1
          WHERE contact_id = $2 AND company_id = $3;
        `;
        await sqlDb.query(profileQuery, [
          profilePicUrl,
          contactID,
          companyId,
        ]);
        console.log(
          `Updated profile picture only for ${contactPhone} in company ${companyId}, phone ${phoneIndex}`
        );
      }
    } catch (error) {
      console.error(`Error processing single contact name ${contactPhone}:`, error);
      throw error;
    }
  } catch (error) {
    console.error(
      `Error syncing single contact name for company ${companyId}, phone ${phoneIndex}, contact ${contactPhone}:`,
      error
    );
    throw error;
  }
}

function getMillisecondsForUnit(unit) {
  switch (unit) {
    case "minutes":
      return 60 * 1000;
    case "hours":
      return 60 * 60 * 1000;
    case "days":
      return 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}

// Store queues and workers
const botQueues = new Map();
const botWorkers = new Map();
const processingChatIds = new Map();



setInterval(() => {
  const now = Date.now();
  for (const [chatId, timestamp] of processingChatIds.entries()) {
    if (now - timestamp > 300000) {
      console.log(
        `Releasing stale chatId reservation: ${chatId} (processing for ${
          (now - timestamp) / 1000
        }s)`
      );
      processingChatIds.delete(chatId);
    }
  }
}, 600000);

// Function to get or create a bot's queue
const getQueueForBot = (botId) => {
  if (!botQueues.has(botId)) {
    const { queue, worker } = createQueueAndWorker(botId);
    botQueues.set(botId, queue);
    botWorkers.set(botId, worker);
  }
  return botQueues.get(botId);
};

// ======================
// ENHANCED DATABASE CONNECTION MANAGEMENT
// ======================

// Enhanced sendScheduledMessage function with better connection management
// Enhanced JSON parsing with better error handling
const safeJsonParse = (data, defaultValue = null, context = '') => {
  if (!data) {
    console.log(`[JSON Parse] No data provided for ${context}, using default:`, defaultValue);
    return defaultValue;
  }

  // If it's already an array or object, return it
  if (Array.isArray(data) || (typeof data === 'object' && data !== null)) {
    console.log(`[JSON Parse] Data is already parsed for ${context}:`, data);
    return data;
  }

  // If it's a string, try to parse it
  if (typeof data === 'string') {
    try {
      // Check if it looks like JSON
      const trimmed = data.trim();
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || 
          (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        const parsed = JSON.parse(trimmed);
        console.log(`[JSON Parse] Successfully parsed JSON for ${context}:`, parsed);
        return parsed;
      } else {
        // It's not JSON, treat as single value
        console.log(`[JSON Parse] Data is not JSON for ${context}, treating as single value:`, data);
        return [data];
      }
    } catch (error) {
      console.error(`[JSON Parse] Error parsing JSON for ${context}:`, {
        error: error.message,
        data: data,
        position: error.message.match(/position (\d+)/)?.[1] || 'unknown',
        context: context
      });
      
      // If it's a string that's not JSON, treat it as a single value
      if (typeof data === 'string') {
        console.log(`[JSON Parse] Treating non-JSON string as single value for ${context}:`, data);
        return [data];
      }
      
      return defaultValue;
    }
  }

  // For other types, return as is
  console.log(`[JSON Parse] Data is not string for ${context}, returning as is:`, data);
  return data;
};
// ======================
// CLEANUP OLD PROBLEMATIC JOBS
// ======================

// Function to clean up old jobs with JSON parsing errors
async function cleanupOldJobs() {
  console.log("Starting cleanup of old problematic jobs...");
  
  try {
    // Get all bot queues
    for (const [botId, queue] of botQueues.entries()) {
      console.log(`Cleaning up jobs for bot ${botId}...`);
      
      try {
        // Get all jobs in different states
        const waitingJobs = await queue.getJobs(['waiting']);
        const delayedJobs = await queue.getJobs(['delayed']);
        const activeJobs = await queue.getJobs(['active']);
        const failedJobs = await queue.getJobs(['failed']);
        
        console.log(`Bot ${botId} - Found jobs:`, {
          waiting: waitingJobs.length,
          delayed: delayedJobs.length,
          active: activeJobs.length,
          failed: failedJobs.length
        });
        
        // Remove all jobs that might have JSON parsing issues
        const allJobs = [...waitingJobs, ...delayedJobs, ...activeJobs, ...failedJobs];
        
        for (const job of allJobs) {
          try {
            // Check if job data contains problematic JSON
            const jobData = job.data;
            
            // Look for common problematic fields
            const problematicFields = ['chat_ids', 'messages', 'contact_ids', 'active_hours'];
            let hasProblematicData = false;
            
            for (const field of problematicFields) {
              if (jobData[field] && typeof jobData[field] === 'string') {
                try {
                  JSON.parse(jobData[field]);
                } catch (e) {
                  console.log(`Bot ${botId} - Job ${job.id} has problematic ${field}:`, jobData[field]);
                  hasProblematicData = true;
                  break;
                }
              }
            }
            
            if (hasProblematicData) {
              console.log(`Bot ${botId} - Removing problematic job ${job.id}`);
              await job.remove();
            }
          } catch (error) {
            console.error(`Bot ${botId} - Error processing job ${job.id}:`, error.message);
            // Remove job if we can't process it
            try {
              await job.remove();
            } catch (removeError) {
              console.error(`Bot ${botId} - Error removing job ${job.id}:`, removeError.message);
            }
          }
        }
        
        console.log(`Bot ${botId} - Cleanup completed`);
        
      } catch (error) {
        console.error(`Bot ${botId} - Error during cleanup:`, error.message);
      }
    }
    
    console.log("Cleanup of old problematic jobs completed");
    
          } catch (error) {
    console.error("Error during cleanup:", error.message);
  }
}

// Function to clean up specific bot's jobs
async function cleanupBotJobs(botId) {
  console.log(`Cleaning up jobs for bot ${botId}...`);
  
  try {
    const queue = botQueues.get(botId);
    if (!queue) {
      console.log(`Bot ${botId} - No queue found`);
            return;
          }

    // Get all jobs
    const waitingJobs = await queue.getJobs(['waiting']);
    const delayedJobs = await queue.getJobs(['delayed']);
    const activeJobs = await queue.getJobs(['active']);
    const failedJobs = await queue.getJobs(['failed']);
    
    const allJobs = [...waitingJobs, ...delayedJobs, ...activeJobs, ...failedJobs];
    
    console.log(`Bot ${botId} - Found ${allJobs.length} jobs to check`);
    
    let removedCount = 0;
    
    for (const job of allJobs) {
      try {
        // Remove all jobs for this bot (since they're likely problematic)
        await job.remove();
        removedCount++;
        console.log(`Bot ${botId} - Removed job ${job.id}`);
          } catch (error) {
        console.error(`Bot ${botId} - Error removing job ${job.id}:`, error.message);
      }
    }
    
    console.log(`Bot ${botId} - Cleanup completed, removed ${removedCount} jobs`);
    
  } catch (error) {
    console.error(`Bot ${botId} - Error during cleanup:`, error.message);
  }
}

// Add cleanup endpoints
app.post('/api/cleanup-jobs', async (req, res) => {
  try {
    await cleanupOldJobs();
    res.json({ success: true, message: 'Job cleanup completed' });
  } catch (error) {
    console.error('Error during job cleanup:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/cleanup-jobs/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    await cleanupBotJobs(botId);
    res.json({ success: true, message: `Job cleanup completed for bot ${botId}` });
      } catch (error) {
    console.error('Error during bot job cleanup:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Auto-cleanup on server startup
setTimeout(async () => {
  console.log("Running automatic job cleanup on startup...");
  await cleanupOldJobs();
}, 10000); // Wait 10 seconds after startup
// Enhanced sendScheduledMessage function with better JSON parsing
async function sendScheduledMessage(message) {
  const companyId = message.company_id;
  let client = null;
  const startTime = Date.now();
  
  // FIXED: Declare messages variable at function scope
  let messages = [];
  let totalMessagesSent = 0;
  let totalMessagesSkipped = 0;
  let totalErrors = 0;
  let dayCount = 1;

  try {
    console.log(`\n=== [Company ${companyId}] Starting sendScheduledMessage ===`);
    console.log(`[Company ${companyId}] Message ID: ${message.id}`);
    console.log(`[Company ${companyId}] Schedule ID: ${message.schedule_id}`);
    console.log(`[Company ${companyId}] Status: ${message.status}`);
    console.log(`[Company ${companyId}] Phone Index: ${message.phone_index}`);

    // Get database connection with timeout
    client = await getDatabaseConnection(10000);
    console.log(`[Company ${companyId}] Database connection established`);

    // Validate phone_index
    if (message.phone_index === null || message.phone_index === undefined) {
      console.log(`[Company ${companyId}] Phone index is null/undefined, defaulting to 0`);
      message.phone_index = 0;
    }
    message.phone_index = parseInt(message.phone_index);
    if (isNaN(message.phone_index)) {
      console.log(`[Company ${companyId}] Phone index is NaN, defaulting to 0`);
      message.phone_index = 0;
    }

    const botData = botMap.get(companyId);
    console.log(`[Company ${companyId}] Available phone indices:`, botData ? botData.map((_, i) => i) : []);
    console.log(`[Company ${companyId}] Client status:`, {
      phoneIndex: message.phone_index,
      hasClient: Boolean(botData?.[message.phone_index]?.client),
      clientInfo: botData?.[message.phone_index]?.client ? "Client exists" : null,
      totalBots: botData ? botData.length : 0,
    });

    if (!botData?.[message.phone_index]?.client) {
      const error = new Error(`No active WhatsApp client found for phone index: ${message.phone_index}`);
      console.error(`[Company ${companyId}] Client not found:`, {
        phoneIndex: message.phone_index,
        availableIndices: botData ? botData.map((_, i) => i) : [],
        botDataExists: Boolean(botData),
        botDataLength: botData ? botData.length : 0,
      });
      throw error;
    }

    // Log client info
    const whatsappClient = botData[message.phone_index].client;
    console.log(`[Company ${companyId}] WhatsApp client info:`, {
      hasInfo: Boolean(whatsappClient.info),
      info: whatsappClient.info ? {
        wid: whatsappClient.info.wid?._serialized,
        platform: whatsappClient.info.platform,
        pushname: whatsappClient.info.pushname,
      } : null,
      isReady: Boolean(whatsappClient.info),
    });

    if (message) {
      console.log(`\n=== [Company ${companyId}] Processing V2 Message ===`);

      let chatIds = [];
      
      // Parse chat_ids with safe JSON parsing
      console.log(`[Company ${companyId}] Parsing chat_ids:`, message.chat_ids);
      chatIds = safeJsonParse(message.chat_ids, [], `chat_ids for company ${companyId}`);
      
      if (Array.isArray(chatIds)) {
        console.log(`[Company ${companyId}] chat_ids parsed as array with ${chatIds.length} items`);
      } else {
        console.log(`[Company ${companyId}] chat_ids parsed as single value:`, chatIds);
              chatIds = [chatIds];
      }

      // Parse messages array with safe JSON parsing
          console.log(`[Company ${companyId}] Parsing messages field:`, message.messages);
      messages = safeJsonParse(message.messages, [], `messages for company ${companyId}`);
      
      if (Array.isArray(messages)) {
        console.log(`[Company ${companyId}] messages parsed as array with ${messages.length} items`);
      } else {
        console.log(`[Company ${companyId}] messages parsed as single value:`, messages);
              messages = [messages];
      }

      // If no messages array, create from individual message fields
      if (!messages || messages.length === 0) {
        console.log(`[Company ${companyId}] Creating messages from individual fields`);
        messages = chatIds.map((chatId) => {
          const delay = message.min_delay && message.max_delay 
            ? Math.floor(Math.random() * (message.max_delay - message.min_delay + 1) + message.min_delay)
            : 0;
          
          const messageObj = {
          chatId: chatId,
          message: message.message_content,
            delay: delay,
          mediaUrl: message.media_url || "",
          documentUrl: message.document_url || "",
          fileName: message.file_name || "",
          caption: message.caption || ""
          };
          
          console.log(`[Company ${companyId}] Created message for ${chatId}:`, {
            messageLength: messageObj.message?.length,
            delay: messageObj.delay,
            hasMedia: Boolean(messageObj.mediaUrl || messageObj.documentUrl),
          });
          
          return messageObj;
        });
      }

      console.log(`[Company ${companyId}] Final batch details:`, {
        messageId: message.id,
        infiniteLoop: message.infinite_loop,
        activeHours: message.active_hours ? safeJsonParse(message.active_hours, null, `active_hours for company ${companyId}`) : null,
        totalMessages: messages.length,
        messages: messages.map((m, index) => ({
          index: index,
          chatId: m.chatId,
          messageLength: m.message?.length,
          delay: m.delay,
          hasMedia: Boolean(m.mediaUrl || m.documentUrl),
          mediaUrl: m.mediaUrl || null,
          documentUrl: m.documentUrl || null,
        })),
      });

      const processMessage = (messageText, contact) => {
        if (!messageText) {
          console.log(`[Company ${companyId}] No message text to process`);
          return "";
        }

        console.log(`[Company ${companyId}] Processing message with placeholders:`, {
          originalLength: messageText.length,
          hasContact: Boolean(contact),
          contactName: contact?.contact_name || null,
          contactPhone: contact?.phone || null,
        });

        let processedMessage = messageText;
        const placeholders = {
          contactName: contact?.contact_name || "",
          firstName: contact?.first_name || "",
          lastName: contact?.last_name || "",
          email: contact?.email || "",
          phone: contact?.phone || "",
          vehicleNumber: contact?.vehicle_number || "",
          branch: contact?.branch || "",
          expiryDate: contact?.expiry_date || "",
          ic: contact?.ic || "",
        };

        // Log available placeholders
        console.log(`[Company ${companyId}] Available placeholders:`, placeholders);

        Object.entries(placeholders).forEach(([key, value]) => {
          const placeholder = `@{${key}}`;
          const originalMessage = processedMessage;
          processedMessage = processedMessage.replace(
            new RegExp(placeholder, "g"),
            value
          );
          if (originalMessage !== processedMessage) {
            console.log(`[Company ${companyId}] Replaced ${placeholder} with: ${value}`);
          }
        });

        if (contact?.custom_fields) {
          console.log(`[Company ${companyId}] Processing custom fields`);
          const customFields = safeJsonParse(contact.custom_fields, {}, `custom_fields for contact ${contact.contact_id}`);

          console.log(`[Company ${companyId}] Custom fields:`, customFields);

          Object.entries(customFields).forEach(([key, value]) => {
            const customPlaceholder = `@{${key}}`;
            const stringValue =
              value !== null && value !== undefined ? String(value) : "";
            const originalMessage = processedMessage;
            processedMessage = processedMessage.replace(
              new RegExp(customPlaceholder, "g"),
              stringValue
            );
            if (originalMessage !== processedMessage) {
              console.log(`[Company ${companyId}] Replaced ${customPlaceholder} with: ${stringValue}`);
            }
          });
        }

        console.log(`[Company ${companyId}] Message processing complete:`, {
          originalLength: messageText.length,
          processedLength: processedMessage.length,
          hasChanges: messageText !== processedMessage,
        });

        return processedMessage;
      };

      const isWithinActiveHours = () => {
        if (!message.active_hours) {
          console.log(`[Company ${companyId}] No active hours set, always active`);
          return true;
        }
        
        try {
          const activeHours = safeJsonParse(message.active_hours, null, `active_hours for company ${companyId}`);
          if (!activeHours) {
            console.log(`[Company ${companyId}] No active hours parsed, assuming active`);
            return true;
          }
          
          const now = new Date();
          const currentHour = now.getHours();
          const currentMinute = now.getMinutes();
          const currentTime = currentHour * 60 + currentMinute;
          
          const startTime = activeHours.start ? 
            (parseInt(activeHours.start.split(':')[0]) * 60 + parseInt(activeHours.start.split(':')[1])) : 0;
          const endTime = activeHours.end ? 
            (parseInt(activeHours.end.split(':')[0]) * 60 + parseInt(activeHours.end.split(':')[1])) : 1440;
          
          const isActive = currentTime >= startTime && currentTime <= endTime;
          
          console.log(`[Company ${companyId}] Active hours check:`, {
            currentTime: `${currentHour}:${currentMinute}`,
            startTime: activeHours.start,
            endTime: activeHours.end,
            isActive: isActive,
          });
          
          return isActive;
        } catch (e) {
          console.warn(`[Company ${companyId}] Error parsing active hours, assuming active:`, e);
          return true;
        }
      };

      const waitUntilNextDay = async () => {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        const timeUntilTomorrow = tomorrow - now;
        console.log(`[Company ${companyId}] Waiting until next day:`, {
          currentTime: now.toISOString(),
          tomorrowTime: tomorrow.toISOString(),
          waitMinutes: timeUntilTomorrow / 1000 / 60,
        });

        try {
        const messageCheck = await client.query(
          "SELECT status FROM scheduled_messages WHERE id = $1",
          [message.id]
        );

          if (messageCheck.rowCount === 0) {
            console.log(`[Company ${companyId}] Message not found in database, stopping`);
          return true;
        }

          if (messageCheck.rows[0].status === "stopped") {
            console.log(`[Company ${companyId}] Message sequence stopped`);
            return true;
          }

          console.log(`[Company ${companyId}] Waiting ${timeUntilTomorrow / 1000 / 60} minutes until next day`);
        await new Promise((resolve) => setTimeout(resolve, timeUntilTomorrow));
        return false;
        } catch (error) {
          console.error(`[Company ${companyId}] Error checking message status:`, error);
          return true; // Stop on error
        }
      };

      let currentMessageIndex = 0;
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 5;

      console.log(`[Company ${companyId}] Starting message processing loop`);

      while (true) {
        try {
          const loopStartTime = Date.now();
          
          // Check if we're within active hours
          if (!isWithinActiveHours()) {
            console.log(`[Company ${companyId}] Outside active hours, waiting 10 minutes...`);
            await new Promise(resolve => setTimeout(resolve, 600000));
            continue;
          }

          // Add rate limiting check
          if (!checkRateLimit(`message_processing_${companyId}`)) {
            console.log(`[Company ${companyId}] Rate limit reached, waiting 1 minute...`);
            await new Promise(resolve => setTimeout(resolve, 60000));
            continue;
          }

          // Add a longer delay between processing cycles to reduce network load
          console.log(`[Company ${companyId}] Waiting 10 seconds between cycles...`);
          await new Promise(resolve => setTimeout(resolve, 10000));

          // FIXED: Check if currentMessageIndex is within bounds
          if (currentMessageIndex >= messages.length) {
            console.log(`[Company ${companyId}] Reached end of messages array (${currentMessageIndex}/${messages.length})`);
            
            if (!message.infinite_loop) {
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
            continue; // Skip to next iteration to process first message again
          }

          console.log(`\n=== [Company ${companyId}] Processing Message Item ${currentMessageIndex + 1}/${messages.length} ===`);
          const messageItem = messages[currentMessageIndex];
          
          // FIXED: Validate messageItem exists
          if (!messageItem) {
            console.error(`[Company ${companyId}] Message item at index ${currentMessageIndex} is undefined`);
            console.log(`[Company ${companyId}] Messages array:`, messages);
            console.log(`[Company ${companyId}] Messages length:`, messages.length);
            console.log(`[Company ${companyId}] Current index:`, currentMessageIndex);
            
            // Skip this message and move to next
            currentMessageIndex++;
            continue;
          }
          
          console.log(`[Company ${companyId}] Current message item:`, {
            index: currentMessageIndex,
            chatId: messageItem.chatId,
            messageLength: messageItem.message?.length,
            delay: messageItem.delay,
            hasMedia: Boolean(messageItem.mediaUrl || messageItem.documentUrl),
            mediaUrl: messageItem.mediaUrl || null,
            documentUrl: messageItem.documentUrl || null,
          });

          const { chatId, message: messageText, delay } = messageItem;
          
          // FIXED: Validate chatId exists
          if (!chatId) {
            console.error(`[Company ${companyId}] chatId is undefined for message item at index ${currentMessageIndex}`);
            currentMessageIndex++;
            continue;
          }
          
          const phone = '+' + chatId.split("@")[0];

          console.log(`[Company ${companyId}] Processing chat:`, {
            chatId: chatId,
            phone: phone,
            originalPhone: chatId.split("@")[0],
          });

          console.log(`[Company ${companyId}] Fetching contact data for:`, phone);
          
          let contactData = {};
          
          // Determine which contacts to get for this batch
          let contactIds = [];
          if (message.multiple && message.contact_ids) {
            try {
              contactIds = safeJsonParse(message.contact_ids, [], `contact_ids for company ${companyId}`);
              console.log(`[Company ${companyId}] Using multiple contact IDs:`, contactIds);
            } catch (e) {
              console.warn(`[Company ${companyId}] Could not parse contact_ids:`, {
                error: e.message,
                contact_ids: message.contact_ids,
                type: typeof message.contact_ids,
              });
              contactIds = [];
            }
          } else if (message.contact_id) {
            contactIds = [message.contact_id];
            console.log(`[Company ${companyId}] Using single contact ID:`, contactIds);
          } else {
            console.log(`[Company ${companyId}] No contact IDs specified, will use phone lookup`);
          }
          
          // Fetch contact by ID if available, otherwise by phone
          if (contactIds.length > 0) {
            console.log(`[Company ${companyId}] Looking up contact by ID and phone`);
            const contactQuery = `
              SELECT * FROM contacts 
              WHERE company_id = $1 AND contact_id = ANY($2::text[]) AND phone = $3
            `;
            const contactResult = await client.query(contactQuery, [
              companyId,
              contactIds,
              phone,
            ]);
            
            if (contactResult.rowCount > 0) {
              contactData = contactResult.rows[0];
              console.log(`[Company ${companyId}] Found contact by ID and phone:`, {
                contactId: contactData.contact_id,
                name: contactData.contact_name,
                phone: contactData.phone,
              });
            } else {
              console.log(`[Company ${companyId}] No contact found by ID and phone, trying phone-only lookup`);
              const phoneContactQuery = `
                SELECT * FROM contacts 
                WHERE company_id = $1 AND phone = $2
              `;
              const phoneContactResult = await client.query(phoneContactQuery, [
                companyId,
                phone,
              ]);
              contactData = phoneContactResult.rowCount > 0 ? phoneContactResult.rows[0] : {};
              console.log(`[Company ${companyId}] Phone-only lookup result:`, {
                found: phoneContactResult.rowCount > 0,
                contactId: contactData.contact_id || null,
                name: contactData.contact_name || null,
              });
            }
          } else {
            console.log(`[Company ${companyId}] Looking up contact by phone only`);
            const contactQuery = `
              SELECT * FROM contacts 
              WHERE company_id = $1 AND phone = $2
            `;
            const contactResult = await client.query(contactQuery, [
              companyId,
              phone,
            ]);
            contactData = contactResult.rowCount > 0 ? contactResult.rows[0] : {};
            console.log(`[Company ${companyId}] Phone lookup result:`, {
              found: contactResult.rowCount > 0,
              contactId: contactData.contact_id || null,
              name: contactData.contact_name || null,
            });
          }
          
          console.log(`[Company ${companyId}] Contact data summary:`, {
            exists: Object.keys(contactData).length > 0,
            contactId: contactData.contact_id || null,
            name: contactData.contact_name || null,
            phone: contactData.phone || null,
            tags: contactData.tags || null,
            customFields: contactData.custom_fields ? 'Present' : 'None',
          });

          // Check for stop bot tag
          if (
            companyId === "0128" &&
            contactData.tags &&
            contactData.tags.includes("stop bot")
          ) {
            console.log(`[Company ${companyId}] Skipping message - contact has 'stop bot' tag`);
            totalMessagesSkipped++;
            currentMessageIndex++;
            continue;
          }

          const processedMessageText = processMessage(
            messageText || message.message_content,
            contactData
          );

          const today = new Date().toISOString().split("T")[0];
          const contentHash = Buffer.from(processedMessageText)
            .toString("base64")
            .substring(0, 20);
          const messageIdentifier = `${today}_${currentMessageIndex}_${contentHash}`;

          console.log(`[Company ${companyId}] Message identifier:`, {
            today: today,
            currentIndex: currentMessageIndex,
            contentHash: contentHash,
            identifier: messageIdentifier,
          });

          const sentCheckQuery = `
            SELECT 1 FROM sent_messages 
            WHERE company_id = $1 AND chat_id = $2 AND identifier = $3
          `;
          const sentCheck = await client.query(sentCheckQuery, [
            companyId,
            chatId,
            messageIdentifier,
          ]);

          if (sentCheck.rowCount > 0) {
            console.log(`[Company ${companyId}] Message already sent to ${chatId}, skipping...`);
            totalMessagesSkipped++;
            currentMessageIndex++;
            continue;
          }

          console.log(`[Company ${companyId}] Message prepared:`, {
            originalLength: messageText?.length,
            processedLength: processedMessageText?.length,
            hasPlaceholders: messageText !== processedMessageText,
            identifier: messageIdentifier,
          });

          if (delay > 0) {
            console.log(`[Company ${companyId}] Adding delay of ${delay} seconds`);
            await new Promise((resolve) => setTimeout(resolve, delay * 1000));
          }

          try {
            console.log(`\n=== [Company ${companyId}] Sending Message ===`);

            const mediaUrl = messageItem.mediaUrl || message.media_url || "";
            const documentUrl = messageItem.documentUrl || message.document_url || "";
            const fileName = messageItem.fileName || message.file_name || "";

            const endpoint = mediaUrl ? "image" : documentUrl ? "document" : "text";

            // FIXED: Properly construct the URL without double slashes
            const baseUrl = (process.env.URL || 'http://localhost:3000').replace(/\/$/, ''); // Remove trailing slash
            const url = `${baseUrl}/api/v2/messages/${endpoint}/${companyId}/${chatId}`;

            console.log(`[Company ${companyId}] URL construction:`, {
              baseUrl: baseUrl,
              endpoint: endpoint,
              companyId: companyId,
              chatId: chatId,
              fullUrl: url,
              envUrl: process.env.URL,
              originalBaseUrl: process.env.URL || 'http://localhost:3000',
            });

            console.log(`[Company ${companyId}] Request details:`, {
              endpoint: endpoint,
              url: url,
              phoneIndex: message.phone_index,
              hasMedia: Boolean(mediaUrl || documentUrl),
              mediaUrl: mediaUrl || null,
              documentUrl: documentUrl || null,
              fileName: fileName || null,
              messageLength: processedMessageText?.length,
            });

            const requestBody = mediaUrl
                  ? {
                      imageUrl: mediaUrl,
                      caption: processedMessageText,
                      phoneIndex: message.phone_index,
                    }
                  : documentUrl
                  ? {
                      documentUrl: documentUrl,
                      filename: fileName,
                      caption: processedMessageText,
                      phoneIndex: message.phone_index,
                    }
                  : {
                      message: processedMessageText || message.message_content,
                      phoneIndex: message.phone_index,
                };

            console.log(`[Company ${companyId}] Request body:`, requestBody);

            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            });

            console.log(`[Company ${companyId}] Send response:`, {
              status: response.status,
              ok: response.ok,
              statusText: response.statusText,
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.error(`[Company ${companyId}] Response error:`, {
                status: response.status,
                statusText: response.statusText,
                errorText: errorText,
                url: url,
              });
              throw new Error(`Failed to send message: ${response.status} - ${errorText}`);
            }

            const responseData = await response.json();
            console.log(`[Company ${companyId}] Response data:`, responseData);

            await client.query(
              `INSERT INTO sent_messages (
                company_id, chat_id, identifier, sent_at, 
                message_index, message_content, message_type,
                media_url, document_url
              ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8)`,
              [
                companyId,
                chatId,
                messageIdentifier,
                currentMessageIndex,
                processedMessageText,
                endpoint,
                mediaUrl || null,
                documentUrl || null,
              ]
            );

            console.log(`[Company ${companyId}] Recorded message as sent with ID: ${messageIdentifier}`);
            totalMessagesSent++;

            const messageTime = Date.now() - loopStartTime;
            console.log(`[Company ${companyId}] Message sent successfully in ${messageTime}ms`);

          } catch (error) {
            console.error(`\n=== [Company ${companyId}] Message Send Error ===`);
            console.error(`[Company ${companyId}] Error details:`, {
              name: error.name,
              message: error.message,
              stack: error.stack,
              chatId: chatId,
              phone: phone,
              messageIndex: currentMessageIndex,
            });

            await client.query(
              `INSERT INTO error_logs (
                company_id, message_id, error_type, 
                error_message, stack_trace, timestamp
              ) VALUES ($1, $2, $3, $4, $5, NOW())`,
              [
                companyId,
                message.id || "No messageId",
                error.name,
                error.message,
                error.stack,
              ]
            );

            totalErrors++;
            throw error;
          }

          currentMessageIndex++;
          
          // Check if we need to sleep after a certain number of messages
          if (message.activate_sleep && message.sleep_after_messages && message.sleep_duration) {
            if (currentMessageIndex % message.sleep_after_messages === 0) {
              console.log(`[Company ${companyId}] Sleeping for ${message.sleep_duration} seconds after ${message.sleep_after_messages} messages`);
              await new Promise(resolve => setTimeout(resolve, message.sleep_duration * 1000));
            }
          }
          
          console.log(`\n=== [Company ${companyId}] Sequence Status ===`);
          console.log({
            currentIndex: currentMessageIndex,
            totalMessages: messages.length,
            dayCount: dayCount,
            willContinue: currentMessageIndex < messages.length || message.infinite_loop,
            totalSent: totalMessagesSent,
            totalSkipped: totalMessagesSkipped,
            totalErrors: totalErrors,
            consecutiveErrors: consecutiveErrors,
          });

          consecutiveErrors = 0; // Reset on successful message

        } catch (error) {
          console.error(`[Company ${companyId}] Error in message processing:`, {
            error: error.message,
            stack: error.stack,
            currentIndex: currentMessageIndex,
            consecutiveErrors: consecutiveErrors + 1,
            messagesLength: messages.length,
            messageItem: messages[currentMessageIndex] || 'undefined',
          });
          
          consecutiveErrors++;
          totalErrors++;
          
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.error(`[Company ${companyId}] Max consecutive errors reached (${MAX_CONSECUTIVE_ERRORS}), stopping sequence`);
            break;
          }
          
          console.log(`[Company ${companyId}] Waiting 1 minute before retrying...`);
          await new Promise(resolve => setTimeout(resolve, 60000));
        }
      }

      const totalTime = Date.now() - startTime;
      console.log(`\n=== [Company ${companyId}] sendScheduledMessage Complete ===`);
      console.log(`[Company ${companyId}] Final statistics:`, {
        totalTime: `${totalTime}ms`,
        totalMessages: messages.length,
        totalSent: totalMessagesSent,
        totalSkipped: totalMessagesSkipped,
        totalErrors: totalErrors,
        dayCount: dayCount,
        success: true,
      });

    } else {
      console.log(`[Company ${companyId}] Message is not V2 - skipping`);
    }

    // FIXED: Return statement now has access to all variables
    return { 
      success: true,
      statistics: {
        totalTime: Date.now() - startTime,
        totalMessages: messages.length,
        totalSent: totalMessagesSent,
        totalSkipped: totalMessagesSkipped,
        totalErrors: totalErrors,
        dayCount: dayCount,
      }
    };

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`\n=== [Company ${companyId}] sendScheduledMessage Error ===`);
    console.error(`[Company ${companyId}] Error details:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      totalTime: `${totalTime}ms`,
      phoneIndex: message.phone_index,
      messageId: message.id,
    });

    return { 
      success: false, 
      error: error.message,
      details: {
        name: error.name,
        stack: error.stack,
        totalTime: totalTime,
        phoneIndex: message.phone_index,
        messageId: message.id,
      }
    };
  } finally {
    if (client) {
    await safeRelease(client);
  }
}
}
async function scheduleAllMessages() {
  const client = await pool.connect();
  try {
    console.log("Scheduling all previous scheduled messages...");

    const companiesQuery = `
      SELECT DISTINCT company_id FROM scheduled_messages
      WHERE status != 'completed'
    `;
    const companiesResult = await client.query(companiesQuery);

    for (const companyRow of companiesResult.rows) {
      const companyId = companyRow.company_id;

      const apiUrlQuery = `
        SELECT api_url FROM companies WHERE company_id = $1
      `;
      const apiUrlResult = await client.query(apiUrlQuery, [companyId]);
      const companyApiUrl = apiUrlResult.rows[0]?.api_url;

      if (companyApiUrl !== 'https://juta-dev.ngrok.app') {
        continue;
      }

      const queue = getQueueForBot(companyId);

      const messagesQuery = `
        SELECT * FROM scheduled_messages
        WHERE company_id = $1
        AND status != 'sent'
        AND id::text = schedule_id::text
      `;
      const messagesResult = await client.query(messagesQuery, [companyId]);

      for (const message of messagesResult.rows) {
        const messageId = message.id;

        const batchesQuery = `
        SELECT * FROM scheduled_messages 
        WHERE company_id = $1 
        AND schedule_id = $2
        AND status != 'sent'
        AND id::text != schedule_id::text
      `;
        const batchesResult = await client.query(batchesQuery, [
          companyId,
          messageId,
        ]);

        for (const batch of batchesResult.rows) {
          const batchId = batch.id;
          const delay = new Date(batch.scheduled_time).getTime() - Date.now();

          const existingJob = await queue.getJob(batchId);
          if (!existingJob) {
            await queue.add(
              "send-message-batch",
              {
                companyId,
                messageId,
                batchId,
              },
              {
                removeOnComplete: false,
                removeOnFail: false,
                delay: Math.max(delay, 0),
                jobId: batchId,
              }
            );
          }
        }
      }
    }
  } catch (error) {
    console.error("Error in scheduleAllMessages:", error);
  } finally {
    await safeRelease(client);
  }
}

// Add this import at the top of server.js
const { broadcastNewMessageToCompany } = require('./utils/broadcast');

function setupMessageHandler(client, botName, phoneIndex) {
  client.on("message", async (msg) => {
    try {
      console.log(`🔔 [MESSAGE_HANDLER] ===== INCOMING MESSAGE =====`);
      console.log(`🔔 [MESSAGE_HANDLER] Bot: ${botName}`);
      console.log(`🔔 [MESSAGE_HANDLER] From: ${msg.from}`);
      console.log(`🔔 [MESSAGE_HANDLER] Body: ${msg.body}`);
      console.log(`🔔 [MESSAGE_HANDLER] Type: ${msg.type}`);
      console.log(`🔔 [MESSAGE_HANDLER] From Me: ${msg.fromMe}`);
      console.log(`🔔 [MESSAGE_HANDLER] Timestamp: ${msg.timestamp}`);
      console.log(`🔔 [MESSAGE_HANDLER] ID: ${msg.id._serialized}`);
      
      await handleNewMessagesTemplateWweb(client, msg, botName, phoneIndex);
      
      // Add broadcast call here
      const extractedNumber = msg.from.replace("@c.us", "").replace("@g.us", "");
      const messageData = {
        chatId: msg.from,
        message: msg.body,
        extractedNumber: `+${extractedNumber}`,
        contactId: `${botName}-${extractedNumber}`,
        fromMe: msg.fromMe,
        timestamp: Math.floor(Date.now() / 1000),
        messageType: msg.type,
        contactName: msg.notifyName || extractedNumber
      };
      
      console.log(`🔔 [MESSAGE_HANDLER] Calling broadcastNewMessageToCompany with company: ${botName}`);
      broadcastNewMessageToCompany(botName, messageData);
      
      console.log(`🔔 [MESSAGE_HANDLER] ✅ Message processed successfully`);
      console.log(`🔔 [MESSAGE_HANDLER] ===== INCOMING MESSAGE END =====`);
    } catch (error) {
      console.error(`🔔 [MESSAGE_HANDLER] ❌ Error in message handling:`, error);
    }
  });
}

function setupMessageCreateHandler(client, botName, phoneIndex) {
  client.on("message_create", async (msg) => {
    broadcastBotActivity(botName, true);
    try {
      console.log("My WhatsApp number:", client.info.wid.user);
      const isFromHuman = msg.fromMe && msg.author;
      if (msg.fromMe) {
        const extractedNumber = "+" + msg.to.split("@")[0];
        const contactID = botName + "-" + msg.to.split("@")[0];
        const myNumber = "+" + client.info.wid.user;
        if (extractedNumber === myNumber) {
          return;
        }
        const companyId = botName;
        const chatId = msg.to;
        const phoneNumber = extractedNumber;

        // 1. Ensure contact exists in SQL
        let contactResult;
        try {
          contactResult = await sqlDb.query(
            `INSERT INTO contacts (contact_id, phone, company_id, name, last_updated)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             RETURNING *`,
            [contactID, phoneNumber, companyId, phoneNumber] // Use phoneNumber as fallback name
          );
        } catch (err) {
          if (err.code === "23505") {
            contactResult = await sqlDb.query(
              `UPDATE contacts 
               SET last_updated = CURRENT_TIMESTAMP
               WHERE contact_id = $1 AND company_id = $2
               RETURNING *`,
              [contactID, companyId]
            );
          } else {
            throw err;
          }
        }

        // 2. Save the message to SQL
        const { type } = addMessageToPostgres(
          msg,
          companyId,
          extractedNumber,
          contactResult.rows[0]?.contact_name,
          phoneIndex
        );

        // 3. Update contact's last_message in SQL
        await sqlDb.query(
          `UPDATE contacts 
           SET last_message = $1, last_updated = CURRENT_TIMESTAMP
           WHERE contact_id = $2 AND company_id = $3`,
          [
            JSON.stringify({
              chat_id: chatId,
              from: msg.from,
              from_me: true,
              id: msg.id._serialized,
              phoneIndex: phoneIndex,
              source: "",
              status: "sent",
              text: { body: msg.body },
              timestamp: Math.floor(Date.now() / 1000),
              type: type,
            }),
            contactID,
            companyId,
          ]
        );

        // 4. Handle OpenAI thread logic
        let threadId = contactResult.rows[0]?.thread_id;
        if (isFromHuman) {
          if (threadId) {
            await handleOpenAIMyMessage(msg.body, threadId);
          } else {
            try {
              const thread = await createThread();
              threadId = thread.id;
              await sqlDb.query(
                `UPDATE contacts SET thread_id = $1 WHERE contact_id = $2 AND company_id = $3`,
                [threadId, contactID, companyId]
              );
              await handleOpenAIMyMessage(msg.body, threadId);
            } catch (error) {
              console.error("Error creating AI thread:", error);
            }
          }
        }

        // 4.5. Handle AI Responses for Own Messages
        console.log("\n=== Processing AI Responses in MessageCreateHandler ===");
        const contactData = await getContactDataFromDatabaseByPhone(
          extractedNumber,
          botName
        );
        await fetchConfigFromDatabase(botName);

        const handlerParams = {
          client: client,
          msg: msg.body,
          idSubstring: botName,
          extractedNumber: extractedNumber,
          contactName:
            contactData?.contact_name || contactData?.name || extractedNumber,
          phoneIndex: phoneIndex,
        };

        // Process AI responses for 'user'
        await processAIResponses({
          ...handlerParams,
          keywordSource: "own",
          handlers: {
            assign: true,
            tag: true,
            followUp: true,
            document: true,
            image: true,
            video: true,
            voice: true,
          },
        });// Add broadcast call here
        const messageData = {
          chatId: msg.to,
          message: msg.body,
          extractedNumber: `+${extractedNumber}`,
          contactId: `${botName}-${extractedNumber}`,
          fromMe: msg.fromMe,
          timestamp: Math.floor(Date.now() / 1000),
          messageType: msg.type,
          contactName: extractedNumber
        };
        
        console.log(`🔔 [MESSAGE_CREATE] Calling broadcastNewMessageToCompany with company: ${botName}`);
        broadcastNewMessageToCompany(botName, messageData);
        
        // ... rest of existing code ...l

        // 5. Handle bot tags for certain companies
        if (
          isFromHuman &&
          [
            "0100",
            "0145",
            "0128",
            "020",
            "001",
            "0123",
            "0119",
            "0102",
          ].includes(companyId)
        ) {
          await sqlDb.query(
            `UPDATE contacts 
             SET tags = COALESCE(tags, '[]'::jsonb) || '"stop bot"'::jsonb
             WHERE contact_id = $1 AND company_id = $2`,
            [contactID, companyId]
          );
        }

        // Clear the "active" status after 10 seconds of no messages
        setTimeout(() => {
          broadcastBotActivity(botName, false);
        }, 10000);
      }
    } catch (error) {
      console.error(
        `ERROR in message_create handling for bot ${botName}:`,
        error
      );
    }
  });
}

async function fetchConfigFromDatabase(idSubstring) {
  let sqlClient;
  try {
    sqlClient = await pool.connect();

    const query = `
      SELECT *
      FROM public.companies 
      WHERE company_id = $1
    `;

    const result = await sqlClient.query(query, [idSubstring]);

    if (result.rows.length === 0) {
      console.log("No such company found!");
      return;
    }

    companyConfig = result.rows[0];
    console.log(`CompanyConfig for company ${idSubstring}:`, companyConfig);
  } catch (error) {
    console.error("Error fetching config:", error);
  } finally {
    if (sqlClient) {
      await safeRelease(sqlClient);
    }
  }
}

// Modular function to process all AI responses
async function processAIResponses({
  client,
  msg,
  idSubstring,
  extractedNumber,
  contactName,
  phoneIndex,
  keywordSource,
  handlers = {
    assign: true,
    tag: true,
    followUp: true,
    document: true,
    image: true,
    video: true,
    voice: true,
  },
}) {
  const followUpTemplates = await getFollowUpTemplates(idSubstring);

  const chatid = formatPhoneNumber(extractedNumber) + "@c.us";

  const handlerParams = {
    client: client,
    message: msg,
    chatId: chatid,
    extractedNumber: extractedNumber,
    idSubstring: idSubstring,
    contactName: contactName,
    phoneIndex: phoneIndex,
    keywordSource: keywordSource,
  };

  // Handle user-triggered responses
  if (handlers.assign) {
    await handleAIAssignResponses({
      ...handlerParams,
    });
  }

  if (handlers.tag) {
    await handleAITagResponses({
      ...handlerParams,
      followUpTemplates: followUpTemplates,
    });
  }

  if (handlers.followUp) {
    await handleAIFollowUpResponses({
      ...handlerParams,
      followUpTemplates: followUpTemplates,
    });
  }

  if (handlers.document) {
    await handleAIDocumentResponses({
      ...handlerParams,
    });
  }

  if (handlers.image) {
    await handleAIImageResponses({
      ...handlerParams,
    });
  }

  if (handlers.video) {
    await handleAIVideoResponses({
      ...handlerParams,
    });
  }

  if (handlers.voice) {
    await handleAIVoiceResponses({
      ...handlerParams,
    });
  }
}
// ... existing code around line 1010 ...

app.post('/api/upload-media', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const baseUrl = 'https://juta-dev.ngrok.dev';
  const fileUrl = `${baseUrl}/media/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// New file upload endpoint for general file uploads
app.post('/api/upload-file', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Get additional parameters
    const { fileName, companyId } = req.body;
    
    // Validate required fields
    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }

    const baseUrl = 'https://juta-dev.ngrok.dev';
    const fileUrl = `${baseUrl}/media/${req.file.filename}`;
    
    // Log the upload for debugging
    console.log(`File uploaded: ${req.file.originalname} -> ${req.file.filename}`);
    console.log(`Company ID: ${companyId}`);
    console.log(`Requested filename: ${fileName}`);
    
    res.json({ 
      success: true,
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to upload file' 
    });
  }
});

// ... rest of existing code ...
// Create a new follow-up template
app.post('/api/followup-templates', async (req, res) => {
  console.log("=== Starting POST /api/followup-templates ===");
  console.log("Request body:", JSON.stringify(req.body, null, 2));
  
  const {
    companyId,
    name,
    status = 'active',
    createdAt,
    startTime,
    isCustomStartTime,
    trigger_tags = [],
    trigger_keywords = [],
    batchSettings = {}
  } = req.body;

  // Validation
  if (!companyId) {
    console.error("Missing companyId");
    return res.status(400).json({ success: false, message: 'Missing companyId' });
  }
  
  if (!name || !name.trim()) {
    console.error("Missing or empty template name");
    return res.status(400).json({ success: false, message: 'Template name is required' });
  }

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");
    console.log("Database transaction started");

    // Generate template_id (UUID)
    const templateId = require('crypto').randomUUID();
    console.log("Generated template ID:", templateId);

    // Insert the template
    const insertTemplateQuery = `
      INSERT INTO public.followup_templates (
        id,
        template_id,
        company_id,
        name,
        created_at,
        updated_at,
        trigger_keywords,
        trigger_tags,
        keyword_source,
        status,
        content,
        delay_hours
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const templateParams = [
      require('crypto').randomUUID(), // id (UUID)
      templateId, // template_id
      companyId,
      name.trim(),
      createdAt ? new Date(createdAt) : new Date(),
      new Date(),
      Array.isArray(trigger_keywords) ? trigger_keywords : [],
      Array.isArray(trigger_tags) ? trigger_tags : [],
      'bot', // default keyword_source
      status,
      '', // default content (empty for now)
      24 // default delay_hours
    ];

    console.log("Executing template insert with params:", templateParams);
    const templateResult = await sqlClient.query(insertTemplateQuery, templateParams);
    console.log("Template inserted successfully:", templateResult.rows[0]);

    // If batchSettings has messages, insert them into followup_messages
    if (batchSettings.messages && Array.isArray(batchSettings.messages)) {
      console.log(`Inserting ${batchSettings.messages.length} messages`);
      
      for (let i = 0; i < batchSettings.messages.length; i++) {
        const message = batchSettings.messages[i];
        console.log(`Processing message ${i + 1}:`, message);

        const insertMessageQuery = `
          INSERT INTO public.followup_messages (
            id,
            template_id,
            message,
            day_number,
            sequence,
            status,
            created_at,
            document,
            image,
            video,
            delay_after,
            specific_numbers,
            use_scheduled_time,
            scheduled_time,
            add_tags,
            remove_tags
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `;

        const messageParams = [
          require('crypto').randomUUID(), // id
          templateId, // template_id
          message.content || '',
          message.dayNumber || 0,
          message.sequence || i + 1,
          'active',
          new Date(),
          message.document || null,
          message.image || null,
          message.video || null,
          message.delayAfter ? JSON.stringify(message.delayAfter) : null,
          message.specificNumbers ? JSON.stringify(message.specificNumbers) : null,
          message.useScheduledTime || false,
          message.scheduledTime || null,
          Array.isArray(message.addTags) ? message.addTags : [],
          Array.isArray(message.removeTags) ? message.removeTags : []
        ];

        console.log(`Inserting message ${i + 1} with params:`, messageParams);
        await sqlClient.query(insertMessageQuery, messageParams);
        console.log(`Message ${i + 1} inserted successfully`);
      }
    }

    await sqlClient.query("COMMIT");
    console.log("Database transaction committed successfully");

    // Return the created template
    const createdTemplate = {
      id: templateResult.rows[0].id,
      templateId: templateResult.rows[0].template_id,
      companyId: templateResult.rows[0].company_id,
      name: templateResult.rows[0].name,
      createdAt: templateResult.rows[0].created_at,
      updatedAt: templateResult.rows[0].updated_at,
      triggerKeywords: templateResult.rows[0].trigger_keywords || [],
      triggerTags: templateResult.rows[0].trigger_tags || [],
      keywordSource: templateResult.rows[0].keyword_source,
      status: templateResult.rows[0].status,
      content: templateResult.rows[0].content,
      delayHours: templateResult.rows[0].delay_hours
    };

    console.log("Returning created template:", createdTemplate);
    console.log("=== Completed POST /api/followup-templates ===");

    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      template: createdTemplate
    });

  } catch (error) {
    await safeRollback(sqlClient);
    console.error("=== Error in POST /api/followup-templates ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    console.error("Full error:", error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to create template',
      error: error.message
    });
  } finally {
    await safeRelease(sqlClient);
    console.log("Database client released");
  }
});

async function getFollowUpTemplates(companyId) {
  console.log("Starting getFollowUpTemplates for companyId:", companyId);
  const templates = [];
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const query = `
      SELECT 
        id,
        template_id,
        company_id,
        name,
        created_at,
        updated_at,
        trigger_keywords,
        trigger_tags,
        keyword_source,
        status,
        content,
        delay_hours
      FROM 
        public.followup_templates
      WHERE 
        company_id = $1
      ORDER BY created_at DESC
    `;

    const result = await sqlClient.query(query, [companyId]);

    for (const row of result.rows) {
      const templateObj = {
        id: row.id,
        templateId: row.template_id,
        companyId: row.company_id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        triggerKeywords: Array.isArray(row.trigger_keywords) ? row.trigger_keywords : [],
        triggerTags: Array.isArray(row.trigger_tags) ? row.trigger_tags : [],
        keywordSource: row.keyword_source || "bot",
        status: row.status || "active",
        content: row.content,
        delayHours: row.delay_hours || 24,
      };

      templates.push(templateObj);
    }

    await sqlClient.query("COMMIT");
    return templates;
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error in getFollowUpTemplates:", error);
    throw error;
  } finally {
    await safeRelease(sqlClient);
  }
}

// Add a new message to a follow-up template
app.post('/api/followup-templates/:templateId/messages', async (req, res) => {
  console.log("=== Starting POST /api/followup-templates/:templateId/messages ===");
  console.log("Template ID:", req.params.templateId);
  console.log("Request body:", JSON.stringify(req.body, null, 2));
  
  const { templateId } = req.params;
  const {
    message,
    dayNumber = 1,
    sequence = 1,
    status = 'active',
    createdAt,
    document = null,
    image = null,
    video = null,
    delayAfter = null,
    specificNumbers = null,
    useScheduledTime = false,
    scheduledTime = '',
    addTags = [],
    removeTags = []
  } = req.body;

  // Validation
  if (!templateId) {
    console.error("Missing templateId");
    return res.status(400).json({ success: false, message: 'Missing templateId' });
  }
  
  if (!message || !message.trim()) {
    console.error("Missing or empty message content");
    return res.status(400).json({ success: false, message: 'Message content is required' });
  }

  if (!dayNumber || dayNumber < 0) {
    console.error("Invalid day number");
    return res.status(400).json({ success: false, message: 'Day number must be a positive number' });
  }

  if (!sequence || sequence < 1) {
    console.error("Invalid sequence number");
    return res.status(400).json({ success: false, message: 'Sequence number must be at least 1' });
  }

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");
    console.log("Database transaction started");

    // First, verify the template exists - CAST templateId to VARCHAR to match the column type
    const templateCheckQuery = `
      SELECT id, template_id, company_id, name 
      FROM public.followup_templates 
      WHERE template_id = $1::character varying AND status = 'active'
    `;
    console.log("Checking if template exists with ID:", templateId);
    const templateCheckResult = await sqlClient.query(templateCheckQuery, [templateId]);
    
    if (templateCheckResult.rows.length === 0) {
      console.error(`Template not found: ${templateId}`);
      await safeRollback(sqlClient);
      return res.status(404).json({ 
        success: false, 
        message: 'Template not found or inactive' 
      });
    }

    const template = templateCheckResult.rows[0];
    console.log("Template found:", template);

    // Check for duplicate message (same day and sequence) - CAST templateId to VARCHAR
    const duplicateCheckQuery = `
      SELECT id FROM public.followup_messages 
      WHERE template_id = $1::character varying AND day_number = $2 AND sequence = $3 AND status = 'active'
    `;
    console.log("Checking for duplicate message...");
    const duplicateCheckResult = await sqlClient.query(duplicateCheckQuery, [
      templateId, 
      dayNumber, 
      sequence
    ]);

    if (duplicateCheckResult.rows.length > 0) {
      console.error(`Duplicate message found: day ${dayNumber}, sequence ${sequence}`);
      await safeRollback(sqlClient);
      return res.status(409).json({ 
        success: false, 
        message: 'A message with this day and sequence number already exists' 
      });
    }

    // Insert the new message - CAST templateId to VARCHAR
    const insertMessageQuery = `
      INSERT INTO public.followup_messages (
        id,
        template_id,
        message,
        day_number,
        sequence,
        status,
        created_at,
        document,
        image,
        video,
        delay_after,
        specific_numbers,
        use_scheduled_time,
        scheduled_time,
        add_tags,
        remove_tags
      ) VALUES ($1, $2::character varying, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const messageParams = [
      require('crypto').randomUUID(), // id
      templateId, // template_id (will be cast to VARCHAR)
      message.trim(), // message
      dayNumber, // day_number
      sequence, // sequence
      status, // status
      createdAt ? new Date(createdAt) : new Date(), // created_at
      document ? JSON.stringify({ url: document }) : null, // document
      image ? JSON.stringify({ url: image }) : null, // image
      video ? JSON.stringify({ url: video }) : null, // video
      delayAfter ? JSON.stringify(delayAfter) : null, // delay_after
      specificNumbers ? JSON.stringify(specificNumbers) : null, // specific_numbers
      useScheduledTime, // use_scheduled_time
      scheduledTime || null, // scheduled_time
      Array.isArray(addTags) ? addTags : [], // add_tags
      Array.isArray(removeTags) ? removeTags : [] // remove_tags
    ];

    console.log("Executing message insert with params:", messageParams);
    const messageResult = await sqlClient.query(insertMessageQuery, messageParams);
    console.log("Message inserted successfully:", messageResult.rows[0]);

    await sqlClient.query("COMMIT");
    console.log("Database transaction committed successfully");

    // Return the created message
    const createdMessage = {
      id: messageResult.rows[0].id,
      templateId: messageResult.rows[0].template_id,
      message: messageResult.rows[0].message,
      dayNumber: messageResult.rows[0].day_number,
      sequence: messageResult.rows[0].sequence,
      status: messageResult.rows[0].status,
      createdAt: messageResult.rows[0].created_at,
      document: messageResult.rows[0].document,
      image: messageResult.rows[0].image,
      video: messageResult.rows[0].video,
      delayAfter: messageResult.rows[0].delay_after,
      specificNumbers: messageResult.rows[0].specific_numbers,
      useScheduledTime: messageResult.rows[0].use_scheduled_time,
      scheduledTime: messageResult.rows[0].scheduled_time,
      addTags: messageResult.rows[0].add_tags || [],
      removeTags: messageResult.rows[0].remove_tags || []
    };

    console.log("Returning created message:", createdMessage);
    console.log("=== Completed POST /api/followup-templates/:templateId/messages ===");

    res.status(201).json({
      success: true,
      message: 'Message added successfully',
      data: createdMessage
    });

  } catch (error) {
    await safeRollback(sqlClient);
    console.error("=== Error in POST /api/followup-templates/:templateId/messages ===");
    console.error("Template ID:", templateId);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    console.error("Full error:", error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to add message',
      error: error.message
    });
  } finally {
    await safeRelease(sqlClient);
    console.log("Database client released");
  }
});

async function getMessagesForTemplate(templateId) {
  console.log("Starting getMessagesForTemplate for templateId:", templateId);
  const messages = [];
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const query = `
      SELECT 
        id,
        template_id,
        message,
        day_number,
        sequence,
        status,
        created_at,
        document,
        image,
        video,
        delay_after,
        specific_numbers,
        use_scheduled_time,
        scheduled_time,
        add_tags,
        remove_tags
      FROM 
        public.followup_messages
      WHERE 
        template_id = $1
      ORDER BY sequence ASC, day_number ASC, created_at ASC
    `;

    console.log("Fetching followup_messages...");
    const result = await sqlClient.query(query, [templateId]);
    console.log("Found followup_messages records:", result.rows.length);

    for (const row of result.rows) {
      console.log("\nProcessing message:", row.id);
      console.log("Message data:", row);

      const messageObj = {
        id: row.id,
        templateId: row.template_id,
        message: row.message,
        dayNumber: row.day_number,
        sequence: row.sequence,
        status: row.status || "active",
        createdAt: row.created_at,
        document: row.document,
        image: row.image,
        video: row.video,
        delayAfter: row.delay_after,
        specificNumbers: row.specific_numbers,
        useScheduledTime: row.use_scheduled_time,
        scheduledTime: row.scheduled_time,
        addTags: row.add_tags || [],
        removeTags: row.remove_tags || [],
      };

      console.log("Adding message object:", messageObj);
      messages.push(messageObj);
    }

    await sqlClient.query("COMMIT");
    console.log("\nFinal messages array:", messages);
    return messages;
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error in getMessagesForTemplate:", error);
    throw error;
  } finally {
    await safeRelease(sqlClient);
  }
}

// Get all follow-up templates for a company
app.get('/api/followup-templates', async (req, res) => {
  const { companyId } = req.query;
  if (!companyId) {
    return res.status(400).json({ success: false, message: 'Missing companyId' });
  }
  try {
    const templates = await getFollowUpTemplates(companyId);
    res.json({ success: true, templates });
  } catch (error) {
    console.error('Error fetching follow-up templates:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all messages for a specific follow-up template
app.get('/api/followup-templates/:templateId/messages', async (req, res) => {
  const { templateId } = req.params;
  if (!templateId) {
    return res.status(400).json({ success: false, message: 'Missing templateId' });
  }
  try {
    // You need to implement this function based on your DB structure
    const messages = await getMessagesForTemplate(templateId);
    res.json({ success: true, messages });
  } catch (error) {
    console.error('Error fetching template messages:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// Update a follow-up template
app.put('/api/followup-templates/:templateId', async (req, res) => {
  console.log("=== Starting PUT /api/followup-templates/:templateId ===");
  console.log("Template ID:", req.params.templateId);
  console.log("Request body:", JSON.stringify(req.body, null, 2));
  
  const { templateId } = req.params;
  const {
    name,
    status,
    trigger_tags = [],
    trigger_keywords = [],
    batchSettings = {}
  } = req.body;

  // Validation
  if (!templateId) {
    console.error("Missing templateId");
    return res.status(400).json({ success: false, message: 'Missing templateId' });
  }
  
  if (!name || !name.trim()) {
    console.error("Missing or empty template name");
    return res.status(400).json({ success: false, message: 'Template name is required' });
  }

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");
    console.log("Database transaction started");

    // Update the template
    const updateTemplateQuery = `
      UPDATE public.followup_templates 
      SET 
        name = $1,
        updated_at = $2,
        trigger_keywords = $3,
        trigger_tags = $4,
        status = $5
      WHERE template_id = $6
      RETURNING *
    `;

    const templateParams = [
      name.trim(),
      new Date(),
      Array.isArray(trigger_keywords) ? trigger_keywords : [],
      Array.isArray(trigger_tags) ? trigger_tags : [],
      status || 'active',
      templateId
    ];

    console.log("Executing template update with params:", templateParams);
    const templateResult = await sqlClient.query(updateTemplateQuery, templateParams);
    
    if (templateResult.rows.length === 0) {
      await sqlClient.query("ROLLBACK");
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    console.log("Template updated successfully:", templateResult.rows[0]);

    await sqlClient.query("COMMIT");
    console.log("Database transaction committed successfully");

    // Return the updated template
    const updatedTemplate = {
      id: templateResult.rows[0].id,
      templateId: templateResult.rows[0].template_id,
      companyId: templateResult.rows[0].company_id,
      name: templateResult.rows[0].name,
      createdAt: templateResult.rows[0].created_at,
      updatedAt: templateResult.rows[0].updated_at,
      triggerKeywords: templateResult.rows[0].trigger_keywords || [],
      triggerTags: templateResult.rows[0].trigger_tags || [],
      keywordSource: templateResult.rows[0].keyword_source,
      status: templateResult.rows[0].status,
      content: templateResult.rows[0].content,
      delayHours: templateResult.rows[0].delay_hours
    };

    console.log("Returning updated template:", updatedTemplate);
    console.log("=== Completed PUT /api/followup-templates/:templateId ===");

    res.status(200).json({
      success: true,
      message: 'Template updated successfully',
      template: updatedTemplate
    });

  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error("=== Error in PUT /api/followup-templates/:templateId ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to update template',
      error: error.message
    });
  } finally {
    sqlClient.release();
    console.log("Database client released");
  }
});

// Delete a follow-up template
app.delete('/api/followup-templates/:templateId', async (req, res) => {
  console.log("=== Starting DELETE /api/followup-templates/:templateId ===");
  console.log("Template ID:", req.params.templateId);
  
  const { templateId } = req.params;

  // Validation
  if (!templateId) {
    console.error("Missing templateId");
    return res.status(400).json({ success: false, message: 'Missing templateId' });
  }

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");
    console.log("Database transaction started");

    // First, delete all messages associated with this template
    const deleteMessagesQuery = `
      DELETE FROM public.followup_messages 
      WHERE template_id = $1
    `;

    console.log("Deleting messages for template:", templateId);
    const messagesResult = await sqlClient.query(deleteMessagesQuery, [templateId]);
    console.log("Deleted messages count:", messagesResult.rowCount);

    // Then delete the template
    const deleteTemplateQuery = `
      DELETE FROM public.followup_templates 
      WHERE template_id = $1
      RETURNING *
    `;

    console.log("Deleting template:", templateId);
    const templateResult = await sqlClient.query(deleteTemplateQuery, [templateId]);
    
    if (templateResult.rows.length === 0) {
      await sqlClient.query("ROLLBACK");
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    console.log("Template deleted successfully:", templateResult.rows[0]);

    await sqlClient.query("COMMIT");
    console.log("Database transaction committed successfully");

    console.log("=== Completed DELETE /api/followup-templates/:templateId ===");

    res.status(200).json({
      success: true,
      message: 'Template and associated messages deleted successfully'
    });

  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error("=== Error in DELETE /api/followup-templates/:templateId ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to delete template',
      error: error.message
    });
  } finally {
    sqlClient.release();
    console.log("Database client released");
  }
});

// Update a follow-up message
app.put('/api/followup-templates/:templateId/messages/:messageId', async (req, res) => {
  console.log("=== Starting PUT /api/followup-templates/:templateId/messages/:messageId ===");
  console.log("Template ID:", req.params.templateId);
  console.log("Message ID:", req.params.messageId);
  console.log("Request body:", JSON.stringify(req.body, null, 2));
  
  const { templateId, messageId } = req.params;
  const {
    message,
    dayNumber = 1,
    sequence = 1,
    status = 'active',
    document = null,
    image = null,
    video = null,
    delayAfter = null,
    specificNumbers = null,
    useScheduledTime = false,
    scheduledTime = '',
    addTags = [],
    removeTags = []
  } = req.body;

  // Validation
  if (!templateId || !messageId) {
    console.error("Missing templateId or messageId");
    return res.status(400).json({ success: false, message: 'Missing templateId or messageId' });
  }

  if (!message || !message.trim()) {
    console.error("Missing or empty message content");
    return res.status(400).json({ success: false, message: 'Message content is required' });
  }

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");
    console.log("Database transaction started");

    // Update the message
    const updateMessageQuery = `
      UPDATE public.followup_messages 
      SET 
        message = $1,
        day_number = $2,
        sequence = $3,
        status = $4,
        document = $5,
        image = $6,
        video = $7,
        delay_after = $8,
        specific_numbers = $9,
        use_scheduled_time = $10,
        scheduled_time = $11,
        add_tags = $12,
        remove_tags = $13,
        updated_at = $14
      WHERE id = $15 AND template_id = $16
      RETURNING *
    `;

    const messageParams = [
      message.trim(),
      dayNumber,
      sequence,
      status,
      document,
      image,
      video,
      delayAfter ? JSON.stringify(delayAfter) : null,
      specificNumbers ? JSON.stringify(specificNumbers) : null,
      useScheduledTime,
      scheduledTime,
      Array.isArray(addTags) ? addTags : [],
      Array.isArray(removeTags) ? removeTags : [],
      new Date(),
      messageId,
      templateId
    ];

    console.log("Executing message update with params:", messageParams);
    const messageResult = await sqlClient.query(updateMessageQuery, messageParams);
    
    if (messageResult.rows.length === 0) {
      await sqlClient.query("ROLLBACK");
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    console.log("Message updated successfully:", messageResult.rows[0]);

    await sqlClient.query("COMMIT");
    console.log("Database transaction committed successfully");

    // Return the updated message
    const updatedMessage = {
      id: messageResult.rows[0].id,
      templateId: messageResult.rows[0].template_id,
      message: messageResult.rows[0].message,
      dayNumber: messageResult.rows[0].day_number,
      sequence: messageResult.rows[0].sequence,
      status: messageResult.rows[0].status,
      createdAt: messageResult.rows[0].created_at,
      document: messageResult.rows[0].document,
      image: messageResult.rows[0].image,
      video: messageResult.rows[0].video,
      delayAfter: messageResult.rows[0].delay_after,
      specificNumbers: messageResult.rows[0].specific_numbers,
      useScheduledTime: messageResult.rows[0].use_scheduled_time,
      scheduledTime: messageResult.rows[0].scheduled_time,
      addTags: messageResult.rows[0].add_tags || [],
      removeTags: messageResult.rows[0].remove_tags || []
    };

    console.log("Returning updated message:", updatedMessage);
    console.log("=== Completed PUT /api/followup-templates/:templateId/messages/:messageId ===");

    res.status(200).json({
      success: true,
      message: 'Message updated successfully',
      data: updatedMessage
    });

  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error("=== Error in PUT /api/followup-templates/:templateId/messages/:messageId ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to update message',
      error: error.message
    });
  } finally {
    sqlClient.release();
    console.log("Database client released");
  }
});

// Delete a follow-up message
app.delete('/api/followup-templates/:templateId/messages/:messageId', async (req, res) => {
  console.log("=== Starting DELETE /api/followup-templates/:templateId/messages/:messageId ===");
  console.log("Template ID:", req.params.templateId);
  console.log("Message ID:", req.params.messageId);
  
  const { templateId, messageId } = req.params;

  // Validation
  if (!templateId || !messageId) {
    console.error("Missing templateId or messageId");
    return res.status(400).json({ success: false, message: 'Missing templateId or messageId' });
  }

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");
    console.log("Database transaction started");

    // Delete the message
    const deleteMessageQuery = `
      DELETE FROM public.followup_messages 
      WHERE id = $1 AND template_id = $2
      RETURNING *
    `;

    console.log("Deleting message:", messageId, "from template:", templateId);
    const messageResult = await sqlClient.query(deleteMessageQuery, [messageId, templateId]);
    
    if (messageResult.rows.length === 0) {
      await sqlClient.query("ROLLBACK");
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    console.log("Message deleted successfully:", messageResult.rows[0]);

    await sqlClient.query("COMMIT");
    console.log("Database transaction committed successfully");

    console.log("=== Completed DELETE /api/followup-templates/:templateId/messages/:messageId ===");

    res.status(200).json({
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error("=== Error in DELETE /api/followup-templates/:templateId/messages/:messageId ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to delete message',
      error: error.message
    });
  } finally {
    sqlClient.release();
    console.log("Database client released");
  }
});

async function getAIAssignResponses(companyId) {
  console.log("Starting getAIAssignResponses for companyId:", companyId);
  const responses = [];
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const query = `
      SELECT 
        response_id,
        keywords,
        keyword_source,
        assigned_employees,
        description,
        created_at,
        status
      FROM 
        public.ai_assign_responses
      WHERE 
        company_id = $1 
        AND status = 'active'
    `;

    const result = await sqlClient.query(query, [companyId]);

    for (const row of result.rows) {
      console.log("\nProcessing record:", row.response_id);

      const assignedEmployees = row.assigned_employees || [];

      if (assignedEmployees.length === 0) {
        console.log("No assigned employees found, skipping record");
        continue;
      }

      const responseObj = {
        keywords: Array.isArray(row.keywords)
          ? row.keywords
          : [row.keywords?.toLowerCase()].filter(Boolean),
        keywordSource: row.keyword_source || "user",
        assignedEmployees: assignedEmployees,
        description: row.description || "",
        createdAt: row.created_at || null,
        status: row.status || "active",
      };

      responses.push(responseObj);
    }

    await sqlClient.query("COMMIT");
    return responses;
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error in getAIAssignResponses:", error);
    console.error("Full error:", error.stack);
    throw error;
  } finally {
    await safeRelease(sqlClient);
  }
}

async function getAITagResponses(companyId) {
  const responses = [];
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const query = `
      SELECT 
        response_id,
        keywords,
        tags,
        remove_tags,
        keyword_source,
        tag_action_mode
      FROM 
        public.ai_tag_responses
      WHERE 
        company_id = $1 
        AND status = 'active'
    `;

    const result = await sqlClient.query(query, [companyId]);

    for (const row of result.rows) {
      responses.push({
        keywords: row.keywords || [],
        tags: row.tags || [],
        removeTags: row.remove_tags || [],
        keywordSource: row.keyword_source || "user",
        tagActionMode: row.tag_action_mode || "add",
      });
    }

    await sqlClient.query("COMMIT");
    return responses;
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error fetching AI tag responses:", error);
    throw error;
  } finally {
    await safeRelease(sqlClient);
  }
}

async function getAIImageResponses(companyId) {
  const responses = [];
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const query = `
      SELECT 
        response_id,
        keywords,
        image_urls,
        keyword_source,
        status
      FROM 
        public.ai_image_responses
      WHERE 
        company_id = $1 
        AND status = 'active'
    `;

    const result = await sqlClient.query(query, [companyId]);

    for (const row of result.rows) {
      responses.push({
        keywords: row.keywords || [],
        imageUrls: row.image_urls || [],
        keywordSource: row.keyword_source || "user",
      });
    }

    await sqlClient.query("COMMIT");
    return responses;
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error fetching AI image responses:", error);
    throw error;
  } finally {
    await safeRelease(sqlClient);
  }
}

async function getAIVideoResponses(companyId) {
  const responses = [];
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const query = `
      SELECT 
        response_id,
        keywords,
        video_urls,
        captions,
        keyword_source,
        status
      FROM 
        public.ai_video_responses
      WHERE 
        company_id = $1 
        AND status = 'active'
    `;

    const result = await sqlClient.query(query, [companyId]);

    for (const row of result.rows) {
      responses.push({
        keywords: row.keywords || [],
        videoUrls: row.video_urls || [],
        captions: row.captions || [],
        keywordSource: row.keyword_source || "user",
      });
    }

    await sqlClient.query("COMMIT");
    return responses;
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error fetching AI video responses:", error);
    throw error;
  } finally {
    await safeRelease(sqlClient);
  }
}

async function getAIVoiceResponses(companyId) {
  const responses = [];
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const query = `
      SELECT 
        response_id,
        keywords,
        voice_urls,
        captions,
        keyword_source
      FROM 
        public.ai_voice_responses
      WHERE 
        company_id = $1 
        AND status = 'active'
    `;

    const result = await sqlClient.query(query, [companyId]);

    for (const row of result.rows) {
      responses.push({
        keywords: row.keywords || [],
        voiceUrls: row.voice_urls || [],
        captions: row.captions || [],
        keywordSource: row.keyword_source || "user",
      });
    }

    await sqlClient.query("COMMIT");
    return responses;
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error fetching AI voice responses:", error);
    throw error;
  } finally {
    await safeRelease(sqlClient);
  }
}

async function getAIDocumentResponses(companyId) {
  const responses = [];
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const query = `
      SELECT 
        response_id,
        keywords,
        document_urls,
        document_names,
        keyword_source
      FROM 
        public.ai_document_responses
      WHERE 
        company_id = $1 
        AND status = 'active'
    `;

    const result = await sqlClient.query(query, [companyId]);

    for (const row of result.rows) {
      responses.push({
        keywords: row.keywords || [],
        documentUrls: row.document_urls || [],
        documentNames: row.document_names || [],
        keywordSource: row.keyword_source || "user",
      });
    }

    await sqlClient.query("COMMIT");
    return responses;
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error fetching AI document responses:", error);
    throw error;
  } finally {
    await safeRelease(sqlClient);
  }
}

async function checkKeywordMatch(response, message, keywordSource) {
  return (
    response.keywordSource === keywordSource &&
    response.keywords.some((kw) =>
      message.toLowerCase().includes(kw.toLowerCase())
    )
  );
}

async function checkKeywordMatchTemplate(keywords, message, tempKeywordSource, keywordSource) {
  return (
    keywordSource === tempKeywordSource &&
    keywords.some((kw) =>
      message.toLowerCase().includes(kw.toLowerCase())
    )
  );
}

// Handles AI video responses
async function handleAIVideoResponses({
  client,
  message,
  chatId,
  extractedNumber,
  idSubstring,
  contactName,
  keywordSource,
  phoneIndex,
}) {
  if (!companyConfig.status_ai_responses?.ai_video) {
    return false;
  }

  const aiVideoResponses = await getAIVideoResponses(idSubstring);

  for (const response of aiVideoResponses) {
    if (await checkKeywordMatch(response, message, keywordSource)) {
      console.log("Videos found for keywords:", response.keywords);

      for (let i = 0; i < response.videoUrls.length; i++) {
        try {
          const videoUrl = response.videoUrls[i];
          const caption = response.captions?.[i] || "";

          const media = await MessageMedia.fromUrl(videoUrl);
          if (!media) throw new Error("Failed to load video from URL");

          const videoMessage = await client.sendMessage(chatId, media, {
            caption,
            sendVideoAsGif: false,
          });
          console.log("Video message sent successfully:", videoMessage);

          await addMessageToPostgres(
            videoMessage,
            idSubstring,
            extractedNumber,
            contactName,
            phoneIndex
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Error sending video ${i}:`, error);
        }
      }
    }
  }
}

// Handles AI voice responses
async function handleAIVoiceResponses({
  client,
  message,
  chatId,
  extractedNumber,
  idSubstring,
  contactName,
  keywordSource,
  phoneIndex,
}) {
  if (!companyConfig.status_ai_responses?.ai_voice) {
    return false;
  }

  const aiVoiceResponses = await getAIVoiceResponses(idSubstring);

  for (const response of aiVoiceResponses) {
    if (await checkKeywordMatch(response, message, keywordSource)) {
      console.log("Voice messages found for keywords:", response.keywords);

      for (let i = 0; i < response.voiceUrls.length; i++) {
        try {
          const caption = response.captions?.[i] || "";
          const voiceMessage = await sendVoiceMessage(
            client,
            chatId,
            response.voiceUrls[i],
            caption
          );
          await addMessageToPostgres(
            voiceMessage,
            idSubstring,
            extractedNumber,
            contactName,
            phoneIndex
          );

          if (i < response.voiceUrls.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`Error sending voice message:`, error);
        }
      }
    }
  }
}

async function sendVoiceMessage(client, chatId, voiceUrl, caption = "") {
  try {
    console.log("Sending voice message:", { chatId, voiceUrl, caption });

    // Download the audio file
    const response = await axios.get(voiceUrl, { responseType: "arraybuffer" });
    const audioBuffer = Buffer.from(response.data);

    // Create MessageMedia object
    const media = new MessageMedia(
      "audio/mpeg", // Default MIME type for voice messages
      audioBuffer.toString("base64"),
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
    console.log("Voice message sent successfully");

    return sent;
  } catch (error) {
    console.error("Error sending voice message:", error);
    // Log detailed error information
    if (error.response) {
      console.error("Response error:", {
        status: error.response.status,
        data: error.response.data,
      });
    }
    throw new Error(`Failed to send voice message: ${error.message}`);
  }
}

// Handles AI image responses
async function handleAIImageResponses({
  client,
  message,
  chatId,
  extractedNumber,
  idSubstring,
  contactName,
  keywordSource,
  phoneIndex,
}) {
  if (!companyConfig.status_ai_responses?.ai_image) {
    return false;
  }

  const aiImageResponses = await getAIImageResponses(idSubstring);

  for (const response of aiImageResponses) {
    if (await checkKeywordMatch(response, message, keywordSource)) {
      console.log("Images found for keywords:", response.keywords);

      for (const imageUrl of response.imageUrls) {
        try {
          console.log("Sending image:", imageUrl);
          console.log("Chat ID:", chatId);
          const media = await MessageMedia.fromUrl(imageUrl);
          const imageMessage = await client.sendMessage(chatId, media);
          await addMessageToPostgres(
            imageMessage,
            idSubstring,
            extractedNumber,
            contactName,
            phoneIndex
          );
        } catch (error) {
          console.error(`Error sending image:`, error);
        }
      }
    }
  }
}

// Handles AI document responses
async function handleAIDocumentResponses({
  client,
  message,
  chatId,
  extractedNumber,
  idSubstring,
  contactName,
  keywordSource,
  phoneIndex,
}) {
  if (!companyConfig.status_ai_responses?.ai_document) {
    return false;
  }

  const aiDocumentResponses = await getAIDocumentResponses(idSubstring);

  for (const response of aiDocumentResponses) {
    if (await checkKeywordMatch(response, message, keywordSource)) {
      console.log("Documents found for keywords:", response.keywords);

      for (let i = 0; i < response.documentUrls.length; i++) {
        try {
          const documentUrl = response.documentUrls[i];
          const documentName = response.documentNames[i] || `document_${i + 1}`;

          const media = await MessageMedia.fromUrl(documentUrl);
          if (!media) throw new Error("Failed to load document from URL");

          media.filename = documentName;
          media.mimetype =
            media.mimetype ||
            getMimeTypeFromExtension(path.extname(documentName));

          const documentMessage = await client.sendMessage(chatId, media, {
            sendMediaAsDocument: true,
          });

          await addMessageToPostgres(
            documentMessage,
            idSubstring,
            extractedNumber,
            contactName,
            phoneIndex
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Error sending document:`, error);
        }
      }
    }
  }
}

// Handles AI tag responses
async function handleAITagResponses({
  message,
  extractedNumber,
  idSubstring,
  contactName,
  phoneIndex,
  keywordSource,
  followUpTemplates,
}) {
  if (!companyConfig.status_ai_responses?.ai_tag) {
    return false;
  }

  console.log("=== Starting handleAITagResponses ===");
  console.log("Message:", message);
  console.log("Extracted number:", extractedNumber);
  console.log("Company ID substring:", idSubstring);
  console.log("Contact name:", contactName);
  console.log("Phone index:", phoneIndex);
  console.log("Keyword source:", keywordSource);

  const aiTagResponses = await getAITagResponses(idSubstring);

  for (const response of aiTagResponses) {
    if (await checkKeywordMatch(response, message, keywordSource)) {
      console.log("Tags found for keywords:", response.keywords);

      try {
        if (response.tagActionMode === "delete") {
          await handleTagDeletion(
            response,
            extractedNumber,
            idSubstring,
            followUpTemplates,
          );
        } else {
          await handleTagAddition(
            response,
            extractedNumber,
            idSubstring,
            followUpTemplates,
            contactName,
            phoneIndex,
          );
        }
      } catch (error) {
        console.error(`Error handling tags:`, error);
      }
    }
  }
}

// Handles AI assignment responses
async function handleAIAssignResponses({
  client,
  message,
  extractedNumber,
  idSubstring,
  contactName,
  keywordSource,
}) {
  if (!companyConfig.status_ai_responses?.ai_assign) {
    return false;
  }

  const aiAssignResponses = await getAIAssignResponses(idSubstring);

  for (const response of aiAssignResponses) {
    if (await checkKeywordMatch(response, message, keywordSource)) {
      console.log("Assignment found for keywords:", response.keywords);

      try {
        const matchedKeyword = response.keywords.find((kw) =>
          message.toLowerCase().includes(kw.toLowerCase())
        );

        await handleEmployeeAssignment(
          response,
          idSubstring,
          extractedNumber,
          contactName,
          client,
          matchedKeyword,
        );
      } catch (error) {
        console.error(`Error handling assignment:`, error);
      }
    }
  }
}

function getMimeTypeFromExtension(ext) {
  const mimeTypes = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".zip": "application/zip",
    ".rar": "application/x-rar-compressed",
  };
  return mimeTypes[ext.toLowerCase()] || "application/octet-stream";
}

async function handleAIFollowUpResponses({
  msg,
  extractedNumber,
  idSubstring,
  contactName,
  phoneIndex,
  keywordSource,
  followUpTemplates,
}) {
  for (const template of followUpTemplates) {
    if (await checkKeywordMatchTemplate(template.triggerKeywords, msg, template.keywordSource, keywordSource)) {
      console.log("Follow-up trigger found for template:", template.name);

      try {
        await processFollowUpTemplate(
          template,
          extractedNumber,
          idSubstring,
          contactName,
          phoneIndex,
          followUpTemplates
        );
      } catch (error) {
        console.error("Error triggering follow-up sequence:", error);
      }
      return true;
    }
  }
  return false;
}

async function handleTagDeletion(
  response,
  extractedNumber,
  idSubstring,
  followUpTemplates
) {
  for (const tag of response.tags) {
    await addTagToPostgres(extractedNumber, tag, idSubstring, true);
    console.log(`Removed tag: ${tag} from number: ${extractedNumber}`);

    await handleFollowUpTemplateCleanup(
      tag,
      extractedNumber,
      idSubstring,
      followUpTemplates
    );
  }
}

async function handleTagAddition(
  response,
  extractedNumber,
  idSubstring,
  followUpTemplates,
  contactName,
  phoneIndex
) {
  console.log("=== Starting handleTagAddition ===");
  console.log("Response object:", JSON.stringify(response, null, 2));
  console.log("Extracted number:", extractedNumber);
  console.log("Company ID:", idSubstring);
  console.log("Contact name:", contactName);
  console.log("Phone index:", phoneIndex);

  try {
    // Handle tag removal first
    const tagsToRemove = response.remove_tags || response.removeTags || [];
    console.log("Tags to remove:", tagsToRemove);

    for (const tagToRemove of tagsToRemove) {
      console.log(`Processing tag removal: ${tagToRemove}`);
      try {
        await addTagToPostgres(extractedNumber, tagToRemove, idSubstring, true);
        console.log(`Successfully removed tag: ${tagToRemove}`);
        
        await handleFollowUpTemplateCleanup(
          tagToRemove,
          extractedNumber,
          idSubstring,
          followUpTemplates
        );
        console.log(`Successfully cleaned up followup templates for removed tag: ${tagToRemove}`);
      } catch (error) {
        console.error(`Error removing tag ${tagToRemove}:`, error);
      }
    }

    // Handle tag addition
    const tagsToAdd = response.tags || response.add_tags || response.addTags || [];
    console.log("Tags to add:", tagsToAdd);

    for (const tag of tagsToAdd) {
      console.log(`Processing tag addition: ${tag}`);
      try {
        await addTagToPostgres(extractedNumber, tag, idSubstring);
        console.log(`Successfully added tag: ${tag} for number: ${extractedNumber}`);

        await handleFollowUpTemplateActivation(
          tag,
          extractedNumber,
          idSubstring,
          contactName,
          phoneIndex,
          followUpTemplates
        );
        console.log(`Successfully activated followup templates for added tag: ${tag}`);
      } catch (error) {
        console.error(`Error adding tag ${tag}:`, error);
      }
    }

    console.log("=== Completed handleTagAddition ===");
  } catch (error) {
    console.error("Error in handleTagAddition:", error);
    console.error("Full error stack:", error.stack);
    throw error;
  }
}

async function addTagToPostgres(contactID, tag, companyID, remove = false) {
  console.log(`=== Starting addTagToPostgres ===`);
  console.log(`Action: ${remove ? "Removing" : "Adding"} tag "${tag}"`);
  console.log(`Contact ID (input): ${contactID}`);
  console.log(`Company ID: ${companyID}`);
  console.log(`Remove flag: ${remove}`);

  // Construct the full contact ID
  const fullContactID = companyID + "-" + (contactID.startsWith("+") ? contactID.slice(1) : contactID);
  console.log(`Full contact ID: ${fullContactID}`);

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");
    console.log("Database transaction started");

    // Check if contact exists
    const checkQuery = `
      SELECT 1 FROM public.contacts 
      WHERE contact_id = $1 AND company_id = $2
    `;
    console.log("Checking if contact exists...");
    const checkResult = await sqlClient.query(checkQuery, [fullContactID, companyID]);
    console.log(`Contact check result: ${checkResult.rows.length} rows found`);

    if (checkResult.rows.length === 0) {
      console.error(`Contact does not exist: ${fullContactID} in company ${companyID}`);
      throw new Error("Contact does not exist!");
    }

    console.log("Contact exists, proceeding with tag operation");

    if (remove) {
      console.log("Executing tag removal...");
      
      // First check if tag exists
      const tagExistsQuery = `
        SELECT (tags ? $1::text) AS tag_exists 
        FROM public.contacts 
        WHERE contact_id = $2 AND company_id = $3
      `;
      const tagExistsResult = await sqlClient.query(tagExistsQuery, [
        tag,
        fullContactID,
        companyID,
      ]);
      
      const tagExists = tagExistsResult.rows[0]?.tag_exists || false;
      console.log(`Tag "${tag}" exists before removal: ${tagExists}`);

      // Remove the tag
      const removeQuery = `
        UPDATE public.contacts 
        SET 
          tags = CASE 
            WHEN tags ? $1::text THEN 
              (SELECT jsonb_agg(t) FROM jsonb_array_elements_text(tags) t WHERE t != $1::text)
            ELSE 
              tags 
          END,
          last_updated = CURRENT_TIMESTAMP
        WHERE contact_id = $2 AND company_id = $3
      `;
      await sqlClient.query(removeQuery, [
        tag,
        fullContactID,
        companyID,
      ]);

      if (tagExists) {
        console.log(`Tag "${tag}" removed successfully from contact ${fullContactID}`);
        
        // Handle monthly assignment tracking for employee tags
        if (await isEmployeeTag(tag, companyID)) {
          console.log(`Decrementing monthly assignment for employee: ${tag}`);
          await decrementMonthlyAssignment(companyID, tag, sqlClient);
        }
      } else {
        console.log(`Tag "${tag}" doesn't exist for contact ${fullContactID}`);
      }
    } else {
      console.log("Executing tag addition...");
      
      // First check if tag already exists
      const tagExistsQuery = `
        SELECT (tags ? $1::text) AS tag_exists 
        FROM public.contacts 
        WHERE contact_id = $2 AND company_id = $3
      `;
      const tagExistsResult = await sqlClient.query(tagExistsQuery, [
        tag,
        fullContactID,
        companyID,
      ]);
      
      const tagExists = tagExistsResult.rows[0]?.tag_exists || false;
      console.log(`Tag "${tag}" exists before addition: ${tagExists}`);

      // Add the tag
      const addQuery = `
        UPDATE public.contacts 
        SET 
          tags = CASE 
            WHEN tags IS NULL THEN jsonb_build_array($1::text)
            WHEN NOT tags ? $1::text THEN tags || jsonb_build_array($1::text)
            ELSE tags
          END,
          last_updated = CURRENT_TIMESTAMP
        WHERE contact_id = $2 AND company_id = $3
      `;
      await sqlClient.query(addQuery, [
        tag,
        fullContactID,
        companyID,
      ]);

      if (!tagExists) {
        console.log(`Tag "${tag}" added successfully to contact ${fullContactID}`);
        
        // Handle monthly assignment tracking for employee tags
        if (await isEmployeeTag(tag, companyID)) {
          console.log(`Incrementing monthly assignment for employee: ${tag}`);
          await incrementMonthlyAssignment(companyID, tag, sqlClient);
        }
      } else {
        console.log(`Tag "${tag}" already exists for contact ${fullContactID}`);
      }
    }

    await sqlClient.query("COMMIT");
    console.log("Database transaction committed successfully");
  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error("Error managing tags in PostgreSQL:", error);
    console.error("Full error stack:", error.stack);
    throw error;
  } finally {
    sqlClient.release();
    console.log("Database client released");
    console.log(`=== Completed addTagToPostgres ===`);
  }
}

async function isEmployeeTag(tag, companyID) {
  console.log(`Checking if tag "${tag}" is an employee for company ${companyID}`);
  const sqlClient = await pool.connect();
  
  try {
    const query = `
      SELECT 1 FROM public.employees 
      WHERE company_id = $1 AND name = $2
    `;
    const result = await sqlClient.query(query, [companyID, tag]);
    const isEmployee = result.rows.length > 0;
    console.log(`Tag "${tag}" is employee: ${isEmployee}`);
    return isEmployee;
  } catch (error) {
    console.error("Error checking if tag is employee:", error);
    return false;
  } finally {
    sqlClient.release();
  }
}

async function incrementMonthlyAssignment(companyID, employeeName, sqlClient) {
  console.log(`Incrementing monthly assignment for employee: ${employeeName}`);
  
  try {
    const currentMonth = getCurrentMonthKey();
    console.log(`Current month key: ${currentMonth}`);
    
    const upsertQuery = `
      INSERT INTO public.employee_monthly_assignments (company_id, employee_name, month, assignment_count)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (company_id, employee_name, month)
      DO UPDATE SET assignment_count = employee_monthly_assignments.assignment_count + 1
      RETURNING assignment_count
    `;
    
    const result = await sqlClient.query(upsertQuery, [companyID, employeeName, currentMonth]);
    const newCount = result.rows[0].assignment_count;
    console.log(`Monthly assignment count for ${employeeName} is now: ${newCount}`);
    
    return newCount;
  } catch (error) {
    console.error("Error incrementing monthly assignment:", error);
    throw error;
  }
}

async function decrementMonthlyAssignment(companyID, employeeName, sqlClient) {
  console.log(`Decrementing monthly assignment for employee: ${employeeName}`);
  
  try {
    const currentMonth = getCurrentMonthKey();
    console.log(`Current month key: ${currentMonth}`);
    
    const updateQuery = `
      UPDATE public.employee_monthly_assignments 
      SET assignment_count = GREATEST(assignment_count - 1, 0)
      WHERE company_id = $1 AND employee_name = $2 AND month = $3
      RETURNING assignment_count
    `;
    
    const result = await sqlClient.query(updateQuery, [companyID, employeeName, currentMonth]);
    
    if (result.rows.length > 0) {
      const newCount = result.rows[0].assignment_count;
      console.log(`Monthly assignment count for ${employeeName} is now: ${newCount}`);
      return newCount;
    } else {
      console.log(`No monthly assignment record found for ${employeeName} in ${currentMonth}`);
      return 0;
    }
  } catch (error) {
    console.error("Error decrementing monthly assignment:", error);
    throw error;
  }
}

async function handleEmployeeAssignment(
  response,
  idSubstring,
  extractedNumber,
  contactName,
  client,
  matchedKeyword
) {
  const stateResult = await pool.query(
    "SELECT current_index FROM bot_state WHERE company_id = $1 AND bot_name = $2",
    [idSubstring, "assignmentState"]
  );
  let currentIndex = stateResult.rows[0]?.current_index || 0;

  const employeeIDs = response.assignedEmployees;
  if (employeeIDs.length === 0) {
    console.log("No employees available for assignment");
    return;
  }

  const nextID = employeeIDs[currentIndex % employeeIDs.length];
  const employeeResult = await pool.query(
    "SELECT * FROM employees WHERE company_id = $1 AND id = $2",
    [idSubstring, nextID]
  );

  if (employeeResult.rows.length > 0) {
    const employeeData = employeeResult.rows[0];
    await assignToEmployee(
      employeeData,
      "Sales",
      extractedNumber,
      contactName,
      client,
      idSubstring,
      matchedKeyword
    );

    const newIndex = (currentIndex + 1) % employeeIDs.length;
    await pool.query(
      "INSERT INTO bot_state (company_id, bot_name, state, current_index, last_updated) " +
        "VALUES ($1, $2, $3, $4, $5) " +
        "ON CONFLICT (company_id, bot_name) DO UPDATE SET current_index = $4, last_updated = $5",
      [
        idSubstring,
        "assignmentState",
        { currentIndex: newIndex },
        newIndex,
        new Date(),
      ]
    );
  }
}

async function assignToEmployee(
  employee,
  role,
  contactID,
  contactName,
  client,
  idSubstring,
  triggerKeyword = "",
  phoneIndex = 0
) {
  const rawNumber = employee.phone_number?.replace(/\D/g, '');
  const employeeID = rawNumber ? rawNumber + "@c.us" : null;

  // Get current date and time in Malaysia timezone
  const currentDateTime = new Date().toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "medium",
  });

  const message =
    idSubstring === "0245"
      ? `Hello ${employee.name}, a new contact has been assigned to you:

Name: ${contactName}
Phone: ${contactID}
     
Triggered keyword: ${
          triggerKeyword ? `*${triggerKeyword}*` : "[No keyword trigger found]"
        }
     
Date & Time: ${currentDateTime}`
      : idSubstring === "0335"
      ? `Hello ${employee.name}, a new contact has been assigned to you:

Name: ${contactName}
Phone: ${contactID}

Thank you.`
      : `Hello ${employee.name}, a new contact has been assigned to you:

Name: ${contactName}
Phone: ${contactID}

Kindly login to the CRM software to continue.

Thank you.`;

  // Send WhatsApp message to employee
  await client.sendMessage(employeeID, message);
  
  // Add employee name as tag to contact
  await addTagToPostgres(contactID, employee.name, idSubstring);
  
  // Create assignment record in assignments table
  try {
    const sqlClient = await pool.connect();
    try {
      await sqlClient.query("BEGIN");

      // Get contact details
      const contactQuery = `
        SELECT contact_id FROM contacts 
        WHERE phone = $1 AND company_id = $2
      `;
      const contactResult = await sqlClient.query(contactQuery, [contactID, idSubstring]);
      
      if (contactResult.rows.length > 0) {
        const currentDate = new Date();
        const currentMonthKey = `${currentDate.getFullYear()}-${(
          currentDate.getMonth() + 1
        ).toString().padStart(2, "0")}`;

        const assignmentId = `${idSubstring}-${contactResult.rows[0].contact_id}-${employee.employee_id}-${Date.now()}`;
        
        const assignmentInsertQuery = `
          INSERT INTO assignments (
            assignment_id, company_id, employee_id, contact_id, 
            assigned_at, status, month_key, assignment_type, 
            phone_index, weightage_used, employee_role
          ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'active', $5, 'auto', $6, 1, $7)
        `;
        
        await sqlClient.query(assignmentInsertQuery, [
          assignmentId,
          idSubstring,
          employee.employee_id,
          contactResult.rows[0].contact_id,
          currentMonthKey,
          phoneIndex,
          role
        ]);

        // Update employee's assigned_contacts count
        const employeeUpdateQuery = `
          UPDATE employees
          SET assigned_contacts = assigned_contacts + 1
          WHERE company_id = $1 AND employee_id = $2
        `;
        
        await sqlClient.query(employeeUpdateQuery, [idSubstring, employee.employee_id]);

        // Update monthly assignments
        const monthlyAssignmentUpsertQuery = `
          INSERT INTO employee_monthly_assignments (employee_id, company_id, month_key, assignments_count, last_updated)
          VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP)
          ON CONFLICT (employee_id, month_key) DO UPDATE
          SET assignments_count = employee_monthly_assignments.assignments_count + 1,
              last_updated = CURRENT_TIMESTAMP
        `;
        
        await sqlClient.query(monthlyAssignmentUpsertQuery, [
          employee.id,
          idSubstring,
          currentMonthKey
        ]);
      }

      await sqlClient.query("COMMIT");
    } catch (error) {
      await safeRollback(sqlClient);
      console.error("Error creating assignment record:", error);
    } finally {
      await safeRelease(sqlClient);
    }
  } catch (error) {
    console.error("Error in assignToEmployee database operations:", error);
  }
  
  console.log(`Assigned ${role}: ${employee.name}`);
}

async function processFollowUpTemplate(
  template,
  extractedNumber,
  idSubstring,
  contactName,
  phoneIndex,
  followUpTemplates
) {
  const contactResult = await pool.query(
    "SELECT tags FROM contacts WHERE company_id = $1 AND phone = $2",
    [idSubstring, extractedNumber]
  );
  const contactData = contactResult.rows[0];
  const currentTags = contactData?.tags || [];

  for (const otherTemplate of followUpTemplates) {
    const tagToRemove = otherTemplate.trigger_tags?.[0];
    if (tagToRemove && currentTags.includes(tagToRemove)) {
      await addTagToPostgres(extractedNumber, tagToRemove, idSubstring, true);
      await callFollowUpAPI(
        "removeTemplate",
        extractedNumber,
        contactName,
        phoneIndex,
        otherTemplate.id,
        idSubstring
      );
    }
  }

  if (template.trigger_tags.length > 0) {
    await addTagToPostgres(
      extractedNumber,
      template.trigger_tags[0],
      idSubstring
    );
  }

  await callFollowUpAPI(
    "startTemplate",
    extractedNumber,
    contactName,
    phoneIndex,
    template.id,
    idSubstring
  );
}

async function handleFollowUpTemplateCleanup(
  tag,
  extractedNumber,
  idSubstring,
  followUpTemplates
) {
  for (const template of followUpTemplates) {
    if (template.trigger_tags && template.trigger_tags.includes(tag)) {
      await callFollowUpAPI(
        "removeTemplate",
        extractedNumber,
        null,
        null,
        template.id,
        idSubstring
      );
    }
  }
}

async function handleFollowUpTemplateActivation(
  tag,
  extractedNumber,
  idSubstring,
  contactName,
  phoneIndex,
  followUpTemplates
) {
  console.log("=== Starting handleFollowUpTemplateActivation ===");
  console.log("Tag:", tag);
  console.log("Extracted number:", extractedNumber);
  console.log("Company ID:", idSubstring);
  console.log("Contact name:", contactName);
  console.log("Phone index:", phoneIndex);
  console.log("Number of templates:", followUpTemplates);
  
  for (const template of followUpTemplates) {
    console.log(`\n--- Checking template: ${template.name} ---`);
    console.log("Template ID:", template.templateId);
    console.log("Template UUID:", template.id);
    console.log("Trigger tags:", template.triggerTags);
    console.log("Is trigger_tags array?", Array.isArray(template.triggerTags));
    console.log("Tag to match:", tag);
    console.log("Includes check:", template.triggerTags && template.triggerTags.includes(tag));
    
    if (template.triggerTags && template.triggerTags.includes(tag)) {
      console.log(`✓ Template "${template.name}" matches tag "${tag}"`);
      await callFollowUpAPI(
        "startTemplate",
        extractedNumber,
        contactName,
        phoneIndex,
        template.templateId, // Fixed: use templateId instead of id
        idSubstring
      );
    } else {
      console.log(`✗ Template "${template.name}" does not match tag "${tag}"`);
    }
  } 
  console.log("=== Completed handleFollowUpTemplateActivation ===");
}

// Get scheduled messages for a company
app.get('/api/scheduled-messages', async (req, res) => {  
  const { companyId, status } = req.query;
  
  console.log(`Fetching scheduled messages for companyId: ${companyId}, status: ${status || 'all'}`);
  
  // Validation
  if (!companyId) {
    console.error("Missing companyId parameter");
    return res.status(400).json({ success: false, message: 'Missing companyId parameter' });
  }

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    // Build the query based on status filter
    let query = `
      SELECT 
        id,
        schedule_id,
        company_id,
        contact_id,
        contact_ids,
        multiple,
        message_content,
        media_url,
        scheduled_time,
        status,
        attempt_count,
        last_attempt,
        created_at,
        sent_at,
        phone_index,
        from_me
      FROM scheduled_messages 
      WHERE company_id = $1
      AND id::text = schedule_id
    `;
    
    const queryParams = [companyId];
    let paramIndex = 2;

    // Add status filter if provided
    if (status && status !== 'all') {
      let dbStatus = status;      
      query += ` AND status = $${paramIndex}`;
      queryParams.push(dbStatus);
      paramIndex++;
    }

    // Order by scheduled_time (earliest first)
    query += ` ORDER BY scheduled_time ASC`;
    const { rows } = await sqlClient.query(query, queryParams);

    // Transform the data to match frontend expectations
    const messages = rows.map(row => {
      let contactIds = null;
      if (row.contact_ids) {
        try {
          contactIds = Array.isArray(row.contact_ids)
          ? row.contact_ids
          : JSON.parse(row.contact_ids);
        } catch (e) {
          contactIds = [row.contact_ids];
        }
      }
      return {
        id: row.id,
        scheduleId: row.schedule_id,
        companyId: row.company_id,
        contactId: row.contact_id,
        contactIds: contactIds,
        multiple: row.multiple,
        messageContent: row.message_content,
        mediaUrl: row.media_url,
        scheduledTime: row.scheduled_time,
        status: row.status,
        attemptCount: row.attempt_count,
        lastAttempt: row.last_attempt,
        createdAt: row.created_at,
        sentAt: row.sent_at,
        phoneIndex: row.phone_index,
        fromMe: row.from_me
      };
    });

    await sqlClient.query("COMMIT");
        
    res.json({ 
      success: true, 
      messages: messages,
      count: messages.length
    });

  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error fetching scheduled messages:", error);
    console.error("Full error:", error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch scheduled messages',
      error: error.message 
    });
  } finally {
    await safeRelease(sqlClient);
  }
});

// New API: Get scheduled messages for a single contact
app.get('/api/scheduled-messages/contact', async (req, res) => {
  const { companyId, contactId, status } = req.query;
  
  console.log(`Fetching scheduled messages for companyId: ${companyId}, contactId: ${contactId}, status: ${status || 'all'}`);

  if (!companyId || !contactId) {
    return res.status(400).json({ success: false, message: 'Missing companyId or contactId parameter' });
  }

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    let query = `
      SELECT 
        id,
        schedule_id,
        company_id,
        contact_id,
        contact_ids,
        multiple,
        message_content,
        media_url,
        scheduled_time,
        status,
        attempt_count,
        last_attempt,
        created_at,
        sent_at,
        phone_index,
        from_me
      FROM scheduled_messages 
      WHERE company_id = $1
      AND id::text = schedule_id
      AND (
        contact_id = $2 
        OR 
        (contact_ids IS NOT NULL AND contact_ids::jsonb ? $2)
      )
    `;
    const queryParams = [companyId, contactId];
    let paramIndex = 3;

    if (status && status !== 'all') {
      query += ` AND status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    query += ` ORDER BY scheduled_time ASC`;
    const { rows } = await sqlClient.query(query, queryParams);

    const messages = rows.map(row => {
      let contactIds = null;
      if (row.contact_ids) {
        try {
          contactIds = Array.isArray(row.contact_ids)
            ? row.contact_ids
            : JSON.parse(row.contact_ids);
        } catch (e) {
          contactIds = [row.contact_ids];
        }
      }
      return {
        id: row.id,
        scheduleId: row.schedule_id,
        companyId: row.company_id,
        contactId: row.contact_id,
        contactIds: contactIds,
        multiple: row.multiple,
        messageContent: row.message_content,
        mediaUrl: row.media_url,
        scheduledTime: row.scheduled_time,
        status: row.status,
        attemptCount: row.attempt_count,
        lastAttempt: row.last_attempt,
        createdAt: row.created_at,
        sentAt: row.sent_at,
        phoneIndex: row.phone_index,
        fromMe: row.from_me
      };
    });

    await sqlClient.query("COMMIT");
    
    console.log(`Returning ${messages.length} main scheduled messages for contactId: ${contactId} (excluding batch entries)`);

    res.json({
      success: true,
      messages: messages,
      count: messages.length
    });

  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error fetching scheduled messages for contact:", error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch scheduled messages for contact',
      error: error.message
    });
  } finally {
    await safeRelease(sqlClient);
  }
});

async function callFollowUpAPI(
  action,
  phone,
  contactName,
  phoneIndex,
  templateId,
  idSubstring
) {
  try {
    const response = await fetch(`${process.env.URL}/api/tag/followup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestType: action,
        phone: phone,
        first_name: contactName || phone,
        phoneIndex: phoneIndex || 0,
        templateId: templateId,
        idSubstring: idSubstring
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`Successfully completed ${action} for template ${templateId} via API`);
    return result;

  } catch (error) {
    console.error(`Error in callFollowUpAPI for ${action}:`, error);
    throw error;
  }
}

app.get("/api/storage-pricing", async (req, res) => {
  let client;
  try {
    client = await pool.connect();

    const companyId = "0123";
    const category = "storage";

    const query = `
      SELECT pricing_data 
      FROM pricing 
      WHERE company_id = $1 AND category = $2
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    const { rows } = await client.query(query, [companyId, category]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Pricing data not found" });
    }

    const pricingData = rows[0].pricing_data;
    res.json({ success: true, data: pricingData });
  } catch (error) {
    console.error("Error fetching storage pricing:", error);
    res.status(500).json({ error: "Failed to fetch pricing data" });
  } finally {
    if (client) await safeRelease(client);
  }
});

async function handleOpenAIMyMessage(message, threadID) {
  query = `You sent this to the user: ${message}. Please remember this for the next interaction. Do not re-send this query to the user, this is only for you to remember the interaction.`;
  await addMessageAssistant(threadID, query);
}

async function addMessageAssistant(threadId, message) {
  const response = await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: message,
  });
  return response;
}

async function addMessageToPostgres(
  msg,
  idSubstring,
  extractedNumber,
  contactName,
  phoneIndex = 0,
  userName
) {
  // Validate inputs
  if (!extractedNumber || !extractedNumber.startsWith("+")) {
    console.error("Invalid extractedNumber for database:", extractedNumber);
    return;
  }

  if (!idSubstring) {
    console.error("Invalid idSubstring for database");
    return;
  }

  // Prepare contact ID
  const contactID = idSubstring + "-" + 
    (extractedNumber.startsWith("+") ? extractedNumber.slice(1) : extractedNumber);

  // Extract all message data using modular functions
  const basicInfo = await extractBasicMessageInfo(msg);
  const messageData = await prepareMessageData(msg, idSubstring, phoneIndex);

  // Get message body (with audio transcription if applicable)
  let messageBody = messageData.text?.body || "";
  if (msg.hasMedia && (msg.type === "audio" || msg.type === "ptt")) {
    console.log("Voice message detected during saving to NeonDB");
    const media = await msg.downloadMedia();
    const transcription = await transcribeAudio(media.data);

    if (transcription && transcription !== "Audio transcription failed. Please try again.") {
      messageBody += transcription;
    } else {
      messageBody += "I couldn't transcribe the audio. Could you please type your message instead?";
    }
  }

  // Prepare media data
  let mediaUrl = null;
  let mediaData = null;
  let mediaMetadata = {};

  if (msg.hasMedia) {
    if (msg.type === "video") {
      mediaUrl = messageData.video?.link || null;
    } else if (msg.type !== "audio" && msg.type !== "ptt") {
      const mediaTypeData = messageData[msg.type];
      if (mediaTypeData) {
        mediaData = mediaTypeData.data || null;
        mediaUrl = mediaTypeData.link || null;
        mediaMetadata = {
          mimetype: mediaTypeData.mimetype,
          filename: mediaTypeData.filename || "",
          caption: mediaTypeData.caption || "",
          thumbnail: mediaTypeData.thumbnail || null,
          mediaKey: mediaTypeData.media_key || null,
          ...(msg.type === "image" && {
            width: mediaTypeData.width,
            height: mediaTypeData.height
          }),
          ...(msg.type === "document" && {
            pageCount: mediaTypeData.page_count,
            fileSize: mediaTypeData.file_size
          })
        };
      }
    } else if (msg.type === "audio" || msg.type === "ptt") {
      mediaData = messageData.audio?.data || null;
    }
  }

  // Prepare quoted message
  const quotedMessage = messageData.text?.context || null;

  // Determine author
  let author = userName;
  if (!author && msg.from.includes("@g.us") && basicInfo.author) {
    const authorData = await getContactDataFromDatabaseByPhone(basicInfo.author, idSubstring);
    author = authorData ? authorData.contactName : basicInfo.author;
  }

  // Database operations
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Create/update contact
      const contactCheckQuery = `
        SELECT id FROM public.contacts 
        WHERE contact_id = $1 AND company_id = $2
      `;
      const contactResult = await client.query(contactCheckQuery, [contactID, idSubstring]);

      if (contactResult.rows.length === 0) {
        console.log(`Creating new contact: ${contactID} for company: ${idSubstring}`);
        const contactQuery = `
          INSERT INTO public.contacts (
            contact_id, company_id, name, contact_name, phone, email,
            thread_id, profile, points, tags, reaction, reaction_timestamp,
            last_updated, edited, edited_at, whapi_token, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (contact_id, company_id) DO UPDATE
          SET name = EXCLUDED.name,
              contact_name = EXCLUDED.contact_name,
              phone = EXCLUDED.phone,
              last_updated = EXCLUDED.last_updated
        `;
        await client.query(contactQuery, [
          contactID,
          idSubstring,
          extractedNumber,
          extractedNumber,
          extractedNumber,
          "",
          msg.from,
          {},
          0,
          [],
          null,
          null,
          new Date(),
          false,
          null,
          null,
          new Date(),
        ]);
        console.log(`Contact created successfully: ${contactID}`);
      }

      // Insert message
     // ... existing code ...
      // Insert message
      const messageQuery = `
        INSERT INTO public.messages (
          message_id, company_id, contact_id, content, message_type,
          media_url, media_data, media_metadata, timestamp, direction,
          status, from_me, chat_id, author, phone_index, quoted_message,
          thread_id, customer_phone
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (message_id) DO NOTHING
        RETURNING id
      `;
// ... existing code ...
      const messageValues = [
        basicInfo.idSerialized,
        idSubstring,
        contactID,
        messageBody,
        basicInfo.type,
        mediaUrl,
        mediaData,
        Object.keys(mediaMetadata).length > 0 ? JSON.stringify(mediaMetadata) : null,
        new Date(basicInfo.timestamp * 1000),
        msg.fromMe ? "outbound" : "inbound",
        "delivered",
        msg.fromMe || false,
        msg.from,
        author || contactID,
        phoneIndex,
        quotedMessage ? JSON.stringify(quotedMessage) : null,
        msg.to,
        extractedNumber
      ];

      await client.query(messageQuery, messageValues);

      await client.query("COMMIT");
      console.log(`Message successfully added to PostgreSQL with ID: ${basicInfo.idSerialized}`);
      return { type: basicInfo.type };
    } catch (error) {
      await safeRollback(client);
      console.error("Error in PostgreSQL transaction:", error);
      throw error;
    } finally {
      await safeRelease(client);
      await addNotificationToUser(idSubstring, messageBody, contactName);
    }
  } catch (error) {
    console.error("PostgreSQL connection error:", error);
    throw error;
  }
}

async function addNotificationToUser(companyId, message, contactName) {
  console.log("Adding notification and sending FCM");
  try {
    const client = await pool.connect();

    try {
      const usersQuery = await client.query(
        "SELECT user_id FROM public.users WHERE company_id = $1",
        [companyId]
      );

      if (usersQuery.rows.length === 0) {
        console.log("No matching users found.");
        return;
      }

      // Fix: Handle both string and object message types
      let cleanMessage;
      if (typeof message === "string") {
        cleanMessage = { text: { body: message }, type: "text" };
      } else if (message && typeof message === "object") {
        cleanMessage = Object.fromEntries(
          Object.entries(message).filter(([_, value]) => value !== undefined)
        );
      } else {
        cleanMessage = { text: { body: "New message received" }, type: "text" };
      }

      let notificationText = cleanMessage.text?.body || "New message received";
      if (cleanMessage.hasMedia) {
        notificationText = `Media: ${cleanMessage.type || "attachment"}`;
      }

      const promises = usersQuery.rows.map(async (user) => {
        const userId = user.user_id;

        await client.query(
          `INSERT INTO public.notifications (
            company_id, user_id, title, message, type, read, message_data, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
          [
            companyId,
            userId,
            contactName,
            notificationText,
            cleanMessage.type || "message",
            false,
            JSON.stringify(cleanMessage),
          ]
        );

        console.log(
          `Notification added to PostgreSQL for user with ID: ${userId}`
        );
      });

      await Promise.all(promises);
   
    } finally {
      await safeRelease(client);
    }
  } catch (error) {
    console.error("Error adding notification or sending FCM: ", error);
  }
}

async function extractBasicMessageInfo(msg) {
  return {
    id: msg.id ?? "",
    idSerialized: msg.id._serialized ?? "",
    from: msg.from ?? "",
    fromMe: msg.fromMe ?? false,
    body: msg.body ?? "",
    timestamp: msg.timestamp ?? 0,
    type: msg.type === "chat" ? "text" : msg.type,
    deviceType: msg.deviceType ?? "",
    notifyName: msg.notifyName ?? "",
    chatId: msg.from,
    author: msg.author ? "+" + msg.author.split("@")[0] : null,
  };
}

async function processMessageMedia(msg) {
  if (!msg.hasMedia || msg.type === "audio" || msg.type === "ptt") {
    return null;
  }

  try {
    const media = await msg.downloadMedia();
    if (!media) {
      console.log(
        `Failed to download media for message: ${msg.id._serialized}`
      );
      return null;
    }

    const fileSizeBytes = Math.floor((media.data.length * 3) / 4);
    const fileSizeMB = fileSizeBytes / (1024 * 1024);
    const FILE_SIZE_LIMIT_MB = 5;

    const mediaData = {
      mimetype: media.mimetype,
      data: media.data,
      filename: msg._data.filename || media.filename || "",
      caption: msg._data.caption || media.caption || "",
    };

    switch (msg.type) {
      case "image":
        mediaData.width = msg._data.width;
        mediaData.height = msg._data.height;
        if (fileSizeMB > FILE_SIZE_LIMIT_MB) {
          mediaData.link = await storeMediaData(media.data, mediaData.filename, media.mimetype);
          delete mediaData.data;
        }
        break;
      case "document":
        mediaData.page_count = msg._data.pageCount;
        mediaData.file_size = msg._data.size;
        if (fileSizeMB > FILE_SIZE_LIMIT_MB) {
          mediaData.link = await storeMediaData(media.data, mediaData.filename, media.mimetype);
          delete mediaData.data;
        }
        break;
      case "video":
        mediaData.link = await storeMediaData(media.data, mediaData.filename, media.mimetype);
        delete mediaData.data;
        break;
      default:
        if (fileSizeMB > FILE_SIZE_LIMIT_MB) {
          mediaData.link = await storeMediaData(media.data, mediaData.filename, media.mimetype);
          delete mediaData.data;
        } else {
          mediaData.link = null;
        }
        break;
    }

    if (msg._data.thumbnailHeight && msg._data.thumbnailWidth) {
      mediaData.thumbnail = {
        height: msg._data.thumbnailHeight,
        width: msg._data.thumbnailWidth,
      };
    }

    if (msg.mediaKey) {
      mediaData.media_key = msg.mediaKey;
    }

    return mediaData;
  } catch (error) {
    console.error(
      `Error handling media for message ${msg.id._serialized}:`,
      error
    );
    return null;
  }
}

async function processAudioMessage(msg) {
  if (msg.type !== "audio" && msg.type !== "ptt") {
    return null;
  }

  const media = await msg.downloadMedia();

  return {
    mimetype: "audio/ogg; codecs=opus",
    data: media.data,
  };
}

async function processLocationMessage(msg) {
  if (msg.type !== "location") {
    return null;
  }

  return {
    latitude: msg.location.latitude,
    longitude: msg.location.longitude,
    description: msg.location.description || "",
    timestamp: new Date(),
  };
}

async function processQuotedMessage(msg, idSubstring) {
  if (!msg.hasQuotedMsg) {
    return null;
  }

  const quotedMsg = await msg.getQuotedMessage();
  const authorNumber = "+" + quotedMsg.from.split("@")[0];
  const authorData = await getContactDataFromDatabaseByPhone(
    authorNumber,
    idSubstring
  );
  let authorName = authorData ? authorData.contactName : authorNumber;
  if (quotedMsg.fromMe) {
    authorName = "Me";
  }

  return {
    quoted_content: {
      body: quotedMsg.body,
    },
    quoted_author: authorName,
    message_id: quotedMsg.id._serialized,
    message_type: quotedMsg.type,
  };
}

async function processOrderMessage(msg) {
  if (msg.type !== "order") {
    return null;
  }

  return {
    order_id: msg?.orderId,
    token: msg?.token,
    seller_jid: msg?._data?.sellerJid,
    item_count: msg?._data?.itemCount,
    order_title: msg?._data?.orderTitle,
    total_amount: msg?._data?.totalAmount1000,
    total_currency_code: msg?._data?.totalCurrencyCode,
    thumbnail: msg?._data?.thumbnail,
  };
}

async function prepareMessageData(msg, idSubstring, phoneIndex) {
  const basicInfo = await extractBasicMessageInfo(msg);
  const contact = await msg.getContact();
  const chat = await msg.getChat();

  const messageData = {
    chat_id: basicInfo.chatId,
    from: basicInfo.from,
    from_me: basicInfo.fromMe,
    id: basicInfo.id,
    source: basicInfo.deviceType,
    status: "delivered",
    text: {
      body: basicInfo.body,
    },
    timestamp: basicInfo.timestamp,
    type: basicInfo.type,
    phone_index: phoneIndex,
  };

  // Process media if present
  if (msg.hasMedia) {
    const mediaData = await processMessageMedia(msg);
    if (mediaData) {
      messageData[msg.type] = mediaData;
    }
  }

  // Process audio separately
  const audioData = await processAudioMessage(msg);
  if (audioData) {
    messageData.audio = audioData;
  }

  // Process location
  const locationData = await processLocationMessage(msg);
  if (locationData) {
    messageData.location = locationData;
  }

  // Process quoted message
  const quotedData = await processQuotedMessage(msg, idSubstring);
  if (quotedData) {
    messageData.text.context = quotedData;
  }

  // Process order message
  const orderData = await processOrderMessage(msg);
  if (orderData) {
    messageData.order = orderData;
  }

  // Handle group messages
  if (basicInfo.from.includes("@g.us") && basicInfo.author) {
    const authorData = await getContactDataFromDatabaseByPhone(
      basicInfo.author,
      idSubstring
    );
    messageData.author = authorData ? authorData.name : basicInfo.author;
  }

  return messageData;
}

async function transcribeAudio(audioData) {
  try {
    const formData = new FormData();
    formData.append("file", Buffer.from(audioData, "base64"), {
      filename: "audio.ogg",
      contentType: "audio/ogg",
    });
    formData.append("model", "whisper-1");
    formData.append("response_format", "json");

    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAIKEY}`,
        },
      }
    );

    return response.data.text;
  } catch (error) {
    console.error("Error transcribing audio:", error);
    return "";
  }
}

async function storeMediaData(mediaData, filename, mimeType) {
  try {
    const buffer = Buffer.from(mediaData, 'base64');
    const stream = Readable.from(buffer);

    // Try to determine mimeType and extension if not provided
    if (!mimeType) {
      // Try to guess from filename
      if (filename) {
        mimeType = mime.lookup(filename) || 'application/octet-stream';
      } else {
        mimeType = 'application/octet-stream';
      }
    }

    // If filename is missing or has no extension, generate one from mimeType
    if (!filename || !filename.includes('.')) {
      const ext = mime.extension(mimeType) || 'bin';
      filename = `document-${Date.now()}.${ext}`;
    }

    const formData = new FormData();
    formData.append('file', stream, {
      filename: filename,
      contentType: mimeType,
      knownLength: buffer.length
    });

    const response = await axios.post(`${process.env.URL}/api/upload-media`, formData, {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    return response.data.url;
  } catch (error) {
    console.error('Error uploading document:', error);
    throw error;
  }
}

app.delete("/api/auth/user", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required in request body" });
  }

  try {
    // Get the user by email
    const userRecord = await admin.auth().getUserByEmail(email);

    // Delete the user
    await admin.auth().deleteUser(userRecord.uid);

    // Also delete the user's data from Firestore if needed
    await db.collection("user").doc(email).delete();

    // console.log(`Successfully deleted user with email: ${email}`);
    res.json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);

    if (error.code === "auth/user-not-found") {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(500).json({
      error: "Failed to delete user",
      code: error.code,
      message: error.message,
    });
  }
});

async function saveContactWithRateLimit(
  botName,
  contact,
  chat,
  phoneIndex,
  retryCount = 0
) {
  try {
    let phoneNumber = contact.number;
    let contactID = contact.id._serialized;
    const msg = chat.lastMessage || {};
    if (Object.keys(msg).length === 0) {
      return; // Skip if there's no last message
    }

    let idsuffix = chat.isGroup ? "@g.us" : "@c.us";
    if (chat.isGroup) {
      phoneNumber = contactID.split("@")[0];
    }

    if (contactID === "0@c.us" || phoneNumber === "status") {
      return; // Skip system contacts
    }

    const extractedNumber = "+" + contactID.split("@")[0];
    //console.log(`Saving contact: ${extractedNumber} with contactID: ${contactID}`);

    // Fetch existing contact data
    const existingContact = await getContactDataFromDatabaseByPhone(
      extractedNumber,
      botName
    );
    let tags = existingContact?.tags || ["stop bot"];

    let type =
      msg.type === "chat"
        ? "text"
        : msg.type === "e2e_notification" ||
          msg.type === "notification_template"
        ? null
        : msg.type;

    if (!type) return; // Skip if message type is not valid

    const contactData = {
      additionalEmails: [],
      address1: null,
      assignedTo: null,
      businessId: null,
      phone: extractedNumber,
      tags: tags,
      chat: {
        contact_id: "+" + phoneNumber,
        id: contactID || contact.id.user + idsuffix,
        name: contact.name || contact.pushname || chat.name || phoneNumber,
        not_spam: true,
        tags: tags,
        timestamp: chat.timestamp || Date.now(),
        type: "contact",
        unreadCount: chat.unreadCount || 0,
        last_message: {
          chat_id: contact.id.user + idsuffix,
          from: msg.from || contact.id.user + idsuffix,
          from_me: msg.fromMe || false,
          id: msg._data?.id?.id || "",
          source: chat.deviceType || "",
          status: "delivered",
          text: {
            body: msg.body || "",
          },
          timestamp: chat.timestamp || Date.now(),
          type: type,
        },
      },
      chat_id: contact.id.user + idsuffix,
      city: null,
      companyName: null,
      contactName: contact.name || contact.pushname || chat.name || phoneNumber,
      unreadCount: chat.unreadCount || 0,
      threadid: "",
      phoneIndex: phoneIndex,
      last_message: {
        chat_id: contact.id.user + idsuffix,
        from: msg.from || contact.id.user + idsuffix,
        from_me: msg.fromMe || false,
        id: msg._data?.id?.id || "",
        source: chat.deviceType || "",
        status: "delivered",
        text: {
          body: msg.body || "",
        },
        timestamp: chat.timestamp || Date.now(),
        type: type,
      },
    };

    // Fetch profile picture URL
    try {
      contactData.profilePicUrl = (await contact.getProfilePicUrl()) || "";
    } catch (error) {
      console.error(
        `Error getting profile picture URL for ${contact.id.user}:`,
        error
      );
      contactData.profilePicUrl = "";
    }

    // Save contact data
    const contactRef = db
      .collection("companies")
      .doc(botName)
      .collection("contacts")
      .doc(extractedNumber);
    await contactRef.set(contactData, { merge: true });

    // Fetch and save messages
    const messages = await chat.fetchMessages({ limit: 20 });
    if (messages && messages.length > 0) {
      // console.log("SAVING MESSAGES")
      await saveMessages(botName, extractedNumber, messages, chat.isGroup);
    }

    // console.log(`Successfully saved contact ${extractedNumber} for bot ${botName}`);
  } catch (error) {
    console.error(`Error saving contact for bot ${botName}:`, error);
    if (retryCount < 3) {
      // console.log(`Retrying... (Attempt ${retryCount + 1})`);
      await new Promise((resolve) => setTimeout(resolve, 1000(retryCount + 1)));
      await saveContactWithRateLimit(
        botName,
        contact,
        chat,
        phoneIndex,
        retryCount + 1
      );
    } else {
      //console.error(`Failed to save contact after 3 attempts`);
    }
  }
}

async function saveMessages(botName, phoneNumber, messages, isGroup) {
  const contactRef = db
    .collection("companies")
    .doc(botName)
    .collection("contacts")
    .doc(phoneNumber);
  const messagesRef = contactRef.collection("messages");
  const sortedMessages = messages.sort(
    (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
  );

  let batch = db.batch();
  let count = 0;

  for (const message of sortedMessages) {
    const type = message.type === "chat" ? "text" : message.type;

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
    if (type === "text") {
      messageData.text = { body: message.body ?? "" };
    } else if (
      ["image", "video", "document"].includes(type) &&
      message.hasMedia
    ) {
      try {
        const media = await message.downloadMedia();
        if (media) {
          const url = await saveMediaLocally(
            media.data,
            media.mimetype,
            media.filename || `${type}.${media.mimetype.split("/")[1]}`
          );
          messageData[type] = {
            mimetype: media.mimetype,
            url: url,
            filename: media.filename ?? "",
            caption: message.body ?? "",
          };
          if (type === "image") {
            messageData[type].width = message._data.width;
            messageData[type].height = message._data.height;
          }
        } else {
          messageData.text = { body: "Media not available" };
        }
      } catch (error) {
        console.error(
          `Error handling media for message ${message.id._serialized}:`,
          error
        );
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

    broadcastProgress(
      botName,
      "saving_messages",
      count / sortedMessages.length
    );
  }

  if (count > 0) {
    await batch.commit();
  }

  // console.log(`Saved ${sortedMessages.length} messages for contact ${phoneNumber}`);
  broadcastProgress(botName, "saving_messages", 1);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ... existing code ...

// Enhanced database connection with better error handling
async function getContactDataFromDatabaseByPhone(phoneNumber, idSubstring) {
  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (!phoneNumber) {
        throw new Error("Phone number is undefined or null");
      }

      // Use direct SQL query with timeout
      const result = await Promise.race([
        sql`
          SELECT * FROM public.contacts
          WHERE phone = ${phoneNumber} AND company_id = ${idSubstring}
          LIMIT 1
        `,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database query timeout')), 10000)
        )
      ]);

      if (result.length === 0) {
        return null;
      } else {
        const contactData = result[0];
        const contactName = contactData.contact_name || contactData.name;
        const threadID = contactData.thread_id;

        return {
          ...contactData,
          contactName,
          threadID,
        };
      }
    } catch (error) {
      lastError = error;
      console.error(`Database attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      if (attempt < maxRetries) {
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }
  
  // If all retries failed, log the error but don't throw
  console.error("All database retry attempts failed:", lastError);
  return null; // Return null instead of throwing
}

setInterval(() => {
  console.log('Pool status:', {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount
  });
}, 120000);

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
      await saveContactWithRateLimit(botName, contact, chat, phoneIndex);
      processedChats++;

      broadcastProgress(
        botName,
        "processing_chats",
        processedChats / totalChats,
        phoneIndex
      );
    }
    console.log(
      `Finished saving contacts for bot ${botName} Phone ${phoneIndex + 1}`
    );
  } catch (error) {
    // console.error(`Error processing chats for bot ${botName} Phone ${phoneIndex + 1}:`, error);
  }
}

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  console.log("Login attempt:", { email }); // Removed password logging for security

  try {
    // Get user data from database
    const userData = await sqlDb.getRow(
      "SELECT * FROM users WHERE email = $1 AND password = $2",
      [email, password]
    );

    if (!userData) {
      console.log("Invalid credentials for email:", email);
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Success
    console.log("Login successful for:", email);
    res.json({
      success: true,
      user: {
        email: userData.email,
        name: userData.name,
        role: userData.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List all tags for a company
app.get("/api/companies/:companyId/tags", async (req, res) => {
  const { companyId } = req.params;
  try {
    const result = await sqlDb.query(
      "SELECT id, name FROM company_tags WHERE company_id = $1 ORDER BY name ASC",
      [companyId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching tags:", error);
    res.status(500).json({ error: "Failed to fetch tags" });
  }
});

// Add a new tag for a company
app.post("/api/companies/:companyId/tags", async (req, res) => {
  const { companyId } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Tag name is required" });
  try {
    const result = await sqlDb.query(
      "INSERT INTO company_tags (company_id, name) VALUES ($1, $2) RETURNING id, name",
      [companyId, name]
    );
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      // unique_violation
      return res.status(409).json({ error: "Tag already exists" });
    }
    console.error("Error adding tag:", error);
    res.status(500).json({ error: "Failed to add tag" });
  }
});

// Update a tag's name
app.put("/api/companies/:companyId/tags/:tagId", async (req, res) => {
  const { companyId, tagId } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Tag name is required" });
  try {
    const result = await sqlDb.query(
      "UPDATE company_tags SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND company_id = $3 RETURNING id, name",
      [name, tagId, companyId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Tag not found" });
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      // unique_violation
      return res.status(409).json({ error: "Tag already exists" });
    }
    console.error("Error updating tag:", error);
    res.status(500).json({ error: "Failed to update tag" });
  }
});

// Delete a tag
app.delete("/api/companies/:companyId/tags/:tagId", async (req, res) => {
  const { companyId, tagId } = req.params;
  try {
    const result = await sqlDb.query(
      "DELETE FROM company_tags WHERE id = $1 AND company_id = $2 RETURNING id",
      [tagId, companyId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Tag not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting tag:", error);
    res.status(500).json({ error: "Failed to delete tag" });
  }
});

// Get user config
app.get("/api/user/config", async (req, res) => {
  try {
    const userEmail = req.query.email; // Changed from req.body to req.query
    const user = await sqlDb.getRow("SELECT * FROM users WHERE email = $1", [
      userEmail,
    ]);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    console.log("User object:", user);
    console.log("User selected_phone:", user.selected_phone);

    res.json({
      name: user.name,
      company_id: user.company_id,
      role: user.role,
      email: user.email,
      phone:user.selected_phone,
    });
  } catch (error) {
    console.error("Error fetching user config:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get company data
app.get("/api/companies/:companyId", async (req, res) => {
  try {
    const { companyId } = req.params;
    const company = await sqlDb.getRow(
      "SELECT * FROM companies WHERE company_id = $1",
      [companyId]
    );

    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Convert snake_case to camelCase
    const toCamel = (str) =>
      str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());

    const camelCompany = {};
    for (const key in company) {
      camelCompany[toCamel(key)] = company[key];
    }

    res.json(camelCompany);
  } catch (error) {
    console.error("Error fetching company data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get contacts with replies
app.get("/api/companies/:companyId/replies", async (req, res) => {
  try {
    const { companyId } = req.params;

    // SQL query to count contacts with replies
    const result = await sqlDb.getRow(
      `
      SELECT COUNT(DISTINCT c.id) as contacts_with_replies
      FROM contacts c
      LEFT JOIN messages m ON c.id = m.contact_id
      WHERE c.company_id = $1 
      AND c.type != 'group'
      AND m.id IS NOT NULL
    `,
      [companyId]
    );

    res.json({
      contactsWithReplies: parseInt(result.contacts_with_replies) || 0,
    });
  } catch (error) {
    console.error("Error fetching replies data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/companies/:companyId/contacts/multi-phone", async (req, res) => {
  try {
    const { email, phoneIndex } = req.query;
    const { companyId } = req.params;
    
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    
    if (phoneIndex === undefined || phoneIndex === null) {
      return res.status(400).json({ error: "phoneIndex is required" });
    }

    // Get user email from session
    const userEmail = email;

    // Verify user belongs to company
    const userData = await sqlDb.getRow(
      "SELECT role, name FROM users WHERE email = $1 AND company_id = $2 AND active = true",
      [userEmail, companyId]
    );

    if (!userData) {
      return res
        .status(403)
        .json({ error: "Forbidden - User not authorized for this company" });
    }

    // Fetch contacts with their latest message for the specific phone_index
    const contacts = await sqlDb.getRows(
      `
      SELECT 
        c.id,
        c.contact_id,
        c.name,
        c.contact_name,
        c.phone,
        c.email,
        c.chat_id,
        c.profile,
        c.profile_pic_url,
        c.tags,
        c.created_at,
        c.last_updated,
        c.phone_indexes,
        c.unread_count,
        c.custom_fields,
        CASE 
          WHEN c.chat_id LIKE '%@c.us' THEN true 
          ELSE false 
        END as is_individual,
        (
          SELECT jsonb_agg(e.name)
          FROM assignments a
          JOIN employees e ON a.employee_id = e.employee_id
          WHERE a.contact_id = c.contact_id 
          AND a.company_id = c.company_id
          AND a.status = 'active'
        ) as assigned_to,
        (
          SELECT jsonb_build_object(
            'chat_id', m.chat_id,
            'from', m.chat_id,
            'from_me', m.from_me,
            'id', m.message_id,
            'source', '',
            'status', m.status,
            'text', jsonb_build_object('body', m.content),
            'timestamp', EXTRACT(EPOCH FROM m.timestamp)::bigint,
            'type', m.message_type,
            'name', m.author,
            'phone_index', m.phone_index
          )
          FROM messages m
          WHERE m.contact_id = c.contact_id
          AND m.company_id = c.company_id
          AND m.phone_index = $2
          ORDER BY m.timestamp DESC
          LIMIT 1
        ) as last_message,
        (
          SELECT m.phone_index
          FROM messages m
          WHERE m.contact_id = c.contact_id
          AND m.company_id = c.company_id
          AND m.phone_index = $2
          ORDER BY m.timestamp DESC
          LIMIT 1
        ) as phoneIndex
      FROM contacts c
      WHERE c.company_id = $1
      AND EXISTS (
        SELECT 1 FROM messages m2 
        WHERE m2.contact_id = c.contact_id 
        AND m2.company_id = c.company_id 
        AND m2.phone_index = $2
      )
      ORDER BY (
        SELECT m.timestamp
        FROM messages m
        WHERE m.contact_id = c.contact_id
        AND m.company_id = c.company_id
        AND m.phone_index = $2
        ORDER BY m.timestamp DESC
        LIMIT 1
      ) DESC NULLS LAST
    `,
      [companyId, phoneIndex]
    );

    // Process contacts to match frontend expectations
    const processedContacts = contacts.map((contact) => {
      // Parse tags from JSONB if they are a string, or use empty array if null/undefined
      let tags = contact.tags;
      try {
        if (typeof tags === "string") {
          tags = JSON.parse(tags);
        }
        // Ensure tags is an array and filter out empty values
        tags = Array.isArray(tags) ? tags.filter((tag) => tag) : [];
      } catch (error) {
        console.error("Error parsing tags:", error);
        tags = [];
      }

      // Parse phone_indexes from JSONB if they are a string, or use empty array if null/undefined
      let phoneIndexes = contact.phone_indexes;
      try {
        if (typeof phoneIndexes === "string") {
          phoneIndexes = JSON.parse(phoneIndexes);
        }
        phoneIndexes = Array.isArray(phoneIndexes) ? phoneIndexes.filter((v) => v !== undefined && v !== null) : [];
      } catch (error) {
        console.error("Error parsing phone_indexes:", error);
        phoneIndexes = [];
      }

      // Parse assigned_to from JSONB if it exists
      let assignedTo = contact.assigned_to;
      try {
        if (typeof assignedTo === "string") {
          assignedTo = JSON.parse(assignedTo);
        }
        // Ensure assignedTo is an array
        assignedTo = Array.isArray(assignedTo) ? assignedTo : [];
      } catch (error) {
        console.error("Error parsing assigned_to:", error);
        assignedTo = [];
      }

      return {
        id: contact.id,
        contact_id: contact.contact_id,
        name: contact.name || contact.contact_name || "",
        phone: contact.phone || "",
        email: contact.email || "",
        chat_id: contact.chat_id || "",
        profileUrl: contact.profile_pic_url || "",
        profile: contact.profile || {},
        tags: tags,
        phoneIndexes: phoneIndexes,
        phoneIndex: parseInt(phoneIndex), // Current phone index for this contact's latest message
        assignedTo: assignedTo,
        createdAt: contact.created_at,
        lastUpdated: contact.last_updated,
        isIndividual: contact.is_individual,
        last_message: contact.last_message || null,
        unreadCount: contact.unread_count || 0, 
        customFields: contact.custom_fields || {},  
      };
    });

    // Filter contacts based on user role
    const filteredContacts = filterContactsByUserRole(processedContacts, userData.role, userData.name);

    res.json({
      success: true,
      total: filteredContacts.length,
      contacts: filteredContacts,
      phoneIndex: parseInt(phoneIndex),
    });
  } catch (error) {
    console.error("Error fetching multi-phone contacts:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch contacts",
      message: error.message,
    });
  }
});

async function obiliterateAllJobs() {
  await messageQueue.obliterate({ force: true });
  console.log("Queue cleared successfully");
}

async function main(reinitialize = false) {
  console.log("Initialization starting...");

  // 1. Fetch companies in parallel with other initialization tasks
  // const companiesPromise = sqlDb.query(
  //   "SELECT * FROM companies WHERE company_id = $1",
  //   ["0145"]
  // );

 
  // WHEN WANT TO INITIALIZE ALL BOTS
  const companiesPromise = sqlDb.query(
    "SELECT * FROM companies WHERE api_url = $1",
    ["https://juta-dev.ngrok.dev"]
  );
  
  // const companiesPromise = sqlDb.query(
  //   "SELECT * FROM companies WHERE company_id IN ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)",
  //   [
  //     "0107", "0119", "0160", "0161", "0182", "0245", "0271", "0291", "0327", 
  //     "0345", "0364", "0377", "0378", "063", "075", "079", "088", "098", 
  //     "098410", "107145", "128137", "314648", "327971", "330643", "456236", 
  //     "478608", "503217", "509387", "659516", "765943", "771344", "0123", "0380"
  //   ]
  // );

  // 2. If reinitializing, start cleanup early
  const cleanupPromise = reinitialize
    ? (async () => {
        console.log("Reinitializing, clearing existing bot instances...");
        await Promise.all(
          [...botMap.entries()].map(async ([_, botData]) => {
            if (Array.isArray(botData)) {
              await Promise.all(
                botData.map(async (clientData) => {
                  if (clientData.client) await clientData.client.destroy();
                })
              );
            } else if (botData?.client) {
              await botData.client.destroy();
            }
          })
        );
        botMap.clear();
      })()
    : Promise.resolve();

  // 3. Start job cleanup in parallel
  const jobCleanupPromise = obiliterateAllJobs();

  // 4. Wait for initial setup tasks
  const [companiesResult] = await Promise.all([
    companiesPromise,
    cleanupPromise,
    jobCleanupPromise,
  ]);

  // 5. Process company data and sort naturally
  const botConfigs = companiesResult.rows
    .map((row) => ({
      botName: row.company_id,
      phoneCount: row.phone_count || 1,
    }))
    // Add natural sorting for botName
    .sort((a, b) => {
      // Convert botNames to numbers if possible for proper numeric sorting
      const aNum = parseFloat(a.botName);
      const bNum = parseFloat(b.botName);

      if (!isNaN(aNum) && !isNaN(bNum)) {
        return aNum - bNum;
      }
      // Fallback to string comparison if not numbers
      return a.botName.localeCompare(b.botName, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

  console.log(
    `Found ${botConfigs.length} bots to initialize (excluding EC2 instances)`
  );

  // 6. Initialize bots sequentially with delays
  const initializeBotsWithDelay = async (botConfigs) => {
    if (!botConfigs || botConfigs.length === 0) {
      console.log("No bot configurations found");
      return;
    }

    console.log(`Starting initialization of ${botConfigs.length} bots...`);

    try {
      // Create an array of promises for all bot initializations
      const initializationPromises = botConfigs.map(config => 
        initializeBot(config.botName, config.phoneCount)
          .then(() => {
            console.log(`Successfully initialized bot ${config.botName}`);
          })
          .catch(error => {
            console.error(`Error in initialization of bot ${config.botName}:`, error.message);
            // You might want to rethrow the error here if you want the outer catch to handle it
            // throw error;
          })
      );

      // Run all initializations concurrently
      await Promise.all(initializationPromises);
      
      console.log("All bot initializations completed.");
    } catch (error) {
      // This will catch any errors that weren't handled in the individual promises
      console.error("Error during bot initializations:", error.message);
    }
  };

  // Replace the parallel initialization with sequential starts
  await initializeBotsWithDelay(botConfigs);
  await setupNeonWebhooks(app, botMap);
  const automationInstances = {
    //skcSpreadsheet: new SKCSpreadsheet(botMap),
    //bhqSpreadsheet: new bhqSpreadsheet(botMap),
    //constantcoSpreadsheet: new constantcoSpreadsheet(botMap),
  };

  // 7. Initialize automation systems in parallel
  /*const automationPromises = [
    scheduleAllMessages(),
    //automationInstances.bhqSpreadsheet.initialize(),
    //automationInstances.skcSpreadsheet.initialize(),
    //automationInstances.constantcoSpreadsheet.initialize(),
    checkAndScheduleDailyReport(),
    initializeDailyReports(),
  ];*/
 // await Promise.all(automationPromises);

  console.log("Initialization complete");
  if (process.send) process.send("ready");
}

// Define the function to initialize automations
function initializeAutomations(botMap) {
  return [
    scheduleAllMessages(),
    // automationInstances.bhqSpreadsheet.initialize(),
    // automationInstances.constantcoSpreadsheet.initialize(),
    // automationInstances.skcSpreadsheet.initialize(),
    checkAndScheduleDailyReport(),
    initializeDailyReports(),
  ];
}

async function initializeDailyReports() {
  try {
    const settingsQuery = `
      SELECT company_id, setting_value 
      FROM public.settings 
      WHERE setting_type = 'reporting' 
      AND setting_key = 'dailyReport'
    `;

    const settingsResult = await sqlDb.query(settingsQuery);

    for (const row of settingsResult.rows) {
      const companyId = row.company_id;
      const settings = row.setting_value;

      const companyQuery = `
        SELECT api_url FROM companies WHERE company_id = $1
      `;
      const companyResult = await sqlDb.query(companyQuery, [companyId]);
      const apiUrl = companyResult.rows[0]?.api_url;

      if (apiUrl !== 'https://juta-dev.ngrok.dev') {
        continue;
      }

      if (settings && settings.enabled && settings.time && settings.groupId) {
        const [hour, minute] = settings.time.split(":");

        const cronJob = cron.schedule(
          `${minute} ${hour} * * *`,
          async () => {
            try {
              const botData = botMap.get(companyId);
              if (!botData || !botData[0]?.client) {
                console.error(
                  `No WhatsApp client found for company ${companyId}`
                );
                return;
              }

              const count = await countTodayLeads(companyId);
              const message = `📊 Daily Lead Report\n\nNew Leads Today: ${count}\nDate: ${new Date().toLocaleDateString()}`;

              await botData[0].client.sendMessage(settings.groupId, message);

              const updateLastRunQuery = `
              UPDATE public.settings 
              SET setting_value = jsonb_set(setting_value, '{lastRun}', to_jsonb($1::text), true),
                  updated_at = CURRENT_TIMESTAMP
              WHERE company_id = $2 AND setting_type = 'reporting' AND setting_key = 'dailyReport'
            `;
              await sqlDb.query(updateLastRunQuery, [
                new Date().toISOString(),
                companyId,
              ]);
            } catch (error) {
              console.error(
                `Error sending daily report for company ${companyId}:`,
                error
              );
            }
          },
          {
            timezone: "Asia/Kuala_Lumpur",
          }
        );

        dailyReportCrons.set(companyId, cronJob);
        console.log(
          `Daily report scheduled for company ${companyId} at ${settings.time}`
        );
      }
    }

    console.log(`Initialized ${dailyReportCrons.size} daily report cron jobs`);
  } catch (error) {
    console.error("Error initializing daily reports:", error);
  }
}

async function checkAndScheduleDailyReport() {
  try {
    const sqlClient = await pool.connect();

    try {
      await sqlClient.query("BEGIN");

      const companiesQuery = `
        SELECT company_id , api_url
        FROM public.companies
      `;

      const companiesResult = await sqlClient.query(companiesQuery);
      const companies = companiesResult.rows;

      console.log(
        `Found ${companies.length} companies to check for daily reports`
      );

      for (const company of companies) {
        const companyId = company.company_id;
        const apiUrl = company.api_url;

        if (apiUrl !== 'https://juta-dev.ngrok.dev') {
          continue;
        }

        try {
          const settingsQuery = `
            SELECT setting_value 
            FROM public.settings 
            WHERE company_id = $1 
            AND setting_type = 'reporting' 
            AND setting_key = 'dailyReport'
          `;

          const settingsResult = await sqlClient.query(settingsQuery, [
            companyId,
          ]);
          const settings =
            settingsResult.rows.length > 0
              ? settingsResult.rows[0].setting_value
              : null;

          if (settings?.enabled) {
            const reportTime = settings.time || "09:00";
            const groupId = settings.groupId;
            const lastRun = settings.lastRun
              ? new Date(settings.lastRun)
              : null;
            const [hours, minutes] = reportTime.split(":");

            const cronJobName = `dailyReport_${companyId}`;
            if (schedule.scheduledJobs[cronJobName]) {
              schedule.scheduledJobs[cronJobName].cancel();
            }

            const now = moment().tz("Asia/Kuala_Lumpur");
            const wasRunToday =
              lastRun &&
              moment(lastRun).tz("Asia/Kuala_Lumpur").isSame(now, "day");

            if (
              !wasRunToday &&
              now.hours() >= parseInt(hours) &&
              now.minutes() >= parseInt(minutes)
            ) {
              console.log(
                `[${companyId}] Daily report not sent yet today and it's past scheduled time. Sending now...`
              );

              const botData = botMap.get(companyId);
              if (botData && botData[0]?.client) {
                await sendDailyContactReport(botData[0].client, companyId);

                const updateQuery = `
                  UPDATE public.settings 
                  SET setting_value = jsonb_set(setting_value, '{lastRun}', to_jsonb($1::text))
                  WHERE company_id = $2 
                  AND setting_type = 'reporting' 
                  AND setting_key = 'dailyReport'
                `;

                await sqlClient.query(updateQuery, [
                  now.toISOString(),
                  companyId,
                ]);
              } else {
                console.log(
                  `[${companyId}] No WhatsApp client found for immediate report`
                );
              }
            }

            console.log(
              `[${companyId}] Scheduling daily report for ${reportTime}`
            );
            schedule.scheduleJob(
              cronJobName,
              `0 ${minutes} ${hours} * * *`,
              async function () {
                console.log(`[${companyId}] Running scheduled daily report`);

                const botData = botMap.get(companyId);
                if (botData && botData[0]?.client) {
                  await sendDailyContactReport(botData[0].client, companyId);

                  const sqlClientForCron = await pool.connect();
                  try {
                    await sqlClientForCron.query("BEGIN");
                    const updateQuery = `
                      UPDATE public.settings 
                      SET setting_value = jsonb_set(setting_value, '{lastRun}', to_jsonb($1::text))
                      WHERE company_id = $2 
                      AND setting_type = 'reporting' 
                      AND setting_key = 'dailyReport'
                    `;

                    await sqlClientForCron.query(updateQuery, [
                      new Date().toISOString(),
                      companyId,
                    ]);
                    await sqlClientForCron.query("COMMIT");
                  } catch (cronError) {
                    await sqlClientForCron.query("ROLLBACK");
                    console.error(
                      `[${companyId}] Error updating lastRun after scheduled report:`,
                      cronError
                    );
                  } finally {
                    sqlClientForCron.release();
                  }
                } else {
                  console.log(
                    `[${companyId}] No WhatsApp client found for scheduled report`
                  );
                }
              }
            );

            console.log(`[${companyId}] Daily report scheduled successfully`);
          } else {
            //console.log(`[${companyId}] Daily reporting not enabled, skipping`);
          }
        } catch (companyError) {
          console.error(
            `[${companyId}] Error setting up daily report:`,
            companyError
          );
          console.log(`Continuing with next company...`);
        }
      }

      await sqlClient.query("COMMIT");
      console.log("All daily reports have been set up successfully");
    } catch (error) {
      await safeRollback(sqlClient);
      console.error(`Error in checkAndScheduleDailyReport:`, error);
    } finally {
      await safeRelease(sqlClient);
    }
  } catch (connectionError) {
    console.error(`Database connection error:`, connectionError);
  }
}

async function sendDailyContactReport(client, idSubstring) {
  const sqlClient = await pool.connect();

  try {
    const { count, contacts } = await getContactsAddedToday(
      idSubstring,
      sqlClient
    );

    const currentNow = moment().tz("Asia/Kuala_Lumpur");

    const message =
      `📊 *Daily Contact Report*\n\n` +
      `📅 Date: ${currentNow.format("DD/MM/YYYY")}\n` +
      `🔔 New Leads Today: ${count}\n\n` +
      (contacts.length > 0
        ? `*New Contacts:*\n${contacts
            .map((c) => `- ${c.contactName} (${c.phoneNumber})`)
            .join("\n")}\n\n`
        : "") +
      `Generated by Juta AI`;

    const settingsQuery = `
      SELECT setting_value->>'groupId' as group_id
      FROM public.settings 
      WHERE company_id = $1 
      AND setting_type = 'reporting' 
      AND setting_key = 'dailyReport'
    `;

    const settingsResult = await sqlClient.query(settingsQuery, [idSubstring]);
    const groupId =
      settingsResult.rows.length > 0 ? settingsResult.rows[0].group_id : null;

    if (groupId) {
      await client.sendMessage(groupId, message);
      console.log(
        `Daily report sent to group ${groupId} for company ${idSubstring} at ${currentNow.format(
          "HH:mm"
        )}`
      );
    } else {
      console.log(
        `No group ID configured for daily report for company ${idSubstring}`
      );
    }

    return { success: true, message: "Report sent successfully" };
  } catch (error) {
    console.error(
      `Error sending daily contact report for ${idSubstring}:`,
      error
    );
    return { success: false, error: error.message };
  } finally {
    await safeRelease(sqlClient);
  }
}

async function getContactsAddedToday(idSubstring) {
  try {
    const today = moment()
      .tz("Asia/Kuala_Lumpur")
      .startOf("day")
      .format("YYYY-MM-DD");

    const result = await sql`
      SELECT 
        phone as "phoneNumber",
        contact_name as "contactName",
        created_at as "createdAt",
        tags
      FROM public.contacts 
      WHERE company_id = ${idSubstring}
      AND DATE(created_at AT TIME ZONE 'Asia/Kuala_Lumpur') = ${today}
    `;

    const contacts = result.map((contact) => ({
      phoneNumber: contact.phoneNumber,
      contactName: contact.contactName || "Unknown",
      createdAt: contact.createdAt.toISOString(),
      tags: contact.tags || [],
    }));

    return {
      count: contacts.length,
      contacts: contacts,
    };
  } catch (error) {
    console.error("Error getting contacts added today:", error);
    return { count: 0, contacts: [], error: error.message };
  }
}

app.get("/api/phone-status/:companyId", async (req, res) => {
  try {
    const { companyId } = req.params;
    const result = await sqlDb.query(
      "SELECT phone_number, status, last_seen, metadata, updated_at FROM phone_status WHERE company_id = $1 ORDER BY phone_number ASC",
      [companyId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching phone statuses:", error);
    res.status(500).json({ error: "Failed to fetch phone statuses" });
  }
});

app.get("/api/instruction-templates", async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!companyId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing companyId" });
    }

    const result = await sqlDb.query(
      `SELECT id, name, instructions, created_at FROM instruction_templates WHERE company_id = $1 ORDER BY created_at DESC`,
      [companyId]
    );

    res.json({
      success: true,
      templates: result.rows,
    });
  } catch (error) {
    console.error("Error fetching instruction templates:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch templates",
      details: error.message,
    });
  }
});

app.post("/api/instruction-templates", async (req, res) => {
  try {
    const { companyId, name, instructions } = req.body;

    if (!companyId || !name || !instructions) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (companyId, name, instructions)",
      });
    }

    const result = await sqlDb.query(
      `INSERT INTO instruction_templates (company_id, name, instructions)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [companyId, name, instructions]
    );

    res.json({
      success: true,
      id: result.rows[0].id,
      message: "Template saved successfully",
    });
  } catch (error) {
    console.error("Error saving instruction template:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save template",
      details: error.message,
    });
  }
});

async function fetchCompanyConfigSql(companyId) {
  try {
    const companyQuery = `
      SELECT 
      assistant_ids, 
      name, 
      phone_count, 
      daily_report,
      phone_numbers
      FROM companies 
      WHERE company_id = $1
    `;
    const companyResult = await sqlDb.query(companyQuery, [companyId]);
    const companyData = companyResult.rows[0];

    if (!companyData) {
      return null;
    }

    let phoneNames = [];
    if (companyData.phone_numbers) {
      console.log("Parsing phone numbers:", companyData.phone_numbers);
      try {
      if (Array.isArray(companyData.phone_numbers)) {
        phoneNames = companyData.phone_numbers.map(phone => phone.trim());
      } else if (typeof companyData.phone_numbers === 'string') {
        phoneNames = companyData.phone_numbers.split(',').map(phone => phone.trim());
      } else {
        phoneNames = [];
      }
      } catch (e) {
      phoneNames = [];
      }
    }
    // Set phone1, phone2, phone3, phone4 from phoneNames array
    const phone1 = phoneNames[0] || null;
    const phone2 = phoneNames[1] || null;
    const phone3 = phoneNames[2] || null;
    const phone4 = phoneNames[3] || null;

    // Parse assistant_ids as array and set assistantId1, assistantId2, etc.
    let assistantIds = [];
    if (companyData.assistant_ids) {
      console.log("Parsing assistant IDs:", companyData.assistant_ids);
      try {
        if (Array.isArray(companyData.assistant_ids)) {
          assistantIds = companyData.assistant_ids.map(id => id.trim());
        } else if (typeof companyData.assistant_ids === 'string') {
          assistantIds = companyData.assistant_ids.split(',').map(id => id.trim());
        } else {
          assistantIds = [];
        }
      } catch (e) {
        assistantIds = [];
      }
    }
    const assistantId1 = assistantIds[0] || null;
    const assistantId2 = assistantIds[1] || null;
    const assistantId3 = assistantIds[2] || null;
    const assistantId4 = assistantIds[3] || null;

    const openaiTokenQuery =
      "SELECT config_value FROM system_config WHERE config_key = $1";
    const openaiTokenResult = await sqlDb.query(openaiTokenQuery, [
      "openai_api_key",
    ]);
    const openaiToken = openaiTokenResult.rows[0]?.config_value;

    return {
      companyData: {
      assistantId: assistantId1,
      assistantId2,
      assistantId3,
      assistantId4,
      name: companyData.name,
      phoneCount: parseInt(companyData.phone_count || "1"),
      phone1,
      phone2,
      phone3,
      phone4,
      ghl_accessToken: companyData.ghl_access_token,
      apiUrl: companyData.api_url,
      aiDelay: parseInt(companyData.ai_delay || "0"),
      aiAutoResponse: companyData.ai_auto_response === "true",
      dailyReport: companyData.daily_report,
      },
      openaiApiKey: openaiToken,
    };
  } catch (error) {
    console.error("Error fetching company config from SQL:", error);
    return null;
  }
}

async function fetchUserDataSql(email) {
  try {
    const query = "SELECT company_id, role FROM users WHERE email = $1";
    const { rows } = await sqlDb.query(query, [email]);
    return rows[0] || null; // Returns user data or null if not found
  } catch (error) {
    console.error(`Error fetching user data from SQL for ${email}:`, error);
    return null;
  }
}

app.get("/api/user-data/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const userData = await fetchUserDataSql(email);
    if (userData) {
      res.json(userData);
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ error: "Failed to fetch user data" });
  }
});

// PUT endpoint to update user data (specifically company_id)
app.put("/api/user-data/:userEmail", async (req, res) => {
  try {
    const { userEmail } = req.params;
    const { company_id } = req.body;

    if (!userEmail) {
      return res.status(400).json({ error: "User email is required" });
    }

    if (!company_id) {
      return res.status(400).json({ error: "Company ID is required" });
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update users table
      const userUpdateQuery = `
        UPDATE users 
        SET company_id = $1, last_updated = CURRENT_TIMESTAMP
        WHERE email = $2
        RETURNING email, company_id
      `;
      
      const userResult = await client.query(userUpdateQuery, [company_id, userEmail]);

      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: "User not found" });
      }

      // Update employees table if the user exists there
      const employeeUpdateQuery = `
        UPDATE employees 
        SET company_id = $1, last_updated = CURRENT_TIMESTAMP
        WHERE email = $2
      `;
      
      await client.query(employeeUpdateQuery, [company_id, userEmail]);

      await client.query('COMMIT');
      
      res.json({ 
        success: true, 
        message: "User company ID updated successfully",
        data: {
          email: userResult.rows[0].email,
          company_id: userResult.rows[0].company_id
        }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await safeRelease(client);
    }

  } catch (error) {
    console.error("Error updating user company ID:", error);
    res.status(500).json({ error: "Failed to update user company ID" });
  }
});

// New API endpoint to fetch employees data
app.get("/api/employees-data/:companyId", async (req, res) => {
  try {
    const { companyId } = req.params;
    const employees = await fetchEmployeesDataSql(companyId);
    res.json(employees);
  } catch (error) {
    console.error("Error fetching employees data:", error);
    res.status(500).json({ error: "Failed to fetch employees data" });
  }
});

app.get("/api/company-config/:companyId", async (req, res) => {
  try {
    const { companyId } = req.params;
    const config = await fetchCompanyConfigSql(companyId);

    if (config) {
      res.json(config);
    } else {
      res.status(404).json({ error: "Company configuration not found" });
    }
  } catch (error) {
    console.error("Error fetching company configuration:", error);
    res.status(500).json({ error: "Failed to fetch company configuration" });
  }
});
// Create an API endpoint to initialize automations
app.post("/api/initialize-automations", async (req, res) => {
  try {
    const automationPromises = initializeAutomations(botMap);
    await Promise.all(automationPromises);
    res.json({
      success: true,
      message: "Automations initialized successfully",
    });
  } catch (error) {
    console.error("Error initializing automations:", error);
    res.status(500).json({ error: "Failed to initialize automations" });
  }
});

async function fetchEmployeesDataSql(companyId) {
  try {
    const query =
      'SELECT id, employee_id, name, email, phone_number AS "phoneNumber", role FROM employees WHERE company_id = $1';
    const { rows } = await sqlDb.query(query, [companyId]);
    return rows;
  } catch (error) {
    console.error(
      `Error fetching employees data from SQL for company ${companyId}:`,
      error
    );
    return [];
  }
}

// New function to update monthly assignments in SQL
async function updateMonthlyAssignmentsSql(
  companyId,
  employeeName,
  incrementValue,
  contactId = null,
  assignmentType = 'manual'
) {
  const client = await pool.connect(); // Get a client from the pool
  try {
    await client.query("BEGIN"); // Start transaction

    // 1. Get the employee's internal UUID 'id' and update assigned_contacts
    // We use 'name' for lookup because that's what 'employeeName' from Firebase 'doc.id' corresponds to.
    const employeeUpdateQuery = `
      UPDATE employees
      SET assigned_contacts = assigned_contacts + $1
      WHERE company_id = $2 AND name = $3
      RETURNING id;
    `;
    const employeeResult = await client.query(employeeUpdateQuery, [
      incrementValue,
      companyId,
      employeeName,
    ]);

    if (employeeResult.rows.length === 0) {
      throw new Error(
        `Employee '${employeeName}' not found for company '${companyId}'`
      );
    }

    const employeeId = employeeResult.rows[0].id; // This is the UUID 'id' from employees table

    // 2. Create assignment record if contactId is provided and incrementValue is positive
    if (contactId && incrementValue > 0) {
      const currentDate = new Date();
      const currentMonthKey = `${currentDate.getFullYear()}-${(
        currentDate.getMonth() + 1
      ).toString().padStart(2, "0")}`;

      const assignmentId = `${companyId}-${contactId}-${employeeId}-${Date.now()}`;
      
      const assignmentInsertQuery = `
        INSERT INTO assignments (
          assignment_id, company_id, employee_id, contact_id, 
          assigned_at, status, month_key, assignment_type, 
          phone_index, weightage_used
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'active', $5, $6, 0, 1)
      `;
      
      await client.query(assignmentInsertQuery, [
        assignmentId,
        companyId,
        employeeId,
        contactId,
        currentMonthKey,
        assignmentType
      ]);
    }

    // 3. Update or insert monthly assignments
    const currentDate = new Date();
    const currentMonthKey = `${currentDate.getFullYear()}-${(
      currentDate.getMonth() + 1
    )
      .toString()
      .padStart(2, "0")}`;

    const monthlyAssignmentUpsertQuery = `
      INSERT INTO employee_monthly_assignments (employee_id, company_id, month_key, assignments_count, last_updated)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (employee_id, month_key) DO UPDATE
      SET assignments_count = employee_monthly_assignments.assignments_count + $4,
          last_updated = CURRENT_TIMESTAMP;
    `;
    await client.query(monthlyAssignmentUpsertQuery, [
      employeeId,
      companyId,
      currentMonthKey,
      incrementValue,
    ]);

    await client.query("COMMIT"); // Commit transaction
    return { success: true };
  } catch (error) {
    await safeRollback(client); // Rollback on error
    console.error("Error in updateMonthlyAssignmentsSql transaction:", error);
    throw error; // Re-throw to be caught by the API endpoint
  } finally {
    await safeRelease(client); // Release client back to the pool
  }
}

// New API endpoint to update monthly assignments
app.post("/api/employees/update-monthly-assignments", async (req, res) => {
  try {
    const { companyId, employeeName, incrementValue } = req.body;
    await updateMonthlyAssignmentsSql(companyId, employeeName, incrementValue);
    res.json({
      success: true,
      message: "Monthly assignments updated successfully",
    });
  } catch (error) {
    console.error("Error updating monthly assignments:", error);
    res.status(500).json({ error: "Failed to update monthly assignments" });
  }
});

async function countContactsWithReplies(companyId) {
  try {
    // Find unique contact_ids for this company where there is at least one message from the contact (from_me = false)
    const query = `
      SELECT COUNT(DISTINCT contact_id) AS contacts_with_replies
      FROM messages
      WHERE company_id = $1 AND from_me = false
    `;
    const { rows } = await sqlDb.query(query, [companyId]);
    return rows[0]?.contacts_with_replies || 0;
  } catch (error) {
    console.error("Error counting contacts with replies:", error);
    return 0;
  }
}

// Function to get scheduled messages summary
async function getScheduledMessagesSummary(companyId) {
  const query = `
    SELECT 
      to_char(scheduled_time, 'Mon YYYY') AS month_key,
      status,
      COUNT(*) AS count
    FROM scheduled_messages
    WHERE company_id = $1
    GROUP BY month_key, status
    ORDER BY min(scheduled_time)
  `;
  const { rows } = await sqlDb.query(query, [companyId]);
  return rows;
}

app.get(
  "/api/companies/:companyId/scheduled-messages-summary",
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const summary = await getScheduledMessagesSummary(companyId);
      res.json({ summary });
    } catch (error) {
      console.error("Error fetching scheduled messages summary:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch scheduled messages summary" });
    }
  }
);

async function getMonthlyUsage(companyId) {
  const query = `
    SELECT 
      to_char(date, 'YYYY-MM') AS month,
      SUM(COALESCE((usage_count::int), 0)) AS total_tokens
    FROM usage_logs
    WHERE company_id = $1
    GROUP BY month
    ORDER BY month
  `;
  const { rows } = await sqlDb.query(query, [companyId]);
  return rows;
}

// Helper: Get employee stats from SQL
async function getEmployeeStats(companyId, employeeId) {
  // conversationsAssigned: assigned_contacts from employees
  // outgoingMessagesSent: count of messages from this employee (from_me = true, author = employee's email or id)
  // averageResponseTime: (optional, needs more logic)
  // closedContacts: count of contacts assigned to this employee with tag 'closed'
  // You may need to adjust queries based on your schema!

  // 1. Get employee info
  const empRes = await sqlDb.query(
    "SELECT id, email, assigned_contacts FROM employees WHERE company_id = $1 AND id = $2",
    [companyId, employeeId]
  );
  if (!empRes.rows.length) return null;
  const employee = empRes.rows[0];

  // 2. Outgoing messages sent
  const msgRes = await sqlDb.query(
    "SELECT COUNT(*) FROM messages WHERE company_id = $1 AND from_me = true AND author = $2",
    [companyId, employee.email]
  );
  const outgoingMessagesSent = parseInt(msgRes.rows[0].count, 10);

  // 3. Closed contacts (contacts assigned to this employee with tag 'closed')
  const closedRes = await sqlDb.query(
    `SELECT COUNT(*) FROM contacts 
    WHERE company_id = $1 
      AND tags::jsonb ? $2 
      AND tags::jsonb ? 'closed'`,
    [companyId, employee.name]
  );
  const closedContacts = parseInt(closedRes.rows[0].count, 10);

  // 4. (Optional) Average response time (not implemented here)
  const averageResponseTime = 0;

  return {
    conversationsAssigned: employee.assigned_contacts || 0,
    outgoingMessagesSent,
    averageResponseTime,
    closedContacts,
  };
}

app.get(
  "/api/companies/:companyId/employee-stats/:employeeId",
  async (req, res) => {
    try {
      const { companyId, employeeId } = req.params;
      const stats = await getEmployeeStats(companyId, employeeId);
      if (!stats) return res.status(404).json({ error: "Employee not found" });
      res.json(stats);
    } catch (error) {
      console.error("Error fetching employee stats:", error);
      res.status(500).json({ error: "Failed to fetch employee stats" });
    }
  }
);

app.delete("/api/contacts/:contact_id", async (req, res) => {
  try {
    const { contact_id } = req.params;
    const { companyId } = req.query;

    if (!companyId || !contact_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (companyId, contact_id)",
      });
    }

    // Optionally: Delete associated data (e.g., scheduled messages) here if needed

    // Delete the contact
    const result = await sqlDb.query(
      `DELETE FROM contacts WHERE contact_id = $1 AND company_id = $2 RETURNING contact_id`,
      [contact_id, companyId]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Contact not found" });
    }

    res.json({
      success: true,
      contact_id: result.rows[0].contact_id,
      message: "Contact deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting contact:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete contact",
      details: error.message,
    });
  }
});

app.delete(
  "/api/schedule-message/:companyId/contact/:contactId",
  async (req, res) => {
    try {
      const { companyId, contactId } = req.params;

      if (!companyId || !contactId) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields (companyId, contactId)",
        });
      }

      // Delete scheduled messages for this contact in this company
      const result = await sqlDb.query(
        `DELETE FROM scheduled_messages WHERE company_id = $1 AND contact_id = $2 RETURNING id`,
        [companyId, contactId]
      );

      res.json({
        success: true,
        deletedCount: result.rowCount,
        message: `Deleted ${result.rowCount} scheduled message(s) for contact`,
      });
    } catch (error) {
      console.error("Error deleting scheduled messages for contact:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete scheduled messages",
        details: error.message,
      });
    }
  }
);

app.post("/api/contacts/bulk", async (req, res) => {
  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No contacts provided" });
    }

    // Deduplicate contacts based on contact_id and company_id combination
    const uniqueContacts = [];
    const seenCombinations = new Set();
    
    for (const contact of contacts) {
      const key = `${contact.contact_id}-${contact.companyId}`;
      if (!seenCombinations.has(key)) {
        seenCombinations.add(key);
        uniqueContacts.push(contact);
      } else {
        console.log(`Skipping duplicate contact: ${contact.contact_id} for company: ${contact.companyId}`);
      }
    }

    if (uniqueContacts.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No unique contacts to import after deduplication" });
    }

    console.log(`Original contacts: ${contacts.length}, Unique contacts: ${uniqueContacts.length}`);

    // Process contacts individually to avoid constraint violations
    const results = [];
    const errors = [];
    
    for (const contact of uniqueContacts) {
      try {
        const query = `
          INSERT INTO contacts (
            contact_id, company_id, name, last_name, email, phone, address1, company, location_id,
            created_at, unread_count, points, branch, expiry_date, vehicle_number, ic, chat_id, notes, custom_fields, tags
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
          ON CONFLICT (contact_id, company_id) DO UPDATE SET
            name = EXCLUDED.name,
            last_name = EXCLUDED.last_name,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            address1 = EXCLUDED.address1,
            company = EXCLUDED.company,
            location_id = EXCLUDED.location_id,
            unread_count = EXCLUDED.unread_count,
            points = EXCLUDED.points,
            branch = EXCLUDED.branch,
            expiry_date = EXCLUDED.expiry_date,
            vehicle_number = EXCLUDED.vehicle_number,
            ic = EXCLUDED.ic,
            chat_id = EXCLUDED.chat_id,
            notes = EXCLUDED.notes,
            custom_fields = EXCLUDED.custom_fields,
            tags = EXCLUDED.tags,
            updated_at = CURRENT_TIMESTAMP
          RETURNING contact_id
        `;

        const values = [
          contact.contact_id,
          contact.companyId,
          contact.name || contact.contactName || null,
          contact.last_name || contact.lastName || null,
          contact.email || null,
          contact.phone || null,
          contact.address1 || null,
          contact.companyName || null,
          contact.locationId || null,
          contact.dateAdded || new Date().toISOString(),
          contact.unreadCount || 0,
          contact.points || 0,
          contact.branch || null,
          contact.expiryDate || null,
          contact.vehicleNumber || null,
          contact.ic || null,
          contact.chat_id || null,
          contact.notes || null,
          // Handle customFields properly
          (() => {
            if (contact.customFields) {
              // If customFields is already an object, stringify it
              if (typeof contact.customFields === 'object' && contact.customFields !== null) {
                return JSON.stringify(contact.customFields);
              } else if (typeof contact.customFields === 'string') {
                // If it's already a string, use it as is
                return contact.customFields;
              }
            }
            return null;
          })(),
          contact.tags ? JSON.stringify(contact.tags) : null
        ];

        const result = await sqlDb.query(query, values);
        results.push(result.rows[0].contact_id);
      } catch (error) {
        console.error(`Error importing contact ${contact.contact_id}:`, error);
        errors.push({
          contact_id: contact.contact_id,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      imported: results.length,
      contact_ids: results,
      original_count: contacts.length,
      unique_count: uniqueContacts.length,
      duplicates_removed: contacts.length - uniqueContacts.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("Error importing contacts in bulk:", error);
    res.status(500).json({
      success: false,
      message: "Failed to import contacts",
      details: error.message,
    });
  }
});

app.put("/api/contacts/:contact_id", async (req, res) => {
  try {
    const { contact_id } = req.params;
    const {
      companyId,
      name,
      lastName,
      email,
      phone,
      address1,
      city,
      state,
      postalCode,
      website,
      dnd,
      dndSettings,
      tags,
      source,
      country,
      companyName,
      branch,
      expiryDate,
      vehicleNumber,
      points,
      IC,
      assistantId,
      threadid,
      notes,
      customFields, // This should be an object if present
    } = req.body;
    console.log("req.body:", req.body);
    if (!companyId || !contact_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (companyId, contact_id)",
      });
    }

    // Build the update query dynamically
    const setFields = [];
    const setValues = [];
    let idx = 1;

    // Standard fields
    const fieldMap = {
      name: name, // <-- changed from contact_name to name
      last_name: lastName,
      email,
      phone,
      address1,
      city,
      state,
      postal_code: postalCode,
      website,
      dnd,
      dnd_settings: dndSettings,
      tags: tags ? JSON.stringify(tags) : undefined,
      source,
      country,
      company: companyName,
      branch,
      expiry_date: expiryDate,
      vehicle_number: vehicleNumber,
      points,
      ic: IC,
      assistant_id: assistantId,
      threadid,
      notes,
    };

    for (const [col, val] of Object.entries(fieldMap)) {
      if (val !== undefined) {
        setFields.push(`${col} = $${idx++}`);
        setValues.push(val);
      }
    }

    // Custom fields
    if (customFields && Object.keys(customFields).length > 0) {
      setFields.push(`custom_fields = $${idx++}`);
      setValues.push(JSON.stringify(customFields));
    }

    setFields.push(`updated_at = CURRENT_TIMESTAMP`);

    // Add WHERE values at the end
    setValues.push(contact_id); // $idx
    setValues.push(companyId); // $idx+1

    const query = `
      UPDATE contacts
      SET ${setFields.join(", ")}
      WHERE contact_id = $${idx++} AND company_id = $${idx}
      RETURNING contact_id
    `;

    const result = await sqlDb.query(query, setValues);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Contact not found" });
    }

    res.json({
      success: true,
      contact_id: result.rows[0].contact_id,
      message: "Contact updated successfully",
    });
  } catch (error) {
    console.error("Error updating contact:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update contact",
      details: error.message,
    });
  }
});

app.put("/api/contacts/:contact_id/pinned", async (req, res) => {
  try {
    const { contact_id } = req.params;
    const { companyId, pinned } = req.body;

    if (!companyId || !contact_id || typeof pinned !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (companyId, contact_id, pinned)",
      });
    }

    const query = `
      UPDATE contacts
      SET pinned = $1, updated_at = CURRENT_TIMESTAMP
      WHERE contact_id = $2 AND company_id = $3
      RETURNING contact_id, pinned
    `;
    const result = await sqlDb.query(query, [pinned, contact_id, companyId]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Contact not found" });
    }

    res.json({
      success: true,
      contact_id: result.rows[0].contact_id,
      pinned: result.rows[0].pinned,
      message: "Pinned status updated successfully",
    });
  } catch (error) {
    console.error("Error updating pinned status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update pinned status",
      details: error.message,
    });
  }
});


// API to reset unread_count to 0 for a contact
app.put("/api/contacts/:contact_id/reset-unread", async (req, res) => {
  try {
    const { contact_id } = req.params;
    const { companyId } = req.body;
    if (!companyId || !contact_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (companyId, contact_id)",
      });
    }
    const query = `
      UPDATE contacts
      SET unread_count = 0, updated_at = CURRENT_TIMESTAMP
      WHERE contact_id = $1 AND company_id = $2
      RETURNING contact_id
    `;
    const result = await sqlDb.query(query, [contact_id, companyId]);
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Contact not found" });
    }
    res.json({
      success: true,
      contact_id: result.rows[0].contact_id,
      message: "Unread count reset to 0",
    });
  } catch (error) {
    console.error("Error resetting unread count:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset unread count",
      details: error.message,
    });
  }
});

app.post("/api/contacts", async (req, res) => {
  try {
    // Extract important fields
    let {
      contact_id,
      companyId,
      contactName,
      name,
      phone,
      chat_id,
      tags,
      unreadCount,
      ...additionalFields
    } = req.body;

    // Fallbacks and normalization
    if (!contact_id && companyId && phone) {
      // If contact_id not provided, generate from companyId and phone
      const formattedPhone = phone.startsWith("+") ? phone.slice(1) : phone;
      contact_id = `${companyId}-${formattedPhone}`;
    }
    if (!companyId || !phone || !contact_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (companyId, phone, contact_id)",
      });
    }

    // Format phone to always have + and only digits
    let formattedPhone = phone.replace(/\D/g, "");
    if (!formattedPhone.startsWith("6")) {
      formattedPhone = "6" + formattedPhone;
    }
    formattedPhone = "+" + formattedPhone;

    // Use contactName or name or fallback to formattedPhone
    const finalName = contactName || name || formattedPhone;

    // Get all columns in the contacts table
    const tableColumnsResult = await sqlDb.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'contacts'
    `);
    const tableColumns = tableColumnsResult.rows.map(r => r.column_name);

    // Helper to convert camelCase to snake_case
    function camelToSnake(str) {
      return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    }

    // Prepare custom_fields object
    let customFields = {};
    let standardFields = {};

    for (const [key, value] of Object.entries(additionalFields)) {
      // Convert camelCase to snake_case for checking
      const snakeKey = camelToSnake(key);
      if (tableColumns.includes(snakeKey)) {
        standardFields[snakeKey] = value;
      } else if (tableColumns.includes(key)) {
        standardFields[key] = value;
      } else {
        // Store in custom_fields as snake_case
        customFields[snakeKey] = value;
      }
    }

    // Prepare contact data with required fields
    const contactData = {
      contact_id,
      company_id: companyId,
      name: finalName,
      phone: formattedPhone,
      chat_id: chat_id || null,
      tags: Array.isArray(tags) ? tags : [],
      unread_count: typeof unreadCount === "number" ? unreadCount : 0,
      created_at: new Date(),
      updated_at: new Date(),
      ...standardFields,
    };

    // Merge/append custom_fields if present
    if (Object.keys(customFields).length > 0) {
      contactData.custom_fields = customFields;
    }

    // Remove undefined values (so only provided fields are inserted/updated)
    Object.keys(contactData).forEach(
      (key) => contactData[key] === undefined && delete contactData[key]
    );

    // Build dynamic insert/update query for only present fields
    const fields = Object.keys(contactData);
    const values = Object.values(contactData);
    const placeholders = fields.map((_, i) => `$${i + 1}`);

    // Build ON CONFLICT update set clause
    const updateSet = fields
      .filter((f) => f !== "contact_id" && f !== "company_id" && f !== "created_at" && f !== "updated_at")
      .map((f) => `${f} = EXCLUDED.${f}`)
      .join(", ");

    const query = `
      INSERT INTO contacts (${fields.join(", ")})
      VALUES (${placeholders.join(", ")})
      ON CONFLICT (contact_id, company_id) DO UPDATE
      SET ${updateSet}${updateSet ? ', ' : ''}updated_at = CURRENT_TIMESTAMP
      RETURNING contact_id
    `;

    const result = await sqlDb.query(query, values);

    res.json({
      success: true,
      contact_id: result.rows[0].contact_id,
      message: "Contact added successfully",
    });
  } catch (error) {
    console.error("Error adding contact:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add contact",
      details: error.message,
    });
  }
});

app.get("/api/contacts-data/:companyId", async (req, res) => {
  try {
    const { companyId } = req.params;
    const query = "SELECT id, tags FROM contacts WHERE company_id = $1";
    const { rows } = await sqlDb.query(query, [companyId]);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching contacts data:", error);
    res.status(500).json({ error: "Failed to fetch contacts data" });
  }
});

app.get("/api/companies/:companyId/monthly-usage", async (req, res) => {
  try {
    const { companyId } = req.params;
    const usage = await getMonthlyUsage(companyId);
    res.json({ usage });
  } catch (error) {
    console.error("Error fetching monthly usage:", error);
    res.status(500).json({ error: "Failed to fetch monthly usage" });
  }
});

// API endpoint
app.get("/api/companies/:companyId/replies", async (req, res) => {
  try {
    const { companyId } = req.params;
    const contactsWithReplies = await countContactsWithReplies(companyId);
    res.json({ contactsWithReplies });
  } catch (error) {
    console.error("Error in /api/companies/:companyId/replies:", error);
    res.status(500).json({ error: "Failed to fetch contacts with replies" });
  }
});

app.post("/api/bots/reinitialize", async (req, res) => {
  try {
    const { botName, phoneIndex } = req.body;

    if (!botName) {
      return res.status(400).json({ error: "botName is required" });
    }

    let phoneCount = 1;
    try {
      const result = await sqlDb.query(
        `SELECT phone_count FROM companies WHERE company_id = $1`,
        [botName]
      );

      if (result.rows.length > 0) {
        phoneCount = result.rows[0].phone_count || 1;
      }
    } catch (error) {
      console.error(`Error getting phone count for ${botName}:`, error);
    }

    const botData = botMap.get(botName);
    let sessionsCleaned = false;

    try {
      if (botData && Array.isArray(botData)) {
        if (phoneIndex !== undefined) {
          if (botData[phoneIndex]?.client) {
            try {
              await destroyClient(botData[phoneIndex].client);
              botData[phoneIndex] = {
                client: null,
                status: "initializing",
                qrCode: null,
                initializationStartTime: Date.now(),
              };
            } catch (error) {
              console.error(
                `Error destroying client for ${botName} phone ${phoneIndex}:`,
                error
              );
            }
          }
        } else {
          await Promise.all(
            botData.map(async (data, index) => {
              if (data?.client) {
                try {
                  await destroyClient(data.client);
                  botData[index] = {
                    client: null,
                    status: "initializing",
                    qrCode: null,
                    initializationStartTime: Date.now(),
                  };
                } catch (error) {
                  console.error(
                    `Error destroying client for ${botName} phone ${index}:`,
                    error
                  );
                }
              }
            })
          );
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (phoneIndex !== undefined) {
        await initializeBot(botName, phoneCount, phoneIndex);
      } else {
        await initializeBot(botName, phoneCount);
      }
    } catch (initError) {
      console.error(
        `Initial reinitialization failed for ${botName}, cleaning sessions and retrying...`,
        initError
      );

      if (phoneIndex !== undefined) {
        sessionsCleaned = await safeCleanup(botName, phoneIndex);
      } else {
        const cleanResults = await Promise.all(
          Array.from({ length: phoneCount }, (_, i) => safeCleanup(botName, i))
        );
        sessionsCleaned = cleanResults.some((result) => result);
      }

      await new Promise((resolve) =>
        setTimeout(resolve, sessionsCleaned ? 5000 : 2000)
      );

      if (phoneIndex !== undefined) {
        await initializeBot(botName, phoneCount, phoneIndex);
      } else {
        await initializeBot(botName, phoneCount);
      }
    }

    res.json({
      success: true,
      message: sessionsCleaned
        ? `${
            phoneIndex !== undefined ? `Phone ${phoneIndex + 1}` : "Bot"
          } reinitialized successfully with clean session`
        : `${
            phoneIndex !== undefined ? `Phone ${phoneIndex + 1}` : "Bot"
          } reinitialized successfully`,
      phoneCount,
      phoneIndex,
      sessionsCleaned,
    });
  } catch (error) {
    console.error("Error reinitializing bot:", error);
    res.status(500).json({
      error: "Failed to reinitialize bot",
      details: error.message,
    });
  }
});


// Disconnect phone endpoint
app.post("/api/bots/:botName/disconnect", async (req, res) => {
  try {
    const { botName } = req.params;
    const { phoneIndex } = req.body;

    if (!botName) {
      return res.status(400).json({ error: "botName is required" });
    }

    const botData = botMap.get(botName);

    if (!botData || !Array.isArray(botData)) {
      return res.status(404).json({ error: "Bot not found" });
    }

    if (phoneIndex !== undefined) {
      // Disconnect specific phone
      if (phoneIndex >= 0 && phoneIndex < botData.length && botData[phoneIndex]?.client) {
        try {
          await destroyClient(botData[phoneIndex].client);
          botData[phoneIndex] = {
            client: null,
            status: "disconnected",
            qrCode: null,
            initializationStartTime: null,
          };
          
          // Broadcast the disconnection status
          broadcastAuthStatus(botName, "disconnected", null, phoneIndex);
          
          res.json({
            success: true,
            message: `Phone ${phoneIndex + 1} disconnected successfully`,
            phoneIndex,
          });
        } catch (error) {
          console.error(`Error disconnecting ${botName} phone ${phoneIndex}:`, error);
          res.status(500).json({
            error: "Failed to disconnect phone",
            details: error.message,
          });
        }
      } else {
        res.status(400).json({ error: "Invalid phone index or phone not connected" });
      }
    } else {
      // Disconnect all phones
      try {
        await Promise.all(
          botData.map(async (data, index) => {
            if (data?.client) {
              try {
                await destroyClient(data.client);
                botData[index] = {
                  client: null,
                  status: "disconnected",
                  qrCode: null,
                  initializationStartTime: null,
                };
                broadcastAuthStatus(botName, "disconnected", null, index);
              } catch (error) {
                console.error(`Error disconnecting ${botName} phone ${index}:`, error);
              }
            }
          })
        );

        res.json({
          success: true,
          message: "All phones disconnected successfully",
        });
      } catch (error) {
        console.error(`Error disconnecting all phones for ${botName}:`, error);
        res.status(500).json({
          error: "Failed to disconnect all phones",
          details: error.message,
        });
      }
    }
  } catch (error) {
    console.error("Error in disconnect endpoint:", error);
    res.status(500).json({
      error: "Failed to disconnect bot",
      details: error.message,
    });
  }
});

// Get all bot statuses for status page
app.get("/api/bot-statuses", async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    
    // Get all companies with v2 = true
    const botsQuery = `
      SELECT 
      c.company_id AS id,
      c.name,
      c.phone_count AS "phoneCount",
      c.category,
      ARRAY(
        SELECT e.email 
        FROM employees e 
        WHERE e.company_id = c.company_id AND e.email IS NOT NULL
      ) AS "employeeEmails"
      FROM companies c
      WHERE c.v2 = true
      AND c.api_url = $1
      ORDER BY c.company_id
    `;

    const companiesResult = await client.query(botsQuery, [process.env.URL]);
    console.log("Fetched companies:", companiesResult.rows.length);
    console.log("url:", process.env.URL);
    console.log("Companies result:", companiesResult);

    // Get status for each bot
    const botStatuses = await Promise.all(
      companiesResult.rows.map(async (company) => {
        const phoneCount = company.phoneCount || 1;
        const phoneStatuses = [];
        
        // Get status for each phone
        for (let i = 0; i < phoneCount; i++) {
          let status = "unknown";
          let phoneNumber = null;
          
          try {
            // Check if bot is in memory
            const botData = botMap.get(company.id);
            if (botData && Array.isArray(botData) && botData[i]) {
              status = botData[i].status || "unknown";
              
              // Try to get phone number from client info
              if (botData[i].client) {
                try {
                  const info = await botData[i].client.info;
                  phoneNumber = info?.wid?.user || null;
                } catch (err) {
                  // Ignore error
                }
              }
            }
            
            // Also check database status
            const dbStatusQuery = `
              SELECT status, phone_number 
              FROM phone_status 
              WHERE company_id = $1 AND phone_index = $2 
              ORDER BY updated_at DESC 
              LIMIT 1
            `;
            const dbResult = await client.query(dbStatusQuery, [company.id, i]);
            
            if (dbResult.rows.length > 0) {
              const dbStatus = dbResult.rows[0].status;
              const dbPhoneNumber = dbResult.rows[0].phone_number;
              
              // Use database status if more recent or if in-memory status is unknown
              if (status === "unknown" || dbStatus) {
                status = dbStatus;
              }
              
              if (!phoneNumber && dbPhoneNumber) {
                phoneNumber = dbPhoneNumber;
              }
            }
          } catch (error) {
            console.error(`Error getting status for ${company.id} phone ${i}:`, error);
          }
          
          phoneStatuses.push({
            phoneIndex: i,
            status: status || "unknown",
            phoneNumber: phoneNumber
          });
        }
        
        return {
          botName: company.id,
          name: company.name,
          phoneCount: phoneCount,
          category: company.category || "juta",
          employeeEmails: company.employeeEmails || [],
          phones: phoneStatuses
        };
      })
    );
    
    res.json(botStatuses);
  } catch (error) {
    console.error("Error fetching bot statuses:", error);
    res.status(500).json({ error: "Failed to fetch bot statuses" });
  } finally {
    if (client) {
      client.release();
    }
  }
});

async function getContactDataFromDatabaseByEmail(email) {
  const client = await pool.connect();

  try {
    if (!email) {
      throw new Error("Email is undefined or null");
    }

    const query = `
      SELECT * FROM public.users 
      WHERE email = $1`;

    const result = await client.query(query, [email]);

    if (result.rowCount === 0) {
      console.log("No matching document.");
      return null;
    } else {
      return { ...result.rows[0] };
    }
  } catch (error) {
    console.error("Error fetching document:", error);
    throw error;
  } finally {
    await safeRelease(client);
  }
}

async function saveThreadIDPostgres(email, threadID) {
  const client = await pool.connect();

  try {
    const query = `
      UPDATE public.users 
      SET thread_id = $1, last_updated = CURRENT_TIMESTAMP 
      WHERE email = $2
      RETURNING id`;

    const result = await client.query(query, [threadID, email]);

    if (result.rowCount === 0) {
      console.log(`No user found with email ${email}. Thread ID not saved.`);
    } else {
      console.log(`Thread ID saved to PostgreSQL for user with email ${email}`);
    }
  } catch (error) {
    console.error("Error saving Thread ID to PostgreSQL:", error);
  } finally {
    await safeRelease(client);
  }
}

async function createThread() {
  const thread = await openai.beta.threads.create();
  return thread;
}

async function addMessage(threadId, message) {
  const response = await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: message,
  });
  return response;
}

async function runAssistant(assistantID, threadId) {
  const response = await openai.beta.threads.runs.create(threadId, {
    assistant_id: assistantID,
  });

  const runId = response.id;

  const answer = await waitForCompletion(threadId, runId);
  return answer;
}

async function checkingStatus(threadId, runId) {
  const runObject = await openai.beta.threads.runs.retrieve(threadId, runId);
  const status = runObject.status;
  if (status == "completed") {
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
    }, 10000); // Changed from 1000ms to 10000ms (10 seconds)
  });
}

// Extract user data from URL parameters
async function handleOpenAIAssistant(message, threadID, assistantid) {
  const assistantId = assistantid;
  await addMessage(threadID, message);
  const answer = await runAssistant(assistantId, threadID);
  return answer;
}

app.get("/api/assistant-test/", async (req, res) => {
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
      await saveThreadIDPostgres(email, threadID);
    }
    console.log(`assistant-test threadID for ${email}: ${threadID}`);

    const answer = await handleOpenAIAssistant(message, threadID, assistantid);
    console.log(`assistant-test answer for ${email}: ${answer}`);
    // Send success response
    res.json({ message: "Assistant replied success", answer });
  } catch (error) {
    // Handle errors
    console.error("Assistant replied user:", error);

    res.status(500).json({ error: error.code });
  }
});

app.get("/api/assistant-test-guest/", async (req, res) => {
  const message = req.query.message;
  const sessionId = req.query.sessionId;
  const assistantid = req.query.assistantid;

  try {
    let threadID;
    const sessionData = await getSessionDataFromDatabase(sessionId);

    if (sessionData?.threadid) {
      threadID = sessionData.threadid;
    } else {
      const thread = await createThread();
      threadID = thread.id;
      await saveThreadIDForSession(sessionId, threadID);
    }

    const answer = await handleOpenAIAssistant(message, threadID, assistantid);

    // Send success response
    res.json({ message: "Assistant replied success", answer });
  } catch (error) {
    // Handle errors
    console.error("Assistant replied user:", error);
    res.status(500).json({ error: error.code });
  }
});

// New function to get session data
async function getSessionDataFromDatabase(sessionId) {
  let client;
  try {
    if (!sessionId) {
      throw new Error("Session ID is undefined or null");
    }

    client = await pool.connect();
    const query = "SELECT data FROM sessions WHERE session_id = $1";
    const result = await client.query(query, [sessionId]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].data;
  } catch (error) {
    console.error("Error fetching session data:", error);
    throw error;
  } finally {
    if (client) await safeRelease(client);
  }
}

// New function to save thread ID for session
async function saveThreadIDForSession(sessionId, threadID) {
  let client;
  try {
    client = await pool.connect();
    const query = `
      INSERT INTO sessions (session_id, data) 
      VALUES ($1, $2) 
      ON CONFLICT (session_id) 
      DO UPDATE SET data = jsonb_set(
        COALESCE(sessions.data, '{}'::jsonb), 
        '{threadid}', 
        to_jsonb($3::text),
        true
      )
    `;

    const data = {
      threadid: threadID,
      createdAt: new Date().toISOString(),
    };

    await client.query(query, [sessionId, data, threadID]);
  } catch (error) {
    console.error("Error saving Thread ID for session:", error);
    throw error;
  } finally {
    if (client) await safeRelease(client);
  }
}

app.get(
  "/api/chats/:token/:locationId/:accessToken/:userName/:userRole/:userEmail/:companyId",
  async (req, res) => {
    const {
      token,
      locationId,
      accessToken,
      userName,
      userRole,
      userEmail,
      companyId,
    } = req.params;

    let allChats = [];
    let count = 500;
    let offset = 0;
    let totalChats = 0;
    let contactsData = [];
    let fetchedChats = 0; // Track the number of fetched chats
    try {
      // Fetch user data to get notifications and pinned chats
      const userDocRef = db.collection("user").doc(userEmail);

      const notificationsRef = userDocRef.collection("notifications");
      const notificationsSnapshot = await notificationsRef.get();
      const notifications = notificationsSnapshot.docs.map((doc) => doc.data());

      const pinnedChatsRef = userDocRef.collection("pinned");
      const pinnedChatsSnapshot = await pinnedChatsRef.get();
      const pinnedChats = pinnedChatsSnapshot.docs.map((doc) => doc.data());
      let whapiToken2 = token;
      const companyDocRef = db.collection("companies").doc(companyId);
      const companyDoc = await companyDocRef.get();
      const companyData = companyDoc.data();
      whapiToken2 = companyData.whapiToken2 || token;

      // Fetch all chats from WhatsApp API
      if (token !== "none") {
        while (true) {
          // Add rate limiting for WhatsApp API calls
          if (!checkRateLimit(`whatsapp_api_${companyId}`)) {
            console.log(`Rate limit reached for WhatsApp API, waiting...`);
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            continue;
          }

          const response = await fetch(
            `https://gate.whapi.cloud/chats?count=${count}&offset=${offset}`,
            {
              headers: { Authorization: "Bearer " + token },
            }
          );
          const data = await response.json();

          if (offset === 0 && data.total) {
            totalChats = data.total;
          }
          if (data.chats.length === 0) break;
          allChats = allChats.concat(data.chats);
          fetchedChats += data.chats.length; // Update the number of fetched chats
          offset += count;
          
          // Add delay between API calls to prevent overwhelming the network
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        }
        count = 500;
        offset = 0;
        if (companyId === "018") {
          while (true) {
            // Add rate limiting for second WhatsApp API calls
            if (!checkRateLimit(`whatsapp_api2_${companyId}`)) {
              console.log(`Rate limit reached for WhatsApp API2, waiting...`);
              await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
              continue;
            }

            const response = await fetch(
              `https://gate.whapi.cloud/chats?count=${count}&offset=${offset}`,
              {
                headers: { Authorization: "Bearer " + whapiToken2 },
              }
            );
            const data = await response.json();
            if (offset === 0 && data.total) {
              totalChats = data.total;
            }
            if (data.chats.length === 0) break;
            allChats = allChats.concat(data.chats);
            fetchedChats += data.chats.length; // Update the number of fetched chats
            offset += count;
            
            // Add delay between API calls to prevent overwhelming the network
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
          }
        }
      }
      let totalContacts = 0;
      let lastContactId = null;
      let maxContacts = 3000;
      let maxRetries = 3;
      while (totalContacts < maxContacts) {
        // Add rate limiting for contact fetching
        if (!checkRateLimit(`contact_fetch_${companyId}`)) {
          console.log(`Rate limit reached for contact fetching, waiting...`);
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
          continue;
        }

        let retries = 0;
        let contacts = []; // Initialize contacts outside the retry loop

        const params = {
          locationId: locationId,
          limit: 100,
        };

        if (lastContactId) {
          params.startAfterId = lastContactId;
        }

        const response = await axios.get(
          "https://services.leadconnectorhq.com/contacts/",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Version: "2021-07-28",
            },
            params: params,
          }
        );

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
      const mappedChats = allChats
        .map((chat) => {
          if (!chat.id) return null;
          const phoneNumber = `+${chat.id.split("@")[0]}`;
          const contact = contactsData.find(
            (contact) => contact.phone === phoneNumber
          );
          let unreadCount = notifications.filter(
            (notif) => notif.chat_id === chat.id && !notif.read
          ).length;

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
        })
        .filter(Boolean);

      // Merge WhatsApp contacts with existing contacts
      mappedChats.forEach((chat) => {
        const phoneNumber = `+${chat.id.split("@")[0]}`;
        const existingContact = contactsData.find(
          (contact) => contact.phone === phoneNumber
        );
        if (existingContact) {
          existingContact.chat_id = chat.id;
          existingContact.last_message =
            chat.last_message || existingContact.last_message;
          existingContact.chat = chat;
          existingContact.unreadCount =
            (existingContact.unreadCount || 0) + chat.unreadCount;
          existingContact.tags = [
            ...new Set([...existingContact.tags, ...chat.tags]),
          ];
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
      contactsData.forEach((contact) => {
        contact.pinned = pinnedChats.some(
          (pinned) => pinned.chat_id === contact.chat_id
        );
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
      if (userRole === "2") {
        filteredContacts = contactsData.filter((contact) =>
          contact.tags.some(
            (tag) =>
              typeof tag === "string" &&
              tag.toLowerCase().includes(userName.toLowerCase())
          )
        );
        const groupChats = contactsData.filter(
          (contact) => contact.chat_id && contact.chat_id.includes("@g.us")
        );
        filteredContacts = filteredContacts.concat(groupChats);
      }

      // Include group chats regardless of the role

      // Remove duplicate contacts
      filteredContacts = filteredContacts.reduce((unique, contact) => {
        if (!unique.some((c) => c.phone === contact.phone)) {
          unique.push(contact);
        }
        return unique;
      }, []);
      // console.log(filteredContacts.length);
      res.json({ contacts: filteredContacts, totalChats });
    } catch (error) {
      console.error(error);
      res.status(500).send("Internal Server Error");
    }
  }
);

app.get("/api/dashboard/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const monthKey = getCurrentMonthKey();

  try {
    const companyQuery = `SELECT name FROM companies WHERE company_id = $1`;
    const companyResult = await pool.query(companyQuery, [companyId]);
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: "Company not found" });
    }

    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - now.getDay()
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const contactsQuery = `
      SELECT 
        contact_id,
        created_at,
        tags,
        (SELECT COUNT(*) FROM messages WHERE contact_id = c.contact_id AND company_id = c.company_id AND NOT from_me) as reply_count,
        (SELECT COUNT(*) FROM messages WHERE contact_id = c.contact_id AND company_id = c.company_id AND from_me) as outgoing_count
      FROM contacts c
      WHERE company_id = $1
    `;
    const contactsResult = await pool.query(contactsQuery, [companyId]);

    let totalContacts = 0;
    let closedContacts = 0;
    let openContacts = 0;
    let todayContacts = 0;
    let weekContacts = 0;
    let monthContacts = 0;
    let numReplies = 0;
    const employeePerformance = {};

    contactsResult.rows.forEach(contact => {
      totalContacts++;
      const dateAdded = contact.created_at ? new Date(contact.created_at) : null;

      if (contact.tags && contact.tags.some(tag => tag.toLowerCase() === 'closed')) {
        closedContacts++;
      } else {
        openContacts++;
      }

      if (dateAdded) {
        if (dateAdded >= startOfDay) todayContacts++;
        if (dateAdded >= startOfWeek) weekContacts++;
        if (dateAdded >= startOfMonth) monthContacts++;
      }

      numReplies += parseInt(contact.reply_count) || 0;

      if (contact.tags && contact.tags.assigned_to) {
        const employeeName = contact.tags.assigned_to;
        employeePerformance[employeeName] = employeePerformance[employeeName] || {
          assignedContacts: 0,
          outgoingMessages: 0,
          closedContacts: 0
        };
        
        employeePerformance[employeeName].assignedContacts++;
        if (contact.tags.closed === true) {
          employeePerformance[employeeName].closedContacts++;
        }
        employeePerformance[employeeName].outgoingMessages += parseInt(contact.outgoing_count) || 0;
      }
    });

    const responseRate = totalContacts > 0 ? (numReplies / totalContacts) * 100 : 0;
    const averageRepliesPerLead = totalContacts > 0 ? numReplies / totalContacts : 0;
    const engagementScore = responseRate * 0.4 + averageRepliesPerLead * 0.6;
    const conversionRate = totalContacts > 0 ? (closedContacts / totalContacts) * 100 : 0;

    const employeesQuery = `
      SELECT 
        e.employee_id,
        e.name,
        e.role,
        e.email,
        e.phone_number,
        COALESCE((
          SELECT COUNT(*) 
          FROM assignments a 
          WHERE a.employee_id = e.employee_id 
            AND a.company_id = e.company_id
            AND a.month_key = $1
        ), 0) as current_month_assignments
      FROM employees e
      WHERE e.company_id = $2
      ORDER BY current_month_assignments DESC
    `;
    const employeesResult = await pool.query(employeesQuery, [monthKey, companyId]);

    const employees = employeesResult.rows.map(employee => ({
      ...employee,
      ...(employeePerformance[employee.name] || {
        assignedContacts: 0,
        outgoingMessages: 0,
        closedContacts: 0
      })
    }));

    const phoneStatsQuery = `
      SELECT 
        phone_index,
        COUNT(*) as total_assignments,
        COUNT(DISTINCT contact_id) as unique_contacts,
        COUNT(DISTINCT employee_id) as active_agents
      FROM assignments
      WHERE company_id = $1
        AND month_key = $2
      GROUP BY phone_index
      ORDER BY phone_index
    `;
    const phoneStatsResult = await pool.query(phoneStatsQuery, [companyId, monthKey]);

    const dashboardData = {
      company: companyResult.rows[0].name,
      kpi: { 
        totalContacts, 
        numReplies, 
        closedContacts, 
        openContacts 
      },
      engagementMetrics: {
        responseRate: responseRate.toFixed(2),
        averageRepliesPerLead: averageRepliesPerLead.toFixed(2),
        engagementScore: engagementScore.toFixed(2),
        conversionRate: conversionRate.toFixed(2),
      },
      leadsOverview: {
        total: totalContacts,
        today: todayContacts,
        week: weekContacts,
        month: monthContacts,
      },
      phoneLineStats: phoneStatsResult.rows.map(row => ({
        phoneIndex: row.phone_index,
        totalAssignments: row.total_assignments,
        uniqueContacts: row.unique_contacts,
        activeAgents: row.active_agents
      })),
      employeePerformance: employees,
    };

    res.json(dashboardData);
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({ 
      error: "Internal server error",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post("/api/create-contact", async (req, res) => {
  const {
    contactName,
    lastName,
    email,
    phone,
    address1,
    companyName,
    companyId,
  } = req.body;

  const client = await pool.connect();

  try {
    if (!phone) {
      return res.status(400).json({ error: "Phone number is required." });
    }

    const formattedPhoneWithoutPlus = formatPhoneNumber(phone);
    const phoneWithPlus = `+${formattedPhoneWithoutPlus}`;
    const contact_id = `${companyId}-${formattedPhoneWithoutPlus}`;

    const checkQuery = `
      SELECT id FROM contacts 
      WHERE phone = $1 AND company_id = $2
    `;
    const checkResult = await client.query(checkQuery, [
      phoneWithPlus,
      companyId,
    ]);

    if (checkResult.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "A contact with this phone number already exists." });
    }

    const contactData = {
      contact_id: contact_id,
      company_id: companyId,
      name: contactName + (lastName ? ` ${lastName}` : ""),
      contact_name: contactName,
      phone: phoneWithPlus,
      email: email,
      thread_id: null,
      company: companyName,
      address1: address1,
      created_at: new Date(),
      unread_count: 0,
      profile: {},
      tags: [],
      custom_fields: {},
      last_message: null,
      chat_data: {},
    };

    const insertQuery = `
      INSERT INTO contacts (
        contact_id, company_id, name, contact_name, phone, email, 
        thread_id, company, address1, created_at, unread_count,
        profile, tags, custom_fields, last_message, chat_data
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      ) RETURNING *
    `;

    const insertValues = [
      contactData.contact_id,
      contactData.company_id,
      contactData.name,
      contactData.contact_name,
      contactData.phone,
      contactData.email,
      contactData.thread_id,
      contactData.company,
      contactData.address1,
      contactData.created_at,
      contactData.unread_count,
      contactData.profile,
      contactData.tags,
      contactData.custom_fields,
      contactData.last_message,
      contactData.chat_data,
    ];

    const result = await client.query(insertQuery, insertValues);
    const insertedContact = result.rows[0];

    res.status(201).json({
      message: "Contact added successfully!",
      contact: insertedContact,
    });
  } catch (error) {
    console.error("Error adding contact:", error);
    res.status(500).json({
      error: "An error occurred while adding the contact: " + error.message,
    });
  } finally {
    await safeRelease(client);
  }
});

app.get("/api/bots", async (req, res) => {
  let client;
  try {
    client = await pool.connect();

    const botsQuery = `
      SELECT 
        c.company_id AS id,
        c.name,
        c.v2,
        c.phone_count AS "phoneCount",
        c.assistant_ids AS "assistantId",
        c.trial_end_date AS "trialEndDate",
        c.trial_start_date AS "trialStartDate",
        c.plan,
        c.category,
        c.api_url AS "apiUrl",
        c.phone_numbers AS "phoneNumbers",
        ARRAY(
          SELECT e.email 
          FROM employees e 
          WHERE e.company_id = c.company_id AND e.email IS NOT NULL
        ) AS "employeeEmails"
      FROM companies c
      WHERE c.v2 = true
      AND c.api_url = $1
    `;

    const apiUrl = 'https://juta-dev.ngrok.dev';
    const companiesResult = await client.query(botsQuery, [apiUrl]);

    const botsPromises = companiesResult.rows.map(async (company) => {
      const botData = botMap.get(company.id);
      const phoneCount = company.phoneCount || 1;
      let phoneInfoArray = [];

      if (Array.isArray(botData)) {
        phoneInfoArray = await Promise.all(
          botData.map(async (data, index) => {
            if (data?.client) {
              try {
                const info = await data.client.info;
                return info?.wid?.user || null;
              } catch (err) {
                console.error(
                  `Error getting client info for bot ${company.id} phone ${index}:`,
                  err
                );
                return null;
              }
            }
            return null;
          })
        );
      }

      return {
        botName: company.id,
        phoneCount: phoneCount,
        name: company.name,
        v2: company.v2,
        clientPhones: phoneInfoArray,
        assistantId: company.assistantId || [],
        trialEndDate: company.trialEndDate
          ? new Date(company.trialEndDate)
          : null,
        trialStartDate: company.trialStartDate
          ? new Date(company.trialStartDate)
          : null,
        plan: company.plan || null,
        employeeEmails: company.employeeEmails || [],
        category: company.category || "juta",
        apiUrl: company.apiUrl || null,
      };
    });

    const bots = await Promise.all(botsPromises);
    res.json(bots);
  } catch (error) {
    console.error("Error fetching bots:", error);
    res.status(500).json({
      error: "Failed to fetch bots",
      details: error.message,
    });
  } finally {
    if (client) {
      await safeRelease(client);
    }
  }
});

app.put("/api/bots/:botId/category", async (req, res) => {
  const { botId } = req.params;
  const { category } = req.body;

  try {
    // Validate input
    if (!category) {
      return res.status(400).json({
        error: "Category is required in request body",
      });
    }

    // Check if company exists
    const companyExists = await sqlDb.query(
      "SELECT id FROM companies WHERE company_id = $1",
      [botId]
    );

    if (companyExists.rows.length === 0) {
      return res.status(404).json({
        error: "Company not found",
      });
    }

    // Update the category in PostgreSQL
    await sqlDb.query("UPDATE companies SET category = $1 WHERE company_id = $2", [
      category,
      botId,
    ]);

    res.json({
      success: true,
      message: "Category updated successfully",
      data: {
        botId,
        category,
      },
    });
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({
      error: "Failed to update category",
      details: error.message,
    });
  }
});

function broadcastBotActivity(botName, isActive) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "bot_activity",
          botName,
          isActive,
        })
      );
    }
  });
}

// New endpoint to delete trial end date
app.delete("/api/bots/:botId/trial-end-date", async (req, res) => {
  try {
    const { botId } = req.params;

    // Check if company exists
    const companyExists = await sqlDb.query(
      "SELECT id FROM companies WHERE company_id = $1",
      [botId]
    );

    if (companyExists.rows.length === 0) {
      return res.status(404).json({ error: "Bot not found" });
    }

    // Update the trial_end_date to NULL in PostgreSQL
    await sqlDb.query(
      "UPDATE companies SET trial_end_date = NULL WHERE company_id = $1",
      [botId]
    );

    res.json({
      success: true,
      message: "Trial end date deleted successfully",
      botId,
    });
  } catch (error) {
    console.error("Error deleting trial end date:", error);
    res.status(500).json({
      error: "Failed to delete trial end date",
      details: error.message,
    });
  }
});

app.get("/api/bot-status/:companyId", async (req, res) => {
  const { companyId } = req.params;
  
// Allow both localhost for development and your Vercel domain for production
const allowedOrigins = [
  "http://localhost:5173",
  "https://juta-crm-v3.vercel.app"
];

const origin = req.headers.origin;
if (allowedOrigins.includes(origin)) {
  res.header("Access-Control-Allow-Origin", origin);
}
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  
  try {
    // First get the company from database
    const companyData = await sqlDb.getRow(
      "SELECT * FROM companies WHERE company_id = $1::varchar",
      [companyId]
    );

    if (!companyData) {
      console.log("ERROR: Company not found in database");
      return res.status(404).json({ error: "Company not found" });
    }
    
    // Then get the bot status
    const botData = botMap.get(companyId);

    if (botData && Array.isArray(botData)) {      
      if (botData.length === 1) {
        const { status, qrCode } = botData[0];
        
        let phoneInfo = null;

        if (botData[0]?.client) {
          try {
            const info = await botData[0].client.info;
            phoneInfo = info?.wid?.user || null;
          } catch (err) {
            console.error(
              `Error getting client info for company ${companyId}:`,
              err
            );
            console.error("Error stack:", err.stack);
          }
        } else {
          console.log("No client object found in bot data");
        }

        const response = {
          status,
          qrCode,
          phoneInfo,
          companyId,
          v2: companyData.v2,
          trialEndDate: companyData.trial_end_date,
          apiUrl: companyData.api_url,
          phoneCount: companyData.phone_count,
        };
        res.json(response);
      } else {
        const statusArray = await Promise.all(
          botData.map(async (phone, index) => {            
            let phoneInfo = null;

            if (phone?.client) {
              try {
                const info = await phone.client.info;
                phoneInfo = info?.wid?.user || null;
              } catch (err) {
                console.error(
                  `Error getting client info for company ${companyId} phone ${index}:`,
                  err
                );
                console.error(`Phone ${index} error stack:`, err.stack);
              }
            } else {
              console.log(`Phone ${index} has no client object`);
            }

            const phoneResult = {
              phoneIndex: index,
              status: phone.status,
              qrCode: phone.qrCode,
              phoneInfo,
            };
            return phoneResult;
          })
        );

        const response = {
          phones: statusArray,
          companyId,
          v2: companyData.v2,
          trialEndDate: companyData.trial_end_date,
          apiUrl: companyData.api_url,
          phoneCount: companyData.phone_count,
        };
        res.json(response);
      }
    } else {    
      const response = {
        status: "initializing",
        qrCode: null,
        phoneInfo: null,
        companyId,
        v2: companyData.v2,
        trialEndDate: companyData.trial_end_date,
        apiUrl: companyData.api_url,
        phoneCount: companyData.phone_count,
      };
      res.json(response);
    }   
  } catch (error) {
    console.error("=== BOT STATUS REQUEST FAILED ===");
    console.error(`Error getting status for company ${companyId}:`, error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    console.error("Error name:", error.name);
    console.error("Error code:", error.code);
    res.status(500).json({ error: "Failed to get status" });
  }
});

app.get('/api/ai-responses', async (req, res) => {
  console.log("=== Starting GET /api/ai-responses ===");
  console.log("Query params:", req.query);

  const { companyId, type } = req.query;

  // Validation
  if (!companyId) {
    console.error("Missing companyId");
    return res.status(400).json({ success: false, message: 'Missing companyId' });
  }

  if (!type || !['video', 'voice', 'tag', 'document', 'image', 'assign'].includes(type)) {
    console.error("Invalid or missing type");
    return res.status(400).json({ 
      success: false, 
      message: 'Type is required and must be one of: video, voice, tag, document, image, assign' 
    });
  }

  const sqlClient = await pool.connect();

  try {
    let tableName;
    switch (type) {
      case 'video': tableName = 'ai_video_responses'; break;
      case 'voice': tableName = 'ai_voice_responses'; break;
      case 'tag': tableName = 'ai_tag_responses'; break;
      case 'document': tableName = 'ai_document_responses'; break;
      case 'image': tableName = 'ai_image_responses'; break;
      case 'assign': tableName = 'ai_assign_responses'; break;
    }

    const query = `SELECT * FROM public.${tableName} WHERE company_id = $1 ORDER BY created_at DESC`;
    console.log("Executing query:", query);

    const result = await sqlClient.query(query, [companyId]);
    console.log(`Found ${result.rowCount} ${type} responses`);

    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rowCount
    });

  } catch (error) {
    console.error("=== Error in GET /api/ai-responses ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    res.status(500).json({
      success: false,
      message: `Failed to fetch ${type} responses`,
      error: error.message
    });
  } finally {
    await safeRelease(sqlClient);
    console.log("Database client released");
  }
});

app.post('/api/ai-responses', async (req, res) => {
  console.log("=== Starting POST /api/ai-responses ===");
  console.log("Request body:", JSON.stringify(req.body, null, 2));

  const { companyId, type, data } = req.body;

  // Validation
  if (!companyId) {
    console.error("Missing companyId");
    return res.status(400).json({ success: false, message: 'Missing companyId' });
  }

  if (!type || !['video', 'voice', 'tag', 'document', 'image', 'assign'].includes(type)) {
    console.error("Invalid or missing type");
    return res.status(400).json({ 
      success: false, 
      message: 'Type is required and must be one of: video, voice, tag, document, image, assign' 
    });
  }

  if (!data) {
    console.error("Missing data");
    return res.status(400).json({ success: false, message: 'Missing data for the response' });
  }

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");
    console.log("Database transaction started");

    const responseId = require('crypto').randomUUID();
    console.log("Generated response ID:", responseId);

    let insertQuery;
    let queryParams;
    let responseData;

    switch (type) {
      case 'video':
        insertQuery = `
          INSERT INTO public.ai_video_responses (
            response_id, company_id, keywords, 
            video_urls, captions, keyword_source, status, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;
        queryParams = [
          responseId,
          companyId,
          JSON.stringify(data.keywords) || [],
          JSON.stringify(data.video_urls) || [],
          data.captions || [],
          data.keyword_source || 'user',
          data.status || 'active',
          data.description || '',
        ];
        break;

      case 'voice':
        insertQuery = `
          INSERT INTO public.ai_voice_responses (
            response_id, company_id, keywords, voice_urls, captions,
            keyword_source, status, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;
        queryParams = [
          responseId,
          companyId,
          JSON.stringify(data.keywords) || [],
          JSON.stringify(data.voice_urls) || [],
          data.captions || [],
          data.keyword_source || 'user',
          data.status || 'active',
          data.description || '',
        ];
        break;

      case 'tag':
        insertQuery = `
          INSERT INTO public.ai_tag_responses (
            response_id, company_id, tags,
            keywords, remove_tags, keyword_source, tag_action_mode, status, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `;
        queryParams = [
          responseId,
          companyId,
          JSON.stringify(data.tags) || null,
          JSON.stringify(data.keywords) || null,
          JSON.stringify(data.remove_tags) || null,
          data.keyword_source || 'user',
          data.tag_action_mode || 'add',
          data.status || 'active',
          data.description || '',
        ];
        break;

      case 'document':
        insertQuery = `
          INSERT INTO public.ai_document_responses (
            response_id, company_id, document_urls,
            document_names, keywords, keyword_source, status, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;
        queryParams = [
          responseId,
          companyId,
          JSON.stringify(data.document_urls) || [],
          JSON.stringify(data.document_names) || [],
          JSON.stringify(data.keywords) || [],
          data.keyword_source || 'user',
          data.status || 'active',
          data.description || '',
        ];
        break;

      case 'image':
        insertQuery = `
          INSERT INTO public.ai_image_responses (
            response_id, company_id,
            keywords, image_urls, keyword_source, status, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `;
        queryParams = [
          responseId,
          companyId,
          JSON.stringify(data.keywords) || [],
          JSON.stringify(data.image_urls) || [],
          data.keyword_source || 'user',
          data.status || 'active',
          data.description || '',
        ];
        break;

      case 'assign':
        insertQuery = `
          INSERT INTO public.ai_assign_responses (
            response_id, company_id, keywords,
            keyword_source, assigned_employees, description, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `;
        queryParams = [
          responseId,
          companyId,
          JSON.stringify(data.keywords) || null,
          data.keyword_source || 'user',
          JSON.stringify(data.assigned_employees) || null,
          data.description || '',
          data.status || 'active'
        ];
        break;
    }

    console.log("Executing insert with params:", queryParams);
    const result = await sqlClient.query(insertQuery, queryParams);
    responseData = result.rows[0];
    console.log("Response created successfully:", responseData);

    await sqlClient.query("COMMIT");
    console.log("Database transaction committed successfully");

    res.status(201).json({
      success: true,
      message: `${type} response created successfully`,
      data: responseData
    });

  } catch (error) {
    await safeRollback(sqlClient);
    console.error("=== Error in POST /api/ai-responses ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    res.status(500).json({
      success: false,
      message: `Failed to create ${type} response`,
      error: error.message
    });
  } finally {
    await safeRelease(sqlClient);
    console.log("Database client released");
  }
});

app.put('/api/ai-responses/:id', async (req, res) => {
  console.log("=== Starting PUT /api/ai-responses/:id ===");
  console.log("Request params:", req.params);
  console.log("Request body:", JSON.stringify(req.body, null, 2));

  const { id } = req.params;
  const { type, data } = req.body;

  // Validation
  if (!id) {
    console.error("Missing id");
    return res.status(400).json({ success: false, message: 'Missing response id' });
  }

  if (!type || !['video', 'voice', 'tag', 'document', 'image', 'assign'].includes(type)) {
    console.error("Invalid or missing type");
    return res.status(400).json({ 
      success: false, 
      message: 'Type is required and must be one of: video, voice, tag, document, image, assign' 
    });
  }

  if (!data) {
    console.error("Missing data");
    return res.status(400).json({ success: false, message: 'Missing update data' });
  }

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");
    console.log("Database transaction started");

    let updateQuery;
    let queryParams = [];
    let responseData;

    switch (type) {
      case 'video':
        updateQuery = `
          UPDATE public.ai_video_responses SET
            keywords = COALESCE($1, keywords),
            video_urls = COALESCE($2, video_urls),
            captions = COALESCE($3, captions),
            keyword_source = COALESCE($4, keyword_source),
            status = COALESCE($5, status),
            description = COALESCE($6, description),
            updated_at = CURRENT_TIMESTAMP
          WHERE response_id = $7
          RETURNING *
        `;
        queryParams = [
          data.keywords ? JSON.stringify(data.keywords) : null,
          data.video_urls ? JSON.stringify(data.video_urls) : null,
          data.captions || null,
          data.keyword_source || null,
          data.status || null,
          data.description || null,
          id
        ];
        break;

      case 'voice':
        updateQuery = `
          UPDATE public.ai_voice_responses SET
            keywords = COALESCE($1, keywords),
            voice_urls = COALESCE($2, voice_urls),
            captions = COALESCE($3, captions),
            keyword_source = COALESCE($4, keyword_source),
            status = COALESCE($5, status),
            description = COALESCE($6, description),
            updated_at = CURRENT_TIMESTAMP
          WHERE response_id = $7
          RETURNING *
        `;
        queryParams = [
          data.keywords ? JSON.stringify(data.keywords) : null,
          data.voice_urls ? JSON.stringify(data.voice_urls) : null,
          data.captions || null,
          data.keyword_source || null,
          data.status || null,
          data.description || null,
          id
        ];
        break;

      case 'tag':
        updateQuery = `
          UPDATE public.ai_tag_responses SET
            tags = COALESCE($1, tags),
            keywords = COALESCE($2, keywords),
            remove_tags = COALESCE($3, remove_tags),
            keyword_source = COALESCE($4, keyword_source),
            tag_action_mode = COALESCE($5, tag_action_mode),
            status = COALESCE($6, status),
            description = COALESCE($7, description),
            updated_at = CURRENT_TIMESTAMP
          WHERE response_id = $8
          RETURNING *
        `;
        queryParams = [
          data.tags ? JSON.stringify(data.tags) : null,
          data.keywords ? JSON.stringify(data.keywords) : null,
          data.remove_tags ? JSON.stringify(data.remove_tags) : null,
          data.keyword_source || null,
          data.tag_action_mode || null,
          data.status || null,
          data.description || null,
          id
        ];
        break;

      case 'document':
        updateQuery = `
          UPDATE public.ai_document_responses SET
            document_urls = COALESCE($1, document_urls),
            document_names = COALESCE($2, document_names),
            keywords = COALESCE($3, keywords),
            keyword_source = COALESCE($4, keyword_source),
            status = COALESCE($5, status),
            description = COALESCE($6, description),
            updated_at = CURRENT_TIMESTAMP
          WHERE response_id = $7
          RETURNING *
        `;
        queryParams = [
          data.document_urls ? JSON.stringify(data.document_urls) : null,
          data.document_names ? JSON.stringify(data.document_names) : null,
          data.keywords ? JSON.stringify(data.keywords) : null,
          data.keyword_source || null,
          data.status || null,
          data.description || null,
          id
        ];
        break;

      case 'image':
        updateQuery = `
          UPDATE public.ai_image_responses SET
            keywords = COALESCE($1, keywords),
            image_urls = COALESCE($2, image_urls),
            keyword_source = COALESCE($3, keyword_source),
            status = COALESCE($4, status),
            description = COALESCE($5, description),
            updated_at = CURRENT_TIMESTAMP
          WHERE response_id = $6
          RETURNING *
        `;
        queryParams = [
          data.keywords ? JSON.stringify(data.keywords) : null,
          data.image_urls ? JSON.stringify(data.image_urls) : null,
          data.keyword_source || null,
          data.status || null,
          data.description || null,
          id
        ];
        break;

      case 'assign':
        updateQuery = `
          UPDATE public.ai_assign_responses SET
            keywords = COALESCE($1, keywords),
            keyword_source = COALESCE($2, keyword_source),
            assigned_employees = COALESCE($3, assigned_employees),
            description = COALESCE($4, description),
            status = COALESCE($5, status),
            updated_at = CURRENT_TIMESTAMP
          WHERE response_id = $6
          RETURNING *
        `;
        queryParams = [
          data.keywords ? JSON.stringify(data.keywords) : null,
          data.keyword_source || null,
          data.assigned_employees ? JSON.stringify(data.assigned_employees) : null,
          data.description || null,
          data.status || null,
          id
        ];
        break;
    }

    console.log("Executing update with params:", queryParams);
    const result = await sqlClient.query(updateQuery, queryParams);
    
    if (result.rowCount === 0) {
      console.error("No response found with id:", id);
      await safeRollback(sqlClient);
      return res.status(404).json({
        success: false,
        message: `${type} response not found with id: ${id}`
      });
    }

    responseData = result.rows[0];
    console.log("Response updated successfully:", responseData);

    await sqlClient.query("COMMIT");
    console.log("Database transaction committed successfully");

    res.status(200).json({
      success: true,
      message: `${type} response updated successfully`,
      data: responseData
    });

  } catch (error) {
    await safeRollback(sqlClient);
    console.error("=== Error in PUT /api/ai-responses/:id ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    res.status(500).json({
      success: false,
      message: `Failed to update ${type} response`,
      error: error.message
    });
  } finally {
    await safeRelease(sqlClient);
    console.log("Database client released");
  }
});

app.delete('/api/ai-responses/:id', async (req, res) => {
  console.log("=== Starting DELETE /api/ai-responses/:id ===");
  console.log("Request params:", req.params);
  console.log("Query params:", req.query);

  const { id } = req.params;
  const { type } = req.query;

  // Validation
  if (!id) {
    console.error("Missing id");
    return res.status(400).json({ success: false, message: 'Missing response id' });
  }

  if (!type || !['video', 'voice', 'tag', 'document', 'image', 'assign'].includes(type)) {
    console.error("Invalid or missing type");
    return res.status(400).json({ 
      success: false, 
      message: 'Type is required and must be one of: video, voice, tag, document, image, assign' 
    });
  }

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");
    console.log("Database transaction started");

    let tableName;
    switch (type) {
      case 'video': tableName = 'ai_video_responses'; break;
      case 'voice': tableName = 'ai_voice_responses'; break;
      case 'tag': tableName = 'ai_tag_responses'; break;
      case 'document': tableName = 'ai_document_responses'; break;
      case 'image': tableName = 'ai_image_responses'; break;
      case 'assign': tableName = 'ai_assign_responses'; break;
    }

    const deleteQuery = `DELETE FROM public.${tableName} WHERE response_id = $1 RETURNING *`;
    console.log("Executing delete query:", deleteQuery);

    const result = await sqlClient.query(deleteQuery, [id]);
    
    if (result.rowCount === 0) {
      console.error("No response found with id:", id);
      await safeRollback(sqlClient);
      return res.status(404).json({
        success: false,
        message: `${type} response not found with id: ${id}`
      });
    }

    const deletedResponse = result.rows[0];
    console.log("Response deleted successfully:", deletedResponse);

    await sqlClient.query("COMMIT");
    console.log("Database transaction committed successfully");

    res.status(200).json({
      success: true,
      message: `${type} response deleted successfully`,
      data: deletedResponse
    });

  } catch (error) {
    await safeRollback(sqlClient);
    console.error("=== Error in DELETE /api/ai-responses/:id ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    res.status(500).json({
      success: false,
      message: `Failed to delete ${type} response`,
      error: error.message
    });
  } finally {
    await safeRelease(sqlClient);
    console.log("Database client released");
  }
});

app.post("/api/v2/messages/text/:companyId/:chatId", async (req, res) => {
  console.log("\n=== New Text Message Request ===");
  const companyId = req.params.companyId;
  const chatId = req.params.chatId;
  const {
    message,
    quotedMessageId,
    phoneIndex: requestedPhoneIndex,
    userName: requestedUserName,
  } = req.body;

  console.log("Request details:", {
    companyId,
    chatId,
    messageLength: message?.length,
    hasQuotedMessage: Boolean(quotedMessageId),
    requestedPhoneIndex,
    userName: requestedUserName,
  });

  const phoneIndex =
    requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;
  const userName = requestedUserName !== undefined ? requestedUserName : "";
  const contactID = companyId + "-" + chatId.split("@")[0];
  const phoneNumber = "+" + chatId.split("@")[0];

  try {
    // 1. Get the client for this company from botMap
    console.log("\n=== Client Validation ===");
    const botData = botMap.get(companyId);
    console.log("Bot data found:", Boolean(botData));
    console.log(
      "Available phone indices:",
      botData ? botData.map((_, i) => i) : []
    );

    if (!botData) {
      console.error("WhatsApp client not found for company:", companyId);
      return res.status(404).send("WhatsApp client not found for this company");
    }

    const client = botData[phoneIndex]?.client;
    console.log("Client status:", {
      phoneIndex,
      hasClient: Boolean(client),
      clientInfo: client
        ? {
            info: (() => {
              try {
                return client.info;
              } catch (e) {
                return "Error getting info";
              }
            })(),
            isConnected: client.isConnected,
          }
        : null,
    });

    if (!client) {
      console.error(
        "No active WhatsApp client found for phone index:",
        phoneIndex
      );
      return res
        .status(404)
        .send("No active WhatsApp client found for this company");
    }

    // 2. Send the message
    console.log("\n=== Sending Message ===");
    let sentMessage;
    try {
      if (quotedMessageId) {
        console.log("Sending with quoted message:", quotedMessageId);
        sentMessage = await client.sendMessage(chatId, message, {
          quotedMessageId,
        });
      } else {
        console.log("Sending regular message");
        sentMessage = await client.sendMessage(chatId, message);
      }

      console.log("Message sent successfully:", {
        messageId: sentMessage?.id?._serialized ?? 'no id',
        timestamp: sentMessage?.timestamp ?? 'no timestamp',
        type: sentMessage?.type ?? 'no type',
      });
    } catch (sendError) {
      console.error("\n=== Message Send Error ===");
      console.error("Error Type:", sendError.name);
      console.error("Error Message:", sendError.message);
      console.error("Stack:", sendError.stack);
      throw sendError;
    }

    // 3. Process response and save to SQL
    console.log("\n=== Saving to Database ===");

    // 4. Save to SQL
    try {
      const contactData = await getContactDataFromDatabaseByPhone(
        phoneNumber,
        companyId
      );

      // Add author username after sending message
      await findAndUpdateMessageAuthor(message, contactID, companyId, userName);

      // 5. Handle OpenAI integration for the receiver's contact
      if (contactData?.thread_id) {
        console.log("Using existing thread:", contactData.thread_id);
        await handleOpenAIMyMessage(message, contactData.thread_id);
      } else {
        console.log("Creating new OpenAI thread");
        try {
          const thread = await createThread();
          const threadID = thread.id;
          console.log("New thread created:", threadID);

          await sqlDb.query(
            `UPDATE contacts 
               SET thread_id = $1
               WHERE contact_id = $2 AND company_id = $3`,
            [threadID, contactID, companyId]
          );

          await handleOpenAIMyMessage(message, threadID);
        } catch (aiError) {
          console.error("Error creating AI thread:", aiError);
        }

        // 6. Handle bot tags for the receiver
        if (
          companyId === "020" ||
          companyId === "001" ||
          companyId === "0123" ||
          companyId === "0119"
        ) {
          console.log("Adding stop bot tag for company:", companyId);
          await sqlDb.query(
            `UPDATE contacts 
               SET tags = COALESCE(tags, '[]'::jsonb) || '"stop bot"'::jsonb
               WHERE contact_id = $1 AND company_id = $2`,
            [contactID, companyId]
          );
        }
      }

      // 7. Handle AI Responses for Own Messages
      // console.log("\n=== Processing AI Responses in Messaging API ===");
      // await fetchConfigFromDatabase(companyId);
      // const handlerParams = {
      //   client: client,
      //   msg: message,
      //   idSubstring: companyId,
      //   extractedNumber: phoneNumber,
      //   contactName:
      //     contactData?.contact_name || contactData?.name || phoneNumber,
      //   phoneIndex: phoneIndex,
      // };

      // // Process AI responses for 'own'
      // await processAIResponses({
      //   ...handlerParams,
      //   keywordSource: "own",
      //   handlers: {
      //     assign: true,
      //     tag: true,
      //     followUp: true,
      //     document: true,
      //     image: true,
      //     video: true,
      //     voice: true,
      //   },
      // });

      console.log("\n=== Message Processing Complete ===");
      res.json({
        success: true,
        messageId: sentMessage?.id?._serialized ?? 'no id',
        timestamp: sentMessage?.timestamp ?? 'no timestamp',
      });
    } catch (dbError) {
      console.error("\n=== Database Error ===");
      console.error("Error Type:", dbError.name);
      console.error("Error Message:", dbError.message);
      console.error("Stack:", dbError.stack);
      throw dbError;
    }
  } catch (error) {
    console.error("\n=== Request Error ===");
    console.error("Error Type:", error.name);
    console.error("Error Message:", error.message);
    console.error("Stack:", error.stack);
    res.status(500).json({
      error: "Internal Server Error",
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

async function findAndUpdateMessageAuthor(messageContent, contactId, companyId, userName) {
  console.log("Finding and updating message author based on content");
  
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Search for the latest message with matching content for this contact
      const findMessageQuery = `
        SELECT id, message_id, content, author, timestamp 
        FROM public.messages 
        WHERE contact_id = $1 AND company_id = $2 AND content = $3 AND from_me = true
        ORDER BY timestamp DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `;
      
      const messageResult = await client.query(findMessageQuery, [contactId, companyId, messageContent]);

      if (messageResult.rows.length === 0) {
        console.log("No matching message found with content:", messageContent.substring(0, 50) + "...");
        await safeRollback(client);
        return null;
      }

      const foundMessage = messageResult.rows[0];
      console.log(`Found message ID: ${foundMessage.id} with timestamp: ${foundMessage.timestamp}`);

      // Update the author if it's different or null
      if (!foundMessage.author || foundMessage.author !== userName) {
        const updateQuery = `
          UPDATE public.messages
          SET author = $1
          WHERE id = $2
          RETURNING id, author
        `;
        const updateResult = await client.query(updateQuery, [userName, foundMessage.id]);
        
        console.log(`Successfully updated author for message ID: ${updateResult.rows[0].id} to: ${updateResult.rows[0].author}`);
        
        await client.query("COMMIT");
        return updateResult.rows[0].id;
      } else {
        console.log("Author already set to the same value, no update needed");
        await client.query("COMMIT");
        return foundMessage.id;
      }
    } catch (error) {
      await safeRollback(client);
      console.error("Error finding/updating message author in PostgreSQL:", error);
      throw error;
    } finally {
      await safeRelease(client);
    }
  } catch (error) {
    console.error("PostgreSQL connection error:", error);
    throw error;
  }
}

// React to message
app.post("/api/messages/react/:companyId/:messageId", async (req, res) => {
  const { companyId, messageId } = req.params;
  const { reaction, phoneIndex = 0 } = req.body;

  try {
    // Validate the reaction
    if (reaction === undefined) {
      return res.status(400).json({ error: "Reaction emoji is required" });
    }

    // Get the bot client
    const botData = botMap.get(companyId);
    if (!botData || !botData[phoneIndex] || !botData[phoneIndex].client) {
      return res.status(404).json({ error: "WhatsApp client not found" });
    }

    const client = botData[phoneIndex].client;

    // Get the message by ID
    const message = await client.getMessageById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Send the reaction
    await message.react(reaction);

    // Update reaction in PostgreSQL
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");

      // First update the message record
      const messageUpdateQuery = `
        UPDATE public.messages 
        SET 
          reaction = $1,
          reaction_timestamp = $2
        WHERE 
          message_id = $3 AND 
          company_id = $4
        RETURNING id, contact_id
      `;

      const messageUpdateValues = [
        reaction || null,
        new Date(),
        messageId,
        companyId
      ];

      const messageResult = await dbClient.query(messageUpdateQuery, messageUpdateValues);

      if (messageResult.rowCount === 0) {
        await dbClient.query("ROLLBACK");
        console.warn(`Message ${messageId} found in WhatsApp but not in PostgreSQL`);
        return res.json({
          success: true,
          message: reaction ? "Reaction added to WhatsApp only" : "Reaction removed from WhatsApp only",
          messageId,
          reaction,
        });
      }

      await dbClient.query("COMMIT");

      res.json({
        success: true,
        message: reaction ? "Reaction added successfully" : "Reaction removed successfully",
        messageId,
        reaction,
      });
    } catch (error) {
      await dbClient.query("ROLLBACK");
      console.error("Error updating reaction in PostgreSQL:", error);
      res.status(500).json({
        error: "Reaction sent but failed to update database",
        details: error.message,
      });
    } finally {
      dbClient.release();
    }
  } catch (error) {
    console.error("Error reacting to message:", error);
    res.status(500).json({
      error: "Failed to react to message",
      details: error.message,
    });
  }
});

// Edit message route
app.put("/api/v2/messages/:companyId/:chatId/:messageId", async (req, res) => {
  console.log("Edit message");
  const { companyId, chatId, messageId } = req.params;
  const { newMessage } = req.body;

  try {
    // Get the client for this company from botMap
    const botData = botMap.get(companyId);
    if (!botData || !botData[0] || !botData[0].client) {
      return res.status(404).send("WhatsApp client not found for this company");
    }
    const client = botData[0].client;

    // Get the chat
    const chat = await client.getChatById(chatId);

    // Fetch the message
    const messages = await chat.fetchMessages({ limit: 1, id: messageId });
    if (messages.length === 0) {
      return res.status(404).send("Message not found");
    }
    const message = messages[0];

    // Edit the message
    const editedMessage = await message.edit(newMessage);

    if (editedMessage) {
      // Update the message in PostgreSQL
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const updateQuery = `
          UPDATE public.messages 
          SET 
            content = $1,
            edited = true,
            edited_at = $2
          WHERE 
            message_id = $3 AND 
            company_id = $4 AND
            chat_id = $5
          RETURNING id
        `;

        const updateValues = [
          newMessage,
          new Date(),
          messageId,
          companyId,
          chatId
        ];

        const result = await client.query(updateQuery, updateValues);

        if (result.rowCount === 0) {
          await safeRollback(client);
          return res.status(404).json({ success: false, error: "Message not found in database" });
        }

        await client.query("COMMIT");
        res.json({ success: true, messageId: messageId });
      } catch (error) {
        await safeRollback(client);
        console.error("Error updating message in PostgreSQL:", error);
        res.status(500).send("Internal Server Error");
      } finally {
        await safeRelease(client);
      }
    } else {
      res.status(400).json({ success: false, error: "Failed to edit message" });
    }
  } catch (error) {
    console.error("Error editing message:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Delete message route
app.delete(
  "/api/v2/messages/:companyId/:chatId/:messageId",
  async (req, res) => {
    console.log("Delete message");
    const { companyId, chatId, messageId } = req.params;
    const { deleteForEveryone, phoneIndex: requestedPhoneIndex } = req.body;

    const phoneIndex = requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;

    try {
      // Get the client for this company from botMap
      const botData = botMap.get(companyId);
      if (!botData || !botData[phoneIndex] || !botData[phoneIndex].client) {
        return res.status(404).send("WhatsApp client not found for this company");
      }
      const client = botData[phoneIndex].client;

      // Get the chat
      const chat = await client.getChatById(chatId);

      // Fetch the message
      const messages = await chat.fetchMessages({ limit: 1, id: messageId });
      if (messages.length === 0) {
        return res.status(404).send("Message not found");
      }
      const message = messages[0];

      // Delete the message
      await message.delete(true);

      // Delete the message from PostgreSQL
      const dbClient = await pool.connect();
      try {
        await dbClient.query("BEGIN");

        const deleteQuery = `
          DELETE FROM public.messages 
          WHERE 
            message_id = $1 AND 
            company_id = $2 AND
            chat_id = $3
          RETURNING id
        `;

        const deleteValues = [messageId, companyId, chatId];

        const result = await dbClient.query(deleteQuery, deleteValues);

        if (result.rowCount === 0) {
          await dbClient.query("ROLLBACK");
          return res.status(404).json({ success: false, error: "Message not found in database" });
        }

        await dbClient.query("COMMIT");
        res.json({ success: true, messageId: messageId });
      } catch (error) {
        await dbClient.query("ROLLBACK");
        console.error("Error deleting message from PostgreSQL:", error);
        res.status(500).send("Internal Server Error");
      } finally {
        dbClient.release();
      }
    } catch (error) {
      console.error("Error deleting message:", error);
      res.status(500).send("Internal Server Error");
    }
  }
);

app.post("/api/v2/messages/image/:companyId/:chatId", async (req, res) => {
  const companyId = req.params.companyId;
  const chatId = req.params.chatId;
  const {
    imageUrl,
    caption,
    phoneIndex: requestedPhoneIndex,
    userName: requestedUserName,
  } = req.body;
  const phoneIndex =
    requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;
  const userName = requestedUserName !== undefined ? requestedUserName : "";

  try {
    let client;
    // 1. Get the client for this company from botMap
    const botData = botMap.get(companyId);
    if (!botData) {
      return res.status(404).send("WhatsApp client not found for this company");
    }
    client = botData[phoneIndex].client;

    if (!client) {
      return res
        .status(404)
        .send("No active WhatsApp client found for this company");
    }
    // 2. Use wwebjs to send the image message
    const media = await MessageMedia.fromUrl(imageUrl);
    const sentMessage = await client.sendMessage(chatId, media, { caption });
    let phoneNumber = "+" + chatId.split("@")[0];

    // 3. Save the message to Firebase
    const contactData = await getContactDataFromDatabaseByPhone(
      phoneNumber,
      companyId
    );

    await addMessageToPostgres(
      sentMessage,
      companyId,
      phoneNumber,
      contactData.contact_name || contactData.name || "",
      phoneIndex,
      userName
    );

    const contactID = companyId + "-" + chatId.split("@")[0];
    if (caption) {
      await findAndUpdateMessageAuthor(caption, contactID, companyId, userName);
    }

    res.json({ success: true, messageId: sentMessage.id._serialized });
  } catch (error) {
    console.error("Error sending image message:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/api/v2/messages/audio/:companyId/:chatId", async (req, res) => {
  const companyId = req.params.companyId;
  const chatId = req.params.chatId;
  const {
    audioUrl,
    caption,
    phoneIndex: requestedPhoneIndex,
    userName: requestedUserName,
  } = req.body;

  const phoneIndex =
    requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;
  const userName = requestedUserName !== undefined ? requestedUserName : "";

  try {
    // 1. Get the client for this company from botMap
    const botData = botMap.get(companyId);
    if (!botData) {
      return res.status(404).send("WhatsApp client not found for this company");
    }
    const client = botData[phoneIndex]?.client;
    if (!client) {
      return res
        .status(404)
        .send("No active WhatsApp client found for this company");
    }
    if (!audioUrl) {
      return res.status(400).send("No audio URL provided");
    }

    // 2. Download the audio file (assume it's already in a WhatsApp-compatible format, e.g. mp3, ogg, m4a)
    const response = await axios.get(audioUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);

    // 3. Create MessageMedia object (try to detect mimetype from url or fallback to audio/mpeg)
    let mimetype = "audio/mpeg";
    if (audioUrl.endsWith(".ogg")) mimetype = "audio/ogg";
    else if (audioUrl.endsWith(".mp3")) mimetype = "audio/mpeg";
    else if (audioUrl.endsWith(".m4a")) mimetype = "audio/mp4";
    else if (audioUrl.endsWith(".wav")) mimetype = "audio/wav";
    else if (audioUrl.endsWith(".aac")) mimetype = "audio/aac";

    const filename = `audio_${Date.now()}.${mimetype.split("/")[1]}`;
    const media = new MessageMedia(
      mimetype,
      buffer.toString("base64"),
      filename
    );

    // 4. Send the audio as a voice message, with caption if provided
    const options = { sendAudioAsVoice: true };
    if (caption) options.caption = caption;

    const sentMessage = await client.sendMessage(chatId, media, options);

    let phoneNumber = "+" + chatId.split("@")[0];

    // 5. Save the message to database
    const contactData = await getContactDataFromDatabaseByPhone(
      phoneNumber,
      companyId
    );

    await addMessageToPostgres(
      sentMessage,
      companyId,
      phoneNumber,
      contactData?.contact_name || contactData?.name || "",
      phoneIndex,
      userName
    );

    const contactID = companyId + "-" + chatId.split("@")[0];
    if (caption) {
      await findAndUpdateMessageAuthor(caption, contactID, companyId, userName);
    }

    res.json({ success: true, messageId: sentMessage.id._serialized });
  } catch (error) {
    console.error("Error sending audio message:", error);
    res.status(500).send(`Internal Server Error: ${error.message}`);
  }
});

app.post("/api/request-pairing-code/:botName", async (req, res) => {
  const { botName } = req.params;
  const { phoneNumber, phoneIndex = 0 } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  // Remove any non-digit characters from the phone number
  const cleanedPhoneNumber = phoneNumber.replace(/\D/g, "");

  // Check if the cleaned phone number starts with a '+' and remove it
  const formattedPhoneNumber = cleanedPhoneNumber.startsWith("+")
    ? cleanedPhoneNumber.slice(1)
    : cleanedPhoneNumber;

  try {
    const botData = botMap.get(botName);
    if (!botData || !Array.isArray(botData) || !botData[phoneIndex]) {
      return res.status(404).json({ error: "Bot or phone not found" });
    }

    const { client } = botData[phoneIndex];
    if (!client) {
      return res.status(404).json({ error: "WhatsApp client not initialized" });
    }

    // Request the pairing code with the formatted phone number
    const pairingCode = await client.requestPairingCode(formattedPhoneNumber);

    // Update the bot status
    botData[phoneIndex] = {
      ...botData[phoneIndex],
      status: "pairing_code",
      pairingCode,
    };
    botMap.set(botName, botData);

    // Broadcast the new status
    broadcastAuthStatus(botName, "pairing_code", pairingCode, phoneIndex);

    // Send the pairing code back to the client
    res.json({ pairingCode });
  } catch (error) {
    console.error(`Error requesting pairing code for ${botName}:`, error);
    res.status(500).json({
      error: "Failed to request pairing code",
      details: error.message,
    });
  }
});

app.post("/api/messages/image/:token", async (req, res) => {
  const { chatId, imageUrl, caption } = req.body;
  const token = req.params.token;
  try {
    const response = await fetch(`https://gate.whapi.cloud/messages/image`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: chatId, media: imageUrl, caption }),
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error sending image message:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/api/messages/document/:token", async (req, res) => {
  const { chatId, imageUrl, caption, mimeType, fileName } = req.body;
  const token = req.params.token;
  try {
    const response = await fetch(`https://gate.whapi.cloud/messages/document`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: chatId,
        media: imageUrl,
        caption,
        filename: fileName,
        mimeType: mimeType,
      }),
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error sending image message:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/api/fetch-users", async (req, res) => {
  const { accessToken, locationId } = req.body;
  const maxRetries = 5;
  const baseDelay = 5000;

  const fetchData = async (url, retries = 0) => {
    const options = {
      method: "GET",
      url: url,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-07-28",
        Accept: "application/json",
      },
      params: {
        locationId: locationId,
      },
    };
    try {
      const response = await axios.request(options);
      return response;
    } catch (error) {
      if (
        error.response &&
        error.response.status === 429 &&
        retries < maxRetries
      ) {
        const delay = baseDelay * Math.pow(2, retries);
        console.warn(`Rate limit hit, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return fetchData(url, retries + 1);
      } else {
        console.error("Error during fetchData:", error);
        throw error;
      }
    }
  };

  try {
    const url = `https://services.leadconnectorhq.com/users/`;
    const response = await fetchData(url);
    res.json(response.data.users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).send("Error fetching users");
  }
});

app.delete("/api/contacts/:companyId/:contactId/tags", async (req, res) => {
  const { companyId, contactId } = req.params;
  let { tags } = req.body; // tags: array of tags to remove
  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: "tags must be an array" });
  }

  // Normalize stop bot tags
  tags = tags.map(tag =>
    typeof tag === "string" && tag.trim().toLowerCase().replace(/\s+/g, "") === "stopbot"
      ? "stop bot"
      : tag
  );

  try {
    let phoneNumber;
    if (contactId.startsWith(`${companyId}-`)) {
      const contactIdParts = contactId.split("-");
      phoneNumber = '+' + contactIdParts[1];
    } else {
      phoneNumber = contactId;
    }

    const response = { tags: tags };
    const followupTemplate = await getFollowUpTemplates(companyId);
    await handleTagDeletion(response, phoneNumber, companyId, followupTemplate);

    res.json({ success: true, tags: tags }); // Return the tags that were removed
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to remove tags", details: error.message });
  }
});

app.post("/api/contacts/:companyId/:contactId/tags", async (req, res) => {
  const { companyId, contactId } = req.params;
  let { tags } = req.body; // tags: array of tags to add
  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: "tags must be an array" });
  }

  // Normalize stop bot tags
  tags = tags.map(tag =>
    typeof tag === "string" && tag.trim().toLowerCase().replace(/\s+/g, "") === "stopbot"
      ? "stop bot"
      : tag
  );

  try {
    let phoneNumber;
    if (contactId.startsWith(`${companyId}-`)) {
      const contactIdParts = contactId.split("-");
      phoneNumber = '+' + contactIdParts[1];
    } else {
      phoneNumber = contactId;
    }

    const response = {tags: tags};
    const followupTemplate = await getFollowUpTemplates(companyId);
    await handleTagAddition(response, phoneNumber, companyId, followupTemplate, null, 0);
    res.json({ success: true, tags: tags });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to add tags", details: error.message });
  }
});

// Assign employee to contact
app.post("/api/contacts/:companyId/:contactId/assign-employee", async (req, res) => {
  const { companyId, contactId } = req.params;
  const { employeeName } = req.body;
  
  if (!employeeName) {
    return res.status(400).json({ error: "employeeName is required" });
  }
  
  try {
    let phoneNumber;
    if (contactId.startsWith(`${companyId}-`)) {
      const contactIdParts = contactId.split("-");
      phoneNumber = '+' + contactIdParts[1];
    } else {
      phoneNumber = contactId;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Update the contact to assign the employee
      const updateContactQuery = `
        UPDATE contacts 
        SET tags = CASE 
          WHEN tags::jsonb ? $3 THEN tags::jsonb
          ELSE COALESCE(tags::jsonb, '[]'::jsonb) || $4::jsonb
        END
        WHERE phone = $1 AND company_id = $2
        RETURNING *
      `;
      
      const employeeNameArray = JSON.stringify([employeeName]);
      const updateResult = await client.query(updateContactQuery, [
        phoneNumber,
        companyId,
        employeeName,
        employeeNameArray
      ]);

      if (updateResult.rows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: "Contact not found" });
      }

      // 2. Update employee's assigned_contacts count
      const employeeUpdateQuery = `
        UPDATE employees
        SET assigned_contacts = assigned_contacts + 1
        WHERE company_id = $1 AND name = $2
        RETURNING id, employee_id, name, assigned_contacts
      `;
      
      const employeeResult = await client.query(employeeUpdateQuery, [
        companyId,
        employeeName
      ]);

      if (employeeResult.rows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: "Employee not found" });
      }

      // 3. Get contact details for assignments table
      const contactQuery = `
        SELECT contact_id FROM contacts 
        WHERE phone = $1 AND company_id = $2
      `;
      const contactResult = await client.query(contactQuery, [phoneNumber, companyId]);
      
      if (contactResult.rows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: "Contact not found in database" });
      }

      // 4. Insert into assignments table
      const currentDate = new Date();
      const currentMonthKey = `${currentDate.getFullYear()}-${(
        currentDate.getMonth() + 1
      ).toString().padStart(2, "0")}`;

      const assignmentId = `${companyId}-${contactResult.rows[0].contact_id}-${employeeResult.rows[0].employee_id}-${Date.now()}`;
      
      const assignmentInsertQuery = `
        INSERT INTO assignments (
          assignment_id, company_id, employee_id, contact_id, 
          assigned_at, status, month_key, assignment_type, 
          phone_index, weightage_used
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'active', $5, 'manual', 0, 1)
      `;
      
      await client.query(assignmentInsertQuery, [
        assignmentId,
        companyId,
        employeeResult.rows[0].employee_id,
        contactResult.rows[0].contact_id,
        currentMonthKey
      ]);

      // 5. Update monthly assignments
      const monthlyAssignmentUpsertQuery = `
        INSERT INTO employee_monthly_assignments (employee_id, company_id, month_key, assignments_count, last_updated)
        VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (employee_id, month_key) DO UPDATE
        SET assignments_count = employee_monthly_assignments.assignments_count + 1,
            last_updated = CURRENT_TIMESTAMP
      `;
      
      await client.query(monthlyAssignmentUpsertQuery, [
        employeeResult.rows[0].id,
        companyId,
        currentMonthKey
      ]);

      await client.query("COMMIT");

      res.json({ 
        success: true, 
        message: "Employee assigned successfully",
        contact: updateResult.rows[0],
        employee: employeeResult.rows[0]
      });

    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      await safeRelease(client);
    }

  } catch (error) {
    console.error("Error assigning employee to contact:", error);
    res.status(500).json({ 
      error: "Failed to assign employee", 
      details: error.message 
    });
  }
});

// Unassign employee from contact
app.post("/api/contacts/:companyId/:contactId/unassign-employee", async (req, res) => {
  const { companyId, contactId } = req.params;
  const { employeeName } = req.body;
  
  if (!employeeName) {
    return res.status(400).json({ error: "employeeName is required" });
  }
  
  try {
    let phoneNumber;
    if (contactId.startsWith(`${companyId}-`)) {
      const contactIdParts = contactId.split("-");
      phoneNumber = '+' + contactIdParts[1];
    } else {
      phoneNumber = contactId;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Get current contact tags and remove the employee name
      const getContactQuery = `
        SELECT tags, contact_id FROM contacts 
        WHERE phone = $1 AND company_id = $2
      `;
      const contactResult = await client.query(getContactQuery, [phoneNumber, companyId]);
      
      if (contactResult.rows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: "Contact not found" });
      }

      const currentTags = contactResult.rows[0].tags || [];
      const updatedTags = currentTags.filter(tag => tag !== employeeName);
      
      // Update the contact to remove the employee tag
      const updateContactQuery = `
        UPDATE contacts 
        SET tags = $3
        WHERE phone = $1 AND company_id = $2
        RETURNING *
      `;
      
      const updateResult = await client.query(updateContactQuery, [
        phoneNumber,
        companyId,
        JSON.stringify(updatedTags)
      ]);

      // 2. Get employee details and decrease assigned_contacts count
      const employeeUpdateQuery = `
        UPDATE employees
        SET assigned_contacts = GREATEST(assigned_contacts - 1, 0)
        WHERE company_id = $1 AND name = $2
        RETURNING id, employee_id, name, assigned_contacts
      `;
      
      const employeeResult = await client.query(employeeUpdateQuery, [
        companyId,
        employeeName
      ]);

      if (employeeResult.rows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: "Employee not found" });
      }

      // 3. Update assignment record status to 'inactive'
      const updateAssignmentQuery = `
        UPDATE assignments 
        SET status = 'inactive', 
            updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $1 
          AND employee_id = $2 
          AND contact_id = $3 
          AND status = 'active'
      `;
      
      await client.query(updateAssignmentQuery, [
        companyId,
        employeeResult.rows[0].employee_id,
        contactResult.rows[0].contact_id
      ]);

      // 4. Update monthly assignments (decrease count)
      const currentDate = new Date();
      const currentMonthKey = `${currentDate.getFullYear()}-${(
        currentDate.getMonth() + 1
      ).toString().padStart(2, "0")}`;

      const monthlyAssignmentUpdateQuery = `
        UPDATE employee_monthly_assignments 
        SET assignments_count = GREATEST(assignments_count - 1, 0),
            last_updated = CURRENT_TIMESTAMP
        WHERE employee_id = $1 
          AND company_id = $2 
          AND month_key = $3
      `;
      
      await client.query(monthlyAssignmentUpdateQuery, [
        employeeResult.rows[0].id,
        companyId,
        currentMonthKey
      ]);

      await client.query("COMMIT");

      res.json({ 
        success: true, 
        message: "Employee unassigned successfully",
        contact: updateResult.rows[0],
        employee: employeeResult.rows[0],
        removedTags: [employeeName]
      });

    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      await safeRelease(client);
    }

  } catch (error) {
    console.error("Error unassigning employee from contact:", error);
    res.status(500).json({ 
      error: "Failed to unassign employee", 
      details: error.message 
    });
  }
});

// Bulk unassign all employees from contact
app.delete("/api/contacts/:companyId/:contactId/assignments", async (req, res) => {
  const { companyId, contactId } = req.params;
  
  try {
    let phoneNumber;
    if (contactId.startsWith(`${companyId}-`)) {
      const contactIdParts = contactId.split("-");
      phoneNumber = '+' + contactIdParts[1];
    } else {
      phoneNumber = contactId;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Get current contact and all assigned employees
      const getContactQuery = `
        SELECT tags, contact_id FROM contacts 
        WHERE phone = $1 AND company_id = $2
      `;
      const contactResult = await client.query(getContactQuery, [phoneNumber, companyId]);
      
      if (contactResult.rows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: "Contact not found" });
      }

      // 2. Get all active assignments for this contact
      const getAssignmentsQuery = `
        SELECT DISTINCT a.employee_id, e.name, e.id as employee_uuid
        FROM assignments a
        JOIN employees e ON a.employee_id = e.employee_id
        WHERE a.company_id = $1 
          AND a.contact_id = $2 
          AND a.status = 'active'
      `;
      
      const assignmentsResult = await client.query(getAssignmentsQuery, [
        companyId,
        contactResult.rows[0].contact_id
      ]);

      if (assignmentsResult.rows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: "No active assignments found for this contact" });
      }

      const assignedEmployees = assignmentsResult.rows;
      const employeeNames = assignedEmployees.map(emp => emp.name);

      // 3. Remove all employee names from contact tags
      const currentTags = contactResult.rows[0].tags || [];
      const updatedTags = currentTags.filter(tag => !employeeNames.includes(tag));
      
      const updateContactQuery = `
        UPDATE contacts 
        SET tags = $3
        WHERE phone = $1 AND company_id = $2
        RETURNING *
      `;
      
      const updateResult = await client.query(updateContactQuery, [
        phoneNumber,
        companyId,
        JSON.stringify(updatedTags)
      ]);

      // 4. Update all employees' assigned_contacts count
      for (const employee of assignedEmployees) {
        const employeeUpdateQuery = `
          UPDATE employees
          SET assigned_contacts = GREATEST(assigned_contacts - 1, 0)
          WHERE company_id = $1 AND employee_id = $2
        `;
        
        await client.query(employeeUpdateQuery, [companyId, employee.employee_id]);
      }

      // 5. Update all assignment records to 'inactive'
      const updateAssignmentsQuery = `
        UPDATE assignments 
        SET status = 'inactive', 
            updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $1 
          AND contact_id = $2 
          AND status = 'active'
      `;
      
      await client.query(updateAssignmentsQuery, [
        companyId,
        contactResult.rows[0].contact_id
      ]);

      // 6. Update monthly assignments for all employees
      const currentDate = new Date();
      const currentMonthKey = `${currentDate.getFullYear()}-${(
        currentDate.getMonth() + 1
      ).toString().padStart(2, "0")}`;

      for (const employee of assignedEmployees) {
        const monthlyAssignmentUpdateQuery = `
          UPDATE employee_monthly_assignments 
          SET assignments_count = GREATEST(assignments_count - 1, 0),
              last_updated = CURRENT_TIMESTAMP
          WHERE employee_id = $1 
            AND company_id = $2 
            AND month_key = $3
        `;
        
        await client.query(monthlyAssignmentUpdateQuery, [
          employee.employee_uuid,
          companyId,
          currentMonthKey
        ]);
      }

      await client.query("COMMIT");

      res.json({ 
        success: true, 
        message: `Successfully unassigned ${assignedEmployees.length} employee(s)`,
        contact: updateResult.rows[0],
        unassignedEmployees: employeeNames,
        removedTags: employeeNames
      });

    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      await safeRelease(client);
    }

  } catch (error) {
    console.error("Error bulk unassigning employees from contact:", error);
    res.status(500).json({ 
      error: "Failed to unassign employees", 
      details: error.message 
    });
  }
});

// Get all assignments for a contact
app.get("/api/contacts/:companyId/:contactId/assignments", async (req, res) => {
  const { companyId, contactId } = req.params;
  
  try {
    let phoneNumber;
    if (contactId.startsWith(`${companyId}-`)) {
      const contactIdParts = contactId.split("-");
      phoneNumber = '+' + contactIdParts[1];
    } else {
      phoneNumber = contactId;
    }

    const client = await pool.connect();
    try {
      // 1. Get contact details
      const getContactQuery = `
        SELECT contact_id, tags FROM contacts 
        WHERE phone = $1 AND company_id = $2
      `;
      const contactResult = await client.query(getContactQuery, [phoneNumber, companyId]);
      
      if (contactResult.rows.length === 0) {
        return res.status(404).json({ error: "Contact not found" });
      }

      // 2. Get all assignments (both active and inactive) for this contact
      const getAssignmentsQuery = `
        SELECT 
          a.assignment_id,
          a.employee_id,
          a.assigned_at,
          a.status,
          a.assignment_type,
          a.phone_index,
          a.weightage_used,
          a.employee_role,
          a.month_key,
          e.name as employee_name,
          e.email as employee_email,
          e.role as employee_role_from_employees,
          e.phone_number as employee_phone
        FROM assignments a
        JOIN employees e ON a.employee_id = e.employee_id
        WHERE a.company_id = $1 AND a.contact_id = $2
        ORDER BY a.assigned_at DESC
      `;
      
      const assignmentsResult = await client.query(getAssignmentsQuery, [
        companyId,
        contactResult.rows[0].contact_id
      ]);

      // 3. Separate active and inactive assignments
      const activeAssignments = assignmentsResult.rows.filter(a => a.status === 'active');
      const inactiveAssignments = assignmentsResult.rows.filter(a => a.status === 'inactive');

      res.json({ 
        success: true,
        contact: {
          contact_id: contactResult.rows[0].contact_id,
          phone: phoneNumber,
          tags: contactResult.rows[0].tags
        },
        assignments: {
          active: activeAssignments,
          inactive: inactiveAssignments,
          total: assignmentsResult.rows.length
        },
        summary: {
          activeCount: activeAssignments.length,
          inactiveCount: inactiveAssignments.length,
          totalCount: assignmentsResult.rows.length
        }
      });

    } catch (error) {
      throw error;
    } finally {
      await safeRelease(client);
    }

  } catch (error) {
    console.error("Error getting contact assignments:", error);
    res.status(500).json({ 
      error: "Failed to get contact assignments", 
      details: error.message 
    });
  }
});

async function customWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

app.post("/api/v2/messages/video/:companyId/:chatId", async (req, res) => {
  const companyId = req.params.companyId;
  const chatId = req.params.chatId;
  const {
    videoUrl,
    caption,
    phoneIndex: requestedPhoneIndex,
    userName: requestedUserName,
  } = req.body;
  const phoneIndex =
    requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;
  const userName = requestedUserName !== undefined ? requestedUserName : "";

  try {
    let client;
    // 1. Get the client for this company from botMap
    const botData = botMap.get(companyId);
    if (!botData) {
      return res.status(404).send("WhatsApp client not found for this company");
    }
    client = botData[phoneIndex].client;

    if (!client) {
      return res
        .status(404)
        .send("No active WhatsApp client found for this company");
    }

    // 2. Use wwebjs to send the video message
    const media = await MessageMedia.fromUrl(videoUrl);
    const sentMessage = await client.sendMessage(chatId, media, { caption });
    let phoneNumber = "+" + chatId.split("@")[0];

    // 3. Save the message to Database
    const contactData = await getContactDataFromDatabaseByPhone(
      phoneNumber,
      companyId
    );

    await addMessageToPostgres(
      sentMessage,
      companyId,
      phoneNumber,
      contactData.contact_name || contactData.name || "",
      phoneIndex,
      userName
    );

    const contactID = companyId + "-" + chatId.split("@")[0];
    if (caption) {
      await findAndUpdateMessageAuthor(caption, contactID, companyId, userName);
    }

    res.json({ success: true, messageId: sentMessage.id._serialized });
  } catch (error) {
    console.error("Error sending video message:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.post('/api/v2/messages/document/:companyId/:chatId', async (req, res) => {
  const companyId = req.params.companyId;
  const chatId = req.params.chatId;
  const { documentUrl, filename, caption, phoneIndex: requestedPhoneIndex, userName: requestedUserName } = req.body;
  const phoneIndex = requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;
  const userName = requestedUserName !== undefined ? requestedUserName : '';

  console.log("\n=== New Document Message Request ===");
  console.log("Request details:", {
    companyId,
    chatId,
    documentUrl,
    filename,
    caption,
    requestedPhoneIndex,
    userName: requestedUserName,
    phoneIndex,
    userName,
  });

  try {
    let client;
    // 1. Get the client for this company from botMap
    const botData = botMap.get(companyId);
    if (!botData) {
      console.error('WhatsApp client not found for this company');
      return res.status(404).send('WhatsApp client not found for this company');
    }
    client = botData[phoneIndex].client;

    if (!client) {
      console.error('No active WhatsApp client found for this company');
      return res.status(404).send('No active WhatsApp client found for this company');
    }

    // 2. Use wwebjs to send the document message
    const media = await MessageMedia.fromUrl(documentUrl, { unsafeMime: true, filename: filename });
    const sentMessage = await client.sendMessage(chatId, media, { caption });
    console.log("Message sent successfully:", {
      messageId: sentMessage?.id?._serialized ?? 'no id',
      timestamp: sentMessage?.timestamp ?? 'no timestamp',
      type: sentMessage?.type ?? 'no type',
    });
    let phoneNumber = '+' + (chatId).split('@')[0];

    // 3. Save the message to Database
    const contactData = await getContactDataFromDatabaseByPhone(
      phoneNumber,
      companyId
    );

    await addMessageToPostgres(
      sentMessage,
      companyId,
      phoneNumber,
      contactData?.contact_name || contactData?.name || "",
      phoneIndex,
      userName
    );

    const contactID = companyId + "-" + chatId.split("@")[0];
    if (caption) {
      await findAndUpdateMessageAuthor(caption, contactID, companyId, userName);
    }

    res.json({ success: true, messageId: sentMessage.id._serialized });
  } catch (error) {
    console.error('Error sending document message:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post("/api/user/update-phone", async (req, res) => {
  try {
    const { email, phoneIndex } = req.body;
    console.log("updating phone index", email, phoneIndex);
    if (!email || phoneIndex === undefined) {
      return res.status(400).json({ 
        error: "Email and phoneIndex are required" 
      });
    }

    // Validate phoneIndex is a number
    const validatedPhoneIndex = parseInt(phoneIndex);
    if (isNaN(validatedPhoneIndex) || validatedPhoneIndex < 0) {
      return res.status(400).json({ 
        error: "phoneIndex must be a valid non-negative number" 
      });
    }

    console.log(`Updating phone index for user ${email} to ${validatedPhoneIndex}`);

    // Update the user's phone field in the users table
    const updateResult = await sqlDb.query(
      `UPDATE users 
       SET phone = $1, last_updated = CURRENT_TIMESTAMP
       WHERE email = $2
       RETURNING user_id, name, email, phone, company_id`,
      [validatedPhoneIndex, email]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ 
        error: "User not found" 
      });
    }

    console.log(`Successfully updated phone index for user ${email} to ${validatedPhoneIndex}`);

    res.json({
      success: true,
      message: "Phone index updated successfully",
      data: {
        email: updateResult.rows[0].email,
        name: updateResult.rows[0].name,
        phoneIndex: updateResult.rows[0].phone,
        userId: updateResult.rows[0].user_id,
        companyId: updateResult.rows[0].company_id
      }
    });

  } catch (error) {
    console.error("Error updating user phone index:", error);
    res.status(500).json({ 
      error: "Failed to update phone index",
      details: error.message 
    });
  }
});

app.put("/api/update-phone-name", async (req, res) => {
  try {
    const { companyId, phoneIndex, phoneName } = req.body;
    console.log("Updating phone name:", { companyId, phoneIndex, phoneName });

    if (!companyId || phoneIndex === undefined || phoneName === undefined) {
      return res.status(400).json({ error: "Company ID, phone index, and phone name are required" });
    }

    // Fetch current phone_numbers array
    const companyResult = await sqlDb.query(
      "SELECT phone_numbers FROM companies WHERE company_id = $1",
      [companyId]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: "Company not found" });
    }

    console.log("Raw phone_numbers from database:", companyResult.rows[0].phone_numbers);
    let phoneNumbers = [];
    if (companyResult.rows[0].phone_numbers) {
      try {
        // Accept both stringified array and array
        if (typeof companyResult.rows[0].phone_numbers === "string") {
          phoneNumbers = JSON.parse(companyResult.rows[0].phone_numbers);
        } else if (Array.isArray(companyResult.rows[0].phone_numbers)) {
          phoneNumbers = companyResult.rows[0].phone_numbers;
        }
      } catch (e) {
        phoneNumbers = [];
      }
    }

    console.log("Before update - Current array:", phoneNumbers);
    console.log("Target phoneIndex:", phoneIndex, "New phoneName:", phoneName);

    // Ensure the array is long enough, only extending if needed
    while (phoneNumbers.length <= phoneIndex) {
      phoneNumbers.push("");
    }
    phoneNumbers[phoneIndex] = phoneName;

    console.log("After update - New array:", phoneNumbers);

    // Update the phone_numbers array in the database
    await sqlDb.query(
      "UPDATE companies SET phone_numbers = $1 WHERE company_id = $2",
      [JSON.stringify(phoneNumbers), companyId]
    );
    console.log("Phone name updated successfully:", phoneNumbers);

    res.json({ success: true, message: "Phone name updated successfully", phoneNumbers });

  } catch (error) {
    console.error("Error updating phone name:", error);
    res.status(500).json({ success: false, error: "Failed to update phone name" });
  }
});

// Add this right after your existing endpoint (around line 12640)
app.get("/api/debug-routes", (req, res) => {
  res.json({ 
    message: "Debug endpoint working",
    timestamp: new Date().toISOString(),
    testEndpoint: "/api/user/update-phone should be available"
  });
});



async function copyDirectory(source, target, options = {}) {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    skipLockedFiles = true,
    skipPatterns = [".db-journal", ".db-wal", ".db-shm", "lockfile"],
  } = options;

  // Validate paths
  if (!source || !target) {
    throw new Error("Source and target paths must be specified");
  }

  // Normalize paths
  source = path.resolve(source);
  target = path.resolve(target);

  // Check if source exists
  try {
    await fs.promises.access(source);
  } catch (err) {
    console.error(`Access error for source directory ${source}:`, err);
    throw new Error(`Source directory does not exist or is not accessible: ${source}`);
  }

  // Remove existing target if it exists
  try {
    if (await pathExists(target)) {
      await fs.promises.rm(target, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`Error removing target directory ${target}:`, err);
    throw err;
  }

  // Create target directory
  try {
    await fs.promises.mkdir(target, { recursive: true });
  } catch (err) {
    console.error(`Error creating target directory ${target}:`, err);
    throw err;
  }

  // Copy contents
  try {
    const files = await fs.promises.readdir(source);

    await Promise.all(
      files.map(async (file) => {
        const sourcePath = path.join(source, file);
        const targetPath = path.join(target, file);

        // Skip files matching skip patterns
        if (skipPatterns.some((pattern) => file.endsWith(pattern))) {
          if (skipLockedFiles) {
            console.log(`Skipping locked file: ${file}`);
            return;
          }
        }

        try {
          const stat = await fs.promises.stat(sourcePath);

          if (stat.isDirectory()) {
            await retryOperation(
              () => copyDirectory(sourcePath, targetPath, options),
              maxRetries,
              retryDelay,
              `Copy directory ${sourcePath} -> ${targetPath}`
            );
          } else {
            await retryOperation(
              () => copyFileWithStreams(sourcePath, targetPath),
              maxRetries,
              retryDelay,
              `Copy file ${sourcePath} -> ${targetPath}`
            );
          }
        } catch (error) {
          console.error(`Error processing ${sourcePath}:`, error);
          if (!skipLockedFiles) throw error;
        }
      })
    );
  } catch (err) {
    console.error(`Error reading source directory ${source}:`, err);
    throw err;
  }
}

// Helper function to copy files using streams with proper error handling
async function copyFileWithStreams(sourcePath, targetPath) {
  try {
    await pipeline(
      fs.createReadStream(sourcePath),
      fs.createWriteStream(targetPath)
    );
  } catch (error) {
    // Clean up partially copied file if error occurs
    try {
      await fs.unlink(targetPath).catch(() => {});
    } catch (cleanupError) {
      console.warn(
        `Could not clean up failed copy ${targetPath}:`,
        cleanupError
      );
    }
    throw error;
  }
}

// Helper function to retry operations
async function retryOperation(
  operation,
  maxRetries,
  delayMs,
  operationName = "operation"
) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        console.warn(
          `Attempt ${attempt}/${maxRetries} failed for ${operationName}, retrying...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  console.error(`All ${maxRetries} attempts failed for ${operationName}`);
  throw lastError;
}

// Helper function to check if path exists
async function pathExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function initializeBot(botName, phoneCount = 1, specificPhoneIndex) {
  try {
    console.log(
      `Starting initialization for bot: ${botName} with ${phoneCount} phone(s)${
        specificPhoneIndex !== undefined
          ? `, phone ${specificPhoneIndex + 1}`
          : ""
      }`
    );

    let clients =
      botMap.get(botName) ||
      Array(phoneCount)
        .fill(null)
        .map(() => ({
          client: null,
          status: null,
          qrCode: null,
          initializationStartTime: null,
        }));

    const indicesToInitialize =
      specificPhoneIndex !== undefined
        ? [specificPhoneIndex]
        : Array.from({ length: phoneCount }, (_, i) => i);

    // Initialize all phones in parallel
    const initializationPromises = indicesToInitialize.map(async (i) => {
      try {
        let clientName = `${botName}_phone${i + 1}`;

        // Small stagger between starts to prevent resource contention
        await new Promise((resolve) => setTimeout(resolve, i * 2500));

        return initializeWithTimeout(botName, i, clientName, clients);
      } catch (phoneError) {
        console.error(
          `Error initializing bot ${botName} Phone ${i + 1}:`,
          phoneError
        );
        clients[i] = {
          client: null,
          status: "error",
          qrCode: null,
          error: phoneError.message,
          initializationStartTime: null,
        };
        botMap.set(botName, clients);
        broadcastStatus(botName, "error", i);
      }
    });

    // Wait for all initializations to complete
    await Promise.allSettled(initializationPromises);

    console.log(
      `Bot ${botName} initialization attempts completed for all phones`
    );
  } catch (error) {
    console.error(`Error in initializeBot for ${botName}:`, error);
    handleInitializationError(botName, phoneCount, specificPhoneIndex, error);
  }
}

// Add new function to manage phone status
// Around line 15955, replace the second updatePhoneStatus function:
// Around line 15955, replace the second updatePhoneStatus function:
async function updatePhoneStatus(
  companyId,
  phoneIndex,
  status,
  metadata = {}
) {
  try {
    // First check if the company exists
    const companyResult = await sqlDb.query(
      "SELECT company_id FROM companies WHERE company_id = $1",
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      console.log(`Company ${companyId} not found, skipping phone status update`);
      return;
    }

    // Get phone number if status is 'ready'
    let phoneNumber = null;
    if (status === 'ready') {
      const botData = botMap.get(companyId);
      if (botData && botData[phoneIndex] && botData[phoneIndex].client?.info?.wid?.user) {
        phoneNumber = botData[phoneIndex].client.info.wid.user;
      }
    }

    // If no phone number is available, use a placeholder or skip
    if (!phoneNumber) {
      phoneNumber = `phone_${phoneIndex}`; // Use a placeholder
    }

    // Check if a record already exists for this company and phone_index
    const existingResult = await sqlDb.query(
      "SELECT id FROM phone_status WHERE company_id = $1 AND phone_index = $2",
      [companyId, phoneIndex.toString()]
    );

    if (existingResult.rows.length > 0) {
      // Update existing record
      await sqlDb.query(
        `
        UPDATE phone_status 
        SET phone_number = $1, status = $2, last_seen = CURRENT_TIMESTAMP, 
            metadata = $3, updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $4 AND phone_index = $5
        `,
        [
          phoneNumber,
          status,
          Object.keys(metadata).length ? JSON.stringify(metadata) : null,
          companyId,
          phoneIndex.toString()
        ]
      );
    } else {
      // Insert new record
      await sqlDb.query(
        `
        INSERT INTO phone_status (company_id, phone_index, phone_number, status, last_seen, metadata, updated_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, CURRENT_TIMESTAMP)
        `,
        [
          companyId,
          phoneIndex.toString(),
          phoneNumber,
          status,
          Object.keys(metadata).length ? JSON.stringify(metadata) : null,
        ]
      );
    }
    
    console.log(`Phone status updated for company ${companyId}, phone ${phoneNumber}: ${status}`);
  } catch (error) {
    console.error(`Error updating phone status in SQL for ${companyId} Phone ${phoneIndex}:`, error);
    // Don't throw the error - just log it to prevent cascading failures
  }
}
const monitoringIntervals = new Map();

function startPhoneMonitoring(botName, phoneIndex) {
  if (monitoringIntervals.has(`${botName}_${phoneIndex}`)) {
    clearInterval(monitoringIntervals.get(`${botName}_${phoneIndex}`));
  }
  console.log(
    `Starting phone monitoring for ${botName} Phone ${phoneIndex + 1}`
  );
  const intervalId = setInterval(async () => {
    try {
      const result = await sqlDb.query(
        `
        SELECT status 
        FROM phone_status 
        WHERE company_id = $1 AND phone_number = $2
        `,
        [botName, `phone${phoneIndex}`]
      );

      if (result.rows.length > 0 && result.rows[0].status === "initializing") {
        console.log(
          `${botName} Phone ${
            phoneIndex + 1
          } - Still initializing, running cleanup...`
        );

        const { spawn } = require("child_process");
const mime = require('mime-types');
        // Your existing cleanup code here
      }
    } catch (error) {
      console.error(
        `Error checking initialization status for ${botName} Phone ${
          phoneIndex + 1
        }:`,
        error
      );
    }
  }, 30000);

  // Store the interval ID
  monitoringIntervals.set(`${botName}_${phoneIndex}`, intervalId);
}

async function initializeWithTimeout(botName, phoneIndex, clientName, clients) {
  return new Promise(async (resolve, reject) => {
    let isResolved = false;
    const sessionDir = path.join(
      __dirname,
      ".wwebjs_auth",
      `session-${clientName}`
    );
    const backupDir = path.join(
      __dirname,
      ".wwebjs_auth_backup",
      `session-${clientName}`
    );

    // Backup logic for 'ready' status
    try {
      const result = await sqlDb.query(
        `SELECT status FROM phone_status 
         WHERE company_id = $1 AND phone_number = $2`,
        [botName, phoneIndex]
      );

      if (
        result.rows.length > 0 &&
        result.rows[0].status === "ready" &&
        fs.existsSync(sessionDir)
      ) {
        console.log(
          `${botName} Phone ${
            phoneIndex + 1
          } - Previous status was ready, creating backup...`
        );
        try {
          await fs.promises.mkdir(path.dirname(backupDir), { recursive: true });
          await copyDirectory(sessionDir, backupDir);
          console.log(
            `${botName} Phone ${phoneIndex + 1} - Backup created successfully`
          );
        } catch (backupError) {
          console.error(
            `${botName} Phone ${phoneIndex + 1} - Error creating backup:`,
            backupError
          );
        }
      }
    } catch (error) {
      console.error(
        `${botName} Phone ${phoneIndex + 1} - Error checking previous status:`,
        error
      );
    }

    // Enhanced error handlers for process-level events
    const errorHandlers = {
      unhandledRejection: async (reason) => {
        if (
          typeof reason === "string" &&
          (reason.includes("Protocol Error:") ||
            reason.includes("Target closed."))
        ) {
          await safeCleanup(botName, phoneIndex);
          await sendAlertToEmployees(botName);
        }
      },
      uncaughtException: async (error) => {
        if (
          error.message.includes("Protocol Error:") ||
          error.message.includes("Target closed.")
        ) {
          await safeCleanup(botName, phoneIndex);
          await sendAlertToEmployees(botName);
        }
      },
    };

    process.on("unhandledRejection", errorHandlers.unhandledRejection);
    process.on("uncaughtException", errorHandlers.uncaughtException);

    try {
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: clientName,
          dataPath: path.join(__dirname, ".wwebjs_auth"),
        }),
        authTimeoutMs: 20000,
        takeoverOnConflict: true,
        restartOnAuthFail: true,
        puppeteer: {
          headless: true,
          executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
          ignoreHTTPSErrors: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-extensions",
            "--disable-gpu",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-dev-shm-usage",
            "--unhandled-rejections=strict",
            "--disable-gpu-driver-bug-workarounds",
            "--log-level=3",
            "--no-default-browser-check",
            "--disable-site-isolation-trials",
            "--no-experiments",
            "--ignore-gpu-blacklist",
            "--ignore-certificate-errors",
            "--ignore-certificate-errors-spki-list",
            "--disable-default-apps",
            "--enable-features=NetworkService",
            "--disable-webgl",
            "--disable-threaded-animation",
            "--disable-threaded-scrolling",
            "--disable-in-process-stack-traces",
            "--disable-histogram-customizer",
            "--disable-gl-extensions",
            "--disable-composited-antialiasing",
            "--disable-canvas-aa",
            "--disable-3d-apis",
            "--disable-accelerated-jpeg-decoding",
            "--disable-accelerated-mjpeg-decode",
            "--disable-app-list-dismiss-on-blur",
            "--disable-accelerated-video-decode",
          ],
          timeout: 120000,
        },
      });

      // Set initial status to initializing
      console.log(`Initializing ${botName} Phone ${phoneIndex + 1}...`);
      clients[phoneIndex] = {
        client,
        status: "initializing",
        qrCode: null,
        initializationStartTime: Date.now(),
      };
      botMap.set(botName, clients);
      await updatePhoneStatus(botName, phoneIndex, "initializing");

      // Start checking for stuck initialization
      const checkInitialization = setInterval(async () => {
        try {
          const result = await sqlDb.query(
            `SELECT status FROM phone_status 
             WHERE company_id = $1 AND phone_number = $2`,
            [botName, phoneIndex]
          );

          if (
            result.rows.length > 0 &&
            result.rows[0].status === "initializing"
          ) {
            console.log(
              `${botName} Phone ${
                phoneIndex + 1
              } - Still initializing, running cleanup...`
            );

            clearInterval(checkInitialization);
            await safeCleanup(botName, phoneIndex);
          }
        } catch (error) {
          console.error(`Error checking initialization status: ${error}`);
        }
      }, 30000);

      client.on("qr", async (qr) => {
        try {
          const qrCodeData = await qrcode.toDataURL(qr);
          clients[phoneIndex] = {
            ...clients[phoneIndex],
            client,
            status: "qr",
            qrCode: qrCodeData,
            initializationStartTime: null,
          };
          botMap.set(botName, clients);
          await updatePhoneStatus(botName, phoneIndex, "qr", {
            qrCode: qrCodeData,
          });
          broadcastAuthStatus(
            botName,
            "qr",
            qrCodeData,
            clients.length > 1 ? phoneIndex : undefined
          );
        } catch (err) {
          console.error("Error generating QR code:", err);
        }
      });

      client.on("authenticated", async () => {
        console.log(`${botName} Phone ${phoneIndex + 1} - AUTHENTICATED`);
        clients[phoneIndex] = {
          ...clients[phoneIndex],
          status: "authenticated",
          qrCode: null,
        };
        botMap.set(botName, clients);
        await updatePhoneStatus(botName, phoneIndex, "authenticated");
      });

      client.on("ready", async () => {
        clearInterval(checkInitialization);
        console.log(`${botName} Phone ${phoneIndex + 1} - READY`);
        clients[phoneIndex] = {
          ...clients[phoneIndex],
          status: "ready",
          qrCode: null,
        };
        botMap.set(botName, clients);
        setupMessageHandler(client, botName, phoneIndex);
        setupMessageCreateHandler(client, botName, phoneIndex);
        await updatePhoneStatus(botName, phoneIndex, "ready");
        if (!isResolved) {
          isResolved = true;
          resolve();
        }
      });

      client.on("error", async (error) => {
        clearInterval(checkInitialization);
        console.error(
          `${botName} Phone ${phoneIndex + 1} - Client error:`,
          error
        );

        try {
          await updatePhoneStatus(botName, phoneIndex, "error", {
            error: error.message,
          });

          console.log(
            `${botName} Phone ${
              phoneIndex + 1
            } - Error detected, attempting cleanup and reinitialization...`
          );

          await safeCleanup(botName, phoneIndex);
        } catch (handlingError) {
          console.error(
            `${botName} Phone ${phoneIndex + 1} - Error handling client error:`,
            handlingError
          );
          try {
            await initializeBot(botName, 1, phoneIndex);
          } catch (lastError) {
            console.error(
              `${botName} Phone ${
                phoneIndex + 1
              } - Last resort reinitialization failed:`,
              lastError
            );
          }
        }
      });

      client.on("disconnected", async (reason) => {
        clearInterval(checkInitialization);
        console.log(
          `${botName} Phone ${phoneIndex + 1} - DISCONNECTED:`,
          reason
        );

        try {
          await updatePhoneStatus(botName, phoneIndex, "disconnected", {
            reason: reason,
          });

          console.log(`${botName} Phone ${phoneIndex + 1} - Attempting cleanup...`);

          // Clean up session if disconnected due to navigation or logout
          if (reason === "NAVIGATION" || reason === "LOGOUT") {
            console.log(
              `${botName} Phone ${
                phoneIndex + 1
              } - Navigation or logout detected, attempting cleanup...`
            );
            await safeCleanup(botName, phoneIndex);
            await sendAlertToEmployees(botName);
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));
          console.log(
            `${botName} Phone ${phoneIndex + 1} - Running cleanup...`
          );
        } catch (error) {
          console.error(
            `${botName} Phone ${
              phoneIndex + 1
            } - Error in disconnection handler:`,
            error
          );
          try {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            await initializeBot(botName, 1, phoneIndex);
          } catch (lastError) {
            console.error(
              `${botName} Phone ${
                phoneIndex + 1
              } - Last resort reinitialization failed:`,
              lastError
            );
          }
        }
      });

      await client.initialize();
      console.log(
        `Bot ${botName} Phone ${phoneIndex + 1} initialization complete`
      );
      startPhoneMonitoring(botName, phoneIndex);
    } catch (error) {
      await updatePhoneStatus(botName, phoneIndex, "error", {
        error: error.message,
      });
      try {
        const result = await sqlDb.query(
          `SELECT status FROM phone_status 
           WHERE company_id = $1 AND phone_number = $2`,
          [botName, phoneIndex]
        );

        if (
          result.rows.length > 0 &&
          result.rows[0].status === "initializing"
        ) {
          console.log(
            `${botName} Phone ${
              phoneIndex + 1
            } - Still initializing, running cleanup...`
          );
          await safeCleanup(botName, phoneIndex);
        }
      } catch (error) {
        console.error(
          `Error checking initialization status for ${botName} Phone ${
            phoneIndex + 1
          }:`,
          error
        );
      }
      reject(error);
    } finally {
      // Clean up event listeners
      process.removeListener(
        "unhandledRejection",
        errorHandlers.unhandledRejection
      );
      process.removeListener(
        "uncaughtException",
        errorHandlers.uncaughtException
      );
    }
  });
}

async function destroyClient(client) {
  try {
    const browser = client.pupPage?.browser();
    if (browser) {
      await browser
        .close()
        .catch((err) => console.log("Browser close error:", err));
    }
    await client
      .destroy()
      .catch((err) => console.log("Client destroy error:", err));
  } catch (err) {
    if (err.code === "EBUSY") {
      console.warn("Resource busy, retrying...");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        await client.destroy();
      } catch (retryErr) {
        console.warn("Final attempt to destroy client failed:", retryErr);
      }
    } else {
      throw err;
    }
  }
}

// Get session status from SQL database
async function getSessionStatus(botName, phoneIndex) {
  try {
    const result = await sqlDb.query(
      `SELECT status FROM phone_status 
       WHERE company_id = $1 AND phone_number = $2`,
      [botName, phoneIndex]
    );

    return result.rows.length > 0 ? result.rows[0].status : "unknown";
  } catch (error) {
    console.error(
      `Error getting session status for ${botName} phone ${phoneIndex}:`,
      error
    );
    return "unknown";
  }
}

// Main cleanup function
async function safeCleanup(botName, phoneIndex) {
  const clientName = `${botName}_phone${phoneIndex + 1}`;
  const sessionDir = path.join(
    __dirname,
    ".wwebjs_auth",
    `session-${clientName}`
  );

  try {
    // 1. Check if this session is actually problematic
    const status = await getSessionStatus(botName, phoneIndex);

    // Only clean up if session is in error state or disconnected
    if (status !== "ready" && status !== "authenticated") {
      console.log(`Cleaning up problematic session: ${clientName}`);
      await cleanupSession(botName, phoneIndex, sessionDir);
      return true;
    }

    console.log(
      `Session ${clientName} is healthy (status: ${status}), skipping cleanup`
    );
    return false;
  } catch (error) {
    console.error(`Error during cleanup check for ${clientName}:`, error);
    return false;
  }
}

// Enhanced session cleanup
async function cleanupSession(botName, phoneIndex, sessionDir) {
  try {
    console.log(`Cleaning up session ${botName} at ${sessionDir}`);
    // 1. Clean up locked files first
    await cleanupLockedFiles(sessionDir);

    // 2. Remove session directory
    await removeSessionDir(sessionDir);

    console.log(`Successfully cleaned up session ${botName}`);
    return true;
  } catch (error) {
    console.error(`Final cleanup attempt failed for ${botName}:`, error);
    return false;
  }
}

// Locked files cleaner
async function cleanupLockedFiles(dirPath) {
  console.log(`Cleaning up locked files in ${dirPath}`);
  if (!(await fileExists(dirPath))) return;

  try {
    const files = await fs.readdir(dirPath);
    const lockedFiles = files.filter(
      (file) =>
        file.endsWith(".db-journal") ||
        file.endsWith(".db-wal") ||
        file.endsWith(".db-shm") ||
        file === "lockfile"
    );

    for (const file of lockedFiles) {
      const filePath = path.join(dirPath, file);
      await forceDelete(filePath, 3); // 3 retries
    }
  } catch (error) {
    console.warn(`Error cleaning locked files in ${dirPath}:`, error);
  }
}

// Directory removal
async function removeSessionDir(dirPath) {
  console.log(`Deleting session directory ${dirPath}`);
  if (!(await fileExists(dirPath))) return;

  try {
    // Try standard deletion first
    console.log(`Deleting contents of ${dirPath}`);
    await fs.rm(dirPath, { recursive: true, force: true });
    console.log(`Successfully deleted contents of ${dirPath}`);

    // Verify deletion
    if (await fileExists(dirPath)) {
      throw new Error("Directory still exists after deletion");
    }
  } catch (error) {
    console.warn(`Standard deletion failed for ${dirPath}, trying fallback...`);

    // Fallback 1: Delete contents individually
    await deleteContentsIndividually(dirPath);

    // Fallback 2: Platform-specific commands
    await platformSpecificDelete(dirPath);
  }
}

// Utility functions
async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function forceDelete(filePath, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fs.unlink(filePath);
      return;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function deleteContentsIndividually(dirPath) {
  const files = await fs.readdir(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    try {
      const stat = await fs.lstat(filePath);
      if (stat.isDirectory()) {
        await removeSessionDir(filePath);
      } else {
        await forceDelete(filePath);
      }
    } catch (error) {
      console.warn(`Could not delete ${filePath}:`, error);
    }
  }
  // Only try to remove directory if it's empty
  try {
    await fs.rmdir(dirPath);
  } catch (error) {
    console.warn(`Could not remove directory ${dirPath}:`, error);
  }
}

async function platformSpecificDelete(dirPath) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" 
      ? `rmdir /s /q "${dirPath}"` 
      : `rm -rf "${dirPath}"`;

    exec(command, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function sendAlertToEmployees(companyId) {
  try {
    const companyQuery = `SELECT category FROM companies WHERE company_id = $1`;
    const { rows: companies } = await pool.query(companyQuery, [companyId]);
    
    if (companies.length === 0) {
      console.error(`Company with ID ${companyId} not found.`);
      return;
    }

    const companyCategory = companies[0].category;
    let botId = "0134";
    let alertMessage = `[ALERT] WhatsApp Connection Disconnected\n\nACTION REQUIRED:\n\n1. Navigate to web.jutasoftware.co.\n2. Log in to your account.\n3. Scan the QR code to reinitialize your WhatsApp connection.\n\nFor support, please contact +601121677672`;

    if (!companyCategory) {
      botId = "0134";
    } else if (companyCategory === "Omniyal") {
      botId = "063";
      alertMessage = `[ALERT] WhatsApp Connection Disconnected\n\nACTION REQUIRED:\n\n1. Navigate to app.omniyal.com.\n2. Log in to your account.\n3. Scan the QR code to reinitialize your WhatsApp connection.\n\nFor support, please contact us`;
    } else if (companyCategory === "XYZ") {
      botId = "0330";
      alertMessage = `[ALERT] WhatsApp Connection Disconnected\n\nACTION REQUIRED:\n\n1. Navigate to app.xyzaibot.com.\n2. Log in to your account.\n3. Scan the QR code to reinitialize your WhatsApp connection.\n\nFor support, please contact us`;
    }

    const botData = botMap.get(botId);
    if (!botData || !botData[0]?.client || botData[0].status !== "ready") {
      console.error(`Client for bot ${botId} is not initialized or not ready.`);
      return;
    }

    const client = botData[0].client;

    const query = `
      SELECT * FROM employees 
      WHERE company_id = $1 AND role = '1' AND active = true
    `;
    const { rows: employees } = await pool.query(query, [companyId]);
    
    console.log(`Fetched ${employees.length} employees with role '1' for company ${companyId}.`);

    if (employees.length === 0) {
      console.warn(`No active employees with role '1' found for company ${companyId}.`);
      return;
    }

    for (const emp of employees) {
      if (emp.phone_number) {
        const employeeID = emp.phone_number.replace("+", "") + "@c.us";
        console.log(`Sending alert to ${emp.phone_number}`);
        try {
          await client.sendMessage(employeeID, alertMessage);
          console.log(
            `Alert sent to ${emp.phone_number} about ${companyId} QR status`
          );
        } catch (sendError) {
          console.error(
            `Failed to send message to ${emp.phone_number}:`,
            sendError
          );
        }
      } else {
        console.warn(`Employee ${emp.name} does not have a phone number.`);
      }
    }
  } catch (error) {
    console.error("Error sending alert to employees:", error);
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
    if (client.readyState === WebSocket.OPEN) {
      // Send to logs viewers
      if (client.isLogsViewer) {
        client.send(
          JSON.stringify({
            type: "status_update",
            botName,
            status,
            phoneIndex,
            clientPhone,
            timestamp: new Date().toISOString(),
          })
        );
      }
      // Send to status page viewers
      else if (client.pathname === "/status") {
        client.send(
          JSON.stringify({
            type: "status_update",
            botName,
            status,
            phoneIndex,
            clientPhone,
            timestamp: new Date().toISOString(),
          })
        );
      }
    }
  });
}

// ... existing code ...

async function createAssistant(companyID) {
  const OPENAI_API_KEY = process.env.OPENAIKEY; // Ensure your environment variable is set
  const payload = {
    name: companyID,
    model: "gpt-4o-mini", // Ensure this model is supported and available
  };

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/assistants",
      payload,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
      }
    );

    const assistantId = response.data.id;
    const companyResult = await sqlDb.query(
      "SELECT * FROM companies WHERE company_id = $1",
      [companyID]
    );
    const company = companyResult.rows[0];

    // Get existing assistant_ids or initialize empty array
    let existingAssistantIds = [];
    if (company && company.assistant_ids) {
      if (Array.isArray(company.assistant_ids)) {
        existingAssistantIds = company.assistant_ids;
      } else if (typeof company.assistant_ids === 'string') {
        try {
          existingAssistantIds = JSON.parse(company.assistant_ids);
        } catch (e) {
          existingAssistantIds = [];
        }
      }
    }

    // Add the new assistant ID to the array
    existingAssistantIds.push(assistantId);

    // Update the companies table with the new assistant ID
    await sqlDb.query(
      `UPDATE companies 
       SET assistant_ids = $1, 
           v2 = true,
           updated_at = CURRENT_TIMESTAMP
       WHERE company_id = $2`,
      [JSON.stringify(existingAssistantIds), companyID]
    );

    console.log(`Assistant created successfully for company ${companyID}: ${assistantId}`);
    console.log(`Updated assistant_ids for company ${companyID}:`, existingAssistantIds);
    
    return assistantId;
  } catch (error) {
    console.error(
      "Error creating OpenAI assistant:",
      error.response ? error.response.data : error.message
    );
    // Don't use res here since this function is called outside of Express context
    throw error; // Re-throw the error to be handled by the caller
  }
}

// ... existing code ...

// 1. Modify the main() error handler (around line 15678)
main().catch((error) => {
  console.error("Error during initialization:", error);
  // Don't exit - just log the error and continue
  console.log("Continuing operation despite initialization error...");
});

// 2. Modify the uncaughtException handler (around line 15802)
process.on("uncaughtException", (error) => {
  console.error("\n=== Uncaught Exception ===");
  console.error("Error:", error);
  // Don't shutdown - just log the error
  console.log("Continuing operation despite uncaught exception...");
});

// 3. Modify the unhandledRejection handler (around line 15808)
process.on("unhandledRejection", (reason, promise) => {
  console.error("\n=== Unhandled Rejection ===");
  console.error("Reason:", reason);
  
  // Only shutdown if it's a critical error, not database timeouts
  if (reason.message && reason.message.includes('fetch failed')) {
    console.error("Database connection error detected - continuing operation");
    return; // Don't shutdown for database issues
  }
  
  // For other errors, just log and continue instead of shutting down
  console.log("Continuing operation despite unhandled rejection...");
});

// 4. Comment out or remove the worker restart logic (around line 15988)
// Comment out these lines:
// const { worker: newWorker } = createQueueAndWorker(botId);
// botWorkers.set(botId, newWorker);
// console.log(`Worker restarted for bot ${botId}`);

// 5. Modify the graceful shutdown to only exit on manual signals
process.on("SIGINT", async () => {
  console.log("\n=== Graceful Shutdown Initiated ===");
  // ... existing cleanup code ...
  
  // Only exit if it's a manual shutdown
  if (process.env.MANUAL_SHUTDOWN === 'true') {
    process.exit(0);
  } else {
    console.log("Shutdown prevented - continuing operation...");
  }
});

// 6. Modify the shutdown error handler (around line 15792)
// Replace process.exit(1) with:
console.log("Shutdown error occurred but continuing operation...");

// Also handle other termination signals
process.on("SIGTERM", () => {
  console.log("SIGTERM received");
  process.emit("SIGINT");
});

process.on("uncaughtException", (error) => {
  console.error("\n=== Uncaught Exception ===");
  console.error("Error:", error);
  process.emit("SIGINT");
});

// Database health check
async function checkDatabaseHealth() {
  try {
    await sql`SELECT 1`;
    console.log('Database health check: OK');
  } catch (error) {
    console.error('Database health check failed:', error.message);
    // Log but don't crash
  }
}

// Run health check every 5 minutes
setInterval(checkDatabaseHealth, 5 * 60 * 1000);
// New endpoint to fetch message details from Firebase
app.get(
  "/api/queue/message-details/:companyId/:messageId",
  async (req, res) => {
    const { companyId, messageId } = req.params;

    try {
      const client = await pool.connect();

      try {
        const messageQuery = `
          SELECT * FROM scheduled_messages 
          WHERE id = $1 AND company_id = $2
          LIMIT 1
        `;
        const messageResult = await client.query(messageQuery, [messageId, companyId]);

        if (messageResult.rowCount === 0) {
          return res.status(404).json({ error: "Message not found" });
        }

        const messageData = messageResult.rows[0];

        const batchesQuery = `
          SELECT * FROM scheduled_messages 
          WHERE schedule_id = $1 
            AND company_id = $2
            AND id != $1
          ORDER BY batch_index ASC
        `;
        const batchesResult = await client.query(batchesQuery, [messageId, companyId]);

        const batches = batchesResult.rows.map(batch => ({
          id: batch.id,
          ...batch,
          chat_ids: batch.chat_ids ? JSON.parse(batch.chat_ids) : [],
          message_delays: batch.message_delays ? JSON.parse(batch.message_delays) : null,
          active_hours: batch.active_hours ? JSON.parse(batch.active_hours) : null
        }));

        const parsedMessageData = {
          ...messageData,
          chat_ids: messageData.chat_ids ? JSON.parse(messageData.chat_ids) : [],
          message_delays: messageData.message_delays ? JSON.parse(messageData.message_delays) : null,
          active_hours: messageData.active_hours ? JSON.parse(messageData.active_hours) : null
        };

        res.json({
          messageDetails: {
            id: messageId,
            ...parsedMessageData,
            batches,
          },
        });
      } catch (error) {
        console.error("Error fetching message details:", error);
        throw error;
      } finally {
        await safeRelease(client);
      }
    } catch (error) {
      console.error("Error fetching message details:", error);
      res.status(500).json({ error: "Failed to fetch message details" });
    }
  }
);

app.get("/api/queue/diagnose", async (req, res) => {
  try {
    const diagnosis = {
      queues: {},
    };

    for (const [botId, queue] of botQueues.entries()) {
      // Get all job types including completed with higher limits
      const counts = await queue.getJobCounts();

      // Fetch more historical jobs
      const completedJobs = await queue.getJobs(["completed"], 0, 1000); // Get last 1000 completed jobs
      const activeJobs = await queue.getJobs(["active"]);
      const delayedJobs = await queue.getJobs(["delayed"]);
      const failedJobs = await queue.getJobs(["failed"]);
      const waitingJobs = await queue.getJobs(["waiting"]);

      // Process jobs to ensure all data is included
      const processJobs = async (jobs) => {
        return Promise.all(
          jobs.map(async (job) => {
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
              status: job.status,
            };

            return jobData;
          })
        ).then((jobs) => jobs.filter((job) => job !== null));
      };

      diagnosis.queues[botId] = {
        counts,
        worker: {
          isRunning: botWorkers.get(botId)?.isRunning() || false,
          concurrency: botWorkers.get(botId)?.concurrency || 0,
        },
        activeJobs: await processJobs(activeJobs),
        delayedJobs: await processJobs(delayedJobs),
        failedJobs: await processJobs(failedJobs),
        waitingJobs: await processJobs(waitingJobs),
        completedJobs: await processJobs(completedJobs),
      };
    }

    res.json(diagnosis);
  } catch (error) {
    console.error("Queue diagnosis error:", error);
    res.status(500).json({ error: "Failed to diagnose queues" });
  }
});

// Update the reset endpoint as well
app.post("/api/queue/reset", async (req, res) => {
  try {
    console.log("\n=== Starting Queue Reset ===");
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
      message: "Queue reset complete",
      status,
    });
  } catch (error) {
    console.error("Error resetting queue:", error);
    res.status(500).json({ error: "Failed to reset queue" });
  }
});

// Update the force process endpoint
app.post("/api/queue/force-process", async (req, res) => {
  try {
    console.log("\n=== Force Processing Queues ===");
    const results = {};

    for (const [botId, queue] of botQueues.entries()) {
      const jobs = await queue.getJobs(["active", "delayed", "waiting"]);
      console.log(`Found ${jobs.length} jobs for bot ${botId}`);

      for (const job of jobs) {
        try {
          await job.moveToFailed(new Error("Force reset"), true);
          await job.retry();
        } catch (jobError) {
          console.error(
            `Error processing job ${job.id} for bot ${botId}:`,
            jobError
          );
        }
      }

      results[botId] = {
        processedCount: jobs.length,
        newStatus: await queue.getJobCounts(),
      };
    }

    res.json({
      message: "Force processing complete",
      results,
    });
  } catch (error) {
    console.error("Force processing error:", error);
    res.status(500).json({ error: "Failed to force process queues" });
  }
});

// Get user role endpoint
app.get("/api/user-role", async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const userData = await sqlDb.getRow(
      "SELECT role FROM users WHERE email = $1 AND active = true",
      [email]
    );

    if (!userData) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ role: userData.role });
  } catch (error) {
    console.error("Error fetching user role:", error);
    res.status(500).json({ error: "Failed to fetch user role" });
  }
});

// Get user and company data endpoint
app.get("/api/user-company-data", async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // First get user data to get company_id
    const userData = await sqlDb.getRow(
      "SELECT company_id FROM users WHERE email = $1 AND active = true",
      [email]
    );

    if (!userData) {
      return res.status(404).json({ error: "User not found" });
    }

    const companyId = userData.company_id;

    // Then get company data - added assistant_id to the SELECT
    const companyData = await sqlDb.getRow(
      "SELECT id, company_id, name, email, phone, plan, v2, phone_count, assistant_ids, api_url FROM companies WHERE company_id = $1",
      [companyId]
    );

    if (!companyData) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Get employee data
    const employeeResult = await sqlDb.getRows(
      "SELECT * FROM users WHERE company_id = $1 AND active = true",
      [companyId]
    );

    const employeeList = employeeResult.map((emp) => ({
      id: emp.id,
      name: emp.name,
      email: emp.email,
      phone: emp.phone,
      role: emp.role,
    }));

    // Get message usage for enterprise plan
    let messageUsage = 0;
    if (companyData.plan === "enterprise") {
      const currentDate = new Date();
      const monthKey = `${currentDate.getFullYear()}-${String(
        currentDate.getMonth() + 1
      ).padStart(2, "0")}`;

      const usageResult = await sqlDb.getRow(
        "SELECT total_messages FROM message_usage WHERE company_id = $1 AND month = $2",
        [companyId, monthKey]
      );

      if (usageResult) {
        messageUsage = usageResult.total_messages;
      }
    }

    // Get tags if company is using v2
    let tags = [];
    if (companyData.v2) {
      const contactsResult = await sqlDb.getRows(
      "SELECT DISTINCT jsonb_array_elements(CASE WHEN jsonb_typeof(tags) = 'array' THEN tags ELSE '[]'::jsonb END) as tag_name FROM contacts WHERE company_id = $1",
      [companyId]
      );

      const employeeNames = employeeList.map((emp) =>
      emp.name ? emp.name.trim().toLowerCase() : ""
      );
      tags = contactsResult
      .map((row) => ({ id: row.tag_name, name: row.tag_name }))
      .filter(
        (tag) =>
        typeof tag.name === "string" &&
        tag.name.trim() !== "" &&
        tag.name !== "{}" &&
        !employeeNames.includes(tag.name.toLowerCase())
      );
    }

    // Prepare response - added assistant_id to companyData
    const response = {
      userData: {
        name: userData.name,
        email: userData.email,
        role: userData.role,
        companyId: userData.company_id,
        viewEmployee: userData.view_employee,
      },
      companyData: {
        name: companyData.name,
        plan: companyData.plan,
        phoneCount: companyData.phone_count || 1,
        v2: companyData.v2,
        assistants_ids: companyData.assistant_ids,
        assistant_id: companyData.assistant_id,
        api_url: companyData.api_url || "",
      },
      employeeList,
      messageUsage,
      tags,
    };
    res.json(response);
  } catch (error) {
    console.error("Error fetching user and company data:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// ... existing code ...

app.get("/api/user-config", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    // Get user data
    const userResult = await sqlDb.getRow(
      "SELECT * FROM users WHERE email = $1 AND active = true",
      [email]
    );

    if (!userResult) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userResult;
    const companyId = userData.company_id;

    // Get company data
    const companyResult = await sqlDb.getRow(
      "SELECT * FROM companies WHERE company_id = $1",
      [companyId]
    );

    if (!companyResult) {
      return res.status(404).json({ error: "Company not found" });
    }

    const companyData = companyResult;

    let phoneNamesData = {};
    let phoneNames = [];
    if (companyData.phone_numbers) {
      try {
        // Accept both stringified array and array
        if (typeof companyData.phone_numbers === "string") {
          phoneNames = JSON.parse(companyData.phone_numbers);
        } else if (Array.isArray(companyData.phone_numbers)) {
          phoneNames = companyData.phone_numbers;
        }
      } catch (e) {
        phoneNames = [];
      }
    }
    // Always fallback to default names if empty
    for (let i = 0; i < (companyData.phone_count || 1); i++) {
      phoneNamesData[i] = phoneNames[i] || `Phone ${i + 1}`;
    }

    const phoneCount = companyData.phone_count || 1;

    // Get employee data
    const employeeResult = await sqlDb.getRows(
      "SELECT * FROM users WHERE company_id = $1 AND active = true",
      [companyId]
    );

    const employeeList = employeeResult.map((emp) => ({
      id: emp.id,
      name: emp.name,
      email: emp.email,
      phone: emp.phone,
      role: emp.role,
    }));

    // Get message usage for enterprise plan
    let messageUsage = 0;
    if (companyData.plan === "enterprise") {
      const currentDate = new Date();
      const monthKey = `${currentDate.getFullYear()}-${String(
        currentDate.getMonth() + 1
      ).padStart(2, "0")}`;

      const usageResult = await sqlDb.getRow(
        "SELECT total_messages FROM message_usage WHERE company_id = $1 AND month = $2",
        [companyId, monthKey]
      );

      if (usageResult) {
        messageUsage = usageResult.total_messages;
      }
    }

    // Get tags if company is using v2
    let tags = [];
    if (companyData.v2) {
      const contactsResult = await sqlDb.getRows(
        "SELECT DISTINCT jsonb_array_elements(CASE WHEN jsonb_typeof(tags) = 'array' THEN tags ELSE '[]'::jsonb END) as tag_name FROM contacts WHERE company_id = $1",
        [companyId]
      );

      const employeeNames = employeeList.map((emp) =>
        emp.name ? emp.name.trim().toLowerCase() : ""
      );
      tags = contactsResult
        .map((row) => ({ id: row.tag_name, name: row.tag_name }))
        .filter((tag) => tag.name && !employeeNames.includes(tag.name.toLowerCase()));
    }

    let viewEmployeesArr = [];
    try {
      if (userData.view_employees) {
      viewEmployeesArr = typeof userData.view_employees === 'string'
        ? JSON.parse(userData.view_employees)
        : userData.view_employees;
      }
    } catch (error) {
      console.error("Error parsing view_employees:", error);
      viewEmployeesArr = [];
    }

    // Prepare response
    const response = {
      userData: {
        name: userData.name,
        email: userData.email,
        role: userData.role,
        companyId: userData.company_id,
        viewEmployees: viewEmployeesArr,
        phone: userData.phone, // Added selected_phone to userData
      },
      companyData: {
        name: companyData.name,
        plan: companyData.plan,
        phoneNames: phoneNamesData,
        phoneCount: phoneCount,
        v2: companyData.v2,
      },
      employeeList,
      messageUsage,
      tags,
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching user config:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ... existing code ...

// Get contacts for a company with authentication
// ... existing code ...
app.get("/api/companies/:companyId/contacts", async (req, res) => {
  try {


    const { email } = req.query;
    const { companyId } = req.params;
    if (!email) {
      console.log("Missing email in query");
      return res.status(400).json({ error: "Email is required" });
    }

    // Get user email from session
    const userEmail = email;
    console.log("User email:", userEmail);

    // Verify user belongs to company
    const userData = await sqlDb.getRow(
      "SELECT role, name FROM users WHERE email = $1 AND company_id = $2 AND active = true",
      [userEmail, companyId]
    );
   // console.log("User data from DB:", userData);

    if (!userData) {
      console.log("User not authorized for this company");
      return res
        .status(403)
        .json({ error: "Forbidden - User not authorized for this company" });
    }

    // Fetch all contacts for the company
 // Fetch all contacts for the company
const contacts = await sqlDb.getRows(
  `
  SELECT 
    c.id,
    c.contact_id,
    c.name,
    c.contact_name,
    c.phone,
    c.phone_index,
    c.email,
    c.chat_id,
    c.profile,
    c.profile_pic_url,
    c.tags,
    c.created_at,
    c.last_updated,
    c.phone_indexes,
    c.unread_count,
    c.custom_fields,
    c.branch,
    c.expiry_date,
    c.vehicle_number,
    c.ic,
    c.address1,
    c.company,
    c.notes,
    c.last_name,
    c.points,
    CASE 
      WHEN c.chat_id LIKE '%@c.us' THEN true 
      ELSE false 
    END as is_individual,
    (
      SELECT jsonb_agg(e.name)
      FROM assignments a
      JOIN employees e ON a.employee_id = e.employee_id
      WHERE a.contact_id = c.contact_id 
      AND a.company_id = c.company_id
      AND a.status = 'active'
    ) as assigned_to,
    (
      SELECT jsonb_build_object(
        'chat_id', m.chat_id,
        'from', m.chat_id,
        'from_me', m.from_me,
        'id', m.message_id,
        'source', '',
        'status', m.status,
        'text', jsonb_build_object('body', m.content),
        'timestamp', EXTRACT(EPOCH FROM m.timestamp)::bigint,
        'type', m.message_type,
        'name', m.author
      )
      FROM messages m
      WHERE m.contact_id = c.contact_id
      AND m.company_id = c.company_id
      ORDER BY m.timestamp DESC
      LIMIT 1
    ) as last_message
  FROM contacts c
  WHERE c.company_id = $1
  ORDER BY c.last_updated DESC
`,
  [companyId]
);


    // Process contacts to match frontend expectations
    const processedContacts = contacts.map((contact, idx) => {
      // Parse tags from JSONB if they are a string, or use empty array if null/undefined
      let tags = contact.tags;
      try {
        if (typeof tags === "string") {
          tags = JSON.parse(tags);
        }
        // Ensure tags is an array and filter out empty values
        tags = Array.isArray(tags) ? tags.filter((tag) => tag) : [];
      } catch (error) {
        console.error(`Error parsing tags for contact[${idx}]:`, error, "Raw tags:", contact.tags);
        tags = [];
      }

      // Parse phone_indexes from JSONB if they are a string, or use empty array if null/undefined
      let phoneIndexes = contact.phone_indexes;
      try {
        if (typeof phoneIndexes === "string") {
          phoneIndexes = JSON.parse(phoneIndexes);
        }
        phoneIndexes = Array.isArray(phoneIndexes) ? phoneIndexes.filter((v) => v !== undefined && v !== null) : [];
      } catch (error) {
        console.error(`Error parsing phone_indexes for contact[${idx}]:`, error, "Raw phone_indexes:", contact.phone_indexes);
        phoneIndexes = [];
      }

      // Parse assigned_to from JSONB if it exists
      let assignedTo = contact.assigned_to;
      try {
        if (typeof assignedTo === "string") {
          assignedTo = JSON.parse(assignedTo);
        }
        // Ensure assignedTo is an array
        assignedTo = Array.isArray(assignedTo) ? assignedTo : [];
      } catch (error) {
        console.error(`Error parsing assigned_to for contact[${idx}]:`, error, "Raw assigned_to:", contact.assigned_to);
        assignedTo = [];
      }

      const processed = {
        id: contact.id,
        contact_id: contact.contact_id,
        name: contact.name || contact.contact_name || "",
        phone: contact.phone || "",
        email: contact.email || "",
        chat_id: contact.chat_id || "",
        profileUrl: contact.profile_pic_url || "",
        profile: contact.profile || {},
        tags: tags,
        phoneIndex: contact.phone_index || 0,
        phoneIndexes: phoneIndexes,
        assignedTo: assignedTo,
        createdAt: contact.created_at,
        lastUpdated: contact.last_updated,
        isIndividual: contact.is_individual,
        last_message: contact.last_message || null,
        unreadCount: contact.unread_count || 0, 
        customFields: contact.custom_fields || {},
        // Add the missing fields
        branch: contact.branch || null,
        expiryDate: contact.expiry_date || null,
        vehicleNumber: contact.vehicle_number || null,
        ic: contact.ic || null,
        address1: contact.address1 || null,
        company: contact.company || null,
        notes: contact.notes || null,
        lastName: contact.last_name || null,
        points: contact.points || 0,
      };
    //  console.log(`Processed contact[${idx}]:`, processed);
      return processed;
    });

    // Filter contacts based on user role
   
    const filteredContacts = filterContactsByUserRole(processedContacts, userData.role, userData.name);
   
    res.json({
      success: true,
      total: processedContacts.length,
      contacts: processedContacts,
    });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch contacts",
      message: error.message,
    });
  }
});
// ... existing code ...

// Function to filter contacts based on user role
function filterContactsByUserRole(contacts, userRole, userName) {
  // If user is admin (role 1), return all contacts
  if (userRole === "1") {
    return contacts;
  }

  // If user is sales (role 2), return only contacts assigned to them
  if (userRole === "2") {
    return contacts.filter((contact) => {
      // Check if contact is assigned to this user
      const isAssignedToUser =
        contact.assignedTo &&
        contact.assignedTo.some(
          (assignee) => assignee.toLowerCase() === userName.toLowerCase()
        );

      // Check if contact has user's name in tags
      const hasUserTag =
        contact.tags &&
        contact.tags.some(
          (tag) =>
            typeof tag === "string" &&
            tag.toLowerCase() === userName.toLowerCase()
        );

      // Include group chats regardless of assignment
      const isGroupChat = contact.chat_id && contact.chat_id.includes("@g.us");

      return isAssignedToUser || hasUserTag || isGroupChat;
    });
  }

  // For other roles, return empty array
  return [];
}

module.exports = { botMap };

// Get user data
app.get("/api/user-data", async (req, res) => {
  try {
    const { email } = req.query;

    const result = await sqlDb.query(`SELECT * FROM users WHERE email = $1`, [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ error: "Failed to fetch user data" });
  }
});

// Get company data
app.get("/api/company-data", async (req, res) => {
  try {
    const { companyId } = req.query;

    const result = await sqlDb.query(
      `SELECT * FROM companies WHERE company_id = $1`,
      [companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Company not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching company data:", error);
    res.status(500).json({ error: "Failed to fetch company data" });
  }
});

// Get messages
app.get("/api/messages", async (req, res) => {
  try {
    const { chatId, companyId } = req.query;
    console.log("Fetching messages for chatId:", chatId, "companyId:", companyId);
    const result = await sqlDb.query(
      `SELECT m.*, c.name as contact_name 
       FROM messages m
       LEFT JOIN contacts c ON m.contact_id = c.contact_id AND m.company_id = c.company_id
       WHERE m.contact_id = $1 AND m.company_id = $2 
       ORDER BY m.timestamp ASC`,
      [chatId, companyId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Get paginated messages for app
app.get("/api/message-pages", async (req, res) => {
  try {
    const { chatId, companyId, limit = 50, offset = 0 } = req.query;
    console.log("Fetching paginated messages for chatId:", chatId, "companyId:", companyId, "limit:", limit, "offset:", offset);
    if (!chatId || !companyId) {
      return res.status(400).json({ error: "Missing chatId or companyId" });
    }

    const sql = `
      SELECT m.*, c.name as contact_name 
      FROM messages m
      LEFT JOIN contacts c ON m.contact_id = c.contact_id AND m.company_id = c.company_id
      WHERE m.contact_id = $1 AND m.company_id = $2
      ORDER BY m.timestamp DESC
      LIMIT $3 OFFSET $4
    `;
    const params = [chatId, companyId, parseInt(limit, 10), parseInt(offset, 10)];

    const result = await sqlDb.query(sql, params);

    res.json({
      success: true,
      messages: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("Error fetching paginated messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Update contact
app.patch("/api/contacts/:contactId", async (req, res) => {
  try {
    const { contactId } = req.params;
    const { company_id, tags, last_message } = req.body;

    const result = await sqlDb.query(
      `UPDATE contacts 
       SET tags = $1, 
           last_message = $2,
           last_updated = CURRENT_TIMESTAMP
       WHERE contact_id = $3 AND company_id = $4
       RETURNING *`,
      [tags, last_message, contactId, company_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Contact not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating contact:", error);
    res.status(500).json({ error: "Failed to update contact" });
  }
});

// API endpoint to get all user context data (user + company + employees)
app.get("/api/user-context", async (req, res) => {
  try {
    const { email } = req.query;

    // 1. Get user data
    const userResult = await sqlDb.query(
      `SELECT * FROM users WHERE email = $1`, 
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userResult.rows[0];
    const companyId = userData.company_id;

    // 2. Get company data (including phone info)
    const companyResult = await sqlDb.query(
      `SELECT * FROM companies WHERE company_id = $1`,
      [companyId]
    );
    
    const companyData = companyResult.rows[0] || {};
    
    // Process phone names
    const phoneCount = companyData.phone_count || 0;
    const apiUrl = companyData.api_url || "https://juta-dev.ngrok.dev";
    const stopBot = companyData.stopbot || false;
    const stopBots = companyData.stopbots || {};
    
    let phoneNamesData = {};
    let phoneNames = [];
    if (companyData.phone_numbers) {
      try {
      // Accept both stringified array and array
      if (typeof companyData.phone_numbers === "string") {
        phoneNames = JSON.parse(companyData.phone_numbers);
      } else if (Array.isArray(companyData.phone_numbers)) {
        phoneNames = companyData.phone_numbers;
      }
      } catch (e) {
      phoneNames = [];
      }
    }
    // Always fallback to default names if empty
    for (let i = 0; i < (companyData.phone_count || 1); i++) {
      phoneNamesData[i] = phoneNames[i] || `Phone ${i + 1}`;
    }

    // 3. Get all employees for the company
    const employeesResult = await sqlDb.query(
      `SELECT 
        id, name, email, role, employee_id, phone_number 
       FROM employees 
       WHERE company_id = $1`,
      [companyId]
    );

    // Return combined data
    res.json({
      ...userData,
      companyId,
      phoneNames: phoneNamesData,
      phoneCount: phoneCount,
      employees: employeesResult.rows,
      apiUrl: apiUrl,
      stopBot: stopBot,
      stopBots: stopBots,
    });
  } catch (error) {
    console.error("Error fetching user context:", error);
    res.status(500).json({ error: "Failed to fetch user context" });
  }
});

// API endpoint to get detailed user data
app.get("/api/user-details", async (req, res) => {
  try {
    const { email } = req.query;

    const result = await sqlDb.query(
      `SELECT 
        name, phone_number, role, company_id, emp_group, 
        employee_id, notes, quota_leads, invoice_number,
        phone_access, image_url, weightages, view_employees
       FROM employees
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching user details:", error);
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

// API endpoint to get all user context data (user + company + employees)
app.get("/api/user-page-context", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // 1. Get user data from users table
    const userResult = await sqlDb.query(
      `SELECT u.*, e.employee_id, e.phone_access, e.weightages, e.image_url, 
              e.notes, e.quota_leads, e.view_employees, e.invoice_number, e.emp_group
       FROM users u
       LEFT JOIN employees e ON u.email = e.email AND u.company_id = e.company_id
       WHERE u.email = $1 AND u.active = true`, 
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userResult.rows[0];
    const companyId = userData.company_id;

    // 2. Get company data (including phone info)
    const companyResult = await sqlDb.query(
      `SELECT * FROM companies WHERE company_id = $1`,
      [companyId]
    );
    
    const companyData = companyResult.rows[0] || {};
    
    let phoneNamesData = {};
    let phoneNames = [];
    if (companyData.phone_numbers) {
      try {
      // Accept both stringified array and array
      if (typeof companyData.phone_numbers === "string") {
        phoneNames = JSON.parse(companyData.phone_numbers);
      } else if (Array.isArray(companyData.phone_numbers)) {
        phoneNames = companyData.phone_numbers;
      }
      } catch (e) {
      phoneNames = [];
      }
    }
    // Always fallback to default names if empty
    for (let i = 0; i < (companyData.phone_count || 1); i++) {
      phoneNamesData[i] = phoneNames[i] || `Phone ${i + 1}`;
    }
    console.log("Phone names data:", phoneNamesData);

    // 3. Get all employees for the company
    const employeesResult = await sqlDb.query(
      `SELECT 
        id, name, email, role, employee_id, phone_number, assigned_contacts, image_url, view_employees, emp_group, phone_access, weightages
       FROM employees 
       WHERE company_id = $1 AND active = true
       ORDER BY role, name`,
      [companyId]
    );

    // Format employees data
    const employeeListData = employeesResult.rows.map(employee => {
      let phoneAccess = {};
      let weightages = {};
      let viewEmployees = [];
      
      // Parse JSON fields safely
      try {
        if (employee.phone_access) {
          phoneAccess = typeof employee.phone_access === 'string' 
            ? JSON.parse(employee.phone_access) 
            : employee.phone_access;
        }
      } catch (error) {
        console.error("Error parsing phone_access for employee:", employee.email, error);
        phoneAccess = {};
      }
      
      try {
        if (employee.weightages) {
          weightages = typeof employee.weightages === 'string' 
            ? JSON.parse(employee.weightages) 
            : employee.weightages;
        }
      } catch (error) {
        console.error("Error parsing weightages for employee:", employee.email, error);
        weightages = {};
      }
      
      try {
        if (employee.view_employees) {
          viewEmployees = typeof employee.view_employees === 'string' 
            ? JSON.parse(employee.view_employees) 
            : employee.view_employees;
        }
      } catch (error) {
        console.error("Error parsing view_employees for employee:", employee.email, error);
        viewEmployees = [];
      }
      
      return {
        id: employee.id,
        name: employee.name,
        email: employee.email || employee.id,
        role: employee.role,
        employeeId: employee.employee_id,
        phoneNumber: employee.phone_number,
        assignedContacts: employee.assigned_contacts || 0,
        imageUrl: employee.image_url || "",
        viewEmployees: viewEmployees,
        empGroup: employee.emp_group || "",
        phoneAccess: phoneAccess,
        weightages: weightages
      };
    });

    // Parse current user's JSON fields
    let currentUserPhoneAccess = {};
    let currentUserWeightages = {};
    let currentUserViewEmployees = [];
    
    try {
      if (userData.phone_access) {
        currentUserPhoneAccess = typeof userData.phone_access === 'string' 
          ? JSON.parse(userData.phone_access) 
          : userData.phone_access;
      }
    } catch (error) {
      console.error("Error parsing current user phone_access:", error);
      currentUserPhoneAccess = {};
    }
    
    try {
      if (userData.weightages) {
        currentUserWeightages = typeof userData.weightages === 'string' 
          ? JSON.parse(userData.weightages) 
          : userData.weightages;
      }
    } catch (error) {
      console.error("Error parsing current user weightages:", error);
      currentUserWeightages = {};
    }
    
    try {
      if (userData.view_employees) {
        currentUserViewEmployees = typeof userData.view_employees === 'string' 
          ? JSON.parse(userData.view_employees) 
          : userData.view_employees;
      }
    } catch (error) {
      console.error("Error parsing current user view_employees:", error);
      currentUserViewEmployees = [];
    }

    // Return combined data
    res.json({
      companyId,
      role: userData.role,
      email: userData.email,
      name: userData.name,
      phoneAccess: currentUserPhoneAccess,
      weightages: currentUserWeightages,
      viewEmployees: currentUserViewEmployees,
      phoneNames: phoneNamesData,
      employees: employeeListData,
      companyData: {
        phoneCount: phoneNames.length || 1,
        ghl_accessToken: companyData.ghl_accesstoken,
        apiUrl: companyData.api_url || "https://juta.ngrok.app",
        v2: companyData.v2,
        whapiToken: companyData.whapi_token,
        stopBot: companyData.stopbot || false,
        stopBots: companyData.stopbots || {}
      }
    });
  } catch (error) {
    console.error("Error fetching user context:", error);
    res.status(500).json({ error: "Failed to fetch user context" });
  }
});

// API endpoint to get detailed user data
app.get("/api/user-page-details", async (req, res) => {
  try {
    const { id } = req.query; // This is the email

    if (!id) {
      return res.status(400).json({ error: "User ID (email) is required" });
    }

    // Get user and employee data with a LEFT JOIN
    const query = `
      SELECT u.name, u.phone, u.role, u.company_id, u.email, e.phone_number,
             e.employee_id, e.phone_access, e.weightages, e.image_url, 
             e.notes, e.quota_leads, e.view_employees, e.invoice_number, e.emp_group
      FROM users u
      LEFT JOIN employees e ON u.email = e.email AND u.company_id = e.company_id
      WHERE u.email = $1 AND u.active = true
    `;
    const result = await sqlDb.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = result.rows[0];
    
    // Parse JSON fields safely
    let phoneAccess = {};
    let weightages = {};
    let viewEmployees = [];
    
    try {
      if (userData.phone_access) {
        phoneAccess = typeof userData.phone_access === 'string' 
          ? JSON.parse(userData.phone_access) 
          : userData.phone_access;
      }
    } catch (error) {
      console.error("Error parsing phone_access:", error);
      phoneAccess = {};
    }
    
    try {
      if (userData.weightages) {
        weightages = typeof userData.weightages === 'string' 
          ? JSON.parse(userData.weightages) 
          : userData.weightages;
      }
    } catch (error) {
      console.error("Error parsing weightages:", error);
      weightages = {};
    }
    
    try {
      if (userData.view_employees) {
        viewEmployees = typeof userData.view_employees === 'string' 
          ? JSON.parse(userData.view_employees) 
          : userData.view_employees;
      }
    } catch (error) {
      console.error("Error parsing view_employees:", error);
      viewEmployees = [];
    }
    
    // Format the response to match the frontend expectations
    const response = {
      name: userData.name,
      phoneNumber: userData.phone_number,
      email: userData.email,
      role: userData.role,
      companyId: userData.company_id,
      employeeId: userData.employee_id,
      phone_access: phoneAccess,
      weightages: weightages,
      imageUrl: userData.image_url,
      notes: userData.notes,
      quotaLeads: userData.quota_leads || 0,
      viewEmployees: viewEmployees,
      invoiceNumber: userData.invoice_number,
      group: userData.emp_group
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching user details:", error);
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

// API endpoint to get quick replies for a user (by email)
app.get("/api/quick-replies", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Get company_id from users table
    const userResult = await sqlDb.query(
      "SELECT company_id FROM users WHERE email = $1",
      [email]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const companyId = userResult.rows[0].company_id;

    // Get quick replies for the company
    const quickRepliesResult = await sqlDb.query(
      `SELECT id, category, keyword, text, type, documents, images, videos, created_by, created_at, updated_at, status
       FROM quick_replies
       WHERE company_id = $1 AND status = 'active'
       ORDER BY updated_at DESC`,
      [companyId]
    );

    res.json({ quickReplies: quickRepliesResult.rows });
  } catch (error) {
    console.error("Error fetching quick replies:", error);
    res.status(500).json({ error: "Failed to fetch quick replies" });
  }
});

// API endpoint to add a quick reply
app.post("/api/quick-replies", async (req, res) => {
  try {
    const {
      email,
      category,
      keyword,
      text,
      type,
      documents,
      images,
      videos,
      created_by,
    } = req.body;

    if (!email || !text) {
      return res.status(400).json({ error: "Email and text are required" });
    }

    // Get company_id from users table
    const userResult = await sqlDb.query(
      "SELECT company_id FROM users WHERE email = $1",
      [email]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const companyId = userResult.rows[0].company_id;

    // Insert quick reply
    const insertResult = await sqlDb.query(
      `INSERT INTO quick_replies
        (company_id, category, keyword, text, type, documents, images, videos, created_by, created_at, updated_at, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'active')
        RETURNING id, category, keyword, text, type, documents, images, videos, created_by, created_at, updated_at, status`,
      [
        companyId,
        category || null,
        keyword || null,
        text,
        type || null,
        documents ? JSON.stringify(documents) : null,
        images ? JSON.stringify(images) : null,
        videos ? JSON.stringify(videos) : null,
        created_by || email,
      ]
    );

    res.json({ success: true, quickReply: insertResult.rows[0] });
  } catch (error) {
    console.error("Error adding quick reply:", error);
    res.status(500).json({ error: "Failed to add quick reply" });
  }
});

// API endpoint to edit a quick reply
app.put("/api/quick-replies/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      category,
      keyword,
      text,
      type,
      documents,
      images,
      videos,
      status,
      updated_by,
    } = req.body;

    const updateFields = [];
    const values = [];
    let idx = 1;

    if (category !== undefined) {
      updateFields.push(`category = $${idx++}`);
      values.push(category);
    }
    if (keyword !== undefined) {
      updateFields.push(`keyword = $${idx++}`);
      values.push(keyword);
    }
    if (text !== undefined) {
      updateFields.push(`text = $${idx++}`);
      values.push(text);
    }
    if (type !== undefined) {
      updateFields.push(`type = $${idx++}`);
      values.push(type);
    }
    if (documents !== undefined) {
      updateFields.push(`documents = $${idx++}`);
      values.push(documents);
    }
    if (images !== undefined) {
      updateFields.push(`images = $${idx++}`);
      values.push(images);
    }
    if (videos !== undefined) {
      updateFields.push(`videos = $${idx++}`);
      values.push(videos);
    }
    if (status !== undefined) {
      updateFields.push(`status = $${idx++}`);
      values.push(status);
    }
    if (updated_by !== undefined) {
      updateFields.push(`updated_by = $${idx++}`);
      values.push(updated_by);
    }
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

    if (updateFields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(id);

    const query = `
      UPDATE quick_replies
      SET ${updateFields.join(", ")}
      WHERE id = $${idx}
      RETURNING *
    `;

    const result = await sqlDb.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Quick reply not found" });
    }

    res.json({ success: true, quickReply: result.rows[0] });
  } catch (error) {
    console.error("Error updating quick reply:", error);
    res.status(500).json({ error: "Failed to update quick reply" });
  }
});

// API endpoint to delete a quick reply
app.delete("/api/quick-replies/:id", async (req, res) => {
  try {
    const { id } = req.params;
    // Soft delete: set status to 'deleted'
    const result = await sqlDb.query(
      `UPDATE quick_replies SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Quick reply not found" });
    }
    res.json({ success: true, id });
  } catch (error) {
    console.error("Error deleting quick reply:", error);
    res.status(500).json({ error: "Failed to delete quick reply" });
  }
});

// API endpoint to get quick reply categories from settings
app.get("/api/quick-reply-categories", async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }
    const result = await sqlDb.query(
      `SELECT setting_value FROM settings WHERE company_id = $1 AND setting_type = 'quick_reply' AND setting_key = 'categories'`,
      [companyId]
    );
    if (result.rows.length === 0) {
      return res.json({ categories: [] });
    }
    res.json({ categories: result.rows[0].setting_value || [] });
  } catch (error) {
    console.error("Error fetching quick reply categories:", error);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// API endpoint to add a quick reply category
app.post("/api/quick-reply-categories", async (req, res) => {
  try {
    const { companyId, category } = req.body;
    if (!companyId || !category) {
      return res.status(400).json({ error: "companyId and category are required" });
    }
    // Get current categories
    const result = await sqlDb.query(
      `SELECT id, setting_value FROM settings WHERE company_id = $1 AND setting_type = 'quick_reply' AND setting_key = 'categories'`,
      [companyId]
    );
    let categories = [];
    let settingsId = null;
    if (result.rows.length > 0) {
      categories = result.rows[0].setting_value || [];
      settingsId = result.rows[0].id;
    }
    if (categories.includes(category)) {
      return res.status(409).json({ error: "Category already exists" });
    }
    categories.push(category);
    if (settingsId) {
      await sqlDb.query(
        `UPDATE settings SET setting_value = $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2`,
        [JSON.stringify(categories), settingsId]
      );
    } else {
      await sqlDb.query(
        `INSERT INTO settings (company_id, setting_type, setting_key, setting_value) VALUES ($1, 'quick_reply', 'categories', $2)`,
        [companyId, JSON.stringify(categories)]
      );
    }
    res.json({ success: true, categories });
  } catch (error) {
    console.error("Error adding quick reply category:", error);
    res.status(500).json({ error: "Failed to add category" });
  }
});

// API endpoint to edit a quick reply category
app.put("/api/quick-reply-categories", async (req, res) => {
  try {
    const { companyId, oldCategory, newCategory } = req.body;
    if (!companyId || !oldCategory || !newCategory) {
      return res.status(400).json({ error: "companyId, oldCategory, newCategory are required" });
    }
    const result = await sqlDb.query(
      `SELECT id, setting_value FROM settings WHERE company_id = $1 AND setting_type = 'quick_reply' AND setting_key = 'categories'`,
      [companyId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Categories not found" });
    }
    let categories = result.rows[0].setting_value || [];
    const idx = categories.indexOf(oldCategory);
    if (idx === -1) {
      return res.status(404).json({ error: "Old category not found" });
    }
    categories[idx] = newCategory;
    await sqlDb.query(
      `UPDATE settings SET setting_value = $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2`,
      [JSON.stringify(categories), result.rows[0].id]
    );
    res.json({ success: true, categories });
  } catch (error) {
    console.error("Error editing quick reply category:", error);
    res.status(500).json({ error: "Failed to edit category" });
  }
});

// API endpoint to delete a quick reply category
app.delete("/api/quick-reply-categories", async (req, res) => {
  try {
    const { companyId, category } = req.body;
    if (!companyId || !category) {
      return res.status(400).json({ error: "companyId and category are required" });
    }
    const result = await sqlDb.query(
      `SELECT id, setting_value FROM settings WHERE company_id = $1 AND setting_type = 'quick_reply' AND setting_key = 'categories'`,
      [companyId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Categories not found" });
    }
    let categories = result.rows[0].setting_value || [];
    categories = categories.filter((c) => c !== category);
    await sqlDb.query(
      `UPDATE settings SET setting_value = $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2`,
      [JSON.stringify(categories), result.rows[0].id]
    );
    res.json({ success: true, categories });
  } catch (error) {
    console.error("Error deleting quick reply category:", error);
    res.status(500).json({ error: "Failed to delete category" });
  }
});

// Get AI settings
app.get("/api/ai-settings", async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }
    const result = await sqlDb.query(
      `SELECT setting_key, setting_value 
       FROM settings 
       WHERE company_id = $1 AND setting_type = 'messaging' AND setting_key IN ('aiDelay', 'autoResponse')`,
      [companyId]
    );
    const settings = {};
    result.rows.forEach(row => {
      try {
        const parsed = typeof row.setting_value === "string"
          ? JSON.parse(row.setting_value)
          : row.setting_value;
        settings[row.setting_key] = parsed.value;
      } catch {
        settings[row.setting_key] = row.setting_value;
      }
    });
    res.json({ settings });
  } catch (error) {
    console.error("Error fetching AI settings:", error);
    res.status(500).json({ error: "Failed to fetch AI settings" });
  }
});

// Update AI settings
app.put("/api/ai-settings", async (req, res) => {
  try {
    const { companyId, settings } = req.body;
    if (!companyId || typeof settings !== "object" || !settings) {
      return res.status(400).json({ error: "companyId and settings object are required" });
    }
    const allowedKeys = ["aiDelay", "autoResponse"];
    const updates = [];
    for (const key of allowedKeys) {
      if (key in settings) {
        // First, check if the entry exists
        const checkResult = await sqlDb.query(
          `SELECT id FROM settings WHERE company_id = $1 AND setting_type = 'messaging' AND setting_key = $2`,
          [companyId, key]
        );
        if (checkResult.rows.length > 0) {
          // Exists, update
          updates.push(sqlDb.query(
            `UPDATE settings SET setting_value = $1, last_updated = CURRENT_TIMESTAMP
             WHERE company_id = $2 AND setting_type = 'messaging' AND setting_key = $3
             RETURNING setting_key, setting_value`,
            [JSON.stringify({ value: settings[key] }), companyId, key]
          ));
        } else {
          // Doesn't exist, insert
          updates.push(sqlDb.query(
            `INSERT INTO settings (company_id, setting_type, setting_key, setting_value, last_updated, created_at)
             VALUES ($1, 'messaging', $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING setting_key, setting_value`,
            [companyId, key, JSON.stringify({ value: settings[key] })]
          ));
        }
      }
    }
    const results = await Promise.all(updates);
    const responseSettings = {};
    results.forEach(r => {
      if (r.rows.length > 0) {
        const row = r.rows[0];
        try {
          const parsed = typeof row.setting_value === "string"
            ? JSON.parse(row.setting_value)
            : row.setting_value;
          responseSettings[row.setting_key] = parsed.value;
        } catch {
          responseSettings[row.setting_key] = row.setting_value;
        }
      }
    });
    res.json({ success: true, settings: responseSettings });
  } catch (error) {
    console.error("Error updating AI settings:", error);
    res.status(500).json({ error: "Failed to update AI settings" });
  }
});

// API endpoint to get company groups
app.get("/api/company-groups", async (req, res) => {
  try {
    const { companyId } = req.query;

    const result = await sqlDb.query(
      `SELECT DISTINCT emp_group AS group_name 
       FROM employees 
       WHERE company_id = $1 AND emp_group IS NOT NULL`,
      [companyId]
    );

    const groups = result.rows.map(row => row.group_name);
    res.json(groups);
  } catch (error) {
    console.error("Error fetching company groups:", error);
    res.status(500).json({ error: "Failed to fetch company groups" });
  }
});

app.post("/api/private-note", async (req, res) => {
  try {
    const { companyId, chatId, text, from, fromEmail } = req.body;
    if (!companyId || !chatId || !text || !from) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const numericChatId =
      chatId.startsWith("+") ? chatId : "+" + chatId.replace(/\D/g, "");

    const contactId =
      companyId + "-" + numericChatId.replace(/^\+/, "");

    const noteId = uuidv4();
    const timestamp = new Date();

    const insertNoteQuery = `
      INSERT INTO private_notes (
        id, company_id, contact_id, text, "from", from_email, timestamp, type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const noteResult = await sqlDb.query(insertNoteQuery, [
      noteId,
      companyId,
      contactId,
      text,
      from,
      fromEmail || "",
      timestamp,
      "privateNote",
    ]);
    const note = noteResult.rows[0];

    const insertMessageQuery = `
      INSERT INTO messages (
        message_id, company_id, contact_id, content, message_type,
        timestamp, direction, status, from_me, chat_id, author
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;
    await sqlDb.query(insertMessageQuery, [
      noteId,
      companyId,
      contactId,
      text,
      "privateNote",
      timestamp,
      "internal",
      "delivered",
      true,
      numericChatId,
      from,
    ]);

    const mentions = (text.match(/@\w+/g) || []).map((m) => m.slice(1));
    for (const employeeName of mentions) {
      await addNotificationToUser(companyId, text, employeeName);
    }

    res.json({
      success: true,
      note: {
        id: note.id,
        text: note.text,
        from: note.from,
        timestamp: note.timestamp,
        type: note.type,
      },
    });
  } catch (error) {
    console.error("Error adding private note:", error);
    res.status(500).json({ error: "Failed to add private note" });
  }
});

app.post("/api/company/update-stopbot", async (req, res) => {
  try {
    const { companyId, stopbot, phoneIndex } = req.body;
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required" });
    }
    if (typeof stopbot === "undefined" || typeof phoneIndex === "undefined") {
      return res.status(400).json({ error: "stopbot and phoneIndex are required" });
    }

    // Fetch current stopbots object
    const companyResult = await sqlDb.query(
      "SELECT stopbots FROM companies WHERE company_id = $1",
      [companyId]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: "Company not found" });
    }
    let stopbots = companyResult.rows[0].stopbots || {};

    // If stopbots is a string (from DB), parse it
    if (typeof stopbots === "string") {
      try {
        stopbots = JSON.parse(stopbots);
      } catch {
        stopbots = {};
      }
    }

    // Update the stopbots for the given phoneIndex
    stopbots[phoneIndex] = stopbot;

    // Update the company row
    const result = await sqlDb.query(
      `
        UPDATE companies
        SET stopbot = $1,
            stopbots = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $3
        RETURNING company_id, stopbot, stopbots
      `,
      [stopbot, JSON.stringify(stopbots), companyId]
    );

    res.json({
      success: true,
      message: "Company stopbot settings updated",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating stopbot:", error);
    res.status(500).json({ error: "Failed to update stopbot", details: error.message });
  }
});


// Get reminder settings
app.get("/api/reminder-settings", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get reminder settings from settings table
    const settingsResult = await sqlDb.getRow(
      "SELECT setting_value FROM settings WHERE company_id = $1 AND setting_type = 'config' AND setting_key = 'reminder'",
      [user.company_id]
    );

    let reminderSettings = [];
    if (settingsResult && settingsResult.setting_value) {
      reminderSettings = Array.isArray(settingsResult.setting_value) 
        ? settingsResult.setting_value 
        : [settingsResult.setting_value];
    } else {
      // Return default reminder settings
      reminderSettings = [{
        enabled: true,
        hours_before: 24,
        message_template: "Reminder: You have an appointment scheduled for {datetime}",
        selected_employees: [],
        recipient_type: "contacts"
      }];
    }

    res.json({
      company_id: user.company_id,
      reminders: reminderSettings
    });
  } catch (error) {
    console.error("Error fetching reminder settings:", error);
    res.status(500).json({ error: "Failed to fetch reminder settings" });
  }
});

// Update reminder settings
app.put("/api/reminder-settings", async (req, res) => {
  try {
    const { email, reminders } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    if (!Array.isArray(reminders)) {
      return res.status(400).json({ error: "Reminders must be an array" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if setting exists
    const existingSetting = await sqlDb.getRow(
      "SELECT id FROM settings WHERE company_id = $1 AND setting_type = 'config' AND setting_key = 'reminder'",
      [user.company_id]
    );

    if (existingSetting) {
      // Update existing setting
      await sqlDb.query(
        "UPDATE settings SET setting_value = $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2",
        [JSON.stringify(reminders), existingSetting.id]
      );
    } else {
      // Insert new setting
      await sqlDb.query(
        "INSERT INTO settings (company_id, setting_type, setting_key, setting_value, created_at, last_updated) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        [user.company_id, 'config', 'reminder', JSON.stringify(reminders)]
      );
    }

    res.json({
      company_id: user.company_id,
      reminders: reminders
    });
  } catch (error) {
    console.error("Error updating reminder settings:", error);
    res.status(500).json({ error: "Failed to update reminder settings" });
  }
});

// Get all appointments for a company
app.get("/api/appointments", async (req, res) => {
  try {
    const { email, employeeId } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let query = `
      SELECT 
        a.id,
        a.appointment_id,
        a.title,
        a.description as details,
        a.scheduled_time as "startTime",
        (a.scheduled_time + (COALESCE(a.duration_minutes, 60) * interval '1 minute')) as "endTime",
        a.status as "appointmentStatus",
        a.created_at as "dateAdded",
        a.metadata,
        a.staff_assigned as staff,
        c.name as contact_name,
        c.phone as contact_phone,
        c.email as contact_email,
        c.contact_id,
        '' as address,
        '#51484f' as color,
        '[]' as tags
      FROM appointments a
      LEFT JOIN contacts c ON a.contact_id = c.contact_id AND a.company_id = c.company_id
      WHERE a.company_id = $1
    `;
    
    const params = [user.company_id];
    
    if (employeeId) {
      query += ` AND (a.staff_assigned ? $2 OR a.metadata->'userEmail' = $2)`;
      params.push(employeeId);
    }
    
    query += ` ORDER BY a.scheduled_time DESC`;

    const result = await sqlDb.query(query, params);
    
    // Transform the data to match the calendar component's expected format
    const appointments = result.rows.map(appointment => ({
      id: appointment.id,
      title: appointment.title || 'Untitled Appointment',
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      address: appointment.address || '',
      appointmentStatus: appointment.appointmentStatus || 'scheduled',
      staff: appointment.staff || [],
      tags: [],
      color: appointment.color,
      dateAdded: appointment.dateAdded,
      contacts: appointment.contact_id ? [{
        id: appointment.contact_id,
        name: appointment.contact_name || 'Unknown',
        phone: appointment.contact_phone || '',
        email: appointment.contact_email || ''
      }] : [],
      details: appointment.details || '',
      meetLink: ''
    }));

    res.json({ appointments });
  } catch (error) {
    console.error("Error fetching appointments:", error);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
});

// Get appointment tags - redirecting to existing endpoint
app.get("/api/appointment-tags", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Redirect to the existing company tags endpoint
    const response = await fetch(`${req.protocol}://${req.get('host')}/api/companies/${user.company_id}/tags`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error fetching appointment tags:", error);
    res.status(500).json({ error: "Failed to fetch appointment tags" });
  }
});

app.get("/api/company-data-user", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const company = await sqlDb.getRow(
      "SELECT * FROM companies WHERE company_id = $1",
      [user.company_id]
    );

    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    res.json(company);
  } catch (error) {
    console.error("Error fetching company data:", error);
    res.status(500).json({ error: "Failed to fetch company data" });
  }
});

app.get("/api/employees", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Redirect to the existing user-context endpoint which includes employee data
    const response = await fetch(`${req.protocol}://${req.get('host')}/api/user-context?email=${encodeURIComponent(email)}`);
    const data = await response.json();
    
    // Extract and return employee information
    res.json({
      employees: data.employees || [],
      userRole: data.userRole,
      companyId: data.companyId
    });
  } catch (error) {
    console.error("Error fetching employees:", error);
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});

app.post("/api/send-whatsapp-notification", async (req, res) => {
  try {
    const { email, contacts, message, appointmentDetails } = req.body;
    
    if (!email || !contacts || !message) {
      return res.status(400).json({ error: "Email, contacts, and message are required" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const results = [];
    
    // Send notification to each contact
    for (const contact of contacts) {
      if (contact.phone) {
        try {
          // Clean phone number (remove any non-digit characters except +)
          const cleanPhone = contact.phone.replace(/[^\d+]/g, '');
          const chatId = cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`;
          
          // Use the existing v2 messages API
          const response = await fetch(`${req.protocol}://${req.get('host')}/api/v2/messages/text/${user.company_id}/${encodeURIComponent(chatId)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              message: message,
              phoneIndex: 0 // Default to first phone
            })
          });

          if (response.ok) {
            results.push({
              contact: contact.name || contact.phone,
              phone: contact.phone,
              status: 'sent',
              message: 'Notification sent successfully'
            });
          } else {
            results.push({
              contact: contact.name || contact.phone,
              phone: contact.phone,
              status: 'failed',
              message: 'Failed to send notification'
            });
          }
        } catch (error) {
          console.error(`Error sending notification to ${contact.phone}:`, error);
          results.push({
            contact: contact.name || contact.phone,
            phone: contact.phone,
            status: 'error',
            message: error.message
          });
        }
      } else {
        results.push({
          contact: contact.name || 'Unknown',
          phone: 'N/A',
          status: 'skipped',
          message: 'No phone number available'
        });
      }
    }

    res.json({
      success: true,
      message: 'Notification process completed',
      results: results
    });
  } catch (error) {
    console.error("Error sending WhatsApp notifications:", error);
    res.status(500).json({ error: "Failed to send WhatsApp notifications" });
  }
});

// Create appointment
app.post("/api/appointments", async (req, res) => {
  try {
    // Accept all fields from request body
    const requestData = { ...req.body };
    console.log('Received appointment request data:', requestData);
    
    // Extract userEmail for authentication
    const email = requestData.userEmail;
    if (!email) {
      return res.status(400).json({ error: "userEmail is required for authentication" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Define schema fields that map directly to database columns
    const schemaFields = {
      appointment_id: null,
      company_id: user.company_id,
      contact_id: null,
      title: null,
      description: null,
      scheduled_time: null,
      duration_minutes: null,
      status: 'scheduled', // default status
      metadata: {},
      staff_assigned: [],
      appointment_type: 'general' // default type
    };

    // Map common frontend field names to schema fields
    const fieldMappings = {
      // Frontend field -> Schema field
      startTime: 'scheduled_time',
      start_time: 'scheduled_time',
      endTime: null, // Will be used to calculate duration_minutes
      end_time: null, // Will be used to calculate duration_minutes
      details: 'description',
      description: 'description',
      appointmentStatus: 'status',
      appointmentType: 'appointment_type',
      staff: 'staff_assigned',
      contacts: 'contact_id' // Special handling needed
    };

    // Process each field from request
    const metadataFields = {};
    
    for (const [key, value] of Object.entries(requestData)) {
      if (key === 'userEmail') continue; // Skip auth field
      
      // Check if field has a direct mapping
      if (fieldMappings.hasOwnProperty(key)) {
        const mappedField = fieldMappings[key];
        if (mappedField) {
          schemaFields[mappedField] = value;
        }
        // Special handling for endTime/end_time to calculate duration
        if ((key === 'endTime' || key === 'end_time') && value && schemaFields.scheduled_time) {
          const startDate = new Date(schemaFields.scheduled_time);
          const endDate = new Date(value);
          schemaFields.duration_minutes = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60));
        }
      }
      // Check if field exists directly in schema
      else if (schemaFields.hasOwnProperty(key)) {
        schemaFields[key] = value;
      }
      // Everything else goes to metadata
      else {
        metadataFields[key] = value;
      }
    }

    // Handle contacts field - extract contact_id
    if (requestData.contacts) {
      if (Array.isArray(requestData.contacts) && requestData.contacts.length > 0) {
        schemaFields.contact_id = requestData.contacts[0].id || requestData.contacts[0].contact_id;
      } else if (typeof requestData.contacts === 'string') {
        schemaFields.contact_id = requestData.contacts;
      } else {
        schemaFields.contact_id = null;
      }
    }

    // Handle staff_assigned as JSON
    if (schemaFields.staff_assigned && !Array.isArray(schemaFields.staff_assigned)) {
      schemaFields.staff_assigned = [schemaFields.staff_assigned];
    }

    // Generate appointment_id if not provided
    if (!schemaFields.appointment_id) {
      schemaFields.appointment_id = require('crypto').randomUUID();
    }

    // Calculate duration if not set but we have start and end times
    if (!schemaFields.duration_minutes && schemaFields.scheduled_time && (requestData.endTime || requestData.end_time)) {
      const startDate = new Date(schemaFields.scheduled_time);
      const endDate = new Date(requestData.endTime || requestData.end_time);
      schemaFields.duration_minutes = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60));
    }

    // Validate required fields
    if (!schemaFields.title || !schemaFields.scheduled_time) {
      return res.status(400).json({ error: "title and scheduled_time (or startTime) are required" });
    }

    // Ensure contact_id is null if empty
    schemaFields.contact_id = schemaFields.contact_id && String(schemaFields.contact_id).trim() !== '' ? schemaFields.contact_id : null;

    // Merge additional metadata
    schemaFields.metadata = { ...metadataFields, ...schemaFields.metadata };

    console.log('Creating appointment with schema fields:', {
      appointment_id: schemaFields.appointment_id,
      company_id: schemaFields.company_id,
      contact_id: schemaFields.contact_id,
      title: schemaFields.title,
      appointment_type: schemaFields.appointment_type,
      status: schemaFields.status
    });

    const result = await sqlDb.query(`
      INSERT INTO appointments (
        appointment_id, company_id, contact_id, title, description, 
        scheduled_time, duration_minutes, status, metadata, staff_assigned, appointment_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      schemaFields.appointment_id,
      schemaFields.company_id,
      schemaFields.contact_id,
      schemaFields.title,
      schemaFields.description,
      schemaFields.scheduled_time,
      schemaFields.duration_minutes,
      schemaFields.status,
      JSON.stringify(schemaFields.metadata),
      JSON.stringify(schemaFields.staff_assigned),
      schemaFields.appointment_type
    ]);

    // Transform response to match calendar component expectations
    const appointment = result.rows[0];
    const transformedAppointment = {
      id: appointment.id,
      title: appointment.title,
      startTime: appointment.scheduled_time,
      endTime: appointment.duration_minutes ? 
        new Date(new Date(appointment.scheduled_time).getTime() + (appointment.duration_minutes * 60000)) : 
        appointment.scheduled_time,
      address: appointment.metadata?.location || appointment.metadata?.address || '',
      appointmentStatus: appointment.status,
      staff: appointment.staff_assigned || [],
      tags: appointment.metadata?.tags || [],
      color: appointment.metadata?.color || '#51484f',
      dateAdded: appointment.created_at,
      contacts: requestData.contacts || [],
      details: appointment.description || '',
      meetLink: appointment.metadata?.meetLink || '',
      appointmentType: appointment.appointment_type,
      ...appointment.metadata // Include all metadata fields in response
    };

    res.json(transformedAppointment);
  } catch (error) {
    console.error("Error creating appointment:", error);
    res.status(500).json({ error: "Failed to create appointment", details: error.message });
  }
});

// Update appointment
app.put("/api/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    // Accept all fields from request body
    const requestData = { ...req.body };
    console.log('Received appointment update request data:', requestData);

    // Extract userEmail for authentication
    const email = requestData.userEmail || requestData.email;
    if (!email) {
      return res.status(400).json({ error: "userEmail or email is required for authentication" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get existing appointment to merge metadata
    const existingAppointment = await sqlDb.getRow(
      "SELECT * FROM appointments WHERE id = $1 AND company_id = $2",
      [id, user.company_id]
    );
    
    if (!existingAppointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    // Define schema fields that map directly to database columns
    const updateFields = {};
    
    // Map common frontend field names to schema fields
    const fieldMappings = {
      startTime: 'scheduled_time',
      start_time: 'scheduled_time',
      endTime: null, // Will be used to calculate duration_minutes
      end_time: null, // Will be used to calculate duration_minutes
      details: 'description',
      description: 'description',
      appointmentStatus: 'status',
      appointmentType: 'appointment_type',
      staff: 'staff_assigned',
      contacts: 'contact_id' // Special handling needed
    };

    // Process each field from request
    const metadataFields = { ...(existingAppointment.metadata || {}) };
    let endTime = null;
    
    for (const [key, value] of Object.entries(requestData)) {
      if (key === 'userEmail' || key === 'email') continue; // Skip auth fields
      
      // Check if field has a direct mapping
      if (fieldMappings.hasOwnProperty(key)) {
        const mappedField = fieldMappings[key];
        if (mappedField) {
          updateFields[mappedField] = value;
        }
        // Store endTime for duration calculation
        if (key === 'endTime' || key === 'end_time') {
          endTime = value;
        }
      }
      // Check if field exists directly in schema
      else if (['appointment_id', 'contact_id', 'title', 'description', 'scheduled_time', 'duration_minutes', 'status', 'staff_assigned', 'appointment_type'].includes(key)) {
        updateFields[key] = value;
      }
      // Everything else goes to metadata
      else {
        metadataFields[key] = value;
      }
    }

    // Handle contacts field - extract contact_id
    if (requestData.contacts) {
      if (Array.isArray(requestData.contacts) && requestData.contacts.length > 0) {
        updateFields.contact_id = requestData.contacts[0].id || requestData.contacts[0].contact_id;
      } else if (typeof requestData.contacts === 'string') {
        updateFields.contact_id = requestData.contacts;
      } else {
        updateFields.contact_id = null;
      }
    }

    // Calculate duration if we have start time and end time
    if ((updateFields.scheduled_time || existingAppointment.scheduled_time) && endTime) {
      const startDate = new Date(updateFields.scheduled_time || existingAppointment.scheduled_time);
      const endDate = new Date(endTime);
      updateFields.duration_minutes = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60));
    }

    // Handle staff_assigned as JSON
    if (updateFields.staff_assigned && !Array.isArray(updateFields.staff_assigned)) {
      updateFields.staff_assigned = [updateFields.staff_assigned];
    }

    // Ensure contact_id is null if empty
    if (updateFields.contact_id !== undefined) {
      updateFields.contact_id = updateFields.contact_id && String(updateFields.contact_id).trim() !== '' ? updateFields.contact_id : null;
    }

    // Always update metadata with merged fields
    updateFields.metadata = metadataFields;

    // Build the update query dynamically
    const updateFieldsArray = [];
    const updateValues = [];
    let paramIndex = 1;

    for (const [field, value] of Object.entries(updateFields)) {
      updateFieldsArray.push(`${field} = $${paramIndex++}`);
      if (field === 'metadata' || field === 'staff_assigned') {
        updateValues.push(JSON.stringify(value));
      } else {
        updateValues.push(value);
      }
    }

    if (updateFieldsArray.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updateValues.push(id, user.company_id);

    console.log('Updating appointment with fields:', Object.keys(updateFields));

    const result = await sqlDb.query(`
      UPDATE appointments SET
        ${updateFieldsArray.join(', ')}
      WHERE id = $${paramIndex++} AND company_id = $${paramIndex++}
      RETURNING *
    `, updateValues);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    // Transform response to match calendar component expectations
    const appointment = result.rows[0];
    const transformedAppointment = {
      id: appointment.id,
      title: appointment.title,
      startTime: appointment.scheduled_time,
      endTime: appointment.duration_minutes ? 
        new Date(new Date(appointment.scheduled_time).getTime() + (appointment.duration_minutes * 60000)) : 
        appointment.scheduled_time,
      address: appointment.metadata?.location || appointment.metadata?.address || '',
      appointmentStatus: appointment.status,
      staff: appointment.staff_assigned || [],
      tags: appointment.metadata?.tags || [],
      color: appointment.metadata?.color || '#51484f',
      dateAdded: appointment.created_at,
      contacts: requestData.contacts || [],
      details: appointment.description || '',
      meetLink: appointment.metadata?.meetLink || '',
      appointmentType: appointment.appointment_type,
      ...appointment.metadata // Include all metadata fields in response
    };

    res.json(transformedAppointment);
  } catch (error) {
    console.error("Error updating appointment:", error);
    res.status(500).json({ error: "Failed to update appointment", details: error.message });
  }
});

// Get specific appointment
app.get("/api/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const appointment = await sqlDb.getRow(`
      SELECT 
        a.*,
        c.name as contact_name, 
        c.phone as contact_phone,
        c.email as contact_email,
        c.contact_id
      FROM appointments a
      LEFT JOIN contacts c ON a.contact_id = c.contact_id AND a.company_id = c.company_id
      WHERE a.id = $1 AND a.company_id = $2
    `, [id, user.company_id]);

    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    // Transform response to match calendar component expectations
    const transformedAppointment = {
      id: appointment.id,
      title: appointment.title,
      startTime: appointment.scheduled_time,
      endTime: new Date(new Date(appointment.scheduled_time).getTime() + (appointment.duration_minutes * 60000)),
      address: appointment.metadata?.location || '',
      appointmentStatus: appointment.status,
      staff: appointment.staff_assigned || [],
      tags: appointment.metadata?.tags || [],
      color: '#51484f',
      dateAdded: appointment.created_at,
      contacts: appointment.contact_id ? [{
        id: appointment.contact_id,
        name: appointment.contact_name || 'Unknown',
        phone: appointment.contact_phone || '',
        email: appointment.contact_email || ''
      }] : [],
      details: appointment.description || '',
      meetLink: ''
    };

    res.json(transformedAppointment);
  } catch (error) {
    console.error("Error fetching appointment:", error);
    res.status(500).json({ error: "Failed to fetch appointment" });
  }
});

// Delete appointment
app.delete("/api/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const result = await sqlDb.query(
      "DELETE FROM appointments WHERE id = $1 AND company_id = $2 RETURNING appointment_id",
      [id, user.company_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    res.json({ success: true, message: "Appointment deleted successfully" });
  } catch (error) {
    console.error("Error deleting appointment:", error);
    res.status(500).json({ error: "Failed to delete appointment" });
  }
});

// Get calendar configuration
app.get("/api/calendar-config", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get calendar config from settings table
    const settingsResult = await sqlDb.getRow(
      "SELECT setting_value FROM settings WHERE company_id = $1 AND setting_type = 'config' AND setting_key = 'calendar'",
      [user.company_id]
    );

    let calendarConfig = {
      calendarId: "",
      additionalCalendarIds: [],
      startHour: 11,
      endHour: 21,
      slotDuration: 30,
      daysAhead: 3
    };

    if (settingsResult && settingsResult.setting_value) {
      // Parse the existing config or use defaults
      const existingConfig = typeof settingsResult.setting_value === 'string' 
        ? JSON.parse(settingsResult.setting_value) 
        : settingsResult.setting_value;
      
      calendarConfig = { ...calendarConfig, ...existingConfig };
    }

    res.json({
      company_id: user.company_id,
      ...calendarConfig
    });
  } catch (error) {
    console.error("Error fetching calendar config:", error);
    res.status(500).json({ error: "Failed to fetch calendar config" });
  }
});

// Update calendar configuration
app.put("/api/calendar-config", async (req, res) => {
  try {
    const { email, config: { calendarId, additionalCalendarIds, startHour, endHour, slotDuration, daysAhead } } = req.body;
    console.log("Updating calendar config with:", req.body);
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const calendarConfig = {
      calendarId: calendarId || "",
      additionalCalendarIds: additionalCalendarIds || [],
      startHour: startHour || 11,
      endHour: endHour || 21,
      slotDuration: slotDuration || 30,
      daysAhead: daysAhead || 3
    };
    console.log("Updating calendar config with:", calendarConfig);

    // Check if setting exists
    const existingSetting = await sqlDb.getRow(
      "SELECT id FROM settings WHERE company_id = $1 AND setting_type = 'config' AND setting_key = 'calendar'",
      [user.company_id]
    );

    if (existingSetting) {
      // Update existing setting
      await sqlDb.query(
        "UPDATE settings SET setting_value = $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2",
        [JSON.stringify(calendarConfig), existingSetting.id]
      );
    } else {
      // Insert new setting
      await sqlDb.query(
        "INSERT INTO settings (company_id, setting_type, setting_key, setting_value, created_at, last_updated) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        [user.company_id, 'config', 'calendar', JSON.stringify(calendarConfig)]
      );
    }

    res.json({
      company_id: user.company_id,
      ...calendarConfig
    });
  } catch (error) {
    console.error("Error updating calendar config:", error);
    res.status(500).json({ error: "Failed to update calendar config" });
  }
});

// Create expense
app.post("/api/expenses", async (req, res) => {
  try {
    const {
      email,
      appointment_id,
      amount,
      description,
      category,
      date
    } = req.body;

    if (!email || !appointment_id || !amount) {
      return res.status(400).json({ error: "Email, appointment_id, and amount are required" });
    }

    const user = await sqlDb.getRow("SELECT company_id FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const result = await sqlDb.query(`
      INSERT INTO expenses (
        company_id, appointment_id, amount, description, category, date, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      RETURNING *
    `, [user.company_id, appointment_id, amount, description, category, date]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error creating expense:", error);
    res.status(500).json({ error: "Failed to create expense" });
  }
});