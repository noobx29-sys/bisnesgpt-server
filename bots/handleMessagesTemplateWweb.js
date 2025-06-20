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
const ffmpeg = require("ffmpeg-static");
const execPromise = util.promisify(exec);
const { URLSearchParams } = require("url");
const admin = require("../firebase.js");
const db = admin.firestore();
const { doc, collection, query, where, getDocs } = db;
const pdf = require("pdf-parse");
const { fromPath } = require("pdf2pic");
const SKCSpreadsheet = require("../spreadsheet/SKCSpreadsheet");
const CarCareSpreadsheet = require("../blast/bookingCarCareGroup");

const { neon, neonConfig } = require("@neondatabase/serverless");
const { Pool } = require("pg");

// Configure Neon for WebSocket pooling
neonConfig.webSocketConstructor = require("ws");

// For direct SQL queries (single connection)
const sql = neon(process.env.DATABASE_URL);

// For connection pooling
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2000,
});

let companyConfig = {};
const MEDIA_DIR = path.join(__dirname, "public", "media");
// Schedule the task to run every 12 hours

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
      client.release();
    }
  } catch (error) {
    console.error("Error adding notification or sending FCM: ", error);
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
    lines.forEach((line) => {
      if (line.includes(":")) {
        const colonIndex = line.indexOf(":");
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();

        if (key.match(/^Program of Interest(\s+\d+)?$/)) {
          data.programs.push(value);
        } else if (key.match(/^Program Date & Time(\s+\d+)?$/)) {
          data.programDates.push(value);
        } else {
          switch (key) {
            case "Name":
              data["Name"] = value;
              break;
            case "Phone Number":
              data["Phone"] = value;
              break;
            case "Email":
              data["Email"] = value;
              break;
            case "Company":
              data["Company"] = value;
              break;
          }
        }
      }
    });

    console.log("Report Message From MTDC:", reportMessage);
    console.log("Data extracted from MTDC Report:", data);

    const timestamp = moment()
      .tz("Asia/Kuala_Lumpur")
      .format("DD/MM/YYYY HH:mm:ss");

    const formatDateTimeString = (dateTimeString) => {
      if (!dateTimeString || dateTimeString === "Unspecified")
        return "Unspecified";

      const correctFormatRegex = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/;
      if (correctFormatRegex.test(dateTimeString)) {
        return dateTimeString;
      }

      try {
        const formattedDate = moment(dateTimeString)
          .tz("Asia/Kuala_Lumpur")
          .format("DD/MM/YYYY HH:mm:ss");
        return formattedDate !== "Invalid date" ? formattedDate : "Unspecified";
      } catch (error) {
        console.error("Error formatting date string:", error);
        return "Unspecified";
      }
    };

    const rowData = data.programs.map((program, index) => [
      timestamp,
      data["Name"] || "Unspecified",
      data["Company"] || "Unspecified",
      data["Phone"] || "Unspecified",
      data["Email"] || "Unspecified",
      program || "Unspecified",
      formatDateTimeString(data.programDates[index] || "Unspecified"),
    ]);

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
        range: `Submissions!A${lastRow}:G${lastRow}`,
        valueInputOption: "USER_ENTERED",
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
        new Date(scheduled_time),
        duration_minutes,
        status,
        JSON.stringify({ userEmail, ...(appointmentData.metadata || {}) }),
      ]
    );

    await client.query("COMMIT");

    console.log("Successfully created appointment with ID:", appointmentId);
    return appointmentId;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating appointment:", error);
    throw error;
  } finally {
    client.release();
  }
}

