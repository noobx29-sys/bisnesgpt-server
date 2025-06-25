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

// Third-party Libraries
// Framework & Middleware
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

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
let companyConfig = {};

// ======================
// 3. SERVICE CONNECTIONS
// ======================

// Database connections
const sql = neon(process.env.DATABASE_URL); // Direct SQL queries
const pool = new Pool({
  // Connection pooling
  connectionString: process.env.DATABASE_URL,
  max: 2000,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
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

// CORS Configuration
const corsOptions = {
  origin: true,
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

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

// Preflight OPTIONS handler
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:5173");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  res.sendStatus(204);
});

// ======================
// 6. ROUTES
// ======================

// Basic Routes
app.get("/", (req, res) => res.send("Bot is running"));
app.get("/logs", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "logs.html"))
);
app.get("/status", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "status.html"))
);
app.get("/queue", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "queue.html"))
);

// Webhook Handlers
app.post("/extremefitness/blast", async (req, res) => {
  const botData = botMap.get("074");
  if (!botData)
    return res.status(404).json({ error: "WhatsApp client not found" });
  await handleExtremeFitnessBlast(req, res, botData[0].client);
});

app.post("/hajoon/blast", async (req, res) => {
  const botData = botMap.get("045");
  if (!botData)
    return res.status(404).json({ error: "WhatsApp client not found" });
  await handleHajoonCreateContact(req, res, botData[0].client);
});

app.post("/juta/blast", async (req, res) => {
  const botData = botMap.get("001");
  if (!botData)
    return res.status(404).json({ error: "WhatsApp client not found" });
  await handleJutaCreateContact(req, res, botData[0].client);
});

app.post("/zahin/hubspot", (req, res) => {
  const getClient = () => botMap.get("042")?.[0].client;
  handleZahinHubspot(req, res, getClient);
});

// API Handlers
// app.post("/api/bina/tag", handleBinaTag);
// app.post("/api/edward/tag", handleEdwardTag);
app.post("/api/tag/followup", handleTagFollowUp);

// Custom Bots
const customHandlers = {};
app.post("/zakat", async (req, res) => {
  try {
    const botData = botMap.get("0124");
    if (!botData) throw new Error("WhatsApp client not found for zakat");
    await handleZakatBlast(req, res, botData[0].client);
  } catch (error) {
    console.error("Error processing zakat form:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// 7. SERVER INITIALIZATION
// ======================

const port = process.env.PORT;
server.listen(port, () => console.log(`Server is running on port ${port}`));

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

function broadcastNewMessageToChat(chatId, message, whapiToken) {
  if (chatSubscriptions.has(chatId)) {
    for (const ws of chatSubscriptions.get(chatId)) {
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "new_message",
            chatId,
            message,
            whapiToken,
          })
        );
      }
    }
  }
}

