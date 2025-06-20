require("dotenv").config();
const { Client, LocalAuth, RemoteAuth } = require("whatsapp-web.js");
const { Queue, Worker, QueueScheduler } = require("bullmq");
const Redis = require("ioredis");
const { google } = require("googleapis");
const moment = require("moment-timezone");
const cron = require("node-cron");
const schedule = require("node-schedule");
//const qrcode = require('qrcode-terminal');
const FirebaseWWebJS = require("./firebaseWweb.js");
const qrcode = require("qrcode");
const express = require("express");
const bodyParser = require("body-parser");
const csv = require("csv-parser");
const fetch = require("node-fetch");
const cors = require("cors");
const app = express();
const admin = require("./firebase.js");
const axios = require("axios");
const WebSocket = require("ws");

const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server });
const db = admin.firestore();
const OpenAI = require("openai");
const { MessageMedia } = require("whatsapp-web.js");

const util = require("util"); // We'll use this to promisify fs functions
const fs = require("fs"); // Add this line for synchronous fs functions

const path = require("path");
const stream = require("stream");
const { promisify } = require("util");
const pipeline = promisify(stream.pipeline);
const os = require("os");
const { exec } = require("child_process");
const url = require("url");
const ffmpeg = require("ffmpeg-static");
const execPromise = util.promisify(exec);
const CryptoJS = require("crypto-js");
const AutomatedMessaging = require("./blast/automatedMessaging");
const qrcodeTerminal = require("qrcode-terminal");
const sqlDb = require("./db");
const { v4: uuidv4 } = require("uuid");
// Add this near the top of the file, after your require statements
require("events").EventEmitter.defaultMaxListeners = 100; // Increase from 70
require("events").EventEmitter.prototype._maxListeners = 100; // Increase from 70
require("events").defaultMaxListeners = 100; // Increase from 70

const { neon, neonConfig } = require("@neondatabase/serverless");
const { Pool } = require("pg");

// Configure Neon for WebSocket pooling
neonConfig.webSocketConstructor = require("ws");

// For direct SQL queries (single connection)
const sql = neon(process.env.DATABASE_URL);

// For connection pooling (multiple concurrent connections)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2000,
});

const botMap = new Map();
// Redis connection
const connection = new Redis(process.env.REDIS_URL || "redis://redis:6379", {
  maxRetriesPerRequest: null,
  maxmemoryPolicy: "noeviction",
});
const openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
});

require("events").EventEmitter.prototype._maxListeners = 70;
require("events").defaultMaxListeners = 70;

// Initialize the Google Sheets API
const auth = new google.auth.GoogleAuth({
  keyFile: "service_account.json", // Replace with the path to your Google API credentials file
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

// Promisify the fs.readFile and fs.writeFile functions
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

//Save last processed row
const LAST_PROCESSED_ROW_FILE = "last_processed_row.json";

// Create a queue
const messageQueue = new Queue("scheduled-messages", { connection });

// Ensure this directory exists in your project
const MEDIA_DIR = path.join(__dirname, "public", "media");

// Function to save media locally
async function saveMediaLocally(base64Data, mimeType, filename) {
  const writeFileAsync = util.promisify(fs.writeFile);
  const buffer = Buffer.from(base64Data, "base64");
  const uniqueFilename = `${uuidv4()}_${filename}`;
  const filePath = path.join(MEDIA_DIR, uniqueFilename);

  await writeFileAsync(filePath, buffer);

  // Return the URL path to access this filez
  return `/media/${uniqueFilename}`;
}

// Add this new API endpoint
app.get("/api/bot-status/:companyId", async (req, res) => {
  const { companyId } = req.params;
  console.log("Calling bot-status");

  // Add CORS headers explicitly
  res.header("Access-Control-Allow-Origin", "http://localhost:5173");
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
      return res.status(404).json({ error: "Company not found" });
    }

    // Then get the bot status
    const botData = botMap.get(companyId);

    if (botData && Array.isArray(botData)) {
      if (botData.length === 1) {
        // Single phone
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
          }
        }

        res.json({
          status,
          qrCode,
          phoneInfo,
          companyId,
          v2: companyData.v2,
          trialEndDate: companyData.trial_end_date,
          apiUrl: companyData.api_url,
          phoneCount: companyData.phone_count,
        });
      } else {
        // Multiple phones
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
              }
            }

            return {
              phoneIndex: index,
              status: phone.status,
              qrCode: phone.qrCode,
              phoneInfo,
            };
          })
        );

        res.json({
          phones: statusArray,
          companyId,
          v2: companyData.v2,
          trialEndDate: companyData.trial_end_date,
          apiUrl: companyData.api_url,
          phoneCount: companyData.phone_count,
        });
      }
    } else {
      // Bot not initialized yet
      res.json({
        status: "initializing",
        qrCode: null,
        phoneInfo: null,
        companyId,
        v2: companyData.v2,
        trialEndDate: companyData.trial_end_date,
        apiUrl: companyData.api_url,
        phoneCount: companyData.phone_count,
      });
    }
  } catch (error) {
    console.error(`Error getting status for company ${companyId}:`, error);
    res.status(500).json({ error: "Failed to get status" });
  }
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
  ws.pathname = req.url.startsWith("/status") ? "/status" : "/ws";
  ws.companyId = companyId;

  // Handle messages from client
  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

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
    console.log(`WebSocket closed for ${email}`);
  });
});