async function createCalendarEvent(
  summary,
  description,
  startDateTime,
  endDateTime,
  phoneNumber,
  contactName,
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
      contactName,
      companyName,
    });

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
      appointmentDuration =
        Math.ceil(40 / calendarConfig.slotDuration) *
        calendarConfig.slotDuration;
    } else if (summary.toLowerCase().includes("troubleshoot")) {
      appointmentDuration =
        Math.ceil(60 / calendarConfig.slotDuration) *
        calendarConfig.slotDuration;
    } else {
      appointmentDuration = calendarConfig.slotDuration;
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

    // When creating the end time
    const start = new Date(startDateTime);
    const roundedStart = new Date(
      Math.ceil(start.getTime() / (calendarConfig.slotDuration * 60 * 1000)) *
        (calendarConfig.slotDuration * 60 * 1000)
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

    // Appointment data to crete appointment in Database
    const appointmentData = {
      title: contactName + " " + phoneNumber,
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
          name: contactName,
          session: null,
        },
      ],
      details: description || "",
      meetlink: "",
      type: isService ? "Service" : "Installation",
      units: units,
      companyId: idSubstring,
      userEmail: userEmail,
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
        summary: summary + " - " + contactName,
        description: `${description}\n\nContact: ${contactName} (${phoneNumber})${
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
          `👤 Name: ${contactName}\n` +
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
          `👤 Name: ${contactName}\n`;

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
        time: `${start.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })} - ${end.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })}`,
        description:
          description +
          "\n" +
          `\n\nContact: ${contactName || "Unknown"} (${
            phoneNumber || "No phone number found"
          })`,
        contact: `${contactName || "Unknown"} (${
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

    await addMessagetoPostgres(sent, idSubstring, formattedNumberForDatabase);

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
        contact_id as "phoneNumber", 
        contact_name as "contactName", 
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
    await client.query("ROLLBACK");
    console.error("Error listing assigned contacts:", error);
    return JSON.stringify({ error: "Failed to list assigned contacts" });
  } finally {
    client.release();
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
    await addMessagetoPostgres(sentMessage, idSubstring, "+120363107024888999");
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
    await client.query("ROLLBACK");
    console.error("Error logging feedback to PostgreSQL:", error);
    throw error;
  } finally {
    client.release();
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
  console.log("Handling new message for bot companyID " + botName);

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
      sqlClient.release();
    }
  } catch (error) {
    console.error("Error fetching buffer time from PostgreSQL:", error);
  }

  if (!messageBuffers.has(chatId)) {
    messageBuffers.set(chatId, {
      messages: [],
      timer: null,
    });
  }

  const finalBufferTime = botName === "0144" ? 5000 : bufferTime;
  const buffer = messageBuffers.get(chatId);

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
    () => processBufferedMessages(client, chatId, botName, phoneIndex),
    finalBufferTime
  );
}

