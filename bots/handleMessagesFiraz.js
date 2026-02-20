const os = require("os");
const OpenAI = require("openai");
const axios = require("axios");
const { google } = require("googleapis");
const { MessageMedia } = require("whatsapp-web.js");
const path = require("path");
const { Client } = require("whatsapp-web.js");
const util = require("util");
const moment = require("moment-timezone");
const fs = require("fs");
const cron = require("node-cron");
const schedule = require("node-schedule");
const { v4: uuidv4 } = require("uuid");
const { exec } = require("child_process");
const { Readable } = require("stream");
const ffmpeg = require("ffmpeg-static");
const execPromise = util.promisify(exec);
const { URLSearchParams } = require("url");
const admin = require("../firebase.js");
const db = admin.firestore();
const { doc, collection, query, where, getDocs } = db;
const pdf = require("pdf-parse");
const { fromPath } = require("pdf2pic");
const { Poppler } = require("node-poppler");
const SKCSpreadsheet = require("../spreadsheet/SKCSpreadsheet.js");
const CarCareSpreadsheet = require("../blast/bookingCarCareGroup.js");
const ConvertAPI = require("convertapi");
const convertapi = new ConvertAPI("3TGd7Fmc11To3kGVxyvDFQ4s9xhFdoOk");
const { neon, neonConfig } = require("@neondatabase/serverless");
const { Pool } = require("pg");
const mime = require("mime-types");
const FormData = require("form-data");

// Utility function to safely extract phone number with @lid failsafe
async function safeExtractPhoneNumber(msg, client = null) {
  try {
    let phoneNumber;

    // Check if it's a @lid case
    if (msg.from && msg.from.includes("@lid")) {
      console.log(
        "🔧 [safeExtractPhoneNumber] @lid detected, using chat/contact method"
      );

      if (!client) {
        console.error(
          "❌ [safeExtractPhoneNumber] Client required for @lid extraction but not provided"
        );
        return null;
      }

      try {
        const chat = await msg.getChat();
        const contact = await chat.getContact();

        if (contact && contact.id && contact.id._serialized) {
          // Extract phone number from contact.id._serialized
          phoneNumber = contact.id._serialized.split("@")[0];
          console.log(
            "✅ [safeExtractPhoneNumber] Extracted from contact:",
            phoneNumber
          );
        } else {
          console.error(
            "❌ [safeExtractPhoneNumber] Could not get contact info from chat"
          );
          return null;
        }
      } catch (error) {
        console.error(
          "❌ [safeExtractPhoneNumber] Error getting chat/contact for @lid:",
          error
        );
        return null;
      }
    } else {
      // Standard extraction method
      phoneNumber = msg.from.split("@")[0];
      console.log(
        "✅ [safeExtractPhoneNumber] Standard extraction:",
        phoneNumber
      );
    }

    // Add + prefix if not present
    if (phoneNumber && !phoneNumber.startsWith("+")) {
      phoneNumber = "+" + phoneNumber;
    }

    return phoneNumber;
  } catch (error) {
    console.error("❌ [safeExtractPhoneNumber] Unexpected error:", error);
    return null;
  }
}

// Utility function to safely extract "to" phone number with @lid failsafe
async function safeExtractToPhoneNumber(msg, client = null) {
  try {
    let phoneNumber;

    // Check if it's a @lid case
    if (msg.to && msg.to.includes("@lid")) {
      console.log(
        '🔧 [safeExtractToPhoneNumber] @lid detected in "to", using chat/contact method'
      );

      if (!client) {
        console.error(
          "❌ [safeExtractToPhoneNumber] Client required for @lid extraction but not provided"
        );
        return null;
      }

      try {
        const chat = await msg.getChat();
        const contact = await chat.getContact();

        if (contact && contact.id && contact.id._serialized) {
          // Extract phone number from contact.id._serialized
          phoneNumber = contact.id._serialized.split("@")[0];
          console.log(
            "✅ [safeExtractToPhoneNumber] Extracted from contact:",
            phoneNumber
          );
        } else {
          console.error(
            "❌ [safeExtractToPhoneNumber] Could not get contact info from chat"
          );
          return null;
        }
      } catch (error) {
        console.error(
          "❌ [safeExtractToPhoneNumber] Error getting chat/contact for @lid:",
          error
        );
        return null;
      }
    } else {
      // Standard extraction method
      phoneNumber = msg.to.split("@")[0];
      console.log(
        "✅ [safeExtractToPhoneNumber] Standard extraction:",
        phoneNumber
      );
    }

    // Add + prefix if not present
    if (phoneNumber && !phoneNumber.startsWith("+")) {
      phoneNumber = "+" + phoneNumber;
    }

    return phoneNumber;
  } catch (error) {
    console.error("❌ [safeExtractToPhoneNumber] Unexpected error:", error);
    return null;
  }
}
const { ids } = require("googleapis/build/src/apis/ids/index.js");
const { report } = require("process");

// Configure Neon for WebSocket pooling
neonConfig.webSocketConstructor = require("ws");

// For direct SQL queries (single connection)
const sql = neon(process.env.DATABASE_URL);

// For connection pooling
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 500,
  min: 5,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
  acquireTimeoutMillis: 30000,
  createTimeoutMillis: 10000,
  destroyTimeoutMillis: 5000,
  reapIntervalMillis: 1000,
  createRetryIntervalMillis: 100,
  allowExitOnIdle: false,
  connectionRetryInterval: 500,
  maxConnectionRetries: 5,
  statement_timeout: 15000,
  query_timeout: 15000,
  idle_in_transaction_session_timeout: 15000,
});

async function safeRollback(sqlClient) {
  if (sqlClient && typeof sqlClient.query === "function") {
    try {
      await sqlClient.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Error during rollback:", rollbackError);
    }
  }
}

async function safeRelease(sqlClient) {
  if (sqlClient && typeof sqlClient.release === "function") {
    try {
      await sqlClient.release();
    } catch (releaseError) {
      console.error("Error releasing connection:", releaseError);
    }
  }
}

// Add pool error handling to prevent crashes
pool.on("error", (err) => {
  console.error("=== DATABASE POOL ERROR ===");
  console.error("Error:", err);
  console.error("Time:", new Date().toISOString());

  // Handle specific connection errors
  if (
    err.message &&
    err.message.includes("Connection terminated unexpectedly")
  ) {
    console.error(
      "Database connection terminated - attempting to reconnect..."
    );
    // Log to file for debugging
    if (typeof logger !== "undefined" && logger.logToFile) {
      logger.logToFile(
        "db_connection_errors",
        `Connection terminated: ${err.message}`
      );
    }
  }

  // Don't exit the process, just log the error
  console.log("Continuing operation despite database pool error...");
});

pool.on("connect", (client) => {
  console.log("New database connection established");

  // Set connection-specific error handlers
  client.on("error", (err) => {
    console.error("=== DATABASE CLIENT ERROR ===");
    console.error("Error:", err);
    console.error("Time:", new Date().toISOString());

    if (
      err.message &&
      err.message.includes("Connection terminated unexpectedly")
    ) {
      console.error("Client connection terminated - will be replaced by pool");
      // Log to file for debugging
      if (typeof logger !== "undefined" && logger.logToFile) {
        logger.logToFile(
          "db_connection_errors",
          `Client connection terminated: ${err.message}`
        );
      }
    }
  });
});

const MEDIA_DIR = path.join(__dirname, "public", "media");

const openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
});

// Set up Google Sheets API
const auth = new google.auth.GoogleAuth({
  keyFile: "./service_account.json", // Replace with your credentials file path
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const steps = {
  START: "start",
};
const userState = new Map();

// Add this object to store tasks
const userTasks = new Map();
const carpetTileFilePaths = {
  "atria-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FAtria%20Leaflet.pdf?alt=media&token=73303523-9c3c-4935-bd14-1004b45a7f58",
  "mw-moscow-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FMoscow%20St%20Petersburg%20Leaflet.pdf?alt=media&token=d5dfa885-1cf1-4232-aaf4-aa0c61aaa4f9",
  "palette-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FPalette%20Leaflet.pdf?alt=media&token=625df591-76ce-4aac-a2f4-cca73f8706f4",
  "pe-saintpetersburg-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FMoscow%20St%20Petersburg%20Leaflet.pdf?alt=media&token=d5dfa885-1cf1-4232-aaf4-aa0c61aaa4f9",
  "canvas(new)-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FCanvas%20Leaflet.pdf?alt=media&token=377c77a6-c4d0-4778-9e37-b4a80a88ca0b",
  "spark(new)-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FSpark%20Leaflet.pdf?alt=media&token=43756f59-08c9-4c10-9030-900acecdf3c4",
  "brs-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FBRS%20Leaflet.pdf?alt=media&token=a9259cc5-7c7c-4860-97e3-65aae607c214",
  "vlt-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FVLT%20Leaflet.pdf?alt=media&token=2289c5a0-d4bd-469f-bf27-eedb26d28051",
  "bonn-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FBonn%20Leaflet.pdf?alt=media&token=004bdc9a-8d9e-446b-9f02-774d3e9bc1d0",
  "phantom(new)-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FPhantom%20Leaflet.pdf?alt=media&token=9eadd923-c352-4b90-a5a6-7b523c934721",
  "roma-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FRoma%20Leaflet%20(online).pdf?alt=media&token=7e68447b-7a98-4ed9-b168-e4bd5cda52c1",
  "rhythm-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FRhythm%20Leaflet.pdf?alt=media&token=5b09b936-2223-4631-a48f-f877a2d17681",
  "proearth-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FPro%20Earth%20Leaflet.pdf?alt=media&token=54d5ad6b-64d0-438e-98ac-5f6ca844fc53",
  "3c-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2F3C%20Leaflet.pdf.pdf?alt=media&token=d40a927e-6383-478c-8447-960f24a34769",
  "eno-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FENO%20Leaflet.pdf?alt=media&token=fbb321a6-9928-4401-ac63-68185a192d9a",
  "alta-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FAlta%20leaflet.pdf?alt=media&token=595b3ebc-85db-48c4-8f79-8b75cc33754a",
  "ndnewdelhi-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FNew%20Delhi%20Leaflet.pdf?alt=media&token=ad3bb24d-31d9-48dc-90fd-3d81c75eff19",
  "colourtone-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FColourtone%20Leaflet.pdf?alt=media&token=6fc90919-1e29-4748-b9dd-e6ab83536515",
  "starlight-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FStarlight%20Leaflet.pdf?alt=media&token=7955ba92-9a51-46ed-ac48-39ce3770cd3e",
  "landscape-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FLandscape%20Leaflet.pdf?alt=media&token=eb1fbdf5-55be-453f-aa62-a17f9a2084be",
  "liverpoollvp-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FLiverpool%20Leaflet.pdf?alt=media&token=aed6f0f4-b2d1-4bb3-a67f-e948047aa7eb",
  "colourplus-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FColour%20Plus%20Leaflet.pdf?alt=media&token=1996713f-3af7-4d98-9368-ad6b9a34715a",
  "aberdeen-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FAberdeen%20Leaflet.pdf?alt=media&token=6af44f4f-d7b5-46a2-888e-b9fe3e94758b",
  "saipan-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Tile%2FSaipan%20Leaflet.pdf?alt=media&token=5f2f7c29-854e-42b0-bdb4-3af1781ce3bd",
  "superloop-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FSuper%20Loop%20leaflet.pdf?alt=media&token=26d89c55-d0c4-4772-8859-6c07d5217b68",
  "newloop-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FNew%20Loop%20Leaflet.pdf?alt=media&token=dc5ca05e-da6b-4b33-9a36-f572f80162fb",
  "matahari-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FMatahari%20Leaflet.pdf?alt=media&token=4899ca90-3657-47d8-8bcb-18cb76e910bc",
  "camb-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FCamb%20Leaflet.pdf?alt=media&token=1f68e3fd-645b-4f5c-a95e-70fbb8581359",
  "patriot-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FPatriot%20Leaflet.pdf?alt=media&token=7a8785b9-e2d1-4552-87bf-7c522abee65a",
  "heavyloop-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FHeavy%20Loop%20Leaflet.pdf?alt=media&token=dcc81e88-a851-44af-8159-b1b0477114e6",
  "cloud-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FCloud%20Leaflet.pdf?alt=media&token=6b2ab550-231e-46f9-b0a0-a0ac64e9b97d",
  "taurus-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FTaurus%20Leaflet.pdf?alt=media&token=90438fde-cdb8-4579-92ab-636a0015c2aa",
  "transit-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FTransit%20Leaflet.pdf?alt=media&token=138bcf28-30ee-493f-acb1-b1ac41eeb7ef",
  "canon-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FCanon%20Leaflet.pdf?alt=media&token=7523912d-efe7-4d2e-b22e-3aff13b670f5",
  "metro-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FMetro%20Leaflet.pdf?alt=media&token=e22dc654-1a5f-415f-8b8d-18e6f335e927",
  "tokyo-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FTokyo%20Leaflet.pdf?alt=media&token=5fff3ac7-e3ad-4bd8-b168-2447b281654b",
  "villa-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FVilla%20Leaflet.pdf?alt=media&token=beb33a50-2311-4daa-9478-db1f9291d538",
  "grandcanyon-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FGrand%20Canyon%20Leaflet.pdf?alt=media&token=89899c88-2e28-4473-9767-16c814675342",
  "glitter-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FGlitter%20Leaflet.pdf?alt=media&token=b0864bcf-a168-4fae-a3c7-79187af2323e",
  "mirage-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FMirage%20Leaflet.pdf.pdf?alt=media&token=4d1e1152-a519-480d-92d8-1a3bf0785518",
  "impression-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FImpression%20Leaflet.pdf?alt=media&token=42cd7154-99a8-45e9-87c3-d238951b017b",
  "timber-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FTimber%20Leaflet.pdf?alt=media&token=a82d78c6-c446-4dce-9bd8-b0cffaaf0039",
  "rainbow-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FRainbow%20Leaflet.pdf?alt=media&token=b11ec600-6ab9-4b85-be4b-e8206ea5df7e",
  "chamber-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FChamber%20Leaflet.pdf?alt=media&token=b798657c-845b-4ea0-b5c6-f40da2fe7960",
  "nile-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FNile%20Leaflet.pdf.pdf?alt=media&token=5a5e1ea8-3ade-49f6-ab9b-8a8f24a5cfe5",
  "sahara-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FSahara%20Leaflet.pdf?alt=media&token=fe9ed83b-cf1b-4959-842f-1f1bbcad004f",
  "nybroadway2-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FNY%20Broadway%202%20Leaflet.pdf?alt=media&token=9dd5dc2e-b3d9-463f-8b52-00bad5d4fe54",
  "element-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FElement%20Leaflet.pdf?alt=media&token=98444455-4706-40cf-80e2-2eca4ac6f0dd",
  "vello-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FVello%20Leaflet.pdf?alt=media&token=9743d1e4-4c73-48fa-8ff3-e623ebab84d5",
  "imperial-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FImperial%20Leaflet.pdf?alt=media&token=1b7ff207-d96b-47e1-95b5-7fbcd09a9700",
  "luxe-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FLuxe%20Leaflet.pdf?alt=media&token=83991260-95a8-4aca-8266-ffce50fc950c",
  "empire-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FEmpire%20Leaflet_page-0001.pdf?alt=media&token=e54d812e-061f-401b-8f43-81c6ad22861a",
  "madinahmosque-thepriceper":
    "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/CNB%2FPDF%2FCarpet%20Rolls%2FMadinah%20Leaflet.pdf?alt=media&token=8f9c58e3-4147-435f-8a5d-696fdc995738",
  "dywood-thepriceper": "URL_FOR_DY_WOOD",
  "redwoodnew-thepriceper": "URL_FOR_REDWOOD_NEW",
  "implexdeluxe-thepriceper": "URL_FOR_IMPLEX_DELUXE",
  "woodland-thepriceper": "URL_FOR_WOODLAND",
  "woodlink-thepriceper": "URL_FOR_WOODLINK",
  "widewood-thepriceper": "URL_FOR_WIDE_WOOD",
  "pebblestone-thepriceper": "URL_FOR_PEBBLE_STONE",
  "woodtek-thepriceper": "URL_FOR_WOODTEK",
  "grandwood-thepriceper": "URL_FOR_GRAND_WOOD",
  "7mmgrass-thepriceper": "URL_FOR_7MM_GRASS",
  "meadow-thepriceper": "URL_FOR_MEADOW",
  "prado15mmw/uvstabalizer-thepriceper": "URL_FOR_PRADO_15MM",
  "nobel25mmw/uvstabalizer-thepriceper": "URL_FOR_NOBEL_25MM",
  "10mmw/uvstabalizer-thepriceper": "URL_FOR_10MM_W_UV",
  "10mm(white)w/uvstabalizer-thepriceper": "URL_FOR_10MM_WHITE",
  "softturf25mm(green)-thepriceper": "URL_FOR_SOFTTURF_25MM_GREEN",
  "softturf25mm(yellow)-thepriceper": "URL_FOR_SOFTTURF_25MM_YELLOW",
  "35mm(green)w/uvstabilizer-thepriceper": "URL_FOR_35MM_GREEN",
  "35mm(yellow)w/uvstabilizer-thepriceper": "URL_FOR_35MM_YELLOW",
};

const mediaMap = {
  "Product: BT 14 Kg": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F14kg%20gas%20(normal).jpg?alt=media&token=d149ec04-5d8e-493f-8c32-e282efd424eb",
    type: "image",
  },
  "Product: C14 Kg": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F14kg%20gas%20(%20forklift%20).jpg?alt=media&token=213a3c36-bb75-4a79-b43b-cc36218156da",
    type: "image",
  },
  "Product: C50 Kg": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F50kg%20gas%20(commercial%20%26%20industrial).jpg?alt=media&token=5d9c2ab0-c890-4b22-bac8-43ca17f20df8",
    type: "image",
  },
  "3. BT 14 Kg": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F14kg%20gas%20(normal).jpg?alt=media&token=d149ec04-5d8e-493f-8c32-e282efd424eb",
    type: "image",
  },
  "1. C14 Kg": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F14kg%20gas%20(%20forklift%20).jpg?alt=media&token=213a3c36-bb75-4a79-b43b-cc36218156da",
    type: "image",
  },
  "5. C50 Kg": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F50kg%20gas%20(commercial%20%26%20industrial).jpg?alt=media&token=5d9c2ab0-c890-4b22-bac8-43ca17f20df8",
    type: "image",
  },
  "C200 Kg": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2F200kg%20gas%20(commercial%20%26%20industrial).jpg?alt=media&token=1b1b216c-e558-4897-893d-15628932a174",
    type: "image",
  },
  "Bull Tank": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2Fbulk%20tank%20(commercial%20%26%20industrial).jpg.png?alt=media&token=b50f888f-a7f5-4420-b66a-d558435e9d81",
    type: "image",
  },
  Placement: {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FSafety%20Tips%2F14KG%20GAS%20(1-4).png?alt=media&token=37ac0ef5-e490-4980-95f0-9f4a13922c69",
    type: "image",
  },
  "Keep Away from Flammables": [
    {
      url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FSafety%20Tips%2F2%2C%203.png?alt=media&token=74501b8f-1f07-430a-9e5e-579bf299f820",
      type: "image",
    },
    {
      url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FSafety%20Tips%2F3.jpg?alt=media&token=ff225d2d-38e3-47a9-8506-1b2e6310776e",
      type: "image",
    },
  ],
  "Post-Usage": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FSafety%20Tips%2F5.png?alt=media&token=3cbe6b69-105e-4a6c-af5b-070d9e17ad12",
    type: "image",
  },
  "Avoid Ignition": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FGas%20leak%20user%20guide%2F1.2.png?alt=media&token=f4142f7c-9ae0-452f-b2e0-ddb5510a8dcd",
    type: "image",
  },
  "Turn Off Gas Supply": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FGas%20leak%20user%20guide%2F2.png?alt=media&token=c17e40c7-83e4-400b-a20d-f3444fa3a21b",
    type: "image",
  },
  Ventilate: {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FGas%20leak%20user%20guide%2F3.jpg?alt=media&token=758994af-7d1d-441f-84ed-8a4074b3bb60",
    type: "image",
  },
  "Prepare Soap Water Solution": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20gas%20leak%2F1.jpg?alt=media&token=44057500-d219-44da-b30f-5dbdd2a013cf",
    type: "image",
  },
  "Public Bank": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/7f4ea49b-b743-4fee-96f7-a25dfe02c901.jpeg?alt=media&token=ffa0a5c2-3dc9-46e4-a849-9f2b5cedd278",
    type: "image",
  },

  "Inspect the Hose": [
    {
      url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20gas%20leak%2F2.1.jpg?alt=media&token=8a3a1d43-3fce-4cbc-9983-4fb17572a9f4",
      type: "image",
    },
    {
      url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20gas%20leak%2F2.2.jpg?alt=media&token=154ca40f-e2a1-48a0-9267-96acdbfb8fca",
      type: "image",
    },
    {
      url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20gas%20leak%2F3.png?alt=media&token=0769a6fe-1b8d-4a89-9a23-d4d02d2f282b",
      type: "image",
    },
  ],
  "3 Easy Steps": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20gas%20leak%2F4.jpeg?alt=media&token=12ae9d1c-5891-42ce-a51e-ac9f010f878d",
    type: "image",
  },
  "Lesen Borong": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FCSA%20Lesen%20Borong%20Expired%2017Nov2024.pdf?alt=media&token=6296cf5e-96e4-4ff2-b371-8bad9b4891e0",
    type: "document",
    filename: "CSA Lesen Borong Expired 17Nov2024.pdf",
  },
  "Product Specifications": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20Product%20Specifications.pdf?alt=media&token=a9effbff-1798-4341-857f-df4fc2ad2cb1",
    type: "document",
    filename: "LPG Product Specifications.pdf",
  },
  "Material Safety": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FLPG%20Material%20Safety%20Data%20Sheet%20(MSDS)%20-%202-pager%20(1).pdf?alt=media&token=531565e5-6f9b-46d5-bc13-a6553c4bdb68",
    type: "document",
    filename: "LPG Material Safety Data Sheet (MSDS) - 2-pager.pdf",
  },
  "PDA License": {
    url: "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/New%20Town%2FPDA%20LICENSE%20EXPIRED%2027%20APR%2027.pdf?alt=media&token=aed70bc4-5749-496d-b794-a7f0a5c2f6ee",
    type: "document",
    filename: "PDA LICENSE EXPIRED 27 APR 27.pdf",
  },
};
// Function to add a task
async function addTask(idSubstring, taskString, assignee, dueDate) {
  if (!assignee || !dueDate) {
    return JSON.stringify({
      prompt:
        !assignee && !dueDate
          ? "Please provide an assignee and due date for the task."
          : !assignee
          ? "Please provide an assignee for the task."
          : "Please provide a due date for the task.",
      taskString: taskString,
      assignee: assignee,
      dueDate: dueDate,
    });
  }

  try {
    const taskId = uuidv4();
    const newTask = {
      id: taskId,
      task: taskString,
      assignee: assignee || null,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const companyResult = await sql`
      SELECT tasks FROM public.companies WHERE company_id = ${idSubstring}
    `;

    if (companyResult.length === 0) {
      return JSON.stringify({
        message: `No company found for this company ${idSubstring}.`,
      });
    }

    const currentTasks = companyResult[0].tasks || [];

    const updatedTasks = [...currentTasks, newTask];

    await sql`
      UPDATE public.companies 
      SET tasks = ${JSON.stringify(updatedTasks)}, 
          updated_at = CURRENT_TIMESTAMP
      WHERE company_id = ${idSubstring}
    `;

    return JSON.stringify({
      message: `Task added: ${newTask.task}, assigned to ${newTask.assignee}, due on ${newTask.dueDate}`,
    });
  } catch (error) {
    console.error(`Error adding task for company ${idSubstring}:`, error);
    return JSON.stringify({
      message: `Error adding task for company ${idSubstring}.`,
    });
  }
}

async function listAssignedTasks(idSubstring, assignee) {
  try {
    const companyResult = await sql`
      SELECT tasks FROM public.companies WHERE company_id = ${idSubstring}
    `;

    if (companyResult.length === 0) {
      return JSON.stringify({
        message: `No company found for this companyID ${idSubstring}.`,
      });
    }

    let tasks = companyResult[0].tasks || [];

    let assignedTasks = tasks.filter(
      (task) => task.assignee.toLowerCase() === assignee.toLowerCase()
    );

    if (assignedTasks.length === 0) {
      return JSON.stringify({ message: `No tasks assigned to ${assignee}.` });
    }
    tasks = assignedTasks
      .map(
        (task, index) =>
          `${index + 1}. [${task.status}] ${task.task} (Due: ${task.dueDate})`
      )
      .join("\n");
    return JSON.stringify({ tasks });
  } catch (error) {
    console.error(`Error getting tasks for company ${idSubstring}:`, error);
    return JSON.stringify({ message: `No tasks found for this company.` });
  }
}

async function listTasks(idSubstring) {
  try {
    const companyResult = await sql`
      SELECT tasks FROM public.companies WHERE company_id = ${idSubstring}
    `;

    if (companyResult.length === 0) {
      return JSON.stringify({
        message: `No company found for this companyID ${idSubstring}.`,
      });
    }

    let tasks = companyResult[0].tasks || [];

    if (tasks.length === 0) {
      return JSON.stringify({
        message: `No tasks found for this company ${idSubstring}.`,
      });
    }
    tasks = tasks
      .map(
        (task, index) =>
          `${index + 1}. [${task.status}] ${task.task} (Due: ${task.dueDate})`
      )
      .join("\n");
    return JSON.stringify({ tasks });
  } catch (error) {
    console.error(`Error getting tasks for company ${idSubstring}:`, error);
    return JSON.stringify({
      message: `No tasks found for this company ${idSubstring}.`,
    });
  }
}

async function updateTaskStatus(idSubstring, taskIndex, newStatus) {
  try {
    const companyResult = await sql`
      SELECT tasks FROM public.companies WHERE company_id = ${idSubstring}
    `;

    if (companyResult.length === 0) {
      throw new Error(`Company with ID ${idSubstring} not found`);
    }

    const currentTasks = companyResult[0].tasks || [];

    if (taskIndex === -1) {
      return JSON.stringify({
        message: `No tasks found for this index ${taskIndex}.`,
      });
    }

    currentTasks[taskIndex].status = newStatus;

    await sql`
      UPDATE public.companies 
      SET tasks = ${JSON.stringify(currentTasks)}, 
          updated_at = CURRENT_TIMESTAMP
      WHERE company_id = ${idSubstring}
    `;

    return JSON.stringify({
      message: `Task "${currentTasks[taskIndex].task}" status updated to ${newStatus}.`,
    });
  } catch (error) {
    console.error(
      `Error updating task ${taskIndex} for company ${idSubstring}:`,
      error
    );
    return JSON.stringify({
      message: `Error updating task ${taskIndex} for company ${idSubstring}:`,
    });
  }
}

async function customWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
// OneSignal Configuration
const ONESIGNAL_CONFIG = {
  appId: process.env.ONESIGNAL_APP_ID || "8df2a641-209a-4a29-bca9-4bc57fe78a31",
  apiKey: process.env.ONESIGNAL_API_KEY,
  apiUrl: "https://api.onesignal.com/api/v1/notifications",
};
async function addNotificationToUser(
  companyId,
  message,
  contactName,
  contactId = null,
  chatId = null,
  phoneNumber = null,
  profilePicUrl = null
) {
  console.log("Adding notification and sending OneSignal");
  console.log("📱 addNotificationToUser parameters:");
  console.log("   companyId:", companyId);
  console.log("   message:", message);
  console.log("   contactName:", contactName);
  console.log("   contactId:", contactId);
  console.log("   chatId:", chatId);
  console.log("   phoneNumber:", phoneNumber);
  console.log("   profilePicUrl:", profilePicUrl);
  try {
    const client = await pool.connect();

    try {
      const usersQuery = await client.query(
        "SELECT user_id, email FROM public.users WHERE company_id = $1",
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

      // Send OneSignal notification to all users in the company
      try {
        // Determine notification type based on context
        let notificationType = "company_announcement";
        let additionalData = {
          company_id: companyId,
        };

        if (contactName && contactId && chatId) {
          // This is an actual message from a contact
          notificationType = "message";
          additionalData = {
            ...additionalData,
            message_type: cleanMessage.type || "message",
            has_media: cleanMessage.hasMedia || false,
            contact_name: contactName,
            contact_id: contactId,
            chat_id: chatId,
            phone: phoneNumber,
            profile_pic_url: profilePicUrl,
            type: notificationType,
          };
        } else {
          // This is a company announcement
          additionalData = {
            ...additionalData,
            type: notificationType,
          };
        }

        console.log("📤 Sending to OneSignal with data:");
        console.log(
          "   additionalData:",
          JSON.stringify(additionalData, null, 2)
        );

        // Create the main notification payload for OneSignal
        const notificationPayload = {
          // Core notification data
          ...additionalData,

          // Profile picture fields - these go directly to OneSignal
          large_icon: isValidProfilePicUrl(profilePicUrl)
            ? getOptimizedNotificationIcon(profilePicUrl)
            : null,
          big_picture: isValidProfilePicUrl(profilePicUrl)
            ? getOptimizedNotificationIcon(profilePicUrl)
            : null,
          small_icon: "ic_launcher",

          // Android-specific enhancements
          android_accent_color: "FF2196F3",
          android_led_color: "FF2196F3",

          // iOS-specific profile picture support
          ios_attachments: isValidProfilePicUrl(profilePicUrl)
            ? { id1: getOptimizedNotificationIcon(profilePicUrl) }
            : null,

          // Additional profile picture fields for better compatibility
          chrome_web_image: isValidProfilePicUrl(profilePicUrl)
            ? getOptimizedNotificationIcon(profilePicUrl)
            : null,
        };

        console.log("📸 Notification payload with profile picture:");
        console.log("   Profile Pic URL:", profilePicUrl);
        console.log("   Is Valid URL:", isValidProfilePicUrl(profilePicUrl));
        console.log("   Large Icon:", notificationPayload.large_icon);
        console.log("   Big Picture:", notificationPayload.big_picture);
        console.log("   Small Icon:", notificationPayload.small_icon);
        console.log("   iOS Attachments:", notificationPayload.ios_attachments);
        console.log(
          "   Chrome Web Image:",
          notificationPayload.chrome_web_image
        );
        console.log(
          "   Android Accent Color:",
          notificationPayload.android_accent_color
        );
        console.log(
          "   Android LED Color:",
          notificationPayload.android_led_color
        );

        try {
          // Try to send with profile picture first
          await sendOneSignalNotification(
            companyId,
            contactName || "Company Announcement",
            notificationText,
            notificationPayload
          );
          console.log(
            `✅ OneSignal notification sent to company: ${companyId} with type: ${notificationType}`
          );
        } catch (onesignalError) {
          console.error(
            "❌ Failed to send OneSignal notification with profile picture:",
            onesignalError.message
          );

          // Fallback: Try without profile picture
          try {
            console.log("🔄 Retrying without profile picture...");
            const fallbackPayload = {
              ...additionalData,
              small_icon: "ic_launcher",
              android_accent_color: "FF2196F3",
              android_led_color: "FF2196F3",
            };

            await sendOneSignalNotification(
              companyId,
              contactName || "Company Announcement",
              notificationText,
              fallbackPayload
            );
            console.log(
              `✅ OneSignal notification sent successfully without profile picture`
            );
          } catch (fallbackError) {
            console.error(
              "❌ Failed to send OneSignal notification even without profile picture:",
              fallbackError.message
            );
          }

          // Continue with database operations even if OneSignal fails
        }
      } catch (error) {
        console.error("Error in notification sending:", error);
        // Continue with database operations even if OneSignal fails
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
    console.error("Error adding notification or sending OneSignal: ", error);
  }
}
function getOptimizedNotificationIcon(profilePicUrl) {
  // Check if profile picture URL is valid and accessible
  if (
    profilePicUrl &&
    profilePicUrl.startsWith("http") &&
    profilePicUrl.includes("whatsapp.net")
  ) {
    // WhatsApp profile pictures are usually reliable, use them
    console.log("📸 Using WhatsApp profile picture URL");

    // Ensure URL is properly encoded for OneSignal
    try {
      const encodedUrl = encodeURI(profilePicUrl);
      console.log("📸 Encoded profile picture URL:", encodedUrl);
      return encodedUrl;
    } catch (error) {
      console.log("📸 Error encoding profile picture URL:", error.message);
      return profilePicUrl; // Return original if encoding fails
    }
  } else if (profilePicUrl && profilePicUrl.startsWith("http")) {
    // Other HTTP URLs - use them but log for monitoring
    console.log("📸 Using external profile picture URL:", profilePicUrl);
    return profilePicUrl;
  } else {
    // Fallback to app icon
    console.log("📸 No valid profile picture, using app icon");
    return null; // Let OneSignal use default
  }
}
// Helper function to validate and optimize profile picture URLs for notifications
function isValidProfilePicUrl(url) {
  if (!url || typeof url !== "string") return false;

  try {
    const urlObj = new URL(url);
    return (
      urlObj.protocol === "https:" &&
      urlObj.hostname.includes("whatsapp.net") &&
      urlObj.pathname.includes(".jpg")
    );
  } catch (error) {
    console.log("📸 Invalid profile picture URL format:", url);
    return false;
  }
}

// OneSignal notification helper functions
async function sendOneSignalNotification(companyId, title, message, data = {}) {
  try {
    console.log("📤 OneSignal request details:");
    console.log("   URL:", ONESIGNAL_CONFIG.apiUrl);
    console.log("   App ID:", ONESIGNAL_CONFIG.appId);
    console.log("   Company ID:", companyId);
    console.log("   Title:", title);
    console.log("   Message:", message);
    console.log("   Data:", JSON.stringify(data, null, 2));

    const requestBody = {
      app_id: ONESIGNAL_CONFIG.appId,
      target_channel: "push",
      name: "Company Notification",
      headings: { en: title },
      contents: { en: message },
      include_external_user_ids: [companyId], // Target all users in the company

      // Profile picture support for rich notifications (OneSignal best practices)
      large_icon: data.large_icon || null, // Profile picture (right side) - OneSignal auto-scales
      big_picture: data.big_picture || null, // Full-size profile picture when expanded
      small_icon: data.small_icon || "ic_launcher", // App icon (left side, status bar)

      // Android-specific enhancements
      android_accent_color: data.android_accent_color || "FF2196F3",
      android_led_color: data.android_led_color || "FF2196F3",

      // iOS-specific profile picture support
      ios_attachments: data.ios_attachments || null,

      // Additional profile picture fields for better compatibility
      chrome_web_image: data.chrome_web_image || null,

      data: {
        type: "company_message",
        company_id: companyId,
        // Only include non-profile-picture data to avoid conflicts
        message_type: data.message_type,
        has_media: data.has_media,
        contact_name: data.contact_name,
        contact_id: data.contact_id,
        chat_id: data.chat_id,
        phone: data.phone,
        profile_pic_url: data.profile_pic_url,
        type: data.type,
      },
    };

    console.log(
      "📤 OneSignal request body:",
      JSON.stringify(requestBody, null, 2)
    );
    console.log("📸 Profile picture fields:");
    console.log("   large_icon:", requestBody.large_icon);
    console.log("   big_picture:", requestBody.big_picture);
    console.log("   small_icon:", requestBody.small_icon);
    console.log("   ios_attachments:", requestBody.ios_attachments);
    console.log("   chrome_web_image:", requestBody.chrome_web_image);

    // Use axios instead of fetch since fetch is not available in this Node.js version
    const axios = require("axios");

    const response = await axios({
      method: "POST",
      url: ONESIGNAL_CONFIG.apiUrl,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${ONESIGNAL_CONFIG.apiKey}`,
      },
      data: requestBody,
    });

    console.log("📤 OneSignal response status:", response.status);
    console.log("📤 OneSignal response headers:", response.headers);
    console.log("📤 OneSignal response body:", response.data);

    if (response.status >= 200 && response.status < 300) {
      console.log(
        `✅ OneSignal notification sent successfully:`,
        response.data
      );
      return response.data;
    } else {
      console.error(`❌ OneSignal API error:`, response.data);
      throw new Error(
        `OneSignal API error: ${
          response.data.errors?.join(", ") || "Unknown error"
        }`
      );
    }
  } catch (error) {
    console.error("❌ Error sending OneSignal notification:", error);
    if (error.response) {
      console.error("❌ OneSignal API response error:", error.response.data);
      console.error("❌ OneSignal API status:", error.response.status);
    }
    console.error("❌ Error stack:", error.stack);
    throw error;
  }
}
const messageQueue = new Map();
const processingQueue = new Map();
const MAX_QUEUE_SIZE = 5;
const RATE_LIMIT_DELAY = 5000;

async function generateSpecialReportMTDC(
  threadID,
  assistantId,
  contactName,
  extractedNumber
) {
  try {
    var currentDate = new Date().toISOString().split("T")[0]; // Format: YYYY-MM-DD
    var reportInstruction = `Please generate a report in the following format based on our conversation:

New Form Has Been Submitted

Participant Details:
Date : ${currentDate}
Name: ${contactName}
Phone Number: ${extractedNumber}
Company: [Extract from conversation]
Email: [Extract from conversation]
Program of Interest: [Extract from conversation]
Program Date & Time: [Extract from conversation]
Program of Interest 2: [Extract from conversation, if applicable, add more if needed in increments]
Program Date & Time 2: [Extract from conversation, if applicable, add more if needed in increments]

Fill in the information in square brackets with the relevant details from our conversation. If any information is not available, leave it blank. Do not change the 'Date' field, but change the 'Program Date & Time' according to the program selected formatted as 'DD/MM/YYYY HH:mm:ss'.`;

    var response = await openai.beta.threads.messages.create(threadID, {
      role: "user",
      content: reportInstruction,
    });

    var assistantResponse = await openai.beta.threads.runs.create(threadID, {
      assistant_id: assistantId,
    });

    // Wait for the assistant to complete the task
    let runStatus;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second
      runStatus = await openai.beta.threads.runs.retrieve(
        threadID,
        assistantResponse.id
      );
    } while (runStatus.status !== "completed");

    // Retrieve the assistant's response
    var messages = await openai.beta.threads.messages.list(threadID);
    var reportMessage = messages.data[0].content[0].text.value;

    var contactInfoMTDC = extractContactInfoMTDC(reportMessage);

    return { reportMessage, contactInfoMTDC };
  } catch (error) {
    console.error("Error generating special report:", error);
    return "Error generating report";
  }
}

async function generateSpecialReportSKC(
  threadID,
  assistantId,
  contactName,
  extractedNumber
) {
  try {
    var currentDate = new Date().toISOString().split("T")[0]; // Format: YYYY-MM-DD
    var reportInstruction = `Please generate a report in the following format based on our conversation:

New Form Has Been Submitted

Prospect Details:
Date : ${currentDate}
Name: ${contactName}
Phone Number: ${extractedNumber}
Age: [Extract from conversation]
Highest Qualification: [Extract from conversation]
Years of Work Experience: [Extract from conversation]
Program of Interest: [Extract from conversation]
Current Occupation: [Extract from conversation]
Current Industry: [Extract from conversation]

Fill in the information in square brackets with the relevant details from our conversation. If any information is not available, leave it blank. Do not change the Date field.`;

    var response = await openai.beta.threads.messages.create(threadID, {
      role: "user",
      content: reportInstruction,
    });

    var assistantResponse = await openai.beta.threads.runs.create(threadID, {
      assistant_id: assistantId,
    });

    // Wait for the assistant to complete the task
    let runStatus;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second
      runStatus = await openai.beta.threads.runs.retrieve(
        threadID,
        assistantResponse.id
      );
    } while (runStatus.status !== "completed");

    // Retrieve the assistant's response
    var messages = await openai.beta.threads.messages.list(threadID);
    var reportMessage = messages.data[0].content[0].text.value;

    var contactInfoSKC = extractContactInfoSKC(reportMessage);

    return { reportMessage, contactInfoSKC };
  } catch (error) {
    console.error("Error generating special report:", error);
    return "Error generating report";
  }
}

async function generateSpecialReportLKSSB(
  threadID,
  assistantId,
  contactName,
  extractedNumber
) {
  try {
    var currentDate = new Date().toISOString().split("T")[0]; // Format: YYYY-MM-DD
    var reportInstruction = `Generate a report in the following format based on our conversation and return the report in this format:

New Form Has Been Submitted

Prospect Details:
Date : ${currentDate}
Name: ${contactName}
Phone Number: ${extractedNumber}
Company Name: [Extract from conversation]
Company Address: [Extract from conversation]
Length of Construction: [Extract from conversation]
Height of Construction: [Extract from conversation]
Location: [Extract from conversation]


Fill in the information in square brackets with the relevant details from our conversation. If any information is not available, leave it blank. Do not change the Date field.`;

    var response = await openai.beta.threads.messages.create(threadID, {
      role: "user",
      content: reportInstruction,
    });

    var assistantResponse = await openai.beta.threads.runs.create(threadID, {
      assistant_id: assistantId,
    });

    // Wait for the assistant to complete the task
    let runStatus;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second
      runStatus = await openai.beta.threads.runs.retrieve(
        threadID,
        assistantResponse.id
      );
    } while (runStatus.status !== "completed");

    // Retrieve the assistant's response
    var messages = await openai.beta.threads.messages.list(threadID);
    var reportMessage = messages.data[0].content[0].text.value;

    var contactInfoLKSSB = extractContactInfoLKSSB(reportMessage);

    return { reportMessage, contactInfoLKSSB };
  } catch (error) {
    console.error("Error generating special report:", error);
    return "Error generating report";
  }
}

async function generateSpecialReportBINA(
  threadID,
  assistantId,
  contactName,
  extractedNumber
) {
  try {
    var currentDate = new Date().toISOString().split("T")[0]; // Format: YYYY-MM-DD
    var reportInstruction = `Generate a report in the following format based on our conversation and return the report in this format:

New Form Has Been Submitted

Prospect Details:
Date : ${currentDate}

- NAME: ${contactName}
- PHONE NUMBER: ${extractedNumber}
- ADDRESS: [Extract from conversation]
- EMAIL: [Extract from conversation]
- AVAILABILITY (WEEKDAYS OR WEEKEND): [Extract from conversation]
- ISSUE: [Extract from conversation]
- PHOTOS/VIDEO (AFFECTED & DEFECTED AREA): [Extract from conversation]
- HOW MANY FLOOR (HOUSE/BUILDING): [Extract from conversation]
- ROOF TILE/SLAB: [Extract from conversation]


Fill in the information in square brackets with the relevant details from our conversation. If any information is not available, leave it blank. Do not change the Date field.`;

    var response = await openai.beta.threads.messages.create(threadID, {
      role: "user",
      content: reportInstruction,
    });

    var assistantResponse = await openai.beta.threads.runs.create(threadID, {
      assistant_id: assistantId,
    });

    // Wait for the assistant to complete the task
    let runStatus;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second
      runStatus = await openai.beta.threads.runs.retrieve(
        threadID,
        assistantResponse.id
      );
    } while (runStatus.status !== "completed");

    // Retrieve the assistant's response
    var messages = await openai.beta.threads.messages.list(threadID);
    var reportMessage = messages.data[0].content[0].text.value;

    var contactInfoBINA = extractContactInfoBINA(reportMessage);

    return { reportMessage, contactInfoBINA };
  } catch (error) {
    console.error("Error generating special report:", error);
    return "Error generating report";
  }
}

// Generate a concise report for company 058666 with required sales fields
async function generateSpecialReport058666(
  threadID,
  assistantId,
  contactName,
  extractedNumber
) {
  try {
    const currentDate = new Date().toISOString().split("T")[0]; // Format: YYYY-MM-DD
    const reportInstruction = `Sila hasilkan satu laporan dalam format berikut berdasarkan perbualan kita, dalam Bahasa Melayu:

Borang Baru Telah Dihantar

Butiran Prospek:
Tarikh: ${currentDate}
Nama: ${contactName}
Nombor Telefon: ${extractedNumber}
Lokasi: [Ekstrak dari perbualan]
Produk Diminati (cth: pintu, tingkap, sebutharga rumah penuh): [Ekstrak dari perbualan]
Jenis Servis (Supply Only atau Supply and Install, untuk tingkap): [Ekstrak dari perbualan]
Jenis Pintu atau Tingkap Spesifik (cth: folding, majestic, casement, dll): [Ekstrak dari perbualan]
Keperluan Saiz Custom (jika ada): [Ekstrak dari perbualan]

Isikan maklumat dalam kurungan dengan butiran yang berkaitan dari perbualan. Jika tiada maklumat, biarkan kosong. Jangan ubah medan Tarikh.`;

    await openai.beta.threads.messages.create(threadID, {
      role: "user",
      content: reportInstruction,
    });

    const assistantResponse = await openai.beta.threads.runs.create(threadID, {
      assistant_id: assistantId,
    });

    // Wait for the assistant to complete the task
    let runStatus;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second
      runStatus = await openai.beta.threads.runs.retrieve(
        threadID,
        assistantResponse.id
      );
    } while (runStatus.status !== "completed");

    // Retrieve the assistant's response
    const messages = await openai.beta.threads.messages.list(threadID);
    const reportMessage = messages.data[0].content[0].text.value;

    // You can implement extractContactInfo058666 if you want to parse the fields
    // For now, just return the report message
    return { reportMessage };
  } catch (error) {
    console.error("Error generating special report:", error);
    return "Error generating report";
  }
}

function extractContactInfo058666(reportMessage) {
  const lines = (reportMessage || "").split(/\r?\n/).map((l) => l.trim());
  const fields = {
    Nama: "",
    Lokasi: "",
    MinatProduk: "",
    JenisPerkhidmatan: "",
    JenisSpesifik: "",
    KeperluanSaiz: "",
  };

  lines.forEach((line) => {
    if (!line.includes(":")) return;
    const idx = line.indexOf(":");
    const key = line.substring(0, idx).trim();
    const value = line.substring(idx + 1).trim();

    // handle Malay labels and English fallbacks
    switch (key.toLowerCase()) {
      case "nama":
      case "name":
        fields.Nama = value;
        break;
      case "lokasi":
      case "location":
        fields.Lokasi = value;
        break;
      case "minat produk (contoh: pintu, tingkap, sebut harga rumah penuh)":
      case "minat produk":
      case "product interest (e.g., doors, windows, full house quotation)":
      case "product interest":
        fields.MinatProduk = value;
        break;
      case "jenis perkhidmatan (supply only atau supply and install, untuk tingkap)":
      case "jenis perkhidmatan":
      case "type of service (supply only or supply and install, for windows)":
      case "type of service":
        fields.JenisPerkhidmatan = value;
        break;
      case "jenis pintu/tingkap spesifik (contoh: folding, majestic, casement, dsb)":
      case "jenis pintu/tingkap spesifik":
      case "specific door or window type (e.g., folding, majestic, casement, etc.)":
      case "specific door or window type":
        fields.JenisSpesifik = value;
        break;
      case "keperluan saiz kustom (jika berkenaan)":
      case "keperluan saiz kustom":
      case "custom size requirement (if applicable)":
      case "custom size requirement":
        fields.KeperluanSaiz = value;
        break;
      case "nombor telefon":
      case "phone number":
        // ignore
        break;
    }
  });

  return fields;
}

// AI assignment and notification for company 058666
async function handleAIAsssignResponses058666({
  threadID,
  assistantId,
  contactName,
  extractedNumber,
  client,
  idSubstring,
  phoneIndex = 0,
  msg,
}) {
  // Generate special report
  const { reportMessage, contactInfo } = await generateSpecialReport058666(
    threadID,
    assistantId,
    contactName,
    extractedNumber
  );

  // Choose employee with least assignments this month (fair/round-robin)
  const sqlClient = await pool.connect();
  try {
    const now = new Date();
    const month = now.toLocaleString("default", { month: "short" });
    const year = now.getFullYear();
    const monthKey = `${month}-${year}`; // Format: "Nov-2025"

    // First, get assignment counts from actual assignments table for this month
    const q = `
      SELECT e.*, 
             COALESCE(COUNT(a.assignment_id), 0) AS assignments_count
      FROM public.employees e
      LEFT JOIN assignments a
        ON a.employee_id = e.employee_id 
        AND a.company_id = e.company_id
        AND a.month_key = $1
        AND a.status = 'active'
      WHERE e.company_id = $2 
        AND e.active = true 
        AND e.email != 'admin@juta.com'
      GROUP BY e.id, e.employee_id, e.company_id, e.name, e.email, e.role, 
               e.current_index, e.last_updated, e.created_at, e.active, 
               e.assigned_contacts, e.phone_number, e.phone_access, 
               e.weightages, e.company, e.image_url, e.notes, 
               e.quota_leads, e.view_employees, e.invoice_number, e.emp_group
      ORDER BY assignments_count ASC, e.id ASC
      LIMIT 1
    `;

    const res = await sqlClient.query(q, [monthKey, idSubstring]);
    if (!res.rows || res.rows.length === 0) {
      console.log("No active employees found for company", idSubstring);
      return;
    }

    const employee = res.rows[0];
    console.log("Selected employee for assignment:", {
      id: employee.id,
      employee_id: employee.employee_id,
      name: employee.name,
      phone_number: employee.phone_number,
      assignments_count: employee.assignments_count
    });

    // Add tags and create assignment records (using employee.employee_id for foreign key)
    try {
      // Add employee name tag
      console.log(`[058666] Adding employee tag: ${employee.name} to contact: ${extractedNumber}`);
      await addTagToPostgres(extractedNumber, employee.name, idSubstring);
      console.log(`[058666] Employee tag added successfully`);
      
      // Add "stop bot" tag
      console.log(`[058666] Adding "stop bot" tag to contact: ${extractedNumber}`);
      await addTagToPostgres(extractedNumber, "stop bot", idSubstring);
      console.log(`[058666] "stop bot" tag added successfully`);
      
      // Get contact from database
      const contactQuery = `
        SELECT contact_id FROM contacts 
        WHERE company_id = $1 AND phone_number = $2
      `;
      const contactResult = await sqlClient.query(contactQuery, [
        idSubstring,
        extractedNumber,
      ]);

      if (contactResult.rows.length > 0) {
        const contactId = contactResult.rows[0].contact_id;
        const assignmentId = `${idSubstring}-${contactId}-${employee.employee_id}-${Date.now()}`;

        // Create assignment record (using employee.employee_id to match foreign key constraint)
        const assignmentInsertQuery = `
          INSERT INTO assignments (
            assignment_id, company_id, employee_id, contact_id, 
            assigned_at, status, month_key, assignment_type, 
            phone_index, weightage_used, employee_role
          ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'active', $5, 'auto_bot', $6, 1, $7)
        `;

        await sqlClient.query(assignmentInsertQuery, [
          assignmentId,
          idSubstring,
          employee.employee_id, // Use employee_id for foreign key
          contactId,
          monthKey,
          phoneIndex,
          "Sales",
        ]);

        console.log(`[058666] Assignment record created with employee_id: ${employee.employee_id}`);

        // Update employee's assigned_contacts count
        const employeeUpdateQuery = `
          UPDATE employees
          SET assigned_contacts = COALESCE(assigned_contacts, 0) + 1
          WHERE company_id = $1 AND id = $2
        `;

        await sqlClient.query(employeeUpdateQuery, [idSubstring, employee.id]);

        // Update monthly assignments (uses employee.id)
        const monthlyAssignmentUpsertQuery = `
          INSERT INTO employee_monthly_assignments (employee_id, company_id, month_key, assignments_count, last_updated)
          VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP)
          ON CONFLICT (employee_id, month_key) DO UPDATE
          SET assignments_count = employee_monthly_assignments.assignments_count + 1,
              last_updated = CURRENT_TIMESTAMP
        `;

        await sqlClient.query(monthlyAssignmentUpsertQuery, [
          employee.id, // Use id for monthly assignments
          idSubstring,
          monthKey,
        ]);

        console.log(`[058666] Assignment complete for employee: ${employee.name}`);
      }
    } catch (err) {
      console.error("[058666] Error creating assignment:", err);
    }

    // Send the generated report to employee via WhatsApp (instead of generic assignment message)
    const employeePhone = employee.phone_number || employee.phone || "";
    if (employeePhone) {
      const employeeId = employeePhone.replace(/\D/g, "") + "@c.us";
      try {
        const sent = await client.sendMessage(employeeId, reportMessage);
        console.log(`Sent AI-generated report to employee ${employee.name} (${employeePhone})`);
        // Log message to Postgres for record
        try {
          await addMessageToPostgres(sent, idSubstring, employeePhone);
        } catch (err) {
          console.error("Failed to log sent report to Postgres:", err);
        }
      } catch (err) {
        console.error("Failed to send report message to employee:", err);
      }
    } else {
      console.log("Assigned employee has no phone number to receive report", employee);
    }
  } catch (error) {
    console.error("Error in handleAIAsssignResponses:", error);
  } finally {
    await safeRelease(sqlClient);
  }
}


async function insertSpreadsheetMTDC(reportMessage) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: "./service_account.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = "1bW-KOpZ0lUDVNT4A6GZzzsIrne6MTBeBszrbOMyzoLI";
    const range = "Submissions!A:I";

    const lines = reportMessage.split("\n");
    const data = {
      programs: [],
      programDates: [],
    };

    console.log("Processing lines:");
    lines.forEach((line, index) => {
      console.log(`Line ${index}:`, JSON.stringify(line));

      if (line.includes(":")) {
        const colonIndex = line.indexOf(":");
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();

        console.log(`Key: "${key}", Value: "${value}"`);

        if (key.match(/^Program of Interest(\s+\d+)?$/)) {
          console.log("Found Program of Interest:", value);
          data.programs.push(value);
        } else if (key.match(/^Program Date & Time(\s+\d+)?$/)) {
          console.log("Found Program Date & Time:", value);
          data.programDates.push(value);
        } else {
          switch (key) {
            case "Name":
              data["Name"] = value;
              console.log("Found Name:", value);
              break;
            case "Phone Number":
              data["Phone"] = value;
              console.log("Found Phone:", value);
              break;
            case "Email":
              data["Email"] = value;
              console.log("Found Email:", value);
              break;
            case "Company":
              data["Company"] = value;
              console.log("Found Company:", value);
              break;
          }
        }
      }
    });

    console.log("Final extracted data:", data);

    console.log("Report Message From MTDC:", reportMessage);

    const timestamp = moment()
      .tz("Asia/Kuala_Lumpur")
      .format("D/M/YYYY H:mm:ss");

    const formatDateTimeString = (dateTimeString) => {
      if (!dateTimeString || dateTimeString === "Unspecified")
        return "Unspecified";

      const correctFormatRegex =
        /^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2}$/;
      if (correctFormatRegex.test(dateTimeString)) {
        return dateTimeString;
      }

      try {
        const formattedDate = moment(dateTimeString)
          .tz("Asia/Kuala_Lumpur")
          .format("D/M/YYYY H:mm:ss");
        return formattedDate !== "Invalid date" ? formattedDate : "Unspecified";
      } catch (error) {
        console.error("Error formatting date string:", error);
        return "Unspecified";
      }
    };

    const getCategoryFromProgram = (programName) => {
      if (!programName) return "Unspecified";

      // Check if the program name contains any of the FUTUREX.AI 2025 programs
      if (
        programName.includes("Business Automation & AI Chatbot Experience") ||
        programName.includes(
          "Digitalpreneur - Create an Online Course with AI"
        ) ||
        programName.includes(
          "AI Immersion - Automate It. Analyse It. Storytell It"
        ) ||
        programName.includes("AI Agent & Agentic AI Day 2025")
      ) {
        return "FUTUREX.AI 2025: Adapt. Advance. Achieve.";
      } else {
        return "Other";
      }
    };

    const rowData = data.programs
      .map((program, index) => [
        timestamp,
        data["Name"] || "Unspecified",
        data["Company"] || "Unspecified",
        data["Phone"].split("+")[1] || "Unspecified",
        data["Email"] || "Unspecified",
        program || "Unspecified",
        formatDateTimeString(data.programDates[index] || "Unspecified"),
        "Pending", // RSVP status
        "Pending", // Attendance status
        "No", // Certification Sent
        getCategoryFromProgram(program), // Category
      ])
      .filter((row) => row[5] !== "Unspecified"); // Filter out rows with unspecified programs

    const getRowsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const lastRow = getRowsResponse.data.values
      ? getRowsResponse.data.values.length + 1
      : 1;

    for (const row of rowData) {
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `Submissions!A${lastRow}:K${lastRow}`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        resource: {
          values: [row],
        },
      });

      console.log(
        `${response.data.updates.updatedCells} cells appended at row ${lastRow} for MTDC Google Sheet.`
      );
      console.log("Added row with data:", row);
    }

    return { success: true };
  } catch (error) {
    console.error("Error updating MTDC Google Sheet:", error);
    throw error;
  }
}

async function updateGoogleSheet(reportMessage) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: "./service_account.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = "1i23tzU2l48aLbCR2M9psJ2Sjmadzqj18bCYiFxmD3z4";
    const range = "Form_Responses!A:Y";

    // Extract data from reportMessage
    const lines = reportMessage.split("\n");
    const data = {};
    lines.forEach((line) => {
      if (line.includes(":")) {
        const [key, value] = line.split(":").map((s) => s.trim());
        // Map the exact field names from the report
        switch (key) {
          case "Name":
            data["Name"] = value;
            break;
          case "Phone Number":
            data["Contact Number"] = value;
            break;
          case "Age":
            data["Age"] = value;
            break;
          case "Highest Qualification":
            data["Highest Qualification"] = value;
            break;
          case "Years of Work Experience":
            data["Years of Work Experience"] = value;
            break;
          case "Program of Interest":
            data["Program of Interest"] = value;
            break;
          case "Current Occupation":
            data["Current Occupation"] = value;
            break;
          case "Current Industry":
            data["Current Industry"] = value;
            break;
        }
      }
    });

    // Get current timestamp in Malaysia timezone
    const timestamp = moment()
      .tz("Asia/Kuala_Lumpur")
      .format("DD/MM/YYYY HH:mm:ss");

    // Create row data with exact column mapping
    const rowData = [
      [
        // Note the extra square brackets here
        "=ROW() - 1", // No (A)
        timestamp, // Submission Date (B)
        "", // Processed Date (C)
        "", // Trigger (D)
        "", // Name Of PIC (E)
        "", // PIC Contact Number (F)
        "", // Greeting (G)
        "", // Entry Mode (H)
        "", // Website (I)
        data["Name"] || "Unspecified", // Name (J)
        data["Highest Qualification"] || "Unspecified", // Highest Qualification (K)
        data["Contact Number"] || "Unspecified", // Contact Number (L)
        data["Years of Work Experience"] || "Unspecified", // Years of Work Experience (M)
        data["Age"] || "Unspecified", // Age (N)
        data["Program of Interest"] || "Unspecified", // Program of Interest (O)
        data["Current Occupation"] || "Unspecified", // Current Occupation (P)
        data["Current Industry"] || "Unspecified", // Current Industry (Q)
      ],
    ];

    // First, get the last row number
    const getRowsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Form_Responses!A:A", // Get all values in column A to find last row
    });

    const lastRow = getRowsResponse.data.values
      ? getRowsResponse.data.values.length + 1
      : 1;

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `Form_Responses!A${lastRow}:Q${lastRow}`, // Specify exact row range
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: rowData,
      },
    });

    console.log(
      `${response.data.updates.updatedCells} cells appended at row ${lastRow}`
    );
    console.log("Added row with data:", rowData);
    return response;
  } catch (error) {
    console.error("Error updating Google Sheet:", error);
    throw error;
  }
}

async function createAppointment(companyId, appointmentData) {
  const client = await pool.connect();

  try {
    console.log("Starting appointment creation for company:", companyId);

    let userEmail = "admin@juta.com";
    try {
      const userResult = await client.query(
        "SELECT user_id, email FROM public.users WHERE company_id = $1 LIMIT 1",
        [companyId]
      );

      if (userResult.rows.length > 0) {
        userEmail = userResult.rows[0].email || userResult.rows[0].user_id;
      }
    } catch (userError) {
      console.error("Error finding user:", userError);
    }

    console.log("Using user email for appointment:", userEmail);

    const appointmentId = uuidv4();

    const {
      contact_id,
      title,
      description,
      scheduled_time,
      duration_minutes,
      status = "scheduled",
    } = appointmentData;

    // Validate scheduled_time
    if (!scheduled_time) {
      throw new Error("scheduled_time is required");
    }

    const parsedDate = new Date(scheduled_time);
    if (isNaN(parsedDate.getTime())) {
      throw new Error(`Invalid scheduled_time format: ${scheduled_time}`);
    }

    // Validate duration_minutes
    const parsedDuration = parseInt(duration_minutes);
    if (isNaN(parsedDuration) || parsedDuration <= 0) {
      throw new Error(`Invalid duration_minutes: ${duration_minutes}`);
    }

    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO public.appointments (
        appointment_id, company_id, contact_id, title, description, 
        scheduled_time, duration_minutes, status, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        appointmentId,
        companyId,
        contact_id,
        title,
        description,
        parsedDate,
        parsedDuration,
        status,
        JSON.stringify({ userEmail, ...(appointmentData.metadata || {}) }),
      ]
    );

    await client.query("COMMIT");

    console.log("Successfully created appointment with ID:", appointmentId);
    return appointmentId;
  } catch (error) {
    await safeRollback(client);
    console.error("Error creating appointment:", error);
    throw error;
  } finally {
    await safeRelease(client);
  }
}

async function createCalendarEvent(
  summary,
  description,
  startDateTime,
  endDateTime,
  phoneNumber,
  companyName,
  idSubstring,
  contact,
  client
) {
  try {
    console.log("Creating calendar event with params:", {
      summary,
      description,
      startDateTime,
      endDateTime,
      phoneNumber,
      companyName,
    });

    // Validate input parameters
    if (!startDateTime || !endDateTime) {
      return { error: "startDateTime and endDateTime are required" };
    }

    const startDate = new Date(startDateTime);
    const endDate = new Date(endDateTime);

    if (isNaN(startDate.getTime())) {
      return { error: `Invalid startDateTime format: ${startDateTime}` };
    }

    if (isNaN(endDate.getTime())) {
      return { error: `Invalid endDateTime format: ${endDateTime}` };
    }

    if (startDate >= endDate) {
      return { error: "startDateTime must be before endDateTime" };
    }

    const sqlClient = await pool.connect();

    const calendarConfigQuery = await sqlClient.query(
      `SELECT setting_value FROM public.settings 
       WHERE company_id = $1 
       AND setting_type = 'config' 
       AND setting_key = 'calendar'`,
      [idSubstring]
    );

    const calendarConfig =
      calendarConfigQuery.rows.length > 0
        ? calendarConfigQuery.rows[0].setting_value
        : {};

    // Set default values to prevent NaN calculations
    const slotDuration = calendarConfig.slotDuration || 60;

    let calendarId = calendarConfig.calendarId;
    let firebaseId = calendarConfig.firebaseId;
    let userEmail = "admin@juta.com";

    // Check if it's a service appointment from description
    const isService =
      description.toLowerCase().includes("servis") ||
      description.toLowerCase().includes("service") ||
      summary.toLowerCase().includes("servis") ||
      summary.toLowerCase().includes("service");

    // Calculate duration based on appointment type
    let appointmentDuration;
    if (isService) {
      appointmentDuration = Math.ceil(40 / slotDuration) * slotDuration;
    } else if (summary.toLowerCase().includes("troubleshoot")) {
      appointmentDuration = Math.ceil(60 / slotDuration) * slotDuration;
    } else {
      appointmentDuration = slotDuration;
    }

    // Extract unit count from description
    let units = "1"; // default value
    const hpMatch = description.match(/(\d+)\s*HP/i);
    const unitMatch = description.match(/(\d+)\s*unit/i);

    if (hpMatch) {
      units = hpMatch[1];
    } else if (unitMatch) {
      units = unitMatch[1];
    }
    const formattedTitle = `${phoneNumber} ${
      isService ? "(S)" : ""
    } ${units} UNIT`;

    // Extract and clean address from description
    let address = description
      .replace(/(\d+)\s*HP.*?inverter/i, "")
      .replace(/servis\s*aircond/i, "")
      .replace(/service\s*aircond/i, "")
      .trim();

    // If address starts with "di", remove it
    address = address.replace(/^di\s+/i, "").trim();

    await addTagToPostgres(phoneNumber, "Booked Appointment", idSubstring);

    // When creating the end time - use the validated dates
    const roundedStart = new Date(
      Math.ceil(startDate.getTime() / (slotDuration * 60 * 1000)) *
        (slotDuration * 60 * 1000)
    );
    const end = new Date(
      roundedStart.getTime() + appointmentDuration * 60 * 1000
    );

    // Get available staff pair
    let assignedStaff = [];

    if (firebaseId) {
      const employeesQuery = await sqlClient.query(
        `SELECT email FROM public.employees 
         WHERE company_id = $1 
         AND email != 'wannazrol888@gmail.com'
         AND active = true`,
        ["0153"]
      );

      const employees = employeesQuery.rows.map((row) => row.email);

      const userQuery = await sqlClient.query(
        `SELECT email FROM public.users 
         WHERE company_id = $1 
         LIMIT 1`,
        [idSubstring]
      );

      if (userQuery.rows.length > 0) {
        userEmail = userQuery.rows[0].email;
      }

      const appointmentStart = moment(startDateTime);
      const appointmentEnd = moment(endDateTime);

      const appointmentsQuery = await sqlClient.query(
        `SELECT * FROM public.appointments 
         WHERE company_id = $1 
         AND scheduled_time <= $2
         AND scheduled_time + (duration_minutes * interval '1 minute') >= $3`,
        [idSubstring, endDateTime, startDateTime]
      );

      const existingAppointments = appointmentsQuery.rows;

      // Create a set of busy staff
      const busyStaff = new Set();

      // Find which staff are busy
      existingAppointments.forEach((doc) => {
        const appointment = doc.data();
        const apptStart = moment(appointment.startTime);
        const apptEnd = moment(appointment.endTime);

        if (
          !(
            appointmentEnd.isSameOrBefore(apptStart) ||
            appointmentStart.isSameOrAfter(apptEnd)
          )
        ) {
          appointment.staff?.forEach((staffEmail) => {
            busyStaff.add(staffEmail);
          });
        }
      });

      // Get available staff
      const availableStaff = employees.filter((staff) => !busyStaff.has(staff));
      console.log("Available staff:", availableStaff);

      // If we have at least 2 available staff members, pair them
      if (availableStaff.length >= 2) {
        assignedStaff = [availableStaff[0], availableStaff[1]];
        console.log("Assigned staff pair:", assignedStaff);
      } else {
        console.log("Not enough available staff:", availableStaff.length);
        return { error: "Not enough staff available for this time slot" };
      }
    }

    const contactID =
      idSubstring +
      "-" +
      (phoneNumber.startsWith("+") ? phoneNumber.slice(1) : phoneNumber);

    // Appointment data to create appointment in Database
    const appointmentData = {
      contact_id: contactID,
      title: contact.name + " " + phoneNumber,
      description: description || "",
      scheduled_time: roundedStart.toISOString(),
      duration_minutes: appointmentDuration,
      status: "new",
      metadata: {
        startTime: roundedStart.toISOString(),
        endTime: end.toISOString(),
        appointmentStatus: "new",
        staff: assignedStaff,
        color: calendarConfig.defaultColor || "#1F3A8A",
        packageId: "",
        address: address || "",
        dateAdded: new Date().toISOString(),
        contacts: [
          {
            id: phoneNumber,
            name: contact.name,
            session: null,
          },
        ],
        details: description || "",
        meetlink: "",
        type: isService ? "Service" : "Installation",
        units: units,
        companyId: idSubstring,
        userEmail: userEmail,
      },
    };

    // Create appointment in Database
    await createAppointment(idSubstring, appointmentData);

    // Create event in Google Calendar if calendarId exists
    if (calendarId) {
      const auth = new google.auth.GoogleAuth({
        keyFile: "./service_account.json",
        scopes: ["https://www.googleapis.com/auth/calendar"],
      });

      const calendar = google.calendar({ version: "v3", auth });

      const event = {
        summary: summary + " - " + contact.name,
        description: `${description}\n\nContact: ${
          contact.name
        } (${phoneNumber})${
          assignedStaff.length > 0
            ? "\nAssigned Staff: " + assignedStaff.join(", ")
            : ""
        }`,
        start: {
          dateTime: startDateTime,
          timeZone: calendarConfig.timezone || "Asia/Kuala_Lumpur",
        },
        end: {
          dateTime: end.toISOString(),
          timeZone: calendarConfig.timezone || "Asia/Kuala_Lumpur",
        },
      };

      if (idSubstring == "0148") {
        const tags = (contact.tags || []).map((tag) => tag.toLowerCase());
        if (tags.includes("pj")) {
          await calendar.events.insert({
            calendarId: calendarConfig.calendarId2,
            resource: event,
          });
        } else {
          await calendar.events.insert({
            calendarId: calendarConfig.calendarId,
            resource: event,
          });
        }
      } else {
        await calendar.events.insert({
          calendarId: calendarConfig.calendarId,
          resource: event,
        });
      }
    }

    // Send confirmation messages and schedule reminders
    if (client && idSubstring == "0153") {
      try {
        const adminChatId = "120363378661947569@g.us";
        const adminMessage =
          `*New ${
            isService ? "Service" : ""
          } Appointment Booked Please Confirm with Customer*\n\n` +
          `📅 Date: ${moment(startDateTime).format("DD/MM/YYYY")}\n` +
          `⏰ Time: ${moment(startDateTime).format("HH:mm")}\n` +
          `👥 Assigned Staff: ${assignedStaff.join(", ")}\n` +
          `📱 Contact: ${phoneNumber}\n` +
          `👤 Name: ${contact.name}\n` +
          `🔧 Units: ${units} ${isService ? "(Service)" : ""}\n` +
          `📍 Address: ${address.toUpperCase()}`;

        await client.sendMessage(adminChatId, adminMessage);
        console.log("Sent appointment confirmation to admin");
      } catch (error) {
        console.error("Error sending admin confirmation:", error);
      }
    }

    if (client && idSubstring == "095") {
      try {
        const adminChatId = "120363325228671809@g.us";
        const adminMessage =
          `*New Appointment Booked Please Confirm with Customer*\n\n` +
          `📅 Date: ${moment(startDateTime).format("DD/MM/YYYY")}\n` +
          `📱 Contact: ${phoneNumber}\n` +
          `👤 Name: ${contact.name}\n`;

        await client.sendMessage(adminChatId, adminMessage);
        console.log("Sent appointment confirmation to admin");
      } catch (error) {
        console.error("Error sending admin confirmation:", error);
      }
    }

    return {
      success: true,
      message: "Appointment created successfully",
      appointmentDetails: {
        date: roundedStart.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
        }),
        time: `${roundedStart.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })} - ${end.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })}`,
        description:
          description +
          "\n" +
          `\n\nContact: ${contact.name || "Unknown"} (${
            phoneNumber || "No phone number found"
          })`,
        contact: `${contact.name || "Unknown"} (${
          phoneNumber || "No phone number found"
        })`,
        staff: assignedStaff.join(", "),
        type: isService ? "Service" : "Installation",
        units: units,
      },
    };
  } catch (error) {
    console.error("Error in createCalendarEvent:", error);
    return { error: `Failed to create appointment: ${error.message}` };
  }
}

async function rescheduleCalendarEvent(
  newStartDateTime,
  newEndDateTime,
  phoneNumber,
  contactName,
  companyName,
  idSubstring,
  contact,
  client,
  reason = "",
  appointmentDate = null
) {
  try {
    console.log("Rescheduling calendar event with params:", {
      newStartDateTime,
      newEndDateTime,
      phoneNumber,
      contactName,
      companyName,
      reason,
      appointmentDate,
    });

    const sqlClient = await pool.connect();

    // Get calendar configuration
    const calendarConfigQuery = await sqlClient.query(
      `SELECT setting_value FROM public.settings 
       WHERE company_id = $1 
       AND setting_type = 'config' 
       AND setting_key = 'calendar'`,
      [idSubstring]
    );
    const contactID =
      idSubstring +
      "-" +
      (phoneNumber.startsWith("+") ? phoneNumber.slice(1) : phoneNumber);

    const calendarConfig =
      calendarConfigQuery.rows.length > 0
        ? calendarConfigQuery.rows[0].setting_value
        : {};

    let calendarId = calendarConfig.calendarId;
    let firebaseId = calendarConfig.firebaseId;
    let userEmail = "admin@juta.com";

    // Get user email
    const userQuery = await sqlClient.query(
      `SELECT email FROM public.users 
       WHERE company_id = $1 
       LIMIT 1`,
      [idSubstring]
    );

    if (userQuery.rows.length > 0) {
      userEmail = userQuery.rows[0].email;
    }

    // First, check if the appointment exists
    let existingAppointment;
    // If no appointmentId provided, find by phone number and optional date
    let phoneQuery;
    let queryParams = [contactID, idSubstring];

    if (appointmentDate) {
      // If appointment date is provided, find appointments on that specific date
      const startOfDay = moment(appointmentDate).startOf("day").toISOString();
      const endOfDay = moment(appointmentDate).endOf("day").toISOString();

      phoneQuery = await sqlClient.query(
        `SELECT * FROM public.appointments 
          WHERE contact_id = $1 AND company_id = $2 
          AND status IN ('scheduled', 'confirmed')
          AND scheduled_time >= $3 AND scheduled_time <= $4
          ORDER BY scheduled_time ASC`,
        [contactID, idSubstring, startOfDay, endOfDay]
      );

      if (phoneQuery.rows.length === 0) {
        return {
          error: `No appointment found for this contact on ${moment(
            appointmentDate
          ).format("DD/MM/YYYY")}`,
        };
      } else if (phoneQuery.rows.length > 1) {
        // Multiple appointments on the same date - return list for user to choose
        const appointmentsList = phoneQuery.rows.map((apt, index) => ({
          index: index + 1,
          appointmentId: apt.appointment_id,
          time: moment(apt.scheduled_time).format("HH:mm"),
          title: apt.title,
          description: apt.description,
        }));

        return {
          error: "Multiple appointments found on this date",
          multipleAppointments: appointmentsList,
          message: `Found ${appointmentsList.length} appointments on ${moment(
            appointmentDate
          ).format(
            "DD/MM/YYYY"
          )}. Please specify which appointment to reschedule by providing the appointment ID or time.`,
        };
      }

      existingAppointment = phoneQuery.rows[0];
    } else {
      // No date provided, get the most recent/upcoming appointment
      phoneQuery = await sqlClient.query(
        `SELECT * FROM public.appointments 
          WHERE contact_id = $1 AND company_id = $2 
          AND status IN ('scheduled', 'confirmed')
          ORDER BY scheduled_time DESC
          LIMIT 1`,
        queryParams
      );

      if (phoneQuery.rows.length === 0) {
        return { error: "No existing appointment found for this contact" };
      }

      existingAppointment = phoneQuery.rows[0];
    }

    let appointmentId = existingAppointment.appointment_id;
    console.log("Found existing appointment:", existingAppointment);

    // Check if it's a service appointment
    const description = existingAppointment.description || "";
    const title = existingAppointment.title || "";
    const isService =
      description.toLowerCase().includes("servis") ||
      description.toLowerCase().includes("service") ||
      title.toLowerCase().includes("servis") ||
      title.toLowerCase().includes("service");

    // Calculate duration based on appointment type
    let appointmentDuration;
    if (isService) {
      appointmentDuration =
        Math.ceil(40 / calendarConfig.slotDuration) *
        calendarConfig.slotDuration;
    } else if (title.toLowerCase().includes("troubleshoot")) {
      appointmentDuration =
        Math.ceil(60 / calendarConfig.slotDuration) *
        calendarConfig.slotDuration;
    } else {
      appointmentDuration = calendarConfig.slotDuration || 60;
    }

    // Round the new start time to the nearest slot
    const newStart = new Date(newStartDateTime);
    const roundedNewStart = new Date(
      Math.ceil(
        newStart.getTime() / (calendarConfig.slotDuration * 60 * 1000)
      ) *
        (calendarConfig.slotDuration * 60 * 1000)
    );

    // Calculate new end time
    const newEnd = new Date(
      roundedNewStart.getTime() + appointmentDuration * 60 * 1000
    );

    // Check for scheduling conflicts (excluding the current appointment)
    const conflictQuery = await sqlClient.query(
      `SELECT * FROM public.appointments 
       WHERE company_id = $1 
       AND appointment_id != $2
       AND status IN ('scheduled', 'confirmed')
       AND (
         (scheduled_time <= $3 AND scheduled_time + (duration_minutes * interval '1 minute') > $4) OR
         (scheduled_time < $5 AND scheduled_time + (duration_minutes * interval '1 minute') >= $4)
       )`,
      [
        idSubstring,
        appointmentId,
        newEnd.toISOString(),
        roundedNewStart.toISOString(),
        newEnd.toISOString(),
      ]
    );

    let conflictingAppointments = [];

    // Add database conflicts
    if (conflictQuery.rows.length > 0) {
      conflictingAppointments = conflictQuery.rows.map((appointment) => ({
        source: "database",
        id: appointment.appointment_id,
        title: appointment.title,
        startTime: appointment.scheduled_time,
        endTime: new Date(
          appointment.scheduled_time.getTime() +
            appointment.duration_minutes * 60 * 1000
        ),
        contact: appointment.contact_id,
      }));
    }

    // Check Google Calendar conflicts if calendarId exists
    let calendarConflicts = [];
    if (calendarId) {
      try {
        const auth = new google.auth.GoogleAuth({
          keyFile: "./service_account.json",
          scopes: ["https://www.googleapis.com/auth/calendar"],
        });

        const calendar = google.calendar({ version: "v3", auth });

        // Get events during the new time slot
        const calendarEvents = await calendar.events.list({
          calendarId: calendarConfig.calendarId,
          timeMin: roundedNewStart.toISOString(),
          timeMax: newEnd.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
        });

        if (calendarEvents.data.items && calendarEvents.data.items.length > 0) {
          // Filter out the current appointment being rescheduled
          const currentAppointmentTitle = `${phoneNumber}`;

          calendarConflicts = calendarEvents.data.items
            .filter(
              (event) =>
                !event.summary ||
                !event.summary.includes(currentAppointmentTitle)
            )
            .map((event) => ({
              source: "google_calendar",
              id: event.id,
              title: event.summary || "Untitled Event",
              startTime: new Date(event.start.dateTime || event.start.date),
              endTime: new Date(event.end.dateTime || event.end.date),
              contact: event.description || "Unknown",
            }));
        }
      } catch (calendarError) {
        console.error(
          "Error checking Google Calendar conflicts:",
          calendarError
        );
      }
    }

    // Combine all conflicts
    const allConflicts = [...conflictingAppointments, ...calendarConflicts];

    if (allConflicts.length > 0) {
      return {
        error: "Scheduling conflict detected",
        conflictingAppointments: allConflicts,
        message: `The requested time slot conflicts with ${allConflicts.length} existing appointment(s) (${conflictingAppointments.length} from database, ${calendarConflicts.length} from Google Calendar). Please choose a different time.`,
      };
    }

    // Check staff availability if firebaseId exists
    let assignedStaff = [];
    if (firebaseId) {
      const employeesQuery = await sqlClient.query(
        `SELECT email FROM public.employees 
         WHERE company_id = $1 
         AND email != 'wannazrol888@gmail.com'
         AND active = true`,
        ["0153"]
      );

      const employees = employeesQuery.rows.map((row) => row.email);

      const appointmentStart = moment(newStartDateTime);
      const appointmentEnd = moment(newEndDateTime);

      // Check for existing appointments during the new time slot
      const busyStaffQuery = await sqlClient.query(
        `SELECT metadata FROM public.appointments 
         WHERE company_id = $1 
         AND appointment_id != $2
         AND status IN ('scheduled', 'confirmed')
         AND scheduled_time <= $3
         AND scheduled_time + (duration_minutes * interval '1 minute') >= $4`,
        [
          idSubstring,
          appointmentId,
          newEnd.toISOString(),
          roundedNewStart.toISOString(),
        ]
      );

      const busyStaff = new Set();
      busyStaffQuery.rows.forEach((row) => {
        const metadata = row.metadata || {};
        if (metadata.staff && Array.isArray(metadata.staff)) {
          metadata.staff.forEach((staffEmail) => {
            busyStaff.add(staffEmail);
          });
        }
      });

      // Get available staff
      const availableStaff = employees.filter((staff) => !busyStaff.has(staff));
      console.log("Available staff for reschedule:", availableStaff);

      // If we have at least 2 available staff members, pair them
      if (availableStaff.length >= 2) {
        assignedStaff = [availableStaff[0], availableStaff[1]];
        console.log("Assigned staff pair for reschedule:", assignedStaff);
      } else if (availableStaff.length === 1) {
        assignedStaff = [availableStaff[0]];
        console.log("Assigned single staff for reschedule:", assignedStaff);
      } else {
        return { error: "Not enough staff available for this time slot" };
      }
    }

    // Update the appointment in the database
    await sqlClient.query("BEGIN");

    console.log("Updating appointment:", appointmentId);
    const updateResult = await sqlClient.query(
      `UPDATE public.appointments 
       SET scheduled_time = $1, 
           duration_minutes = $2,
           metadata = $3
       WHERE appointment_id = $4 AND company_id = $5
       RETURNING *`,
      [
        roundedNewStart.toISOString(),
        appointmentDuration,
        JSON.stringify({
          userEmail,
          staff: assignedStaff,
          rescheduleReason: reason,
          originalTime: existingAppointment.scheduled_time,
          ...(existingAppointment.metadata || {}),
        }),
        appointmentId,
        idSubstring,
      ]
    );

    if (updateResult.rows.length === 0) {
      await safeRollback(sqlClient);
      return { error: "Failed to update appointment" };
    }

    await sqlClient.query("COMMIT");

    // Update Google Calendar if calendarId exists
    let calendarEventUpdated = false;
    if (calendarId) {
      try {
        const auth = new google.auth.GoogleAuth({
          keyFile: "./service_account.json",
          scopes: ["https://www.googleapis.com/auth/calendar"],
        });

        const calendar = google.calendar({ version: "v3", auth });

        // Search for existing calendar event
        const existingEvents = await calendar.events.list({
          calendarId: calendarConfig.calendarId,
          q: `${phoneNumber}`,
          timeMin: new Date(
            existingAppointment.scheduled_time.getTime() - 24 * 60 * 60 * 1000
          ).toISOString(),
          timeMax: new Date(
            existingAppointment.scheduled_time.getTime() + 24 * 60 * 60 * 1000
          ).toISOString(),
        });

        if (existingEvents.data.items && existingEvents.data.items.length > 0) {
          const eventToUpdate = existingEvents.data.items[0];

          const updatedEvent = {
            ...eventToUpdate,
            start: {
              dateTime: roundedNewStart.toISOString(),
              timeZone: calendarConfig.timezone || "Asia/Kuala_Lumpur",
            },
            end: {
              dateTime: newEnd.toISOString(),
              timeZone: calendarConfig.timezone || "Asia/Kuala_Lumpur",
            },
            description: `${description}${
              reason ? `\n\nReschedule Reason: ${reason}` : ""
            }\n\nContact: ${contactName} (${phoneNumber})${
              assignedStaff.length > 0
                ? "\nAssigned Staff: " + assignedStaff.join(", ")
                : ""
            }`,
          };

          await calendar.events.update({
            calendarId: calendarConfig.calendarId,
            eventId: eventToUpdate.id,
            resource: updatedEvent,
          });

          calendarEventUpdated = true;
          console.log("Google Calendar event updated successfully");
        }
      } catch (calendarError) {
        console.error("Error updating Google Calendar event:", calendarError);
        // Don't fail the entire operation if calendar update fails
      }
    }

    // Add reschedule tag to contact
    await addTagToPostgres(phoneNumber, "Rescheduled Appointment", idSubstring);

    await safeRelease(sqlClient);

    return {
      success: true,
      message: "Appointment rescheduled successfully",
      appointmentDetails: {
        appointmentId: appointmentId,
        previousDateTime: moment(existingAppointment.scheduled_time).format(
          "DD/MM/YYYY HH:mm"
        ),
        newDate: roundedNewStart.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
        }),
        newTime: `${roundedNewStart.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })} - ${newEnd.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })}`,
        description:
          description + (reason ? `\n\nReschedule Reason: ${reason}` : ""),
        contact: `${contactName || "Unknown"} (${
          phoneNumber || "No phone number found"
        })`,
        staff: assignedStaff.join(", "),
        type: isService ? "Service" : "Installation",
        calendarUpdated: calendarEventUpdated,
        reason: reason || "No reason provided",
      },
    };
  } catch (error) {
    console.error("Error in rescheduleCalendarEvent:", error);
    return { error: `Failed to reschedule appointment: ${error.message}` };
  }
}

async function cancelCalendarEvent(
  phoneNumber,
  contactName,
  companyName,
  idSubstring,
  contact,
  client,
  reason = "",
  appointmentDateandTime = null
) {
  try {
    console.log("Canceling calendar event with params:", {
      phoneNumber,
      contactName,
      companyName,
      reason,
      appointmentDateandTime,
    });

    const sqlClient = await pool.connect();

    // Get calendar configuration
    const calendarConfigQuery = await sqlClient.query(
      `SELECT setting_value FROM public.settings 
       WHERE company_id = $1 
       AND setting_type = 'config' 
       AND setting_key = 'calendar'`,
      [idSubstring]
    );
    const contactID =
      idSubstring +
      "-" +
      (phoneNumber.startsWith("+") ? phoneNumber.slice(1) : phoneNumber);

    const calendarConfig =
      calendarConfigQuery.rows.length > 0
        ? calendarConfigQuery.rows[0].setting_value
        : {};

    let calendarId = calendarConfig.calendarId;
    let userEmail = "admin@juta.com";

    // Get user email
    const userQuery = await sqlClient.query(
      `SELECT email FROM public.users 
       WHERE company_id = $1 
       LIMIT 1`,
      [idSubstring]
    );

    if (userQuery.rows.length > 0) {
      userEmail = userQuery.rows[0].email;
    }

    // First, find the appointment to cancel
    let existingAppointment;

    let phoneQuery;
    let queryParams = [contactID, idSubstring];

    if (appointmentDateandTime) {
      // Parse the appointment date and time
      const appointmentMoment = moment(appointmentDateandTime).tz(
        "Asia/Kuala_Lumpur"
      );

      if (!appointmentMoment.isValid()) {
        return {
          error:
            "Invalid date and time format. Please provide date and time in a valid format.",
        };
      }

      // Create a time window around the specified time (±30 minutes)
      const startWindow = appointmentMoment
        .clone()
        .subtract(30, "minutes")
        .toISOString();
      const endWindow = appointmentMoment
        .clone()
        .add(30, "minutes")
        .toISOString();

      phoneQuery = await sqlClient.query(
        `SELECT * FROM public.appointments 
          WHERE contact_id = $1 AND company_id = $2 
          AND status IN ('scheduled', 'confirmed')
          AND scheduled_time >= $3 AND scheduled_time <= $4
          ORDER BY ABS(EXTRACT(EPOCH FROM (scheduled_time - $5::timestamp)))`,
        [
          contactID,
          idSubstring,
          startWindow,
          endWindow,
          appointmentMoment.toISOString(),
        ]
      );

      if (phoneQuery.rows.length === 0) {
        return {
          error: `No appointment found for this contact around ${appointmentMoment.format(
            "DD/MM/YYYY HH:mm"
          )}`,
        };
      } else if (phoneQuery.rows.length > 1) {
        // Multiple appointments found - return list for user to choose
        const appointmentsList = phoneQuery.rows.map((apt, index) => ({
          index: index + 1,
          appointmentId: apt.appointment_id,
          time: moment(apt.scheduled_time).format("HH:mm"),
          date: moment(apt.scheduled_time).format("DD/MM/YYYY"),
          title: apt.title,
          description: apt.description,
        }));

        return {
          error: "Multiple appointments found around this time",
          multipleAppointments: appointmentsList,
          message: `Found ${
            appointmentsList.length
          } appointments around ${appointmentMoment.format(
            "DD/MM/YYYY HH:mm"
          )}. Please specify which appointment to cancel by providing more specific details.`,
        };
      }

      existingAppointment = phoneQuery.rows[0];
    } else {
      // No date/time provided, get the most recent/upcoming appointment
      phoneQuery = await sqlClient.query(
        `SELECT * FROM public.appointments 
          WHERE contact_id = $1 AND company_id = $2 
          AND status IN ('scheduled', 'confirmed')
          ORDER BY scheduled_time DESC
          LIMIT 1`,
        queryParams
      );

      if (phoneQuery.rows.length === 0) {
        return { error: "No existing appointment found for this contact" };
      }

      existingAppointment = phoneQuery.rows[0];
    }

    let appointmentId = existingAppointment.appointment_id;

    console.log("Found existing appointment to cancel:", existingAppointment);

    // Update the appointment status to cancelled in the database
    await sqlClient.query("BEGIN");

    console.log("Canceling appointment:", appointmentId);
    const updateResult = await sqlClient.query(
      `UPDATE public.appointments 
       SET status = 'cancelled', 
           metadata = $1
       WHERE appointment_id = $2 AND company_id = $3
       RETURNING *`,
      [
        JSON.stringify({
          userEmail,
          cancelReason: reason,
          canceledAt: new Date().toISOString(),
          originalStatus: existingAppointment.status,
          ...(existingAppointment.metadata || {}),
        }),
        appointmentId,
        idSubstring,
      ]
    );

    if (updateResult.rows.length === 0) {
      await safeRollback(sqlClient);
      return { error: "Failed to cancel appointment" };
    }

    await sqlClient.query("COMMIT");

    // Delete from Google Calendar if calendarId exists
    let calendarEventDeleted = false;
    if (calendarId) {
      try {
        const auth = new google.auth.GoogleAuth({
          keyFile: "./service_account.json",
          scopes: ["https://www.googleapis.com/auth/calendar"],
        });

        const calendar = google.calendar({ version: "v3", auth });

        // Search for existing calendar event
        const existingEvents = await calendar.events.list({
          calendarId: calendarConfig.calendarId,
          q: `${phoneNumber}`,
          timeMin: new Date(
            existingAppointment.scheduled_time.getTime() - 24 * 60 * 60 * 1000
          ).toISOString(),
          timeMax: new Date(
            existingAppointment.scheduled_time.getTime() + 24 * 60 * 60 * 1000
          ).toISOString(),
        });

        if (existingEvents.data.items && existingEvents.data.items.length > 0) {
          const eventToDelete = existingEvents.data.items[0];

          await calendar.events.delete({
            calendarId: calendarConfig.calendarId,
            eventId: eventToDelete.id,
          });

          calendarEventDeleted = true;
          console.log("Google Calendar event deleted successfully");
        }
      } catch (calendarError) {
        console.error("Error deleting Google Calendar event:", calendarError);
        // Don't fail the entire operation if calendar deletion fails
      }
    }

    // Add cancellation tag to contact
    await addTagToPostgres(phoneNumber, "Cancelled Appointment", idSubstring);

    await safeRelease(sqlClient);

    return {
      success: true,
      message: "Appointment cancelled successfully",
      appointmentDetails: {
        appointmentId: appointmentId,
        originalDateTime: moment(existingAppointment.scheduled_time).format(
          "DD/MM/YYYY HH:mm"
        ),
        title: existingAppointment.title || "Appointment",
        description: existingAppointment.description || "",
        contact: `${contactName || "Unknown"} (${
          phoneNumber || "No phone number found"
        })`,
        type:
          existingAppointment.description?.toLowerCase().includes("servis") ||
          existingAppointment.description?.toLowerCase().includes("service") ||
          existingAppointment.title?.toLowerCase().includes("servis") ||
          existingAppointment.title?.toLowerCase().includes("service")
            ? "Service"
            : "Installation",
        calendarDeleted: calendarEventDeleted,
        reason: reason || "No reason provided",
      },
    };
  } catch (error) {
    console.error("Error in cancelCalendarEvent:", error);
    return { error: `Failed to cancel appointment: ${error.message}` };
  }
}

async function deleteTask(idSubstring, taskIndex) {
  try {
    const companyResult = await sql`
      SELECT tasks FROM public.companies WHERE company_id = ${idSubstring}
    `;

    if (companyResult.length === 0) {
      return JSON.stringify({
        message: `No company found for this companyId ${idSubstring}`,
      });
    }

    const currentTasks = companyResult[0].tasks || [];

    if (taskIndex < 0 || taskIndex >= currentTasks.length) {
      return JSON.stringify({ message: "Invalid task number." });
    }

    const deletedTask = currentTasks[taskIndex];

    currentTasks.splice(taskIndex, 1);

    await sql`
      UPDATE public.companies 
      SET tasks = ${JSON.stringify(currentTasks)}, 
          updated_at = CURRENT_TIMESTAMP
      WHERE company_id = ${idSubstring}
    `;

    return JSON.stringify({
      message: `Task "${deletedTask.task}" has been deleted.`,
    });
  } catch (error) {
    console.error(
      `Error deleting task ${taskIndex} for company ${idSubstring}:`,
      error
    );
    return JSON.stringify({
      message: `Error deleting task ${taskIndex} for company ${idSubstring}.`,
    });
  }
}

async function searchUpcomingAppointments(
  phoneNumber,
  idSubstring,
  limit = 10
) {
  try {
    console.log(
      "Searching for upcoming appointments for contact:",
      phoneNumber
    );

    const sqlClient = await pool.connect();

    try {
      // Format contact ID
      const contactID =
        idSubstring +
        "-" +
        (phoneNumber.startsWith("+") ? phoneNumber.slice(1) : phoneNumber);

      // Get current date and time in KL timezone for comparison
      const now = moment().tz("Asia/Kuala_Lumpur").toISOString();

      console.log("Searching for appointments after:", now);
      console.log("Contact ID:", contactID);

      // Query to find upcoming appointments (future appointments only)
      const appointmentsQuery = await sqlClient.query(
        `SELECT 
           appointment_id,
           title,
           description,
           scheduled_time,
           duration_minutes,
           status,
           metadata,
           staff_assigned,
           created_at
         FROM public.appointments 
         WHERE contact_id = $1 
           AND company_id = $2 
           AND status IN ('scheduled', 'confirmed')
           AND scheduled_time > $3
         ORDER BY scheduled_time ASC
         LIMIT $4`,
        [contactID, idSubstring, now, limit]
      );

      console.log(
        `Found ${appointmentsQuery.rows.length} upcoming appointments`
      );

      if (appointmentsQuery.rows.length === 0) {
        return JSON.stringify({
          success: true,
          message: "No upcoming appointments found",
          appointments: [],
          totalCount: 0,
        });
      }

      // Format appointments for response
      const appointments = appointmentsQuery.rows.map((apt) => {
        const startTime = moment(apt.scheduled_time).tz("Asia/Kuala_Lumpur");
        const endTime = startTime.clone().add(apt.duration_minutes, "minutes");

        // Determine appointment type
        const description = apt.description || "";
        const title = apt.title || "";
        const isService =
          description.toLowerCase().includes("servis") ||
          description.toLowerCase().includes("service") ||
          title.toLowerCase().includes("servis") ||
          title.toLowerCase().includes("service");

        // Get staff information from metadata or staff_assigned
        let assignedStaff = [];
        if (apt.staff_assigned && Array.isArray(apt.staff_assigned)) {
          assignedStaff = apt.staff_assigned;
        } else if (
          apt.metadata &&
          apt.metadata.staff &&
          Array.isArray(apt.metadata.staff)
        ) {
          assignedStaff = apt.metadata.staff;
        }

        return {
          appointmentId: apt.appointment_id,
          title: apt.title || "Appointment",
          description: apt.description || "",
          date: startTime.format("DD/MM/YYYY"),
          time: `${startTime.format("HH:mm")} - ${endTime.format("HH:mm")}`,
          startDateTime: startTime.format("YYYY-MM-DD HH:mm:ss"),
          endDateTime: endTime.format("YYYY-MM-DD HH:mm:ss"),
          duration: apt.duration_minutes,
          status: apt.status,
          type: isService ? "Service" : "Installation",
          assignedStaff: assignedStaff,
          dayOfWeek: startTime.format("dddd"),
          createdAt: moment(apt.created_at).format("DD/MM/YYYY HH:mm"),
          // Calculate time until appointment
          timeUntilAppointment: startTime.fromNow(),
          isToday: startTime.isSame(moment().tz("Asia/Kuala_Lumpur"), "day"),
          isTomorrow: startTime.isSame(
            moment().tz("Asia/Kuala_Lumpur").add(1, "day"),
            "day"
          ),
        };
      });

      // Separate today's and future appointments
      const todayAppointments = appointments.filter((apt) => apt.isToday);
      const tomorrowAppointments = appointments.filter((apt) => apt.isTomorrow);
      const futureAppointments = appointments.filter(
        (apt) => !apt.isToday && !apt.isTomorrow
      );

      return JSON.stringify({
        success: true,
        message: `Found ${appointments.length} upcoming appointment${
          appointments.length === 1 ? "" : "s"
        }`,
        appointments: appointments,
        summary: {
          total: appointments.length,
          today: todayAppointments.length,
          tomorrow: tomorrowAppointments.length,
          future: futureAppointments.length,
        },
        breakdown: {
          today: todayAppointments,
          tomorrow: tomorrowAppointments,
          future: futureAppointments.slice(0, 5), // Limit future appointments to 5 for summary
        },
      });
    } finally {
      await safeRelease(sqlClient);
    }
  } catch (error) {
    console.error("Error searching upcoming appointments:", error);
    return JSON.stringify({
      success: false,
      error: "Failed to search upcoming appointments",
      details: error.message,
    });
  }
}

async function editTask(
  idSubstring,
  taskIndex,
  newTaskString,
  newAssignee,
  newDueDate
) {
  try {
    const companyResult = await sql`
      SELECT tasks FROM public.companies WHERE company_id = ${idSubstring}
    `;

    if (companyResult.length === 0) {
      return JSON.stringify({
        message: `No company found for this companyId ${idSubstring}`,
      });
    }

    const currentTasks = companyResult[0].tasks || [];

    if (taskIndex < 0 || taskIndex >= currentTasks.length) {
      return JSON.stringify({ message: "Invalid task number." });
    }

    const updates = {
      task: newTaskString || currentTasks[taskIndex].task,
      assignee: newAssignee || currentTasks[taskIndex].assignee,
      dueDate: newDueDate || currentTasks[taskIndex].dueDate,
    };

    const updatedTask = {
      ...currentTasks[taskIndex],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const updatedTasks = [
      ...currentTasks.slice(0, taskIndex),
      updatedTask,
      ...currentTasks.slice(taskIndex + 1),
    ];

    await sql`
      UPDATE public.companies 
      SET tasks = ${JSON.stringify(updatedTasks)}, 
          updated_at = CURRENT_TIMESTAMP
      WHERE company_id = ${idSubstring}
    `;

    return JSON.stringify({ message: `Task has been updated.` });
  } catch (error) {
    console.error(
      `Error updating task ${taskId} for company ${idSubstring}:`,
      error
    );
    return JSON.stringify({ message: `Error updating task: ${error.message}` });
  }
}

async function sendDailyTaskReminder(client, idSubstring) {
  const companyResult = await sql`
    SELECT tasks FROM public.companies WHERE company_id = ${idSubstring}
  `;

  if (companyResult.length === 0) {
    return JSON.stringify({
      message: `No company found for this companyId ${idSubstring}`,
    });
  }

  const currentTasks = companyResult[0].tasks || [];
  const taskList = currentTasks
    .map(
      (task, index) =>
        `${index + 1}. [${task.status}] ${task.task} (Assigned to: ${
          task.assignee
        }, Due: ${task.dueDate})`
    )
    .join("\n");
  const reminderMessage = `Please update the tasks accordingly\n\nDaily Task Reminder:\n\n${taskList}\n.`;

  const groupChatId = "120363178065670386@g.us";

  await client.sendMessage(groupChatId, reminderMessage);
}

function getTodayDate() {
  // Force a timezone refresh and get current time
  const now = moment().tz("Asia/Kuala_Lumpur", true);
  return now.format("dddd, YYYY-MM-DD HH:mm:ss");
}

async function fetchContactData(phoneNumber, idSubstring) {
  try {
    const result = await sql`
      SELECT * FROM public.contacts 
      WHERE phone = ${phoneNumber} 
      AND company_id = ${idSubstring}
      LIMIT 1
    `;

    if (result.length === 0) {
      return JSON.stringify({ error: "Contact not found" });
    }

    const contactData = result[0];
    return JSON.stringify(contactData);
  } catch (error) {
    console.error("Error fetching contact data:", error);
    return JSON.stringify({ error: "Failed to fetch contact data" });
  }
}

async function storeMediaData(mediaData, filename, mimeType) {
  try {
    const buffer = Buffer.from(mediaData, "base64");
    const stream = Readable.from(buffer);

    // Try to determine mimeType and extension if not provided
    if (!mimeType) {
      // Try to guess from filename
      if (filename) {
        mimeType = mime.lookup(filename) || "application/octet-stream";
      } else {
        mimeType = "application/octet-stream";
      }
    }

    // If filename is missing or has no extension, generate one from mimeType
    if (!filename || !filename.includes(".")) {
      const ext = mime.extension(mimeType) || "bin";
      filename = `document-${Date.now()}.${ext}`;
    }

    const formData = new FormData();
    formData.append("file", stream, {
      filename: filename,
      contentType: mimeType,
      knownLength: buffer.length,
    });

    const response = await axios.post(
      `${process.env.URL}/api/upload-media`,
      formData,
      {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    return response.data.url;
  } catch (error) {
    console.error("Error uploading document:", error);
    throw error;
  }
}

async function getTotalContacts(idSubstring) {
  try {
    const result = await sql`
      SELECT COUNT(*) as count 
      FROM public.contacts 
      WHERE company_id = ${idSubstring}
    `;

    return parseInt(result[0].count, 10);
  } catch (error) {
    console.error("Error fetching total contacts:", error);
    return 0;
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

async function sendImage(client, phoneNumber, imageUrl, caption, idSubstring) {
  console.log("Sending image to:", phoneNumber);
  console.log("Image URL:", imageUrl);
  console.log("Caption:", caption);
  console.log("idSubstring:", idSubstring);

  try {
    const formattedNumberForWhatsApp =
      formatPhoneNumber(phoneNumber).slice(1) + "@c.us";
    const formattedNumberForDatabase = formatPhoneNumber(phoneNumber);

    if (!formattedNumberForWhatsApp || !formattedNumberForDatabase) {
      throw new Error("Invalid phone number");
    }

    const media = await MessageMedia.fromUrl(imageUrl);
    const sent = await client.sendMessage(formattedNumberForWhatsApp, media, {
      caption: caption,
    });

    await addMessageToPostgres(sent, idSubstring, formattedNumberForDatabase);

    const response = {
      status: "success",
      message: "Image sent successfully and added to Firebase",
      messageId: sent.id._serialized,
      timestamp: sent.timestamp,
    };

    return JSON.stringify(response);
  } catch (error) {
    console.error("Error in sendImage:", error);
    return JSON.stringify({
      status: "error",
      error: "Failed to send image or add to Firebase",
      details: error.message,
    });
  }
}

async function listAssignedContacts(companyId, assigneeName, limit = 10) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const possibleNames = [
      assigneeName.toLowerCase(),
      assigneeName.charAt(0).toUpperCase() +
        assigneeName.slice(1).toLowerCase(),
      assigneeName.toUpperCase(),
    ];

    const query = `
      SELECT 
        phone as "phoneNumber", 
        name as "contactName", 
        tags
      FROM public.contacts 
      WHERE company_id = $1 
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(tags) tag
        WHERE lower(tag) = ANY($2)
      )
      LIMIT $3
    `;

    const params = [
      companyId,
      possibleNames.map((name) => name.toLowerCase()),
      limit,
    ];

    const result = await client.query(query, params);

    await client.query("COMMIT");

    const contacts = result.rows.map((row) => {
      if (!row.phoneNumber) {
        return {
          phoneNumber: null,
          contactName: row.contactName,
          tags: row.tags,
        };
      }

      let phoneNumber = row.phoneNumber.trim();

      if (phoneNumber.includes("-")) {
        phoneNumber = phoneNumber.split("-").pop();
      }

      phoneNumber = phoneNumber.replace(/\D/g, "");

      if (phoneNumber.length > 0 && !phoneNumber.startsWith("+")) {
        phoneNumber = "+" + phoneNumber;
      }

      return {
        phoneNumber: phoneNumber,
        contactName: row.contactName,
        tags: row.tags,
      };
    });

    return JSON.stringify(contacts);
  } catch (error) {
    await safeRollback(client);
    console.error("Error listing assigned contacts:", error);
    return JSON.stringify({ error: "Failed to list assigned contacts" });
  } finally {
    await safeRelease(client);
  }
}

async function generateInquiryReportNewTown(threadID, assistantId) {
  try {
    // Check for any active runs first
    const runs = await openai.beta.threads.runs.list(threadID);
    const activeRun = runs.data.find((run) =>
      ["in_progress", "queued", "requires_action"].includes(run.status)
    );
    if (activeRun) {
      console.log(`Waiting for active run ${activeRun.id} to complete...`);
      await waitForReportCompletion(threadID, activeRun.id);
    }

    // Add a message requesting the report
    await openai.beta.threads.messages.create(threadID, {
      role: "user",
      content:
        "Please generate a detailed report of the customer's inquiry and contact information.",
    });

    // Create the run for the report
    console.log("Creating final report run...");
    const finalRun = await openai.beta.threads.runs.create(threadID, {
      assistant_id: assistantId,
      instructions: `Generate a concise inquiry report in exactly this format based on our conversation depending on the customer's inquiry:
If Restaurant
Inquiry Details Has Been Submitted

Inquiry & Contact Details:
1. Cooking Stoves: [Extract from conversation] units
2. Steaming Burners: [Extract from conversation] units
3. Low-Pressure Burners: [Extract from conversation] units
4. Frying Burners: [Extract from conversation] units
5. Operating for [Extract from conversation] hours per day.
6. Closed for [Extract from conversation] days per month.
7. Significant kitchen appliances: [Extract from conversation]
8. Full Name: [Extract from conversation]
9. Contact Number: [Extract from conversation]
10. Intended Usage: [Extract from conversation]

AI Suggested (per month):
1. Product: [Extract from conversation] Kg gas cylinders
2. Quantity: [Extract from conversation]

If Laundry
Inquiry Details Has Been Submitted

Laundry Inquiry & Contact Details:
1. Dryers: [Extract from conversation] units
2. Operating for [Extract from conversation] hours per day
3. Closed for [Extract from conversation] days per month
4. Additional Equipment: [Extract from conversation]
5. Full Name: [Extract from conversation]
6. Contact Number: [Extract from conversation]
7. Intended Usage: [Extract from conversation]

AI Suggested (per month):
1. Product: [Extract from conversation] Kg gas cylinders
2. Quantity: [Extract from conversation]

If Other than Kitchen or Laundry:

Generate a concise inquiry report in exactly this format based on our conversation:

Inquiry Details Has Been Submitted

Contact Details:
1. Full Name: [Extract from conversation]
2. Contact Number: [Extract from conversation]
3. Intended Usage: [Extract from conversation]
`,
    });

    // Get the final report
    console.log("Waiting for final report completion...");
    const reportMessage = await waitForReportCompletion(threadID, finalRun.id);
    console.log("Final report received");

    return reportMessage;
  } catch (error) {
    console.error("Error in generateInquiryReportNewTown:", error);
    return `Error generating inquiry report: ${error.message}`;
  }
}

// Internal function to handle report completion
async function waitForReportCompletion(threadId, runId, depth = 0) {
  const maxDepth = 5;
  const maxAttempts = 30;
  const pollingInterval = 2000;

  console.log(
    `Waiting for report completion (depth: ${depth}, runId: ${runId})...`
  );

  if (depth >= maxDepth) {
    console.error(`Max recursion depth reached for report runId: ${runId}`);
    return "Error: Maximum recursion depth reached while generating report.";
  }

  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    try {
      const runObject = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
      );
      console.log(
        `Report run status: ${runObject.status} (attempt ${attempts + 1})`
      );

      if (runObject.status === "completed") {
        const messagesList = await openai.beta.threads.messages.list(threadId);
        const reportMessage = messagesList.data[0].content[0].text.value;
        return reportMessage;
      } else if (runObject.status === "requires_action") {
        console.log("Report generation requires action...");
        try {
          const toolCalls =
            runObject.required_action.submit_tool_outputs.tool_calls;
          const toolOutputs = toolCalls.map((toolCall) => ({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ status: "report_generation_completed" }),
          }));

          await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
            tool_outputs: toolOutputs,
          });
        } catch (toolError) {
          // If run is already completed, try to get the message
          if (toolError.message?.includes('Runs in status "completed"')) {
            const messagesList = await openai.beta.threads.messages.list(
              threadId
            );
            const reportMessage = messagesList.data[0].content[0].text.value;
            return reportMessage;
          }
          throw toolError;
        }
        return await waitForReportCompletion(threadId, runId, depth + 1);
      } else if (
        ["failed", "cancelled", "expired"].includes(runObject.status)
      ) {
        console.error(
          `Report generation ${runId} ended with status: ${runObject.status}`
        );
        return `Error generating report: ${runObject.status}`;
      }

      await new Promise((resolve) => setTimeout(resolve, pollingInterval));
    } catch (error) {
      // If run is completed, try to get the message
      if (error.message?.includes('Runs in status "completed"')) {
        try {
          const messagesList = await openai.beta.threads.messages.list(
            threadId
          );
          const reportMessage = messagesList.data[0].content[0].text.value;
          return reportMessage;
        } catch (msgError) {
          console.error("Error fetching final message:", msgError);
        }
      }
      console.error(
        `Error in report generation (depth: ${depth}, runId: ${runId}):`,
        error
      );
      return `Error generating report: ${error.message}`;
    }
  }

  console.error(
    `Timeout: Report generation did not complete in time (depth: ${depth}, runId: ${runId})`
  );
  return "Error: Report generation timed out. Please try again.";
}
async function generateSpecialReportNewTown(threadID, assistantId) {
  try {
    // Check for any active runs first
    const runs = await openai.beta.threads.runs.list(threadID);
    const activeRun = runs.data.find((run) =>
      ["in_progress", "queued", "requires_action"].includes(run.status)
    );
    if (activeRun) {
      console.log(`Waiting for active run ${activeRun.id} to complete...`);
      await waitForReportCompletion(threadID, activeRun.id);
    }
    // Add a message requesting the report
    await openai.beta.threads.messages.create(threadID, {
      role: "user",
      content:
        "Please generate a detailed report of the customer's requirements and contact information.",
    });

    // Create the run for the report
    console.log("Creating final report run...");
    const finalRun = await openai.beta.threads.runs.create(threadID, {
      assistant_id: assistantId,
      instructions: `Generate a report in this exact format depending on the customer's inquiry:
Other than Kitchen or Laundry:

New Order Has Been Submitted

1. Full Name: [Extract]
2. Contact Number: [Extract]
3. Company Name: [Extract]
4. SSM: [Extract]
5. Address: [Extract]
6. Stock Receiver: [Extract]
7. Account Payable Contact Name and Phone: [Extract]
8. Product: [Extract]
9. Quantity: [Extract]
10. Intended Usage: [Extract]

If Kitchen:

New Order Has Been Submitted

Inquiry Details:
1. Cooking Stoves: [Extract] units
2. Steaming Burners: [Extract] units
3. Low-Pressure Burners: [Extract] units
4. Frying Burners: [Extract] units
5. Operating for [Extract] hours per day
6. Closed for [Extract] days per month
7. Significant kitchen appliances: [Extract]

Contact Details:
1. Full Name: [Extract]
2. Contact Number: [Extract]
3. Company Name: [Extract]
4. SSM: [Extract]
5. Address: [Extract]
6. Intended Usage: [Extract]

AI Suggested (per month):
1. Product: [Extract] Kg gas cylinders
2. Quantity: [Extract]

If Laundry:

New Order Has Been Submitted

Laundry Equipment Details:
1.Dryers: [Extract] units

Operating Schedule:
1. Operating Hours: [Extract] hours per day
2. Operating Days: [Extract] days per month

Contact Details:
1. Full Name: [Extract]
2. Contact Number: [Extract]
3. Company Name: [Extract]
4. SSM: [Extract]
5. Address: [Extract]

Monthly Usage Calculation:
1. Per Dryer Usage: [Extract] kg/hour
2. Total Monthly Usage: [Extract] kg/month

AI Suggested (per month):
1. Product: [Extract] Kg gas cylinders
2. Quantity: [Extract] units`,
    });

    // Get the final report
    console.log("Waiting for final report completion...");
    const reportMessage = await waitForReportCompletion(threadID, finalRun.id);
    console.log("Final report received");

    // Verify we got a proper report
    return reportMessage;
  } catch (error) {
    console.error("Error in generateSpecialReportNewTown:", error);
    return `Error generating report: ${error.message}`;
  }
}

async function sendFeedbackToGroupNewTown(
  client,
  feedback,
  customerName,
  customerPhone,
  idSubstring
) {
  try {
    const feedbackMessage =
      `*New Customer Feedback*\n\n` +
      `👤 Customer: ${customerName}\n` +
      `📱 Phone: ${customerPhone}\n` +
      `💬 Feedback: ${feedback}\n\n` +
      `Received: ${new Date().toLocaleString()}`;

    // Send to feedback group (you'll need to set this group ID in your config)
    const feedbackGroupId = "120363107024888999@g.us"; // Default group or from config
    const sentMessage = await client.sendMessage(
      feedbackGroupId,
      feedbackMessage
    );
    await addMessageToPostgres(sentMessage, idSubstring, "+120363107024888999");
    // Log feedback to Firebase
    await logFeedbackToPostgres(idSubstring, customerPhone, feedback);

    return JSON.stringify({
      success: true,
      message: "Feedback sent to group successfully",
    });
  } catch (error) {
    console.error("Error sending feedback:", error);
    throw error;
  }
}

async function logFeedbackToPostgres(idSubstring, customerPhone, feedback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const feedbackId = uuidv4();

    const query = `
      INSERT INTO public.feedback (
        feedback_id, 
        company_id, 
        type, 
        comments, 
        metadata
        -- created_at is handled by DEFAULT CURRENT_TIMESTAMP
      ) VALUES ($1, $2, $3, $4, $5)
    `;

    const values = [
      feedbackId,
      idSubstring,
      "customer",
      feedback,
      JSON.stringify({
        customerPhone: customerPhone,
        source: "whatsapp",
      }),
    ];

    await client.query(query, values);

    await client.query("COMMIT");

    console.log(`Feedback logged to PostgreSQL with ID: ${feedbackId}`);
  } catch (error) {
    await safeRollback(client);
    console.error("Error logging feedback to PostgreSQL:", error);
    throw error;
  } finally {
    await safeRelease(client);
  }
}

async function handleOpenAIMyMessage(message, threadID) {
  console.log("messaging manual");
  const myquery = `You sent this to the user: ${message}. Please remember this for the next interaction. Do not re-send this query to the user, this is only for you to remember the interaction.`;
  await addMessageAssistant(threadID, myquery);
}

async function addMessageAssistant(threadId, message) {
  const response = await openai.beta.threads.messages.create(threadId, {
    role: "assistant",
    content: message,
  });
  console.log(response);
  return response;
}

const DEFAULT_BUFFER_TIME = 30000;
const messageBuffers = new Map();

async function handleNewMessagesTemplateWweb(client, msg, botName, phoneIndex) {
  try {
    console.log("Handling new message for bot companyID " + botName);

    // Additional validation for company 088
    if (botName === "088") {
      console.log(`[DEBUG-088] Message object keys:`, Object.keys(msg || {}));
      console.log(`[DEBUG-088] msg.from:`, msg?.from);
      console.log(`[DEBUG-088] msg.body:`, msg?.body);
      console.log(`[DEBUG-088] msg.type:`, msg?.type);
    }

    const idSubstring = botName;
    const chatId = msg.from;
    if (chatId.includes("status")) {
      return;
    }

    await processImmediateActions(client, msg, idSubstring, phoneIndex);

    let bufferTime = DEFAULT_BUFFER_TIME;
    try {
      const sqlClient = await pool.connect();
      try {
        const settingResult = await sqlClient.query(
          `SELECT setting_value->>'value' as ai_delay 
           FROM public.settings 
           WHERE company_id = $1 
           AND setting_type = 'messaging' 
           AND setting_key = 'aiDelay'`,
          [idSubstring]
        );

        if (settingResult.rows.length > 0 && settingResult.rows[0].ai_delay) {
          bufferTime = (parseInt(settingResult.rows[0].ai_delay) || 30) * 1000;
        } else {
          const companyResult = await sqlClient.query(
            `SELECT profile->>'aiDelay' as ai_delay 
             FROM public.companies 
             WHERE company_id = $1`,
            [idSubstring]
          );

          if (companyResult.rows.length > 0 && companyResult.rows[0].ai_delay) {
            bufferTime = (parseInt(companyResult.rows[0].ai_delay) || 30) * 1000;
          }
        }
      } finally {
        await safeRelease(sqlClient);
      }
    } catch (error) {
      console.error("Error fetching buffer time from PostgreSQL:", error);
    }

    // Create a unique buffer key that includes both chatId and botName to prevent cross-bot interference
    const bufferKey = `${chatId}_${botName}`;

    if (!messageBuffers.has(bufferKey)) {
      messageBuffers.set(bufferKey, {
        messages: [],
        timer: null,
      });
    }

    const finalBufferTime = botName === "0144" ? 5000 : bufferTime;
    const buffer = messageBuffers.get(bufferKey);

    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }

    if (msg.type === "ptt") {
      console.log("Voice message detected");
      const media = await msg.downloadMedia();
      const transcription = await transcribeAudio(media.data);
      msg.body = transcription;
      buffer.messages.push(msg);
    } else {
      buffer.messages.push(msg);
    }

    buffer.timer = setTimeout(
      () => processBufferedMessages(client, bufferKey, botName, phoneIndex),
      finalBufferTime
    );
  } catch (error) {
    console.error(`[handleNewMessagesTemplateWweb] Error for bot ${botName}:`, error);
    console.error(`[handleNewMessagesTemplateWweb] Error message:`, error?.message || 'No message');
    console.error(`[handleNewMessagesTemplateWweb] Error stack:`, error?.stack || 'No stack');
    throw error; // Re-throw so parent handler can catch it
  }
}

async function getProfilePicUrl(contact) {
  if (!contact.getProfilePicUrl) {
    return "";
  }

  try {
    return (await contact.getProfilePicUrl()) || "";
  } catch (error) {
    console.error(
      `Error getting profile picture URL for ${contact.id.user}:`,
      error
    );
    return "";
  }
}

async function prepareContactData(
  msg,
  idSubstring,
  threadID,
  contactData,
  companyName,
  phoneIndex,
  client
) {
  const chat = await msg.getChat();
  let contact;
  try {
    contact = await chat.getContact();
  } catch (err) {
    contact = await client.getContactById(msg.from);
  }
  const extractedNumber = await safeExtractPhoneNumber(msg, client);

  const contactTags = contactData?.tags || [];
  const profilePicUrl = await getProfilePicUrl(contact);

  // Helper function to determine a proper display name
  function getDisplayName(contactData, contact, extractedNumber) {
    // Get candidate names
    const candidateName =
      contactData?.name || contactData?.contact_name || contact?.name || "";
    const pushname = contact.pushname || "";

    // Helper to check if a string is a phone number (digits only, possibly with +)
    function isPhoneNumber(str) {
      if (!str) return false;
      const cleaned = str.replace(/\D/g, "");
      const extractedClean = extractedNumber.replace(/\D/g, "");
      return (
        cleaned.length > 5 &&
        (cleaned === extractedClean ||
          cleaned === extractedClean.replace(/^60/, "") ||
          cleaned === extractedClean.replace(/^0/, ""))
      );
    }

    // If candidate name is missing or looks like a phone number
    if (!candidateName || isPhoneNumber(candidateName)) {
      // If pushname exists and is not a phone number, use it
      if (pushname && !isPhoneNumber(pushname)) {
        return pushname;
      }
      // Otherwise, fallback to extractedNumber
      return extractedNumber;
    }
    // Otherwise, use the candidate name
    return candidateName;
  }

  const displayName = getDisplayName(contactData, contact, extractedNumber);

  const data = {
    additional_emails: [],
    address1: null,
    assigned_to: null,
    business_id: null,
    phone: extractedNumber,
    contact_id:
      idSubstring +
      "-" +
      (extractedNumber.startsWith("+")
        ? extractedNumber.slice(1)
        : extractedNumber),
    tags: contactTags,
    unread_count: (contactData?.unread_count || 0) + 1,
    last_updated: new Date(msg.timestamp * 1000),
    chat_data: {
      contact_id:
        idSubstring +
        "-" +
        (extractedNumber.startsWith("+")
          ? extractedNumber.slice(1)
          : extractedNumber),
      id: msg.from,
      name: displayName,
      not_spam: true,
      tags: contactTags,
      timestamp: chat.timestamp || Date.now(),
      type: "contact",
      unread_count: 0,
      last_message: {
        chat_id: msg.from,
        from: msg.from ?? "",
        from_me: msg.fromMe ?? false,
        id: msg.id._serialized ?? "",
        source: chat.deviceType ?? "",
        status: "delivered",
        text: {
          body: msg.body ?? "",
        },
        timestamp: msg.timestamp ?? 0,
        type: msg.type === "chat" ? "text" : msg.type,
        phoneIndex: phoneIndex,
      },
    },
    chat_id: msg.from,
    is_group: msg.from.includes("@g.us"),
    city: null,
    company: companyName || null,
    name: displayName,
    contact_name: displayName,
    thread_id: threadID ?? "",
    profile_pic_url: profilePicUrl,
    last_message: {
      chat_id: msg.from,
      from: msg.from ?? "",
      from_me: msg.fromMe ?? false,
      id: msg.id._serialized ?? "",
      source: chat.deviceType ?? "",
      status: "delivered",
      text: {
        body: msg.body ?? "",
      },
      timestamp: msg.timestamp ?? 0,
      type: msg.type === "chat" ? "text" : msg.type,
      phoneIndex: phoneIndex,
    },
  };

  if (!contactData) {
    data.created_at = new Date();
  }

  return data;
}

async function checkKeywordMatch(response, message, keywordSource) {
  return (
    response.keywordSource === keywordSource &&
    response.keywords.some((kw) =>
      message.toLowerCase().includes(kw.toLowerCase())
    )
  );
}

async function checkKeywordMatchTemplate(
  keywords,
  message,
  tempKeywordSource,
  keywordSource
) {
  return (
    keywordSource === tempKeywordSource &&
    keywords.some((kw) => message.toLowerCase().includes(kw.toLowerCase()))
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
  const aiImageResponses = await getAIImageResponses(idSubstring);

  for (const response of aiImageResponses) {
    if (await checkKeywordMatch(response, message, keywordSource)) {
      console.log("Images found for keywords:", response.keywords);

      for (const imageUrl of response.imageUrls) {
        try {
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
            followUpTemplates
          );
        } else {
          await handleTagAddition(
            response,
            extractedNumber,
            idSubstring,
            followUpTemplates,
            contactName,
            phoneIndex
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
  phoneIndex,
}) {
  console.log(
    `[ASSIGNMENT DEBUG] Starting handleAIAssignResponses for Company ${idSubstring}`
  );
  console.log(`[ASSIGNMENT DEBUG] Message: "${message}"`);
  console.log(`[ASSIGNMENT DEBUG] Phone: ${extractedNumber}`);
  console.log(`[ASSIGNMENT DEBUG] Contact Name: ${contactName}`);
  console.log(`[ASSIGNMENT DEBUG] Keyword Source: ${keywordSource}`);
  console.log(`[ASSIGNMENT DEBUG] Phone Index: ${phoneIndex}`);

  // Skip AI assignment for company 058666 with "team sale" - let handleSpecialCases handle it
  if (idSubstring === "058666" && message.toLowerCase().includes("team sale")) {
    console.log(`[ASSIGNMENT DEBUG] Skipping AI assignment for 058666 team sale - will be handled by handleSpecialCases`);
    return;
  }

  console.log(
    `[ASSIGNMENT DEBUG] Fetching AI assign responses for Company ${idSubstring}`
  );
  const aiAssignResponses = await getAIAssignResponses(idSubstring);
  console.log(
    `[ASSIGNMENT DEBUG] Found ${aiAssignResponses.length} AI assign responses`
  );

  for (const response of aiAssignResponses) {
    console.log(`[ASSIGNMENT DEBUG] Checking response:`, {
      keywords: response.keywords,
      assignedEmployees: response.assignedEmployees, // Updated to match the actual property name
      assigned_employees: response.assigned_employees, // Keep this for backward compatibility
    });

    if (await checkKeywordMatch(response, message, keywordSource)) {
      console.log(
        `[ASSIGNMENT DEBUG] Assignment found for keywords:`,
        response.keywords
      );

      // Move matchedKeyword declaration outside try block
      let matchedKeyword = null;

      try {
        matchedKeyword = response.keywords.find((kw) =>
          message.toLowerCase().includes(kw.toLowerCase())
        );
        console.log(`[ASSIGNMENT DEBUG] Matched keyword: ${matchedKeyword}`);

        console.log(
          `[ASSIGNMENT DEBUG] Calling handleEmployeeAssignment with params:`,
          {
            response: response,
            idSubstring: idSubstring,
            extractedNumber: extractedNumber,
            contactName: contactName,
            client: "[Client Object]", // Just log a placeholder instead of the actual client
            matchedKeyword: matchedKeyword,
            phoneIndex: phoneIndex,
          }
        );

        await handleEmployeeAssignment(
          response,
          idSubstring,
          extractedNumber,
          contactName,
          client,
          matchedKeyword,
          phoneIndex
        );

        console.log(
          `[ASSIGNMENT DEBUG] handleEmployeeAssignment completed successfully`
        );
      } catch (error) {
        console.error(`[ASSIGNMENT DEBUG] Error handling assignment:`, {
          error: error.message,
          stack: error.stack,
          response: response,
          idSubstring: idSubstring,
          extractedNumber: extractedNumber,
          contactName: contactName,
          matchedKeyword: matchedKeyword,
          phoneIndex: phoneIndex,
          // Removed client from error logging to avoid circular reference
        });
      }
    } else {
      console.log(
        `[ASSIGNMENT DEBUG] No keyword match for response:`,
        response.keywords
      );
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
  message,
  extractedNumber,
  idSubstring,
  contactName,
  phoneIndex,
  keywordSource,
  followUpTemplates,
}) {
  for (const template of followUpTemplates) {
    if (
      await checkKeywordMatchTemplate(
        template.triggerKeywords,
        message,
        template.keywordSource,
        keywordSource
      )
    ) {
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

async function handleEmployeeAssignment(
  response,
  idSubstring,
  extractedNumber,
  contactName,
  client,
  matchedKeyword,
  phoneIndex
) {
  console.log(`[EMPLOYEE_ASSIGNMENT DEBUG] Starting handleEmployeeAssignment`);
  console.log(`[EMPLOYEE_ASSIGNMENT DEBUG] Response:`, response);
  console.log(`[EMPLOYEE_ASSIGNMENT DEBUG] Company ID: ${idSubstring}`);
  console.log(`[EMPLOYEE_ASSIGNMENT DEBUG] Phone: ${extractedNumber}`);
  console.log(`[EMPLOYEE_ASSIGNMENT DEBUG] Contact Name: ${contactName}`);
  console.log(`[EMPLOYEE_ASSIGNMENT DEBUG] Matched Keyword: ${matchedKeyword}`);
  console.log(`[EMPLOYEE_ASSIGNMENT DEBUG] Phone Index: ${phoneIndex}`);

  try {
    const stateResult = await pool.query(
      "SELECT current_index FROM bot_state WHERE company_id = $1 AND bot_name = $2",
      [idSubstring, "assignmentState"]
    );
    console.log(
      `[EMPLOYEE_ASSIGNMENT DEBUG] State query result:`,
      stateResult.rows
    );

    let currentIndex = stateResult.rows[0]?.current_index || 0;
    console.log(`[EMPLOYEE_ASSIGNMENT DEBUG] Current index: ${currentIndex}`);

    // Fix: Use the correct property name - assignedEmployees instead of assigned_employees
    const employeeIds =
      response.assignedEmployees || response.assigned_employees || [];
    console.log(`[EMPLOYEE_ASSIGNMENT DEBUG] Employee IDs:`, employeeIds);

    if (employeeIds.length === 0) {
      console.log(
        `[EMPLOYEE_ASSIGNMENT DEBUG] No employees available for assignment`
      );
      return;
    }

    const nextEmployeeId = employeeIds[currentIndex % employeeIds.length];
    console.log(
      `[EMPLOYEE_ASSIGNMENT DEBUG] Next employee ID to assign: ${nextEmployeeId}`
    );

    // Fix: Query by employee ID instead of email
    const employeeResult = await pool.query(
      "SELECT * FROM employees WHERE company_id = $1 AND id = $2",
      [idSubstring, nextEmployeeId]
    );
    console.log(
      `[EMPLOYEE_ASSIGNMENT DEBUG] Employee query result:`,
      employeeResult.rows
    );

    if (employeeResult.rows.length > 0) {
      const employeeData = employeeResult.rows[0];
      console.log(`[EMPLOYEE_ASSIGNMENT DEBUG] Employee data:`, employeeData);

      console.log(
        `[EMPLOYEE_ASSIGNMENT DEBUG] Calling assignToEmployee with params:`,
        {
          employeeData: employeeData,
          role: "Sales",
          extractedNumber: extractedNumber,
          contactName: contactName,
          client: "[Client Object]", // Just log a placeholder instead of the actual client
          idSubstring: idSubstring,
          matchedKeyword: matchedKeyword,
          phoneIndex: phoneIndex,
        }
      );

      await assignToEmployee(
        employeeData,
        "2",
        extractedNumber,
        contactName,
        client,
        idSubstring,
        matchedKeyword,
        phoneIndex
      );

      const newIndex = (currentIndex + 1) % employeeIds.length;
      console.log(`[EMPLOYEE_ASSIGNMENT DEBUG] New index: ${newIndex}`);

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
      console.log(`[EMPLOYEE_ASSIGNMENT DEBUG] State updated successfully`);
    } else {
      console.log(
        `[EMPLOYEE_ASSIGNMENT DEBUG] No employee found with ID: ${nextEmployeeId}`
      );
    }
  } catch (error) {
    console.error(
      `[EMPLOYEE_ASSIGNMENT DEBUG] Error in handleEmployeeAssignment:`,
      {
        error: error.message,
        stack: error.stack,
        response: response,
        idSubstring: idSubstring,
        extractedNumber: extractedNumber,
        contactName: contactName,
        matchedKeyword: matchedKeyword,
        phoneIndex: phoneIndex,
        // Removed client from error logging to avoid circular reference
      }
    );
    throw error; // Re-throw to be caught by the calling function
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

  if (
    Array.isArray(template.trigger_tags) &&
    template.trigger_tags.length > 0
  ) {
    for (const tag of template.trigger_tags) {
      await addTagToPostgres(extractedNumber, tag, idSubstring);
    }
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
    const response = await fetch(`${process.env.URL}/api/tag/followup`, {
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
      const errorText = await response.text();
      console.error(`Failed to ${action} follow-up sequence:`, errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    const result = await response.json();
    console.log(`Successfully ${action} follow-up sequence:`, result);
    return result;
  } catch (error) {
    console.error(`Error in ${action} follow-up sequence:`, error);
    throw error;
  }
}

async function updateContactInDatabase(idSubstring, phoneNumber, contactData) {
  console.log(`Updating contact for company ${idSubstring}...`);
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    // Updated query to only include columns that exist in your database
    const updateQuery = `
      UPDATE public.contacts 
      SET 
        name = $1,
        phone = $2,
        tags = $3,
        unread_count = $4,
        last_updated = $5,
        chat_data = $6,
        company = $7,
        thread_id = $8,
        last_message = $9,
        profile_pic_url = $10,
        additional_emails = $11,
        address1 = $12,
        assigned_to = $13,
        business_id = $14,
        chat_id = $15,
        is_group = $16
      WHERE phone = $17 AND company_id = $18
    `;

    await sqlClient.query(updateQuery, [
      contactData.name,
      contactData.phone,
      JSON.stringify(contactData.tags || []),
      contactData.unread_count || 0,
      contactData.last_updated,
      JSON.stringify(contactData.chat_data || {}),
      contactData.company,
      contactData.thread_id,
      JSON.stringify(contactData.last_message || {}),
      contactData.profile_pic_url,
      JSON.stringify(contactData.additional_emails || []),
      contactData.address1,
      contactData.assigned_to,
      contactData.business_id,
      contactData.chat_id,
      contactData.is_group || false,
      phoneNumber,
      idSubstring,
    ]);

    await sqlClient.query("COMMIT");

    console.log(
      `Successfully updated contact for Company ${idSubstring} at ID ${phoneNumber}`
    );

    return "Contact updated successfully";
  } catch (error) {
    await safeRollback(sqlClient);
    console.error(
      `Error updating contact in database for Company ${idSubstring} at ID ${phoneNumber}:`,
      error
    );
    return "Failed to update contact.";
  } finally {
    await safeRelease(sqlClient);
  }
}

async function getFollowUpTemplatesForNewContacts(companyId) {
  console.log(
    `Fetching follow-up templates for new contacts for company ${companyId}...`
  );
  const sqlClient = await pool.connect();

  try {
    const result = await sqlClient.query(
      `SELECT * FROM public.followup_templates 
       WHERE company_id = $1 
       AND status = 'active' 
       AND trigger_on_new_contact = true 
       ORDER BY created_at`,
      [companyId]
    );
    return result.rows;
  } catch (error) {
    console.error(
      "Error fetching follow-up templates for new contacts:",
      error
    );
    return [];
  } finally {
    await safeRelease(sqlClient);
  }
}

async function createContactInDatabase(idSubstring, contactData) {
  console.log(`Creating contact for company ${idSubstring}...`);
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");
    const contactID =
      idSubstring +
      "-" +
      (contactData.phone.startsWith("+")
        ? contactData.phone.slice(1)
        : contactData.phone);

    // Updated query to only include columns that exist in your database
    const insertQuery = `
      INSERT INTO public.contacts (
        contact_id,
        company_id,
        name,
        phone,
        tags,
        unread_count,
        created_at,
        last_updated,
        chat_data,
        company,
        thread_id,
        last_message,
        profile_pic_url,
        additional_emails,
        address1,
        assigned_to,
        business_id,
        chat_id,
        is_group
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    `;

    await sqlClient.query(insertQuery, [
      contactID,
      idSubstring,
      contactData.name,
      contactData.phone,
      JSON.stringify(contactData.tags || []),
      contactData.unread_count || 0,
      contactData.created_at || new Date(),
      contactData.last_updated,
      JSON.stringify(contactData.chat_data || {}),
      contactData.company,
      contactData.thread_id,
      JSON.stringify(contactData.last_message || {}),
      contactData.profile_pic_url,
      JSON.stringify(contactData.additional_emails || []),
      contactData.address1,
      contactData.assigned_to,
      contactData.business_id,
      contactData.chat_id,
      contactData.is_group || false,
    ]);

    await sqlClient.query("COMMIT");

    console.log(
      `Successfully created contact for Company ${idSubstring} at ID ${contactData.phone}`
    );

    // Trigger follow-up templates for new contacts in the background
    (async () => {
      try {
        const templates = await getFollowUpTemplatesForNewContacts(idSubstring);
        if (templates.length > 0) {
          console.log(
            `Found ${templates.length} follow-up templates for new contacts`
          );

          for (const template of templates) {
            try {
              await callFollowUpAPI(
                "startTemplate",
                contactData.phone,
                contactData.name || "New Contact",
                0, // phoneIndex
                template.template_id,
                idSubstring
              );
              console.log(
                `Triggered follow-up template "${template.name}" for new contact ${contactData.phone}`
              );
            } catch (error) {
              console.error(
                `Error triggering follow-up template "${template.name}":`,
                error
              );
            }
          }
        }
      } catch (error) {
        console.error(
          "Error processing follow-up templates for new contact:",
          error
        );
      }
    })();

    return "Contact created successfully";
  } catch (error) {
    await safeRollback(sqlClient);
    console.error(
      `Error creating contact in database for Company ${idSubstring} at ID ${contactData.phone}:`,
      error
    );
    return "Failed to create contact.";
  } finally {
    await safeRelease(sqlClient);
  }
}
// Add this after the imports at the top of the file (around line 50-100)
async function logContactCreationAttempt(
  contactID,
  companyID,
  name,
  phone,
  source,
  stackTrace = null
) {
  const timestamp = new Date().toISOString();

  console.log(`🔍 [CONTACT_CREATION_TRACKING] Attempt to create contact:`, {
    contact_id: contactID,
    company_id: companyID,
    name: name,
    phone: phone,
    source: source,
    timestamp: timestamp,
    is_duplicate_format:
      contactID === phone ||
      contactID === `+${phone}` ||
      contactID === phone.replace("+", ""),
    is_phone_as_name:
      name === phone || name === `+${phone}` || name === phone.replace("+", ""),
    stack_trace: stackTrace
      ? stackTrace.split("\n").slice(0, 3).join("\n")
      : null,
  });

  if (
    contactID === phone ||
    contactID === `+${phone}` ||
    contactID === phone.replace("+", "")
  ) {
    console.log(
      `⚠️ [CONTACT_CREATION_TRACKING] WARNING: Contact ID is just phone number! This will cause duplicates!`
    );
  }

  if (
    name === phone ||
    name === `+${phone}` ||
    name === phone.replace("+", "")
  ) {
    console.log(
      `⚠️ [CONTACT_CREATION_TRACKING] WARNING: Name is just phone number! This indicates a problem!`
    );
  }
}
async function processImmediateActions(client, msg, botName, phoneIndex) {
  const idSubstring = botName;
  const chatId = msg.from;
  const chat = await msg.getChat();
  let contact;
  try {
    contact = await chat.getContact();
  } catch (err) {
    contact = await client.getContactById(msg.from);
  }
  console.log(
    `�� [IMMEDIATE_ACTIONS] Processing immediate actions for bot companyID ${botName} for chatId ${chatId}`
  );
  const messageBody = msg.body;
  const extractedNumber = await safeExtractPhoneNumber(msg, client);
  console.log(`�� [IMMEDIATE_ACTIONS] Extracted number: ${extractedNumber}`);
  const contactID =
    idSubstring +
    "-" +
    (extractedNumber.startsWith("+")
      ? extractedNumber.slice(1)
      : extractedNumber);

  // Handle special cases first
  if (
    messageBody.includes("<Confirmed Appointment>") &&
    idSubstring === "002" &&
    msg.from === "120363323247156210@g.us"
  ) {
    console.log("�� Detected confirmed appointment message");
    try {
      await handleConfirmedAppointment(client, msg, idSubstring);
      console.log("✅ Appointment handled successfully");
      return;
    } catch (error) {
      console.error("❌ Error handling appointment:", error);
      console.error("Full error stack:", error.stack);
    }
  }

  if (
    (messageBody.startsWith("feedback") ||
      messageBody.startsWith("rating") ||
      messageBody.startsWith("status")) &&
    idSubstring === "0161"
  ) {
    await updateSpreadsheetData(msg, idSubstring);
    return;
  }

  if (idSubstring === "0255") {
    if (
      messageBody.startsWith("accept") ||
      messageBody.startsWith("decline") ||
      messageBody.startsWith("reschedule")
    ) {
      console.log("processIncomingBookingCarCare");
      const staffPhone = chatId.replace(/\D/g, "");
      await processIncomingBookingCarCare(msg, idSubstring, staffPhone, client);
      return;
    }
  }

  try {
    const companyConfig = await fetchConfigFromDatabase(
      idSubstring,
      phoneIndex
    );

    // Prepare contact and message data using utility functions

    const myNumber = "+" + client.info.wid.user;
    if (extractedNumber === myNumber) {
      // Don't process messages to yourself
      console.log(
        `�� [IMMEDIATE_ACTIONS] Skipping message to self: ${extractedNumber}`
      );
      return;
    }

    console.log(
      `�� [IMMEDIATE_ACTIONS] Fetching contact data for phone: ${extractedNumber}, company: ${idSubstring}`
    );
    const contactData = await getContactDataFromDatabaseByPhone(
      extractedNumber,
      idSubstring
    );

    if (contactData) {
      console.log(`�� [IMMEDIATE_ACTIONS] Found existing contact:`, {
        contact_id: contactData.contact_id,
        contact_name: contactData.name,
        name: contactData.name,
        phone: contactData.phone,
        company_id: contactData.company_id,
      });
    } else {
      console.log(
        `�� [IMMEDIATE_ACTIONS] No existing contact found for phone: ${extractedNumber}, company: ${idSubstring}`
      );
    }

    const chat = await msg.getChat();
    const companyName = contactData?.company || null;

    // Handle thread creation/retrieval
    let threadID = contactData?.thread_id;
    if (!threadID) {
      console.log(
        `�� [IMMEDIATE_ACTIONS] Creating new thread for contact: ${extractedNumber}`
      );
      const thread = await createThread();
      threadID = thread.id;
      console.log(
        `�� [IMMEDIATE_ACTIONS] Saving thread ID: ${threadID} for contact: ${extractedNumber}`
      );
      if (contactData) {
        await saveThreadIDPostgres(extractedNumber, threadID, idSubstring);
      }
    } else {
      console.log(
        `�� [IMMEDIATE_ACTIONS] Using existing thread ID: ${threadID}`
      );
    }

    // Handle messages from me
    if (msg.fromMe) {
      console.log(`�� [IMMEDIATE_ACTIONS] Processing message from me`);
      if (idSubstring === "0128") {
        const firebaseDC = await safeExtractToPhoneNumber(msg, client);
        if (firebaseDC) {
          await addTagToPostgres(firebaseDC, "stop bot", idSubstring);
        }
      }
      await handleOpenAIMyMessage(msg.body, threadID);
      return;
    }

    // Prepare contact and message data
    const contactTags = contactData?.tags || [];
    console.log(
      `�� [IMMEDIATE_ACTIONS] Preparing contact data for: ${extractedNumber}`
    );
    const contactDataForDB = await prepareContactData(
      msg,
      idSubstring,
      threadID,
      contactData,
      companyName,
      phoneIndex,
      client
    );

    console.log(`�� [IMMEDIATE_ACTIONS] Contact data prepared:`, {
      contact_id: contactDataForDB.contact_id,
      name: contactDataForDB.name,
      contact_name: contactDataForDB.contact_name,
      phone: contactDataForDB.phone,
    });

    // Save to database
    if (contactData) {
      console.log(
        `�� [IMMEDIATE_ACTIONS] Updating existing contact in database`
      );
      await logContactCreationAttempt(
        contactDataForDB.contact_id || extractedNumber,
        idSubstring,
        contactDataForDB.name || contactDataForDB.contact_name,
        extractedNumber,
        "processImmediateActions_updateContact",
        new Error().stack
      );
      await updateContactInDatabase(
        idSubstring,
        extractedNumber,
        contactDataForDB
      );
    } else {
      console.log(`�� [IMMEDIATE_ACTIONS] Creating new contact in database`);
      await logContactCreationAttempt(
        contactDataForDB.contact_id || extractedNumber,
        idSubstring,
        contactDataForDB.name || contactDataForDB.contact_name,
        extractedNumber,
        "processImmediateActions_createContact",
        new Error().stack
      );
      await createContactInDatabase(idSubstring, contactDataForDB);
    }

    console.log(`�� [IMMEDIATE_ACTIONS] Adding message to PostgreSQL`);
    await addMessageToPostgres(
      msg,
      idSubstring,
      extractedNumber,
      contactDataForDB.name,
      phoneIndex
    );

    if (idSubstring === "0123") {
      const needsAssignment = await checkIfContactNeedsAssignment(
        contactData,
        phoneIndex
      );
      if (needsAssignment) {
        await assignNewContactToEmployeeRevotrend(
          extractedNumber,
          idSubstring,
          client,
          phoneIndex
        );
      }
    }

    const handlerParams = {
      client: client,
      msg: messageBody,
      idSubstring: idSubstring,
      extractedNumber: extractedNumber,
      contactName:
        contactData?.name ||
        contactData?.contact_name ||
        contact.pushname ||
        extractedNumber,
      phoneIndex: phoneIndex,
    };

    // Handle user-triggered responses
    await processAIResponses({
      ...handlerParams,
      keywordSource: "user",
      companyConfig: companyConfig,
      handlers: {
        assign: true,
        tag: true,
        followUp: true,
        document: false,
        image: false,
        video: false,
        voice: false,
      },
    });

    // Reset bot command
    if (msg.body.includes("/resetbot")) {
      console.log(`�� [IMMEDIATE_ACTIONS] Reset bot command detected`);
      const thread = await createThread();
      threadID = thread.id;
      await saveThreadIDPostgres(extractedNumber, threadID, idSubstring);
      client.sendMessage(msg.from, "Bot is now restarting with new thread.");
      return;
    }

    if (companyConfig.stopbot) {
      if (companyConfig.stopbot == true) {
        console.log(`Main Bot Toggled Off for Company ${idSubstring}`);
        return;
      }
    }

    if (contactTags !== undefined) {
      if (
        Array.isArray(contactTags) &&
        contactTags.some(
          (tag) => typeof tag === "string" && tag.toLowerCase() === "stop bot"
        )
      ) {
        console.log(
          `Bot stopped for contact ${extractedNumber} for Company ${idSubstring}`
        );
        return;
      }
    }

    if (
      companyConfig.stopbots &&
      companyConfig.stopbots[phoneIndex.toString()] === true
    ) {
      console.log(
        `Bot Toggled Off for Company ${idSubstring} phone index ${phoneIndex}`
      );
      return;
    }

    console.log(
      "�� [IMMEDIATE_ACTIONS] Message processed immediately:",
      msg.id._serialized
    );
  } catch (error) {
    console.error(
      "❌ [IMMEDIATE_ACTIONS] Error in immediate processing:",
      error
    );
    console.error("❌ [IMMEDIATE_ACTIONS] Full error stack:", error.stack);
  }
}

// Add sendFeedbackToGroup function
async function sendFeedbackToGroup(
  client,
  feedback,
  customerName,
  customerPhone,
  idSubstring
) {
  if (idSubstring !== "0128") return;

  try {
    const feedbackMessage =
      `*New Customer Feedback*\n\n` +
      `👤 Customer: ${customerName}\n` +
      `📱 Phone: ${customerPhone}\n` +
      `💬 Feedback: ${feedback}\n\n` +
      `Received: ${new Date().toLocaleString()}`;

    const feedbackGroupId = "120363107024888999@g.us";
    const sentMessage = await client.sendMessage(
      feedbackGroupId,
      feedbackMessage
    );
    await addMessageToPostgres(sentMessage, idSubstring, "+120363107024888999");
    await logFeedbackToPostgres(idSubstring, customerPhone, feedback);

    return JSON.stringify({
      success: true,
      message: "Feedback sent to group successfully",
    });
  } catch (error) {
    console.error("Error sending feedback:", error);
    throw error;
  }
}

async function mtdcAttendance(extractedNumber, msg, idSubstring, client) {
  try {
    const lowerMsg = msg.toLowerCase();
    let attendanceStatus = null;

    if (lowerMsg.includes("i will be attending")) {
      attendanceStatus = "Accepted";
    } else if (
      lowerMsg.includes("i will not be attending") ||
      lowerMsg.includes("not attending") ||
      lowerMsg.includes("cannot attend")
    ) {
      attendanceStatus = "Declined";
    } else {
      // Removed return
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: "./service_account.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = "1bW-KOpZ0lUDVNT4A6GZzzsIrne6MTBeBszrbOMyzoLI";
    const range = "Submissions!A:H";

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log("No data found in MTDC spreadsheet.");
      // Removed return
    }

    // Get current date and calculate 4 days from now
    const now = moment();
    const fourDaysFromNow = moment().add(4, "days");

    let eligibleRows = [];

    // Find all rows matching the phone number
    for (let i = 0; i < rows.length; i++) {
      if (
        rows[i][3] &&
        rows[i][3]
          .replace(/\D/g, "")
          .includes(extractedNumber.replace(/\D/g, ""))
      ) {
        // Check if program date exists and is within 4 days
        const programDateTime = rows[i][6]; // Column G: Program DateTime
        if (programDateTime) {
          const programDate = moment(programDateTime, "DD/MM/YYYY HH:mm");

          if (programDate.isValid()) {
            const daysUntilProgram = programDate.diff(now, "days");

            // Check if program is within 4 days (0-4 days from now)
            if (daysUntilProgram >= 0 && daysUntilProgram <= 4) {
              eligibleRows.push({
                index: i,
                programDate: programDate,
                daysUntil: daysUntilProgram,
                programName: rows[i][5] || "Unknown Program", // Column F: Program Name
                programDateTime: programDateTime,
              });
            }
          }
        }
      }
    }

    if (eligibleRows.length === 0) {
      console.log(
        `No registration found for phone number: ${extractedNumber} within 4 days`
      );
      // Removed return
    }

    // Sort by closest date and take the first one
    eligibleRows.sort((a, b) => a.daysUntil - b.daysUntil);
    const targetRow = eligibleRows[0];
    const rowIndex = targetRow.index;

    console.log(
      `Found eligible program: ${targetRow.programName} on ${targetRow.programDateTime}, ${targetRow.daysUntil} days away`
    );

    // Update the attendance status in column H
    const updateRange = `Submissions!H${rowIndex + 1}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: updateRange,
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [[attendanceStatus]],
      },
    });

    console.log(
      `Updated attendance status to "${attendanceStatus}" for ${extractedNumber} at row ${
        rowIndex + 1
      } for program: ${targetRow.programName} on ${targetRow.programDateTime}`
    );

    // Send confirmation message to the user
    const confirmationMessage =
      attendanceStatus === "Accepted"
        ? `Thank you for confirming your attendance. We look forward to seeing you at the event!`
        : `Thank you for letting us know you won't be able to attend. We hope to see you at future events.`;

    const chatID = extractedNumber.slice(1) + "@c.us";
    const sentMessage = await client.sendMessage(chatID, confirmationMessage);
    await addMessageToPostgres(sentMessage, idSubstring, extractedNumber);

    return true;
  } catch (error) {
    console.error("Error processing MTDC attendance:", error);
    throw error;
  }
}

async function mtdcConfirmAttendance(
  extractedNumber,
  msg,
  idSubstring,
  client
) {
  try {
    const attendanceStatus = "Accepted";

    const auth = new google.auth.GoogleAuth({
      keyFile: "./service_account.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = "1bW-KOpZ0lUDVNT4A6GZzzsIrne6MTBeBszrbOMyzoLI";
    const range = "Submissions!A:I";

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log("No data found in MTDC spreadsheet.");
      // Removed return
    }

    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (
        rows[i][3] &&
        rows[i][3]
          .replace(/\D/g, "")
          .includes(extractedNumber.replace(/\D/g, ""))
      ) {
        rowIndex = i;
        break;
      }
    }

    if (rowIndex === -1) {
      console.log(`No registration found for phone number: ${extractedNumber}`);
      // Removed return
    }

    const updateRange = `Submissions!I${rowIndex + 1}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: updateRange,
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [[attendanceStatus]],
      },
    });

    console.log(
      `Updated attendance confirmation status to "${attendanceStatus}" for ${extractedNumber} at row ${
        rowIndex + 1
      }`
    );

    // Send confirmation message to the user
    const confirmationMessage = `Your attendance has been recorded.\nThank you for joining our programme!`;

    const chatID = extractedNumber.slice(1) + "@c.us";
    const sentMessage = await client.sendMessage(chatID, confirmationMessage);
    await addMessageToPostgres(sentMessage, idSubstring, extractedNumber);

    return true;
  } catch (error) {
    console.error("Error processing MTDC attendance confirmation:", error);
    throw error;
  }
}

async function processBufferedMessages(client, bufferKey, botName, phoneIndex) {
  try {
    const buffer = messageBuffers.get(bufferKey);
    if (!buffer || buffer.messages.length === 0) return;

    const messages = buffer.messages;
    messageBuffers.delete(bufferKey); // Clear the buffer

    // Combine all message bodies
    const combinedMessage = messages.map((m) => m.body).join(" ");

    // Process the combined message
    await processMessage(
      client,
      messages[0],
      botName,
      phoneIndex,
      combinedMessage
    );
  } catch (error) {
    console.error(`[processBufferedMessages] Error for bot ${botName}:`, error);
    console.error(`[processBufferedMessages] Error message:`, error?.message || 'No message');
    console.error(`[processBufferedMessages] Error stack:`, error?.stack || 'No stack');
  }
}

// Add this enhanced logging to your processMessage function
async function processMessage(
  client,
  msg,
  botName,
  phoneIndex,
  combinedMessage
) {
  const idSubstring = botName;
  const chatId = msg.from;
  try {
    // Log message type for debugging, especially for Meta ads notifications
    console.log(`[MESSAGE TYPE DEBUG] Company: ${botName}, Type: ${msg.type}, Body: ${msg.body?.substring(0, 50)}...`);
    
    // Initial fetch of config
    const companyConfig = await fetchConfigFromDatabase(
      idSubstring,
      phoneIndex
    );
    if (!companyConfig) {
      console.log(`No config found for company ${idSubstring}`);
      return;
    }

    const sender = {
      to: msg.from,
      name: msg.notifyName,
    };

    const extractedNumber = await safeExtractPhoneNumber(msg, client);

    if (msg.fromMe) {
      console.log(msg);
      if (idSubstring === "0128") {
        const contactIDDC = await safeExtractToPhoneNumber(msg, client);
        if (contactIDDC) {
          await addTagToPostgres(
            contactIDDC.replace("+", ""),
            "stop bot",
            idSubstring
          );
        }
      }
      return;
    }

    const contactData = await getContactDataFromDatabaseByPhone(
      extractedNumber,
      idSubstring
    );

    // Send OneSignal notification for incoming messages
    try {
      const incomingContactName = contactData?.name || extractedNumber;
      const messageBody = msg.body || "New message received";

      // Get contact ID and chat ID for the notification
      const contactID =
        contactData?.contact_id || `${idSubstring}-${extractedNumber.slice(1)}`;
      const chatID = msg.from; // This is the WhatsApp chat ID

      // Get profile picture URL if available
      let profilePicUrl = null;
      try {
        const contact = await chat.getContact();
        profilePicUrl = await getProfilePicUrl(contact);
      } catch (error) {
        console.log("Could not get profile picture URL:", error.message);
      }

      await addNotificationToUser(
        idSubstring, // companyId
        messageBody, // message
        incomingContactName, // contactName
        contactID, // contactId
        chatID, // chatId
        extractedNumber, // phoneNumberf
        profilePicUrl // profilePicUrl
      );
      console.log(
        `OneSignal notification sent for incoming message from ${incomingContactName}`
      );
    } catch (notificationError) {
      console.error(
        "Error sending OneSignal notification for incoming message:",
        notificationError
      );
      // Continue processing even if notification fails
    }

    let contactName;
    let threadID;
    let query = combinedMessage;
    const chat = await msg.getChat();

    let stopTag = contactData?.tags || [];
    let contact;
    try {
      contact = await chat.getContact();
    } catch (err) {
      contact = await client.getContactById(msg.from);
    }

    if (msg.fromMe) {
      if (stopTag.includes("idle")) {
        return;
      }
      return;
    }

    if (sender.to.includes("60193668776") && idSubstring === "002") {
      return;
    }

    if (
      Array.isArray(stopTag) &&
      stopTag.some(
        (tag) => typeof tag === "string" && tag.toLowerCase() === "stop bot"
      )
    ) {
      console.log(
        `Bot stopped for this message from ${sender.to} for Company ${idSubstring}`
      );
      return;
    }

    // Get or create thread ID
    if (contactData?.thread_id) {
      threadID = contactData.thread_id;
    } else {
      const thread = await createThread();
      threadID = thread.id;
      const contactIDForThread = contactData?.phone || extractedNumber;
      await saveThreadIDPostgres(contactIDForThread, threadID, idSubstring);
    }

    // Handle special cases like attendance
    if (
      query.toLowerCase().includes("attending".toLowerCase()) &&
      idSubstring === "0380"
    ) {
      try {
        const status = await mtdcAttendance(
          extractedNumber,
          query,
          idSubstring,
          client
        );
        if (status === true) {
          console.log(
            "Attendance message for MTDC processed successfully, stopping further processing"
          );
          return;
        }
      } catch (error) {
        console.error("Error processing attendance for MTDC:", error);
      }
    }

    if (
      query
        .toLowerCase()
        .includes("have attended the program at mtdc".toLowerCase()) &&
      idSubstring === "0380"
    ) {
      try {
        const status = await mtdcConfirmAttendance(
          extractedNumber,
          query,
          idSubstring,
          client
        );
        if (status === true) {
          console.log(
            "Confirmation of attendance for MTDC processed successfully, stopping further processing"
          );
          return;
        }
      } catch (error) {
        console.error(
          "Error processing confirmation of attendance for MTDC:",
          error
        );
      }
    }

    // Start typing indicator
    chat.sendStateTyping();

    // Message Body
    const messageBody = query;

    const handlerParams = {
      client: client,
      msg: messageBody,
      idSubstring: idSubstring,
      extractedNumber: extractedNumber,
      contactName:
        contactData?.name ||
        contactData?.contact_name ||
        contact.pushname ||
        extractedNumber,
      phoneIndex: phoneIndex,
    };

    // Check if bot is stopped
    let isMainBotStopped = false;
    if (companyConfig.stopbot) {
      if (companyConfig.stopbot == true) {
        console.log(`Main Bot Toggled Off for Company ${botName}`);
        isMainBotStopped = true;
      }
    }

    if (
      companyConfig.stopbots &&
      companyConfig.stopbots[phoneIndex.toString()] === true
    ) {
      console.log(
        `Bot Toggled Off for Company ${botName} for Phone Index ${phoneIndex}`
      );
      isMainBotStopped = true;
    }

    const quotaLimit = await checkMessageQuotaLimit(idSubstring);
    if (quotaLimit) {
      console.log(`AI Messages quota limit reached for Company ${idSubstring}`);
      // isMainBotStopped = true;
    }

    // Only process full bot responses if bot is not stopped
    if (!isMainBotStopped) {
      if (
        !sender.to.includes("@g.us") ||
        (combinedMessage.toLowerCase().startsWith("@juta") &&
          phoneIndex == 0) ||
        (sender.to.includes("@g.us") &&
          idSubstring === "0385" &&
          !stopTag.includes("stop bot"))
      ) {
        // Process AI responses for 'user'
        await processAIResponses({
          ...handlerParams,
          keywordSource: "user",
          companyConfig: companyConfig,
          handlers: {
            assign: false,
            tag: false,
            followUp: false,
            document: true,
            image: true,
            video: true,
            voice: true,
          },
        });

        let answer;

        if (
          msg.type === "document" &&
          msg._data.mimetype === "application/pdf"
        ) {
          const pdfAnalysis = await handlePDFMessagePoppler(
            msg,
            sender,
            threadID,
            client,
            idSubstring,
            extractedNumber,
            phoneIndex
          );
          const query = `${combinedMessage} The user PDF content analysis is: ${pdfAnalysis}`;
          answer = await handleOpenAIAssistant(
            query,
            threadID,
            stopTag,
            extractedNumber,
            idSubstring,
            client,
            contactData?.name ||
              contactData?.contact_name ||
              contact.pushname ||
              extractedNumber,
            phoneIndex,
            companyConfig
          );
        } else if (msg.type === "location") {
          const query = `${combinedMessage} The user sent a location message`;
          answer = await handleOpenAIAssistant(
            query,
            threadID,
            stopTag,
            extractedNumber,
            idSubstring,
            client,
            contactData?.name ||
              contactData?.contact_name ||
              contact.pushname ||
              extractedNumber,
            phoneIndex,
            companyConfig
          );
        } else if (msg.type === "image") {
          const imageAnalysis = await handleImageMessage(
            msg,
            sender,
            threadID,
            client,
            idSubstring,
            extractedNumber,
            phoneIndex
          );
          const query = `${combinedMessage} The user image analysis is: ${imageAnalysis}`;
          answer = await handleOpenAIAssistant(
            query,
            threadID,
            stopTag,
            extractedNumber,
            idSubstring,
            client,
            contactData?.name ||
              contactData?.contact_name ||
              contact.pushname ||
              extractedNumber,
            phoneIndex,
            companyConfig
          );
        } else {
          const typeAnalysis = await handleMessageByType({
            client,
            msg,
            sender,
            threadID,
            idSubstring,
            extractedNumber,
            contactName,
            combinedMessage,
            stopTag,
            contactData,
            phoneIndex,
          });

          const query = typeAnalysis
            ? `${combinedMessage} ${typeAnalysis}`
            : combinedMessage;

          answer = await handleOpenAIAssistant(
            query,
            threadID,
            stopTag,
            extractedNumber,
            idSubstring,
            client,
            contactData?.name ||
              contactData?.contact_name ||
              contact.pushname ||
              extractedNumber,
            phoneIndex,
            companyConfig
          );
        }

        if (answer) {
          await processBotResponse({
            client,
            msg,
            answer,
            idSubstring,
            extractedNumber,
            contactName:
              contactData?.name ||
              contactData?.contact_name ||
              contact.pushname ||
              extractedNumber,
            phoneIndex,
            threadID,
            contactData,
            companyConfig,
          });
        }
      }
    } else {
      await processNonAIResponses({
        ...handlerParams,
        keywordSource: "user",
        companyConfig: companyConfig,
        handlers: {
          assign: false,
          tag: false,
          followUp: false,
          document: true,
          image: true,
          video: true,
          voice: true,
        },
      });
      console.log(
        `Main bot is stopped for Company ${botName}, but lead assignment processing is still active`
      );
    }
    await chat.markUnread();
    console.log("Response sent.");
  } catch (e) {
    console.error(`[processMessage] Error for bot ${botName}:`, e);
    console.error(`[processMessage] Error message:`, e?.message || 'No message');
    console.error(`[processMessage] Error stack:`, e?.stack || 'No stack');
    console.error(`[processMessage] Error type:`, typeof e);
    return e.message;
  }
}

async function checkMessageQuotaLimit(companyID) {
  // Get company plan for quota calculation first
  const companyResult = await pool.query(
    `SELECT plan FROM companies WHERE company_id = $1`,
    [companyID]
  );
  const companyPlan = companyResult.rows[0]?.plan || "free";
  const planBasedQuota = getPlanBasedQuota(companyPlan);
  const quotaKey = getQuotaKey(companyPlan);
  const isLifetimePlan = !isMonthlyResetPlan(companyPlan);

  let messageUsage = {};
  const feature = "aiMessages";

  // Get usage based on plan type
  let featureResult;
  if (isLifetimePlan) {
    // For free plan: get lifetime usage
    featureResult = await pool.query(
      `SELECT SUM(usage_count) AS total_usage
       FROM usage_logs
       WHERE company_id = $1 AND feature = $2`,
      [companyID, feature]
    );
  } else {
    // For paid plans: get monthly usage
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const monthlyKey = `${year}-${month}`;

    featureResult = await pool.query(
      `SELECT SUM(usage_count) AS total_usage
       FROM usage_logs
       WHERE company_id = $1 AND feature = $2
       AND to_char(date, 'YYYY-MM') = $3`,
      [companyID, feature, monthlyKey]
    );
  }

  messageUsage[feature] = featureResult.rows[0]?.total_usage || 0;
  console.log(
    `AI message usage data (${isLifetimePlan ? "lifetime" : "monthly"}):`,
    messageUsage
  );

  let usageQuota = {};
  const settingKey = "quotaAIMessage";

  const quotaResult = await pool.query(
    `SELECT setting_value FROM settings
    WHERE company_id = $1 AND setting_type = 'messaging' AND setting_key = $2`,
    [companyID, settingKey]
  );

  let quotaObj = {};
  if (quotaResult.rows.length > 0) {
    try {
      quotaObj =
        typeof quotaResult.rows[0].setting_value === "string"
          ? JSON.parse(quotaResult.rows[0].setting_value)
          : quotaResult.rows[0].setting_value || {};
    } catch {
      quotaObj = {};
    }
  }

  if (!quotaObj[quotaKey]) {
    quotaObj[quotaKey] = planBasedQuota;
    if (quotaResult.rows.length > 0) {
      await pool.query(
        `UPDATE settings SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $2 AND setting_type = 'messaging' AND setting_key = $3`,
        [JSON.stringify(quotaObj), companyID, settingKey]
      );
    } else {
      await pool.query(
        `INSERT INTO settings (company_id, setting_type, setting_key, setting_value, created_at, updated_at)
        VALUES ($1, 'messaging', $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [companyID, settingKey, JSON.stringify(quotaObj)]
      );
    }
  }

  usageQuota[feature] = quotaObj[quotaKey] || planBasedQuota;
  console.log("AI usage quota data:", usageQuota);

  // Check if usage exceeds quota
  const exceeded = messageUsage[feature] >= usageQuota[feature];
  return exceeded;
}
// Helper function to get plan-based quota amounts
// Helper function to get plan-based quota amounts
function getPlanBasedQuota(plan) {
  switch (plan?.toLowerCase()) {
    case "free":
      return 100;
    case "premium":
      return 5000;
    case "enterprise":
      return 20000;
    default:
      return 100; // Default to free plan quota
  }
}

// Helper function to check if plan uses monthly reset
function isMonthlyResetPlan(plan) {
  const planLower = plan?.toLowerCase();
  return planLower === "premium" || planLower === "enterprise";
}

// Helper function to get quota key (monthly for paid plans, lifetime for free)
function getQuotaKey(plan) {
  if (isMonthlyResetPlan(plan)) {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    return `${year}-${month}`;
  } else {
    return "lifetime"; // Free plan uses lifetime quota
  }
}

async function getContactDataFromDatabaseByPhone(phoneNumber, idSubstring) {
  try {
    if (!phoneNumber) {
      throw new Error("Phone number is undefined or null");
    }
    // Use direct SQL query instead of pool connection
    const result = await sql`
      SELECT * FROM public.contacts
      WHERE phone = ${phoneNumber} AND company_id = ${idSubstring}
      LIMIT 1
    `;

    if (result.length === 0) {
      return null;
    } else {
      const contactData = result[0];
      const contactName = contactData.name || contactData.contact_name;
      const threadID = contactData.thread_id;

      return {
        ...contactData,
        contactName,
        threadID,
      };
    }
  } catch (error) {
    console.error("Error fetching contact data:", error);
    throw error;
  }
}

setInterval(() => {
  console.log("Pool status:", {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  });
}, 30000);

// Enhanced addMessageToPostgres function
async function addMessageToPostgres(
  msg,
  idSubstring,
  extractedNumber,
  contactName,
  phoneIndex = 0
) {
  if (!extractedNumber || !extractedNumber.startsWith("+")) {
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

  const basicInfo = await extractBasicMessageInfo(msg);
  const messageData = await prepareMessageData(msg, idSubstring, null);

  let messageBody = messageData.text?.body || "";

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
  }

  let mediaUrl = null;
  let mediaData = null;
  let mediaMetadata = {};

  if (msg.hasMedia) {
    if (msg.type === "video") {
      mediaUrl = messageData.video?.link || null;
    } else if (msg.type !== "audio" && msg.type !== "ptt") {
      mediaData = messageData[msg.type]?.data || null;
      mediaUrl = messageData[msg.type]?.link || null;
      mediaMetadata = {
        mimetype: messageData[msg.type]?.mimetype,
        filename: messageData[msg.type]?.filename || "",
        caption: messageData[msg.type]?.caption || "",
        thumbnail: messageData[msg.type]?.thumbnail || null,
        mediaKey: messageData[msg.type]?.media_key || null,
      };

      if (msg.type === "image") {
        mediaMetadata.width = messageData.image?.width;
        mediaMetadata.height = messageData.image?.height;
      } else if (msg.type === "document") {
        mediaMetadata.pageCount = messageData.document?.page_count;
        mediaMetadata.fileSize = messageData.document?.file_size;
      }
    } else if (msg.type === "audio" || msg.type === "ptt") {
      mediaData = messageData.audio?.data || null;
    }
  }

  const quotedMessage = messageData.text?.context || null;

  let author = null;
  if (msg.from.includes("@g.us") && basicInfo.author) {
    const authorData = await getContactDataFromDatabaseByPhone(
      basicInfo.author,
      idSubstring
    );
    author = authorData ? authorData.contactName : basicInfo.author;
  }

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Create/update contact
      const contactCheckQuery = `
        SELECT id, contact_id, phone, company_id, name, contact_name FROM public.contacts 
        WHERE contact_id = $1 AND company_id = $2
      `;
      const contactResult = await client.query(contactCheckQuery, [
        contactID,
        idSubstring,
      ]);

      if (contactResult.rows.length === 0) {
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
          contactName || extractedNumber,
          contactName || extractedNumber,
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
      } else {
        const existingContact = contactResult.rows[0];
        // Check if name is just the phone number (potential duplicate indicator)
        if (
          existingContact.name === extractedNumber ||
          existingContact.name === extractedNumber.slice(1)
        ) {
          console.log(
            `�� [CONTACT_TRACKING] ⚠️ WARNING: Contact name is phone number - potential duplicate:`,
            {
              contact_id: existingContact.contact_id,
              name: existingContact.name,
              phone: existingContact.phone,
            }
          );
        }
      }

      // Insert the message
      const messageQuery = `
        INSERT INTO public.messages (
          message_id, company_id, contact_id, thread_id, customer_phone,
          content, message_type, media_url, timestamp, direction,
          status, from_me, chat_id, author, quoted_message, media_data, media_metadata, phone_index
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (message_id, company_id) DO NOTHING
        RETURNING id
      `;
      const messageValues = [
        basicInfo.idSerialized,
        idSubstring,
        contactID,
        msg.from,
        extractedNumber,
        messageBody,
        basicInfo.type,
        mediaUrl,
        new Date(basicInfo.timestamp * 1000),
        msg.fromMe ? "outbound" : "inbound",
        "delivered",
        msg.fromMe || false,
        msg.from,
        author || contactID,
        quotedMessage ? JSON.stringify(quotedMessage) : null,
        mediaData || null,
        Object.keys(mediaMetadata).length > 0
          ? JSON.stringify(mediaMetadata)
          : null,
        phoneIndex,
      ];

      const messageResult = await client.query(messageQuery, messageValues);
      const messageDbId = messageResult.rows[0]?.id;

      // Update contact's last message
      await client.query(
        `UPDATE public.contacts 
         SET last_message = $1, last_updated = CURRENT_TIMESTAMP
         WHERE contact_id = $2 AND company_id = $3`,
        [
          JSON.stringify({
            chat_id: msg.to,
            from: msg.from,
            from_me: true,
            id: basicInfo.idSerialized,
            status: "delivered",
            text: { body: messageBody },
            timestamp: Math.floor(Date.now() / 1000),
            type: basicInfo.type,
            phoneIndex: phoneIndex,
          }),
          contactID,
          idSubstring,
        ]
      );

      await client.query("COMMIT");
    } catch (error) {
      await safeRollback(client);
      console.error("Error in PostgreSQL transaction:", error);
      throw error;
    } finally {
      await safeRelease(client);
      // Get profile picture URL for the contact
      let profilePicUrl = null;
      try {
        const chat = await msg.getChat();
        const contact = await chat.getContact();
        profilePicUrl = await getProfilePicUrl(contact);
        console.log("Profile picture URL:", profilePicUrl);
      } catch (error) {
        console.log("Could not get profile picture URL:", error.message);
      }
      await addNotificationToUser(
        idSubstring,
        messageBody,
        contactName,
        contactID,
        msg.from,
        extractedNumber,
        profilePicUrl
      );
    }
  } catch (error) {
    console.error("PostgreSQL connection error:", error);
    throw error;
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
  companyConfig,
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
    companyConfig: companyConfig,
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

async function handleMessageByType({
  client,
  msg,
  sender,
  threadID,
  idSubstring,
  extractedNumber,
  contactName,
  combinedMessage,
  stopTag,
  contactData,
  phoneIndex = 0,
}) {
  if (msg.type === "document" && msg._data.mimetype === "application/pdf") {
    return await handlePDFMessagePoppler(
      msg,
      sender,
      threadID,
      client,
      idSubstring,
      extractedNumber,
      phoneIndex
    );
  } else if (msg.type === "location") {
    return "The user sent a location message";
  } else if (msg.type === "image") {
    return await handleImageMessage(
      msg,
      sender,
      threadID,
      client,
      idSubstring,
      extractedNumber,
      phoneIndex
    );
  } else if (msg.type === "notification" || msg.type === "notification_template" || msg.type === "broadcast_notification") {
    // Handle Meta ads notification messages - these contain regular text in msg.body
    console.log(`Meta ads notification message detected (type: ${msg.type})`);
    return null; // Return null to process as regular text message with combinedMessage
  }
  return null;
}

async function processNonAIResponses({
  client,
  msg,
  idSubstring,
  extractedNumber,
  contactName,
  phoneIndex,
  keywordSource,
  companyConfig,
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
    companyConfig: companyConfig,
  };

  console.log(
    `[NON-AI PROCESSING] Processing responses for Company ${idSubstring} without AI assistance`
  );

  // Handle user-triggered responses without AI
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

  console.log(
    `[NON-AI PROCESSING] Completed processing for Company ${idSubstring}`
  );
}

// Modular function to process bot response
async function processBotResponse({
  client,
  msg,
  answer,
  idSubstring,
  extractedNumber,
  contactName,
  phoneIndex,
  threadID,
  contactData,
  companyConfig,
}) {
  const parts = answer.split(/\s*\|\|\s*/);
  const followUpTemplates = await getFollowUpTemplates(idSubstring);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;

    const check = part.toLowerCase();

    if (
      part.includes("You sent this to the user:") ||
      check.includes("error")
    ) {
      return;
    }

    // Handle special product cases
    if (part.startsWith("~") && idSubstring == "020") {
      await handleProductResponse({
        client,
        msg,
        part,
        idSubstring,
        extractedNumber,
        contactName,
        phoneIndex,
      });
      continue;
    }

    // Send text message
    const sentMessage = await client.sendMessage(msg.from, part);

    // Save message to PostgreSQL
    await addMessageToPostgres({
      msg: sentMessage,
      idSubstring: idSubstring,
      extractedNumber: extractedNumber,
      contactName: contactName,
      phoneIndex: phoneIndex,
    });

    // Handle special cases based on message content
    await handleSpecialCases({
      part,
      idSubstring,
      extractedNumber,
      client,
      followUpTemplates,
      contactName,
      threadID,
      phoneIndex,
      msg,
      companyConfig,
    });

    const handlerParams = {
      client: client,
      msg: part,
      idSubstring: idSubstring,
      extractedNumber: extractedNumber,
      contactName:
        contactData?.name || contactData?.contact_name || extractedNumber,
      phoneIndex: phoneIndex,
    };

    // Process AI responses for 'bot'
    await processAIResponses({
      ...handlerParams,
      keywordSource: "bot",
      companyConfig: companyConfig,
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
  }
}

// Modular function to handle product responses
async function handleProductResponse({
  client,
  msg,
  part,
  idSubstring,
  extractedNumber,
  contactName,
  phoneIndex,
}) {
  const lines = part.split("\n");
  for (const line of lines) {
    if (line.trim().startsWith("~")) {
      const rawProductName = line
        .slice(1)
        .split(/\s+the\s+price\s+per/i)[0]
        .trim();
      const productName =
        rawProductName.toLowerCase().replace(/\s+/g, "") + "-thepriceper";
      const filePath = carpetTileFilePaths[productName];

      if (filePath) {
        try {
          const media = await MessageMedia.fromUrl(filePath, {
            unsafeMime: true,
            filename: `${productName}.pdf`,
          });

          const documentMessage = await client.sendMessage(msg.from, media, {
            sendMediaAsDocument: true,
          });

          await addMessageToPostgres({
            msg: documentMessage,
            idSubstring: idSubstring,
            extractedNumber: extractedNumber,
            contactName: contactName,
            phoneIndex: phoneIndex,
          });
        } catch (error) {
          console.error(`Error sending document for ${rawProductName}:`, error);
        }
      }
    }
  }
}

// Modular function to handle special cases
async function handleSpecialCases({
  part,
  idSubstring,
  extractedNumber,
  client,
  followUpTemplates,
  contactName,
  threadID,
  phoneIndex,
  msg,
  companyConfig,
}) {
  // Handle general team notification
  if (part.includes("notified the team")) {
    const { empName, empPhone } = await assignNewContactToEmployee(
      extractedNumber,
      idSubstring,
      client,
      (phoneIndex = phoneIndex)
    );
    await addTagToPostgres(extractedNumber, empName, idSubstring);
  }
if (idSubstring === "058666") {
  if (part.toLowerCase().includes("team sale")) {
      // Stop the bot for this contact and perform AI-driven assignment & reporting
      await addTagToPostgres(extractedNumber, "stop bot", idSubstring);
      try {
        await handleAIAsssignResponses058666({
          threadID,
          assistantId: companyConfig.assistantId,
          contactName,
          extractedNumber,
          client,
          idSubstring,
          phoneIndex,
          msg,
        });
      } catch (err) {
        console.error("Error in AI assign handler for 058666:", err);
      }
    }
  }
  // Handle 0128 bot triggers
  if (idSubstring === "0128") {
    if (
      part.toLowerCase().includes("i will notify the team") ||
      part.toLowerCase().includes("i have notified the team")
    ) {
      const { empName, empPhone } = await assignNewContactToEmployee(
        extractedNumber,
        idSubstring,
        client,
        (phoneIndex = phoneIndex)
      );
      await addTagToPostgres(extractedNumber, empName, idSubstring);
    }

    if (part.toLowerCase().includes("get back to you")) {
      await addTagToPostgres(extractedNumber, "stop bot", idSubstring);
      const { empName, empPhone } = await assignNewContactToEmployee(
        extractedNumber,
        idSubstring,
        client,
        (phoneIndex = phoneIndex)
      );
      await addTagToPostgres(extractedNumber, empName, idSubstring);
    }

    if (
      part.toLowerCase().includes("thank you for your feedback") ||
      part.toLowerCase().includes("sorry to hear that") ||
      part.toLowerCase().includes("apologize for")
    ) {
      await addTagToPostgres(extractedNumber, "feedback", idSubstring);
    }

    if (
      part.toLowerCase().includes("i understand you need more information") ||
      part.toLowerCase().includes("let me forward your inquiry")
    ) {
      await addTagToPostgres(extractedNumber, "inquiry", idSubstring);
    }

    if (
      part.toLowerCase().includes("thank you for your order") ||
      part.toLowerCase().includes("order has been confirmed")
    ) {
      await addTagToPostgres(extractedNumber, "ordered", idSubstring);
    }
  }
  if (part.includes("Click to Register") && idSubstring == "0380") {
    const sentMessage = await client.sendMessage(
      msg.from,
      "http://web.jutateknologi.com/register/registration-form-for-co9p-programs/" +
        extractedNumber
    );

    await addMessageToPostgres(
      sentMessage,
      idSubstring,
      msg.from,
      "Register Link"
    );
  }
  // Handle MTDC case (0380)
  if (part.includes("Your details are registered") && idSubstring == "0380") {
    const { reportMessage, contactInfoMTDC } = await generateSpecialReportMTDC(
      threadID,
      companyConfig.assistantId,
      contactName,
      extractedNumber
    );

    console.log("=== handleSpecialCases DEBUG ===");
    console.log(contactInfoMTDC);
    console.log(reportMessage);
    /*    const sentMessage = await client.sendMessage(
      "120363386875697540@g.us",
      reportMessage
    );
    
    await addMessageToPostgres(
      sentMessage,
      idSubstring,
      "+120363386875697540",
      "Group Chat"
    );
*/
    await insertSpreadsheetMTDC(reportMessage);
    await saveSpecialCaseMTDC(
      contactInfoMTDC,
      extractedNumber,
      contactName,
      threadID,
      idSubstring
    );
  }

  // Handle SKC case (0161)
  if (part.includes("forward your details") && idSubstring == "0161") {
    const { reportMessage, contactInfoSKC } = await generateSpecialReportSKC(
      threadID,
      companyConfig.assistantId,
      contactName,
      extractedNumber
    );

    const sentMessage = await client.sendMessage(
      "120363386875697540@g.us",
      reportMessage
    );
    await updateGoogleSheet(reportMessage);
    await addMessageToPostgres(
      sentMessage,
      idSubstring,
      "+120363386875697540",
      "Group Chat"
    );

    await saveSpecialCaseSKC(contactInfoSKC);
  }

  // Handle Maha Aerospace case (080)
  if (part.includes("get back to you") && idSubstring === "080") {
    const { reportMessage, contactInfo } = await generateSpecialReportMaha(
      threadID,
      companyConfig.assistantId,
      contactName,
      extractedNumber
    );

    const sentMessage = await client.sendMessage(
      "120363318433286839@g.us",
      reportMessage
    );
    await addMessageToPostgres(
      sentMessage,
      idSubstring,
      "+120363318433286839",
      "Group Chat"
    );

    try {
      await updateMahaGoogleSheet(reportMessage);
    } catch (error) {
      console.error("Error updating Maha Aerospace Google Sheet:", error);
    }

    await saveSpecialCaseMaha(contactInfo);
  }

  // Handle LKSSB case (0119)
  if (part.includes("forward your details") && idSubstring == "0119") {
    const { reportMessage, contactInfoLKSSB } =
      await generateSpecialReportLKSSB(
        threadID,
        companyConfig.assistantId,
        contactName,
        extractedNumber
      );

    const sentMessage = await client.sendMessage(
      "120363374300897170@g.us",
      reportMessage
    );
    await addMessageToPostgres(
      sentMessage,
      idSubstring,
      "+120363374300897170",
      "Group Chat"
    );

    await saveSpecialCaseLKSSB(contactInfoLKSSB);
  }

  // Handle BINA case (002)
  if (
    (part.includes("Ms Goh") || part.includes("0182786776")) &&
    idSubstring == "002"
  ) {
    const { reportMessage, contactInfoBINA } = await generateSpecialReportBINA(
      threadID,
      companyConfig.assistantId,
      contactName,
      extractedNumber
    );

    const sentMessage = await client.sendMessage(
      "60182786776@c.us",
      reportMessage
    );
    await addMessageToPostgres(
      sentMessage,
      idSubstring,
      "+60182786776",
      "Contact Chat"
    );

    await saveSpecialCaseBINA(contactInfoBINA);
  }

  // Handle Eduville case (095)
  if (idSubstring == "095") {
    if (part.includes("get back to you")) {
      const { reportMessage, contactInfo } = await generateSpecialReport(
        threadID,
        companyConfig.assistantId,
        contactName,
        extractedNumber
      );
      const sentMessage = await client.sendMessage(
        "120363325228671809@g.us",
        reportMessage
      );
      await addMessageToPostgres(
        sentMessage,
        idSubstring,
        "+120363325228671809"
      );

      await saveSpecialCaseEduville(contactInfo);

      await addTagToPostgres(extractedNumber, "stop bot", idSubstring);
    }

    if (part.includes("check with the team")) {
      const { reportMessage } = await generateSpecialReport2(
        threadID,
        companyConfig.assistantId,
        contactName,
        extractedNumber
      );
      const sentMessage = await client.sendMessage(
        "120363325228671809@g.us",
        reportMessage
      );
      await addMessageToPostgres(
        sentMessage,
        idSubstring,
        "+120363325228671809"
      );
      await addTagToPostgres(extractedNumber, "stop bot", idSubstring);
    }
  }

  // Handle JobBuilder case (765943)
  if (idSubstring == "765943") {
    // Helper function to check if message contains hiring company triggers (English, Chinese, Malay)
    const isHiringCompanyTrigger = (text) => {
      const lowerText = text.toLowerCase();
      return (
        lowerText.includes("24-48 hours") ||
        lowerText.includes("24-48 jam") || // Malay
        lowerText.includes("24-48小时") || // Chinese Simplified
        lowerText.includes("24-48小時") || // Chinese Traditional
        lowerText.includes("dalam 24-48 jam") || // Malay variation
        lowerText.includes("二十四至四十八小时") || // Chinese variation
        lowerText.includes("二十四至四十八小時") // Chinese Traditional variation
      );
    };

    // Helper function to check if message contains job seeker triggers (English, Chinese, Malay)
    const isJobSeekerTrigger = (text) => {
      const lowerText = text.toLowerCase();
      return (
        lowerText.includes("processed accordingly") ||
        lowerText.includes("diproses dengan sewajarnya") || // Malay
        lowerText.includes("akan diproses") || // Malay variation
        lowerText.includes("相应处理") || // Chinese Simplified
        lowerText.includes("相應處理") || // Chinese Traditional
        lowerText.includes("按照程序处理") || // Chinese variation
        lowerText.includes("按照程序處理") // Chinese Traditional variation
      );
    };

    // Handle company hiring inquiries
    if (isHiringCompanyTrigger(part)) {
      const { reportMessage, contactInfo } = await generateSpecialReportRecruitment(
        threadID,
        companyConfig.assistantId,
        contactName,
        extractedNumber,
        "hiring_company"
      );
      console.log("=== [Special Cases] JobBuilder Hiring Company Report ===");
      console.log(reportMessage);
      
      const sentMessage = await client.sendMessage(
        "60167557780@c.us",
        reportMessage
      );
      await addMessageToPostgres(
        sentMessage,
        idSubstring,
        "+60167557780"
      );
    }

    // Handle job seeker inquiries
    if (isJobSeekerTrigger(part)) {
      const { reportMessage, contactInfo } = await generateSpecialReportRecruitment(
        threadID,
        companyConfig.assistantId,
        contactName,
        extractedNumber,
        "job_seeker"
      );
      console.log("=== [Special Cases] JobBuilder Job Seeker Report ===");
      console.log(reportMessage);
      
      const sentMessage = await client.sendMessage(
        "120363028469517905@g.us",
        reportMessage
      );
      await addMessageToPostgres(
        sentMessage,
        idSubstring,
        "+120363028469517905"
      );
    }

    // Handle general team notifications (contact updates, important info, referrals, etc.)
    if (
      part.toLowerCase().includes("informed the team") ||
      part.toLowerCase().includes("notified the team") ||
      part.toLowerCase().includes("i have informed") ||
      part.toLowerCase().includes("i have notified")
    ) {
      const { reportMessage, notificationInfo } = await generateTeamNotificationReport(
        threadID,
        companyConfig.assistantId,
        contactName,
        extractedNumber
      );
      console.log("=== [Special Cases] JobBuilder Team Notification Report ===");
      console.log(reportMessage);
      
      const sentMessage = await client.sendMessage(
        "60167557780@c.us",
        reportMessage
      );
      await addMessageToPostgres(
        sentMessage,
        idSubstring,
        "+60167557780"
      );
    }
  }

  async function saveSpecialCaseEduville(contactInfo) {
    const sqlClient = await pool.connect();
    try {
      await sqlClient.query("BEGIN");

      const contactData = {
        phone: extractedNumber,
        contact_name: (contactInfo.contactName || contactName || "").trim(),
        thread_id: threadID,
        custom_fields: {
          contactName: contactInfo.contactName || contactName,
          country: contactInfo.country,
          highestEducation: contactInfo.highestEducation,
          programOfStudy: contactInfo.programOfStudy,
          intakePreference: contactInfo.intakePreference,
          englishProficiency: contactInfo.englishProficiency,
          passport: contactInfo.passport,
          nationality: contactInfo.nationality,
        },
      };

      Object.keys(contactData.custom_fields).forEach((key) => {
        if (contactData.custom_fields[key] === undefined) {
          delete contactData.custom_fields[key];
        }
      });

      // Check if contact exists
      const checkResult = await sqlClient.query(
        "SELECT contact_id FROM public.contacts WHERE phone = $1 AND company_id = $2",
        [extractedNumber, idSubstring]
      );

      if (checkResult.rows.length > 0) {
        await sqlClient.query(
          `UPDATE public.contacts 
            SET contact_name = $1, 
                thread_id = $2, 
                custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $3::jsonb,
                last_updated = CURRENT_TIMESTAMP
            WHERE phone = $4 AND company_id = $5`,
          [
            contactData.contact_name,
            contactData.thread_id,
            JSON.stringify(contactData.custom_fields),
            contactData.phone,
            idSubstring,
          ]
        );
      } else {
        const contactID =
          idSubstring +
          "-" +
          (extractedNumber.startsWith("+")
            ? extractedNumber.slice(1)
            : extractedNumber);

        await sqlClient.query(
          `INSERT INTO public.contacts 
            (contact_id, company_id, name, contact_name, phone, thread_id, custom_fields)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            contactID,
            idSubstring,
            contactData.contact_name,
            contactData.contact_name,
            contactData.phone,
            contactData.thread_id,
            JSON.stringify(contactData.custom_fields),
          ]
        );
      }

      await sqlClient.query("COMMIT");
    } catch (error) {
      await safeRollback(sqlClient);
      console.error("Error updating contact in PostgreSQL:", error);
      throw error;
    } finally {
      await safeRelease(sqlClient);
    }
  }

  async function saveSpecialCaseBINA(contactInfoBINA) {
    const sqlClient = await pool.connect();
    try {
      await sqlClient.query("BEGIN");

      const contactData = {
        phone: extractedNumber,
        contact_name: (contactInfoBINA.contactName || contactName || "").trim(),
        thread_id: threadID,
        custom_fields: {
          Email: contactInfoBINA.email || "[Not specified]",
          Availability: contactInfoBINA.availability || "[Not specified]",
          Issue: contactInfoBINA.issue || "[Not specified]",
          "Photos/Video": contactInfoBINA.photosVideo || "[Not specified]",
          "How Many Floor": contactInfoBINA.howManyFloor || "[Not specified]",
          "Roof Tile/Slab": contactInfoBINA.roofTileSlab || "[Not specified]",
        },
      };

      Object.keys(contactData.custom_fields).forEach((key) => {
        if (contactData.custom_fields[key] === undefined) {
          delete contactData.custom_fields[key];
        }
      });

      const checkResult = await sqlClient.query(
        "SELECT contact_id FROM public.contacts WHERE phone = $1 AND company_id = $2",
        [extractedNumber, idSubstring]
      );

      if (checkResult.rows.length > 0) {
        await sqlClient.query(
          `UPDATE public.contacts 
          SET contact_name = $1, 
              thread_id = $2, 
              custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $3::jsonb,
              last_updated = CURRENT_TIMESTAMP
          WHERE phone = $4 AND company_id = $5`,
          [
            contactData.contact_name,
            contactData.thread_id,
            JSON.stringify(contactData.custom_fields),
            contactData.phone,
            idSubstring,
          ]
        );
      } else {
        const contactID =
          idSubstring +
          "-" +
          (extractedNumber.startsWith("+")
            ? extractedNumber.slice(1)
            : extractedNumber);

        await sqlClient.query(
          `INSERT INTO public.contacts 
          (contact_id, company_id, name, contact_name, phone, thread_id, custom_fields)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            contactID,
            idSubstring,
            contactData.contact_name,
            contactData.contact_name,
            contactData.phone,
            contactData.thread_id,
            JSON.stringify(contactData.custom_fields),
          ]
        );
      }

      await sqlClient.query("COMMIT");
    } catch (error) {
      await safeRollback(sqlClient);
      console.error("Error updating contact in PostgreSQL:", error);
      throw error;
    } finally {
      await safeRelease(sqlClient);
    }
  }

  async function saveSpecialCaseLKSSB(contactInfoLKSSB) {
    const sqlClient = await pool.connect();
    try {
      await sqlClient.query("BEGIN");

      const contactData = {
        phone: extractedNumber,
        contact_name: (
          contactInfoLKSSB.contactName ||
          contactName ||
          ""
        ).trim(),
        thread_id: threadID,
        custom_fields: {
          "Company Name": contactInfoLKSSB.companyName || "[Not specified]",
          "Company Address":
            contactInfoLKSSB.companyAddress || "[Not specified]",
          "Length Of Construction":
            contactInfoLKSSB.lengthOfConstruction || "[Not specified]",
          "Height Of Construction":
            contactInfoLKSSB.heightOfConstruction || "[Not specified]",
          Location: contactInfoLKSSB.location || "[Not specified]",
        },
      };

      Object.keys(contactData.custom_fields).forEach((key) => {
        if (contactData.custom_fields[key] === undefined) {
          delete contactData.custom_fields[key];
        }
      });

      const checkResult = await sqlClient.query(
        "SELECT contact_id FROM public.contacts WHERE phone = $1 AND company_id = $2",
        [extractedNumber, idSubstring]
      );

      if (checkResult.rows.length > 0) {
        await sqlClient.query(
          `UPDATE public.contacts 
          SET contact_name = $1, 
              thread_id = $2, 
              custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $3::jsonb,
              last_updated = CURRENT_TIMESTAMP
          WHERE phone = $4 AND company_id = $5`,
          [
            contactData.contact_name,
            contactData.thread_id,
            JSON.stringify(contactData.custom_fields),
            contactData.phone,
            idSubstring,
          ]
        );
      } else {
        const contactID =
          idSubstring +
          "-" +
          (extractedNumber.startsWith("+")
            ? extractedNumber.slice(1)
            : extractedNumber);

        await sqlClient.query(
          `INSERT INTO public.contacts 
          (contact_id, company_id, name, contact_name, phone, thread_id, custom_fields)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            contactID,
            idSubstring,
            contactData.contact_name,
            contactData.contact_name,
            contactData.phone,
            contactData.thread_id,
            JSON.stringify(contactData.custom_fields),
          ]
        );
      }

      await sqlClient.query("COMMIT");
    } catch (error) {
      await safeRollback(sqlClient);
      console.error("Error updating contact in PostgreSQL:", error);
      throw error;
    } finally {
      await safeRelease(sqlClient);
    }
  }

  async function saveSpecialCaseMaha(contactInfo) {
    const sqlClient = await pool.connect();
    try {
      await sqlClient.query("BEGIN");

      const contactData = {
        phone: extractedNumber,
        contact_name: `${contactInfo.firstName || ""} ${
          contactInfo.lastName || ""
        }`.trim(),
        thread_id: threadID,
        custom_fields: {
          "First Name": contactInfo.firstName || "[Not specified]",
          "Last Name": contactInfo.lastName || "[Not specified]",
          "Birth Date": contactInfo.birthDate || "[Not specified]",
          Country: contactInfo.country || "[Not specified]",
          "Education Level": contactInfo.educationLevel || "[Not specified]",
          Courses: contactInfo.courses || "[Not specified]",
          Sponsor: contactInfo.sponsor || "[Not specified]",
          "Referral Source": contactInfo.referralSource || "[Not specified]",
        },
      };

      Object.keys(contactData.custom_fields).forEach((key) => {
        if (contactData.custom_fields[key] === undefined) {
          delete contactData.custom_fields[key];
        }
      });

      const checkResult = await sqlClient.query(
        "SELECT contact_id FROM public.contacts WHERE phone = $1 AND company_id = $2",
        [extractedNumber, idSubstring]
      );

      if (checkResult.rows.length > 0) {
        await sqlClient.query(
          `UPDATE public.contacts 
          SET contact_name = $1, 
              thread_id = $2, 
              custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $3::jsonb,
              last_updated = CURRENT_TIMESTAMP
          WHERE phone = $4 AND company_id = $5`,
          [
            contactData.contact_name,
            contactData.thread_id,
            JSON.stringify(contactData.custom_fields),
            contactData.phone,
            idSubstring,
          ]
        );
      } else {
        const contactID =
          idSubstring +
          "-" +
          (extractedNumber.startsWith("+")
            ? extractedNumber.slice(1)
            : extractedNumber);

        await sqlClient.query(
          `INSERT INTO public.contacts 
          (contact_id, company_id, name, contact_name, phone, thread_id, custom_fields)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            contactID,
            idSubstring,
            contactData.contact_name,
            contactData.contact_name,
            contactData.phone,
            contactData.thread_id,
            JSON.stringify(contactData.custom_fields),
          ]
        );
      }

      await sqlClient.query("COMMIT");
    } catch (error) {
      await safeRollback(sqlClient);
      console.error("Error updating contact in PostgreSQL:", error);
      throw error;
    } finally {
      await safeRelease(sqlClient);
    }
  }

  async function saveSpecialCaseSKC(contactInfoSKC) {
    const sqlClient = await pool.connect();
    try {
      await sqlClient.query("BEGIN");

      const contactData = {
        phone: extractedNumber,
        contact_name: (contactInfoSKC.contactName || contactName || "").trim(),
        thread_id: threadID,
        custom_fields: {
          "Highest Qualification":
            contactInfoSKC.highestQualification || "[Not specified]",
          "Years of Work Experience":
            contactInfoSKC.yearsOfWorkExperience || "[Not specified]",
          Age: contactInfoSKC.age || "[Not specified]",
          "Program of Interest":
            contactInfoSKC.programOfInterest || "[Not specified]",
          "Current Occupation":
            contactInfoSKC.currentOccupation || "[Not specified]",
          "Current Industry":
            contactInfoSKC.currentIndustry || "[Not specified]",
        },
      };

      Object.keys(contactData.custom_fields).forEach((key) => {
        if (contactData.custom_fields[key] === undefined) {
          delete contactData.custom_fields[key];
        }
      });

      const checkResult = await sqlClient.query(
        "SELECT contact_id FROM public.contacts WHERE phone = $1 AND company_id = $2",
        [extractedNumber, idSubstring]
      );

      if (checkResult.rows.length > 0) {
        await sqlClient.query(
          `UPDATE public.contacts 
          SET contact_name = $1, 
              thread_id = $2, 
              custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $3::jsonb,
              last_updated = CURRENT_TIMESTAMP
          WHERE phone = $4 AND company_id = $5`,
          [
            contactData.contact_name,
            contactData.thread_id,
            JSON.stringify(contactData.custom_fields),
            contactData.phone,
            idSubstring,
          ]
        );
      } else {
        const contactID =
          idSubstring +
          "-" +
          (extractedNumber.startsWith("+")
            ? extractedNumber.slice(1)
            : extractedNumber);

        await sqlClient.query(
          `INSERT INTO public.contacts 
          (contact_id, company_id, name, contact_name, phone, thread_id, custom_fields)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            contactID,
            idSubstring,
            contactData.contact_name,
            contactData.contact_name,
            contactData.phone,
            contactData.thread_id,
            JSON.stringify(contactData.custom_fields),
          ]
        );
      }

      await sqlClient.query("COMMIT");
    } catch (error) {
      await safeRollback(sqlClient);
      console.error("Error updating contact in PostgreSQL:", error);
      throw error;
    } finally {
      await safeRelease(sqlClient);
    }
  }
  async function saveSpecialCaseMTDC(
    contactInfoMTDC,
    extractedNumber,
    contactName,
    threadID,
    idSubstring
  ) {
    const sqlClient = await pool.connect();
    try {
      await sqlClient.query("BEGIN");

      // Get the first program and date from the arrays
      const program =
        contactInfoMTDC.programs && contactInfoMTDC.programs.length > 0
          ? contactInfoMTDC.programs[0]
          : "[Not specified]";
      const programDateTime =
        contactInfoMTDC.programDates && contactInfoMTDC.programDates.length > 0
          ? contactInfoMTDC.programDates[0]
          : "[Not specified]";

      // ADD LOGGING HERE
      console.log("=== saveSpecialCaseMTDC DEBUG ===");
      console.log(
        "Input contactInfoMTDC:",
        JSON.stringify(contactInfoMTDC, null, 2)
      );
      console.log("Extracted program:", program);
      console.log("Extracted programDateTime:", programDateTime);
      console.log("extractedNumber:", extractedNumber);
      console.log("contactName:", contactName);
      console.log("threadID:", threadID);
      console.log("idSubstring:", idSubstring);

      const contactData = {
        phone: extractedNumber,
        contact_name: (contactInfoMTDC.contactName || contactName || "").trim(),
        thread_id: threadID,
        custom_fields: {
          FullName: contactInfoMTDC.contactName || "[Not specified]",
          Company: contactInfoMTDC.company || "[Not specified]",
          "IC Number": contactInfoMTDC.ic || "[Not specified]",
          Email: contactInfoMTDC.email || "[Not specified]",
          "Program of Interest": program,
          "Program Date & Time": programDateTime,
        },
      };

      console.log("Final contactData:", JSON.stringify(contactData, null, 2));

      Object.keys(contactData.custom_fields).forEach((key) => {
        if (contactData.custom_fields[key] === undefined) {
          delete contactData.custom_fields[key];
        }
      });

      const checkResult = await sqlClient.query(
        "SELECT contact_id FROM public.contacts WHERE phone = $1 AND company_id = $2",
        [extractedNumber, idSubstring]
      );

      console.log(
        "Database check result:",
        checkResult.rows.length,
        "existing records found"
      );

      if (checkResult.rows.length > 0) {
        console.log("UPDATING existing contact");
        await sqlClient.query(
          `UPDATE public.contacts 
          SET contact_name = $1, 
              thread_id = $2, 
              custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $3::jsonb,
              last_updated = CURRENT_TIMESTAMP
          WHERE phone = $4 AND company_id = $5`,
          [
            contactData.contact_name,
            contactData.thread_id,
            JSON.stringify(contactData.custom_fields),
            contactData.phone,
            idSubstring,
          ]
        );
      } else {
        console.log("INSERTING new contact");
        const contactID =
          idSubstring +
          "-" +
          (extractedNumber.startsWith("+")
            ? extractedNumber.slice(1)
            : extractedNumber);

        await sqlClient.query(
          `INSERT INTO public.contacts 
          (contact_id, company_id, name, contact_name, phone, thread_id, custom_fields)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            contactID,
            idSubstring,
            contactData.contact_name,
            contactData.contact_name,
            contactData.phone,
            contactData.thread_id,
            JSON.stringify(contactData.custom_fields),
          ]
        );
      }

      await sqlClient.query("COMMIT");
      console.log("=== saveSpecialCaseMTDC SUCCESS ===");
    } catch (error) {
      await safeRollback(sqlClient);
      console.error("=== saveSpecialCaseMTDC ERROR ===");
      console.error("Error updating contact in PostgreSQL:", error);
      throw error;
    } finally {
      await safeRelease(sqlClient);
    }
  }
}

async function generateSpecialReport(
  threadID,
  assistantId,
  contactName,
  extractedNumber
) {
  try {
    var currentDate = new Date().toISOString().split("T")[0]; // Format: YYYY-MM-DD
    var reportInstruction = `Please generate a report in the following format based on our conversation:

New Form Has Been Submitted

Date : ${currentDate}
- Name: ${contactName}
- Phone Number: ${extractedNumber}
- Country: [Extract from conversation]
- Nationality: [Extract from conversation]
- Your highest educational qualification: [Extract from conversation]
- What program do you want to study: [Extract from conversation]
- Which intake you want to join: [Extract from conversation]
- Do you have any English proficiency certificate such as TOEFL / IELTS?: [Extract from conversation]
- Do you have a valid passport?: [Extract from conversation]

Fill in the information in square brackets with the relevant details from our conversation. If any information is not available, leave it blank. Do not change the Date field.`;

    var response = await openai.beta.threads.messages.create(threadID, {
      role: "user",
      content: reportInstruction,
    });

    var assistantResponse = await openai.beta.threads.runs.create(threadID, {
      assistant_id: assistantId,
    });

    // Wait for the assistant to complete the task
    let runStatus;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second
      runStatus = await openai.beta.threads.runs.retrieve(
        threadID,
        assistantResponse.id
      );
    } while (runStatus.status !== "completed");

    // Retrieve the assistant's response
    var messages = await openai.beta.threads.messages.list(threadID);
    var reportMessage = messages.data[0].content[0].text.value;

    var contactInfo = extractContactInfo(reportMessage);

    return { reportMessage, contactInfo };
  } catch (error) {
    console.error("Error generating special report:", error);
    return "Error generating report";
  }
}

async function generateSpecialReport2(
  threadID,
  assistantId,
  contactName,
  extractedNumber
) {
  try {
    var currentDate = new Date().toISOString().split("T")[0]; // Format: YYYY-MM-DD
    var reportInstruction = `Please generate a enquiry notification in the following format based on our conversation:

New Enquiry Has Been Submitted

Date : ${currentDate}
- Name: ${contactName}
- Phone Number: ${extractedNumber}
- Enquiry: [Extract from conversation]

Fill in the information in square brackets with the relevant details from our conversation. If any information is not available, leave it blank. Do not change the Date field.`;

    var response = await openai.beta.threads.messages.create(threadID, {
      role: "user",
      content: reportInstruction,
    });

    var assistantResponse = await openai.beta.threads.runs.create(threadID, {
      assistant_id: assistantId,
    });

    // Wait for the assistant to complete the task
    let runStatus;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second
      runStatus = await openai.beta.threads.runs.retrieve(
        threadID,
        assistantResponse.id
      );
    } while (runStatus.status !== "completed");

    // Retrieve the assistant's response
    var messages = await openai.beta.threads.messages.list(threadID);
    var reportMessage = messages.data[0].content[0].text.value;

    var contactInfo = extractContactInfo2(reportMessage);

    return { reportMessage, contactInfo };
  } catch (error) {
    console.error("Error generating special report:", error);
    return "Error generating report";
  }
}
function extractContactInfo(report) {
  var lines = report.split("\n");
  var contactInfo = {};

  for (var line of lines) {
    if (line.startsWith("- Name:")) {
      contactInfo.contactName = line.split(":")[1].trim();
    } else if (line.startsWith("- Country:")) {
      contactInfo.country = line.split(":")[1].trim();
    } else if (line.startsWith("- Nationality:")) {
      contactInfo.nationality = line.split(":")[1].trim();
    } else if (line.startsWith("- Your highest educational qualification:")) {
      contactInfo.highestEducation = line.split(":")[1].trim();
    } else if (line.startsWith("- What program do you want to study:")) {
      contactInfo.programOfStudy = line.split(":")[1].trim();
    } else if (line.startsWith("- Which intake you want to join:")) {
      contactInfo.intakePreference = line.split(":")[1].trim();
    } else if (
      line.startsWith("- Do you have any English proficiency certificate")
    ) {
      contactInfo.englishProficiency = line.split(":")[1].trim();
    } else if (line.startsWith("- Do you have a valid passport?:")) {
      contactInfo.passport = line.split(":")[1].trim();
    }
  }

  return contactInfo;
}

function extractContactInfo2(report) {
  var lines = report.split("\n");
  var contactInfo = {};

  for (var line of lines) {
    if (line.startsWith("- Name:")) {
      contactInfo.contactName = line.split(":")[1].trim();
    } else if (line.startsWith("- Enquiry:")) {
      contactInfo.enquiry = line.split(":")[1].trim();
    }
  }

  return contactInfo;
}

function extractContactInfoSKC(report) {
  var lines = report.split("\n");
  var contactInfoSKC = {};

  for (var line of lines) {
    if (line.startsWith("Name")) {
      contactInfoSKC.contactName = line.split(":")[1].trim();
    } else if (line.startsWith("Age")) {
      contactInfoSKC.age = line.split(":")[1].trim();
    } else if (line.startsWith("Highest Qualification")) {
      contactInfoSKC.highestQualification = line.split(":")[1].trim();
    } else if (line.startsWith("Years of Work Experience")) {
      contactInfoSKC.yearsOfWorkExperience = line.split(":")[1].trim();
    } else if (line.startsWith("Program of Interest")) {
      contactInfoSKC.programOfInterest = line.split(":")[1].trim();
    } else if (line.startsWith("Current Occupation")) {
      contactInfoSKC.currentOccupation = line.split(":")[1].trim();
    } else if (line.startsWith("Current Industry")) {
      contactInfoSKC.currentIndustry = line.split(":")[1].trim();
    }
  }

  return contactInfoSKC;
}

function extractContactInfoMTDC(report) {
  console.log("=== extractContactInfoMTDC DEBUG ===");
  console.log("Input report:", report);

  var lines = report.split("\n");
  var contactInfoMTDC = {
    programs: [],
    programDates: [],
  };

  for (var line of lines) {
    console.log("Processing line:", JSON.stringify(line));

    // Remove leading dash and space if present
    var cleanLine = line.replace(/^-\s*/, "").trim();
    console.log("Clean line:", JSON.stringify(cleanLine));

    if (cleanLine.startsWith("Name")) {
      const parts = cleanLine.split(":");
      console.log("Name parts:", parts);
      contactInfoMTDC.contactName = parts[1].trim();
      console.log("Found Name:", contactInfoMTDC.contactName);
    } else if (cleanLine.startsWith("Company")) {
      const parts = cleanLine.split(":");
      console.log("Company parts:", parts);
      contactInfoMTDC.company = parts[1].trim();
      console.log("Found Company:", contactInfoMTDC.company);
    } else if (cleanLine.startsWith("Email")) {
      const parts = cleanLine.split(":");
      console.log("Email parts:", parts);
      contactInfoMTDC.email = parts[1].trim();
      console.log("Found Email:", contactInfoMTDC.email);
    } else if (cleanLine.startsWith("Profession")) {
      const parts = cleanLine.split(":");
      console.log("Profession parts:", parts);
      contactInfoMTDC.profession = parts[1].trim();
      console.log("Found Profession:", contactInfoMTDC.profession);
    } else if (cleanLine.startsWith("Program of Interest")) {
      const parts = cleanLine.split(":");
      console.log("Program parts:", parts);
      contactInfoMTDC.programs.push(parts[1].trim());
      console.log("Found Program:", parts[1].trim());
    } else if (cleanLine.startsWith("Program Date & Time")) {
      const parts = cleanLine.split(":");
      console.log("Date parts:", parts);
      contactInfoMTDC.programDates.push(parts[1].trim());
      console.log("Found Date:", parts[1].trim());
    }
  }

  console.log(
    "Final extracted data:",
    JSON.stringify(contactInfoMTDC, null, 2)
  );
  console.log("=== extractContactInfoMTDC END ===");

  return contactInfoMTDC;
}

function extractContactInfoLKSSB(report) {
  var lines = report.split("\n");
  var contactInfoLKSSB = {};

  for (var line of lines) {
    if (line.startsWith("Name")) {
      contactInfoLKSSB.contactName = line.split(":")[1].trim();
    } else if (line.startsWith("Company Name")) {
      contactInfoLKSSB.companyName = line.split(":")[1].trim();
    } else if (line.startsWith("Company Address")) {
      contactInfoLKSSB.companyAddress = line.split(":")[1].trim();
    } else if (line.startsWith("Length Of Construction")) {
      contactInfoLKSSB.lengthOfConstruction = line.split(":")[1].trim();
    } else if (line.startsWith("Height Of Construction")) {
      contactInfoLKSSB.heightOfConstruction = line.split(":")[1].trim();
    } else if (line.startsWith("Location")) {
      contactInfoLKSSB.location = line.split(":")[1].trim();
    }
  }

  return contactInfoLKSSB;
}

function extractContactInfoBINA(report) {
  var lines = report.split("\n");
  var contactInfoBINA = {};

  for (var line of lines) {
    if (line.startsWith("Name")) {
      contactInfoBINA.contactName = line.split(":")[1].trim();
    } else if (line.startsWith("PHONE NUMBER")) {
      contactInfoBINA.phone = line.split(":")[1].trim();
    } else if (line.startsWith("Address")) {
      contactInfoBINA.address = line.split(":")[1].trim();
    } else if (line.startsWith("Email")) {
      contactInfoBINA.email = line.split(":")[1].trim();
    } else if (line.startsWith("Availability")) {
      contactInfoBINA.availability = line.split(":")[1].trim();
    } else if (line.startsWith("Issue")) {
      contactInfoBINA.issue = line.split(":")[1].trim();
    } else if (line.startsWith("Photos/Video")) {
      contactInfoBINA.photosVideo = line.split(":")[1].trim();
    } else if (line.startsWith("How Many Floor")) {
      contactInfoBINA.howManyFloor = line.split(":")[1].trim();
    } else if (line.startsWith("Roof Tile/Slab")) {
      contactInfoBINA.roofTileSlab = line.split(":")[1].trim();
    }
  }

  return contactInfoBINA;
}

async function updateSpreadsheetData(msg, idSubstring) {
  try {
    const skcSpreadsheet = new SKCSpreadsheet(idSubstring);
    // This will automatically find the correct row based on sender's phone number
    // and update the appropriate column
    await skcSpreadsheet.processIncomingMessage(msg);
  } catch (error) {
    console.error("Error updating spreadsheet:", error);
  }
}

async function processIncomingBookingCarCare(
  msg,
  idSubstring,
  staffPhone,
  client
) {
  try {
    const carCareSpreadsheet = new CarCareSpreadsheet();
    await carCareSpreadsheet.handleIncomingMessage(msg, staffPhone, client);
  } catch (error) {
    console.error("Error processing incoming booking care:", error);
  }
}

async function handleImageMessage(
  msg,
  sender,
  threadID,
  client,
  idSubstring,
  extractedNumber,
  phoneIndex
) {
  try {
    const media = await msg.downloadMedia();

    // Create a message with the image for the assistant
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: msg.caption || "What is in this image?",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${media.mimetype};base64,${media.data}`,
              },
            },
          ],
        },
      ],
      max_tokens: 300,
    });

    // Get the response text
    const answer = response.choices[0].message.content;

    return answer;
  } catch (error) {
    console.error("Error in image processing:", error);
    return "error processing image";
  }
}

async function handlePDFMessage(
  msg,
  sender,
  threadID,
  client,
  idSubstring,
  extractedNumber
) {
  const tempDir = path.join(os.tmpdir(), `pdf_process_${uuidv4()}`);
  console.log(`[PDF] Creating temp directory: ${tempDir}`);
  await fs.promises.mkdir(tempDir, { recursive: true });

  const tempPdfPath = path.join(tempDir, `input.pdf`);
  console.log(`[PDF] Temp PDF path: ${tempPdfPath}`);

  try {
    console.log("[PDF] Downloading media...");
    const media = await msg.downloadMedia();
    console.log("[PDF] Media downloaded.");

    const buffer = Buffer.from(media.data, "base64");
    console.log(
      `[PDF] Converted media to buffer. Buffer length: ${buffer.length}`
    );

    await fs.promises.writeFile(tempPdfPath, buffer);
    console.log("[PDF] Buffer written to temp PDF file.");

    // Convert first 3 pages to PNG using ConvertAPI SDK
    let allPagesAnalysis = [];
    const pagesToProcess = [1, 2, 3];
    for (let i = 0; i < pagesToProcess.length; i++) {
      const pageNum = pagesToProcess[i];
      console.log(`[PDF] Converting page ${pageNum} to PNG with ConvertAPI...`);

      try {
        const result = await convertapi.convert(
          "png",
          {
            File: tempPdfPath,
            PageRange: `${pageNum}-${pageNum}`,
          },
          "pdf"
        );

        if (result && result.files && result.files.length > 0) {
          const imageUrl = result.files[0].url;
          console.log(`[PDF] Got PNG URL for page ${pageNum}: ${imageUrl}`);

          // Download the image as buffer
          const imageResp = await axios.get(imageUrl, {
            responseType: "arraybuffer",
          });
          const imageBuffer = Buffer.from(imageResp.data);

          // Check if buffer is a valid PNG
          if (imageBuffer.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") {
            console.error(
              `[PDF] Page ${pageNum} is not a valid PNG. Skipping.`
            );
            allPagesAnalysis.push(
              `Page ${pageNum}: [Error: Could not convert to valid PNG image]`
            );
            continue;
          }

          const base64Image = imageBuffer.toString("base64");
          console.log(`[PDF] Converted page ${pageNum} image to base64.`);

          // Analyze image using OpenAI
          try {
            console.log(
              `[PDF] Sending page ${pageNum} image to OpenAI for analysis...`
            );
            const aiResponse = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: "What is the content of this PDF page?",
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/png;base64,${base64Image}`,
                      },
                    },
                  ],
                },
              ],
              max_tokens: 300,
            });

            const pageAnalysis = aiResponse.choices[0].message.content;
            console.log(`[PDF] Analysis for page ${pageNum}: ${pageAnalysis}`);
            allPagesAnalysis.push(`Page ${pageNum}: ${pageAnalysis}`);
          } catch (err) {
            console.error(
              `[PDF] OpenAI error for page ${pageNum}: ${err.message}\n${err.stack}`
            );
            allPagesAnalysis.push(
              `Page ${pageNum}: [Error: OpenAI could not process image]`
            );
          }
        } else {
          console.error(`[PDF] No PNG returned for page ${pageNum}.`);
          allPagesAnalysis.push(
            `Page ${pageNum}: [Error: No PNG returned from ConvertAPI]`
          );
        }
      } catch (err) {
        // FIX: Avoid circular structure error
        if (err.response) {
          console.error(
            `[PDF] ConvertAPI error for page ${pageNum}: ${err.message} - Response:`,
            err.response.data
          );
        } else {
          console.error(
            `[PDF] ConvertAPI error for page ${pageNum}: ${err.message}\n${err.stack}`
          );
        }
        allPagesAnalysis.push(
          `Page ${pageNum}: [Error: ConvertAPI failed for this page]`
        );
      }
    }

    const combinedAnalysis = allPagesAnalysis.join("\n\n");
    console.log("[PDF] Combined PDF analysis:", combinedAnalysis);

    return `[PDF Content Analysis: ${combinedAnalysis}]`;
  } catch (error) {
    console.error("[PDF] Error processing PDF:", error);
    return "[Error: Unable to process PDF document]";
  } finally {
    try {
      console.log(`[PDF] Cleaning up temp directory: ${tempDir}`);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      console.log("[PDF] Temp directory cleaned up.");
    } catch (error) {
      console.error("[PDF] Error cleaning up temporary files:", error);
    }
  }
}

async function handlePDFMessagePoppler(
  msg,
  sender,
  threadID,
  client,
  idSubstring,
  extractedNumber,
  phoneIndex
) {
  let tempPdfPath = null;
  let tempDir = "./temp";
  let outputPrefix = null;

  try {
    console.log("[PDF] Starting PDF document processing with Poppler...");
    const media = await msg.downloadMedia();
    console.log("[PDF] Media downloaded, size:", media.data.length);

    // Convert base64 to buffer
    const buffer = Buffer.from(media.data, "base64");
    console.log("[PDF] Buffer created, length:", buffer.length);

    // Create temp directory if it doesn't exist
    try {
      await fs.promises.access(tempDir);
    } catch {
      await fs.promises.mkdir(tempDir, { recursive: true });
    }

    // Save buffer to temporary PDF file
    tempPdfPath = path.join(tempDir, `temp_pdf_${Date.now()}.pdf`);
    await fs.promises.writeFile(tempPdfPath, buffer);
    console.log("[PDF] Temporary PDF file created:", tempPdfPath);

    // Use pdf-parse to get number of pages
    const pdfData = await pdf(buffer);
    const pageCount = pdfData.numpages;
    console.log(`[PDF] PDF parsed, total pages: ${pageCount}`);

    // Initialize Poppler
    const poppler = new Poppler();
    outputPrefix = path.join(tempDir, `pdf_page_${Date.now()}`);

    // Convert PDF to images using Poppler
    const options = {
      firstPageToConvert: 1,
      lastPageToConvert: Math.min(pageCount, 3),
      pngFile: true,
      resolutionXYAxis: 300, // 300 DPI for both X and Y
      scalePageTo: 2480, // Scale long side to 2480 pixels (A4 width at 300 DPI)
    };

    console.log("[PDF] Converting PDF to images with Poppler...");
    await poppler.pdfToCairo(tempPdfPath, outputPrefix, options);
    console.log("[PDF] PDF converted to images successfully");

    let allPagesAnalysis = [];
    const pagesToProcess = Math.min(pageCount, 3);

    for (let i = 1; i <= pagesToProcess; i++) {
      console.log(`[PDF] Processing page ${i} of ${pagesToProcess}...`);

      // Try different naming patterns that poppler might use
      let imagePath = `${outputPrefix}-${i}.png`;

      // Check if image file exists
      try {
        await fs.promises.access(imagePath);
      } catch {
        console.log(
          `[PDF] Image for page ${i} not found, trying alternative naming...`
        );
        // Try alternative naming patterns
        const altPaths = [
          `${outputPrefix}_${i}.png`,
          `${outputPrefix}-${String(i).padStart(3, "0")}.png`,
          `${outputPrefix}${i}.png`,
        ];

        let found = false;
        for (const altPath of altPaths) {
          try {
            await fs.promises.access(altPath);
            imagePath = altPath;
            found = true;
            break;
          } catch {
            // Continue trying
          }
        }

        if (!found) {
          console.error(`[PDF] Could not find converted image for page ${i}`);
          continue; // Skip this page but continue with others
        }
      }

      console.log(`[PDF] Page ${i} image found: ${imagePath}`);

      // Convert image to base64
      const imageBuffer = await fs.promises.readFile(imagePath);
      const base64Image = imageBuffer.toString("base64");
      console.log(
        `[PDF] Page ${i} image loaded, base64 length: ${base64Image.length}`
      );

      // Analyze image using GPT-4-mini with company-specific extraction
      console.log(`[PDF] Sending page ${i} to OpenAI for analysis...`);
      
      // Special prompt for Job Builder (765943) resume extraction
      let extractionPrompt;
      if (idSubstring === "765943") {
        extractionPrompt = `You are analyzing a RESUME/CV document. Extract ALL information with EXTREME ACCURACY, paying special attention to:

**CRITICAL FIELDS (Job Builder Resume):**
1. **Email Address:** 
   - Extract the COMPLETE email address with 100% accuracy
   - Format: username@domain.com
   - Double-check EVERY CHARACTER (no typos allowed)
   - Look in header, contact section, or anywhere on the page
   - Example: john.doe@gmail.com, johndoe123@yahoo.com

2. **Full Name:**
   - Extract complete first name and last name
   - Include middle name if present

3. **Phone Number:**
   - Include country code and full number
   - Format: +60123456789 or similar

4. **Skills (VERY IMPORTANT):**
   - List ALL technical skills mentioned (programming languages, frameworks, tools, software)
   - List ALL soft skills (communication, leadership, teamwork, etc.)
   - Format as a comma-separated list
   - Examples: "Full Stack Developer, Web Developer, React Developer, Frontend Developer"
   - Or: "JavaScript, Python, React, Node.js, HTML, CSS, SQL, Git"

5. **Work Experience/Employment History (VERY IMPORTANT):**
   - Extract EVERY job position with:
     * Job Title / Position
     * Company Name
     * Duration (start date - end date or "Present")
     * Key responsibilities and achievements (bullet points)
   - Format clearly for each position
   - Example format:
     Position: Senior Developer
     Company: ABC Tech Sdn Bhd
     Duration: Jan 2020 - Present
     Responsibilities: Led team of 5, developed web applications, etc.

6. **Education:**
   - Degrees, certifications, schools attended
   - Graduation years

7. **Summary/Profile:**
   - Professional summary or career objective if present

**OUTPUT FORMAT:**
Organize the extracted data with clear section headers:

EMAIL: [exact email address]
FULL NAME: [complete name]
PHONE: [full phone number]

SKILLS:
[List all skills found - technical and soft skills]

WORK EXPERIENCE:
[Each position with company, title, duration, responsibilities]

EDUCATION:
[Degrees and schools]

PROFILE/SUMMARY:
[Career objective or professional summary if present]

Be thorough and accurate. If any field is not found on this page, write "Not found on this page".`;
      } else {
        extractionPrompt = `Please extract and analyze ALL text and data from this PDF page with high accuracy. Focus on:

1. **Contact Information:**
   - Full names (first and last names)
   - Email addresses (be very careful with accuracy - double check each character)
   - Phone numbers (including country codes and formatting)
   - Addresses (complete street addresses, cities, states, postal codes)
   - Company names and job titles

2. **Form Data:**
   - Any form fields and their values
   - Checkboxes, radio buttons, and their selections
   - Dates (in any format)
   - ID numbers, reference numbers, or codes

3. **Document Content:**
   - Headers, titles, and section names
   - Body text and paragraphs
   - Tables and their data (preserve structure)
   - Lists and bullet points
   - Any signatures or handwritten text

4. **Financial/Numerical Data:**
   - Amounts, prices, quantities
   - Account numbers, invoice numbers
   - Percentages and calculations

Provide the extracted information in a structured format with clear labels. Be especially careful with email addresses - verify each character and ensure proper formatting (name@domain.com). If uncertain about any character in an email, mention the uncertainty.

Also describe what type of document this appears to be (form, invoice, letter, etc.).`;
      }
      
      const response = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: extractionPrompt,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      });

      // Add page analysis to results
      const pageAnalysis = response.choices[0].message.content;
      console.log(
        `[PDF] Page ${i} analysis received, length: ${pageAnalysis.length}`
      );
      allPagesAnalysis.push(`Page ${i}: ${pageAnalysis}`);

      // Clean up temporary image file
      try {
        await fs.promises.unlink(imagePath);
        console.log(`[PDF] Page ${i} temporary image deleted.`);
      } catch (err) {
        console.error(`[PDF] Error deleting temp image for page ${i}:`, err);
      }
    }

    if (allPagesAnalysis.length === 0) {
      throw new Error("No pages were successfully processed");
    }

    // Combine analysis from all pages
    const combinedAnalysis = allPagesAnalysis.join("\n\n");
    console.log("[PDF] Combined analysis completed");

    return `[PDF Content Analysis: ${combinedAnalysis}]`;
  } catch (error) {
    console.error("[PDF] Error processing PDF:", error);
    if (error && typeof error === "object") {
      Object.entries(error).forEach(([key, value]) => {
        console.log(`[PDF] Error detail: ${key}: ${value}`);
      });
    }
    return "[Error: Unable to process PDF document]";
  } finally {
    // Clean up temporary files
    try {
      // Delete PDF file
      if (tempPdfPath) {
        try {
          await fs.promises.unlink(tempPdfPath);
          console.log("[PDF] Temporary PDF file deleted.");
        } catch (error) {
          console.error("[PDF] Error deleting PDF file:", error);
        }
      }

      // Clean up any remaining image files
      try {
        const files = await fs.promises.readdir(tempDir);
        for (const file of files) {
          if (file.includes("pdf_page_") && file.endsWith(".png")) {
            try {
              await fs.promises.unlink(path.join(tempDir, file));
            } catch (error) {
              console.error(`[PDF] Error deleting image file ${file}:`, error);
            }
          }
        }
        console.log("[PDF] Temporary image files cleaned up.");
      } catch (error) {
        console.error("[PDF] Error reading temp directory:", error);
      }
    } catch (error) {
      console.error("[PDF] Error in cleanup:", error);
    }
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
    await safeRollback(sqlClient);
    console.error("Error fetching follow-up templates:", error);
    throw error;
  } finally {
    await safeRelease(sqlClient);
  }
}

async function getAIAssignResponses(companyId) {
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
      const assignedEmployees = row.assigned_employees || [];
      if (assignedEmployees.length === 0) {
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

function formatPhoneNumber(phoneNumber) {
  // Remove all non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, "");

  // Remove the leading '60' if present
  if (cleaned.startsWith("60")) {
    cleaned = cleaned.slice(2);
  }

  // Ensure the number starts with '+60'
  cleaned = "+60" + cleaned;

  return cleaned;
}

function extractAppointmentInfo(messageBody) {
  const lines = messageBody.split("\n");
  const info = {};

  lines.forEach((line) => {
    if (line.includes("Date:")) info.date = line.split("Date:")[1].trim();
    if (line.includes("Time:")) info.time = line.split("Time:")[1].trim();
    if (line.includes("Senior Inspector:"))
      info.inspectorName = line.split("Senior Inspector:")[1].trim();
    if (line.includes("Contact Direct:"))
      info.inspectorPhone = line
        .split("Contact Direct:")[1]
        .trim()
        .replace("wa.me/", "");
    if (line.includes("Vehicle No Plate:"))
      info.vehiclePlate = line.split("Vehicle No Plate:")[1].trim();
    if (line.includes("Client:"))
      info.clientName = line.split("Client:")[1].trim();
    if (line.includes("Contact:"))
      info.clientPhone = line.split("Contact:")[1].trim().replace("wa.me/", "");
    if (line.includes("Site Add:")) {
      info.siteAddress = line.split("Site Add:")[1].trim();
      // Capture multi-line address
      let i = lines.indexOf(line) + 1;
      while (i < lines.length && !lines[i].includes("Email")) {
        info.siteAddress += " " + lines[i].trim();
        i++;
      }
    }
  });

  return info;
}

async function addAppointmentToSpreadsheet(appointmentInfo) {
  const spreadsheetId = "1sQRyU0nTuUSnVWOJ44SAyWJXC0a_PbubttpRR_l0Uco";
  const sheetName = "08.2024";
  const range = `${sheetName}!A:S`; // Expanded range to include all columns

  const auth = new google.auth.GoogleAuth({
    keyFile: "./service_account.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const values = [
    [
      "", // No. (auto-increment in spreadsheet)
      appointmentInfo.date,
      appointmentInfo.time,
      appointmentInfo.clientPhone,
      appointmentInfo.clientName,
      "", // Assuming the client is always the owner
      appointmentInfo.siteAddress,
      "", // Waze link (can be added later if available)
      "", // Email (can be added later if available)
      appointmentInfo.issue || "", // If you have this information
      "", // WhatsApp group (can be filled later)
      "", // 9x9 Pictures
      "", // Hand written quotation
      "", // Draft quotation photos
      "", // Typed draft quotation
      "", // sent
      "", // detailed quotation
      "", // sent
      "", // payment
    ],
  ];

  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: { values },
    });

    console.log(`${response.data.updates.updatedCells} cells appended.`);
  } catch (error) {
    console.error("Error adding appointment to spreadsheet:", error);
  }
}

async function handleConfirmedAppointment(client, msg, idSubstring) {
  console.log("Starting handleConfirmedAppointment...");
  // Only proceed if this is for BINA (companyId 002)
  if (idSubstring !== "002") {
    console.log("Not BINA company, returning...");
    return;
  }

  try {
    // Format the author's number
    const authorNumber = msg.author ? msg.author.replace(/\D/g, "") : "";
    console.log("Author number:", authorNumber);

    // Define participant groups based on who confirms
    const PARTICIPANT_GROUPS = {
      "601111393111@c.us": [
        // Kelvern's group
        "601111393111@c.us", // Kelvern himself
        "601131419439@c.us", // Ms Wong
        "60193668776@c.us", // Mr Francis
        "60186688766@c.us", // Ms Sheue Lih
      ],
      "60193176876@c.us": [
        // Eric's group
        "60193176876@c.us", // Eric himself
        "601111393111@c.us", // Mr Kelvern
        "601131419439@c.us", // Ms Wong
        "60193668776@c.us", // Mr Francis
        "60186688766@c.us", // Ms Sheue Lih
      ],
      "60133394339@c.us": [
        // Emil's group
        "60133394339@c.us", // Emil himself
        "601111393111@c.us", // Mr Kelvern
        "601131419439@c.us", // Ms Wong
        "60193668776@c.us", // Mr Francis
        "60186688766@c.us", // Ms Sheue Lih
      ],
      "601121677672@c.us": [
        // Faeez's group
        "601121677672@c.us", // Emil himself
        "60122162143@c.us", // Mr Kelvern
      ],
    };

    // Extract information from the message
    console.log("Extracting appointment info from message:", msg.body);
    const appointmentInfo = extractAppointmentInfo(msg.body);
    console.log("Extracted appointment info:", appointmentInfo);

    if (!appointmentInfo.clientPhone || !appointmentInfo.clientName) {
      console.error("Missing required client information");
      return;
    }

    await addAppointmentToSpreadsheet(appointmentInfo);

    // Format the client's phone number
    let clientPhone = appointmentInfo.clientPhone;
    console.log("Original client phone:", clientPhone);

    // Clean up the phone number
    if (clientPhone.includes("wa.me/")) {
      clientPhone = clientPhone.replace("wa.me/", "");
    }

    // Remove any spaces, dashes, or other non-digit characters
    clientPhone = clientPhone.replace(/\D/g, "");

    // If the number starts with '0', replace it with '60'
    if (clientPhone.startsWith("0")) {
      clientPhone = "60" + clientPhone.substring(1);
    } else if (!clientPhone.startsWith("60")) {
      // If it doesn't start with '60' or '0', add '60'
      clientPhone = "60" + clientPhone;
    }

    console.log("Formatted client phone:", clientPhone);

    // Get the correct participant group or use a default group
    const baseParticipants =
      PARTICIPANT_GROUPS[authorNumber] || PARTICIPANT_GROUPS["601111393111"];
    const participants = [`${clientPhone}@c.us`, ...baseParticipants];

    // Create a new group
    const groupTitle = `${clientPhone} ${appointmentInfo.clientName}`;

    console.log("Attempting to create group with:", {
      title: groupTitle,
      participants: participants,
      confirmedBy: authorNumber,
    });

    try {
      const result = await client.createGroup(groupTitle, participants);
      console.log("Group created successfully:", result);

      let initialMessage = "";
      let finalMessage = "";
      console.log("Detected language:", appointmentInfo.language);

      await addContactToPostgres(
        result.gid._serialized,
        groupTitle,
        idSubstring
      );

      if (appointmentInfo.language == "BM") {
        initialMessage = `Hi En/Pn👋, Saya Mr Kelvern (wa.me/601111393111) 
\ndari BINA Pasifik Sdn Bhd (Nombor Pejabat: 03-2770 9111)
\nSaya telah menjalankan pemeriksaan tapak di rumah anda hari itu.
\nKumpulan ini diwujudkan khusus untuk menguruskan kes bumbung rumah anda.

\n\nBerikut adalah jabatan-jabatan dari Group BINA:

\n\n1️⃣ Operation/Work Arrangement (Ms Sheue Lih - 018-668 8766)
\n2️⃣ Manager (Mr Lim - 019-386 8776)

\n\nFungsi kumpulan ini adalah untuk:

\n\n- Menghantar quotation, invois, resi, dan sijil waranti
\n- Mengatur jadual kerja
\n- Berikan gambar update tentang kemajuan kerja

\n\nJika anda mempunyai sebarang confirmation, slip bank, maklum balas atau aduan, sila sampaikan di dalam kumpulan ini.

\n\n⬇️Facebook Kami⬇️
\nhttps://www.facebook.com/BINApasifik

\n\n⬇️Website Kami⬇️
\nwww.BINApasifik.com

\n\nKami komited untuk memberikan perkhidmatan terbaik kepada anda. 😃`;
        finalMessage = `Quotation akan send dalam group ini dalam 3 hingga 5 waktu kerja ya 👍`;
      } else if (appointmentInfo.language == "CN") {
        initialMessage = `
您好 👋, 我是 Mr Kelvern (wa.me/601111393111) ，
\n来自 BINA Pasifik Sdn Bhd (办公室电话: 03-2770 9111)
\n那天进行了您家的现场检查。
\n这个群组是专门为管理您家的屋顶案件而创建的。

\n\n以下是我们 BINA 团队的部门联系方式：

\n\n1️⃣ 运营/安排：Ms. Sheue Lih - 018-668 8766
\n2️⃣ Manager：Mr Lim - 019-366 8776

\n\n此群组的功能是：
\n- 发送报价单、收据和保修证书, 安排工作日程
\n- 发送照片的工作现况

\n\n如果您有任何 确认、银行单据 或 反馈/投诉，也可以在这个群组里发言。

\n\n⬇️面子书｜Facebook⬇️
\nhttps://www.facebook.com/BINApasifik

\n\n⬇️网站｜Website⬇️ 
\nwww.BINApasifik.com

\n\n我们致力于为您提供最好的服务。😃`;
        finalMessage = `你的报价会在 3 至 5 天的工作日发送到这个群组里 👌`;
      } else {
        initialMessage = `Hi 👋, Im Mr Kelvern(wa.me/601111393111)
\nfrom BINA Pasifik Sdn Bhd (Office No: 03-2770 9111)
\nAnd I've conducted the site inspection at your house that day.
\nThis group has been created specifically to manage your house roofing case.

\n\nBelow is our BINA group's department personnel:

\n\n1. Operation/ Job Arrangement (Ms Sheue Lih - 60186688766)
\n2. Manager (Mr Lim - 60193868776)

\n\nThe functions of this group are to provide:
\n* Quotations, Invoices, Receipts, Warranty Certificate & Job arrangement

\n\n* Send pictures of job updates from time to time

\n\n* Or if you have any confirmation/bank slip or feedbacks/complaints you may speak out in this group also

\n\n⬇Our Facebook page⬇
\nhttps://www.facebook.com/BINApasifik

\n\n⬇Our Website⬇
\nwww.BINApasifik.com

\n\nWe are committed to providing you with our very best services 😃

\n\nThank you.`;
        finalMessage = `Your detail quotation will be prepared and sent out to this group in 3 to 5 working days ya 👌`;
      }

      console.log("Sending initial message to group...");
      const message = await client.sendMessage(
        result.gid._serialized,
        initialMessage
      );
      await addMessageToPostgres(
        message,
        idSubstring,
        "+" + result.gid._serialized.split("@")[0],
        groupTitle
      );

      const documentUrl =
        "https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/kelven.jpg?alt=media&token=baef675f-43e3-4f56-b2ba-19db0a6ddbf5";
      const media = await MessageMedia.fromUrl(documentUrl);
      const documentMessage = await client.sendMessage(
        result.gid._serialized,
        media
      );
      await addMessageToPostgres(
        documentMessage,
        idSubstring,
        "+" + result.gid._serialized.split("@")[0],
        groupTitle
      );

      const documentUrl2 = `https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Your%20Roofing's%20Doctor.pdf?alt=media&token=7c72f8e4-72cd-4da1-bb3d-387ffeb8ab91`;
      const media2 = await MessageMedia.fromUrl(documentUrl2);
      media2.filename = "Your Roofing's Doctor.pdf";
      const documentMessage2 = await client.sendMessage(
        result.gid._serialized,
        media2
      );

      const message2 = await client.sendMessage(
        result.gid._serialized,
        finalMessage
      );
      await addMessageToPostgres(
        message2,
        idSubstring,
        "+" + result.gid._serialized.split("@")[0],
        groupTitle
      );
    } catch (groupError) {
      console.error("Error creating WhatsApp group:", groupError);
      console.error("Full group error stack:", groupError.stack);
      throw groupError;
    }
  } catch (error) {
    console.error("Error in handleConfirmedAppointment:", error);
    console.error("Full error stack:", error.stack);
  }
}

function extractAppointmentInfo(messageBody) {
  console.log("Starting to extract info from message:", messageBody);
  const lines = messageBody.split("\n");
  const info = {};

  try {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Extract date
      if (line.includes("Date:")) {
        info.date = line.split("Date:")[1].trim().replace(/\*/g, "");
        console.log("Extracted date:", info.date);
      }

      // Extract time
      if (line.includes("Time:")) {
        info.time = line.split("Time:")[1].trim().replace(/\*/g, "");
        console.log("Extracted time:", info.time);
      }

      // Extract inspector name
      if (line.includes("Senior Inspector:")) {
        info.inspectorName = line
          .split("Senior Inspector:")[1]
          .trim()
          .replace(/\*/g, "");
        console.log("Extracted inspector:", info.inspectorName);
      }

      // Extract inspector phone
      if (line.includes("Contact Direct:")) {
        info.inspectorPhone = line
          .split("Contact Direct:")[1]
          .trim()
          .replace("wa.me/", "")
          .replace(/\*/g, "");
        console.log("Extracted inspector phone:", info.inspectorPhone);
      }

      // Extract client name
      if (line.includes("Client:")) {
        info.clientName = line
          .split("Client:")[1]
          .trim()
          .replace(/\(Owner\)/g, "")
          .replace(/\*/g, "")
          .trim();
        console.log("Extracted client name:", info.clientName);
      }

      // Extract client phone
      if (line.includes("Contact:") && !line.includes("Contact Direct:")) {
        info.clientPhone = line
          .split("Contact:")[1]
          .trim()
          .replace("wa.me/", "")
          .replace(/\*/g, "");
        console.log("Extracted client phone:", info.clientPhone);
      }

      // Extract site address
      if (line.includes("Site Add:")) {
        info.siteAddress = line.split("Site Add:")[1].trim().replace(/\*/g, "");
        console.log("Extracted address:", info.siteAddress);
      }

      // Extract language
      if (line.includes("Language:")) {
        info.language = line.split("Language:")[1].trim().replace(/\*/g, "");
        console.log("Extracted language:", info.language);
      }

      // Extract email
      if (line.includes("Email:")) {
        info.email = line.split("Email:")[1].trim().replace(/\*/g, "");
        console.log("Extracted email:", info.email);
      }
    }

    // Validate required fields
    if (!info.clientName || !info.clientPhone) {
      throw new Error("Missing required client information");
    }

    console.log("Final extracted info:", info);
    return info;
  } catch (error) {
    console.error("Error extracting appointment info:", error);
    console.error("Message body was:", messageBody);
    throw error;
  }
}

async function addContactToPostgres(groupId, groupTitle, idSubstring) {
  if (idSubstring !== "002") return;

  const extractedNumber = groupId.split("@")[0];
  const contactID =
    idSubstring +
    "-" +
    (extractedNumber.startsWith("+")
      ? extractedNumber.slice(1)
      : extractedNumber);

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const checkQuery = `
      SELECT id FROM public.contacts 
      WHERE contact_id = $1 AND company_id = $2
    `;

    const checkResult = await sqlClient.query(checkQuery, [
      extractedNumber,
      idSubstring,
    ]);

    if (checkResult.rows.length === 0) {
      const insertQuery = `
        INSERT INTO public.contacts (
          contact_id, 
          company_id, 
          name, 
          contact_name, 
          phone, 
          tags, 
          is_group,
          chat_data,
          unread_count,
          last_message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,)
      `;

      const chatData = {
        contact_id:
          idSubstring +
          "-" +
          (extractedNumber.startsWith("+")
            ? extractedNumber.slice(1)
            : extractedNumber),
        id: groupId,
        name: groupTitle,
        not_spam: true,
        tags: [""],
        timestamp: new Date(),
        type: "group",
      };

      const lastMessage = {
        chat_id: groupId,
        from: groupId,
        from_me: true,
        id: "",
        source: "",
        status: "",
        text: { body: "" },
        timestamp: new Date(),
        type: "text",
        phoneIndex: 0,
      };

      const insertValues = [
        contactID,
        idSubstring,
        groupTitle,
        groupTitle,
        extractedNumber,
        JSON.stringify([""]),
        true,
        JSON.stringify(chatData),
        0,
        JSON.stringify(lastMessage),
      ];

      await sqlClient.query(insertQuery, insertValues);
      console.log("Group added to PostgreSQL:", groupId);
    } else {
      // Contact exists, update it
      const updateQuery = `
        UPDATE public.contacts 
        SET 
          name = $1,
          contact_name = $2,
          is_group = true,
          thread_id = $3,
          chat_data = $4,
          unread_count = 0,
          last_message = $5,
          last_updated = CURRENT_TIMESTAMP
        WHERE contact_id = $6 AND company_id = $7
      `;

      const chatData = {
        contact_id:
          idSubstring +
          "-" +
          (extractedNumber.startsWith("+")
            ? extractedNumber.slice(1)
            : extractedNumber),
        id: groupId,
        name: groupTitle,
        not_spam: true,
        tags: [""],
        timestamp: new Date(),
        type: "group",
      };

      const lastMessage = {
        chat_id: groupId,
        from: groupId,
        from_me: true,
        id: "",
        source: "",
        status: "",
        text: { body: "" },
        timestamp: new Date(),
        type: "text",
        phoneIndex: 0,
      };

      const updateValues = [
        groupTitle,
        groupTitle,
        groupId,
        JSON.stringify(chatData),
        JSON.stringify(lastMessage),
        contactID,
        idSubstring,
      ];

      await sqlClient.query(updateQuery, updateValues);
      console.log("Group updated in PostgreSQL:", groupId);
    }

    await sqlClient.query("COMMIT");
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error adding/updating group in PostgreSQL:", error);
  } finally {
    await safeRelease(sqlClient);
  }
}

async function listContactsWithTag(idSubstring, tag, limit = 10) {
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const lowercaseSearchTag = tag.toLowerCase();

    const query = `
      SELECT 
      phone AS "phoneNumber",
      name AS "contactName",
        tags
      FROM 
        public.contacts
      WHERE 
        company_id = $1 AND
      EXISTS (
        SELECT 1 FROM jsonb_array_elements(tags) AS tag
        WHERE (
        (jsonb_typeof(tag) = 'string' AND lower(tag::text) LIKE '%' || $2 || '%')
        )
        )
      LIMIT $3
    `;

    const result = await sqlClient.query(query, [
      idSubstring,
      lowercaseSearchTag,
      limit,
    ]);

    await sqlClient.query("COMMIT");

    const contacts = result.rows.map((row) => ({
      phoneNumber: row.phoneNumber,
      contactName: row.contactName,
      tags: row.tags,
    }));

    return JSON.stringify(contacts);
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error listing contacts with tag:", error);
    return JSON.stringify({ error: "Failed to list contacts with tag" });
  } finally {
    await safeRelease(sqlClient);
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
          mediaData.link = await storeMediaData(
            media.data,
            mediaData.filename,
            media.mimetype
          );
          delete mediaData.data;
        }
        break;
      case "document":
        mediaData.page_count = msg._data.pageCount;
        mediaData.file_size = msg._data.size;
        if (fileSizeMB > FILE_SIZE_LIMIT_MB) {
          mediaData.link = await storeMediaData(
            media.data,
            mediaData.filename,
            media.mimetype
          );
          delete mediaData.data;
        }
        break;
      case "video":
        mediaData.link = await storeMediaData(
          media.data,
          mediaData.filename,
          media.mimetype
        );
        delete mediaData.data;
        break;
      default:
        if (fileSizeMB > FILE_SIZE_LIMIT_MB) {
          mediaData.link = await storeMediaData(
            media.data,
            mediaData.filename,
            media.mimetype
          );
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

async function testDailyReminders(client, idSubstring) {
  console.log("Testing daily reminders...");

  // Send the contact report
  await sendDailyContactReport(client, idSubstring);

  // Send the task reminder
  await sendDailyTaskReminder(client, idSubstring);

  return JSON.stringify({
    message: "Daily reminders sent successfully for testing.",
  });
}

async function createThread() {
  console.log("Creating a new thread...");
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

async function checkAvailableTimeSlots(
  idSubstring,
  specificDate = null,
  contact,
  client
) {
  // Get current date and time in KL timezone
  const now = moment().tz("Asia/Kuala_Lumpur");
  const today = now.clone().startOf("day");
  const availableSlots = [];

  console.log(
    `Current date and time (KL): ${now.format("dddd, YYYY-MM-DD HH:mm:ss")}`
  );

  console.log("\n=== Starting checkAvailableTimeSlots ===");
  console.log("Parameters:", {
    idSubstring,
    specificDate,
    contactInfo: contact?.phone || "No contact",
  });

  // Get calendar config from PostgreSQL
  const sqlClient = await pool.connect();
  try {
    const calendarConfigQuery = await sqlClient.query(
      `SELECT setting_value FROM public.settings 
       WHERE company_id = $1 
       AND setting_type = 'config' 
       AND setting_key = 'calendar'`,
      [idSubstring]
    );
    const calendarConfig =
      calendarConfigQuery.rows.length > 0
        ? calendarConfigQuery.rows[0].setting_value
        : {};

    // Use config values or defaults
    let calendarId = calendarConfig.calendarId;
    let firebaseId = calendarConfig.firebaseId;
    const daysAhead = calendarConfig.daysAhead || 7;
    const startHour = calendarConfig.startHour || 9;
    const endHour = calendarConfig.endHour || 21;
    const slotDuration = calendarConfig.slotDuration || 15;

    if (idSubstring == "0148") {
      const tags = (contact?.tags || []).map((tag) => tag.toLowerCase());
      if (tags.includes("pj")) {
        calendarId = calendarConfig.calendarId2;
        console.log("Using PJ calendar ID due to contact tags");
      }
    }

    console.log("Calendar Configuration:", {
      calendarId,
      firebaseId,
      daysAhead,
      startHour,
      endHour,
      slotDuration,
      configExists: calendarConfigQuery.rowCount > 0,
    });

    let startDate;
    if (specificDate) {
      startDate = moment(specificDate).tz("Asia/Kuala_Lumpur").startOf("day");
      console.log("Using specific date:", startDate.format("dddd, YYYY-MM-DD"));
    } else {
      startDate = today.clone().add(1, "day");
      console.log(
        "Using tomorrow as start date:",
        startDate.format("dddd, YYYY-MM-DD")
      );
    }

    // If using Firebase appointments
    if (!calendarId && firebaseId) {
      console.log("\n=== Using PostgreSQL Appointments System ===");
      console.log("Firebase User ID:", firebaseId);

      // Get all staff appointments for the date range
      const endDate = startDate.clone().add(daysAhead, "days");
      const startDateISO = startDate.toISOString();
      const endDateISO = endDate.toISOString();

      console.log("Fetching appointments between:", {
        start: startDate.format("YYYY-MM-DD HH:mm"),
        end: endDate.format("YYYY-MM-DD HH:mm"),
      });

      const appointmentsQuery = await sqlClient.query(
        `SELECT * FROM public.appointments 
         WHERE company_id = $1 
         AND scheduled_time >= $2 
         AND scheduled_time <= $3`,
        [idSubstring, startDateISO, endDateISO]
      );

      console.log(`Found ${appointmentsQuery.rowCount} existing appointments`);

      // Group appointments by staff and calculate actual durations
      const staffAppointments = {};
      let appointmentCount = 0;

      appointmentsQuery.rows.forEach((appointment) => {
        appointmentCount++;
        console.log(`\nProcessing appointment ${appointmentCount}:`, {
          id: appointment.appointment_id,
          title: appointment.title,
          startTime: appointment.scheduled_time,
          duration: appointment.duration_minutes,
          staff: appointment.staff_assigned,
        });

        // Compute start and end times
        const startTime = moment(appointment.scheduled_time).tz(
          "Asia/Kuala_Lumpur"
        );
        const endTime = startTime
          .clone()
          .add(appointment.duration_minutes, "minutes");

        // Process staff assignments
        if (
          appointment.staff_assigned &&
          Array.isArray(appointment.staff_assigned)
        ) {
          appointment.staff_assigned.forEach((staffEmail) => {
            if (!staffAppointments[staffEmail]) {
              staffAppointments[staffEmail] = [];
              console.log(`Initializing schedule for staff: ${staffEmail}`);
            }
            staffAppointments[staffEmail].push({
              startTime,
              endTime,
              duration: appointment.duration_minutes,
              title: appointment.title,
            });
            console.log(`Added to staff ${staffEmail}'s schedule:`, {
              date: startTime.format("YYYY-MM-DD"),
              start: startTime.format("HH:mm"),
              duration: `${appointment.duration_minutes} minutes`,
              title: appointment.title,
            });
          });
        }
      });

      console.log("\n=== Staff Schedules Summary ===");
      Object.keys(staffAppointments).forEach((staffEmail) => {
        console.log(
          `${staffEmail}: ${staffAppointments[staffEmail].length} appointments`
        );
      });

      // Different handling for 0153 vs other companies
      if (idSubstring === "0153") {
        console.log("\n=== Checking Available Dates for 0153 ===");
        const availableDates = new Set();

        for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
          const dateToCheck = startDate.clone().add(dayOffset, "days");
          console.log(`\nAnalyzing date: ${dateToCheck.format("YYYY-MM-DD")}`);

          // Skip if date is in the past
          if (dateToCheck.isBefore(now, "day")) {
            console.log(
              `Skipping past date: ${dateToCheck.format("YYYY-MM-DD")}`
            );
            continue;
          }

          // Check if any staff member is available on this date
          let isAnyStaffAvailable = false;
          const availableStaff = [];

          if (Object.keys(staffAppointments).length === 0) {
            isAnyStaffAvailable = true;
            availableStaff.push("All Staff");
          } else {
            for (const staffEmail in staffAppointments) {
              const hasAppointmentOnDay = staffAppointments[staffEmail].some(
                (appt) => appt.startTime.isSame(dateToCheck, "day")
              );

              if (!hasAppointmentOnDay) {
                isAnyStaffAvailable = true;
                availableStaff.push(staffEmail);
              }
            }
          }

          if (isAnyStaffAvailable) {
            availableDates.add({
              date: dateToCheck.format("YYYY-MM-DD"),
              dayOfWeek: dateToCheck.format("dddd"),
              availableStaff,
            });
          }
        }

        const sortedDates = Array.from(availableDates).sort((a, b) =>
          moment(a.date).diff(moment(b.date))
        );

        return sortedDates;
      } else {
        // Check each day
        console.log("\n=== Checking Available Slots ===");
        for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
          const dateToCheck = startDate.clone().add(dayOffset, "days");
          console.log(`\nAnalyzing date: ${dateToCheck.format("YYYY-MM-DD")}`);

          // Check each hour (removed minute intervals)
          for (
            let hour = startHour;
            hour < endHour;
            hour += slotDuration / 60
          ) {
            // Only process if it's a whole hour
            if (hour % 1 === 0) {
              const slotStart = dateToCheck.clone().set({ hour, minute: 0 });

              // Skip if slot start is in the past
              if (slotStart.isBefore(now)) {
                console.log(`Skipping past slot: ${slotStart.format("HH:mm")}`);
                continue;
              }

              const slotEnd = slotStart.clone().add(slotDuration, "minutes");

              // Check if slot is available
              const isSlotAvailable = !Object.values(staffAppointments).some(
                (staffAppts) =>
                  staffAppts.some(
                    (appt) =>
                      slotStart.isBefore(appt.endTime) &&
                      slotEnd.isAfter(appt.startTime)
                  )
              );

              if (isSlotAvailable) {
                // Check if there's enough time before end of day
                const timeUntilEndOfDay = moment(dateToCheck)
                  .set({ hour: endHour, minute: 0 })
                  .diff(slotStart, "minutes");

                if (timeUntilEndOfDay >= slotDuration) {
                  console.log(
                    `Adding available slot: ${slotStart.format("HH:mm")}`
                  );
                  const slot = {
                    startTime: slotStart.format("YYYY-MM-DD HH:mm:ss"),
                  };
                  availableSlots.push(slot);
                } else {
                  console.log(
                    `Slot ${slotStart.format(
                      "HH:mm"
                    )} skipped: Not enough time before closing (${timeUntilEndOfDay} minutes)`
                  );
                }
              }
            }
          }
        }
      }
    } else if (calendarId) {
      console.log("\n=== Using Google Calendar System ===");
      // Initialize Google Calendar API
      const auth = new google.auth.GoogleAuth({
        keyFile: "./service_account.json",
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      });
      const calendar = google.calendar({ version: "v3", auth });
      console.log("Google Calendar API initialized");

      // Loop through the days
      for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
        const dateToCheck = startDate.clone().add(dayOffset, "days");
        const startOfDay = dateToCheck
          .clone()
          .set({ hour: startHour, minute: 0 });
        const endOfDay = dateToCheck.clone().set({ hour: endHour, minute: 0 });

        console.log(
          `\nChecking Google Calendar for ${dateToCheck.format("YYYY-MM-DD")}`
        );
        console.log(
          `Time range: ${startOfDay.format("HH:mm")} - ${endOfDay.format(
            "HH:mm"
          )}`
        );

        // Skip if the entire day is in the past
        if (endOfDay.isBefore(now)) {
          console.log("Skipping past day");
          continue;
        }

        // Fetch events for the day
        console.log("Fetching Google Calendar events...");
        const eventsResponse = await calendar.events.list({
          calendarId: calendarId,
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
        });

        const events = eventsResponse.data.items;
        console.log(`Found ${events.length} existing events`);

        const bookedSlots = events.map((event) => {
          const startTime = moment(event.start.dateTime || event.start.date).tz(
            "Asia/Kuala_Lumpur"
          );
          const endTime = moment(event.end.dateTime || event.end.date).tz(
            "Asia/Kuala_Lumpur"
          );
          console.log(
            `Booked: ${startTime.format("HH:mm")} (${
              event.summary || "No title"
            })`
          );
          return { startTime, endTime };
        });

        // Calculate number of slots per hour based on slot duration
        const slotsPerHour = 60 / slotDuration;

        // Check each slot based on slot duration
        for (let hour = startHour; hour < endHour; hour++) {
          for (let slot = 0; slot < slotsPerHour; slot++) {
            const minutes = slot * slotDuration;
            const slotStart = dateToCheck
              .clone()
              .set({ hour, minute: minutes });

            // Skip if slot is in the past
            if (slotStart.isBefore(now)) {
              console.log(`Skipping past slot: ${slotStart.format("HH:mm")}`);
              continue;
            }

            const slotEnd = slotStart.clone().add(slotDuration, "minutes");

            // Check if slot is available
            const isSlotAvailable = !bookedSlots.some(
              (bookedSlot) =>
                slotStart.isBefore(bookedSlot.endTime) &&
                slotEnd.isAfter(bookedSlot.startTime)
            );

            if (isSlotAvailable) {
              // Check if there's enough time before end of day
              const timeUntilEndOfDay = endOfDay.diff(slotStart, "minutes");

              if (timeUntilEndOfDay >= slotDuration) {
                console.log(
                  `Adding available slot: ${slotStart.format("HH:mm")}`
                );
                const slot = {
                  startTime: slotStart.format("YYYY-MM-DD HH:mm:ss"),
                };
                availableSlots.push(slot);
              } else {
                console.log(
                  `Slot ${slotStart.format(
                    "HH:mm"
                  )} skipped: Not enough time before closing (${timeUntilEndOfDay} minutes)`
                );
              }
            } else {
              console.log(`Slot ${slotStart.format("HH:mm")} is not available`);
            }
          }
        }
      }
    } else {
      console.error("No calendar configuration found");
      return "No calendar configuration available.";
    }

    console.log(`\n=== Final Results ===`);
    if (idSubstring === "0153") {
      const availableDates = Array.from(availableSlots);
      console.log(`Total available dates found: ${availableDates.length}`);
      return availableDates;
    } else {
      console.log(`Total available slots found: ${availableSlots.length}`);
      // Sort slots by date and time
      availableSlots.sort((a, b) =>
        moment(a.startTime).diff(moment(b.startTime))
      );
      return availableSlots.length > 0
        ? availableSlots
        : "No available time slots for the next few days.";
    }
  } catch (error) {
    console.error("Error in checkAvailableTimeSlots:", error);
    return { error: `Failed to check availability: ${error.message}` };
  } finally {
    await safeRelease(sqlClient);
  }
}

async function countContactsCreatedToday(idSubstring) {
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const today = moment().tz("Asia/Kuala_Lumpur").format("YYYY-MM-DD");

    const query = `
      SELECT COUNT(*) as count
      FROM public.contacts
      WHERE company_id = $1
      AND DATE(created_at) = $2
    `;

    const result = await sqlClient.query(query, [idSubstring, today]);

    await sqlClient.query("COMMIT");

    return parseInt(result.rows[0].count);
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error counting contacts created today:", error);
    return 0;
  } finally {
    await safeRelease(sqlClient);
  }
}

async function assignNewContactToEmployee(
  extractedNumber,
  idSubstring,
  client,
  contactName,
  triggerKeyword = "",
  phoneIndex = 0
) {
  // Load current month's assignment counts
  await loadAssignmentCounts(idSubstring, phoneIndex);

  const employees = await fetchEmployeesFromDatabase(idSubstring);
  console.log("Available employees:", employees);

  if (employees.length === 0) {
    console.log("No employees found for assignment");
    return [];
  }

  const tags = [];
  const contactData = await getContactDataFromDatabaseByPhone(
    extractedNumber,
    idSubstring
  );
  const updatedContactName =
    contactData?.contactName || contactName || "Not provided";

  // Helper function to filter and sort available employees
  const getAvailableEmployees = (role) => {
    return employees.filter(
      (emp) =>
        emp.role === role &&
        emp.phone_access?.[phoneIndex] &&
        (!emp.quota_leads || (assignmentCounts[emp.id] || 0) < emp.quota_leads)
          .map((emp) => ({
            ...emp,
            currentAssignments: assignmentCounts[emp.id] || 0,
            effectiveWeight:
              (emp.weightages?.[phoneIndex] || 1) /
              ((assignmentCounts[emp.id] || 0) + 1),
          }))
          .sort((a, b) => b.effectiveWeight - a.effectiveWeight)
    );
  };

  // Get available employees by role
  const availableSales = getAvailableEmployees("4");
  const availableManagers = getAvailableEmployees("2");
  const availableAdmins = getAvailableEmployees("1");

  let assignedEmployee = null;
  let assignedRole = "";

  // Try to assign to sales first
  if (availableSales.length > 0) {
    const totalWeight = availableSales.reduce(
      (sum, emp) => sum + emp.effectiveWeight,
      0
    );
    const randomValue = Math.random() * totalWeight;
    let cumulativeWeight = 0;

    for (const emp of availableSales) {
      cumulativeWeight += emp.effectiveWeight;
      if (randomValue <= cumulativeWeight) {
        assignedEmployee = emp;
        assignedRole = "Sales";
        break;
      }
    }
  }

  // Fall back to managers if no sales available
  if (!assignedEmployee && availableManagers.length > 0) {
    const totalWeight = availableManagers.reduce(
      (sum, emp) => sum + emp.effectiveWeight,
      0
    );
    const randomValue = Math.random() * totalWeight;
    let cumulativeWeight = 0;

    for (const emp of availableManagers) {
      cumulativeWeight += emp.effectiveWeight;
      if (randomValue <= cumulativeWeight) {
        assignedEmployee = emp;
        assignedRole = "Manager";
        break;
      }
    }
  }

  // Fall back to admins if no others available
  if (!assignedEmployee && availableAdmins.length > 0) {
    const totalWeight = availableAdmins.reduce(
      (sum, emp) => sum + emp.effectiveWeight,
      0
    );
    const randomValue = Math.random() * totalWeight;
    let cumulativeWeight = 0;

    for (const emp of availableAdmins) {
      cumulativeWeight += emp.effectiveWeight;
      if (randomValue <= cumulativeWeight) {
        assignedEmployee = emp;
        assignedRole = "Admin";
        break;
      }
    }
  }

  // If we found someone to assign to
  if (assignedEmployee) {
    console.log(`Assigning to ${assignedRole}: ${assignedEmployee.name}`);

    await assignToEmployee(
      assignedEmployee,
      assignedRole,
      extractedNumber,
      updatedContactName,
      client,
      idSubstring,
      triggerKeyword,
      phoneIndex
    );

    const contactId = `${idSubstring}-${extractedNumber.replace("+", "")}`;

    // Record the assignment
    await recordAssignment({
      company_id: idSubstring,
      employee_id: assignedEmployee.id,
      contact_id: contactId,
      phone_index: phoneIndex,
      employee_role: assignedEmployee.role,
      weightage_used: assignedEmployee.weightages?.[phoneIndex] || 1,
      assignment_type: "general",
      notes: `Assigned via ${triggerKeyword || "automatic"} assignment`,
      metadata: {
        contactName: updatedContactName,
        triggerKeyword,
        originalPhone: extractedNumber,
      },
    });

    // Update our local counts
    assignmentCounts[assignedEmployee.id] =
      (assignmentCounts[assignedEmployee.id] || 0) + 1;
    totalAssignments++;
    tags.push(assignedEmployee.name, assignedEmployee.phone_number);

    // Store the updated counts
    await storeAssignmentCounts(idSubstring, phoneIndex);
  } else {
    console.log("No available employees with capacity for assignment");
  }

  return tags;
}

function normalizePhoneIndex(phone) {
  return Number(phone) || 0;
}

function normalizeWeightage(weightage) {
  return Number(weightage) || 0;
}

async function getAssignmentDocName(phoneIndex) {
  switch (phoneIndex) {
    case 0:
      return "Revotrend";
    case 1:
      return "StoreGuru";
    case 2:
      return "ShipGuru";
    default:
      return "Unknown";
  }
}

async function assignNewContactToEmployeeRevotrend(
  contactID,
  idSubstring,
  client,
  phoneIndex
) {
  const logs = [];
  const normalizedPhoneIndex = normalizePhoneIndex(phoneIndex);
  let sqlClient;

  // Format contactID if needed
  if (contactID) {
    if (!contactID.startsWith("+")) {
      const parts = contactID.split("-");
      if (parts.length > 1) {
        contactID = "+" + parts[1];
      } else {
        contactID = "+" + contactID;
      }
    }
  }

  function log(message) {
    console.log(message);
    logs.push(message);
  }

  function logError(message) {
    console.error(message);
    logs.push(`ERROR: ${message}`);
  }

  try {
    sqlClient = await pool.connect();
    await sqlClient.query("BEGIN");

    // Fetch employees from PostgreSQL
    const employeeQuery = `
            SELECT * FROM public.employees 
            WHERE company_id = $1 AND active = true
        `;
    const employeeResult = await sqlClient.query(employeeQuery, [idSubstring]);
    const employees = [];

    const contactData = await getContactDataFromDatabaseByPhone(
      contactID,
      idSubstring
    );
    const contactTags = contactData?.tags || [];
    log(`Contact tags: ${contactTags.join(", ")}`);

    employeeResult.rows.forEach((employeeData) => {
      if (employeeData.email) {
        let weightage = 0;
        const weightages = employeeData.weightages || {};

        // Check if the current phoneIndex exists in the weightages object
        if (weightages.hasOwnProperty(normalizedPhoneIndex.toString())) {
          weightage = normalizeWeightage(
            weightages[normalizedPhoneIndex.toString()]
          );
        }

        if (weightage > 0) {
          employees.push({
            ...employeeData,
            weightage: weightage,
          });
        } else {
          log(
            `Employee ${employeeData.name} has zero or undefined weightage for phoneIndex ${normalizedPhoneIndex}`
          );
        }
      } else {
        log(`Employee has no email: ${employeeData.name}`);
      }
    });

    if (employees.length === 0) {
      logError(
        `No employees found with valid weightage for phoneIndex ${normalizedPhoneIndex}`
      );
      await safeRollback(sqlClient);
      return null;
    }

    let assignedEmployee = employees.find((emp) =>
      contactTags.includes(emp.name)
    );

    if (assignedEmployee) {
      log(
        `Reassigning to previously assigned employee: ${assignedEmployee.name}`
      );
    } else {
      log(
        "No previously assigned employee found for this phoneIndex. Assigning a new one."
      );

      await loadAssignmentCounts(idSubstring, normalizedPhoneIndex);

      const totalWeightage = employees.reduce(
        (sum, emp) => sum + emp.weightage,
        0
      );

      const employeeAllocations = employees.map((emp) => ({
        ...emp,
        normalizedWeight: (emp.weightage / totalWeightage) * 100,
        allocated: assignmentCounts[emp.email] || 0,
      }));

      assignedEmployee = employeeAllocations.reduce((prev, curr) => {
        const prevBehind = prev.allocated / prev.normalizedWeight;
        const currBehind = curr.allocated / curr.normalizedWeight;
        log(
          `Comparing ${prev.name} (${prevBehind}) with ${curr.name} (${currBehind})`
        );
        return currBehind < prevBehind ? curr : prev;
      });

      assignmentCounts[assignedEmployee.email] =
        (assignmentCounts[assignedEmployee.email] || 0) + 1;
      totalAssignments++;
      await storeAssignmentCounts(idSubstring, normalizedPhoneIndex);
    }

    // Add tag to contact in PostgreSQL instead of Firebase
    await addTagToPostgres(contactID, assignedEmployee.name, idSubstring);

    // Update assignment fields in PostgreSQL contacts table using custom_fields
    const assignmentFields = [
      "assigned_revotrend",
      "assigned_store_guru",
      "assigned_ship_guru",
    ];
    const assignmentField = assignmentFields[normalizedPhoneIndex];

    const contactUpdateQuery = `
            UPDATE public.contacts 
            SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $1::jsonb,
                last_updated = CURRENT_TIMESTAMP
            WHERE phone = $2 AND company_id = $3
        `;
    const updateData = JSON.stringify({
      [assignmentField]: assignedEmployee.name,
    });
    await sqlClient.query(contactUpdateQuery, [
      updateData,
      contactID,
      idSubstring,
    ]);
    log(
      `Updated ${assignmentField} to ${assignedEmployee.name} for contact ${contactID}`
    );

    // Create assignment record
    const currentDate = new Date();
    const currentMonthKey = `${currentDate.getFullYear()}-${(
      currentDate.getMonth() + 1
    )
      .toString()
      .padStart(2, "0")}`;
    const assignmentId = `${idSubstring}-${contactID.replace("+", "")}-${
      assignedEmployee.employee_id
    }-${Date.now()}`;

    const assignmentInsertQuery = `
            INSERT INTO assignments (
                assignment_id, company_id, employee_id, contact_id, 
                assigned_at, status, month_key, assignment_type, 
                phone_index, weightage_used, employee_role, notes
            ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'active', $5, 'auto_revotrend', $6, $7, $8, $9)
        `;

    const contactIdFormatted = `${idSubstring}-${contactID.replace("+", "")}`;
    await sqlClient.query(assignmentInsertQuery, [
      assignmentId,
      idSubstring,
      assignedEmployee.employee_id,
      contactIdFormatted,
      currentMonthKey,
      normalizedPhoneIndex,
      assignedEmployee.weightage,
      assignedEmployee.role || "employee",
      `Auto-assigned via Revotrend logic for phone index ${normalizedPhoneIndex}`,
    ]);

    // Update employee's assigned_contacts count
    const employeeUpdateQuery = `
            UPDATE employees
            SET assigned_contacts = assigned_contacts + 1, last_updated = CURRENT_TIMESTAMP
            WHERE company_id = $1 AND employee_id = $2
        `;
    await sqlClient.query(employeeUpdateQuery, [
      idSubstring,
      assignedEmployee.employee_id,
    ]);

    // Update monthly assignments (increase) - to match your addTagToPostgres function
    const monthlyAssignmentUpsertQuery = `
        INSERT INTO employee_monthly_assignments (employee_id, company_id, month_key, assignments_count, last_updated)
        VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (employee_id, month_key) DO UPDATE
        SET assignments_count = employee_monthly_assignments.assignments_count + 1,
            last_updated = CURRENT_TIMESTAMP
    `;

    // Get employee.id for monthly assignment tracking
    const employeeIdQuery = `SELECT id FROM employees WHERE company_id = $1 AND employee_id = $2`;
    const employeeIdResult = await sqlClient.query(employeeIdQuery, [
      idSubstring,
      assignedEmployee.employee_id,
    ]);
    const employeeDbId = employeeIdResult.rows[0]?.id;

    if (employeeDbId) {
      await sqlClient.query(monthlyAssignmentUpsertQuery, [
        employeeDbId,
        idSubstring,
        currentMonthKey,
      ]);
    }

    await sqlClient.query("COMMIT");

    const employeeID =
      assignedEmployee.phone_number?.replace(/\s+/g, "").replace(/^\+/, "") +
      "@c.us";
    const contactName =
      contactData?.contactName || contactData?.contact_name || "New Contact";

    await client.sendMessage(
      employeeID,
      `Hello ${assignedEmployee.name}, a contact has been assigned to you:

Name: ${contactName}
Phone: ${contactID}

Kindly login to https://web.jutasoftware.co/login

Thank you.

Juta Teknologi`
    );

    log(
      `Contact ${contactID} has been assigned to ${assignedEmployee.name} using phone index ${normalizedPhoneIndex}`
    );

    // Store logs in PostgreSQL instead of Firebase
    const logInsertQuery = `
            INSERT INTO assignment_logs (
                company_id, contact_id, phone_index, logs, "timestamp"
            ) VALUES ($1, $2, $3, $4::text[], CURRENT_TIMESTAMP)
        `;
    await pool.query(logInsertQuery, [
      idSubstring,
      contactID,
      normalizedPhoneIndex,
      logs,
    ]);

    return {
      assigned: assignedEmployee.name,
      email: assignedEmployee.email,
      phoneNumber: assignedEmployee.phone_number,
    };
  } catch (error) {
    logError(`Error in assignNewContactToEmployee: ${error}`);

    if (sqlClient) {
      await safeRollback(sqlClient);
    }

    // Store error logs in PostgreSQL
    try {
      const logInsertQuery = `
                INSERT INTO assignment_logs (
                    company_id, contact_id, phone_index, logs, "timestamp"
                ) VALUES ($1, $2, $3, $4::text[], CURRENT_TIMESTAMP)
            `;
      await pool.query(logInsertQuery, [
        idSubstring,
        contactID,
        normalizedPhoneIndex,
        logs,
      ]);
    } catch (logError) {
      console.error("Failed to store error logs:", logError);
    }

    return null;
  } finally {
    if (sqlClient) {
      await safeRelease(sqlClient);
    }
  }
}

// Function to check if a contact needs assignment
async function checkIfContactNeedsAssignment(contactData, phoneIndex) {
  if (!contactData) {
    console.log("❓ Contact not found - needs assignment");
    return true;
  }

  const assignmentFields = {
    0: "assigned_revotrend",
    1: "assigned_store_guru",
    2: "assigned_ship_guru",
  };

  const assignmentField = assignmentFields[phoneIndex];

  // Check in custom_fields JSONB column
  const customFields = contactData.custom_fields || {};
  const hasAssignment = customFields[assignmentField];

  console.log(`🔍 Checking assignment for phoneIndex ${phoneIndex}:`);
  console.log(`   - Assignment field: ${assignmentField}`);
  console.log(`   - Custom fields:`, customFields);
  console.log(`   - Has assignment: ${hasAssignment}`);
  console.log(`   - Needs assignment: ${!hasAssignment}`);

  return !hasAssignment;
}

async function assignToEmployee(
  employee,
  role,
  contactID,
  contactName,
  client,
  idSubstring,
  triggerKeyword = "",
  phoneIndex = 0,
  skipMessage = false
) {
  console.log(`[ASSIGN_TO_EMPLOYEE DEBUG] Starting assignment for employee:`, {
    employee: employee,
    role: role,
    contactID: contactID,
    contactName: contactName,
    idSubstring: idSubstring,
    triggerKeyword: triggerKeyword,
    phoneIndex: phoneIndex,
  });

  try {
    // Get employee's phone number from the database
    const employeePhoneQuery = `
      SELECT phone_number FROM employees 
      WHERE company_id = $1 AND id = $2
    `;
    const employeePhoneResult = await pool.query(employeePhoneQuery, [
      idSubstring,
      employee.id,
    ]);

    if (employeePhoneResult.rows.length === 0) {
      console.error(
        `[ASSIGN_TO_EMPLOYEE DEBUG] Employee not found in database:`,
        employee.id
      );
      return;
    }

    const employeePhone = employeePhoneResult.rows[0].phone_number;
    const employeeID = employeePhone?.replace(/\D/g, "") + "@c.us";

    console.log(
      `[ASSIGN_TO_EMPLOYEE DEBUG] Employee phone: ${employeePhone}, Employee ID: ${employeeID}`
    );

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
            triggerKeyword
              ? `*${triggerKeyword}*`
              : "[No keyword trigger found]"
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

    if (!skipMessage) {
      console.log(
        `[ASSIGN_TO_EMPLOYEE DEBUG] Sending message to employee: ${employeeID}`
      );
      console.log(`[ASSIGN_TO_EMPLOYEE DEBUG] Message content:`, message);

      // Send WhatsApp message to employee
      await client.sendMessage(employeeID, message);

      console.log(`[ASSIGN_TO_EMPLOYEE DEBUG] Message sent successfully`);
    } else {
      console.log(`[ASSIGN_TO_EMPLOYEE DEBUG] Skipping generic assignment message (AI handler will send custom report)`);
    }

    // Add employee name as tag to contact
    await addTagToPostgres(contactID, employee.name, idSubstring);

    console.log(`[ASSIGN_TO_EMPLOYEE DEBUG] Tag added to contact`);

    // Create assignment record in assignments table
    const sqlClient = await pool.connect();
    try {
      await sqlClient.query("BEGIN");

      // Get contact details
      const contactQuery = `
        SELECT contact_id FROM contacts 
        WHERE phone = $1 AND company_id = $2
      `;
      const contactResult = await sqlClient.query(contactQuery, [
        contactID,
        idSubstring,
      ]);

      console.log(
        `[ASSIGN_TO_EMPLOYEE DEBUG] Contact query result:`,
        contactResult.rows
      );

      if (contactResult.rows.length > 0) {
        const currentDate = new Date();
        const currentMonthKey = `${currentDate.getFullYear()}-${(
          currentDate.getMonth() + 1
        )
          .toString()
          .padStart(2, "0")}`;

        const assignmentId = `${idSubstring}-${
          contactResult.rows[0].contact_id
        }-${employee.id}-${Date.now()}`;

        console.log(
          `[ASSIGN_TO_EMPLOYEE DEBUG] Assignment ID: ${assignmentId}`
        );

        // Check if assignment already exists to avoid duplicates
        const existingAssignmentQuery = `
          SELECT id FROM assignments 
          WHERE company_id = $1 AND employee_id = $2 AND contact_id = $3 AND status = 'active'
        `;
        const existingResult = await sqlClient.query(existingAssignmentQuery, [
          idSubstring,
          employee.id,
          contactResult.rows[0].contact_id,
        ]);

        console.log(
          `[ASSIGN_TO_EMPLOYEE DEBUG] Existing assignment check:`,
          existingResult.rows
        );

        if (existingResult.rows.length === 0) {
          const assignmentInsertQuery = `
            INSERT INTO assignments (
              assignment_id, company_id, employee_id, contact_id, 
              assigned_at, status, month_key, assignment_type, 
              phone_index, weightage_used, employee_role
            ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'active', $5, 'auto_bot', $6, 1, $7)
          `;

          await sqlClient.query(assignmentInsertQuery, [
            assignmentId,
            idSubstring,
            employee.id,
            contactResult.rows[0].contact_id,
            currentMonthKey,
            phoneIndex,
            role,
          ]);

          console.log(`[ASSIGN_TO_EMPLOYEE DEBUG] Assignment record created`);

          // Update employee's assigned_contacts count
          const employeeUpdateQuery = `
            UPDATE employees
            SET assigned_contacts = COALESCE(assigned_contacts, 0) + 1
            WHERE company_id = $1 AND id = $2
          `;

          await sqlClient.query(employeeUpdateQuery, [
            idSubstring,
            employee.id,
          ]);

          console.log(
            `[ASSIGN_TO_EMPLOYEE DEBUG] Employee assigned_contacts updated`
          );

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
            currentMonthKey,
          ]);

          console.log(`[ASSIGN_TO_EMPLOYEE DEBUG] Monthly assignment updated`);
        } else {
          console.log(
            `[ASSIGN_TO_EMPLOYEE DEBUG] Assignment already exists, skipping duplicate`
          );
        }
      } else {
        console.log(
          `[ASSIGN_TO_EMPLOYEE DEBUG] Contact not found in database: ${contactID}`
        );
      }

      await sqlClient.query("COMMIT");
      console.log(
        `[ASSIGN_TO_EMPLOYEE DEBUG] Database transaction committed successfully`
      );
    } catch (error) {
      await safeRollback(sqlClient);
      console.error(
        `[ASSIGN_TO_EMPLOYEE DEBUG] Error creating assignment record:`,
        error
      );
      throw error;
    } finally {
      await safeRelease(sqlClient);
    }
  } catch (error) {
    console.error(
      `[ASSIGN_TO_EMPLOYEE DEBUG] Error in assignToEmployee:`,
      error
    );
    throw error;
  }

  console.log(
    `[ASSIGN_TO_EMPLOYEE DEBUG] Successfully assigned ${role}: ${employee.name}`
  );
}

async function fetchEmployeesFromDatabase(idSubstring) {
  const sqlClient = await pool.connect();
  try {
    const query = `
      SELECT * FROM public.employees WHERE company_id = $1
    `;
    const result = await sqlClient.query(query, [idSubstring]);
    return result.rows;
  } catch (error) {
    console.error(
      `Error fetching employees for Company ${idSubstring}:`,
      error
    );
    return {};
  } finally {
    await safeRelease(sqlClient);
  }
}

function getCurrentMonthKey() {
  const date = new Date();
  const month = date.toLocaleString("default", { month: "short" });
  const year = date.getFullYear();
  return `${month}-${year}`;
}

let assignmentCounts = {};
let totalAssignments = 0;

async function loadAssignmentCounts(idSubstring, phoneIndex) {
  const assignmentType =
    idSubstring === "0123" ? await getAssignmentDocName(phoneIndex) : "general";
  const monthKey = getCurrentMonthKey();

  const query = `
        SELECT counts, total 
        FROM assignment_counts 
        WHERE company_id = $1 
          AND assignment_type = $2
          AND month_key = $3
    `;

  try {
    const result = await pool.query(query, [
      idSubstring,
      assignmentType,
      monthKey,
    ]);
    if (result.rows.length > 0) {
      assignmentCounts = result.rows[0].counts || {};
      totalAssignments = result.rows[0].total || 0;
      console.log(
        `${assignmentType} counts for ${monthKey} loaded:`,
        result.rows[0]
      );
    } else {
      console.log(`No previous ${assignmentType} counts found for ${monthKey}`);
      assignmentCounts = {};
      totalAssignments = 0;
    }
  } catch (error) {
    console.error(`Error loading assignment counts: ${error}`);
    assignmentCounts = {};
    totalAssignments = 0;
  }
}

async function storeAssignmentCounts(idSubstring, phoneIndex) {
  const assignmentType =
    idSubstring === "0123" ? await getAssignmentDocName(phoneIndex) : "general";
  const monthKey = getCurrentMonthKey();

  const query = `
        INSERT INTO assignment_counts (company_id, assignment_type, month_key, counts, total)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (company_id, assignment_type, month_key) 
        DO UPDATE SET 
            counts = EXCLUDED.counts,
            total = EXCLUDED.total,
            last_updated = CURRENT_TIMESTAMP
    `;

  try {
    await pool.query(query, [
      idSubstring,
      assignmentType,
      monthKey,
      assignmentCounts,
      totalAssignments,
    ]);
    console.log(`${assignmentType} counts for ${monthKey} stored`);
  } catch (error) {
    console.error(`Error storing assignment counts: ${error}`);
  }
}

async function recordAssignment(assignmentData) {
  const monthKey = getCurrentMonthKey();
  const query = `
    INSERT INTO assignments (
      assignment_id,
      company_id,
      employee_id,
      contact_id,
      assigned_at,
      status,
      notes,
      metadata,
      month_key,
      phone_index,
      assignment_type,
      employee_role,
      weightage_used
    ) VALUES (
      gen_random_uuid()::text,
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
    )
  `;

  try {
    await pool.query(query, [
      assignmentData.company_id,
      assignmentData.employee_id,
      assignmentData.contact_id,
      new Date(),
      "active",
      assignmentData.notes,
      assignmentData.metadata,
      monthKey,
      assignmentData.phone_index,
      assignmentData.assignment_type,
      assignmentData.employee_role,
      assignmentData.weightage_used,
    ]);
    console.log("Assignment recorded successfully");
  } catch (error) {
    console.error("Error recording assignment:", error);
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

async function waitForCompletion(
  threadId,
  runId,
  idSubstring,
  client,
  depth = 0,
  phoneNumber,
  name,
  companyName,
  contact,
  companyConfig
) {
  const maxDepth = 5; // Maximum recursion depth
  const maxAttempts = 30;
  const pollingInterval = 2000; // 2 seconds

  console.log(`Waiting for completion (depth: ${depth}, runId: ${runId})...`);

  if (depth >= maxDepth) {
    console.error(`Max recursion depth reached for runId: ${runId}`);
    return "I apologize, but I'm having trouble completing this task. Could you please try rephrasing your request?";
  }

  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    try {
      const runObject = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
      );
      console.log(`Run status: ${runObject.status} (attempt ${attempts + 1})`);

      if (runObject.status === "completed") {
        const messagesList = await openai.beta.threads.messages.list(threadId);
        const latestMessage = messagesList.data[0].content[0].text.value;
        return latestMessage;
      } else if (runObject.status === "requires_action") {
        console.log("Run requires action, handling tool calls...");
        const toolCalls =
          runObject.required_action.submit_tool_outputs.tool_calls;
        const toolOutputs = await handleToolCalls(
          toolCalls,
          idSubstring,
          client,
          phoneNumber,
          name,
          companyName,
          contact,
          threadId,
          companyConfig
        );

        // Use safe tool output submission
        const result = await submitToolOutputsSafely(
          threadId,
          runId,
          toolOutputs
        );

        if (result.success && result.status === "submitted") {
          console.log(
            "Tool outputs submitted, restarting wait for completion..."
          );
          return await waitForCompletion(
            threadId,
            runId,
            idSubstring,
            client,
            depth + 1,
            phoneNumber,
            name,
            companyName,
            contact
          );
        } else if (result.status === "completed") {
          // Run completed while we were processing tool calls
          const messagesList = await openai.beta.threads.messages.list(
            threadId
          );
          const latestMessage = messagesList.data[0].content[0].text.value;
          return latestMessage;
        } else {
          console.log(`Run ${runId} ended with status: ${result.status}`);
          return `I encountered an error (${result.status}). Please try your request again.`;
        }
      } else if (
        ["failed", "cancelled", "expired"].includes(runObject.status)
      ) {
        console.error(`Run ${runId} ended with status: ${runObject.status}`);
        return `I encountered an error (${runObject.status}). Please try your request again.`;
      }

      await new Promise((resolve) => setTimeout(resolve, pollingInterval));
    } catch (error) {
      console.error(
        `Error in waitForCompletion (depth: ${depth}, runId: ${runId}): ${error}`
      );
      return "I'm sorry, but I encountered an error while processing your request. Please try again.";
    }
  }

  console.error(
    `Timeout: Assistant did not complete in time (depth: ${depth}, runId: ${runId})`
  );
  return "I'm sorry, but it's taking longer than expected to process your request. Please try again or rephrase your question.";
}
async function submitToolOutputsSafely(
  threadId,
  runId,
  toolOutputs,
  maxRetries = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const currentRun = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
      );

      if (currentRun.status === "completed") {
        console.log(
          `Run ${runId} already completed, skipping tool output submission`
        );
        return { success: true, status: "completed" };
      }

      if (currentRun.status === "requires_action") {
        await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
          tool_outputs: toolOutputs,
        });
        console.log(
          `Tool outputs submitted successfully on attempt ${attempt}`
        );
        return { success: true, status: "submitted" };
      }

      if (
        currentRun.status === "failed" ||
        currentRun.status === "cancelled" ||
        currentRun.status === "expired"
      ) {
        console.log(`Run ${runId} ended with status: ${currentRun.status}`);
        return { success: false, status: currentRun.status };
      }

      // Wait before retrying
      if (attempt < maxRetries) {
        console.log(
          `Attempt ${attempt} failed, retrying in ${1000 * attempt}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    } catch (error) {
      console.error(
        `Error submitting tool outputs (attempt ${attempt}):`,
        error
      );
      if (attempt === maxRetries) {
        throw error;
      }
    }
  }

  throw new Error(`Failed to submit tool outputs after ${maxRetries} attempts`);
}
// Modify the runAssistant function to handle tool calls
async function runAssistant(
  assistantID,
  threadId,
  tools,
  idSubstring,
  client,
  phoneNumber,
  name,
  companyName,
  contact,
  phoneIndex = 0,
  companyConfig
) {
  try {
    // Get current date and time in Malaysia timezone
    const currentDateTime = getTodayDate();
    
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantID,
      tools: tools,
      additional_instructions: `IMPORTANT: Today's date and time is ${currentDateTime}. Always use this as the current date for any date-related queries or operations.`,
    });

    console.log(`Created run: ${run.id}`);
    return await waitForCompletion(
      threadId,
      run.id,
      idSubstring,
      client,
      0,
      phoneNumber,
      name,
      companyName,
      contact,
      companyConfig
    );
  } catch (error) {
    console.error("Error running assistant:", error);
    throw error;
  }
}

async function getCompanyAssistantId(idSubstring, phoneIndex = 0) {
  try {
    const sqlClient = await pool.connect();

    try {
      await sqlClient.query("BEGIN");

      const query = `
        SELECT assistant_ids
        FROM public.companies
        WHERE company_id = $1
      `;

      const result = await sqlClient.query(query, [idSubstring]);

      await sqlClient.query("COMMIT");

      if (result.rows.length === 0) {
        throw new Error(`No config found for company ${idSubstring}`);
      }

      const assistantIds = result.rows[0].assistant_ids;
      let assistantId;
      if (Array.isArray(assistantIds)) {
        assistantId = assistantIds[phoneIndex] || assistantIds[0];
      } else if (typeof assistantIds === "string") {
        try {
          const parsed = JSON.parse(assistantIds);
          assistantId = Array.isArray(parsed)
            ? parsed[phoneIndex] || parsed[0]
            : parsed;
        } catch {
          assistantId = assistantIds;
        }
      }

      if (!assistantId) {
        throw new Error(`No assistant ID found for company ${idSubstring}`);
      }

      console.log(`Retrieved assistant ID for ${idSubstring}:`, assistantId);
      return assistantId;
    } catch (error) {
      await safeRollback(sqlClient);
      throw error;
    } finally {
      await safeRelease(sqlClient);
    }
  } catch (error) {
    console.error(`Error fetching assistant ID for ${idSubstring}:`, error);
    throw error;
  }
}

async function fetchMultipleContactsData(phoneNumbers, idSubstring) {
  try {
    const contactsData = await Promise.all(
      phoneNumbers.map(async (phoneNumber) => {
        const contactData = await getContactDataFromDatabaseByPhone(
          phoneNumber,
          idSubstring
        );
        return { phoneNumber, ...contactData };
      })
    );
    return JSON.stringify(contactsData);
  } catch (error) {
    console.error("Error fetching multiple contacts data:", error);
    return JSON.stringify({ error: "Failed to fetch contacts data" });
  }
}

async function listContacts(idSubstring, limit = 10, offset = 0) {
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const query = `
      SELECT 
        id,
        contact_id,
        phone,
        COALESCE(contact_name, name) AS contact_name
      FROM 
        public.contacts
      WHERE 
        company_id = $1
      ORDER BY 
        contact_name
      LIMIT $2 OFFSET $3
    `;

    const result = await sqlClient.query(query, [idSubstring, limit, offset]);

    await sqlClient.query("COMMIT");

    const contacts = result.rows.map((row) => ({
      phoneNumber: row.phone || row.contact_id,
      contactName: row.contact_name || "Unknown",
      phone: row.phone || "",
    }));

    return JSON.stringify(contacts);
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error listing contacts:", error);
    return JSON.stringify({ error: "Failed to list contacts" });
  } finally {
    await safeRelease(sqlClient);
  }
}

async function searchContacts(idSubstring, searchTerm) {
  const sqlClient = await pool.connect();

  try {
    console.log(`Searching for contacts with term: "${searchTerm}"`);
    const searchTermLower = searchTerm.toLowerCase();

    await sqlClient.query("BEGIN");

    const query = `
      SELECT 
        id, 
        contact_id, 
        COALESCE(contact_name, name) AS contact_name, 
        phone, 
        tags
      FROM 
        public.contacts
      WHERE 
        company_id = $1 AND (
          LOWER(COALESCE(contact_name, '')) ILIKE $2 OR
          LOWER(COALESCE(name, '')) ILIKE $2 OR
          COALESCE(phone, '') ILIKE $2 OR
          EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(tags) AS tag
            WHERE LOWER(tag) ILIKE $2
          )
        )
    `;

    const result = await sqlClient.query(query, [
      idSubstring,
      `%${searchTermLower}%`,
    ]);

    await sqlClient.query("COMMIT");

    const matchingContacts = result.rows.map((row) => ({
      phoneNumber: row.contact_id,
      contactName: row.contact_name || "Unknown",
      phone: row.phone || "",
      tags: row.tags ? row.tags : [],
    }));

    console.log(`Found ${matchingContacts.length} matching contacts`);

    if (matchingContacts.length === 0) {
      return JSON.stringify({ message: "No matching contacts found." });
    }

    return JSON.stringify({
      matchingContacts,
      totalMatches: matchingContacts.length,
    });
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error searching contacts:", error);
    return JSON.stringify({
      error: "Failed to search contacts",
      details: error.message,
    });
  } finally {
    await safeRelease(sqlClient);
  }
}

async function tagContact(idSubstring, phoneNumber, tag) {
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const fetchQuery = `
      SELECT tags 
      FROM public.contacts 
      WHERE company_id = $1 AND phone = $2
      LIMIT 1
    `;

    const fetchResult = await sqlClient.query(fetchQuery, [
      idSubstring,
      phoneNumber,
    ]);

    if (fetchResult.rows.length === 0) {
      console.log(`No contact found for number: ${phoneNumber}`);
      await safeRollback(sqlClient);
      return JSON.stringify({
        error: "Contact not found",
        details: `No contact found for number: ${phoneNumber}. Please check the number and try again.`,
      });
    }

    const currentTags = fetchResult.rows[0].tags || [];

    const newTags = [...new Set([...currentTags, tag])];

    const updateQuery = `
      UPDATE public.contacts 
      SET tags = $1, last_updated = CURRENT_TIMESTAMP
      WHERE company_id = $2 AND phone = $3
      RETURNING tags
    `;

    const updateResult = await sqlClient.query(updateQuery, [
      JSON.stringify(newTags),
      idSubstring,
      phoneNumber,
    ]);

    await sqlClient.query("COMMIT");

    return JSON.stringify({
      success: true,
      message: `Contact ${phoneNumber} tagged with "${tag}"`,
      updatedTags: updateResult.rows[0].tags,
    });
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error tagging contact:", error);
    return JSON.stringify({
      error: "Failed to tag contact",
      details: error.message,
    });
  } finally {
    await safeRelease(sqlClient);
  }
}

async function addPointsForBottlesBought(
  phoneNumber,
  idSubstring,
  bottlesBought
) {
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const checkQuery = `
      SELECT points 
      FROM public.contacts 
      WHERE phone = $1 AND company_id = $2
      LIMIT 1
    `;

    const checkResult = await sqlClient.query(checkQuery, [
      phoneNumber,
      idSubstring,
    ]);

    if (checkResult.rows.length === 0) {
      await safeRollback(sqlClient);
      return JSON.stringify({ error: "Contact not found" });
    }

    const currentPoints = checkResult.rows[0].points || 0;
    const newPoints = currentPoints + bottlesBought * 5;

    const updateQuery = `
      UPDATE public.contacts 
      SET points = $1, last_updated = CURRENT_TIMESTAMP
      WHERE phone = $2 AND company_id = $3
      RETURNING points
    `;

    const updateResult = await sqlClient.query(updateQuery, [
      newPoints,
      phoneNumber,
      idSubstring,
    ]);

    await sqlClient.query("COMMIT");

    return JSON.stringify({
      success: true,
      message: `Added ${
        bottlesBought * 5
      } points for ${bottlesBought} bottles bought.`,
      newPoints: updateResult.rows[0].points,
    });
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error adding points for bottles bought:", error);
    return JSON.stringify({
      error: "Failed to add points for bottles bought",
      details: error.message,
    });
  } finally {
    await safeRelease(sqlClient);
  }
}

async function checkSpreadsheetDCAuto(
  client,
  phoneNumber,
  model,
  year,
  idSubstring
) {
  console.log("Checking spreadsheet DC STOCKLIST...");
  let matchingVehicles = [];
  const currentDate = new Date();
  let currentMonth = currentDate.getMonth();
  let currentYear = currentDate.getFullYear();
  const monthNames = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const monthName = monthNames[currentMonth];
  const yearShort = currentYear % 100;
  const sheetName = `${monthName}${yearShort}`;

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: "1_TRVagJQByunDqy1XhnkVwnLOIZjI4HfCR-n7w7AfHU",
      range: `${sheetName}!A:J`,
    });

    const rows = response.data.values;
    if (!rows) {
      console.log("No data found.");
      return "No data found in the spreadsheet.";
    }

    // Split the model into words and convert to lowercase
    const modelWords = model.toLowerCase().split(/\s+/);

    // Skip header row
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Check if the row includes the words "CAR SOLD"
      if (row.some((cell) => cell.includes("CAR SOLD"))) {
        console.log('Found a row with "CAR SOLD":', row);
        break;
      }
      if (row.length < 2) continue;

      const [
        inStock,
        modelInSheet,
        plateNo,
        yearInSheet,
        dateIn,
        priceBefore,
        sellingPrice,
        picture,
        advertisement,
        mudahLink,
      ] = row;

      // Convert the model in sheet to lowercase and split into words
      const modelInSheetWords = modelInSheet.toLowerCase().split(/\s+/);

      // Check if all words from the search model are present in the sheet model
      const allWordsPresent = modelWords.every((word) =>
        modelInSheetWords.some((sheetWord) => sheetWord.includes(word))
      );

      if (
        allWordsPresent &&
        (!year || String(yearInSheet).includes(String(year)))
      ) {
        if (inStock.toLowerCase() === "true") {
          matchingVehicles.push({
            model: modelInSheet,
            year: yearInSheet,
            pictureLink: advertisement,
            inStock: true,
          });
        }
      }
    }

    if (matchingVehicles.length > 0) {
      console.log(`Found ${matchingVehicles.length} matching vehicles.`);
      return JSON.stringify(matchingVehicles);
    } else {
      console.log(
        `No vehicles found matching model "${model}"${
          year ? ` and year "${year}"` : ""
        }.`
      );
      return `No vehicles found matching model "${model}"${
        year ? ` and year "${year}"` : ""
      }.`;
    }
  } catch (error) {
    console.error("Error checking spreadsheet:", error);
    return "Error checking vehicle inventory.";
  }
}

async function updateCustomFieldInDatabase(
  idSubstring,
  phoneNumber,
  fieldName,
  fieldValue
) {
  console.log(`Updating custom field for company ${idSubstring}...`);
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const checkQuery = `
      SELECT custom_fields 
      FROM public.contacts 
      WHERE phone = $1 AND company_id = $2
      LIMIT 1
    `;

    const checkResult = await sqlClient.query(checkQuery, [
      phoneNumber,
      idSubstring,
    ]);

    if (checkResult.rows.length === 0) {
      await safeRollback(sqlClient);
      console.log(
        `No contact found for phone number ${phoneNumber} in company ${idSubstring}.`
      );
      return "Contact not found";
    }

    const currentCustomFields = checkResult.rows[0].custom_fields || {};

    currentCustomFields[fieldName] = fieldValue;

    const updateQuery = `
      UPDATE public.contacts 
      SET custom_fields = $1, last_updated = CURRENT_TIMESTAMP
      WHERE phone = $2 AND company_id = $3
    `;

    await sqlClient.query(updateQuery, [
      JSON.stringify(currentCustomFields),
      phoneNumber,
      idSubstring,
    ]);

    await sqlClient.query("COMMIT");

    console.log(
      `Successfully updated custom field '${fieldName}' with value '${fieldValue}' for Company ${idSubstring} at ID ${phoneNumber}`
    );

    return "Custom field updated successfully";
  } catch (error) {
    await safeRollback(sqlClient);
    console.error(
      `Error updating custom field in database for Company ${idSubstring} at ID ${phoneNumber}:`,
      error
    );
    return "Failed to update custom field.";
  } finally {
    await safeRelease(sqlClient);
  }
}

async function getCustomFieldsFromDatabase(idSubstring, phoneNumber) {
  console.log(`Retrieving custom fields for company ${idSubstring}...`);
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const query = `
      SELECT custom_fields 
      FROM public.contacts 
      WHERE phone = $1 AND company_id = $2
      LIMIT 1
    `;

    const result = await sqlClient.query(query, [phoneNumber, idSubstring]);

    await sqlClient.query("COMMIT");

    if (result.rows.length === 0) {
      console.log(
        `No contact found for phone number ${phoneNumber} in company ${idSubstring}.`
      );
      return { error: "Contact not found" };
    }

    const customFields = result.rows[0].custom_fields || {};

    console.log(
      `Retrieved custom fields for phone number ${phoneNumber}:`,
      customFields
    );
    return customFields;
  } catch (error) {
    await safeRollback(sqlClient);
    console.error(
      `Error retrieving custom fields for Company ${idSubstring} at ID ${phoneNumber}:`,
      error
    );
    return { error: "Failed to retrieve custom fields" };
  } finally {
    await safeRelease(sqlClient);
  }
}

async function getAvailableEvents(idSubstring) {
  try {
    console.log(`Fetching available events for company: ${idSubstring}`);

    const eventsResult = await sql`
      SELECT name, slug, start_date, end_date, location, description
      FROM public.events 
      WHERE company_id = ${idSubstring}
      AND is_active = true
      ORDER BY start_date ASC
    `;

    if (eventsResult.length === 0) {
      return JSON.stringify({
        success: false,
        message: "No active events found for this company",
      });
    }

    const events = eventsResult.map((event) => ({
      name: event.name,
      slug: event.slug,
      startDate: event.start_date,
      endDate: event.end_date,
      location: event.location,
      description: event.description,
    }));

    return JSON.stringify({
      success: true,
      events: events,
      totalEvents: events.length,
    });
  } catch (error) {
    console.error("Error fetching available events:", error);
    return JSON.stringify({
      success: false,
      error: "Failed to fetch available events",
      details: error.message,
    });
  }
}

async function setAttendance(idSubstring, eventName, phoneNumber) {
  try {
    console.log(
      `Setting attendance for event: ${eventName}, participant: ${phoneNumber}`
    );

    // First, try exact match (case-insensitive)
    let eventResult = await sql`
      SELECT id, slug, name
      FROM public.events 
      WHERE LOWER(name) = LOWER(${eventName}) 
      AND company_id = ${idSubstring}
      AND is_active = true
      LIMIT 1
    `;

    // If no exact match, try fuzzy matching with LIKE/includes
    if (eventResult.length === 0) {
      console.log(
        `No exact match found for "${eventName}", trying fuzzy matching...`
      );

      eventResult = await sql`
        SELECT id, slug, name
        FROM public.events 
        WHERE LOWER(name) LIKE LOWER(${"%" + eventName + "%"})
        AND company_id = ${idSubstring}
        AND is_active = true
        ORDER BY LENGTH(name) ASC
        LIMIT 5
      `;

      // If still no match, get all available events to show user
      if (eventResult.length === 0) {
        console.log(
          `No fuzzy match found for "${eventName}", fetching all available events...`
        );

        const allEventsResult = await sql`
          SELECT name, slug, start_date, end_date, location
          FROM public.events 
          WHERE company_id = ${idSubstring}
          AND is_active = true
          ORDER BY start_date ASC
        `;

        const availableEvents = allEventsResult.map((event) => ({
          name: event.name,
          startDate: event.start_date,
          endDate: event.end_date,
          location: event.location,
        }));

        return JSON.stringify({
          success: false,
          error: `No event found matching "${eventName}"`,
          message: "Please specify the exact event name from the list below:",
          availableEvents: availableEvents,
        });
      }

      // If multiple fuzzy matches found, ask user to be more specific
      if (eventResult.length > 1) {
        const matchedEvents = eventResult.map((event) => ({
          name: event.name,
          id: event.id,
        }));

        return JSON.stringify({
          success: false,
          error: `Multiple events found matching "${eventName}"`,
          message: "Please specify which event you mean:",
          matchedEvents: matchedEvents,
        });
      }
    }

    const event = eventResult[0];
    console.log(`Found event: ${event.name} (ID: ${event.id})`);

    // Check if attendance record already exists
    const existingAttendance = await sql`
      SELECT id 
      FROM public.attendance_records 
      WHERE event_id = ${event.id} 
      AND phone_number = ${phoneNumber}
      AND company_id = ${idSubstring}
      LIMIT 1
    `;

    if (existingAttendance.length > 0) {
      return JSON.stringify({
        success: false,
        message: `Attendance already recorded for ${phoneNumber} at event "${event.name}"`,
      });
    }

    // Insert new attendance record
    const attendanceResult = await sql`
      INSERT INTO public.attendance_records (
        event_id, 
        event_slug, 
        phone_number, 
        company_id,
        confirmed_at
      ) VALUES (
        ${event.id},
        ${event.slug},
        ${phoneNumber},
        ${idSubstring},
        NOW()
      )
      RETURNING id, confirmed_at
    `;

    console.log(
      `Successfully recorded attendance for ${phoneNumber} at event "${event.name}"`
    );

    return JSON.stringify({
      success: true,
      message: `Attendance confirmed for ${phoneNumber} at event "${event.name}"`,
      attendanceId: attendanceResult[0].id,
      confirmedAt: attendanceResult[0].confirmed_at,
      eventName: event.name,
    });
  } catch (error) {
    console.error("Error setting attendance:", error);
    return JSON.stringify({
      success: false,
      error: "Failed to record attendance",
      details: error.message,
    });
  }
}

async function handleToolCalls(
  toolCalls,
  idSubstring,
  client,
  phoneNumber,
  name,
  companyName,
  contact,
  threadID,
  companyConfig
) {
  console.log("Handling tool calls...");
  console.log(idSubstring);
  const toolOutputs = [];
  for (const toolCall of toolCalls) {
    console.log(`Processing tool call: ${toolCall.function.name}`);
    switch (toolCall.function.name) {
      case "checkSpreadsheetDCAuto":
        try {
          console.log("Checking Spreadsheet...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await checkSpreadsheetDCAuto(
            client,
            phoneNumber,
            args.model,
            args.modelYear,
            idSubstring
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for checkSpreadsheetDCAuto:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "sendFeedbackToGroup":
        if (idSubstring === "0128") {
          try {
            console.log("Sending feedback to group...");
            const args = JSON.parse(toolCall.function.arguments);
            const result = await sendFeedbackToGroup(
              client,
              args.feedback,
              name,
              phoneNumber,
              idSubstring
            );
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: result,
            });
          } catch (error) {
            console.error(
              "Error in handleToolCalls for sendFeedbackToGroup:",
              error
            );
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ error: error.message }),
            });
          }
        }
        break;
      case "sendImage":
        try {
          console.log("Sending image...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await sendImage(
            client,
            phoneNumber,
            args.imageUrl,
            args.caption,
            idSubstring
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error("Error in handleToolCalls for sendImage:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "addPointsForBottlesBought":
        try {
          console.log("Adding points for bottles bought...");
          const args = JSON.parse(toolCall.function.arguments);

          // Ensure all required fields are provided
          if (!args.bottlesBought) {
            throw new Error("Missing required fields for adding points");
          }

          const result = await addPointsForBottlesBought(
            phoneNumber,
            idSubstring,
            args.bottlesBought
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for addPointsForBottlesBought:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "testDailyReminders":
        try {
          console.log("Testing daily reminders...");
          const result = await testDailyReminders(client, idSubstring);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for testDailyReminders:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "deleteTask":
        try {
          console.log("Deleting task...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await deleteTask(idSubstring, args.taskIndex);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error("Error in handleToolCalls for deleteTask:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "editTask":
        try {
          console.log("Editing task...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await editTask(
            idSubstring,
            args.taskIndex,
            args.newTaskString,
            args.newAssignee,
            args.newDueDate
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error("Error in handleToolCalls for editTask:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "listAssignedTasks":
        try {
          console.log("Listing assigned tasks...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await listAssignedTasks(idSubstring, args.assignee);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for listAssignedTasks:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "searchContacts":
        try {
          console.log("Searching contacts...");
          const args = JSON.parse(toolCall.function.arguments);
          const searchResults = await searchContacts(
            idSubstring,
            args.searchTerm
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: searchResults,
          });
        } catch (error) {
          console.error("Error in handleToolCalls for searchContacts:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "tagContact":
        try {
          console.log("Tagging contact...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await tagContact(
            idSubstring,
            args.phoneNumber,
            args.tag
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error("Error in handleToolCalls for tagContact:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "getContactsAddedToday":
        try {
          console.log("Getting contacts added today...");
          const result = await getContactsAddedToday(idSubstring);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for getContactsAddedToday:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "listAssignedContacts":
        try {
          console.log("Listing assigned contacts...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await listAssignedContacts(
            idSubstring,
            args.assigneeName,
            args.limit
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for listAssignedContacts:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "listContactsWithTag":
        try {
          console.log("Listing contacts with tag...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await listContactsWithTag(
            idSubstring,
            args.tag,
            args.limit
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for listContactsWithTag:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "searchWeb":
        try {
          console.log("Searching the web...");
          const args = JSON.parse(toolCall.function.arguments);
          const searchResults = await searchWeb(args.query);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: searchResults,
          });
        } catch (error) {
          console.error("Error in handleToolCalls for searchWeb:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "checkAvailableTimeSlots":
        try {
          console.log("\n=== START: checkAvailableTimeSlots Tool Call ===");
          const now = moment().tz("Asia/Kuala_Lumpur");
          console.log(
            `Tool Call - Current date and time (KL): ${now.format(
              "dddd, YYYY-MM-DD HH:mm:ss"
            )}`
          );

          // Parse and validate the requested date if provided
          const args = JSON.parse(toolCall.function.arguments);
          const requestedDate = args.specificDate
            ? moment(args.specificDate).tz("Asia/Kuala_Lumpur")
            : null;

          console.log("Tool Call - Current day:", now.format("dddd"));
          console.log(
            "Tool Call - Requested date:",
            requestedDate
              ? requestedDate.format("dddd, YYYY-MM-DD")
              : "No specific date requested"
          );

          // Call the function and get result
          const result = await checkAvailableTimeSlots(
            idSubstring,
            args.specificDate,
            contact,
            client
          );

          if (Array.isArray(result) && result.length > 0) {
            console.log(
              `Tool Call - Found ${
                result.length
              } available slots for ${now.format("dddd")}`
            );
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({
                success: true,
                availableSlots: result,
              }),
            });
          } else {
            console.log(
              `Tool Call - No available slots found for ${now.format("dddd")}`
            );
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({
                success: false,
                message: result,
              }),
            });
          }
          console.log("=== END: checkAvailableTimeSlots Tool Call ===\n");
        } catch (error) {
          console.error(
            "Error in handleToolCalls for checkAvailableTimeSlots:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "createCalendarEvent":
        try {
          console.log("Parsing arguments for createCalendarEvent...");
          const args = JSON.parse(toolCall.function.arguments);
          console.log("Arguments:", args);
          console.log(
            "Phone Number in createCalendarEvent before function call...  " +
              phoneNumber
          );
          console.log("Calling createCalendarEvent...");
          const result = await createCalendarEvent(
            args.summary,
            args.description,
            args.startDateTime,
            args.endDateTime,
            phoneNumber,
            companyName,
            idSubstring,
            contact,
            client
          );

          if (result.error) {
            if (result.error === "Scheduling conflict detected") {
              console.log(
                "Scheduling conflict detected, preparing conflict information..."
              );
              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({
                  error: result.error,
                  conflictingAppointments: result.conflictingAppointments,
                }),
              });
            } else {
              console.error("Error creating event:", result.error);
              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({ error: result.error }),
              });
            }
          } else {
            console.log("Event created successfully, preparing tool output...");
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(result),
            });
          }
        } catch (error) {
          console.error("Error in handleToolCalls for createCalendarEvent:");
          console.error(error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "rescheduleCalendarEvent":
        try {
          console.log("Parsing arguments for rescheduleCalendarEvent...");
          const args = JSON.parse(toolCall.function.arguments);
          console.log("Arguments:", args);
          console.log(
            "Phone Number in rescheduleCalendarEvent before function call...  " +
              phoneNumber
          );
          console.log("Calling rescheduleCalendarEvent...");
          const result = await rescheduleCalendarEvent(
            args.newStartDateTime,
            args.newEndDateTime,
            phoneNumber,
            contact.name,
            companyName,
            idSubstring,
            contact,
            client,
            args.reason,
            args.appointmentDate
          );

          if (result.error) {
            if (result.error === "Scheduling conflict detected") {
              console.log(
                "Scheduling conflict detected, preparing conflict information..."
              );
              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({
                  error: result.error,
                  conflictingAppointments: result.conflictingAppointments,
                  message: result.message,
                }),
              });
            } else if (
              result.error === "Multiple appointments found on this date"
            ) {
              console.log(
                "Multiple appointments found, sending list to user..."
              );
              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({
                  error: result.error,
                  multipleAppointments: result.multipleAppointments,
                  message: result.message,
                }),
              });
            } else {
              console.error("Error rescheduling event:", result.error);
              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({ error: result.error }),
              });
            }
          } else {
            console.log(
              "Event rescheduled successfully, preparing tool output..."
            );
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(result),
            });
          }
        } catch (error) {
          console.error(
            "Error in handleToolCalls for rescheduleCalendarEvent:"
          );
          console.error(error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "cancelCalendarEvent":
        try {
          console.log("Parsing arguments for cancelCalendarEvent...");
          const args = JSON.parse(toolCall.function.arguments);
          console.log("Arguments:", args);
          console.log(
            "Phone Number in cancelCalendarEvent before function call...  " +
              phoneNumber
          );
          console.log("Calling cancelCalendarEvent...");
          const result = await cancelCalendarEvent(
            phoneNumber,
            contact.name,
            companyName,
            idSubstring,
            contact,
            client,
            args.reason,
            args.appointmentDateandTime
          );

          if (result.error) {
            if (result.error === "Multiple appointments found on this date") {
              console.log(
                "Multiple appointments found, sending list to user..."
              );
              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({
                  error: result.error,
                  multipleAppointments: result.multipleAppointments,
                  message: result.message,
                }),
              });
            } else {
              console.error("Error canceling event:", result.error);
              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({ error: result.error }),
              });
            }
          } else {
            console.log(
              "Event cancelled successfully, preparing tool output..."
            );
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(result),
            });
          }
        } catch (error) {
          console.error("Error in handleToolCalls for cancelCalendarEvent:");
          console.error(error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "searchUpcomingAppointments":
        try {
          console.log("Searching for upcoming appointments...");
          const args = JSON.parse(toolCall.function.arguments);
          console.log("Arguments:", args);
          console.log(
            "Phone Number in searchUpcomingAppointments...  " + phoneNumber
          );

          const result = await searchUpcomingAppointments(
            phoneNumber,
            idSubstring,
            args.limit || 10
          );

          console.log("Search completed, preparing tool output...");
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for searchUpcomingAppointments:"
          );
          console.error(error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "getTodayDate":
        console.log("Getting today's date...");
        const todayDate = getTodayDate();
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify({ date: todayDate }),
        });
        break;
      case "fetchContactData":
        try {
          console.log("Fetching contact data...");
          const args = JSON.parse(toolCall.function.arguments);
          const contactData = await fetchContactData(
            args.phoneNumber,
            idSubstring
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: contactData,
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for fetchContactData:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "getTotalContacts":
        try {
          console.log("Getting total contacts...");
          const totalContacts = await getTotalContacts(idSubstring);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ totalContacts }),
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for getTotalContacts:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "addTask":
        try {
          console.log("Adding task...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await addTask(
            idSubstring,
            args.taskString,
            args.assignee,
            args.dueDate
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error("Error in handleToolCalls for addTask:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "listTasks":
        try {
          console.log("Listing tasks...");
          const result = await listTasks(idSubstring);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error("Error in handleToolCalls for listTasks:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "updateTaskStatus":
        try {
          console.log("Updating task status...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await updateTaskStatus(
            idSubstring,
            args.taskIndex,
            args.newStatus
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for updateTaskStatus:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "fetchMultipleContactsData":
        try {
          console.log("Fetching multiple contacts data...");
          const args = JSON.parse(toolCall.function.arguments);
          const contactsData = await fetchMultipleContactsData(
            args.phoneNumbers,
            idSubstring
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: contactsData,
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for fetchMultipleContactsData:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "listContacts":
        try {
          console.log("Listing contacts...");
          const args = JSON.parse(toolCall.function.arguments);
          const contactsList = await listContacts(
            idSubstring,
            args.limit,
            args.offset
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: contactsList,
          });
        } catch (error) {
          console.error("Error in handleToolCalls for listContacts:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "sendRescheduleRequest":
        try {
          console.log("Parsing arguments for sendRescheduleRequest...");
          const args = JSON.parse(toolCall.function.arguments);
          console.log("Arguments:", args);
          console.log("Calling sendRescheduleRequest...");

          const result = await sendRescheduleRequest(
            args.requestedDate,
            args.requestedTime,
            phoneNumber,
            companyName,
            idSubstring,
            contact,
            client
          );

          if (result.error) {
            console.error("Error sending Reschedule Request:", result.error);
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ error: result.error }),
            });
          } else {
            console.log(
              "sendRescheduleRequest sent successfully, preparing tool output..."
            );
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(result),
            });
          }
        } catch (error) {
          console.error("Error in handleToolCalls for sendRescheduleRequest:");
          console.error(error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "sendInquiryToGroupNewTown":
        try {
          const report = await generateInquiryReportNewTown(
            threadID,
            companyConfig.assistantId
          );
          const sentMessage = await client.sendMessage(
            "120363107024888999@g.us",
            report
          );
          await addMessageToPostgres(
            sentMessage,
            idSubstring,
            "+120363107024888999"
          );

          // Add inquiry tag to contact in Firebase
          await addTagToPostgres(phoneNumber, "inquiry", idSubstring);

          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({
              success: true,
              message: "Inquiry sent to group successfully for NewTown",
            }),
          });
        } catch (error) {
          console.error("Error in sendInquiryToGroupNewTown:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "assignContactAndGenerateReportNewTown":
        try {
          // Generate and send report
          const report = await generateSpecialReportNewTown(
            threadID,
            companyConfig.assistantId
          );
          const sentMessage = await client.sendMessage(
            "120363107024888999@g.us",
            report
          );
          await addMessageToPostgres(
            sentMessage,
            idSubstring,
            "+120363107024888999"
          );

          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({
              success: true,
              message: "Contact report generated successfully for NewTown",
            }),
          });
        } catch (error) {
          console.error(
            "Error in assignContactAndGenerateReportNewTown:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "sendFeedbackToGroupNewTown":
        try {
          console.log("Sending feedback to group for NewTown...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await sendFeedbackToGroupNewTown(
            client,
            args.feedback,
            name,
            phoneNumber,
            idSubstring
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for sendFeedbackToGroupNewTown:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "updateCustomFields":
        try {
          console.log(
            `Updating Custom Fields using ToolCalls for Company ${idSubstring}...`
          );
          const args = JSON.parse(toolCall.function.arguments);

          if (!Array.isArray(args.customFields)) {
            throw new Error("customFields must be an array");
          }

          for (const field of args.customFields) {
            if (!field.key || !field.value) {
              throw new Error("Each custom field must have a key and a value");
            }
            console.log(`Updating custom field: ${field.key} = ${field.value}`);
            await updateCustomFieldInDatabase(
              idSubstring,
              phoneNumber,
              field.key,
              field.value
            );
          }

          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({
              success: true,
              message: "Custom fields updated successfully",
            }),
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for updateCustomFields:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "getCustomFields":
        try {
          console.log(`Retrieving Custom Fields for Company ${idSubstring}...`);
          const result = await getCustomFieldsFromDatabase(
            idSubstring,
            phoneNumber
          );

          if (result.error) {
            throw new Error(result.error);
          }

          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ success: true, customFields: result }),
          });
        } catch (error) {
          console.error("Error in handleToolCalls for getCustomFields:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "manageContactTags":
        try {
          console.log("Managing contact tags...");
          const args = JSON.parse(toolCall.function.arguments);
          console.log("Arguments:", args);

          const isRemove = args.action === "remove";
          const contactID = phoneNumber.startsWith("+")
            ? phoneNumber.slice(1)
            : phoneNumber;

          const result = await addTagToPostgres(
            contactID,
            args.tag,
            idSubstring,
            isRemove
          );

          const successMessage = isRemove
            ? `Tag "${args.tag}" removed successfully from contact ${args.phoneNumber}`
            : `Tag "${args.tag}" added successfully to contact ${args.phoneNumber}`;

          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({
              success: true,
              message: successMessage,
              action: args.action,
              tag: args.tag,
              phoneNumber: phoneNumber,
            }),
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for manageContactTags:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({
              success: false,
              error: error.message,
              action: JSON.parse(toolCall.function.arguments).action,
              tag: JSON.parse(toolCall.function.arguments).tag,
              phoneNumber: phoneNumber,
            }),
          });
        }
        break;
      case "getAvailableEvents":
        try {
          console.log("Getting available events...");
          const result = await getAvailableEvents(idSubstring);

          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for getAvailableEvents:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({
              success: false,
              error: error.message,
            }),
          });
        }
        break;
      case "setAttendance":
        try {
          console.log("Setting attendance...");
          const args = JSON.parse(toolCall.function.arguments);

          // Ensure all required fields are provided
          if (!args.eventName) {
            throw new Error("Event name is required for setting attendance");
          }

          const result = await setAttendance(
            idSubstring,
            args.eventName,
            phoneNumber
          );

          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
          });
        } catch (error) {
          console.error("Error in handleToolCalls for setAttendance:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({
              success: false,
              error: error.message,
            }),
          });
        }
        break;
      case "scheduleFollowUp":
        try {
          console.log("Scheduling follow-up...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await scheduleFollowUp(
            idSubstring,
            args.contactPhone,
            args.templateId,
            args.delayHours || 24
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for scheduleFollowUp:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "assignContactToSequence":
        try {
          console.log("Assigning contact to sequence...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await assignContactToSequence(
            idSubstring,
            args.contactPhone,
            args.sequenceId
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for assignContactToSequence:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "pauseFollowUpSequence":
        try {
          console.log("Pausing follow-up sequence...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await pauseFollowUpSequence(
            idSubstring,
            args.sequenceId
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for pauseFollowUpSequence:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "updateFollowUpStatus":
        try {
          console.log("Updating follow-up status...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await updateFollowUpStatus(
            idSubstring,
            args.followUpId,
            args.status,
            args.notes
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for updateFollowUpStatus:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "calculateDateDifference":
        try {
          console.log("Calculating date difference...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = calculateDateDifference(
            args.startDate,
            args.endDate,
            args.unit || "days"
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for calculateDateDifference:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "formatDate":
        try {
          console.log("Formatting date...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = formatDate(
            args.date,
            args.format || "YYYY-MM-DD",
            args.timezone || "Asia/Kuala_Lumpur"
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ formattedDate: result }),
          });
        } catch (error) {
          console.error("Error in handleToolCalls for formatDate:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "generateUUID":
        try {
          console.log("Generating UUID...");
          const result = generateUUID();
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ uuid: result }),
          });
        } catch (error) {
          console.error("Error in handleToolCalls for generateUUID:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "validateEmail":
        try {
          console.log("Validating email...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = validateEmail(args.email);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.error("Error in handleToolCalls for validateEmail:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "exportData":
        try {
          console.log("Exporting data...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await exportData(
            idSubstring,
            args.dataType,
            args.format || "csv",
            args.filters
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.error("Error in handleToolCalls for exportData:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "importData":
        try {
          console.log("Importing data...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await importData(
            idSubstring,
            args.dataType,
            args.fileUrl,
            args.format || "csv"
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.error("Error in handleToolCalls for importData:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "sendNotification":
        try {
          console.log("Sending notification...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await sendNotification(
            idSubstring,
            args.recipient,
            args.message,
            args.type || "info"
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for sendNotification:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "sendWhatsAppMessage":
        try {
          console.log("Sending WhatsApp message...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await sendWhatsAppMessage(
            args.contactId,
            args.message,
            idSubstring,
            args.quotedMessageId,
            args.phoneIndex || 0
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.error(
            "Error in handleToolCalls for sendWhatsAppMessage:",
            error
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      case "scheduleMessage":
        try {
          console.log("Scheduling message...");
          const args = JSON.parse(toolCall.function.arguments);
          const result = await scheduleMessage(
            idSubstring,
            args.contactIds,
            args.message,
            args.scheduledTime,
            args.mediaUrl,
            args.documentUrl,
            args.fileName,
            args.caption,
            args.batchQuantity,
            args.repeatInterval,
            args.repeatUnit,
            args.minDelay,
            args.maxDelay,
            args.infiniteLoop,
            args.activateSleep,
            args.sleepAfterMessages,
            args.sleepDuration,
            args.activeHours,
            args.phoneIndex || 0,
            args.templateId,
            phoneNumber // Pass the current user's phone number
          );
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.error("Error in handleToolCalls for scheduleMessage:", error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
          });
        }
        break;
      default:
        console.warn(`Unknown function called: ${toolCall.function.name}`);
    }
  }
  console.log("Finished handling tool calls");
  return toolOutputs;
}
async function analyzeAndSetUserProfile(phoneNumber, threadId, idSubstring) {
  try {
    console.log("\n=== Starting User Profile Analysis ===");
    console.log("Parameters:", { phoneNumber, threadId, idSubstring });

    // Fetch chat history
    console.log("Fetching chat history...");
    const chatHistory = await fetchRecentChatHistory(threadId);
    console.log("Chat history retrieved:", {
      messageCount: chatHistory.length,
      firstMessage: chatHistory[0],
      lastMessage: chatHistory[chatHistory.length - 1],
    });

    // Create profiling thread
    console.log("Creating new profiling thread...");
    const profilingThread = await openai.beta.threads.create();
    console.log("Profiling thread created:", profilingThread.id);

    // Add chat history to thread
    console.log("Adding chat history to profiling thread...");
    const messageResponse = await openai.beta.threads.messages.create(
      profilingThread.id,
      {
        role: "user",
        content: JSON.stringify(chatHistory),
      }
    );
    console.log("Chat history added to thread:", {
      messageId: messageResponse.id,
      threadId: profilingThread.id,
    });

    // Run profiling assistant
    console.log("Starting profiling assistant run...");
    console.log("Using assistant ID: asst_7lGVVUEwLNiZz0V55kuPGddR");
    const run = await openai.beta.threads.runs.create(profilingThread.id, {
      assistant_id: "asst_7lGVVUEwLNiZz0V55kuPGddR",
    });
    console.log("Profiling run created:", {
      runId: run.id,
      status: run.status,
    });

    // Wait for completion
    console.log("Waiting for profiling completion...");
    const profile = await waitForProfilingCompletion(
      profilingThread.id,
      run.id
    );
    console.log("Received profile data:", profile);

    // Parse profile data
    console.log("Parsing profile data...");
    const profileData = JSON.parse(profile);
    console.log("Parsed profile data:", profileData);

    // Update Firebase
    console.log("Updating user profile in Firebase...");
    await setUserProfile(idSubstring, phoneNumber, profileData);
    console.log("Firebase update completed");

    console.log("=== User Profile Analysis Completed Successfully ===\n");
    return JSON.stringify({
      success: true,
      message: "User profile updated",
    });
  } catch (error) {
    console.error("\n=== Error in User Profile Analysis ===");
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      phoneNumber,
      threadId,
      idSubstring,
    });
    console.error("=== End Error Report ===\n");
    return JSON.stringify({
      error: "Internal process completed",
      details: error.message,
    });
  }
}

async function waitForProfilingCompletion(threadId, runId) {
  const maxAttempts = 30;
  const pollingInterval = 2000;

  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    try {
      const runStatus = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
      );

      if (runStatus.status === "completed") {
        const messages = await openai.beta.threads.messages.list(threadId);
        const latestMessage = messages.data[0].content[0].text.value;

        // Try to extract JSON from the message
        try {
          // Remove any markdown formatting and find JSON content
          const cleanedMessage = latestMessage
            .replace(/\*\*/g, "") // Remove markdown bold
            .replace(/\*/g, "") // Remove markdown italic
            .trim();

          // If the message doesn't look like JSON, wrap it in a structure
          if (!cleanedMessage.startsWith("{")) {
            return JSON.stringify({
              profileAnalysis: cleanedMessage,
            });
          }

          // Test if it's valid JSON
          JSON.parse(cleanedMessage);
          return cleanedMessage;
        } catch (parseError) {
          console.log(
            "Error parsing assistant response, wrapping in JSON structure:",
            latestMessage
          );
          return JSON.stringify({
            profileAnalysis: latestMessage,
          });
        }
      } else if (
        ["failed", "cancelled", "expired"].includes(runStatus.status)
      ) {
        throw new Error(`Profiling analysis ${runStatus.status}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollingInterval));
    } catch (error) {
      console.error("Error in waitForProfilingCompletion:", error);
      throw error;
    }
  }

  throw new Error("Profiling analysis timed out");
}

async function setUserProfile(idSubstring, phoneNumber, profileData) {
  console.log("Setting user profile for", phoneNumber);

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const checkQuery = `
      SELECT 1 FROM public.contacts 
      WHERE contact_id = $1 AND company_id = $2
    `;
    const checkResult = await sqlClient.query(checkQuery, [
      phoneNumber,
      idSubstring,
    ]);

    if (checkResult.rows.length === 0) {
      console.log(
        `Contact ${phoneNumber} does not exist, creating new contact`
      );

      const insertQuery = `
        INSERT INTO public.contacts (contact_id, company_id, profile, last_updated)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      `;
      await sqlClient.query(insertQuery, [
        phoneNumber,
        idSubstring,
        JSON.stringify({
          ...profileData,
          lastUpdated: new Date().toISOString(),
        }),
      ]);
    } else {
      const updateQuery = `
        UPDATE public.contacts 
        SET 
          profile = CASE 
            WHEN profile IS NULL THEN $1::jsonb
            ELSE profile || $1::jsonb
          END,
          last_updated = CURRENT_TIMESTAMP
        WHERE contact_id = $2 AND company_id = $3
      `;

      const profileWithTimestamp = {
        ...profileData,
        lastUpdated: new Date().toISOString(),
      };

      await sqlClient.query(updateQuery, [
        JSON.stringify(profileWithTimestamp),
        phoneNumber,
        idSubstring,
      ]);
    }

    await sqlClient.query("COMMIT");
    console.log(`Profile updated for contact ${phoneNumber} in PostgreSQL`);
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error saving profile to PostgreSQL:", error);
    throw error;
  } finally {
    await safeRelease(sqlClient);
  }
}

async function analyzeAndSetLeadTemperature(
  phoneNumber,
  threadId,
  idSubstring
) {
  try {
    console.log("Analyzing chat history for lead temperature...", phoneNumber);
    const chatHistory = await fetchRecentChatHistory(threadId);
    const analysis = await analyzeChatsWithAI(chatHistory);
    const temperature = determineLeadTemperature(analysis);
    await setLeadTemperature(idSubstring, phoneNumber, temperature);

    // Return a simple confirmation without details
    return JSON.stringify({
      success: true,
      message: "Lead temperature updated",
    });
  } catch (error) {
    console.error("Error in analyzeAndSetLeadTemperature:", error);
    return JSON.stringify({ error: "Internal process completed" });
  }
}

async function fetchRecentChatHistory(threadId) {
  try {
    const messages = await openai.beta.threads.messages.list(threadId, {
      limit: 20,
      order: "desc",
    });

    return messages.data.map((message) => ({
      role: message.role,
      content: message.content[0].text.value,
      timestamp: message.created_at,
    }));
  } catch (error) {
    console.error("Error fetching chat history from OpenAI:", error);
    return [];
  }
}

async function analyzeChatsWithAI(chatHistory) {
  const prompt = `Analyze the following chat history and determine the lead's interest level. 
                    Consider factors such as engagement, questions asked, and expressions of interest. Finally, your final answer should be a string that categorizes their interest level into three categories: high interest, moderate interest, or low interest.
                    Chat history: ${JSON.stringify(chatHistory)}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  return response.choices[0].message.content;
}

function determineLeadTemperature(analysis) {
  const lowercaseAnalysis = analysis.toLowerCase();
  console.log(lowercaseAnalysis);
  if (
    lowercaseAnalysis.includes("high interest") ||
    lowercaseAnalysis.includes("very engaged")
  ) {
    return "hot";
  } else if (
    lowercaseAnalysis.includes("moderate interest") ||
    lowercaseAnalysis.includes("somewhat engaged")
  ) {
    return "medium";
  } else {
    return "cold";
  }
}

function removeUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v != null));
}

// Helper function to check if a tag is an employee name
async function isEmployeeTag(tag, companyId) {
  try {
    const sqlClient = await pool.connect();
    try {
      const employeeQuery = `
        SELECT id, employee_id, name FROM employees 
        WHERE company_id = $1 AND name = $2
      `;
      const result = await sqlClient.query(employeeQuery, [companyId, tag]);
      return result.rows.length > 0 ? result.rows[0] : null;
    } finally {
      await safeRelease(sqlClient);
    }
  } catch (error) {
    console.error("Error checking if tag is employee:", error);
    return null;
  }
}

async function addTagToPostgres(contactID, tag, companyID, remove = false) {
  console.log(
    `${remove ? "Removing" : "Adding"} tag "${tag}" ${
      remove ? "from" : "to"
    } PostgreSQL for contact ${contactID}`
  );
  // Ensure contactID is in the correct format
  if (!contactID.startsWith(companyID)) {
    if (contactID.startsWith("+")) {
      contactID = companyID + "-" + contactID.slice(1);
    } else {
      contactID = companyID + "-" + contactID;
    }
  }

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

    // Check if the tag is an employee name
    const employeeData = await isEmployeeTag(tag, companyID);

    if (remove) {
      // First check if the tag exists before removing
      const tagExistsQuery = `SELECT (tags ? $1) as tag_exists FROM public.contacts WHERE contact_id = $2 AND company_id = $3`;
      const tagExistsResult = await sqlClient.query(tagExistsQuery, [
        tag,
        contactID,
        companyID,
      ]);
      const tagExisted = tagExistsResult.rows[0]?.tag_exists || false;

      if (tagExisted) {
        const removeQuery = `
          UPDATE public.contacts 
          SET 
            tags = (SELECT jsonb_agg(t) FROM jsonb_array_elements_text(tags) t WHERE t != $1),
            last_updated = CURRENT_TIMESTAMP
          WHERE contact_id = $2 AND company_id = $3
        `;
        await sqlClient.query(removeQuery, [tag, contactID, companyID]);

        console.log(
          `Tag "${tag}" removed successfully from contact ${contactID}`
        );

        // If removing an employee tag, handle assignment deactivation
        if (employeeData) {
          console.log(`Deactivating assignment for employee: ${tag}`);

          // Deactivate assignment records (removed last_updated since column doesn't exist)
          const deactivateAssignmentQuery = `
            UPDATE assignments 
            SET status = 'inactive'
            WHERE company_id = $1 AND employee_id = $2 AND contact_id = $3 AND status = 'active'
          `;
          await sqlClient.query(deactivateAssignmentQuery, [
            companyID,
            employeeData.employee_id,
            contactID,
          ]);

          // Decrease employee's assigned_contacts count
          const decreaseEmployeeCountQuery = `
            UPDATE employees
            SET assigned_contacts = GREATEST(assigned_contacts - 1, 0)
            WHERE company_id = $1 AND employee_id = $2
          `;
          await sqlClient.query(decreaseEmployeeCountQuery, [
            companyID,
            employeeData.employee_id,
          ]);

          // Update monthly assignments (decrease)
          const currentDate = new Date();
          const currentMonthKey = `${currentDate.getFullYear()}-${(
            currentDate.getMonth() + 1
          )
            .toString()
            .padStart(2, "0")}`;

          const monthlyAssignmentUpdateQuery = `
            UPDATE employee_monthly_assignments
            SET assignments_count = GREATEST(assignments_count - 1, 0),
                last_updated = CURRENT_TIMESTAMP
            WHERE employee_id = $1 AND month_key = $2
          `;
          await sqlClient.query(monthlyAssignmentUpdateQuery, [
            employeeData.id,
            currentMonthKey,
          ]);
        }
      } else {
        console.log(`Tag "${tag}" doesn't exist for contact ${contactID}`);
      }
    } else {
      // First check if the tag already exists before adding
      const tagExistsQuery = `SELECT (tags ? $1) as tag_exists FROM public.contacts WHERE contact_id = $2 AND company_id = $3`;
      const tagExistsResult = await sqlClient.query(tagExistsQuery, [
        tag,
        contactID,
        companyID,
      ]);
      const tagAlreadyExists = tagExistsResult.rows[0]?.tag_exists || false;

      if (!tagAlreadyExists) {
        const addQuery = `
          UPDATE public.contacts 
          SET 
            tags = CASE 
              WHEN tags IS NULL THEN jsonb_build_array($1::text)
              ELSE tags || jsonb_build_array($1::text)
            END,
            last_updated = CURRENT_TIMESTAMP
          WHERE contact_id = $2 AND company_id = $3
        `;
        await sqlClient.query(addQuery, [tag, contactID, companyID]);

        console.log(`Tag "${tag}" added successfully to contact ${contactID}`);

        // If adding an employee tag, handle assignment creation
        if (employeeData) {
          console.log(`Creating assignment for employee: ${tag}`);

          const currentDate = new Date();
          const currentMonthKey = `${currentDate.getFullYear()}-${(
            currentDate.getMonth() + 1
          )
            .toString()
            .padStart(2, "0")}`;

          const assignmentId = `${companyID}-${contactID}-${
            employeeData.employee_id
          }-${Date.now()}`;

          // Create assignment record
          const assignmentInsertQuery = `
            INSERT INTO assignments (
              assignment_id, company_id, employee_id, contact_id, 
              assigned_at, status, month_key, assignment_type, 
              phone_index, weightage_used
            ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'active', $5, 'tag_add', 0, 1)
          `;

          await sqlClient.query(assignmentInsertQuery, [
            assignmentId,
            companyID,
            employeeData.employee_id,
            contactID,
            currentMonthKey,
          ]);

          // Increase employee's assigned_contacts count
          const increaseEmployeeCountQuery = `
            UPDATE employees
            SET assigned_contacts = assigned_contacts + 1
            WHERE company_id = $1 AND employee_id = $2
          `;
          await sqlClient.query(increaseEmployeeCountQuery, [
            companyID,
            employeeData.employee_id,
          ]);

          // Update monthly assignments (increase)
          const monthlyAssignmentUpsertQuery = `
            INSERT INTO employee_monthly_assignments (employee_id, company_id, month_key, assignments_count, last_updated)
            VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP)
            ON CONFLICT (employee_id, month_key) DO UPDATE
            SET assignments_count = employee_monthly_assignments.assignments_count + 1,
                last_updated = CURRENT_TIMESTAMP
          `;

          await sqlClient.query(monthlyAssignmentUpsertQuery, [
            employeeData.id,
            companyID,
            currentMonthKey,
          ]);
        }
      } else {
        console.log(`Tag "${tag}" already exists for contact ${contactID}`);
      }
    }

    await sqlClient.query("COMMIT");
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error managing tags in PostgreSQL:", error);
    throw error;
  } finally {
    await safeRelease(sqlClient);
  }
}

async function setLeadTemperature(idSubstring, phoneNumber, temperature) {
  console.log(
    `Setting lead temperature "${temperature}" for contact ${phoneNumber} in PostgreSQL`
  );

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const leadTemperatureTags = ["cold", "medium", "hot"];
    const contactID = `${idSubstring}-${
      phoneNumber.startsWith("+") ? phoneNumber.slice(1) : phoneNumber
    }`;

    const checkQuery = `
      SELECT tags FROM public.contacts 
      WHERE contact_id = $1 AND company_id = $2
    `;
    const checkResult = await sqlClient.query(checkQuery, [
      contactID,
      idSubstring,
    ]);

    if (checkResult.rows.length === 0) {
      throw new Error(`Contact ${phoneNumber} does not exist!`);
    }

    let currentTags = checkResult.rows[0].tags || [];

    const updatedTags = Array.isArray(currentTags)
      ? currentTags.filter((tag) => !leadTemperatureTags.includes(tag))
      : [];

    updatedTags.push(temperature);

    const updateQuery = `
      UPDATE public.contacts 
      SET 
        tags = $1,
        last_updated = CURRENT_TIMESTAMP
      WHERE contact_id = $2 AND company_id = $3
    `;
    await sqlClient.query(updateQuery, [
      JSON.stringify(updatedTags),
      contactID,
      idSubstring,
    ]);

    await sqlClient.query("COMMIT");
    console.log(
      `Lead temperature "${temperature}" set for contact ${phoneNumber} in PostgreSQL`
    );
  } catch (error) {
    await safeRollback(sqlClient);
    console.error("Error setting lead temperature in PostgreSQL:", error);
  } finally {
    await safeRelease(sqlClient);
  }
}

async function updateMessageUsage(idSubstring) {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const date = now.toISOString().split("T")[0];
    const feature = "aiMessages";

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO public.usage_logs (company_id, feature, date, usage_count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (company_id, feature, date) 
         DO UPDATE SET usage_count = usage_logs.usage_count + 1
         RETURNING usage_count`,
        [idSubstring, feature, date]
      );

      const newCount = result.rows[0].usage_count;

      console.log(`Updated message count for ${date}: ${newCount}`);

      const monthlyKey = `${year}-${month}`;
      await client.query(
        `UPDATE public.usage_logs 
         SET metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{monthly_key}',
           $1::jsonb
         )
         WHERE company_id = $2 AND feature = $3 AND date = $4`,
        [JSON.stringify(monthlyKey), idSubstring, feature, date]
      );

      await client.query("COMMIT");
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      await safeRelease(client);
    }
  } catch (error) {
    console.error("Error updating message usage:", error);
  }
}

async function handleOpenAIAssistant(
  message,
  threadID,
  tags,
  phoneNumber,
  idSubstring,
  client,
  name,
  phoneIndex,
  companyConfig
) {
  let assistantId = companyConfig.assistantId;
  const contactData = await getContactDataFromDatabaseByPhone(
    phoneNumber,
    idSubstring
  );

  await addMessage(threadID, message);
  await updateMessageUsage(idSubstring);
  analyzeAndSetLeadTemperature(phoneNumber, threadID, idSubstring).catch(
    (error) =>
      console.error("Error in background lead temperature analysis:", error)
  );
  if (
    idSubstring === "001" ||
    idSubstring === "0145" ||
    idSubstring === "0124"
  ) {
    analyzeAndSetUserProfile(phoneNumber, threadID, idSubstring).catch(
      (error) =>
        console.error("Error in background user profile analysis:", error)
    );
  }

  const tools = [
    {
      type: "function",
      function: {
        name: "checkSpreadsheetDCAuto",
        description:
          "Check for vehicle availability in the stock list spreadsheet",
        parameters: {
          type: "object",
          properties: {
            model: {
              type: "string",
              description: "Model of the vehicle (e.g., BMW X1, HONDA CITY)",
            },
            modelYear: {
              type: "string",
              description: "The year of the vehicle (optional)",
            },
          },
          required: ["model"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "sendImage",
        description: "Send an image to a WhatsApp contact",
        parameters: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              description: "The phone number of the recipient",
            },
            imageUrl: {
              type: "string",
              description: "The URL of the image to send",
            },
            caption: {
              type: "string",
              description: "The caption for the image",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "testDailyReminders",
        description: "Test the daily reminders by sending them immediately",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "deleteTask",
        description: "Delete a task from the company's task list",
        parameters: {
          type: "object",
          properties: {
            taskIndex: {
              type: "number",
              description: "Index of the task to delete",
            },
          },
          required: ["taskIndex"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "editTask",
        description: "Edit an existing task in the company's task list",
        parameters: {
          type: "object",
          properties: {
            taskIndex: {
              type: "number",
              description: "Index of the task to edit",
            },
            newTaskString: {
              type: "string",
              description: "New task description (optional)",
            },
            newAssignee: {
              type: "string",
              description: "New person assigned to the task (optional)",
            },
            newDueDate: {
              type: "string",
              description:
                "New due date for the task (YYYY-MM-DD format, optional)",
            },
          },
          required: ["taskIndex"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "listAssignedTasks",
        description: "List tasks assigned to a specific person",
        parameters: {
          type: "object",
          properties: {
            assignee: {
              type: "string",
              description: "Name of the person assigned to the tasks",
            },
          },
          required: ["assignee"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "searchContacts",
        description: "Search for contacts based on name, phone number, or tags",
        parameters: {
          type: "object",
          properties: {
            idSubstring: {
              type: "string",
              description: "ID substring for the company",
            },
            searchTerm: {
              type: "string",
              description:
                "Term to search for in contact names, phone numbers, or tags",
            },
          },
          required: ["idSubstring", "searchTerm"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "tagContact",
        description:
          "Tag or assign a contact. Assigning a contact is done by tagging them with the assignee's name.",
        parameters: {
          type: "object",
          properties: {
            idSubstring: {
              type: "string",
              description: "ID substring for the company",
            },
            phoneNumber: {
              type: "string",
              description: "Phone number of the contact to tag or assign",
            },
            tag: {
              type: "string",
              description:
                "Tag to add to the contact. For assignments, use the assignee's name as the tag.",
            },
          },
          required: ["idSubstring", "phoneNumber", "tag"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getContactsAddedToday",
        description: "Get the number and details of contacts added today",
        parameters: {
          type: "object",
          properties: {
            idSubstring: {
              type: "string",
              description: "ID substring for the company",
            },
          },
          required: ["idSubstring"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "listAssignedContacts",
        description:
          "List contacts that are assigned to a specific person (assignment is represented by a tag with the assignee's name)",
        parameters: {
          type: "object",
          properties: {
            assigneeName: {
              type: "string",
              description:
                "The name of the person to whom contacts are assigned",
            },
            limit: {
              type: "number",
              description: "Maximum number of contacts to return (default 10)",
            },
          },
          required: ["assigneeName"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "listContactsWithTag",
        description: "List contacts that have a specific tag",
        parameters: {
          type: "object",
          properties: {
            tag: {
              type: "string",
              description: "The tag to search for",
            },
            limit: {
              type: "number",
              description: "Maximum number of contacts to return (default 10)",
            },
          },
          required: ["tag"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "searchWeb",
        description: "Search the web for information",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fetchMultipleContactsData",
        description:
          "Fetch data for multiple contacts given their phone numbers",
        parameters: {
          type: "object",
          properties: {
            phoneNumbers: {
              type: "array",
              items: { type: "string" },
              description: "Array of phone numbers to fetch data for",
            },
          },
          required: ["phoneNumbers"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "listContacts",
        description: "List contacts with pagination",
        parameters: {
          type: "object",
          properties: {
            idSubstring: {
              type: "string",
              description: "ID substring for the company",
            },
            limit: {
              type: "number",
              description: "Number of contacts to return (default 10)",
            },
            offset: {
              type: "number",
              description: "Number of contacts to skip (default 0)",
            },
          },
          required: ["idSubstring"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "checkAvailableTimeSlots",
        description:
          "Always call getTodayDate first to get the current date as a reference the year is 2024.Check for available time slots in Google Calendar for the next specified number of days return back the name of date and time. Always call getCurrentDateTime first to get the current date and time as a reference before checking for available time slots. Returns all available time slots, but only provides three at a time, each with a duration of1 hour, and only suggests slots that are 2 days after the current time.",
        parameters: {
          type: "object",
          properties: {
            idSubstring: {
              type: "string",
              description: "ID substring for the company",
            },
            specificDate: {
              type: "string",
              description:
                "Optional. Specific date to check in YYYY-MM-DD format",
            },
          },
          required: ["idSubstring"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "createCalendarEvent",
        description:
          "Schedule a meeting in Calendar. Always getTodayDate first to get the current date as a reference.The contact name should be included in the title of the event.",
        parameters: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "Title of the event include the contact name",
            },
            description: {
              type: "string",
              description: "Description of the event",
            },
            startDateTime: {
              type: "string",
              description:
                "Start date and time in ISO 8601 format in Asia/Kuala Lumpur Timezone",
            },
            endDateTime: {
              type: "string",
              description:
                "End date and time in ISO 8601 format in Asia/Kuala Lumpur Timezone",
            },
          },
          required: ["summary", "startDateTime", "endDateTime"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rescheduleCalendarEvent",
        description:
          "Reschedule an existing appointment to a new date and time. This function checks for scheduling conflicts in both the database and Google Calendar, and verifies staff availability before updating the appointment. It can find appointments by date for the contact. If multiple appointments exist on the same date, it will return a list for the user to choose from.",
        parameters: {
          type: "object",
          properties: {
            appointmentDate: {
              type: "string",
              description:
                "Date of the appointment to reschedule in YYYY-MM-DD format.",
            },
            newStartDateTime: {
              type: "string",
              description:
                "New start date and time in ISO 8601 format in Asia/Kuala_Lumpur Timezone",
            },
            newEndDateTime: {
              type: "string",
              description:
                "New end date and time in ISO 8601 format in Asia/Kuala_Lumpur Timezone",
            },
            reason: {
              type: "string",
              description: "Reason for rescheduling the appointment (optional)",
            },
          },
          required: ["appointmentDate", "newStartDateTime", "newEndDateTime"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "cancelCalendarEvent",
        description:
          "Cancel an existing appointment and remove it from both the database and Google Calendar. This function can find appointments by date for the contact. If multiple appointments exist on the same date, it will return a list for the user to choose from. The appointment status will be updated to 'cancelled' in the database and the corresponding Google Calendar event will be deleted.",
        parameters: {
          type: "object",
          properties: {
            appointmentDateandTime: {
              type: "string",
              description:
                "Date and time of the appointment to cancel in in ISO 8601 format in Asia/Kuala_Lumpur Timezone",
            },
            reason: {
              type: "string",
              description: "Reason for canceling the appointment (optional)",
            },
          },
          required: ["appointmentDateandTime"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "searchUpcomingAppointments",
        description:
          "Search for upcoming appointments for the current contact. This function returns all future appointments (excluding past appointments) with detailed information including date, time, type, and assigned staff. It provides a breakdown of appointments categorized by today, tomorrow, and future dates.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description:
                "Maximum number of appointments to return (default: 10, max: 50)",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getTodayDate",
        description:
          "Always call this first when handling time-related queries, such as when a user asks for today, next week, tomorrow, yesterday, etc. Retrieves today's date in YYYY-MM-DD HH:mm:ss format.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "manageContactTags",
        description:
          "Add or remove tags from a contact. This function can handle both adding new tags and removing existing tags from any contact.",
        parameters: {
          type: "object",
          properties: {
            tag: {
              type: "string",
              description: "The tag to add or remove",
            },
            action: {
              type: "string",
              description: "Action to perform - either 'add' or 'remove'",
              enum: ["add", "remove"],
            },
          },
          required: ["tag", "action"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fetchContactData",
        description: "Fetch contact data for a given phone number",
        parameters: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              description: "Phone number of the contact",
            },
            idSubstring: {
              type: "string",
              description: "ID substring for the company",
            },
          },
          required: ["phoneNumber", "idSubstring"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getTotalContacts",
        description: "Get the total number of contacts for a company",
        parameters: {
          type: "object",
          properties: {
            idSubstring: {
              type: "string",
              description: "ID substring for the company",
            },
          },
          required: ["idSubstring"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "addTask",
        description: "Add a new task for the company",
        parameters: {
          type: "object",
          properties: {
            taskString: { type: "string", description: "Task description" },
            assignee: {
              type: "string",
              description: "Person assigned to the task",
            },
            dueDate: {
              type: "string",
              description: "Due date for the task (YYYY-MM-DD format)",
            },
          },
          required: ["taskString", "assignee", "dueDate"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "listTasks",
        description: "List all tasks for the company",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "updateTaskStatus",
        description: "Update the status of a task",
        parameters: {
          type: "object",
          properties: {
            taskIndex: {
              type: "number",
              description: "Index of the task to update",
            },
            newStatus: {
              type: "string",
              description: "New status for the task",
            },
          },
          required: ["taskIndex", "newStatus"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "addPointsForBottlesBought",
        description: "Add points to a contact for bottles bought",
        parameters: {
          type: "object",
          properties: {
            bottlesBought: {
              type: "number",
              description: "Number of bottles bought",
            },
          },
          required: ["bottlesBought"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "sendRescheduleRequest",
        description:
          "Send a date request with booking details to merchant for approval",
        parameters: {
          type: "object",
          properties: {
            requestedDate: {
              type: "string",
              description:
                "The date requested by the customer (YYYY-MM-DD format)",
            },
            requestedTime: {
              type: "string",
              description: "The time requested by the customer (HH:MM format)",
            },
          },
          required: ["requestedDate", "requestedTime"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "sendInquiryToGroupNewTown",
        description:
          "Send customer inquiry details to a designated group when customer is not ready to order but needs more information",
        parameters: {
          type: "object",
          properties: {
            customerName: {
              type: "string",
              description: "Name of the customer making the inquiry",
            },
            customerPhone: {
              type: "string",
              description: "Phone number of the customer",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "assignContactAndGenerateReportNewTown",
        description:
          "Assign a contact to an employee and generate a report to send to a designated group. This must be called after order is made.",
        parameters: {
          type: "object",
          properties: {}, // No parameters needed as we'll use the existing variables
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "sendFeedbackToGroupNewTown",
        description:
          "Send customer feedback to a designated group when customer provides feedback, mentions delivery locations (like Sutera, GC, etc.), requests gas delivery, or when you detect a customer is unhappy. Use this for ANY customer communication that the team should know about, including delivery requests, complaints, compliments, or location-specific inquiries.",
        parameters: {
          type: "object",
          properties: {
            feedback: {
              type: "string",
              description: "The feedback message from the customer, including delivery requests, locations mentioned, or any other relevant information",
            },
            customerName: {
              type: "string",
              description: "Name of the customer providing feedback",
            },
            customerPhone: {
              type: "string",
              description: "Phone number of the customer",
            },
          },
          required: ["feedback"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "updateCustomFields",
        description: "Updates multiple custom fields of a contact.",
        parameters: {
          type: "object",
          properties: {
            customFields: {
              type: "array",
              description:
                "An array of objects, each containing a key-value pair for a custom field.",
              items: {
                type: "object",
                properties: {
                  key: {
                    type: "string",
                    description: "The key for the custom field",
                  },
                  value: {
                    type: "string",
                    description: "The value for the custom field",
                  },
                },
                required: ["key", "value"],
              },
            },
          },
          required: ["customFields"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getCustomFields",
        description: "Retrieves the custom fields of a contact.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getAvailableEvents",
        description:
          "Get a list of all available events for the company. Use this when you need to show available events or when the user asks about events.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "setAttendance",
        description:
          "Set attendance for a participant in an event. Only use this when the participant confirms their attendance. Do not use this if the participant is not coming. If the event name is not exact, the function will try to find similar events or show available options.",
        parameters: {
          type: "object",
          properties: {
            eventName: {
              type: "string",
              description: "The name of the event",
            },
          },
          required: ["eventName"],
        },
      },
    },
    ...(idSubstring === "0128"
      ? [
          {
            type: "function",
            function: {
              name: "sendFeedbackToGroup",
              description:
                "Send customer feedback to a designated group when customer provide feedback or when you detect a customer is unhappy",
              parameters: {
                type: "object",
                properties: {
                  feedback: {
                    type: "string",
                    description: "The feedback message from the customer",
                  },
                },
                required: ["feedback"],
              },
            },
          },
        ]
      : []),

    // Add inquiry tool conditionally for 0128
    ...(idSubstring === "0128"
      ? [
          {
            type: "function",
            function: {
              name: "sendInquiryToGroup",
              description:
                "Send customer inquiry details to a designated group when customer is not ready to order but needs more information",
              parameters: {
                type: "object",
                properties: {
                  customerName: {
                    type: "string",
                    description: "Name of the customer making the inquiry",
                  },
                  customerPhone: {
                    type: "string",
                    description: "Phone number of the customer",
                  },
                },
                required: [],
              },
            },
          },
        ]
      : []),

    // Add assign contact tool conditionally for 0128
    ...(idSubstring === "0128"
      ? [
          {
            type: "function",
            function: {
              name: "assignContactAndGenerateReport",
              description:
                "Assign a contact to an employee and generate a report to send to a designated group. This must be called after order is made.",
              parameters: {
                type: "object",
                properties: {}, // No parameters needed as we'll use the existing variables
                required: [],
              },
            },
          },
        ]
      : []),
    // New AI Assistant Tool Functions
    {
      type: "function",
      function: {
        name: "scheduleFollowUp",
        description:
          "Schedule follow-up messages to contacts at specific times",
        parameters: {
          type: "object",
          properties: {
            contactPhone: {
              type: "string",
              description: "Phone number of the contact to follow up with",
            },
            templateId: {
              type: "string",
              description: "ID of the follow-up template to use",
            },
            delayHours: {
              type: "number",
              description:
                "Number of hours to delay the follow-up (default: 24)",
            },
          },
          required: ["contactPhone", "templateId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "assignContactToSequence",
        description: "Assign contacts to automated follow-up sequences",
        parameters: {
          type: "object",
          properties: {
            contactPhone: {
              type: "string",
              description: "Phone number of the contact to assign",
            },
            sequenceId: {
              type: "string",
              description: "ID of the follow-up sequence to assign contact to",
            },
          },
          required: ["contactPhone", "sequenceId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "pauseFollowUpSequence",
        description: "Pause follow-up sequences temporarily",
        parameters: {
          type: "object",
          properties: {
            sequenceId: {
              type: "string",
              description: "ID of the sequence to pause",
            },
          },
          required: ["sequenceId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "updateFollowUpStatus",
        description: "Update follow-up status and tracking information",
        parameters: {
          type: "object",
          properties: {
            followUpId: {
              type: "string",
              description: "ID of the follow-up to update",
            },
            status: {
              type: "string",
              description: "New status (scheduled, sent, completed, failed)",
            },
            notes: {
              type: "string",
              description: "Optional notes about the follow-up",
            },
          },
          required: ["followUpId", "status"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "calculateDateDifference",
        description: "Calculate the difference between two dates",
        parameters: {
          type: "object",
          properties: {
            startDate: {
              type: "string",
              description: "Start date in ISO format or any valid date format",
            },
            endDate: {
              type: "string",
              description: "End date in ISO format or any valid date format",
            },
            unit: {
              type: "string",
              description:
                "Unit of measurement (days, hours, minutes, weeks, months, years)",
              enum: ["days", "hours", "minutes", "weeks", "months", "years"],
            },
          },
          required: ["startDate", "endDate"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "formatDate",
        description: "Format dates according to specified format and timezone",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Date to format in any valid date format",
            },
            format: {
              type: "string",
              description:
                "Desired format (e.g., YYYY-MM-DD, DD/MM/YYYY, etc.)",
            },
            timezone: {
              type: "string",
              description: "Target timezone (default: Asia/Kuala_Lumpur)",
            },
          },
          required: ["date"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "generateUUID",
        description: "Generate unique identifiers for various purposes",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "validateEmail",
        description: "Validate email addresses for accuracy",
        parameters: {
          type: "object",
          properties: {
            email: {
              type: "string",
              description: "Email address to validate",
            },
          },
          required: ["email"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "exportData",
        description: "Export data to various formats (CSV, JSON, Excel)",
        parameters: {
          type: "object",
          properties: {
            dataType: {
              type: "string",
              description:
                "Type of data to export (contacts, tasks, followups, etc.)",
              enum: [
                "contacts",
                "tasks",
                "followups",
                "appointments",
                "messages",
              ],
            },
            format: {
              type: "string",
              description: "Export format (csv, json, xlsx)",
              enum: ["csv", "json", "xlsx"],
            },
            filters: {
              type: "object",
              description: "Optional filters to apply to the data",
            },
          },
          required: ["dataType"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "importData",
        description: "Import data from files (CSV, JSON, Excel)",
        parameters: {
          type: "object",
          properties: {
            dataType: {
              type: "string",
              description: "Type of data to import (contacts, tasks, etc.)",
              enum: ["contacts", "tasks", "followups", "appointments"],
            },
            fileUrl: {
              type: "string",
              description: "URL or path to the file to import",
            },
            format: {
              type: "string",
              description: "File format (csv, json, xlsx)",
              enum: ["csv", "json", "xlsx"],
            },
          },
          required: ["dataType", "fileUrl"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "sendNotification",
        description: "Send system notifications to users or groups",
        parameters: {
          type: "object",
          properties: {
            recipient: {
              type: "string",
              description:
                "Recipient of the notification (phone number, email, or group ID)",
            },
            message: {
              type: "string",
              description: "Notification message content",
            },
            type: {
              type: "string",
              description: "Notification type (info, warning, error, success)",
              enum: ["info", "warning", "error", "success"],
            },
          },
          required: ["recipient", "message"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "sendWhatsAppMessage",
        description:
          "Send a WhatsApp message to any contact using their contact_id or phone number",
        parameters: {
          type: "object",
          properties: {
            contactId: {
              type: "string",
              description:
                "Contact ID (e.g., '0128-60123456789') or phone number (e.g., '+60123456789' or '60123456789')",
            },
            message: {
              type: "string",
              description: "Message content to send",
            },
            quotedMessageId: {
              type: "string",
              description: "Optional message ID to reply to",
            },
            phoneIndex: {
              type: "number",
              description: "Phone index to use for sending (default: 0)",
            },
          },
          required: ["contactId", "message"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "scheduleMessage",
        description:
          "Schedule WhatsApp messages to be sent at a specific time to the current user or specified contacts. AI can intelligently decide optimal settings for batching, delays, and timing based on context. When contactIds is not provided, it will automatically schedule the message to the current user the AI is talking to.",
        parameters: {
          type: "object",
          properties: {
            contactIds: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional array of contact IDs or phone numbers to send to. If not provided, will automatically use the current user's contact ID.",
            },
            message: {
              type: "string",
              description: "Message content to send",
            },
            scheduledTime: {
              type: "string",
              description:
                "When to send the message in ISO format (e.g., '2024-01-15T10:00:00+08:00')",
            },
            mediaUrl: {
              type: "string",
              description:
                "Optional URL of media file to send (image, video, audio)",
            },
            documentUrl: {
              type: "string",
              description: "Optional URL of document file to send",
            },
            fileName: {
              type: "string",
              description: "Optional filename for document",
            },
            caption: {
              type: "string",
              description: "Optional caption for media or document",
            },
            batchQuantity: {
              type: "number",
              description:
                "Number of contacts per batch (AI will decide optimal size if not specified)",
            },
            repeatInterval: {
              type: "number",
              description: "Interval between batches in specified units",
            },
            repeatUnit: {
              type: "string",
              description: "Unit for repeat interval (minutes, hours, days)",
              enum: ["minutes", "hours", "days"],
            },
            minDelay: {
              type: "number",
              description:
                "Minimum delay between individual messages in seconds (AI will decide if not specified)",
            },
            maxDelay: {
              type: "number",
              description:
                "Maximum delay between individual messages in seconds (AI will decide if not specified)",
            },
            infiniteLoop: {
              type: "boolean",
              description:
                "Whether to repeat the message infinitely (default: false)",
            },
            activateSleep: {
              type: "boolean",
              description:
                "Whether to activate sleep mode after certain messages (default: false)",
            },
            sleepAfterMessages: {
              type: "number",
              description: "Number of messages to send before sleeping",
            },
            sleepDuration: {
              type: "number",
              description: "Duration to sleep in minutes",
            },
            activeHours: {
              type: "object",
              description:
                "Active hours to send messages (e.g., {start: '09:00', end: '17:00'})",
            },
            phoneIndex: {
              type: "number",
              description: "Phone index to use for sending (default: 0)",
            },
            templateId: {
              type: "string",
              description: "Optional template ID to use",
            },
          },
          required: ["scheduledTime"],
        },
      },
    },
  ];

  const answer = await runAssistant(
    assistantId,
    threadID,
    tools,
    idSubstring,
    client,
    phoneNumber,
    name,
    contactData.companyName,
    contactData,
    phoneIndex,
    companyConfig
  );
  return answer;
}

async function searchWeb(query) {
  try {
    const response = await axios.post(
      "https://google.serper.dev/search",
      {
        q: query,
      },
      {
        headers: {
          "X-API-KEY": process.env.SERPER_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    // Extract and format the search results
    const results = response.data.organic.slice(0, 3).map((result) => ({
      title: result.title,
      snippet: result.snippet,
      link: result.link,
    }));

    return JSON.stringify(results);
  } catch (error) {
    console.error("Error searching the web:", error);
    return JSON.stringify({ error: "Failed to search the web" });
  }
}

async function saveThreadIDPostgres(contactID, threadID, idSubstring) {
  let sqlClient;
  try {
    sqlClient = await pool.connect();

    await sqlClient.query("BEGIN");

    // ✅ FIX: Generate proper contact_id format
    const properContactID =
      idSubstring +
      "-" +
      (contactID.startsWith("+") ? contactID.slice(1) : contactID);

    const checkQuery = `
      SELECT id FROM public.contacts
      WHERE contact_id = $1 AND company_id = $2
    `;

    const checkResult = await sqlClient.query(checkQuery, [
      properContactID, // ✅ Use proper format
      idSubstring,
    ]);

    if (checkResult.rows.length === 0) {
      const insertQuery = `
        INSERT INTO public.contacts (
          contact_id, company_id, thread_id, name, phone, last_updated, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;

      await sqlClient.query(insertQuery, [
        properContactID, // ✅ Proper contact_id format
        idSubstring,
        threadID,
        contactID, // ✅ Use phone number as fallback name
        contactID, // ✅ Phone number
      ]);
      console.log(
        `New contact created with Thread ID in PostgreSQL for contact ${properContactID}`
      );
    } else {
      const updateQuery = `
        UPDATE public.contacts
        SET thread_id = $1, last_updated = CURRENT_TIMESTAMP
        WHERE contact_id = $2 AND company_id = $3
      `;

      await sqlClient.query(updateQuery, [
        threadID,
        properContactID,
        idSubstring,
      ]);
      console.log(
        `Thread ID updated in PostgreSQL for existing contact ${properContactID}`
      );
    }

    await sqlClient.query("COMMIT");
  } catch (error) {
    if (sqlClient) {
      await safeRollback(sqlClient);
    }
    console.error("Error saving Thread ID to PostgreSQL:", error);
  } finally {
    if (sqlClient) {
      await safeRelease(sqlClient);
    }
  }
}

async function fetchConfigFromDatabase(idSubstring, phoneIndex) {
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
      return null;
    }

    const localCompanyConfig = result.rows[0];

    let assistantIds = localCompanyConfig.assistant_ids;
    let assistantId;
    if (Array.isArray(assistantIds)) {
      assistantId = assistantIds[phoneIndex] || assistantIds[0];
    } else if (typeof assistantIds === "string") {
      try {
        const parsed = JSON.parse(assistantIds);
        assistantId = Array.isArray(parsed)
          ? parsed[phoneIndex] || parsed[0]
          : parsed;
      } catch {
        assistantId = assistantIds;
      }
    }
    localCompanyConfig.assistantId = assistantId;
    return localCompanyConfig;
  } catch (error) {
    console.error("Error fetching config:", error);
  } finally {
    if (sqlClient) {
      await safeRelease(sqlClient);
    }
  }
}

// Recruitment Company Functions
async function generateSpecialReportRecruitment(threadID, assistantId, contactName, extractedNumber, reportType) {
  try {
    let reportInstruction;
    
    if (reportType === "hiring_company") {
      reportInstruction = `Please generate a report in the following format for a company that is hiring:

New Hiring Company Registration

Company Details:
- Company Name: [Extract from conversation]
- PIC Name: [Extract from conversation]
- Position: [Extract from conversation - list all positions mentioned]
- Headcount: [Extract from conversation - specify number for each position]
- Work Location: [Extract from conversation]
- Salary Range: [Extract from conversation or "Please specify" if not mentioned]
- Onboarding Timeline: [Extract from conversation]
- Total Employees: [Extract from conversation]

Contact Information:
- Phone Number: ${extractedNumber}
- Email: [Extract from conversation]
- Additional Contact Details: [Extract any other contact information]

Additional Requirements:
[Extract any specific requirements, qualifications, or preferences mentioned]

Fill in the information in square brackets with the relevant details from our conversation. If any information is not available, leave it blank or indicate "Not specified".`;

    } else if (reportType === "job_seeker") {
      reportInstruction = `Please generate a report in the following format for a job seeker:

New Job Seeker Registration

Personal Information:
1. Full name: [Extract from conversation OR from resume/PDF if provided]
2. Email: [Extract from conversation OR from resume/PDF if provided - MUST extract if resume was uploaded]
3. Resume: [Check if resume was sent - indicate "sent" or "not received"]
4. Skills: [Extract ALL skills from resume/PDF if provided - include technical skills like programming languages, software, tools AND position titles like "Full Stack Developer, Web Developer" etc.]
5. Experiences: [Extract ALL work experience from resume/PDF if provided - include job titles, company names, durations, and key responsibilities for EACH position]
6. What kind of job are you currently looking for: [Extract from conversation]
7. What is your preferred job location: [Extract from conversation]
8. Do you have a preferred industry or company type you want to work in: [Extract from conversation]
9. Are you currently employed, serving notice, or have you resigned: [Extract from conversation]
10. If you have a previous job, may I know the actual reason why you left your previous company: [Extract from conversation]
11. Could you share your expected salary range for this role: [Extract from conversation]
12. Is your expected salary still negotiable: [Extract from conversation]
13. Could you briefly tell us about your past working experience: [Extract from conversation OR use the experiences extracted from resume]

Contact Information:
- Phone Number: ${extractedNumber}
- Name: ${contactName}

Additional Notes:
[Extract any other relevant information mentioned during the conversation]

IMPORTANT INSTRUCTIONS:
- If a resume/PDF was uploaded, make sure to extract the Email, Skills, and Experiences from the PDF content analysis
- For Skills: List BOTH position titles (e.g., "Full Stack Developer, React Developer") AND technical skills (e.g., "JavaScript, Python, React, Node.js")
- For Experiences: Include complete work history with job title, company name, duration, and responsibilities for each position
- If the information is in the PDF analysis but not explicitly mentioned in conversation, still extract it from the PDF
- Fill in the information in square brackets with the relevant details from our conversation AND/OR the resume. If any information is not available, leave it blank or indicate "Not specified".`;
    }

    var response = await openai.beta.threads.messages.create(threadID, {
      role: "user",
      content: reportInstruction,
    });

    var assistantResponse = await openai.beta.threads.runs.create(threadID, {
      assistant_id: assistantId,
    });

    // Wait for the assistant to complete the task
    let runStatus;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second
      runStatus = await openai.beta.threads.runs.retrieve(
        threadID,
        assistantResponse.id
      );
    } while (runStatus.status !== "completed");

    // Retrieve the assistant's response
    var messages = await openai.beta.threads.messages.list(threadID);
    var reportMessage = messages.data[0].content[0].text.value;

    var contactInfo = extractContactInfoRecruitment(reportMessage, reportType);

    return { reportMessage, contactInfo };
  } catch (error) {
    console.error("Error generating recruitment report:", error);
    return { reportMessage: "Error generating report", contactInfo: null };
  }
}

function extractContactInfoRecruitment(reportMessage, reportType) {
  const contactInfo = {
    reportType: reportType,
    name: "",
    phone: "",
    email: "",
    company: "",
    position: "",
    location: "",
    salary: "",
    additionalInfo: ""
  };

  try {
    if (reportType === "hiring_company") {
      // Extract company information
      const companyMatch = reportMessage.match(/Company Name:\s*(.+)/i);
      if (companyMatch) contactInfo.company = companyMatch[1].trim();

      const picMatch = reportMessage.match(/PIC Name:\s*(.+)/i);
      if (picMatch) contactInfo.name = picMatch[1].trim();

      const positionMatch = reportMessage.match(/Position:\s*(.+)/i);
      if (positionMatch) contactInfo.position = positionMatch[1].trim();

      const locationMatch = reportMessage.match(/Work Location:\s*(.+)/i);
      if (locationMatch) contactInfo.location = locationMatch[1].trim();

      const salaryMatch = reportMessage.match(/Salary Range:\s*(.+)/i);
      if (salaryMatch) contactInfo.salary = salaryMatch[1].trim();

    } else if (reportType === "job_seeker") {
      // Extract job seeker information
      const nameMatch = reportMessage.match(/Full name:\s*(.+)/i);
      if (nameMatch) contactInfo.name = nameMatch[1].trim();

      const jobMatch = reportMessage.match(/What kind of job are you currently looking for:\s*(.+)/i);
      if (jobMatch) contactInfo.position = jobMatch[1].trim();

      const locationMatch = reportMessage.match(/What is your preferred job location:\s*(.+)/i);
      if (locationMatch) contactInfo.location = locationMatch[1].trim();

      const salaryMatch = reportMessage.match(/Could you share your expected salary range for this role:\s*(.+)/i);
      if (salaryMatch) contactInfo.salary = salaryMatch[1].trim();
    }

    // Extract common information
    const emailMatch = reportMessage.match(/Email:\s*(.+)/i);
    if (emailMatch) contactInfo.email = emailMatch[1].trim();

    const phoneMatch = reportMessage.match(/Phone Number:\s*(.+)/i);
    if (phoneMatch) contactInfo.phone = phoneMatch[1].trim();

  } catch (error) {
    console.error("Error extracting contact info:", error);
  }

  return contactInfo;
}

async function generateTeamNotificationReport(threadID, assistantId, contactName, extractedNumber) {
  try {
    const reportInstruction = `Please generate a comprehensive team notification report based on our conversation:

Team Notification Report

Contact Information:
- Name: ${contactName}
- Phone Number: ${extractedNumber}
- Previous Company: [Extract if mentioned - for job changes]
- New Company: [Extract if mentioned - for job changes]
- Current Status: [Extract from conversation - e.g., "No longer at company", "Moved to new role", "Providing update", "Making referral"]

Notification Type:
[Identify the type: Contact Update, Job Change, Referral, Important Information, Request, Complaint, Feedback, or Other]

Main Message/Update:
[Summarize the key information the contact wants to communicate to the team]

Referral Information (if applicable):
- Referred Person Name: [Extract if provided]
- Referred Person Contact: [Extract if provided]
- Referred Person Position/Role: [Extract if provided]
- Referred Person Company: [Extract if provided]

Action Required:
[What action, if any, should the team take based on this notification]

Urgency Level:
[Low/Medium/High - based on context]

Additional Context:
[Any other relevant details from the conversation that the team should know]

Fill in the information in square brackets with the relevant details from our conversation. If any information is not available, indicate "Not specified".`;

    var response = await openai.beta.threads.messages.create(threadID, {
      role: "user",
      content: reportInstruction,
    });

    var assistantResponse = await openai.beta.threads.runs.create(threadID, {
      assistant_id: assistantId,
    });

    // Wait for the assistant to complete the task
    let runStatus;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(
        threadID,
        assistantResponse.id
      );
    } while (runStatus.status !== "completed");

    // Retrieve the assistant's response
    var messages = await openai.beta.threads.messages.list(threadID);
    var reportMessage = messages.data[0].content[0].text.value;

    var notificationInfo = extractTeamNotificationInfo(reportMessage);

    return { reportMessage, notificationInfo };
  } catch (error) {
    console.error("Error generating team notification report:", error);
    return { reportMessage: "Error generating report", notificationInfo: null };
  }
}

function extractTeamNotificationInfo(reportMessage) {
  const notificationInfo = {
    name: "",
    phone: "",
    notificationType: "",
    previousCompany: "",
    newCompany: "",
    referredPersonName: "",
    referredPersonContact: "",
    urgencyLevel: "",
    actionRequired: "",
  };

  try {
    const nameMatch = reportMessage.match(/- Name:\s*(.+)/i);
    if (nameMatch) notificationInfo.name = nameMatch[1].trim();

    const phoneMatch = reportMessage.match(/- Phone Number:\s*(.+)/i);
    if (phoneMatch) notificationInfo.phone = phoneMatch[1].trim();

    const typeMatch = reportMessage.match(/Notification Type:\s*\[?(.+?)\]?/i);
    if (typeMatch) notificationInfo.notificationType = typeMatch[1].trim();

    const prevCompanyMatch = reportMessage.match(/- Previous Company:\s*(.+)/i);
    if (prevCompanyMatch) notificationInfo.previousCompany = prevCompanyMatch[1].trim();

    const newCompanyMatch = reportMessage.match(/- New Company:\s*(.+)/i);
    if (newCompanyMatch) notificationInfo.newCompany = newCompanyMatch[1].trim();

    const referredNameMatch = reportMessage.match(/- Referred Person Name:\s*(.+)/i);
    if (referredNameMatch) notificationInfo.referredPersonName = referredNameMatch[1].trim();

    const referredContactMatch = reportMessage.match(/- Referred Person Contact:\s*(.+)/i);
    if (referredContactMatch) notificationInfo.referredPersonContact = referredContactMatch[1].trim();

    const urgencyMatch = reportMessage.match(/Urgency Level:\s*\[?(.+?)\]?/i);
    if (urgencyMatch) notificationInfo.urgencyLevel = urgencyMatch[1].trim();

    const actionMatch = reportMessage.match(/Action Required:\s*\[(.+?)\]/i);
    if (actionMatch) notificationInfo.actionRequired = actionMatch[1].trim();

  } catch (error) {
    console.error("Error extracting team notification info:", error);
  }

  return notificationInfo;
}

async function sendFeedbackToGroupRecruitment(
  client,
  feedback,
  customerName,
  customerPhone,
  idSubstring,
  reportType
) {
  try {
    const typeLabel = reportType === "hiring_company" ? "Hiring Company" : "Job Seeker";
    const feedbackMessage =
      `*New ${typeLabel} Feedback*\n\n` +
      `👤 Customer: ${customerName}\n` +
      `📱 Phone: ${customerPhone}\n` +
      `💬 Feedback: ${feedback}\n\n` +
      `📋 Type: ${typeLabel}\n` +
      `🕒 Time: ${new Date().toLocaleString()}\n` +
      `🆔 ID: ${idSubstring}`;

    // Send to recruitment group (you'll need to update this with the actual group ID)
    const sentMessage = await client.sendMessage(
      "RECRUITMENT_GROUP_ID@g.us", // Replace with actual recruitment group ID
      feedbackMessage
    );

    console.log("Recruitment feedback sent successfully");

    return sentMessage;
  } catch (error) {
    console.error("Error sending recruitment feedback:", error);
    throw error;
  }
}

async function transcribeAudio(audioData) {
  try {
    const formData = new FormData();

    // Check if audioData is already a Buffer, if not, convert it
    const audioBuffer = Buffer.isBuffer(audioData)
      ? audioData
      : Buffer.from(audioData, "base64");

    formData.append("file", audioBuffer, {
      filename: "audio.ogg",
      contentType: "audio/ogg; codecs=opus",
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

    if (!response.data || !response.data.text) {
      throw new Error("Transcription response is missing or invalid");
    }

    return response.data.text;
  } catch (error) {
    console.error("Error transcribing audio:", error);
    return "Audio transcription failed. Please try again.";
  }
}

module.exports = { handleNewMessagesTemplateWweb };