// Add this helper function for retrying deletion
async function deleteWithRetry(path, maxRetries = 5, delayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Use rimraf command through cmd for Windows
      if (process.platform === "win32") {
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
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
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
app.get("/api/cleanup-scheduled", async (req, res) => {
  try {
    const deletedMessages = [];
    const errors = [];

    // Get all companies
    const companiesSnapshot = await db.collection("companies").get();

    for (const companyDoc of companiesSnapshot.docs) {
      const companyId = companyDoc.id;

      // Skip if companyId is invalid
      if (!companyId || typeof companyId !== "string") {
        console.log("Skipping invalid companyId:", companyId);
        continue;
      }

      try {
        // Get all contacts and their tags for this company
        const contactsSnapshot = await db
          .collection("companies")
          .doc(companyId)
          .collection("contacts")
          .get();

        // Create a set of all tags from all contacts
        const allContactTags = new Set();
        contactsSnapshot.docs.forEach((doc) => {
          const contactTags = doc.data()?.tags || [];
          contactTags.forEach((tag) => {
            if (tag && typeof tag === "string") {
              allContactTags.add(tag);
            }
          });
        });

        // Get the company's scheduled messages
        const scheduledMessagesSnapshot = await db
          .collection("companies")
          .doc(companyId)
          .collection("scheduledMessages")
          .get();

        for (const messageDoc of scheduledMessagesSnapshot.docs) {
          const messageId = messageDoc.id;
          const message = messageDoc.data();

          // Check if message's trigger tags exist in any contact's tags
          const messageTriggerTags = message?.triggerTags || [];
          const hasMatchingTag = messageTriggerTags.some(
            (tag) => tag && typeof tag === "string" && allContactTags.has(tag)
          );

          // If no contact has any of the message's trigger tags, delete the message
          if (!hasMatchingTag) {
            try {
              // Remove jobs from the queue
              const jobs = await messageQueue.getJobs([
                "active",
                "waiting",
                "delayed",
                "paused",
              ]);
              for (const job of jobs) {
                if (job.id.startsWith(messageId)) {
                  await job.remove();
                }
              }

              // Delete batches
              const batchesSnapshot = await messageDoc.ref
                .collection("batches")
                .get();
              const batch = db.batch();
              batchesSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
              batch.delete(messageDoc.ref);
              await batch.commit();

              deletedMessages.push({
                companyId,
                messageId,
                triggerTags: messageTriggerTags,
                scheduledTime: message.scheduledTime?.toDate(),
              });
            } catch (error) {
              errors.push({
                companyId,
                messageId,
                triggerTags: messageTriggerTags,
                error: error.message,
              });
            }
          }
        }
      } catch (companyError) {
        errors.push({
          companyId,
          error: `Error processing company: ${companyError.message}`,
        });
        continue; // Skip to next company if there's an error
      }
    }

    res.json({
      success: true,
      deletedCount: deletedMessages.length,
      deletedMessages,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error cleaning up scheduled messages:", error);
    res.status(500).json({
      success: false,
      error: error.message,
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
  console.log("Broadcasting auth status:", { botName, status, qrCode, i });
  console.log("Number of connected clients:", wss.clients.size);

  wss.clients.forEach((client) => {
    try {
      if (client.readyState === WebSocket.OPEN) {
        console.log("Client state:", {
          pathname: client.pathname,
          companyId: botName,
          readyState: client.readyState,
        });

        if (client.pathname === "/status") {
          console.log("Sending to status monitor client");
          const message = JSON.stringify({
            type: "status_update",
            botName,
            status,
            qrCode: status === "qr" ? qrCode : null,
            phoneIndex: i,
          });
          client.send(message);
        } else if (client.companyId === botName) {
          console.log("Sending to company client");
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

const {
  handleNewMessagesTemplateWweb,
} = require("./bots/handleMessagesTemplateWweb.js");

const { handleTagFollowUp } = require("./blast/tag.js");
const { chat } = require("googleapis/build/src/apis/chat/index.js");

// Set JSON body parser with a limit
app.use(express.json({ limit: "50mb" }));

// Create a CORS configuration object
const corsOptions = {
  origin: true, // Allow all origins in development
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "ngrok-skip-browser-warning",
  ],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle OPTIONS preflight for all routes
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:5173");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  res.sendStatus(204);
});
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve static files from the 'public' directory
app.use(express.static("public"));

app.get("/", function (req, res) {
  res.send("Bot is running");
});

app.get("/logs", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "logs.html"));
});
app.get("/status", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "status.html"));
});
app.get("/queue", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "queue.html"));
});

//webhooks/blast
app.post("/extremefitness/blast", async (req, res) => {
  const botData = botMap.get("074");

  if (!botData) {
    return res
      .status(404)
      .json({ error: "WhatsApp client not found for this company" });
  }

  const client = botData[0].client;
  await handleExtremeFitnessBlast(req, res, client);
});
app.post("/hajoon/blast", async (req, res) => {
  const botData = botMap.get("045");

  if (!botData) {
    return res
      .status(404)
      .json({ error: "WhatsApp client not found for this company" });
  }

  const client = botData[0].client;
  await handleHajoonCreateContact(req, res, client);
});
app.post("/juta/blast", async (req, res) => {
  const botData = botMap.get("001");

  if (!botData) {
    return res
      .status(404)
      .json({ error: "WhatsApp client not found for this company" });
  }

  const client = botData[0].client;
  await handleJutaCreateContact(req, res, client);
});

app.post("/constantco/blast", async (req, res) => {
  const botData = botMap.get("0148");

  if (!botData) {
    return res
      .status(404)
      .json({ error: "WhatsApp client not found for this company" });
  }

  const client = botData[0].client;
  await handleConstantCoCreateContact(req, res, client);
});

app.post("/zahin/hubspot", async (req, res) => {
  const getClient = () => {
    const botData = botMap.get("042");
    return botData ? botData[0].client : null;
  };
  handleZahinHubspot(req, res, getClient);
});

app.post("/api/bina/tag", async (req, res) => {
  await handleBinaTag(req, res);
});
app.post("/api/edward/tag", async (req, res) => {
  await handleEdwardTag(req, res);
});
app.post("/api/tag/followup", async (req, res) => {
  await handleTagFollowUp(req, res);
});

//custom bots
const customHandlers = {};

const port = process.env.PORT;
server.listen(port, function () {
  console.log(`Server is running on port ${port}`);
});
app.post("/zakat", async (req, res) => {
  try {
    // Your existing logging code...
    //console.log('=== New Zakat Form Submission ===');
    // console.log('Webhook Body:', JSON.stringify(req.body, null, 2));

    // Get the WhatsApp client
    const botData = botMap.get("0124"); // Make sure you have initialized this bot
    if (!botData) {
      throw new Error("WhatsApp client not found for zakat");
    }
    const client = botData[0].client;

    // Handle the blast message
    await handleZakatBlast(req, res, client);
  } catch (error) {
    console.error("Error processing zakat form:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
// Add this near other cron jobs
let dailyReportCron = null;

// Add this API endpoint
app.post("/api/daily-report/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const { enabled, time, groupId } = req.body; // time format: "HH:mm"

  try {
    // Get reference to company settings
    const settingsRef = db
      .collection("companies")
      .doc(companyId)
      .collection("settings")
      .doc("reporting");

    if (enabled) {
      // Validate required fields
      if (!time || !groupId) {
        return res.status(400).json({
          success: false,
          error: "Time and groupId are required when enabling reports",
        });
      }

      // Save settings to Firebase
      await settingsRef.set(
        {
          dailyReport: {
            enabled: true,
            time,
            groupId,
            lastRun: null,
          },
        },
        { merge: true }
      );

      // Stop existing cron if running
      if (dailyReportCron) {
        dailyReportCron.stop();
      }

      // Start new cron job
      const [hour, minute] = time.split(":");
      dailyReportCron = cron.schedule(`${minute} ${hour}   `, async () => {
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
            "dailyReport.lastRun": admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (error) {
          console.error("Error sending daily report:", error);
        }
      });

      res.json({
        success: true,
        message: "Daily report enabled",
        nextRun: `${hour}:${minute}`,
      });
    } else {
      // Disable reporting
      if (dailyReportCron) {
        dailyReportCron.stop();
        dailyReportCron = null;
      }

      await settingsRef.set(
        {
          dailyReport: {
            enabled: false,
            time: null,
            groupId: null,
          },
        },
        { merge: true }
      );

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

// Helper function to count today's leads
async function countTodayLeads(companyId) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const contactsRef = db
      .collection("companies")
      .doc(companyId)
      .collection("contacts");
    const snapshot = await contactsRef.where("createdAt", ">=", today).get();

    return snapshot.size;
  } catch (error) {
    console.error("Error counting leads:", error);
    return 0;
  }
}
app.get("/api/check-constantco-spreadsheet", async (req, res) => {
  try {
    // Get the spreadsheet handler instance
    const constantcoSpreadsheet = require("./spreadsheet/constantcoSpreadsheet");
    const spreadsheetHandler = new constantcoSpreadsheet(botMap);

    // Run the check
    await spreadsheetHandler.checkAndProcessNewRows();

    res.json({
      success: true,
      message: "Spreadsheet check triggered successfully",
    });
  } catch (error) {
    console.error("Error triggering spreadsheet check:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
// Add this endpoint to manually trigger a report
app.post("/api/daily-report/:companyId/trigger", async (req, res) => {
  const { companyId } = req.params;

  try {
    const settingsRef = db
      .collection("companies")
      .doc(companyId)
      .collection("settings")
      .doc("reporting");
    const settings = await settingsRef.get();

    if (!settings.exists || !settings.data()?.dailyReport?.enabled) {
      return res.status(400).json({
        success: false,
        error: "Daily reporting is not enabled for this company",
      });
    }

    const { groupId } = settings.data().dailyReport;
    const botData = botMap.get(companyId);

    if (!botData || !botData[0]?.client) {
      throw new Error("WhatsApp client not found");
    }

    const count = await countTodayLeads(companyId);
    const message = `📊 Daily Lead Report (Manual Trigger)\n\nNew Leads Today: ${count}\nDate: ${new Date().toLocaleDateString()}`;

    await botData[0].client.sendMessage(groupId, message);

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
async function createUserInFirebase(userData) {
  try {
    const userRecord = await admin.auth().createUser(userData);

    return userRecord.uid;
  } catch (error) {
    throw error;
  }
}
app.get("/assignments", async (req, res) => {
  try {
    const companyId = "072";

    // Calculate yesterday's date range
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    // Get all assignments from yesterday
    const assignmentsRef = db
      .collection("companies")
      .doc(companyId)
      .collection("assignments")
      .where("timestamp", ">=", yesterday)
      .where("timestamp", "<=", endOfYesterday);

    const assignmentsSnapshot = await assignmentsRef.get();

    // Count assignments per employee
    const employeeAssignments = {};

    assignmentsSnapshot.forEach((doc) => {
      const data = doc.data();
      const employeeName = data.assigned;

      if (!employeeAssignments[employeeName]) {
        employeeAssignments[employeeName] = {
          count: 0,
          email: data.email || null,
          numbers: [],
        };
      }

      employeeAssignments[employeeName].count++;
      employeeAssignments[employeeName].numbers.push(data.number);
    });

    // Format the response
    const response = Object.entries(employeeAssignments).map(
      ([name, data]) => ({
        name,
        email: data.email,
        assignmentCount: data.count,
        numbers: data.numbers,
      })
    );

    res.json({
      success: true,
      date: yesterday.toISOString().split("T")[0],
      totalAssignments: assignmentsSnapshot.size,
      assignments: response,
    });
  } catch (error) {
    console.error("Error fetching assignment counts:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch assignment counts",
      message: error.message,
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
    const { uid, email, phoneNumber, password, displayName } = req.body;
    const user = await admin.auth().getUserByEmail(uid);
    if (!uid) {
      return res.status(400).json({ error: "UID is required" });
    }

    // Call the function to update the user

    await admin.auth().updateUser(user.uid, {
      email: email,
      phoneNumber: phoneNumber,
      password: password,
      displayName: displayName,
    });

    // Send success response
    res.json({ message: "User updated successfully" });
  } catch (error) {
    // Handle other errors
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
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
app.post(
  "/api/create-user/:email/:phoneNumber/:password/:role",
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
      };
      const name = decodedEmail.split("@")[0];
      // Create user in Neon Auth (only required fields)
      // Create user in Neon Auth
      const neonUser = await createNeonAuthUser(decodedEmail, name);

      // Generate a unique user ID and company ID
      const userId = uuidv4();
      const companyId = `0${Date.now()}`;

      // Create company in database
      await sqlDb.query(
        `INSERT INTO companies (company_id, name, email, phone, status, enabled, created_at) 
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [
          companyId,
          userData.email.split("@")[0],
          userData.email,
          userData.phoneNumber,
          "active",
          true,
        ]
      );

      await sqlDb.query(
        `INSERT INTO users (user_id, company_id, email, phone, role, active, created_at, password) 
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7)`,
        [
          userId,
          companyId,
          userData.email,
          userData.phoneNumber,
          userData.role,
          true,
          userData.password,
        ]
      );
      res.json({
        message: "User created successfully",
        userId,
        companyId,
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
          // Continue processing other rows
        }
      })
      .on("end", () => {
        console.log("CSV file successfully processed");
        resolve();
      })
      .on("error", reject);
  });
}

// Update the processContact function to use the provided tags
async function processContact(row, companyId, tags) {
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
    //  console.log("Saving contact with no name and phone ", phone)
  } else {
    // console.log("Saving contact with name ", name, " and phone ", phone)
  }

  let phoneWithPlus = phone.startsWith("+") ? phone : "+" + phone;
  const phoneWithoutPlus = phone.replace("+", "");

  if (phone) {
    const contactRef = db
      .collection("companies")
      .doc(companyId)
      .collection("contacts")
      .doc(phoneWithPlus);
    const doc = await contactRef.get();

    if (doc.exists) {
      // Contact already exists, add new tags and update zakat data
      const updateData = {
        tags: admin.firestore.FieldValue.arrayUnion(...tags),
      };

      if (companyId === "0124") {
        updateData.zakatData = admin.firestore.FieldValue.arrayUnion(
          createZakatData(row)
        );
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
          id: phoneWithoutPlus + "@c.us",
          name: name,
          not_spam: true,
          tags: tags,
          timestamp: Date.now(),
          type: "contact",
          unreadCount: 0,
          last_message: null,
        },
        chat_id: phoneWithoutPlus + "@c.us",
        city: null,
        phoneIndex: 0,
        companyName: null,
        contactName: name,
        threadid: "",
        last_message: null,
      };

      if (companyId === "079") {
        contactData.branch = row["BRANCH NAME"] || "-";
        contactData.address1 = row["ADDRESS"] || "-";
        contactData.expiryDate = row["PERIOD OF COVER"] || "-";
        contactData.email = row["EMAIL"] || "-";
        contactData.vehicleNumber = row["VEH. NO"] || "-";
        contactData.ic = row["IC/PASSPORT/BUSINESS REG. NO"] || "-";
      } else if (companyId === "0124") {
        // Common fields
        contactData.address1 =
          `${row["Alamat Penuh (Jalan)"]} ${row["Alamat Penuh (Address Line 2)"]}`.trim();
        contactData.city = row["Alamat Penuh (Bandar)"] || null;
        contactData.state = row["Alamat Penuh (Negeri)"] || null;
        contactData.postcode = row["Alamat Penuh (Poskod)"] || null;
        contactData.email = row["Emel"] || null;
        contactData.ic = row["No. Kad Pengenalan ( tanpa '-' )"] || null;

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

// Add priority levels at the top of your file
const PRIORITY = {
  CRITICAL: 1, // Highest priority
  HIGH: 2,
  NORMAL: 3,
  LOW: 4,
  BULK: 5, // Lowest priority
};

// Add timezone handling and validation
app.post("/api/schedule-message/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const scheduledMessage = req.body;
  const phoneIndex = scheduledMessage.phoneIndex || 0;
  console.log("Received scheduling request:", {
    companyId,
    messageFormat: scheduledMessage.message ? "single" : "sequence",
    hasAdditionalMessages: Boolean(scheduledMessage.messages?.length),
    infiniteLoop: Boolean(scheduledMessage.infiniteLoop),
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

    if (
      scheduledMessage.messages &&
      Array.isArray(scheduledMessage.messages) &&
      scheduledMessage.messages.length > 0
    ) {
      // If we have an array of messages, use those
      scheduledMessage.chatIds.forEach((chatId) => {
        scheduledMessage.messages.forEach((msg, index) => {
          processedMessages.push({
            chatId: chatId,
            message: msg.text || "",
            delay: scheduledMessage.messageDelays?.[index] || 0,
            phoneIndex: phoneIndex,
          });
        });
      });
    } else {
      // Otherwise use the single message field
      processedMessages = scheduledMessage.chatIds.map((chatId) => ({
        chatId: chatId,
        message: scheduledMessage.message || "",
        phoneIndex: phoneIndex,
        delay: 0,
      }));
    }

    console.log("Processed messages:", {
      totalMessages: processedMessages.length,
      sampleMessage: processedMessages[0],
    });

    // Calculate batches
    const totalMessages = processedMessages.length;
    const batchSize = scheduledMessage.batchQuantity || totalMessages;
    const numberOfBatches = Math.ceil(totalMessages / batchSize);

    // Create batches and save them to Firebase
    const batchesRef = db
      .collection("companies")
      .doc(companyId)
      .collection("scheduledMessages")
      .doc(messageId)
      .collection("batches");
    const batches = [];

    for (let batchIndex = 0; batchIndex < numberOfBatches; batchIndex++) {
      const startIndex = batchIndex * batchSize;
      const endIndex = Math.min((batchIndex + 1) * batchSize, totalMessages);
      const batchMessages = processedMessages.slice(startIndex, endIndex);

      const batchDelay =
        batchIndex *
        scheduledMessage.repeatInterval *
        getMillisecondsForUnit(scheduledMessage.repeatUnit);
      const batchScheduledTime = new Date(
        scheduledMessage.scheduledTime.toDate().getTime() + batchDelay
      );

      const batchData = {
        ...scheduledMessage,
        messages: batchMessages,
        batchIndex,
        batchScheduledTime:
          admin.firestore.Timestamp.fromDate(batchScheduledTime),
        // Add sequence-specific settings
        infiniteLoop: scheduledMessage.infiniteLoop || false,
        messageDelays: scheduledMessage.messageDelays || [],
        // Existing settings
        minDelay: scheduledMessage.minDelay || null,
        maxDelay: scheduledMessage.maxDelay || null,
        activateSleep: scheduledMessage.activateSleep || false,
        sleepAfterMessages: scheduledMessage.activateSleep
          ? scheduledMessage.sleepAfterMessages
          : null,
        sleepDuration: scheduledMessage.activateSleep
          ? scheduledMessage.sleepDuration
          : null,
        activeHours: scheduledMessage.activeHours || null,
      };

      // Remove unnecessary fields
      delete batchData.chatIds;
      delete batchData.message;

      const batchId = `${messageId}_batch_${batchIndex}`;
      await batchesRef.doc(batchId).set(batchData);
      batches.push({ id: batchId, scheduledTime: batchScheduledTime });
    }

    // Save the main scheduled message document
    const mainMessageData = {
      ...scheduledMessage,
      numberOfBatches,
      status: "scheduled",
      infiniteLoop: scheduledMessage.infiniteLoop || false,
      messageDelays: scheduledMessage.messageDelays || [],
      minDelay: scheduledMessage.minDelay || null,
      maxDelay: scheduledMessage.maxDelay || null,
      activateSleep: scheduledMessage.activateSleep || false,
      sleepAfterMessages: scheduledMessage.activateSleep
        ? scheduledMessage.sleepAfterMessages
        : null,
      sleepDuration: scheduledMessage.activateSleep
        ? scheduledMessage.sleepDuration
        : null,
      activeHours: scheduledMessage.activeHours || null,
    };

    await db
      .collection("companies")
      .doc(companyId)
      .collection("scheduledMessages")
      .doc(messageId)
      .set(mainMessageData);

    // Schedule all batches in the company-specific queue
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

    // Get queue status for logging
    const queueStatus = await queue.getJobCounts();
    console.log(`Queue status for company ${companyId}:`, queueStatus);

    res.status(201).json({
      id: messageId,
      message: "Message scheduled successfully",
      batches: batches.length,
      success: true,
      queueStatus,
    });
  } catch (error) {
    console.error("Error scheduling message:", error);
    res.status(500).json({ error: "Failed to schedule message" });
  }
});

app.put("/api/schedule-message/:companyId/:messageId", async (req, res) => {
  const { companyId, messageId } = req.params;
  const updatedMessage = req.body;
  const phoneIndex = updatedMessage.phoneIndex || 0;
  console.log("Received update request:", {
    companyId,
    messageId,
    messageFormat: updatedMessage.message ? "single" : "sequence",
    hasAdditionalMessages: Boolean(updatedMessage.messages?.length),
    infiniteLoop: Boolean(updatedMessage.infiniteLoop),
  });

  try {
    // Delete existing jobs and batches
    const jobs = await messageQueue.getJobs([
      "active",
      "waiting",
      "delayed",
      "paused",
    ]);
    for (const job of jobs) {
      if (job.id.startsWith(messageId)) {
        await job.remove();
      }
    }

    // Process chatIds into individual message objects
    let processedMessages = [];

    if (
      updatedMessage.messages &&
      Array.isArray(updatedMessage.messages) &&
      updatedMessage.messages.length > 0
    ) {
      // If we have an array of messages, use those
      updatedMessage.chatIds.forEach((chatId) => {
        updatedMessage.messages.forEach((msg, index) => {
          processedMessages.push({
            chatId: chatId,
            message: msg.text || "",
            delay: updatedMessage.messageDelays?.[index] || 0,
            phoneIndex: phoneIndex,
          });
        });
      });
    } else {
      // Otherwise use the single message field
      processedMessages = updatedMessage.chatIds.map((chatId) => ({
        chatId: chatId,
        message: updatedMessage.message || "",
        phoneIndex: phoneIndex,
        delay: 0,
      }));
    }

    // Calculate batches
    const totalMessages = processedMessages.length;
    const batchSize = updatedMessage.batchQuantity || totalMessages;
    const numberOfBatches = Math.ceil(totalMessages / batchSize);

    // Create batches and save them to Firebase
    const batchesRef = db
      .collection("companies")
      .doc(companyId)
      .collection("scheduledMessages")
      .doc(messageId)
      .collection("batches");
    const batches = [];

    // Delete existing batches
    const existingBatches = await batchesRef.get();
    const deleteBatch = db.batch();
    existingBatches.docs.forEach((doc) => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();

    // Create new batches
    for (let batchIndex = 0; batchIndex < numberOfBatches; batchIndex++) {
      const startIndex = batchIndex * batchSize;
      const endIndex = Math.min((batchIndex + 1) * batchSize, totalMessages);
      const batchMessages = processedMessages.slice(startIndex, endIndex);

      const batchDelay =
        batchIndex *
        updatedMessage.repeatInterval *
        getMillisecondsForUnit(updatedMessage.repeatUnit);
      const batchScheduledTime = new Date(
        updatedMessage.scheduledTime.toDate().getTime() + batchDelay
      );

      const batchData = {
        ...updatedMessage,
        messages: batchMessages,
        batchIndex,
        batchScheduledTime:
          admin.firestore.Timestamp.fromDate(batchScheduledTime),
        infiniteLoop: updatedMessage.infiniteLoop || false,
        messageDelays: updatedMessage.messageDelays || [],
        minDelay: updatedMessage.minDelay || null,
        maxDelay: updatedMessage.maxDelay || null,
        activateSleep: updatedMessage.activateSleep || false,
        sleepAfterMessages: updatedMessage.activateSleep
          ? updatedMessage.sleepAfterMessages
          : null,
        sleepDuration: updatedMessage.activateSleep
          ? updatedMessage.sleepDuration
          : null,
        activeHours: updatedMessage.activeHours || null,
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
      status: updatedMessage.status || "scheduled",
      infiniteLoop: updatedMessage.infiniteLoop || false,
      messageDelays: updatedMessage.messageDelays || [],
      minDelay: updatedMessage.minDelay || null,
      maxDelay: updatedMessage.maxDelay || null,
      activateSleep: updatedMessage.activateSleep || false,
      sleepAfterMessages: updatedMessage.activateSleep
        ? updatedMessage.sleepAfterMessages
        : null,
      sleepDuration: updatedMessage.activateSleep
        ? updatedMessage.sleepDuration
        : null,
      activeHours: updatedMessage.activeHours || null,
    };

    await db
      .collection("companies")
      .doc(companyId)
      .collection("scheduledMessages")
      .doc(messageId)
      .set(mainMessageData);

    // Schedule new batches
    if (mainMessageData.status === "scheduled") {
      for (const batch of batches) {
        const delay = Math.max(batch.scheduledTime.getTime() - Date.now(), 0);
        await messageQueue.add(
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
    }

    res.json({
      id: messageId,
      message: "Message updated successfully",
      success: true,
      batches: batches.length,
    });
  } catch (error) {
    console.error("Error updating scheduled message:", error);
    res.status(500).json({ error: "Failed to update scheduled message" });
  }
});

app.delete("/api/schedule-message/:companyId/:messageId", async (req, res) => {
  const { companyId, messageId } = req.params;

  try {
    console.log("Received delete request:", { companyId, messageId });

    // Check if message exists
    const messageRef = db
      .collection("companies")
      .doc(companyId)
      .collection("scheduledMessages")
      .doc(messageId);
    const messageDoc = await messageRef.get();

    if (!messageDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Scheduled message not found",
      });
    }

    // Delete batches first
    const batchesRef = messageRef.collection("batches");
    const batchesSnapshot = await batchesRef.get();

    // Use a Firestore batch for atomic operation
    const batch = db.batch();

    // Add batch deletions
    batchesSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    // Add main document deletion to the same batch
    batch.delete(messageRef);

    // Execute the batch
    await batch.commit();

    // Remove jobs from queue - make sure to check all possible states
    const jobStates = ["active", "waiting", "delayed", "paused", "failed"];
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
      throw new Error("Message document still exists after deletion");
    }

    res.json({
      id: messageId,
      message: "Message deleted successfully",
      success: true,
      batchesDeleted: batchesSnapshot.size,
    });
  } catch (error) {
    console.error("Error deleting scheduled message:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to delete scheduled message",
      details: {
        companyId,
        messageId,
        errorCode: error.code,
      },
    });
  }
});
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
        return res
          .status(404)
          .json({
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
    limit = 50, // Number of results per page
  } = req.query;

  try {
    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const startAt = (page - 1) * limit;
    const contactsRef = db
      .collection("companies")
      .doc(companyId)
      .collection("contacts");

    // Create a query that uses indexes
    let messagesQuery;

    if (contactId) {
      messagesQuery = contactsRef.doc(contactId).collection("messages");
    } else {
      // Use collectionGroup to search across all message subcollections
      messagesQuery = db
        .collectionGroup("messages")
        .where("companyId", "==", companyId);
    }

    // Apply filters using compound indexes
    if (dateFrom) {
      messagesQuery = messagesQuery.where(
        "timestamp",
        ">=",
        parseInt(dateFrom)
      );
    }
    if (dateTo) {
      messagesQuery = messagesQuery.where("timestamp", "<=", parseInt(dateTo));
    }
    if (messageType) {
      messagesQuery = messagesQuery.where("type", "==", messageType);
    }
    if (fromMe !== undefined) {
      messagesQuery = messagesQuery.where("from_me", "==", fromMe === "true");
    }

    // Use text-based index for searching
    // Note: You'll need to set up a text index in Firestore
    messagesQuery = messagesQuery
      .where("searchableText", ">=", query.toLowerCase())
      .where("searchableText", "<=", query.toLowerCase() + "\uf8ff")
      .orderBy("searchableText")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .offset(startAt);

    const snapshot = await messagesQuery.get();

    // Get total count (for pagination)
    const totalQuery = messagesQuery.count();
    const [totalSnapshot] = await Promise.all([totalQuery.get()]);
    const total = totalSnapshot.data().count;

    const results = snapshot.docs.map((doc) => ({
      id: doc.id,
      contactId: doc.ref.parent.parent.id,
      ...doc.data(),
    }));

    res.json({
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      results,
    });
  } catch (error) {
    console.error("Error searching messages:", error);
    res.status(500).json({ error: "Failed to search messages" });
  }
});

app.get("/api/stats/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const { employeeId } = req.query;
  let agentName;

  if (!employeeId) {
    return res.status(400).json({ error: "Employee ID is required" });
  }

  const employeeRef = db
    .collection("companies")
    .doc(companyId)
    .collection("employee")
    .doc(employeeId);
  const employeeDoc = await employeeRef.get();

  if (employeeDoc.exists) {
    agentName = employeeDoc.data().name;
  } else {
    return res
      .status(400)
      .json({ error: "No employee found with the given ID" });
  }

  try {
    // Initialize stats object
    const stats = {
      conversationsAssigned: 0,
      outgoingMessagesSent: 0,
      averageResponseTime: 0,
      closedContacts: 0,
    };

    // Query for contacts with the agent's name as a tag
    const contactsRef = db
      .collection("companies")
      .doc(companyId)
      .collection("contacts");
    const contactsSnapshot = await contactsRef
      .where("tags", "array-contains", agentName)
      .get();

    if (contactsSnapshot.empty) {
      return res
        .status(404)
        .json({ error: "No contacts found for the specified agent" });
    } else {
      stats.conversationsAssigned = contactsSnapshot.size;
      const closedContacts = contactsSnapshot.docs.filter((doc) =>
        doc.data().tags.includes("closed")
      );
      stats.closedContacts = closedContacts.length;
    }

    let totalResponseTime = 0;
    let responseCount = 0;

    // Iterate over each contact to gather statistics
    for (const contactDoc of contactsSnapshot.docs) {
      const contactId = contactDoc.id;

      // Query for outgoing messages sent for this contact
      const messagesRef = contactsRef.doc(contactId).collection("messages");
      const messagesSnapshot = await messagesRef.get();
      stats.outgoingMessagesSent += messagesSnapshot.docs.filter(
        (doc) => doc.data().from_me
      ).length;

      // Calculate first response time for this contact
      const messagesTimeSnapshot = await messagesRef.orderBy("timestamp").get();
      const sortedMessages = messagesTimeSnapshot.docs
        .map((doc) => doc.data())
        .sort((a, b) => a.timestamp - b.timestamp);

      let firstAgentMessageTime = null;
      let firstContactMessageTime = null;

      for (const message of sortedMessages) {
        if (message.from_me && firstAgentMessageTime === null) {
          firstAgentMessageTime = message.timestamp;
        } else if (!message.from_me && firstContactMessageTime === null) {
          firstContactMessageTime = message.timestamp;
        }

        if (
          firstAgentMessageTime !== null &&
          firstContactMessageTime !== null
        ) {
          break;
        }
      }

      if (firstAgentMessageTime !== null && firstContactMessageTime !== null) {
        const responseTime = Math.abs(
          firstContactMessageTime - firstAgentMessageTime
        );
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
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

async function searchContactMessages(
  messagesRef,
  query,
  dateFrom,
  dateTo,
  messageType,
  fromMe
) {
  let messagesQuery = messagesRef;

  // Apply filters if provided
  if (dateFrom) {
    messagesQuery = messagesQuery.where("timestamp", ">=", parseInt(dateFrom));
  }
  if (dateTo) {
    messagesQuery = messagesQuery.where("timestamp", "<=", parseInt(dateTo));
  }
  if (messageType) {
    messagesQuery = messagesQuery.where("type", "==", messageType);
  }
  if (fromMe !== undefined) {
    messagesQuery = messagesQuery.where("from_me", "==", fromMe === "true");
  }

  const snapshot = await messagesQuery.get();
  const results = [];

  snapshot.forEach((doc) => {
    const messageData = doc.data();
    const messageText = messageData.text?.body || messageData.caption || "";

    // Check if the message contains the search query (case-insensitive)
    if (messageText.toLowerCase().includes(query.toLowerCase())) {
      results.push({
        id: doc.id,
        ...messageData,
      });
    }
  });

  return results;
}
const MAX_RETRIES = 3;
async function syncContacts(client, companyId, phoneIndex = 0) {
  // TODO: Remove this limit when ready for production
  const CHAT_LIMIT = 10; // Set to null to process all chats

  try {
    const chats = await client.getChats();
    const totalChats = CHAT_LIMIT
      ? Math.min(chats.length, CHAT_LIMIT)
      : chats.length;
    let processedChats = 0;
    let failedChats = [];

    console.log(
      `Found ${chats.length} chats for company ${companyId}, phone ${phoneIndex}. Processing ${totalChats} chats.`
    );

    // Process chats sequentially
    for (let i = 0; i < totalChats; i++) {
      const chat = chats[i];
      let success = false;
      let retries = 0;

      while (!success && retries < MAX_RETRIES) {
        try {
          const contact = await chat.getContact();

          // Format contact data for SQL
          const contactData = {
            contact_id: contact.id.user,
            company_id: companyId,
            name: contact.name || contact.pushname || "",
            contact_name: contact.name || contact.pushname || "",
            phone: contact.id.user,
            email: contact.email || "",
            thread_id: chat.id._serialized,
            profile: contact.profile || {},
            points: 0,
            tags: [],
            reaction: null,
            reaction_timestamp: null,
            last_updated: new Date(),
            edited: false,
            edited_at: null,
            whapi_token: null,
            created_at: new Date(),
          };

          // Save contact to SQL database
          const savedContact = await sqlDb.query(
            `INSERT INTO contacts (
              contact_id, company_id, name, contact_name, phone, email, 
              thread_id, profile, points, tags, reaction, reaction_timestamp,
              last_updated, edited, edited_at, whapi_token, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT (contact_id, company_id) DO UPDATE
            SET name = EXCLUDED.name,
                contact_name = EXCLUDED.contact_name,
                phone = EXCLUDED.phone,
                email = EXCLUDED.email,
                thread_id = EXCLUDED.thread_id,
                profile = EXCLUDED.profile,
                tags = EXCLUDED.tags,
                last_updated = EXCLUDED.last_updated
            RETURNING *`,
            [
              contactData.contact_id,
              contactData.company_id,
              contactData.name,
              contactData.contact_name,
              contactData.phone,
              contactData.email,
              contactData.thread_id,
              contactData.profile,
              contactData.points,
              contactData.tags,
              contactData.reaction,
              contactData.reaction_timestamp,
              contactData.last_updated,
              contactData.edited,
              contactData.edited_at,
              contactData.whapi_token,
              contactData.created_at,
            ]
          );

          // Sync messages for this contact
          const messages = await chat.fetchMessages({ limit: 10 });
          for (const message of messages) {
            try {
              const messageData = {
                message_id: message.id._serialized,
                company_id: companyId,
                contact_id: contact.id.user,
                thread_id: chat.id._serialized,
                customer_phone: contact.id.user,
                content: message.body || "",
                message_type: message.type,
                media_url: message.hasMedia ? message.downloadMedia() : null,
                timestamp: new Date(message.timestamp * 1000),
                direction: message.fromMe ? "outbound" : "inbound",
                status: "delivered",
                from_me: message.fromMe,
                chat_id: chat.id._serialized,
                author: message.author || contact.id.user,
              };

              await sqlDb.query(
                `INSERT INTO messages (
                  message_id, company_id, contact_id, thread_id, customer_phone,
                  content, message_type, media_url, timestamp, direction,
                  status, from_me, chat_id, author
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (message_id) DO NOTHING`,
                [
                  messageData.message_id,
                  messageData.company_id,
                  messageData.contact_id,
                  messageData.thread_id,
                  messageData.customer_phone,
                  messageData.content,
                  messageData.message_type,
                  messageData.media_url,
                  messageData.timestamp,
                  messageData.direction,
                  messageData.status,
                  messageData.from_me,
                  messageData.chat_id,
                  messageData.author,
                ]
              );
            } catch (error) {
              console.error(
                `Error saving message ${message.id._serialized}:`,
                error
              );
            }
          }

          success = true;
          processedChats++;

          // Add a small delay between each chat
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          retries++;
          console.error(`Error processing chat (attempt ${retries}):`, error);

          if (retries === MAX_RETRIES) {
            console.error(
              `Failed to process chat after ${MAX_RETRIES} attempts`
            );
            failedChats.push(chat);
          } else {
            // Small delay before retry
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }

      // Log progress at regular intervals
      if (processedChats % 10 === 0 || processedChats === totalChats) {
        console.log(
          `Processed ${processedChats} out of ${totalChats} chats for company ${companyId}, phone ${phoneIndex}`
        );
        if (failedChats.length > 0) {
          console.log(`Failed chats so far: ${failedChats.length}`);
        }
      }
    }

    const successfulChats = totalChats - failedChats.length;
    console.log(
      `Finished syncing contacts and messages for company ${companyId}, phone ${phoneIndex}`
    );
    console.log(
      `Successfully processed: ${successfulChats}/${totalChats} chats`
    );

    return {
      success: true,
      processedChats: successfulChats,
      failedChats: failedChats.length,
      totalChats,
    };
  } catch (error) {
    console.error(
      `Error syncing contacts and messages for company ${companyId}, phone ${phoneIndex}:`,
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

// Add a timeout wrapper function
const withTimeout = async (promise, timeoutMs = 30000) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Operation timed out"));
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
  console.log("\n=== Verifying Message Document ===");
  console.log("Looking for message:", {
    messageId,
    companyId,
    timestamp: new Date().toISOString(),
  });

  try {
    // Log all the paths we're checking
    const paths = [
      `companies/${companyId}/scheduledMessages/${messageId}`,
      `scheduled_messages/${messageId}`,
      `archived_messages/${messageId}`,
    ];
    console.log("Checking paths:", paths);

    // Check in company's scheduledMessages collection
    const companyRef = db.collection("companies").doc(companyId);
    console.log("Checking company exists:", companyId);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      console.log(`Company ${companyId} not found`);
      return null;
    }

    // Check scheduled messages subcollection
    console.log("Checking company scheduled messages");
    const messageDoc = await companyRef
      .collection("scheduledMessages")
      .doc(messageId)
      .get();

    if (messageDoc.exists) {
      const data = messageDoc.data();
      console.log("Document found in company collection:", {
        path: `companies/${companyId}/scheduledMessages/${messageId}`,
        data: {
          id: messageDoc.id,
          status: data.status,
          createdAt: data.createdAt?.toDate(),
          batchCount: data.batches?.length || 0,
          v2: data.v2,
        },
      });
      return messageDoc;
    }

    // If not found, check root collections
    console.log("Not found in company collection, checking root collections");

    const rootDoc = await db
      .collection("scheduled_messages")
      .doc(messageId)
      .get();
    if (rootDoc.exists) {
      console.log("Document found in root scheduled_messages collection");
      return rootDoc;
    }

    const archivedDoc = await db
      .collection("archived_messages")
      .doc(messageId)
      .get();
    if (archivedDoc.exists) {
      console.log("Document found in archived_messages collection");
      return archivedDoc;
    }

    // Document not found anywhere
    console.log("Document not found in any location. Checked paths:", {
      company: `companies/${companyId}/scheduledMessages/${messageId}`,
      root: `scheduled_messages/${messageId}`,
      archived: `archived_messages/${messageId}`,
    });

    // List all documents in the scheduledMessages collection for debugging
    const allMessages = await companyRef.collection("scheduledMessages").get();
    console.log("All scheduled messages for company:", {
      companyId,
      totalDocs: allMessages.size,
      docIds: allMessages.docs.map((doc) => doc.id),
    });

    return null;
  } catch (error) {
    console.error("Error verifying document:", {
      error: error.message,
      stack: error.stack,
      companyId,
      messageId,
    });
    return null;
  }
}
// Create a worker factory function
const createQueueAndWorker = (botId) => {
  const isWithinAllowedHours = () => {
    const now = new Date();
    const hour = now.getHours();
    // Allow messages between 6 AM and 2 AM (next day)
    return hour >= 6 || hour < 2;
  };
  const queue = new Queue(`scheduled-messages-${botId}`, {
    connection,
    defaultJobOptions: {
      removeOnComplete: false, // Keep completed jobs
      removeOnFail: false, // Keep failed jobs
      attempts: 3, // Number of retry attempts
    },
  });

  const worker = new Worker(
    `scheduled-messages-${botId}`,
    async (job) => {
      if (job.name === "send-message-batch") {
        if (!isWithinAllowedHours()) {
          console.log(
            `Bot ${botId} - Message delayed: Outside allowed hours (2 AM - 6 AM)`
          );
          // Calculate delay until 6 AM
          const now = new Date();
          const nextAllowed = new Date();
          nextAllowed.setHours(6, 0, 0, 0);
          if (now.getHours() >= 2) {
            nextAllowed.setDate(nextAllowed.getDate() + 1);
          }
          const delay = nextAllowed - now;

          // Re-add the job with a delay
          await queue.add("send-message-batch", job.data, {
            ...job.opts,
            delay,
            jobId: `${job.id}_delayed`,
          });
          return;
        }
        const { companyId, messageId, batchId } = job.data;
        console.log(`Bot ${botId} - Processing scheduled message batch:`, {
          messageId,
          batchId,
        });

        try {
          // Fetch the batch data from Firebase
          const batchRef = db
            .collection("companies")
            .doc(companyId)
            .collection("scheduledMessages")
            .doc(messageId)
            .collection("batches")
            .doc(batchId);
          const batchSnapshot = await batchRef.get();

          if (!batchSnapshot.exists) {
            console.error(`Bot ${botId} - Batch ${batchId} not found`);
            return;
          }

          const batchData = batchSnapshot.data();

          try {
            console.log(
              `Bot ${botId} - Sending scheduled message batch:`,
              batchData
            );
            const result = await sendScheduledMessage(batchData);

            if (result.success) {
              await batchRef.update({ status: "sent" });
              // Check if all batches are processed
              const batchesRef = db
                .collection("companies")
                .doc(companyId)
                .collection("scheduledMessages")
                .doc(messageId)
                .collection("batches");
              const batchesSnapshot = await batchesRef.get();
              const allBatchesSent = batchesSnapshot.docs.every(
                (doc) => doc.data().status === "sent"
              );

              if (allBatchesSent) {
                // Update main scheduled message status
                await db
                  .collection("companies")
                  .doc(companyId)
                  .collection("scheduledMessages")
                  .doc(messageId)
                  .update({ status: "completed" });
              }
            } else {
              console.error(
                `Bot ${botId} - Failed to send batch ${batchId}:`,
                result.error
              );
              await batchRef.update({ status: "failed" });
              await db
                .collection("companies")
                .doc(companyId)
                .collection("scheduledMessages")
                .doc(messageId)
                .update({ status: "failed" });
            }
          } catch (error) {
            console.error(
              `Bot ${botId} - Error processing scheduled message batch:`,
              error
            );
            throw error; // This will cause the job to be retried
          }
        } catch (error) {
          console.error(
            `Bot ${botId} - Error processing scheduled message batch:`,
            error
          );
          throw error; // This will cause the job to be retried
        }
      }
    },
    {
      connection,
      concurrency: 100,
      limiter: {
        max: 100,
        duration: 1000,
      },
      lockDuration: 30000,
      maxStalledCount: 1,
      settings: {
        stalledInterval: 15000,
        lockRenewTime: 10000,
      },
    }
  ); // Add error handling
  worker.on("completed", async (job) => {
    console.log(`Bot ${botId} - Job ${job.id} completed successfully`);
    // Keep the job data in Redis
    await job.updateProgress(100);
    await job.updateData({
      ...job.data,
      completedAt: new Date(),
      status: "completed",
    });
  });

  worker.on("failed", async (job, err) => {
    console.error(`Bot ${botId} - Job ${job.id} failed:`, err);
    // Keep the job data in Redis
    await job.updateData({
      ...job.data,
      failedAt: new Date(),
      error: err.message,
      status: "failed",
    });
  });

  // Store references
  botQueues.set(botId, queue);
  botWorkers.set(botId, worker);
  return { queue, worker };
};

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

// Add more detailed logging to sendScheduledMessage
async function sendScheduledMessage(message) {
  const companyId = message.companyId;
  try {
    console.log(
      `\n=== [Company ${companyId}] Starting sendScheduledMessage ===`
    );
    console.log(`[Company ${companyId}] Message config:`, {
      messageId: message.messageId,
      batchId: message.batchId,
      v2: message.v2,
      totalMessages: message.messages?.length,
      hasMedia: Boolean(message.mediaUrl || message.documentUrl),
      phoneIndex: message.phoneIndex,
    });
    // Add time check function
    const isWithinAllowedHours = () => {
      const now = new Date();
      const hour = now.getHours();
      return hour >= 6 || hour < 2; // Allow messages between 6 AM and 2 AM
    };
    if (!isWithinAllowedHours()) {
      console.log(
        `[Company ${companyId}] Message delayed: Outside allowed hours (2 AM - 6 AM)`
      );
      // Calculate delay until 6 AM
      const now = new Date();
      const nextAllowed = new Date();
      nextAllowed.setHours(6, 0, 0, 0);
      if (now.getHours() >= 2) {
        nextAllowed.setDate(nextAllowed.getDate() + 1);
      }
      const delay = nextAllowed - now;

      console.log(
        `[Company ${companyId}] Waiting ${Math.round(
          delay / 1000 / 60
        )} minutes until 6 AM`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (message.v2 == true) {
      console.log(`\n=== [Company ${companyId}] Processing V2 Message ===`);

      // Initialize messages array if empty
      if (!message.messages || message.messages.length === 0) {
        message.messages = message.chatIds.map((chatId) => ({
          chatId: chatId,
          message: message.message, // Use the message from parent object
          delay: Math.floor(
            Math.random() * (message.maxDelay - message.minDelay + 1) +
              message.minDelay
          ),
        }));
      }

      console.log(`[Company ${companyId}] Batch details:`, {
        messageId: message.messageId,
        infiniteLoop: message.infiniteLoop,
        activeHours: message.activeHours,
        messages: message.messages.map((m) => ({
          chatId: m.chatId,
          messageLength: m.message?.length,
          delay: m.delay,
        })),
      });

      const processMessage = (messageText, contact) => {
        let processedMessage = messageText;
        const placeholders = {
          contactName: contact.contactName || "",
          firstName: contact.firstName || "",
          lastName: contact.lastName || "",
          email: contact.email || "",
          phone: contact.phone || "",
          vehicleNumber: contact.vehicleNumber || "",
          branch: contact.branch || "",
          expiryDate: contact.expiryDate || "",
          ic: contact.ic || "",
        };

        // Replace all placeholders in the message
        Object.entries(placeholders).forEach(([key, value]) => {
          const placeholder = `@{${key}}`;
          processedMessage = processedMessage.replace(
            new RegExp(placeholder, "g"),
            value
          );
        });

        return processedMessage;
      };

      const waitUntilNextDay = async () => {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        const timeUntilTomorrow = tomorrow - now;
        console.log(
          `Waiting ${timeUntilTomorrow / 1000 / 60} minutes until next day`
        );

        // Check if the message sequence should be stopped
        const messageDoc = await db
          .collection("companies")
          .doc(companyId)
          .collection("scheduledMessages")
          .doc(message.messageId)
          .get();

        if (!messageDoc.exists || messageDoc.data().status === "stopped") {
          console.log("Message sequence stopped");
          return true;
        }

        // Wait until midnight
        await new Promise((resolve) => setTimeout(resolve, timeUntilTomorrow));
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
          delay: messageItem.delay,
        });

        const { chatId, message: messageText, delay } = messageItem;
        const phone = chatId.split("@")[0];

        console.log(`[Company ${companyId}] Fetching contact data for:`, phone);
        const contactRef = db
          .collection("companies")
          .doc(companyId)
          .collection("contacts")
          .doc("+" + phone);
        const contactDoc = await contactRef.get();
        console.log(
          `[Company ${companyId}] Contact exists:`,
          contactDoc.exists
        );

        const contactData = contactDoc.exists ? contactDoc.data() : {};
        const processedMessageText = processMessage(
          messageText || message.message,
          contactData
        );

        const sendCheckRef = db
          .collection("companies")
          .doc(companyId)
          .collection("sentFollowups")
          .doc(chatId)
          .collection("messages");
        const sendCheckSnapshot = await sendCheckRef.get();

        const today = new Date().toISOString().split("T")[0];
        const contentHash = Buffer.from(processedMessageText)
          .toString("base64")
          .substring(0, 20);
        const messageIdentifier = `${today}_${currentMessageIndex}_${contentHash}`;

        const messageAlreadySent = sendCheckSnapshot.docs.some(
          (doc) => doc.id === messageIdentifier
        );

        if (messageAlreadySent) {
          console.log(
            `[Company ${companyId}] Message already sent to ${chatId}, skipping...`
          );
          currentMessageIndex++;
          continue;
        }

        console.log(`[Company ${companyId}] Message prepared:`, {
          originalLength: messageText?.length,
          processedLength: processedMessageText?.length,
          hasPlaceholders: messageText !== processedMessageText,
          finalMessage: processedMessageText, // Log the final message for debugging
        });

        if (delay > 0) {
          console.log(
            `[Company ${companyId}] Adding delay of ${delay} seconds`
          );
          await new Promise((resolve) => setTimeout(resolve, delay * 1000));
        }

        try {
          console.log(`\n=== [Company ${companyId}] Sending Message ===`);
          const endpoint = message.mediaUrl
            ? "image"
            : message.documentUrl
            ? "document"
            : "text";
          const url = `${process.env.URL}api/v2/messages/${endpoint}/${companyId}/${chatId}`;

          console.log(`[Company ${companyId}] Request details:`, {
            endpoint,
            url,
            phoneIndex: message.phoneIndex,
            hasMedia: Boolean(message.mediaUrl || message.documentUrl),
            messageText: processedMessageText, // Log the message being sent
          });

          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              message.mediaUrl
                ? {
                    imageUrl: message.mediaUrl,
                    caption: processedMessageText,
                    phoneIndex: message.phoneIndex,
                  }
                : message.documentUrl
                ? {
                    documentUrl: message.documentUrl,
                    filename: message.fileName,
                    caption: processedMessageText,
                    phoneIndex: message.phoneIndex,
                  }
                : {
                    message: processedMessageText || message.message, // Fallback to original message
                    phoneIndex: message.phoneIndex,
                  }
            ),
          });

          console.log(`[Company ${companyId}] Send response:`, {
            status: response.status,
            ok: response.ok,
          });

          if (!response.ok) {
            throw new Error(`Failed to send message: ${response.status}`);
          }

          await sendCheckRef.doc(messageIdentifier).set({
            sentAt: admin.firestore.Timestamp.now(),
            messageIndex: currentMessageIndex,
            messageContent: processedMessageText,
            messageType: endpoint,
          });

          console.log(
            `[Company ${companyId}] Recorded message as sent with ID: ${messageIdentifier}`
          );

          if (companyId === "0148") {
            const messageTemplate =
              "Good day {customerName}!!! Will you be interested in giving try for our first trial session (60 minutes!!) for just RM99?? One step closer to achieving your goals 😊";

            const regexPattern = messageTemplate.replace(
              "{customerName}",
              ".*"
            );
            const regex = new RegExp(`^${regexPattern}$`);

            if (regex.test(processedMessageText)) {
              console.log(
                `[Company ${companyId}] Final message matches template. Adding 'Done Followup' tag.`
              );
              const phone = chatId.split("@")[0];
              const contactRef = db
                .collection("companies")
                .doc(companyId)
                .collection("contacts")
                .doc("+" + phone);

              await contactRef.update({
                tags: admin.firestore.FieldValue.arrayUnion("Done Followup"),
              });

              console.log(
                `[Company ${companyId}] Added 'Done Followup' tag to contact ${phone}`
              );
            } else {
              console.log(
                `[Company ${companyId}] Final message does not match template. Skipping tag addition.`
              );
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
          willContinue:
            currentMessageIndex < message.messages.length ||
            message.infiniteLoop,
        });

        if (currentMessageIndex >= message.messages.length) {
          if (!message.infiniteLoop) {
            console.log(`[Company ${companyId}] Sequence complete - ending`);
            break;
          }

          console.log(
            `[Company ${companyId}] Day ${dayCount} complete - preparing for next day`
          );
          const shouldStop = await waitUntilNextDay();
          if (shouldStop) {
            console.log(
              `[Company ${companyId}] Sequence stopped during day transition`
            );
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

    console.log(
      `\n=== [Company ${companyId}] sendScheduledMessage Complete ===`
    );
    return { success: true };
  } catch (error) {
    console.error(
      `\n=== [Company ${companyId}] sendScheduledMessage Error ===`
    );
    console.error(`[Company ${companyId}] Error Type:`, error.name);
    console.error(`[Company ${companyId}] Error Message:`, error.message);
    console.error(`[Company ${companyId}] Stack:`, error.stack);
    return { success: false, error };
  }
}

app.post(
  "/api/schedule-message/:companyId/:messageId/stop",
  async (req, res) => {
    const { companyId, messageId } = req.params;

    try {
      await db
        .collection("companies")
        .doc(companyId)
        .collection("scheduledMessages")
        .doc(messageId)
        .update({
          status: "stopped",
          stoppedAt: admin.firestore.Timestamp.now(),
        });

      res.json({
        success: true,
        message: "Message stopped successfully",
      });
    } catch (error) {
      console.error("Error stopping message:", error);
      res.status(500).json({
        error: "Failed to stop message",
      });
    }
  }
);

// Modify the scheduleAllMessages function
async function obiliterateAllJobs() {
  // Clear all existing jobs from the queue
  await messageQueue.obliterate({ force: true });
  console.log("Queue cleared successfully");
}

// Modify the scheduleAllMessages function
// Modify the scheduleAllMessages function
async function scheduleAllMessages() {
  const companiesSnapshot = await db.collection("companies").get();
  console.log("scheduleAllMessages");
  for (const companyDoc of companiesSnapshot.docs) {
    const companyId = companyDoc.id;
    const scheduledMessagesSnapshot = await companyDoc.ref
      .collection("scheduledMessages")
      .get();

    for (const messageDoc of scheduledMessagesSnapshot.docs) {
      const messageId = messageDoc.id;
      const message = messageDoc.data();

      if (message.status === "completed") {
        continue; // Skip completed messages
      }

      const batchesSnapshot = await messageDoc.ref.collection("batches").get();

      for (const batchDoc of batchesSnapshot.docs) {
        const batchId = batchDoc.id;
        const batchData = batchDoc.data();

        if (batchData.status === "sent") {
          continue; // Skip sent batches
        }

        const delay =
          batchData.batchScheduledTime.toDate().getTime() - Date.now();

        // Check if the job already exists in the queue
        const existingJob = await messageQueue.getJob(batchId);
        if (!existingJob) {
          await messageQueue.add(
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
              priority: batchData.priority || PRIORITY.BULK,
            }
          );
        }
      }
    }
  }
}

async function saveThreadIDFirebase(email, threadID) {
  // Construct the Firestore document path
  const docPath = `user/${email}`;

  try {
    await db.doc(docPath).set(
      {
        threadid: threadID,
      },
      { merge: true }
    ); // merge: true ensures we don't overwrite the document, just update it
    //  console.log(`Thread ID saved to Firestore at ${docPath}`);
  } catch (error) {
    console.error("Error saving Thread ID to Firestore:", error);
  }
}

function setupMessageHandler(client, botName, phoneIndex) {
  client.on("message", async (msg) => {
    try {
      await handleNewMessagesTemplateWweb(client, msg, botName, phoneIndex);
    } catch (error) {
      console.error(`ERROR in message handling for bot ${botName}:`, error);
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
            `INSERT INTO contacts (contact_id, phone, company_id, last_updated)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             RETURNING *`,
            [contactID, phoneNumber, companyId]
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
        const { msgDBId, type } = addMessagetoPostgres(
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

app.get("/api/storage-pricing", async (req, res) => {
  try {
    const pricingRef = db
      .collection("companies")
      .doc("0123")
      .collection("pricing")
      .doc("storage");
    const doc = await pricingRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Pricing data not found" });
    }

    const pricingData = doc.data();
    res.json({ success: true, data: pricingData });
  } catch (error) {
    console.error("Error fetching storage pricing:", error);
    res.status(500).json({ error: "Failed to fetch pricing data" });
  }
});
async function handleOpenAIMyMessage(message, threadID) {
  // console.log('messaging manual')
  query = `You sent this to the user: ${message}. Please remember this for the next interaction. Do not re-send this query to the user, this is only for you to remember the interaction.`;
  await addMessageAssistant(threadID, query);
}
async function addMessageAssistant(threadId, message) {
  const response = await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: message,
  });
  //console.log(response);
  return response;
}

async function addMessagetoPostgres(
  msg,
  idSubstring,
  extractedNumber,
  contactName,
  phoneIndex = 0,
  userName,
) {
  console.log("Adding message to PostgreSQL");
  console.log("idSubstring:", idSubstring);
  console.log("extractedNumber:", extractedNumber);

  if (!extractedNumber || !extractedNumber.startsWith("+60" || "+65")) {
    console.error("Invalid extractedNumber for database:", extractedNumber);
    return;
  }

  if (!idSubstring) {
    console.error("Invalid idSubstring for database");
    return;
  }

  const contactID =
    idSubstring +
    "-" +
    (extractedNumber.startsWith("+")
      ? extractedNumber.slice(1)
      : extractedNumber);

  let messageBody = "";
  if (msg.text && msg.text.body) {
    messageBody = msg.text.body;
  } else if (msg.body) {
    messageBody = msg.body;
  } else {
    messageBody = "";
  }

  let audioData = null;
  let type = msg.type || "chat";

  if (msg.type === "chat") {
    type = "chat";
  } else if (msg.type === "text") {
    type = "chat";
  } else {
    type = msg.type;
  }

  let mediaMetadata = {};
  let mediaUrl = null;
  let mediaData = null;

  if (msg.hasMedia && (msg.type === "audio" || msg.type === "ptt")) {
    console.log("Voice message detected during saving to NeonDB");
    const media = await msg.downloadMedia();
    const transcription = await transcribeAudio(media.data);

    if (
      transcription &&
      transcription !== "Audio transcription failed. Please try again."
    ) {
      messageBody += transcription;
    } else {
      messageBody +=
        "I couldn't transcribe the audio. Could you please type your message instead?";
    }

    mediaData = media.data;
  }

  let quotedMessage = {};
  if (msg.hasQuotedMsg) {
    const quotedMsg = await msg.getQuotedMessage();
    const authorNumber = "+" + quotedMsg.from.split("@")[0];
    const authorData = await getContactDataFromDatabaseByPhone(
      authorNumber,
      idSubstring
    );

    quotedMessage = {
      quoted_content: {
        body: quotedMsg.body || '',
      },
      quoted_author: authorData ? authorData.name : authorNumber,
      message_id: quotedMsg.id._serialized,
      message_type: quotedMsg.type,
    };
  }

  if (msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();

      if (media) {
        mediaMetadata = {
          mimetype: media.mimetype,
          filename: msg._data.filename || "",
          caption: msg._data.caption || "",
        };

        if (msg._data.thumbnailHeight && msg._data.thumbnailWidth) {
          mediaMetadata.thumbnail = {
            height: msg._data.thumbnailHeight,
            width: msg._data.thumbnailWidth,
          };
        }

        if (msg.mediaKey) {
          mediaMetadata.mediaKey = msg.mediaKey;
        }

        if (msg.type === "image" && msg._data.width && msg._data.height) {
          mediaMetadata.width = msg._data.width;
          mediaMetadata.height = msg._data.height;
        } else if (msg.type === "document") {
          mediaMetadata.pageCount = msg._data.pageCount;
          mediaMetadata.fileSize = msg._data.size;
        }

        if (msg.type === "video") {
          mediaUrl = await storeVideoData(media.data, msg._data.filename);
        } else {
          mediaData = media.data;
        }
      }
    } catch (error) {
      console.error(
        `Error handling media for message ${msg.id._serialized}:`,
        error
      );
    }
  }

  let author = null;
  if (msg.from.includes("@g.us")) {
    const authorNumber = "+" + msg.author.split("@")[0];
    const authorData = await getContactDataFromDatabaseByPhone(
      authorNumber,
      idSubstring
    );

    if (authorData) {
      author = authorData.contactName;
    } else {
      author = msg.author;
    }
  }

  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // FIRST: Create/update contact BEFORE inserting message
      const contactCheckQuery = `
        SELECT id FROM public.contacts 
        WHERE contact_id = $1 AND company_id = $2
      `;

      const contactResult = await client.query(contactCheckQuery, [
        contactID,
        idSubstring,
      ]);

      if (contactResult.rows.length === 0) {
        console.log(
          `Creating new contact: ${contactID} for company: ${idSubstring}`
        );
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
      } else {
        console.log(`Contact already exists: ${contactID}`);
      }

      // SECOND: Now insert the message with correct field mappings
      const messageQuery = `
        INSERT INTO public.messages (
          message_id, company_id, contact_id, content, message_type, 
          media_url, media_data, media_metadata, timestamp, direction, 
          status, from_me, chat_id, author, phone_index, quoted_message, media_data, media_metadata, thread_id, customer_phone
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        RETURNING id
      `;

      const messageValues = [
        msg.id._serialized,
        idSubstring,
        contactID,
        messageBody,
        type,
        mediaUrl,
        mediaData,
        mediaMetadata ? JSON.stringify(mediaMetadata) : null,
        new Date(msg.timestamp * 1000),
        msg.fromMe ? "outbound" : "inbound",
        "delivered",
        msg.fromMe || false,
        msg.from,
        userName || author,
        phoneIndex,
        quotedMessage ? JSON.stringify(quotedMessage) : null,
        mediaData || null,
        mediaMetadata? JSON.stringify(mediaMetadata) : null,
        msg.to,
        extractedNumber,
      ];

      const messageResult = await client.query(messageQuery, messageValues);
      const messageDbId = messageResult.rows[0].id;

      await client.query("COMMIT");
      console.log(
        `Message successfully added to PostgreSQL with ID: ${messageDbId}`
      );
      return messageDbId, type;
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error in PostgreSQL transaction:", error);
      throw error;
    } finally {
      try {
        const contactData = await getContactDataFromDatabaseByPhone(
          extractedNumber,
          idSubstring
        );
        if (
          contactData &&
          contactData.contact_name &&
          contactData.contact_name !== extractedNumber &&
          !contactData.contact_name.includes(extractedNumber.replace("+", ""))
        ) {
          contactName = contactData.contact_name;
          console.log(`Using saved contact name: ${contactName}`);
        } else {
          console.log(`No saved name found, using number: ${extractedNumber}`);
        }
      } catch (contactError) {
        console.error("Error fetching contact data:", contactError);
      }
      await addNotificationToUser(idSubstring, messageBody, contactName);
      client.release();
    }
  } catch (error) {
    console.error("PostgreSQL connection error:", error);
    throw error;
  }
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
async function storeVideoData(videoData, filename) {
  const bucket = admin.storage().bucket();
  const uniqueFilename = `${uuidv4()}_${filename}`;
  const file = bucket.file(`videos/${uniqueFilename}`);

  await file.save(Buffer.from(videoData, "base64"), {
    metadata: {
      contentType: "video/mp4", // Adjust this based on the actual video type
    },
  });

  const [url] = await file.getSignedUrl({
    action: "read",
    expires: "03-01-2500", // Adjust expiration as needed
  });

  return url;
}
//console.log('Server starting - version 2'); // Add this line at the beginning of the file
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

async function getContactDataFromDatabaseByPhone(phoneNumber, idSubstring) {
  const sqlClient = await pool.connect();

  try {
    if (!phoneNumber) {
      throw new Error("Phone number is undefined or null");
    }

    await sqlClient.query("BEGIN");

    const query = `
      SELECT * FROM public.contacts
      WHERE phone = $1 AND company_id = $2
      LIMIT 1
    `;

    const result = await sqlClient.query(query, [phoneNumber, idSubstring]);

    await sqlClient.query("COMMIT");

    if (result.rows.length === 0) {
      console.log(
        "No matching documents for contact in company." + idSubstring
      );
      return null;
    } else {
      const contactData = result.rows[0];
      const contactName = contactData.contact_name || contactData.name;
      const threadID = contactData.thread_id;

      return {
        ...contactData,
        contactName,
        threadID,
      };
    }
  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error("Error fetching contact data:", error);
    throw error;
  } finally {
    sqlClient.release();
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

    res.json({
      name: user.name,
      company_id: user.company_id,
      role: user.role,
      email: user.email,
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

    res.json({
      name: company.name,
      company_id: company.company_id,
      // Add other company fields you need
    });
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
async function main(reinitialize = false) {
  console.log("Initialization starting...");

  // 1. Fetch companies in parallel with other initialization tasks
  const companiesPromise = sqlDb.query(
    "SELECT * FROM companies WHERE company_id = $1",
    ["0145"]
  );

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
    // Only take the first bot configuration
    const config = botConfigs[0];
    if (!config) {
      console.log("No bot configurations found");
      return;
    }

    console.log(`Starting initialization of bot ${config.botName}...`);

    try {
      await initializeBot(config.botName, config.phoneCount);
      console.log(`Successfully initialized bot ${config.botName}`);
    } catch (error) {
      console.error(
        `Error in initialization of bot ${config.botName}:`,
        error.message
      );
    }

    console.log("Bot initialization completed.");
  };

  // Replace the parallel initialization with sequential starts
  await initializeBotsWithDelay(botConfigs);

  const automationInstances = {
    //skcSpreadsheet: new SKCSpreadsheet(botMap),
    //bhqSpreadsheet: new bhqSpreadsheet(botMap),
    //constantcoSpreadsheet: new constantcoSpreadsheet(botMap),
  };

  // 7. Initialize automation systems in parallel
  const automationPromises = [
    scheduleAllMessages(),
    //automationInstances.bhqSpreadsheet.initialize(),
    //automationInstances.skcSpreadsheet.initialize(),
    //automationInstances.constantcoSpreadsheet.initialize(),
  ];
  await Promise.all(automationPromises);

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
  ];
}

async function checkAndScheduleDailyReport() {
  try {
    const sqlClient = await pool.connect();

    try {
      await sqlClient.query("BEGIN");

      const companiesQuery = `
        SELECT company_id 
        FROM public.companies
      `;

      const companiesResult = await sqlClient.query(companiesQuery);
      const companies = companiesResult.rows;

      console.log(
        `Found ${companies.length} companies to check for daily reports`
      );

      for (const company of companies) {
        const companyId = company.company_id;

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
            console.log(`[${companyId}] Daily reporting not enabled, skipping`);
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
      await sqlClient.query("ROLLBACK");
      console.error(`Error in checkAndScheduleDailyReport:`, error);
    } finally {
      sqlClient.release();
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
    sqlClient.release();
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

async function getPhoneStatus(companyId, phoneIndex) {
  try {
    const phoneStatusRef = db
      .collection("companies")
      .doc(companyId)
      .collection("phoneStatus")
      .doc(`phone${phoneIndex}`);

    const doc = await phoneStatusRef.get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error(
      `Error getting phone status from Firebase for ${companyId} Phone ${
        phoneIndex + 1
      }:`,
      error
    );
    return null;
  }
}

// New function to get all phone statuses for a company
// New function to get all phone statuses for a company from SQL
async function getAllPhoneStatusesSql(companyId) {
  try {
    const query =
      "SELECT phone_number, status, metadata FROM phone_status WHERE company_id = $1";
    const { rows } = await sqlDb.query(query, [companyId]);
    return rows;
  } catch (error) {
    console.error(
      `Error getting all phone statuses from SQL for ${companyId}:`,
      error
    );
    return [];
  }
}
app.get("/api/phone-status/:companyId", async (req, res) => {
  try {
    const { companyId } = req.params;
    const phoneStatuses = await getAllPhoneStatusesSql(companyId);
    res.json(phoneStatuses);
  } catch (error) {
    console.error("Error fetching phone statuses:", error);
    res.status(500).json({ error: "Failed to fetch phone statuses" });
  }
});
// ... existing code ...
async function fetchCompanyConfigSql(companyId) {
  try {
    const companyQuery = `
      SELECT 
        assistant_id, 
        name, 
        phone_count, 
        profile->>'assistantId2' as assistant_id_2,
        profile->>'assistantId3' as assistant_id_3,
        profile->>'phone1' as phone_1,
        profile->>'phone2' as phone_2,
        profile->>'phone3' as phone_3,
        profile->>'ghl_accessToken' as ghl_access_token,
        profile->>'apiUrl' as api_url,         -- Added
        profile->>'aiDelay' as ai_delay,       -- Added
        profile->>'aiAutoResponse' as ai_auto_response, -- Added
        daily_report                           -- Added the daily_report JSONB column
      FROM companies 
      WHERE company_id = $1
    `;
    const companyResult = await sqlDb.query(companyQuery, [companyId]);
    const companyData = companyResult.rows[0];

    if (!companyData) {
      return null;
    }

    const openaiTokenQuery =
      "SELECT config_value FROM system_config WHERE config_key = $1";
    const openaiTokenResult = await sqlDb.query(openaiTokenQuery, [
      "openai_api_key",
    ]);
    const openaiToken = openaiTokenResult.rows[0]?.config_value;

    return {
      companyData: {
        assistantId: companyData.assistant_id,
        name: companyData.name,
        phoneCount: parseInt(companyData.phone_count || "1"),
        assistantId2: companyData.assistant_id_2,
        assistantId3: companyData.assistant_id_3,
        phone1: companyData.phone_1,
        phone2: companyData.phone_2,
        phone3: companyData.phone_3,
        ghl_accessToken: companyData.ghl_access_token,
        apiUrl: companyData.api_url,
        aiDelay: parseInt(companyData.ai_delay || "0"), // Ensure it's parsed as int
        aiAutoResponse: companyData.ai_auto_response === "true", // Convert string 'true'/'false' to boolean
        dailyReport: companyData.daily_report, // Pass the entire daily_report JSONB
      },
      openaiApiKey: openaiToken,
    };
  } catch (error) {
    console.error("Error fetching company config from SQL:", error);
    return null;
  }
}
// ... existing code ...
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
async function fetchEmployeesDataSql(companyId) {
  try {
    const query =
      'SELECT id, employee_id, name, email, phone AS "phoneNumber", role FROM employees WHERE company_id = $1';
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
// ... existing code ...

async function fetchEmployeesDataSql(companyId) {
  try {
    const query =
      'SELECT id, employee_id, name, email, phone AS "phoneNumber", role FROM employees WHERE company_id = $1';
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
  incrementValue
) {
  const client = await sqlDb.connect(); // Get a client from the pool
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

    // 2. Update or insert monthly assignments
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
    await client.query("ROLLBACK"); // Rollback on error
    console.error("Error in updateMonthlyAssignmentsSql transaction:", error);
    throw error; // Re-throw to be caught by the API endpoint
  } finally {
    client.release(); // Release client back to the pool
  }
}

// ... existing code ...
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
} // Function to get scheduled messages summary
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
       AND $2 = ANY(tags) 
       AND 'closed' = ANY(tags)`,
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
// Remove the duplicate route handler and keep only this one
app.post("/api/bots/reinitialize", async (req, res) => {
  try {
    const { botName, phoneIndex } = req.body;

    // Get existing bot data
    const botData = botMap.get(botName);

    // Get the phone count from the company document
    const companyDoc = await db.collection("companies").doc(botName).get();
    if (!companyDoc.exists) {
      throw new Error("Company not found in database");
    }

    const phoneCount = companyDoc.data().phoneCount || 1;
    let sessionsCleaned = false;

    // First try normal reinitialization
    try {
      if (botData && Array.isArray(botData)) {
        if (phoneIndex !== undefined) {
          // Single phone reinitialization
          if (botData[phoneIndex]?.client) {
            try {
              await botData[phoneIndex].client.destroy();
              botData[phoneIndex] = { status: "Initializing" };
            } catch (error) {
              console.error(
                `Error destroying client for ${botName} phone ${phoneIndex}:`,
                error
              );
            }
          }
        } else {
          // Full bot reinitialization
          await Promise.all(
            botData.map(async (data) => {
              if (data?.client) {
                try {
                  await data.client.destroy();
                } catch (error) {
                  console.error(
                    `Error destroying client for ${botName}:`,
                    error
                  );
                }
              }
            })
          );
          botMap.delete(botName);
        }
      }

      // Wait a bit before reinitializing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (phoneIndex !== undefined) {
        // Initialize single phone
        await initializeBot(botName, phoneCount, phoneIndex);
      } else {
        // Initialize all phones
        await initializeBot(botName, phoneCount);
      }
    } catch (initError) {
      console.error(
        `Initial reinitialization failed for ${botName}, cleaning sessions and retrying...`,
        initError
      );

      // If initialization fails, delete session folder(s)
      if (phoneIndex !== undefined) {
        // Clean single phone session
        const sessionDir = path.join(
          __dirname,
          ".wwebjs_auth",
          `session-${botName}${phoneCount > 1 ? `_phone${phoneIndex + 1}` : ""}`
        );
        try {
          await fs.promises.rm(sessionDir, { recursive: true, force: true });
          console.log(`Deleted session directory: ${sessionDir}`);
          sessionsCleaned = true;
        } catch (error) {
          console.error(
            `Error deleting session directory ${sessionDir}:`,
            error
          );
        }
      } else {
        // Clean all phone sessions
        for (let i = 0; i < phoneCount; i++) {
          const sessionDir = path.join(
            __dirname,
            ".wwebjs_auth",
            `session-${botName}${phoneCount > 1 ? `_phone${i + 1}` : ""}`
          );
          try {
            await fs.promises.rm(sessionDir, { recursive: true, force: true });
            console.log(`Deleted session directory: ${sessionDir}`);
            sessionsCleaned = true;
          } catch (error) {
            console.error(
              `Error deleting session directory ${sessionDir}:`,
              error
            );
          }
        }
      }

      // Wait longer before retrying after cleaning
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Try one more time with clean sessions
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
async function getContactDataFromDatabaseByEmail(email) {
  try {
    // Check if email is defined
    if (!email) {
      throw new Error("Email is undefined or null");
    }

    // Reference to the user document
    const userDocRef = db.collection("user").doc(email);
    const doc = await userDocRef.get();

    if (!doc.exists) {
      console.log("No matching document.");
      return null;
    } else {
      const userData = doc.data();
      return { ...userData };
    }
  } catch (error) {
    console.error("Error fetching or updating document:", error);
    throw error;
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
app.get("/api/assistant-test/", async (req, res) => {
  const message = req.query.message;
  const email = req.query.email;
  const assistantid = req.query.assistantid;
  try {
    let threadID;
    const contactData = await getContactDataFromDatabaseByEmail(email);
    if (contactData.threadid) {
      threadID = contactData.threadid;
    } else {
      const thread = await createThread();
      threadID = thread.id;
      await saveThreadIDFirebase(email, threadID);
      //await saveThreadIDGHL(contactID,threadID);
    }

    answer = await handleOpenAIAssistant(message, threadID, assistantid);
    // Send success response
    res.json({ message: "Assistant replied success", answer });
  } catch (error) {
    // Handle errors
    console.error("Assistant replied user:", error);

    res.status(500).json({ error: error.code });
  }
});

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
        }
        count = 500;
        offset = 0;
        if (companyId === "018") {
          while (true) {
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
          }
        }
      }
      let totalContacts = 0;
      let lastContactId = null;
      let maxContacts = 3000;
      let maxRetries = 3;
      while (totalContacts < maxContacts) {
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

  try {
    // Fetch company data
    const companyRef = db.collection("companies").doc(companyId);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Fetch contacts
    const contactsRef = db
      .collection("companies")
      .doc(companyId)
      .collection("contacts");
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
    const startOfWeek = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - now.getDay()
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const employeePerformance = {};

    // Process contacts
    for (const doc of contactsSnapshot.docs) {
      const contactData = doc.data();
      const dateAdded = contactData.dateAdded
        ? new Date(contactData.dateAdded)
        : null;

      totalContacts++;
      if (contactData.tags && contactData.tags.includes("closed")) {
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
        contactData.tags.forEach((tag) => {
          if (tag !== "closed") {
            employeePerformance[tag] = employeePerformance[tag] || {
              assignedContacts: 0,
              outgoingMessages: 0,
              closedContacts: 0,
            };
            employeePerformance[tag].assignedContacts++;
            if (contactData.tags.includes("closed")) {
              employeePerformance[tag].closedContacts++;
            }
          }
        });
      }

      // Count messages
      const messagesRef = contactsRef.doc(doc.id).collection("messages");
      const messagesSnapshot = await messagesRef.get();
      messagesSnapshot.forEach((messageDoc) => {
        const messageData = messageDoc.data();
        if (!messageData.from_me) {
          numReplies++;
        } else if (messageData.userName) {
          employeePerformance[messageData.userName] = employeePerformance[
            messageData.userName
          ] || { assignedContacts: 0, outgoingMessages: 0, closedContacts: 0 };
          employeePerformance[messageData.userName].outgoingMessages++;
        }
      });
    }

    // Calculate metrics
    const responseRate =
      totalContacts > 0 ? (numReplies / totalContacts) * 100 : 0;
    const averageRepliesPerLead =
      totalContacts > 0 ? numReplies / totalContacts : 0;
    const engagementScore = responseRate * 0.4 + averageRepliesPerLead * 0.6;
    const conversionRate =
      totalContacts > 0 ? (closedContacts / totalContacts) * 100 : 0;

    // Fetch and process employee data
    const employeesRef = db
      .collection("companies")
      .doc(companyId)
      .collection("employee");
    const employeesSnapshot = await employeesRef.get();
    const employees = employeesSnapshot.docs
      .map((doc) => {
        const employeeData = doc.data();
        const performance = employeePerformance[employeeData.name] || {
          assignedContacts: 0,
          outgoingMessages: 0,
          closedContacts: 0,
        };
        return {
          id: doc.id,
          ...employeeData,
          ...performance,
        };
      })
      .sort((a, b) => b.assignedContacts - a.assignedContacts);

    // Prepare the response
    const dashboardData = {
      kpi: { totalContacts, numReplies, closedContacts, openContacts },
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
      employeePerformance: employees,
    };

    res.json(dashboardData);
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({ error: "Internal server error" });
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

  try {
    if (!phone) {
      return res.status(400).json({ error: "Phone number is required." });
    }

    // Format the phone number
    const formattedPhone = formatPhoneNumber(phone);

    const contactsCollectionRef = db.collection(
      `companies/${companyId}/contacts`
    );

    // Use the formatted phone number as the document ID
    const contactDocRef = contactsCollectionRef.doc(formattedPhone);

    // Check if a contact with this phone number already exists
    const existingContact = await contactDocRef.get();
    if (existingContact.exists) {
      return res
        .status(409)
        .json({ error: "A contact with this phone number already exists." });
    }

    const chat_id = formattedPhone.split("+")[1] + "@c.us";

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
      unreadCount: 0,
    };

    // Add new contact to Firebase
    await contactDocRef.set(contactData);

    res
      .status(201)
      .json({ message: "Contact added successfully!", contact: contactData });
  } catch (error) {
    console.error("Error adding contact:", error);
    res
      .status(500)
      .json({
        error: "An error occurred while adding the contact: " + error.message,
      });
  }
});

// Helper function to format phone number (you'll need to implement this)
function formatPhoneNumber(phone) {
  // Implement phone number formatting logic here
  // This is a placeholder implementation
  return phone.startsWith("+") ? phone : "+" + phone;
}

// ... existing code ...
app.get("/api/bots", async (req, res) => {
  try {
    const snapshot = await db.collection("companies").get();
    const botsPromises = snapshot.docs
      .filter((doc) => doc.data().v2)
      .map(async (doc) => {
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
                  console.error(
                    `Error getting client info for bot ${doc.id} phone ${index}:`,
                    err
                  );
                  return null;
                }
              }
              return null;
            })
          );
        }

        // Fetch employee emails from subcollection
        const employeeSnapshot = await db
          .collection("companies")
          .doc(doc.id)
          .collection("employee")
          .get();

        const employeeEmails = employeeSnapshot.docs
          .map((empDoc) => empDoc.data().email)
          .filter(Boolean);

        return {
          botName: doc.id,
          phoneCount: phoneCount,
          name: docData.name,
          v2: true,
          clientPhones: phoneInfoArray,
          assistantId: docData.assistantId || null,
          trialEndDate: docData.trialEndDate
            ? docData.trialEndDate.toDate()
            : null,
          trialStartDate: docData.trialStartDate
            ? docData.trialStartDate.toDate()
            : null,
          plan: docData.plan || null,
          employeeEmails: employeeEmails,
          category: docData.category || "juta",
          apiUrl: docData.apiUrl || null,
        };
      });

    const bots = await Promise.all(botsPromises);
    res.json(bots);
  } catch (error) {
    console.error("Error fetching bots:", error);
    res.status(500).json({ error: "Failed to fetch bots" });
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

    // Reference to company document
    const companyRef = db.collection("companies").doc(botId);

    // Check if company exists
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      return res.status(404).json({
        error: "Company not found",
      });
    }

    // Update the category
    await companyRef.update({
      category: category,
    });

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

    // Reference to the company document
    const companyRef = db.collection("companies").doc(botId);

    // Check if company exists
    const doc = await companyRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Bot not found" });
    }

    // Delete the trialEndDate field
    await companyRef.update({
      trialEndDate: admin.firestore.FieldValue.delete(),
    });

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

// ... existing code ...
// Modify the API route to get the QR code or authentication status
app.get("/api/bot-status/:companyId", async (req, res) => {
  const { companyId } = req.params;
  console.log("Calling bot-status");
  res.header("Access-Control-Allow-Origin", "http://localhost:5173");
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
      return res.status(404).json({ error: "Company not found" });
    }

    // Then get the bot status
    const botData = botMap.get(companyId);

    if (botData && Array.isArray(botData)) {
      if (botData.length === 1) {
        // Single phone
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
          }
        }

        res.json({
          status,
          qrCode,
          phoneInfo,
          companyId,
          v2: companyData.v2,
          trialEndDate: companyData.trial_end_date,
          apiUrl: companyData.api_url,
          phoneCount: companyData.phone_count,
        });
      } else {
        // Multiple phones
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
              }
            }

            return {
              phoneIndex: index,
              status: phone.status,
              qrCode: phone.qrCode,
              phoneInfo,
            };
          })
        );

        res.json({
          phones: statusArray,
          companyId,
          v2: companyData.v2,
          trialEndDate: companyData.trial_end_date,
          apiUrl: companyData.api_url,
          phoneCount: companyData.phone_count,
        });
      }
    } else {
      // Bot not initialized yet
      res.json({
        status: "initializing",
        qrCode: null,
        phoneInfo: null,
        companyId,
        v2: companyData.v2,
        trialEndDate: companyData.trial_end_date,
        apiUrl: companyData.api_url,
        phoneCount: companyData.phone_count,
      });
    }
  } catch (error) {
    console.error(`Error getting status for company ${companyId}:`, error);
    res.status(500).json({ error: "Failed to get status" });
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
  const contactID = companyId + '-' + chatId.split('@')[0];

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
        messageId: sentMessage.id._serialized,
        timestamp: sentMessage.timestamp,
        type: sentMessage.type,
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
    const phoneNumber = "+" + chatId.split("@")[0];

    // 4. Save to SQL
    try {
      let contactResult; // Declare the variable first
      addMessagetoPostgres(sentMessage, companyId, phoneNumber, '', requestedPhoneIndex, userName)

      // 5. Handle OpenAI integration for the receiver's contact
      if (contactResult.rows[0]?.thread_id) {
        console.log("Using existing thread:", contactResult.rows[0].thread_id);
        await handleOpenAIMyMessage(message, contactResult.rows[0].thread_id);
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

      console.log("\n=== Message Processing Complete ===");
      res.json({
        success: true,
        messageId: sentMessage.id._serialized,
        timestamp: sentMessage.timestamp,
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

//react to message
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

    // If successful, save the reaction to Firestore
    // First, find the contact document that contains this message
    const contactsRef = db
      .collection("companies")
      .doc(companyId)
      .collection("contacts");
    const contactsSnapshot = await contactsRef.get();

    let messageDoc = null;
    for (const contactDoc of contactsSnapshot.docs) {
      const messageRef = contactDoc.ref.collection("messages").doc(messageId);
      const msgDoc = await messageRef.get();
      if (msgDoc.exists) {
        messageDoc = msgDoc;
        // Update the message document with the reaction
        await messageRef.update({
          reaction: reaction || null,
          reactionTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        break;
      }
    }

    if (!messageDoc) {
      console.warn(
        `Message ${messageId} found in WhatsApp but not in Firestore`
      );
    }

    res.json({
      success: true,
      message: reaction
        ? "Reaction added successfully"
        : "Reaction removed successfully",
      messageId,
      reaction,
    });
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
      // Update the message in Firebase
      let phoneNumber = "+" + chatId.split("@")[0];
      const contactRef = db
        .collection("companies")
        .doc(companyId)
        .collection("contacts")
        .doc(phoneNumber);
      const messageRef = contactRef.collection("messages").doc(messageId);

      await messageRef.update({
        "text.body": newMessage,
        edited: true,
        editedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.json({ success: true, messageId: messageId });
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
    const { deleteForEveryone, phoneIndex: requestedPhoneIndex } = req.body; // Added phoneIndex to the request body

    const phoneIndex =
      requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0; // Determine phoneIndex

    try {
      // Get the client for this company from botMap
      const botData = botMap.get(companyId);
      if (!botData || !botData[phoneIndex] || !botData[phoneIndex].client) {
        // Use phoneIndex to access the client
        return res
          .status(404)
          .send("WhatsApp client not found for this company");
      }
      const client = botData[phoneIndex].client; // Get the client using phoneIndex

      // Get the chat
      const chat = await client.getChatById(chatId);

      // Fetch the message
      const messages = await chat.fetchMessages({ limit: 1, id: messageId });
      if (messages.length === 0) {
        return res.status(404).send("Message not found");
      }
      const message = messages[0];

      // Delete the message
      await message.delete(deleteForEveryone);

      // Delete the message from Firebase
      let phoneNumber = "+" + chatId.split("@")[0];
      const contactRef = db
        .collection("companies")
        .doc(companyId)
        .collection("contacts")
        .doc(phoneNumber);
      const messageRef = contactRef.collection("messages").doc(messageId);
      await messageRef.delete();

      res.json({ success: true, messageId: messageId });
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
      type: "image",
      ack: sentMessage.ack ?? 0,
    };

    const contactRef = db
      .collection("companies")
      .doc(companyId)
      .collection("contacts")
      .doc(phoneNumber);
    const messagesRef = contactRef.collection("messages");

    const messageDoc = messagesRef.doc(sentMessage.id._serialized);
    await messageDoc.set(messageData, { merge: true });

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

    if (!audioUrl) {
      return res.status(400).send("No audio URL provided");
    }

    // 2. Download the WebM file
    const tempWebmPath = path.join(os.tmpdir(), `temp_${Date.now()}.webm`);
    const tempMp4Path = path.join(os.tmpdir(), `temp_${Date.now()}.mp4`);
    const response = await axios({
      method: "get",
      url: audioUrl,
      responseType: "arraybuffer",
    });
    await fs.promises.writeFile(tempWebmPath, response.data);
    await new Promise((resolve, reject) => {
      exec(
        `${ffmpeg} -i ${tempWebmPath} -c:a aac -b:a 128k ${tempMp4Path}`,
        (error, stdout, stderr) => {
          if (error) {
            console.error(`FFmpeg error: ${error.message}`);
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });
    const media = MessageMedia.fromFilePath(tempMp4Path);
    media.mimetype = "audio/mp4";

    const sentMessage = await client.sendMessage(chatId, media, {
      sendAudioAsVoice: true,
    });

    // Clean up temporary files
    await fs.promises.unlink(tempWebmPath);
    await fs.promises.unlink(tempMp4Path);

    let phoneNumber = "+" + chatId.split("@")[0];

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
      type: "ptt", // Push To Talk (voice message)
      ack: sentMessage.ack ?? 0,
    };

    const contactRef = db
      .collection("companies")
      .doc(companyId)
      .collection("contacts")
      .doc(phoneNumber);
    const messagesRef = contactRef.collection("messages");
    const messageDoc = messagesRef.doc(sentMessage.id._serialized);
    await messageDoc.set(messageData, { merge: true });

    res.json({ success: true, messageId: sentMessage.id._serialized });
  } catch (error) {
    console.error("Error sending audio message:", error);
    if (error.stack) {
      console.error("Error stack:", error.stack);
    }
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
    res
      .status(500)
      .json({
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

app.post("/api/contacts/remove-tags", async (req, res) => {
  const { companyId, contactPhone, tagsToRemove } = req.body;

  if (
    !companyId ||
    !contactPhone ||
    !tagsToRemove ||
    !Array.isArray(tagsToRemove)
  ) {
    return res.status(400).json({
      error:
        "Missing required fields. Please provide companyId, contactPhone, and tagsToRemove array",
    });
  }

  try {
    const contactRef = db
      .collection("companies")
      .doc(companyId)
      .collection("contacts")
      .doc(contactPhone);

    const contactDoc = await contactRef.get();
    if (!contactDoc.exists) {
      return res.status(404).json({ error: "Contact not found" });
    }

    // Remove the specified tags using arrayRemove
    await contactRef.update({
      tags: admin.firestore.FieldValue.arrayRemove(...tagsToRemove),
    });

    // Get the updated contact data
    const updatedContact = await contactRef.get();

    res.json({
      success: true,
      message: "Tags removed successfully",
      updatedTags: updatedContact.data().tags,
    });
  } catch (error) {
    console.error("Error removing tags:", error);
    res.status(500).json({
      error: "Failed to remove tags",
      details: error.message,
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
      type: "video",
      userName: userName,
      ack: sentMessage.ack ?? 0,
    };

    const contactRef = db
      .collection("companies")
      .doc(companyId)
      .collection("contacts")
      .doc(phoneNumber);
    const messagesRef = contactRef.collection("messages");

    const messageDoc = messagesRef.doc(sentMessage.id._serialized);
    await messageDoc.set(messageData, { merge: true });

    res.json({ success: true, messageId: sentMessage.id._serialized });
  } catch (error) {
    console.error("Error sending video message:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/api/update-phone-indices/:companyId", async (req, res) => {
  const { companyId } = req.params;

  try {
    console.log(`Starting phone index update for company ${companyId}...`);

    // Get reference to contacts collection
    const contactsRef = db
      .collection("companies")
      .doc(companyId)
      .collection("contacts");

    // Get all contacts with phoneIndex 2
    const snapshot = await contactsRef.where("phoneIndex", "==", 2).get();

    let updatedCount = 0;
    let errors = [];

    // Process each contact
    for (const doc of snapshot.docs) {
      try {
        const updateData = {
          phoneIndex: 0,
          "last_message.phoneIndex": 0,
        };

        await contactsRef.doc(doc.id).update(updateData);
        updatedCount++;

        if (updatedCount % 100 === 0) {
          console.log(`Processed ${updatedCount} contacts...`);
        }
      } catch (docError) {
        errors.push({
          contactId: doc.id,
          error: docError.message,
        });
      }
    }

    const response = {
      success: true,
      message: `Update complete for company ${companyId}`,
      stats: {
        totalProcessed: snapshot.size,
        updated: updatedCount,
        errors: errors.length,
      },
    };

    if (errors.length > 0) {
      response.errors = errors;
    }

    console.log(`Completed updating phone indices for ${companyId}`);
    res.json(response);
  } catch (error) {
    console.error("Error updating phone indices:", error);
    res.status(500).json({
      error: "Failed to update phone indices",
      details: error.message,
    });
  }
});
app.post("/api/channel/create/:companyID", async (req, res) => {
  const { companyID } = req.params;
  const phoneCount = 1;

  try {
    // Optionally, fetch company info from the database
    const companyResult = await sqlDb.query(
      "SELECT * FROM companies WHERE company_id = $1",
      [companyID]
    );
    const company = companyResult.rows[0];

    // Create the assistant
    await createAssistant(companyID);

    // Respond to the client immediately
    res.json({
      success: true,
      message: "Channel created successfully. Bot initialization in progress.",
      companyId: companyID,
      company: company || null,
      botStatus: "initializing",
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
async function copyDirectory(source, target) {
  // Remove existing backup if it exists
  if (
    await fs.promises
      .access(target)
      .then(() => true)
      .catch(() => false)
  ) {
    await fs.promises.rm(target, { recursive: true, force: true });
  }

  // Create target directory
  await fs.promises.mkdir(target, { recursive: true });

  // Copy files with streaming to handle potential locks
  const files = await fs.promises.readdir(source);

  await Promise.all(
    files.map(async (file) => {
      const sourcePath = path.join(source, file);
      const targetPath = path.join(target, file);

      const stat = await fs.promises.stat(sourcePath);

      if (stat.isDirectory()) {
        await copyDirectory(sourcePath, targetPath);
      } else {
        await new Promise((resolve, reject) => {
          const readStream = fs.createReadStream(sourcePath);
          const writeStream = fs.createWriteStream(targetPath);

          readStream.on("error", reject);
          writeStream.on("error", reject);
          writeStream.on("finish", resolve);

          readStream.pipe(writeStream);
        });
      }
    })
  );
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
        let clientName = phoneCount == 1 ? botName : `${botName}_phone${i + 1}`;

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

// Add new function to manage phone status in Firebase
async function updatePhoneStatus(companyId, phoneIndex, status, details = {}) {
  try {
    const phoneStatusRef = db
      .collection("companies")
      .doc(companyId)
      .collection("phoneStatus")
      .doc(`phone${phoneIndex}`);

    await phoneStatusRef.set(
      {
        status,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        ...details,
      },
      { merge: true }
    );

    console.log(
      `Updated status for ${companyId} Phone ${phoneIndex + 1} to ${status}`
    );

    // Broadcast the new status
    broadcastStatus(companyId, status, phoneIndex);
  } catch (error) {
    console.error(
      `Error updating phone status in Firebase for ${companyId} Phone ${
        phoneIndex + 1
      }:`,
      error
    );
  }
}

// Add function to check phone status from Firebase
async function getPhoneStatus(companyId, phoneIndex) {
  try {
    const phoneStatusRef = db
      .collection("companies")
      .doc(companyId)
      .collection("phoneStatus")
      .doc(`phone${phoneIndex}`);

    const doc = await phoneStatusRef.get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error(
      `Error getting phone status from Firebase for ${companyId} Phone ${
        phoneIndex + 1
      }:`,
      error
    );
    return null;
  }
}
const monitoringIntervals = new Map();

function startPhoneMonitoring(botName, phoneIndex) {
  // Clear any existing interval for this bot/phone combination
  if (monitoringIntervals.has(`${botName}_${phoneIndex}`)) {
    clearInterval(monitoringIntervals.get(`${botName}_${phoneIndex}`));
  }
  console.log(
    `Starting phone monitoring for ${botName} Phone ${phoneIndex + 1}`
  );
  const intervalId = setInterval(async () => {
    try {
      const statusDoc = await db
        .collection("companies")
        .doc(botName)
        .collection("phoneStatus")
        .doc(`phone${phoneIndex}`)
        .get();

      if (statusDoc.exists && statusDoc.data().status === "initializing") {
        console.log(
          `${botName} Phone ${
            phoneIndex + 1
          } - Still initializing, running cleanup...`
        );

        const { spawn } = require("child_process");
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
// Modify initializeWithTimeout to include Firebase status checks
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
    const doc = await db
      .collection("companies")
      .doc(botName)
      .collection("phoneStatus")
      .doc(`phone${phoneIndex}`)
      .get();

    if (
      doc.exists &&
      doc.data().status === "ready" &&
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

    try {
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: clientName,
        }),
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
          const statusDoc = await db
            .collection("companies")
            .doc(botName)
            .collection("phoneStatus")
            .doc(`phone${phoneIndex}`)
            .get();

          if (statusDoc.exists && statusDoc.data().status === "initializing") {
            console.log(
              `${botName} Phone ${
                phoneIndex + 1
              } - Still initializing, running cleanup...`
            );

            clearInterval(checkInitialization);
          }
        } catch (error) {
          console.error(`Error checking initialization status: ${error}`);
        }
      }, 30000); // Check every 30 seconds

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

          const { spawn } = require("child_process");
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

          const botData = botMap.get(botName);
          if (botData?.[phoneIndex]?.client) {
            try {
              const browser = botData[phoneIndex].client.pupPage?.browser();
              if (browser) {
                await browser
                  .close()
                  .catch((err) => console.log("Browser close error:", err));
              }
              await botData[phoneIndex].client
                .destroy()
                .catch((err) => console.log("Client destroy error:", err));
            } catch (closeError) {
              console.log("Error closing existing client:", closeError);
            }

            botData[phoneIndex].client = null;
            botMap.set(botName, botData);
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));

          console.log(
            `${botName} Phone ${phoneIndex + 1} - Running cleanup...`
          );
          const { spawn } = require("child_process");
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
      // clearInterval(checkInitialization);
      await updatePhoneStatus(botName, phoneIndex, "error", {
        error: error.message,
      });
      try {
        const statusDoc = await db
          .collection("companies")
          .doc(botName)
          .collection("phoneStatus")
          .doc(`phone${phoneIndex}`)
          .get();

        if (statusDoc.exists && statusDoc.data().status === "initializing") {
          console.log(
            `${botName} Phone ${
              phoneIndex + 1
            } - Still initializing, running cleanup...`
          );

          const { spawn } = require("child_process");
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
    }
  });
}
async function reinitializeClient(client, botName, phoneIndex) {
  try {
    console.log(`${botName} Phone ${phoneIndex + 1} - Reinitializing...`);
    await client.destroy();
    await client.initialize();
  } catch (error) {
    console.error(
      `${botName} Phone ${phoneIndex + 1} - Error reinitializing:`,
      error
    );
    // Handle the error, possibly retry or log for further investigation
  }
}
async function sendAlertToEmployees(companyId) {
  try {
    // Ensure the client for bot 001 is initialized and ready
    const botData = botMap.get("001");
    if (!botData || !botData[0]?.client || botData[0].status !== "ready") {
      console.error("Client for bot 001 is not initialized or not ready.");
      return;
    }

    const client = botData[0].client;

    // Fetch employees from the target companyId
    const employeesSnapshot = await db
      .collection("companies")
      .doc(companyId)
      .collection("employee")
      .get();
    console.log(
      `Fetched ${employeesSnapshot.size} employees for company ${companyId}.`
    );

    if (employeesSnapshot.empty) {
      console.warn(`No employees found for company ${companyId}.`);
      return;
    }

    const employees = employeesSnapshot.docs
      .map((doc) => doc.data())
      .filter((emp) => emp.role === "1");
    console.log(`Filtered ${employees.length} employees with role '1'.`);

    if (employees.length === 0) {
      console.warn(
        `No employees with role '1' found for company ${companyId}.`
      );
      return;
    }

    const alertMessage = `[ALERT] WhatsApp Connection Disconnected\n\nACTION REQUIRED:\n\n1. Navigate to web.jutasoftware.co.\n2. Log in to your account.\n3. Scan the QR code to reinitialize your WhatsApp connection.\n\nFor support, please contact +601121677672`;

    for (const emp of employees) {
      if (emp.phoneNumber) {
        const employeeID = emp.phoneNumber.replace("+", "") + "@c.us";
        console.log(`Sending alert to ${emp.phoneNumber}`);
        try {
          await client.sendMessage(employeeID, alertMessage);
          console.log(
            `Alert sent to ${emp.phoneNumber} about ${companyId} QR status`
          );
        } catch (sendError) {
          console.error(
            `Failed to send message to ${emp.phoneNumber}:`,
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
    if (client.readyState === WebSocket.OPEN && client.isLogsViewer) {
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
  });
}
async function createAssistant(companyID) {
  const OPENAI_API_KEY = process.env.OPENAIKEY; // Ensure your environment variable is set
  const payload = {
    name: companyID,
    model: "gpt-4o", // Ensure this model is supported and available
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
    const companiesCollection = db.collection("companies");

    // Save the whapiToken to a new document
    await companiesCollection.doc(companyID).set(
      {
        assistantId: assistantId,
        v2: true,
      },
      { merge: true }
    );
    return;
  } catch (error) {
    console.error(
      "Error creating OpenAI assistant:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({ error: "Failed to create assistant" });
  }
}

main().catch((error) => {
  console.error("Error during initialization:", error);
  process.exit(1);
});

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n=== Graceful Shutdown Initiated ===");

  try {
    // 1. Close Queue Workers
    console.log("Closing queue workers...");
    const workerShutdownPromises = [];
    for (const [botId, worker] of botWorkers.entries()) {
      workerShutdownPromises.push(
        worker
          .close()
          .then(() => console.log(`Queue worker closed for bot ${botId}`))
          .catch((err) =>
            console.error(`Error closing queue worker for bot ${botId}:`, err)
          )
      );
    }

    // 2. Close WhatsApp Clients
    console.log("Closing WhatsApp clients...");
    const clientShutdownPromises = [];

    for (const [botName, botData] of botMap.entries()) {
      if (Array.isArray(botData)) {
        // Multiple clients for this bot
        for (const { client } of botData) {
          if (client && typeof client.destroy === "function") {
            clientShutdownPromises.push(
              client
                .destroy()
                .then(() =>
                  console.log(`WhatsApp client destroyed for bot ${botName}`)
                )
                .catch((err) =>
                  console.error(
                    `Error destroying WhatsApp client for bot ${botName}:`,
                    err
                  )
                )
            );

            // Handle Puppeteer browser cleanup
            if (client?.pupPage) {
              clientShutdownPromises.push(
                client.pupPage
                  .browser()
                  .close()
                  .then(() => console.log(`Browser closed for bot ${botName}`))
                  .catch((err) =>
                    console.error(
                      `Error closing browser for bot ${botName}:`,
                      err
                    )
                  )
              );
            }
          }
        }
      } else if (botData?.client?.destroy) {
        // Single client for this bot
        clientShutdownPromises.push(
          botData.client
            .destroy()
            .then(() =>
              console.log(`WhatsApp client destroyed for bot ${botName}`)
            )
            .catch((err) =>
              console.error(
                `Error destroying WhatsApp client for bot ${botName}:`,
                err
              )
            )
        );
      }
    }

    // 3. Wait for all cleanup operations to complete
    console.log("Waiting for all cleanup operations...");
    await Promise.allSettled([
      ...workerShutdownPromises,
      ...clientShutdownPromises,
    ]);

    // 4. Clear all maps and connections
    botWorkers.clear();
    botQueues.clear();
    botMap.clear();

    // 5. Close Redis connection
    if (connection) {
      console.log("Closing Redis connection...");
      await connection.disconnect();
    }

    console.log("\n=== Cleanup Complete ===");
    console.log("Workers closed:", botWorkers.size === 0);
    console.log("Queues cleared:", botQueues.size === 0);
    console.log("WhatsApp clients cleared:", botMap.size === 0);

    // Small delay to ensure all logs are written
    await new Promise((resolve) => setTimeout(resolve, 1000));

    process.exit(0);
  } catch (error) {
    console.error("\n=== Shutdown Error ===");
    console.error("Error Type:", error.name);
    console.error("Error Message:", error.message);
    console.error("Stack:", error.stack);

    // Force exit after error
    process.exit(1);
  }
});

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

process.on("unhandledRejection", (reason, promise) => {
  console.error("\n=== Unhandled Rejection ===");
  console.error("Reason:", reason);
  process.emit("SIGINT");
});

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
      if (
        file.endsWith(".db-journal") ||
        file.endsWith(".db-wal") ||
        file.endsWith(".db-shm")
      ) {
        try {
          await fs.promises.unlink(filePath);
          console.log(`Cleaned up locked file: ${filePath}`);
        } catch (err) {
          console.warn(
            `Warning: Could not delete locked file ${filePath}:`,
            err
          );
        }
      }
    }
  } catch (error) {
    console.warn(
      `Warning: Error cleaning up locked files in ${dirPath}:`,
      error
    );
  }
}

async function cleanupAndWait(dirPath, maxRetries = 5) {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      // Check if directory exists first
      if (!fs.existsSync(dirPath)) {
        return;
      }

      if (process.platform === "win32") {
        // For Windows, try multiple cleanup methods
        try {
          // First try native Windows delete
          await new Promise((resolve, reject) => {
            exec(`rmdir /s /q "${dirPath}"`, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        } catch (winError) {
          console.warn(
            `Windows delete failed, trying fs.rm: ${winError.message}`
          );
          // If Windows delete fails, try Node's fs.rm
          await fs.promises.rm(dirPath, { recursive: true, force: true });
        }
      } else {
        // For Unix-based systems
        await fs.promises.rm(dirPath, { recursive: true, force: true });
      }

      // Wait a bit to ensure cleanup is complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify directory is gone
      if (!fs.existsSync(dirPath)) {
        console.log(`Successfully cleaned up directory: ${dirPath}`);
        return;
      }

      throw new Error("Directory still exists after deletion attempt");
    } catch (error) {
      attempt++;
      console.warn(
        `Attempt ${attempt}/${maxRetries} failed to clean up ${dirPath}:`,
        error
      );

      if (attempt === maxRetries) {
        throw new Error(
          `Failed to clean up directory after ${maxRetries} attempts: ${dirPath}`
        );
      }

      // Exponential backoff wait between attempts
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 10000))
      );
    }
  }
}

// Update the cleanupSession function to handle locked files first
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

        console.log("Browser instance closed successfully");
      } catch (browserError) {
        console.warn("Error closing browser:", browserError);
      }
    }

    // Wait for browser to fully close
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Handle lockfile specifically
    const lockfilePath = path.join(sessionDir, "lockfile");
    if (
      await fs.promises
        .access(lockfilePath)
        .then(() => true)
        .catch(() => false)
    ) {
      try {
        // Try multiple times to delete the lockfile
        for (let i = 0; i < 3; i++) {
          try {
            await fs.promises.unlink(lockfilePath);
            console.log(`Deleted lockfile: ${lockfilePath}`);
            break;
          } catch (lockError) {
            if (i < 2) {
              console.log(
                `Attempt ${i + 1} to delete lockfile failed, waiting...`
              );
              await new Promise((resolve) => setTimeout(resolve, 2000));
            } else {
              throw lockError;
            }
          }
        }
      } catch (lockError) {
        console.warn(
          `Warning: Could not delete lockfile: ${lockError.message}`
        );
        // Continue even if lockfile deletion fails
      }
    }

    // Now try to delete the directories
    if (
      await fs.promises
        .access(sessionDir)
        .then(() => true)
        .catch(() => false)
    ) {
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
            console.warn(
              `Warning: Could not delete file ${file}: ${fileError.message}`
            );
          }
        }
        // Try to remove the directory one last time
        await fs.promises.rmdir(sessionDir);
      }
    }

    if (
      authDir &&
      (await fs.promises
        .access(authDir)
        .then(() => true)
        .catch(() => false))
    ) {
      await fs.promises.rm(authDir, { recursive: true, force: true });
      console.log(`Deleted auth directory: ${authDir}`);
    }
  } catch (error) {
    console.error("Error during session cleanup:", error);
    // Continue execution even if cleanup fails
  }
}

// New endpoint to fetch message details from Firebase
app.get(
  "/api/queue/message-details/:companyId/:messageId",
  async (req, res) => {
    try {
      const { companyId, messageId } = req.params;

      // Get the main message document
      const messageDoc = await db
        .collection("companies")
        .doc(companyId)
        .collection("scheduledMessages")
        .doc(messageId)
        .get();

      if (!messageDoc.exists) {
        return res.status(404).json({ error: "Message not found" });
      }

      // Get all batches for this message
      const batchesSnapshot = await db
        .collection("companies")
        .doc(companyId)
        .collection("scheduledMessages")
        .doc(messageId)
        .collection("batches")
        .get();

      const messageData = messageDoc.data();
      const batches = [];

      batchesSnapshot.forEach((doc) => {
        batches.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      res.json({
        messageDetails: {
          id: messageId,
          ...messageData,
          batches,
        },
      });
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
      "SELECT id, company_id, name, email, phone, plan, v2, phone_count, assistant_id FROM companies WHERE company_id = $1",
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
        .filter((tag) => !employeeNames.includes(tag.name.toLowerCase()));
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
        assistant_id: companyData.assistant_id, // Added this line
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

    // Get phone count from phone_status table
    const phoneCountResult = await sqlDb.getRow(
      "SELECT COUNT(DISTINCT phone_number) as count FROM phone_status WHERE company_id = $1",
      [companyId]
    );
    const phoneCount = phoneCountResult ? phoneCountResult.count : 1;

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
        .filter((tag) => !employeeNames.includes(tag.name.toLowerCase()));
    }

    // Prepare response
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

// Get contacts for a company with authentication
app.get("/api/companies/:companyId/contacts", async (req, res) => {
  try {
    const { email } = req.query;
    const { companyId } = req.params;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
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

    // Fetch all contacts for the company
    const contacts = await sqlDb.getRows(
      `
      SELECT 
        c.id,
        c.contact_id,
        c.name,
        c.phone,
        c.email,
        c.thread_id,
        c.profile,
        c.profile_pic_url,
        c.tags,
        c.created_at,
        c.last_updated,
        CASE 
          WHEN c.thread_id LIKE '%@c.us' THEN true 
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
        name: contact.name || "",
        phone: contact.phone || "",
        email: contact.email || "",
        chat_id: contact.thread_id || "",
        profileUrl: contact.profile_pic_url || "",
        profile: contact.profile || {},
        tags: tags,
        assignedTo: assignedTo,
        createdAt: contact.created_at,
        lastUpdated: contact.last_updated,
        isIndividual: contact.is_individual,
        last_message: contact.last_message || null,
      };
    });

    // Filter contacts based on user role
    // const filteredContacts = filterContactsByUserRole(processedContacts, userData.role, userData.name);

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

    const result = await sqlDb.query(
      `SELECT m.*, c.name as contact_name 
       FROM messages m
       LEFT JOIN contacts c ON m.contact_id = c.contact_id AND m.company_id = c.company_id
       WHERE m.chat_id = $1 AND m.company_id = $2 
       ORDER BY m.timestamp ASC`,
      [chatId, companyId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching messages:", error);
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