module.exports = { broadcastNewMessageToChat };

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
  ws.subscribedChatId = null;

  // Handle messages from client
  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);
      // Handle chat subscription
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
      console.log("Creating user in Neon Auth:", userData, name);
      // Create user in Neon Auth (only required fields)
      // Create user in Neon Auth
      const neonUser = await createNeonAuthUser(decodedEmail, name);

      // Generate a unique user ID and company ID
      const userId = uuidv4();
      const companyId = `0${Date.now()}`;

      // Create company in database
      // await sqlDb.query(
      //   `INSERT INTO companies (company_id, name, email, phone, status, enabled, created_at) 
      //   VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      //   [
      //     companyId,
      //     userData.email.split("@")[0],
      //     userData.email,
      //     userData.phoneNumber,
      //     "active",
      //     true,
      //   ]
      // );

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
    await client.query("ROLLBACK");
    console.error("Error processing contact:", error);
    throw error;
  } finally {
    client.release();
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

      const chatIds = scheduledMessage.chatIds || [];
      const totalMessages =
        scheduledMessage.messages?.length > 0
          ? chatIds.length * scheduledMessage.messages.length
          : chatIds.length;

      const batchSize = scheduledMessage.batchQuantity || totalMessages;
      const numberOfBatches = Math.ceil(totalMessages / batchSize);

      const mainMessageQuery = `
        INSERT INTO scheduled_messages (
          id, schedule_id, company_id, contact_id, message_content, media_url, 
          scheduled_time, status, created_at, chat_id, phone_index, is_media,
          document_url, file_name, caption, chat_ids, batch_quantity, repeat_interval,
          repeat_unit, message_delays, infinite_loop, min_delay, max_delay, activate_sleep,
          sleep_after_messages, sleep_duration, active_hours, from_me
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 
          $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
      `;
      console.log("scheduledTime received:", scheduledMessage.scheduledTime);
      const scheduledTime = toPgTimestamp(scheduledMessage.scheduledTime);
      console.log("scheduledTime parsed:", scheduledTime);
      await client.query(mainMessageQuery, [
        messageId,
        messageId,
        companyId,
        scheduledMessage.contactId || null,
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
      ]);

      const queue = getQueueForBot(companyId);
      const batches = [];

      for (let batchIndex = 0; batchIndex < numberOfBatches; batchIndex++) {
        const startIndex = batchIndex * batchSize;
        const endIndex = Math.min((batchIndex + 1) * batchSize, totalMessages);

        const batchDelay =
          batchIndex *
          scheduledMessage.repeatInterval *
          getMillisecondsForUnit(scheduledMessage.repeatUnit);
        const batchScheduledTime = new Date(
          toPgTimestamp(scheduledMessage.scheduledTime).getTime() + batchDelay
        );

        const batchId = uuidv4(); // generate a valid UUID for each batch

        const batchQuery = `
        INSERT INTO scheduled_messages (
          id, schedule_id, company_id, scheduled_time, status, created_at,
          batch_index, chat_ids, phone_index, from_me, message_content, media_url, document_url, file_name, caption
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `;
        await client.query(batchQuery, [
          batchId,
          messageId,
          companyId,
          batchScheduledTime,
          "pending",
          new Date(),
          batchIndex,
          JSON.stringify(chatIds.slice(startIndex, endIndex)),
          phoneIndex,
          true,
          scheduledMessage.message || null,
          scheduledMessage.mediaUrl || null,
          scheduledMessage.documentUrl || null,
          scheduledMessage.fileName || null,
          scheduledMessage.caption || null,
        ]);
        batches.push({ id: batchId, scheduledTime: batchScheduledTime });
      }

      await client.query("COMMIT");

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

      res.status(201).json({
        id: messageId,
        message: "Message scheduled successfully",
        batches: batches.length,
        success: true,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
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

  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        "DELETE FROM scheduled_messages WHERE schedule_id = $1 AND id != $1",
        [messageId]
      );

      const updateQuery = `
        UPDATE scheduled_messages SET
          message_content = $1,
          media_url = $2,
          scheduled_time = $3,
          status = $4,
          phone_index = $5,
          is_media = $6,
          document_url = $7,
          file_name = $8,
          caption = $9,
          chat_ids = $10,
          batch_quantity = $11,
          repeat_interval = $12,
          repeat_unit = $13,
          message_delays = $14,
          infinite_loop = $15,
          min_delay = $16,
          max_delay = $17,
          activate_sleep = $18,
          sleep_after_messages = $19,
          sleep_duration = $20,
          active_hours = $21
        WHERE id = $22 AND company_id = $23
      `;

      const isMediaMessage = Boolean(
        updatedMessage.mediaUrl || updatedMessage.documentUrl
      );
      const messageCaption =
        updatedMessage.caption || updatedMessage.message || "";

      await client.query(updateQuery, [
        updatedMessage.message || null,
        updatedMessage.mediaUrl || null,
        toPgTimestamp(updatedMessage.scheduledTime),
        updatedMessage.status || "scheduled",
        phoneIndex,
        isMediaMessage,
        updatedMessage.documentUrl || null,
        updatedMessage.fileName || null,
        messageCaption,
        JSON.stringify(updatedMessage.chatIds || []),
        updatedMessage.batchQuantity || null,
        updatedMessage.repeatInterval || null,
        updatedMessage.repeatUnit || null,
        updatedMessage.messageDelays
          ? JSON.stringify(updatedMessage.messageDelays)
          : null,
        updatedMessage.infiniteLoop || false,
        updatedMessage.minDelay || null,
        updatedMessage.maxDelay || null,
        updatedMessage.activateSleep || false,
        updatedMessage.sleepAfterMessages || null,
        updatedMessage.sleepDuration || null,
        updatedMessage.activeHours
          ? JSON.stringify(updatedMessage.activeHours)
          : null,
        messageId,
        companyId,
      ]);

      if (updatedMessage.status === "scheduled") {
        const chatIds = updatedMessage.chatIds || [];
        const totalMessages =
          updatedMessage.messages?.length > 0
            ? chatIds.length * updatedMessage.messages.length
            : chatIds.length;

        const batchSize = updatedMessage.batchQuantity || totalMessages;
        const numberOfBatches = Math.ceil(totalMessages / batchSize);
        const queue = getQueueForBot(companyId);
        const batches = [];

        for (let batchIndex = 0; batchIndex < numberOfBatches; batchIndex++) {
          const startIndex = batchIndex * batchSize;
          const endIndex = Math.min(
            (batchIndex + 1) * batchSize,
            totalMessages
          );

          const batchDelay =
            batchIndex *
            updatedMessage.repeatInterval *
            getMillisecondsForUnit(updatedMessage.repeatUnit);
          const batchScheduledTime = new Date(
            toPgTimestamp(updatedMessage.scheduledTime).getTime() + batchDelay
          );

          const batchId = uuidv4(); // generate a valid UUID for each batch

          const batchQuery = `
            INSERT INTO scheduled_messages (
              id, schedule_id, company_id, scheduled_time, status, created_at,
              batch_index, chat_ids, phone_index, from_me
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `;

          await client.query(batchQuery, [
            batchId,
            messageId,
            companyId,
            batchScheduledTime,
            "pending",
            new Date(),
            batchIndex,
            JSON.stringify(chatIds.slice(startIndex, endIndex)),
            phoneIndex,
            true,
          ]);

          batches.push({ id: batchId, scheduledTime: batchScheduledTime });
        }

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
      }

      await client.query("COMMIT");

      res.json({
        id: messageId,
        message: "Message updated successfully",
        success: true,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
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
        "SELECT id FROM scheduled_messages WHERE id = $1 AND company_id = $2";
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

      const deleteQuery =
        "DELETE FROM scheduled_messages WHERE (id = $1 OR schedule_id = $1) AND company_id = $2";
      const deleteResult = await client.query(deleteQuery, [
        messageId,
        companyId,
      ]);

      await client.query("COMMIT");

      res.json({
        id: messageId,
        message: "Message deleted successfully",
        success: true,
        batchesDeleted: deleteResult.rowCount - 1,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error deleting scheduled message:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to delete scheduled message",
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
          AND status = 'pending'
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
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
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
      LEFT JOIN contacts c ON a.contact_id = c.id AND a.company_id = c.company_id
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
            chat_data, company, thread_id, last_message, profile_pic_url
          ) VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, NOW(), NOW(), $6, $7, $8, '{}'::jsonb, $9)
          ON CONFLICT (contact_id, company_id) DO UPDATE SET
            name = EXCLUDED.name,
            last_updated = NOW(),
            profile_pic_url = EXCLUDED.profile_pic_url,
            unread_count = EXCLUDED.unread_count;
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

        // Fetch and insert messages
        const messages = await chat.fetchMessages({ limit: 10 }); // Adjust limit as needed

        for (const msg of messages) {
          const messageQuery = `
            INSERT INTO public.messages (
              message_id, company_id, contact_id, thread_id, customer_phone, content, 
              message_type, media_url, timestamp, direction, status, from_me, chat_id, author
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (message_id) DO NOTHING;
          `;

          let mediaUrl = null;
          if (msg.hasMedia) {
            // Media download can be time-consuming; consider handling this differently
            // const media = await msg.downloadMedia();
            // mediaUrl = media.filename; // Or some other identifier
          }

          await sqlDb.query(messageQuery, [
            msg.id._serialized,
            companyId,
            contactID,
            chat.id._serialized,
            contactPhone,
            msg.body || "",
            msg.type,
            mediaUrl,
            new Date(msg.timestamp * 1000),
            msg.fromMe ? "outbound" : "inbound",
            "delivered",
            msg.fromMe,
            chat.id._serialized,
            msg.author || contactID,
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

// Create a worker factory function with duplicate message prevention
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
    },
  });

  queue.on("active", async (job) => {
    if (job.name === "send-message-batch") {
      const { companyId, messageId, batchId } = job.data;

      try {
        const client = await pool.connect();
        try {
          const batchQuery = `
            SELECT * FROM scheduled_messages 
            WHERE id = $1 AND company_id = $2
          `;
          const batchResult = await client.query(batchQuery, [
            batchId,
            companyId,
          ]);

          if (batchResult.rowCount === 0) {
            console.error(`Bot ${botId} - Batch ${batchId} not found`);
            return;
          }

          const batchData = batchResult.rows[0];
          const messages = batchData.messages
            ? JSON.parse(batchData.messages)
            : [];

          if (messages.length > 0) {
            const chatId = `${companyId}_${messages[0].chatId}`;

            if (processingChatIds.has(chatId)) {
              const processingStartTime = processingChatIds.get(chatId);
              const currentTime = Date.now();
              const processingTime = (currentTime - processingStartTime) / 1000;

              console.log(
                `Bot ${botId} - Detected duplicate message for chatId ${chatId} (already processing for ${processingTime}s)`
              );

              if (processingTime < 300) {
                job.data.isDuplicate = true;
                await job.updateData(job.data);

                await client.query(
                  `UPDATE scheduled_messages SET 
                    status = $1, 
                    skipped_reason = $2, 
                    skipped_at = NOW() 
                   WHERE id = $3`,
                  ["skipped", "Duplicate message for same chatId", batchId]
                );

                console.log(
                  `Bot ${botId} - Marked job ${job.id} as duplicate for chatId ${chatId}`
                );
              }
            } else {
              processingChatIds.set(chatId, Date.now());
              console.log(
                `Bot ${botId} - Reserved chatId ${chatId} for processing`
              );
            }
          }
        } finally {
          client.release();
        }
      } catch (error) {
        console.error(`Bot ${botId} - Error in pre-processing check:`, error);
      }
    }
  });

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
          console.log(
            `Bot ${botId} - Skipping duplicate job ${job.id} for batch ${batchId}`
          );
          return { skipped: true, reason: "Duplicate message" };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const batchQuery = `
            SELECT * FROM scheduled_messages 
            WHERE id = $1 AND company_id = $2
            FOR UPDATE
          `;
          const batchResult = await client.query(batchQuery, [
            batchId,
            companyId,
          ]);

          if (batchResult.rowCount === 0) {
            console.error(`Bot ${botId} - Batch ${batchId} not found`);
            return;
          }

          const batchData = batchResult.rows[0];

          if (batchData.status === "skipped") {
            console.log(
              `Bot ${botId} - Batch ${batchId} was already marked as skipped, not processing`
            );
            return {
              skipped: true,
              reason: batchData.skipped_reason || "Already skipped",
            };
          }

          try {
            console.log(
              `Bot ${botId} - Sending scheduled message batch:`,
              batchData
            );
            const result = await sendScheduledMessage(batchData);

            if (result.success) {
              await client.query(
                "UPDATE scheduled_messages SET status = $1, sent_at = NOW() WHERE id = $2",
                ["sent", batchId]
              );
              const batchesCheckQuery = `
              SELECT COUNT(*) as pending_count 
              FROM scheduled_messages 
              WHERE schedule_id = $1 
              AND company_id = $2 
              AND status != 'sent'
              AND id::text != schedule_id::text
            `;
              const batchesCheck = await client.query(batchesCheckQuery, [
                messageId,
                companyId,
              ]);

              if (batchesCheck.rows[0].pending_count === 0) {
                await client.query(
                  "UPDATE scheduled_messages SET status = $1 WHERE id = $2",
                  ["completed", messageId]
                );
              }
            } else {
              console.error(
                `Bot ${botId} - Failed to send batch ${batchId}:`,
                result.error
              );
              await client.query(
                "UPDATE scheduled_messages SET status = $1 WHERE id = $2",
                ["failed", batchId]
              );
              await client.query(
                "UPDATE scheduled_messages SET status = $1 WHERE id = $2",
                ["failed", messageId]
              );
            }

            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            console.error(
              `Bot ${botId} - Error processing scheduled message batch:`,
              error
            );
            throw error;
          }
        } catch (error) {
          console.error(
            `Bot ${botId} - Error processing scheduled message batch:`,
            error
          );
          throw error;
        } finally {
          client.release();
        }
      }
    },
    {
      connection: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD,
      },
      concurrency: 50,
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
  );

  worker.on("completed", async (job) => {
    console.log(`Bot ${botId} - Job ${job.id} completed successfully`);

    if (
      job.name === "send-message-batch" &&
      job.data.companyId &&
      job.data.batchId
    ) {
      try {
        const client = await pool.connect();
        try {
          const batchQuery = `
            SELECT chat_ids FROM scheduled_messages 
            WHERE id = $1 AND company_id = $2
          `;
          const batchResult = await client.query(batchQuery, [
            job.data.batchId,
            job.data.companyId,
          ]);

          if (batchResult.rowCount > 0 && batchResult.rows[0].chat_ids) {
            let chatIds;
            const chatIdsData = batchResult.rows[0].chat_ids;

            try {
              // Try to parse as JSON array first
              chatIds = JSON.parse(chatIdsData);
            } catch (parseError) {
              // If parsing fails, treat it as a single string
              chatIds = [chatIdsData];
            }

            if (chatIds.length > 0) {
              const chatId = chatIds[0];
              if (processingChatIds.has(chatId)) {
                processingChatIds.delete(chatId);
                console.log(
                  `Bot ${botId} - Released chatId ${chatId} after processing`
                );
              }
            }
          }
        } finally {
          client.release();
        }
      } catch (error) {
        console.error(`Bot ${botId} - Error releasing chatId:`, error);
      }
    }

    await job.updateProgress(100);
    await job.updateData({
      ...job.data,
      completedAt: new Date(),
      status: "completed",
    });
  });

  worker.on("failed", async (job, err) => {
    console.error(`Bot ${botId} - Job ${job.id} failed:`, err);
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
}, 60000);

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
  const companyId = message.company_id;
  const client = await pool.connect();

  try {
    console.log(
      `\n=== [Company ${companyId}] Starting sendScheduledMessage ===`
    );

    if (message.phone_index === null || message.phone_index === undefined) {
      message.phone_index = 0;
    }
    message.phone_index = parseInt(message.phone_index);
    if (isNaN(message.phone_index)) {
      message.phone_index = 0;
    }

    const botData = botMap.get(companyId);
    console.log(
      "Available phone indices:",
      botData ? botData.map((_, i) => i) : []
    );
    console.log("Client status:", {
      phoneIndex: message.phone_index,
      hasClient: Boolean(botData?.[message.phone_index]?.client),
      clientInfo: botData?.[message.phone_index]?.client
        ? "Client exists"
        : null,
    });

    if (!botData?.[message.phone_index]?.client) {
      throw new Error(
        `No active WhatsApp client found for phone index: ${message.phone_index}`
      );
    }

    if (message) {
      console.log(`\n=== [Company ${companyId}] Processing V2 Message ===`);

      let messages = [];
      let chatIds = [];
      if (message.chat_ids) {
        if (Array.isArray(message.chat_ids)) {
          chatIds = message.chat_ids;
        } else if (typeof message.chat_ids === "string") {
          try {
            // Try to parse as JSON array
            chatIds = JSON.parse(message.chat_ids);
            if (typeof chatIds === "string") {
              chatIds = [chatIds];
            }
          } catch (e) {
            // If parsing fails, treat as single string
            chatIds = [message.chat_ids];
          }
        } else {
          // Fallback: wrap in array
          chatIds = [message.chat_ids];
        }
      }

      if (!message.messages || JSON.parse(message.messages).length === 0) {
        messages = chatIds.map((chatId) => ({
          chatId: chatId,
          message: message.message_content,
          delay: Math.floor(
            Math.random() * (message.max_delay - message.min_delay + 1) +
              message.min_delay
          ),
          mediaUrl: message.media_url || "",
          documentUrl: message.document_url || "",
          fileName: message.file_name || "",
        }));
      } else {
        messages = JSON.parse(message.messages);
      }

      console.log(`[Company ${companyId}] Batch details:`, {
        messageId: message.id,
        infiniteLoop: message.infinite_loop,
        activeHours: message.active_hours
          ? JSON.parse(message.active_hours)
          : null,
        messages: messages.map((m) => ({
          chatId: m.chatId,
          messageLength: m.message?.length,
          delay: m.delay,
          hasMedia: Boolean(m.mediaUrl || m.documentUrl),
        })),
      });

      const processMessage = (messageText, contact) => {
        if (!messageText) return "";

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

        Object.entries(placeholders).forEach(([key, value]) => {
          const placeholder = `@{${key}}`;
          processedMessage = processedMessage.replace(
            new RegExp(placeholder, "g"),
            value
          );
        });

        if (contact?.custom_fields) {
          const customFields =
            typeof contact.custom_fields === "string"
              ? JSON.parse(contact.custom_fields)
              : contact.custom_fields;

          Object.entries(customFields).forEach(([key, value]) => {
            const customPlaceholder = `@{${key}}`;
            const stringValue =
              value !== null && value !== undefined ? String(value) : "";
            processedMessage = processedMessage.replace(
              new RegExp(customPlaceholder, "g"),
              stringValue
            );
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
        console.log(
          `Waiting ${timeUntilTomorrow / 1000 / 60} minutes until next day`
        );

        const messageCheck = await client.query(
          "SELECT status FROM scheduled_messages WHERE id = $1",
          [message.id]
        );

        if (
          messageCheck.rowCount === 0 ||
          messageCheck.rows[0].status === "stopped"
        ) {
          console.log("Message sequence stopped");
          return true;
        }

        await new Promise((resolve) => setTimeout(resolve, timeUntilTomorrow));
        return false;
      };

      let currentMessageIndex = 0;
      let dayCount = 1;

      while (true) {
        console.log(`\n=== [Company ${companyId}] Processing Message Item ===`);
        const messageItem = messages[currentMessageIndex];
        console.log(`[Company ${companyId}] Current message item:`, {
          index: currentMessageIndex,
          chatId: messageItem.chatId,
          messageLength: messageItem.message?.length,
          delay: messageItem.delay,
        });

        const { chatId, message: messageText, delay } = messageItem;
        const phone = chatId.split("@")[0];

        console.log(`[Company ${companyId}] Fetching contact data for:`, phone);
        const contactQuery = `
          SELECT * FROM contacts 
          WHERE company_id = $1 AND phone = $2
        `;
        const contactResult = await client.query(contactQuery, [
          companyId,
          phone,
        ]);
        console.log(
          `[Company ${companyId}] Contact exists:`,
          contactResult.rowCount > 0
        );

        const contactData =
          contactResult.rowCount > 0 ? contactResult.rows[0] : {};

        if (
          companyId === "0128" &&
          contactData.tags &&
          contactData.tags.includes("stop bot")
        ) {
          console.log(
            `[Company ${companyId}] Skipping message - contact has 'stop bot' tag`
          );
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
        });

        if (delay > 0) {
          console.log(
            `[Company ${companyId}] Adding delay of ${delay} seconds`
          );
          await new Promise((resolve) => setTimeout(resolve, delay * 1000));
        }

        try {
          console.log(`\n=== [Company ${companyId}] Sending Message ===`);

          const mediaUrl = messageItem.mediaUrl || message.media_url || "";
          const documentUrl =
            messageItem.documentUrl || message.document_url || "";
          const fileName = messageItem.fileName || message.file_name || "";

          const endpoint = mediaUrl
            ? "image"
            : documentUrl
            ? "document"
            : "text";

          const url = `${process.env.URL}api/v2/messages/${endpoint}/${companyId}/${chatId}`;

          console.log(`[Company ${companyId}] Request details:`, {
            endpoint,
            url,
            phoneIndex: message.phone_index,
            hasMedia: Boolean(mediaUrl || documentUrl),
          });

          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              mediaUrl
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

          console.log(
            `[Company ${companyId}] Recorded message as sent with ID: ${messageIdentifier}`
          );
        } catch (error) {
          console.error(`\n=== [Company ${companyId}] Message Send Error ===`);
          console.error(`[Company ${companyId}] Error:`, error);

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

          throw error;
        }

        currentMessageIndex++;
        console.log(`\n=== [Company ${companyId}] Sequence Status ===`);
        console.log({
          currentIndex: currentMessageIndex,
          totalMessages: messages.length,
          dayCount,
          willContinue:
            currentMessageIndex < messages.length || message.infinite_loop,
        });

        if (currentMessageIndex >= messages.length) {
          if (!message.infinite_loop) {
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
    console.error(`[Company ${companyId}] Error:`, error);
    return { success: false, error };
  } finally {
    client.release();
  }
}

async function scheduleAllMessages() {
  const client = await pool.connect();
  try {
    console.log("scheduleAllMessages");

    const companiesQuery = `
      SELECT DISTINCT company_id FROM scheduled_messages
      WHERE status != 'completed'
    `;
    const companiesResult = await client.query(companiesQuery);

    for (const companyRow of companiesResult.rows) {
      const companyId = companyRow.company_id;
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
    client.release();
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
        const { msgDBId, type } = addMessageToPostgres(
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
        });

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
      sqlClient.release();
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

  const chatid = formatPhoneNumber(extractedNumber).slice(1) + "@c.us";

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

async function getFollowUpTemplates(companyId) {
  const templates = [];
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const query = `
      SELECT 
        id,
        template_id,
        name,
        trigger_keywords,
        trigger_tags,
        keyword_source,
        content
      FROM 
        public.followup_templates
      WHERE 
        company_id = $1 
        AND status = 'active'
    `;

    const result = await sqlClient.query(query, [companyId]);

    for (const row of result.rows) {
      templates.push({
        id: row.template_id,
        triggerKeywords: row.trigger_keywords || [],
        triggerTags: row.trigger_tags || [],
        name: row.name,
        keywordSource: row.keyword_source || "bot",
        content: row.content,
      });
    }

    await sqlClient.query("COMMIT");
    return templates;
  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error("Error fetching follow-up templates:", error);
    throw error;
  } finally {
    sqlClient.release();
  }
}

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

    console.log("Fetching active aiAssignResponses...");
    const result = await sqlClient.query(query, [companyId]);
    console.log("Found aiAssignResponses records:", result.rows.length);

    for (const row of result.rows) {
      console.log("\nProcessing record:", row.response_id);
      console.log("Record data:", row);

      const assignedEmployees = row.assigned_employees || [];
      console.log("Assigned employees array:", assignedEmployees);

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

      console.log("Adding response object:", responseObj);
      responses.push(responseObj);
    }

    await sqlClient.query("COMMIT");
    console.log("\nFinal responses array:", responses);
    return responses;
  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error("Error in getAIAssignResponses:", error);
    console.error("Full error:", error.stack);
    throw error;
  } finally {
    sqlClient.release();
    console.log("Database client released back to the pool");
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
    await sqlClient.query("ROLLBACK");
    console.error("Error fetching AI tag responses:", error);
    throw error;
  } finally {
    sqlClient.release();
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
    await sqlClient.query("ROLLBACK");
    console.error("Error fetching AI image responses:", error);
    throw error;
  } finally {
    sqlClient.release();
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
    await sqlClient.query("ROLLBACK");
    console.error("Error fetching AI video responses:", error);
    throw error;
  } finally {
    sqlClient.release();
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
        language,
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
        language: row.language || "en",
        keywordSource: row.keyword_source || "user",
      });
    }

    await sqlClient.query("COMMIT");
    return responses;
  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error("Error fetching AI voice responses:", error);
    throw error;
  } finally {
    sqlClient.release();
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
    await sqlClient.query("ROLLBACK");
    console.error("Error fetching AI document responses:", error);
    throw error;
  } finally {
    sqlClient.release();
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

// Handles AI video responses
async function handleAIVideoResponses({
  client,
  message,
  from,
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

          const videoMessage = await client.sendMessage(from, media, {
            caption,
            sendVideoAsGif: false,
          });

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
  from,
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
            from,
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

// Handles AI image responses
async function handleAIImageResponses({
  client,
  message,
  from,
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
          const media = await MessageMedia.fromUrl(imageUrl);
          const imageMessage = await client.sendMessage(from, media);
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
  from,
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

          const documentMessage = await client.sendMessage(from, media, {
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

  const aiTagResponses = await getAITagResponses(idSubstring);

  for (const response of aiTagResponses) {
    if (await checkKeywordMatch(response, message, keywordSource)) {
      console.log("Tags found for keywords:", response.keywords);

      try {
        if (response.tag_action_mode === "delete") {
          await handleTagDeletion({
            response,
            extractedNumber,
            idSubstring,
            followUpTemplates,
          });
        } else {
          await handleTagAddition({
            response,
            extractedNumber,
            idSubstring,
            followUpTemplates,
            contactName,
            phoneIndex,
          });
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

        await handleEmployeeAssignment({
          response,
          idSubstring,
          extractedNumber,
          contactName,
          client,
          matchedKeyword,
        });
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
    if (await checkKeywordMatch(response, message, keywordSource)) {
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
  for (const tagToRemove of response.remove_tags || []) {
    await addTagToPostgres(extractedNumber, tagToRemove, idSubstring, true);
    await handleFollowUpTemplateCleanup(
      tagToRemove,
      extractedNumber,
      idSubstring,
      followUpTemplates
    );
  }

  for (const tag of response.tags) {
    await addTagToPostgres(extractedNumber, tag, idSubstring);
    console.log(`Added tag: ${tag} for number: ${extractedNumber}`);

    await handleFollowUpTemplateActivation(
      tag,
      extractedNumber,
      idSubstring,
      contactName,
      phoneIndex,
      followUpTemplates
    );
  }
}

async function addTagToPostgres(contactID, tag, companyID, remove = false) {
  console.log(
    `${remove ? "Removing" : "Adding"} tag "${tag}" ${
      remove ? "from" : "to"
    } PostgreSQL for contact ${contactID}`
  );
  contactID =
    companyID +
    "-" +
    (contactID.startsWith("+") ? contactID.slice(1) : contactID);

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const checkQuery = `
      SELECT 1 FROM public.contacts 
      WHERE contact_id = $1 AND company_id = $2
    `;
    const checkResult = await sqlClient.query(checkQuery, [
      contactID,
      companyID,
    ]);

    if (checkResult.rows.length === 0) {
      throw new Error("Contact does not exist!");
    }

    if (remove) {
      const removeQuery = `
        UPDATE public.contacts 
        SET 
          tags = CASE 
            WHEN tags ? $1 THEN 
              (SELECT jsonb_agg(t) FROM jsonb_array_elements_text(tags) t WHERE t != $1)
            ELSE 
              tags 
          END,
          last_updated = CURRENT_TIMESTAMP
        WHERE contact_id = $2 AND company_id = $3
        RETURNING (tags ? $1) AS tag_existed_before
      `;
      const removeResult = await sqlClient.query(removeQuery, [
        tag,
        contactID,
        companyID,
      ]);

      if (removeResult.rows[0].tag_existed_before) {
        console.log(
          `Tag "${tag}" removed successfully from contact ${contactID}`
        );
      } else {
        console.log(`Tag "${tag}" doesn't exist for contact ${contactID}`);
      }
    } else {
      const addQuery = `
        UPDATE public.contacts 
        SET 
          tags = CASE 
            WHEN tags IS NULL THEN jsonb_build_array($1)
            WHEN NOT tags ? $1 THEN tags || jsonb_build_array($1)
            ELSE tags
          END,
          last_updated = CURRENT_TIMESTAMP
        WHERE contact_id = $2 AND company_id = $3
        RETURNING (tags ? $1) AS tag_existed_before_update
      `;
      const addResult = await sqlClient.query(addQuery, [
        tag,
        contactID,
        companyID,
      ]);

      if (!addResult.rows[0].tag_existed_before_update) {
        console.log(`Tag "${tag}" added successfully to contact ${contactID}`);
      } else {
        console.log(`Tag "${tag}" already exists for contact ${contactID}`);
      }
    }

    await sqlClient.query("COMMIT");
  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error("Error managing tags in PostgreSQL:", error);
  } finally {
    sqlClient.release();
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

  const employeeEmails = response.assigned_employees;
  if (employeeEmails.length === 0) {
    console.log("No employees available for assignment");
    return;
  }

  const nextEmail = employeeEmails[currentIndex % employeeEmails.length];
  const employeeResult = await pool.query(
    "SELECT * FROM employees WHERE company_id = $1 AND email = $2",
    [idSubstring, nextEmail]
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

    const newIndex = (currentIndex + 1) % employeeEmails.length;
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
  for (const template of followUpTemplates) {
    if (template.trigger_tags && template.trigger_tags.includes(tag)) {
      await callFollowUpAPI(
        "startTemplate",
        extractedNumber,
        contactName,
        phoneIndex,
        template.id,
        idSubstring
      );
    }
  }

  if (tag === "pause followup") {
    const contactResult = await pool.query(
      "SELECT tags FROM contacts WHERE company_id = $1 AND phone = $2",
      [idSubstring, extractedNumber]
    );
    const contactData = contactResult.rows[0];
    const currentTags = contactData?.tags || [];

    for (const template of followUpTemplates) {
      if (
        template.trigger_tags?.some((templateTag) =>
          currentTags.includes(templateTag)
        )
      ) {
        await callFollowUpAPI(
          "pauseTemplate",
          extractedNumber,
          null,
          phoneIndex,
          template.id,
          idSubstring
        );
      }
    }
  }
}

async function callFollowUpAPI(
  action,
  phone,
  contactName,
  phoneIndex,
  templateId,
  idSubstring
) {
  try {
    const response = await fetch("https://juta.ngrok.app/api/tag/followup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestType: action,
        phone: phone,
        first_name: contactName || phone,
        phoneIndex: phoneIndex || 0,
        templateId: templateId,
        idSubstring: idSubstring,
      }),
    });

    if (!response.ok) {
      console.error(
        `Failed to ${action} follow-up sequence:`,
        await response.text()
      );
    }
  } catch (error) {
    console.error(`Error in ${action} follow-up sequence:`, error);
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
    if (client) client.release();
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
  console.log("Adding message to PostgreSQL");
  console.log("idSubstring:", idSubstring);
  console.log("extractedNumber:", extractedNumber);

  try {
    await sqlDb.query("BEGIN");

    const contactID = `${idSubstring}-${extractedNumber.replace("+", "")}`;
    const chatId = msg.fromMe ? msg.to : msg.from;

    // Insert message
    const messageQuery = `
        INSERT INTO public.messages (
          message_id, company_id, contact_id, content, message_type,
          media_url, timestamp, direction,
          status, from_me, chat_id, author, phone_index,
          thread_id, customer_phone
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (message_id) DO NOTHING
        RETURNING id
      `;
    const messageValues = [
      msg.id._serialized,
      idSubstring,
      contactID,
      msg.body || "",
      msg.type,
      null, // mediaUrl
      new Date(msg.timestamp * 1000),
      msg.fromMe ? "outbound" : "inbound",
      "delivered",
      msg.fromMe || false,
      chatId,
      userName || contactID,
      phoneIndex,
      chatId,
      extractedNumber,
    ];

    const messageResult = await sqlDb.query(messageQuery, messageValues);

    if (messageResult.rows.length > 0) {
      const messageDbId = messageResult.rows[0].id;
      await sqlDb.query("COMMIT");
      console.log(
        `Message successfully added to PostgreSQL with ID: ${messageDbId}`
      );

      // Fetch the full message data and broadcast it
      const res = await sqlDb.query(
        `SELECT m.*, c.name as contact_name 
         FROM messages m
         LEFT JOIN contacts c ON m.contact_id = c.contact_id AND m.company_id = c.company_id
         WHERE m.id = $1`,
        [messageDbId]
      );
      const fullMessageData = res.rows[0];

      if (fullMessageData) {
        broadcastNewMessageToChat(fullMessageData.contact_id, msg.body);
      }

      return { messageDbId, type: msg.type, inserted: true };
    } else {
      await sqlDb.query("COMMIT");
      console.log(
        `Message ${msg.id._serialized} already exists. Skipping insert.`
      );
      return { messageDbId: null, type: msg.type, inserted: false };
    }
  } catch (error) {
    await sqlDb.query("ROLLBACK");
    console.error("Error in PostgreSQL transaction:", error);
    throw error;
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

    const mediaData = {
      mimetype: media.mimetype,
      data: media.data,
      filename: msg._data.filename || "",
      caption: msg._data.caption || "",
    };

    switch (msg.type) {
      case "image":
        mediaData.width = msg._data.width;
        mediaData.height = msg._data.height;
        break;
      case "document":
        mediaData.page_count = msg._data.pageCount;
        mediaData.file_size = msg._data.size;
        break;
      case "video":
        mediaData.link = await storeVideoData(media.data, msg._data.filename);
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

  return {
    mimetype: "audio/ogg; codecs=opus",
    data: null,
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

  return {
    quoted_content: {
      body: quotedMsg.body,
    },
    quoted_author: authorData ? authorData.name : authorNumber,
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

async function storeVideoData(videoData, filename) {
  const bucket = admin.storage().bucket();
  const uniqueFilename = `${uuidv4()}_${filename}`;
  const file = bucket.file(`videos/${uniqueFilename}`);

  await file.save(Buffer.from(videoData, "base64"), {
    metadata: {
      contentType: "video/mp4",
    },
  });

  const [url] = await file.getSignedUrl({
    action: "read",
    expires: "03-01-2500",
  });

  return url;
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

async function obiliterateAllJobs() {
  await messageQueue.obliterate({ force: true });
  console.log("Queue cleared successfully");
}

async function main(reinitialize = false) {
  console.log("Initialization starting...");

  // 1. Fetch companies in parallel with other initialization tasks
  const companiesPromise = sqlDb.query(
    "SELECT * FROM companies WHERE company_id = $1",
    ["0145"]
  );
  
  // const companiesPromise = sqlDb.query(
  //   "SELECT * FROM companies WHERE company_id IN ($1, $2)",
  //   ["0134", "0150"]
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
    checkAndScheduleDailyReport(),
    initializeDailyReports(),
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

    // Prepare the SQL for bulk upsert
    const values = [];
    const placeholders = [];
    let idx = 1;

    for (const contact of contacts) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
      );
      values.push(
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
        contact.customFields ? JSON.stringify(contact.customFields) : null,
        contact.tags ? JSON.stringify(contact.tags) : null
      );
    }

    const query = `
      INSERT INTO contacts (
        contact_id, company_id, name, last_name, email, phone, address1, company, location_id,
        created_at, unread_count, points, branch, expiry_date, vehicle_number, ic, chat_id, notes, custom_fields, tags
      ) VALUES
        ${placeholders.join(",\n")}
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

    const result = await sqlDb.query(query, values);

    res.json({
      success: true,
      imported: result.rowCount,
      contact_ids: result.rows.map((r) => r.contact_id),
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

app.post("/api/contacts", async (req, res) => {
  try {
    const {
      contact_id,
      companyId,
      contactName,
      lastName,
      email,
      phone,
      address1,
      companyName,
      locationId,
      dateAdded,
      unreadCount,
      points,
      branch,
      expiryDate,
      vehicleNumber,
      ic,
      chat_id,
      notes,
    } = req.body;

    if (!companyId || !phone || !contact_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (companyId, phone, contact_id)",
      });
    }
    console.log(contactName);
    // Insert contact into the database
    const result = await sqlDb.query(
      `INSERT INTO contacts (
        contact_id, company_id, name, last_name, email, phone, address1, company, location_id,
        created_at, unread_count, points, branch, expiry_date, vehicle_number, ic, chat_id, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18
      )
      ON CONFLICT (contact_id, company_id) DO UPDATE
      SET contact_name = EXCLUDED.name,
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
          updated_at = CURRENT_TIMESTAMP
      RETURNING contact_id`,
      [
        contact_id,
        companyId,
        contactName,
        lastName,
        email,
        phone,
        address1,
        companyName,
        locationId,
        dateAdded || new Date().toISOString(),
        unreadCount || 0,
        points || 0,
        branch,
        expiryDate,
        vehicleNumber,
        ic,
        chat_id,
        notes,
      ]
    );

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
    client.release();
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
    client.release();
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
    if (client) client.release();
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
    if (client) client.release();
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
  const monthKey = getCurrentMonthKey();

  try {
    const companyQuery = `SELECT name FROM companies WHERE id = $1`;
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
    client.release();
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
    `;

    const companiesResult = await client.query(botsQuery);

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
      client.release();
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
  const chatId = req.params.chatId.split("-")[1] + "@c.us";
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

    // 4. Save to SQL
    try {
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
      await fetchConfigFromDatabase(botName);
      const handlerParams = {
        client: client,
        msg: message,
        idSubstring: companyId,
        extractedNumber: phoneNumber,
        contactName:
          contactData?.contact_name || contactData?.name || phoneNumber,
        phoneIndex: phoneIndex,
      };

      // Process AI responses for 'own'
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
      });

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
          await client.query("ROLLBACK");
          return res.status(404).json({ success: false, error: "Message not found in database" });
        }

        await client.query("COMMIT");
        res.json({ success: true, messageId: messageId });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Error updating message in PostgreSQL:", error);
        res.status(500).send("Internal Server Error");
      } finally {
        client.release();
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
  const { tags } = req.body; // tags: array of tags to remove
  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: "tags must be an array" });
  }
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
    await handleTagDeletion(response, phoneNumber, companyId, followupTemplate);

    res.json({ success: true, tags: newTags });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to remove tags", details: error.message });
  }
});

app.post("/api/contacts/:companyId/:contactId/tags", async (req, res) => {
  const { companyId, contactId } = req.params;
  const { tags } = req.body; // tags: array of tags to add
  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: "tags must be an array" });
  }
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
    res.json({ success: true, tags: newTags });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to add tags", details: error.message });
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

// Add new function to manage phone status
async function updatePhoneStatus(
  companyId,
  phoneNumber,
  status,
  metadata = {}
) {
  try {
    await sqlDb.query(
      `
      INSERT INTO phone_status (company_id, phone_number, status, last_seen, metadata, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (company_id, phone_number) DO UPDATE
      SET status = EXCLUDED.status,
          last_seen = CURRENT_TIMESTAMP,
          metadata = EXCLUDED.metadata,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        companyId,
        phoneNumber,
        status,
        Object.keys(metadata).length ? JSON.stringify(metadata) : null,
      ]
    );
    console.log(
      `Updated status for ${companyId} Phone ${phoneNumber} to ${status} (SQL)`
    );
    broadcastStatus(companyId, status, phoneNumber);
  } catch (error) {
    console.error(
      `Error updating phone status in SQL for ${companyId} Phone ${phoneNumber}:`,
      error
    );
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
  const clientName = `${botName}`;
  const sessionDir = path.join(
    __dirname,
    ".wwebjs_auth",
    `session-${botName}`
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
    // Ensure the client for bot 0210 is initialized and ready
    const botData = botMap.get("0134");
    if (!botData || !botData[0]?.client || botData[0].status !== "ready") {
      console.error("Client for bot 0134 is not initialized or not ready.");
      return;
    }

    const client = botData[0].client;

    // Fetch employees from the target companyId with role '1'
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

    const alertMessage = `[ALERT] WhatsApp Connection Disconnected\n\nACTION REQUIRED:\n\n1. Navigate to web.jutasoftware.co.\n2. Log in to your account.\n3. Scan the QR code to reinitialize your WhatsApp connection.\n\nFor support, please contact +601121677672`;

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
        client.release();
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
      "SELECT id, company_id, name, email, phone, plan, v2, phone_count, assistant_id, assistant_ids FROM companies WHERE company_id = $1",
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
        assistants_ids: companyData.assistant_ids,
        assistant_id: companyData.assistant_id, // Added this line
      },
      employeeList,
      messageUsage,
      tags,
    };
    console.log(response);
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
    console.log(chatId);
    console.log(companyId);
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