async function extractBasicMessageInfo(msg) {
  return {
    id: msg.id._serialized ?? "",
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

    // Add type-specific fields
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
        // Store video data separately or use a cloud storage solution
        mediaData.link = await storeVideoData(media.data, msg._data.filename);
        break;
    }

    // Add thumbnail information if available
    if (msg._data.thumbnailHeight && msg._data.thumbnailWidth) {
      mediaData.thumbnail = {
        height: msg._data.thumbnailHeight,
        width: msg._data.thumbnailWidth,
      };
    }

    // Add media key if available
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

async function prepareContactData(
  msg,
  idSubstring,
  threadID,
  contactData,
  companyName
) {
  const contact = await msg.getContact();
  const chat = await msg.getChat();
  const extractedNumber = "+" + msg.from.split("@")[0];

  const contactTags = contactData?.tags || [];
  const profilePicUrl = await getProfilePicUrl(contact);

  const data = {
    additional_emails: [],
    address1: null,
    assigned_to: null,
    business_id: null,
    phone: extractedNumber,
    tags: contactTags,
    unread_count: (contactData?.unread_count || 0) + 1,
    last_updated: new Date(msg.timestamp * 1000),
    chat_data: {
      contact_id: extractedNumber,
      id: msg.from,
      name:
        contactData?.contact_name ||
        contactData?.name ||
        contact.pushname ||
        extractedNumber,
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
      },
    },
    chat_id: msg.from,
    city: null,
    company: companyName || null,
    name:
      contactData?.contact_name ||
      contactData?.name ||
      contact.pushname ||
      extractedNumber,
    thread_id: threadID ?? "",
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
    },
    profile_pic_url: profilePicUrl,
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

// Handles AI video responses
async function handleAIVideoResponses({
  client,
  message,
  from,
  extractedNumber,
  idSubstring,
  contactName,
  keywordSource,
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

          await addMessagetoPostgres(
            videoMessage,
            idSubstring,
            extractedNumber,
            contactName
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
          await addMessagetoPostgres(
            voiceMessage,
            idSubstring,
            extractedNumber,
            contactName
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
          await addMessagetoPostgres(
            imageMessage,
            idSubstring,
            extractedNumber,
            contactName
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

          await addMessagetoPostgres(
            documentMessage,
            idSubstring,
            extractedNumber,
            contactName
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
        business_id = $14
      WHERE phone = $15 AND company_id = $16
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
      phoneNumber,
      idSubstring,
    ]);

    await sqlClient.query("COMMIT");

    console.log(
      `Successfully updated contact for Company ${idSubstring} at ID ${phoneNumber}`
    );

    return "Contact updated successfully";
  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error(
      `Error updating contact in database for Company ${idSubstring} at ID ${phoneNumber}:`,
      error
    );
    return "Failed to update contact.";
  } finally {
    sqlClient.release();
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
        business_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
    ]);

    await sqlClient.query("COMMIT");

    console.log(
      `Successfully created contact for Company ${idSubstring} at ID ${contactData.phone}`
    );

    return "Contact created successfully";
  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error(
      `Error creating contact in database for Company ${idSubstring} at ID ${contactData.phone}:`,
      error
    );
    return "Failed to create contact.";
  } finally {
    sqlClient.release();
  }
}

async function processImmediateActions(client, msg, botName, phoneIndex) {
  const idSubstring = botName;
  const chatId = msg.from;
  const contact = await msg.getContact();
  console.log(
    `Processing immediate actions for bot companyID ${botName} for chatId ${chatId}`
  );
  const messageBody = msg.body;

  // Handle special cases first
  if (
    messageBody.includes("<Confirmed Appointment>") &&
    idSubstring === "002" &&
    msg.from === "120363323247156210@g.us"
  ) {
    console.log("🎯 Detected confirmed appointment message");
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
    await fetchConfigFromDatabase(idSubstring, phoneIndex);

    // Prepare contact and message data using utility functions
    const extractedNumber = "+" + msg.from.split("@")[0];
    const contactData = await getContactDataFromDatabaseByPhone(
      extractedNumber,
      idSubstring
    );
    const chat = await msg.getChat();
    const companyName = contactData?.company || null;

    // Handle thread creation/retrieval
    let threadID = contactData?.thread_id;
    if (!threadID) {
      const thread = await createThread();
      threadID = thread.id;
      await saveThreadIDPostgres(extractedNumber, threadID, idSubstring);
    }

    // Handle messages from me
    if (msg.fromMe) {
      if (idSubstring === "0128") {
        const firebaseDC = "+" + msg.to.split("@")[0];
        await addTagToPostgres(firebaseDC, "stop bot", idSubstring);
      }
      await handleOpenAIMyMessage(msg.body, threadID);
      return;
    }

    // Prepare contact and message data
    const contactTags = contactData?.tags || [];
    const messageData = await prepareMessageData(msg, idSubstring, phoneIndex);
    const contactDataForDB = await prepareContactData(
      msg,
      idSubstring,
      threadID,
      contactData,
      companyName
    );

    // Save to database
    if (contactData) {
      await updateContactInDatabase(
        idSubstring,
        extractedNumber,
        contactDataForDB
      );
    } else {
      await createContactInDatabase(idSubstring, contactDataForDB);
    }

    await addMessagetoPostgres(
      messageData,
      idSubstring,
      extractedNumber,
      contactDataForDB.name
    );
    await addNotificationToUser(
      idSubstring,
      messageData,
      contactDataForDB.name
    );

    const followUpTemplates = await getFollowUpTemplates(idSubstring);

    const handlerParams = {
      client: client,
      msg: messageBody,
      idSubstring: idSubstring,
      extractedNumber: extractedNumber,
      contactName:
        contactData?.contact_name ||
        contactData?.name ||
        contact.pushname ||
        extractedNumber,
      phoneIndex: phoneIndex,
    };

    // Handle user-triggered responses
    await processAIResponses({
      ...handlerParams,
      keywordSource: "user",
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
      if (contactTags.includes("stop bot")) {
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

    console.log("Message processed immediately:", msg.id._serialized);
  } catch (error) {
    console.error("Error in immediate processing:", error);
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
    await addMessagetoPostgres(sentMessage, idSubstring, "+120363107024888999");
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
      return false;
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
      return false;
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
      return false;
    }

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
      }`
    );

    // Send confirmation message to the user
    const confirmationMessage =
      attendanceStatus === "Accepted"
        ? `Thank you for confirming your attendance. We look forward to seeing you at the event!`
        : `Thank you for letting us know you won't be able to attend. We hope to see you at future events.`;

    const chatID = extractedNumber.slice(1) + "@c.us";
    const sentMessage = await client.sendMessage(chatID, confirmationMessage);
    await addMessagetoPostgres(sentMessage, idSubstring, extractedNumber);

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
      return false;
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
      return false;
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
    await addMessagetoPostgres(sentMessage, idSubstring, extractedNumber);

    return true;
  } catch (error) {
    console.error("Error processing MTDC attendance confirmation:", error);
    throw error;
  }
}

async function processBufferedMessages(client, chatId, botName, phoneIndex) {
  const buffer = messageBuffers.get(chatId);
  if (!buffer || buffer.messages.length === 0) return;

  const messages = buffer.messages;
  messageBuffers.delete(chatId); // Clear the buffer

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
}

async function processMessage(
  client,
  msg,
  botName,
  phoneIndex,
  combinedMessage
) {
  const idSubstring = botName;
  const chatId = msg.from;
  console.log(
    `Processing immediate actions for Company ${botName} from chat ${chatId}`
  );

  try {
    // Initial fetch of config
    await fetchConfigFromDatabase(idSubstring, phoneIndex);

    // Check if bot is stopped
    if (companyConfig.stopbot) {
      if (companyConfig.stopbot == true) {
        console.log(`Main Bot Toggled Off for Company ${botName}`);
        return;
      }
    }

    if (
      companyConfig.stopbots &&
      companyConfig.stopbots[phoneIndex.toString()] === true
    ) {
      console.log(
        `Bot Toggled Off for Company ${botName} for Phone Index ${phoneIndex}`
      );
      return;
    }

    const sender = {
      to: msg.from,
      name: msg.notifyName,
    };

    const extractedNumber = "+" + sender.to.split("@")[0];

    if (msg.fromMe) {
      console.log(msg);
      if (idSubstring === "0128") {
        const contactIDDC = msg.to.split("@")[0];
        await addTagToPostgres(contactIDDC, "stop bot", idSubstring);
      }
      return;
    }

    let contactName;
    let threadID;
    let query = combinedMessage;
    const chat = await msg.getChat();
    const contactData = await getContactDataFromDatabaseByPhone(
      extractedNumber,
      idSubstring
    );
    let stopTag = contactData?.tags || [];
    const contact = await chat.getContact();

    if (msg.fromMe) {
      if (stopTag.includes("idle")) {
        return;
      }
      return;
    }

    if (sender.to.includes("60193668776") && idSubstring === "002") {
      return;
    }

    if (stopTag.includes("stop bot")) {
      console.log(
        `Bot stopped for this message from ${sender.to} for Company ${idSubstring}`
      );
      return;
    }

    // Get or create thread ID
    if (contactData?.threadid) {
      threadID = contactData.threadid;
    } else {
      const thread = await createThread();
      threadID = thread.id;
      await saveThreadIDPostgres(
        contactData?.contact_id || extractedNumber,
        threadID,
        idSubstring
      );
    }

    // Handle special cases like attendance
    if (
      msg.body.toLowerCase().includes("attending".toLowerCase()) &&
      idSubstring === "0380"
    ) {
      try {
        const status = await mtdcAttendance(
          extractedNumber,
          msg.body,
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
      msg.body
        .toLowerCase()
        .includes("have attended the program at mtdc".toLowerCase()) &&
      idSubstring === "0380"
    ) {
      try {
        const status = await mtdcConfirmAttendance(
          extractedNumber,
          msg.body,
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
    const messageBody = msg.body;

    const handlerParams = {
      client: client,
      msg: messageBody,
      idSubstring: idSubstring,
      extractedNumber: extractedNumber,
      contactName:
        contactData?.contact_name ||
        contactData?.name ||
        contact.pushname ||
        extractedNumber,
      phoneIndex: phoneIndex,
    };

    // Process AI responses for 'user'
    await processAIResponses({
      ...handlerParams,
      keywordSource: "user",
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

    if (
      !sender.to.includes("@g.us") ||
      (combinedMessage.toLowerCase().startsWith("@juta") && phoneIndex == 0) ||
      (sender.to.includes("@g.us") &&
        idSubstring === "0385" &&
        !stopTag.includes("stop bot"))
    ) {
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
      });

      query = typeAnalysis
        ? `${combinedMessage} ${typeAnalysis}`
        : combinedMessage;

      // Send Message to OpenAI for Processing
      const answer = await handleOpenAIAssistant(
        query,
        threadID,
        stopTag,
        extractedNumber,
        idSubstring,
        client,
        contactData?.contact_name ||
          contactData?.name ||
          contact.pushname ||
          extractedNumber
      );

      if (answer) {
        await processBotResponse({
          client,
          msg,
          answer,
          idSubstring,
          extractedNumber,
          contactName:
            contactData?.contact_name ||
            contactData?.name ||
            contact.pushname ||
            extractedNumber,
          phoneIndex,
          threadID,
          contactData,
        });
      }
    }

    await chat.markUnread();
    console.log("Response sent.");
  } catch (e) {
    console.error("Error:", e.message);
    return e.message;
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
}) {
  if (msg.type === "document" && msg._data.mimetype === "application/pdf") {
    return await handlePDFMessage(
      msg,
      sender,
      threadID,
      client,
      idSubstring,
      extractedNumber
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
      extractedNumber
    );
  }
  return null;
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
      });
      continue;
    }

    // Send text message
    const sentMessage = await client.sendMessage(msg.from, part);

    // Save message to PostgreSQL
    await addMessagetoPostgres({
      msg: sentMessage,
      idSubstring: idSubstring,
      extractedNumber: extractedNumber,
      contactName: contactName,
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
    });

    const handlerParams = {
      client: client,
      msg: part,
      idSubstring: idSubstring,
      extractedNumber: extractedNumber,
      contactName:
        contactData?.contact_name || contactData?.name || extractedNumber,
      phoneIndex: phoneIndex,
    };

    // Process AI responses for 'bot'
    await processAIResponses({
      ...handlerParams,
      keywordSource: "bot",
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

          await addMessagetoPostgres({
            msg: documentMessage,
            idSubstring: idSubstring,
            extractedNumber: extractedNumber,
            contactName: contactName,
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
}) {
  // Handle general team notification
  if (part.includes("notified the team")) {
    await assignNewContactToEmployee(extractedNumber, idSubstring, client);
  }

  // Handle 0128 bot triggers
  if (idSubstring === "0128") {
    if (
      part.toLowerCase().includes("i will notify the team") ||
      part.toLowerCase().includes("i have notified the team")
    ) {
      await assignNewContactToEmployee(extractedNumber, idSubstring, client);
    }

    if (part.toLowerCase().includes("get back to you")) {
      await addTagToPostgres(extractedNumber, "stop bot", idSubstring);
      await assignNewContactToEmployee(extractedNumber, idSubstring, client);
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

  // Handle MTDC case (0380)
  if (part.includes("Your details are registered") && idSubstring == "0380") {
    const { reportMessage, contactInfoMTDC } = await generateSpecialReportMTDC(
      threadID,
      companyConfig.assistantId,
      contactName,
      extractedNumber
    );

    const sentMessage = await client.sendMessage(
      "120363386875697540@g.us",
      reportMessage
    );
    await insertSpreadsheetMTDC(reportMessage);
    await addMessagetoPostgres(
      sentMessage,
      idSubstring,
      "+120363386875697540",
      "Group Chat"
    );

    await saveSpecialCaseMTDC(contactInfoMTDC);
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
    await addMessagetoPostgres(
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
    await addMessagetoPostgres(
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
    await addMessagetoPostgres(
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
    await addMessagetoPostgres(
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
      await addMessagetoPostgres(
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
      await addMessagetoPostgres(
        sentMessage,
        idSubstring,
        "+120363325228671809"
      );
      await addTagToPostgres(extractedNumber, "stop bot", idSubstring);
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
      await sqlClient.query("ROLLBACK");
      console.error("Error updating contact in PostgreSQL:", error);
      throw error;
    } finally {
      sqlClient.release();
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
      await sqlClient.query("ROLLBACK");
      console.error("Error updating contact in PostgreSQL:", error);
      throw error;
    } finally {
      sqlClient.release();
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
      await sqlClient.query("ROLLBACK");
      console.error("Error updating contact in PostgreSQL:", error);
      throw error;
    } finally {
      sqlClient.release();
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
      await sqlClient.query("ROLLBACK");
      console.error("Error updating contact in PostgreSQL:", error);
      throw error;
    } finally {
      sqlClient.release();
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
      await sqlClient.query("ROLLBACK");
      console.error("Error updating contact in PostgreSQL:", error);
      throw error;
    } finally {
      sqlClient.release();
    }
  }

  async function saveSpecialCaseMTDC(contactInfoMTDC) {
    const sqlClient = await pool.connect();
    try {
      await sqlClient.query("BEGIN");

      const contactData = {
        phone: extractedNumber,
        contact_name: (contactInfoMTDC.contactName || contactName || "").trim(),
        thread_id: threadID,
        custom_fields: {
          FullName: contactInfoMTDC.contactName || "[Not specified]",
          Company: contactInfoMTDC.company || "[Not specified]",
          "IC Number": contactInfoMTDC.ic || "[Not specified]",
          Email: contactInfoMTDC.email || "[Not specified]",
          "Program of Interest": contactInfoMTDC.program || "[Not specified]",
          "Program Date & Time":
            contactInfoMTDC.programDateTime || "[Not specified]",
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
      await sqlClient.query("ROLLBACK");
      console.error("Error updating contact in PostgreSQL:", error);
      throw error;
    } finally {
      sqlClient.release();
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
  var lines = report.split("\n");
  var contactInfoMTDC = {
    programs: [],
    programDates: [],
  };

  for (var line of lines) {
    if (line.startsWith("Name")) {
      contactInfoMTDC.contactName = line.split(":")[1].trim();
    } else if (line.startsWith("Company")) {
      contactInfoMTDC.company = line.split(":")[1].trim();
    } else if (line.startsWith("Email")) {
      contactInfoMTDC.email = line.split(":")[1].trim();
    } else if (line.startsWith("Program of Interest")) {
      contactInfoMTDC.programs.push(line.split(":")[1].trim());
    } else if (line.startsWith("Program Date & Time")) {
      contactInfoMTDC.programDates.push(line.split(":")[1].trim());
    }
  }

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
  extractedNumber
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
  try {
    console.log("Processing PDF document...");
    const media = await msg.downloadMedia();

    // Convert base64 to buffer
    const buffer = Buffer.from(media.data, "base64");

    // Use pdf-parse to get number of pages
    const pdfData = await pdf(buffer);
    const pageCount = pdfData.numpages;

    // Convert PDF to images using pdf2pic
    const options = {
      density: 300,
      saveFilename: "pdf_page",
      savePath: "./temp",
      format: "png",
      width: 2480,
      height: 3508, // A4 size at 300 DPI
    };

    const convert = fromPath(buffer, options);
    let allPagesAnalysis = [];

    // Process first 3 pages maximum to avoid token limits
    const pagesToProcess = Math.min(pageCount, 3);

    for (let i = 1; i <= pagesToProcess; i++) {
      // Convert page to image
      const pageImage = await convert(i);

      // Convert image to base64
      const imageBuffer = await fs.promises.readFile(pageImage.path);
      const base64Image = imageBuffer.toString("base64");

      // Analyze image using GPT-4-mini
      const response = await openai.chat.completions.create({
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

      // Add page analysis to results
      allPagesAnalysis.push(
        `Page ${i}: ${response.choices[0].message.content}`
      );

      // Clean up temporary image file
      await fs.promises.unlink(pageImage.path);
    }

    // Combine analysis from all pages
    const combinedAnalysis = allPagesAnalysis.join("\n\n");
    console.log("PDF analysis:", combinedAnalysis);

    return `[PDF Content Analysis: ${combinedAnalysis}]`;
  } catch (error) {
    console.error("Error processing PDF:", error);
    return "[Error: Unable to process PDF document]";
  } finally {
    // Clean up any remaining temporary files
    try {
      await fs.promises.rm("./temp", { recursive: true, force: true });
    } catch (error) {
      console.error("Error cleaning up temporary files:", error);
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
  console.log("Formatting phone number:", phoneNumber);
  // Remove all non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, "");

  // Remove the leading '60' if present
  if (cleaned.startsWith("60")) {
    cleaned = cleaned.slice(2);
  }

  // Ensure the number starts with '+60'
  cleaned = "+60" + cleaned;

  console.log("Formatted phone number:", cleaned);
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
      await addMessagetoPostgres(
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
      await addMessagetoPostgres(
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
      await addMessagetoPostgres(
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
        contact_id: extractedNumber,
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
        contact_id: extractedNumber,
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
    await sqlClient.query("ROLLBACK");
    console.error("Error adding/updating group in PostgreSQL:", error);
  } finally {
    sqlClient.release();
  }
}

async function listContactsWithTag(idSubstring, tag, limit = 10) {
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const lowercaseSearchTag = tag.toLowerCase();

    const query = `
      SELECT 
        contact_id AS "phoneNumber",
        contact_name AS "contactName",
        tags
      FROM 
        public.contacts
      WHERE 
        company_id = $1 AND
        jsonb_path_exists(
          tags, 
          '$[*] ? (@ like_regex $lowercaseTag flag "i")', 
          jsonb_build_object('lowercaseTag', $2)
        )
      LIMIT $3
    `;

    const result = await sqlClient.query(query, [
      idSubstring,
      `.*${lowercaseSearchTag}.*`,
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
    await sqlClient.query("ROLLBACK");
    console.error("Error listing contacts with tag:", error);
    return JSON.stringify({ error: "Failed to list contacts with tag" });
  } finally {
    sqlClient.release();
  }
}

async function addMessagetoPostgres(
  msg,
  idSubstring,
  extractedNumber,
  contactName
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

    audioData = media.data;
  }

  let mediaMetadata = {};
  let mediaUrl = null;
  let mediaData = null;

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
        console.log(`Contact created successfully: ${contactID}`);
      } else {
        console.log(`Contact already exists: ${contactID}`);
      }

      // SECOND: Now insert the message with correct field mappings
      const messageQuery = `
        INSERT INTO public.messages (
          message_id, company_id, contact_id, thread_id, customer_phone,
          content, message_type, media_url, timestamp, direction,
          status, from_me, chat_id, author
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (message_id) DO NOTHING
        RETURNING id
      `;

      const messageValues = [
        msg.id._serialized,
        idSubstring,
        contactID,
        msg.from,
        contactID,
        messageBody,
        type,
        mediaUrl,
        new Date(msg.timestamp * 1000),
        msg.fromMe ? "outbound" : "inbound",
        "delivered",
        msg.fromMe || false,
        msg.from,
        author || contactID,
      ];

      console.log("Final message values:", {
        message_id: msg.id._serialized,
        content: messageBody,
        message_type: type,
        customer_phone: contactID,
      });

      const messageResult = await client.query(messageQuery, messageValues);
      const messageDbId = messageResult.rows[0]?.id;

      await client.query(
        `UPDATE public.contacts 
          SET last_message = $1, last_updated = CURRENT_TIMESTAMP
          WHERE contact_id = $2 AND company_id = $3`,
        [
          JSON.stringify({
            chat_id: msg.to,
            from: msg.from,
            from_me: true,
            id: messageDbId,
            status: "sent",
            text: { body: messageBody },
            timestamp: Math.floor(Date.now() / 1000),
            type: type,
          }),
          contactID,
          idSubstring,
        ]
      );

      await client.query("COMMIT");
      console.log(
        `Message successfully added to PostgreSQL with ID: ${messageDbId}`
      );
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
    sqlClient.release();
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
    await sqlClient.query("ROLLBACK");
    console.error("Error counting contacts created today:", error);
    return 0;
  } finally {
    sqlClient.release();
  }
}

async function assignNewContactToEmployee(
  extractedNumber,
  idSubstring,
  client,
  contactName,
  triggerKeyword = ""
) {
  const employees = await fetchEmployeesFromDatabase(idSubstring);

  console.log("Employees:", employees);

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

  // Filter employees by role
  const managers = employees.filter((emp) => emp.role === "4");
  const salesEmployees = employees.filter((emp) => emp.role === "2");
  const admins = employees.filter((emp) => emp.role === "1");

  let assignedManager = null;
  let assignedSales = null;

  // Assign to manager if available
  if (managers.length > 0) {
    assignedManager = managers[Math.floor(Math.random() * managers.length)];
    await assignToEmployee(
      assignedManager,
      "Manager",
      extractedNumber,
      updatedContactName,
      client,
      idSubstring,
      triggerKeyword
    );
    tags.push(assignedManager.name, assignedManager.phoneNumber);
  }

  // Assign to sales if available
  if (salesEmployees.length > 0) {
    // Calculate total weightage
    const totalWeight = salesEmployees.reduce(
      (sum, emp) => sum + (emp.weightage || 1),
      0
    );
    const randomValue = Math.random() * totalWeight;

    let cumulativeWeight = 0;
    for (const emp of salesEmployees) {
      cumulativeWeight += emp.weightage || 1;
      if (randomValue <= cumulativeWeight) {
        assignedSales = emp;
        break;
      }
    }

    if (assignedSales) {
      await assignToEmployee(
        assignedSales,
        "Sales",
        extractedNumber,
        updatedContactName,
        client,
        idSubstring,
        triggerKeyword
      );
      tags.push(assignedSales.name, assignedSales.phoneNumber);
    }
  }

  // If no manager and no sales, assign to admin
  if (!assignedManager && !assignedSales && admins.length > 0) {
    const assignedAdmin = admins[Math.floor(Math.random() * admins.length)];
    await assignToEmployee(
      assignedAdmin,
      "Admin",
      extractedNumber,
      updatedContactName,
      client,
      idSubstring,
      triggerKeyword
    );
    tags.push(assignedAdmin.name, assignedAdmin.phoneNumber);
  }

  await storeAssignmentState(idSubstring);

  return tags;
}

async function assignToEmployee(
  employee,
  role,
  contactID,
  contactName,
  client,
  idSubstring,
  triggerKeyword = ""
) {
  const employeeID = employee.phoneNumber.split("+")[1] + "@c.us";

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

  await client.sendMessage(employeeID, message);
  await addTagToPostgres(contactID, employee.name, idSubstring);
  console.log(`Assigned ${role}: ${employee.name}`);
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

async function waitForCompletion(
  threadId,
  runId,
  idSubstring,
  client,
  depth = 0,
  phoneNumber,
  name,
  companyName,
  contact
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
          threadId
        );
        console.log("Submitting tool outputs...");
        await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
          tool_outputs: toolOutputs,
        });
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
  contact
) {
  console.log("Running assistant for thread: " + threadId);
  const currentAssistantId = await getCompanyAssistantId(idSubstring);
  console.log(
    `Running assistant ${currentAssistantId} for company ${idSubstring}`
  );
  const response = await openai.beta.threads.runs.create(threadId, {
    assistant_id: currentAssistantId,
    tools: tools,
  });

  const runId = response.id;

  const answer = await waitForCompletion(
    threadId,
    runId,
    idSubstring,
    client,
    0,
    phoneNumber,
    name,
    companyName,
    contact
  );
  return answer;
}

async function getCompanyAssistantId(idSubstring) {
  try {
    const sqlClient = await pool.connect();

    try {
      await sqlClient.query("BEGIN");

      const query = `
        SELECT assistant_id
        FROM public.companies
        WHERE company_id = $1
      `;

      const result = await sqlClient.query(query, [idSubstring]);

      await sqlClient.query("COMMIT");

      if (result.rows.length === 0) {
        throw new Error(`No config found for company ${idSubstring}`);
      }

      const assistantId = result.rows[0].assistant_id;

      if (!assistantId) {
        throw new Error(`No assistant ID found for company ${idSubstring}`);
      }

      console.log(`Retrieved assistant ID for ${idSubstring}:`, assistantId);
      return assistantId;
    } catch (error) {
      await sqlClient.query("ROLLBACK");
      throw error;
    } finally {
      sqlClient.release();
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
    await sqlClient.query("ROLLBACK");
    console.error("Error listing contacts:", error);
    return JSON.stringify({ error: "Failed to list contacts" });
  } finally {
    sqlClient.release();
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
    await sqlClient.query("ROLLBACK");
    console.error("Error searching contacts:", error);
    return JSON.stringify({
      error: "Failed to search contacts",
      details: error.message,
    });
  } finally {
    sqlClient.release();
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
      await sqlClient.query("ROLLBACK");
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
    await sqlClient.query("ROLLBACK");
    console.error("Error tagging contact:", error);
    return JSON.stringify({
      error: "Failed to tag contact",
      details: error.message,
    });
  } finally {
    sqlClient.release();
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
      await sqlClient.query("ROLLBACK");
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
    await sqlClient.query("ROLLBACK");
    console.error("Error adding points for bottles bought:", error);
    return JSON.stringify({
      error: "Failed to add points for bottles bought",
      details: error.message,
    });
  } finally {
    sqlClient.release();
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
      await sqlClient.query("ROLLBACK");
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
    await sqlClient.query("ROLLBACK");
    console.error(
      `Error updating custom field in database for Company ${idSubstring} at ID ${phoneNumber}:`,
      error
    );
    return "Failed to update custom field.";
  } finally {
    sqlClient.release();
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
    await sqlClient.query("ROLLBACK");
    console.error(
      `Error retrieving custom fields for Company ${idSubstring} at ID ${phoneNumber}:`,
      error
    );
    return { error: "Failed to retrieve custom fields" };
  } finally {
    sqlClient.release();
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
  threadID
) {
  console.log("Handling tool calls...");
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
            args.contactName,
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
          await addMessagetoPostgres(
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
          await addMessagetoPostgres(
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
    await sqlClient.query("ROLLBACK");
    console.error("Error saving profile to PostgreSQL:", error);
    throw error;
  } finally {
    sqlClient.release();
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

async function setLeadTemperature(idSubstring, phoneNumber, temperature) {
  console.log(
    `Setting lead temperature "${temperature}" for contact ${phoneNumber} in PostgreSQL`
  );

  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const leadTemperatureTags = ["cold", "medium", "hot"];

    const checkQuery = `
      SELECT tags FROM public.contacts 
      WHERE contact_id = $1 AND company_id = $2
    `;
    const checkResult = await sqlClient.query(checkQuery, [
      phoneNumber,
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
      phoneNumber,
      idSubstring,
    ]);

    await sqlClient.query("COMMIT");
    console.log(
      `Lead temperature "${temperature}" set for contact ${phoneNumber} in PostgreSQL`
    );
  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error("Error setting lead temperature in PostgreSQL:", error);
  } finally {
    sqlClient.release();
  }
}

async function updateMessageUsage(idSubstring) {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const date = now.toISOString().split("T")[0];
    const feature = "messages";

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
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
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
  name
) {
  console.log(companyConfig.assistantId);
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
            contactName: { type: "string", description: "Name of the contact" },
            phoneNumber: {
              type: "string",
              description: "Phone number of the contact",
            },
          },
          required: ["summary", "startDateTime", "endDateTime", "contactName"],
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
          "Send customer feedback to a designated group when customer provide feedback or when you detect a customer is unhappy",
        parameters: {
          type: "object",
          properties: {
            feedback: {
              type: "string",
              description: "The feedback message from the customer",
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
    contactData
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

    const checkQuery = `
      SELECT id FROM public.contacts
      WHERE contact_id = $1 AND company_id = $2
    `;

    const checkResult = await sqlClient.query(checkQuery, [
      contactID,
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
        contactID,
        idSubstring,
        threadID,
        contactID,
        contactID,
      ]);
      console.log(
        `New contact created with Thread ID in PostgreSQL for contact ${contactID}`
      );
    } else {
      const updateQuery = `
        UPDATE public.contacts
        SET thread_id = $1, last_updated = CURRENT_TIMESTAMP
        WHERE contact_id = $2 AND company_id = $3
      `;

      await sqlClient.query(updateQuery, [threadID, contactID, idSubstring]);
      console.log(
        `Thread ID updated in PostgreSQL for existing contact ${contactID}`
      );
    }

    await sqlClient.query("COMMIT");
  } catch (error) {
    if (sqlClient) {
      await sqlClient.query("ROLLBACK");
    }
    console.error("Error saving Thread ID to PostgreSQL:", error);
  } finally {
    if (sqlClient) {
      sqlClient.release();
    }
  }
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

const FormData = require("form-data");
const { ids } = require("googleapis/build/src/apis/ids/index.js");
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
