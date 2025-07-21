const OpenAI = require("openai");
const axios = require("axios");
const { google } = require("googleapis");
const path = require("path");
const { Client } = require("whatsapp-web.js");
const util = require("util");
const moment = require("moment-timezone");
const fs = require("fs");
const cron = require("node-cron");
require("dotenv").config({ path: path.resolve(__dirname, '../.env') });

const { v4: uuidv4 } = require("uuid");

const { URLSearchParams } = require("url");
const { Pool } = require("pg");
const pool = new Pool({
  // Connection pooling
  connectionString: process.env.DATABASE_URL,
  max: 2000,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

const openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
});

const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

class bhqSpreadsheet {
  constructor(botMap) {
    this.botName = "075";
    this.spreadsheetId = "1KhBFAFuYSRo3ikTicFRA5sjnDQ_a3iQBdPogFggY6GI";
    this.sheetName = "JADUAL AI REMINDER"; // Update this to match your sheet name
    this.range = `${this.sheetName}!A:AY`; // Update this to cover all columns
    this.botMap = botMap;

    this.auth = new google.auth.GoogleAuth({
      keyFile: "./service_account.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    this.sheets = google.sheets({ version: "v4", auth: this.auth });
    this.remindersFile = path.join(__dirname, "sentReminders.json");
    this.sentReminders = {};
    this.weeklyReportSchedule = null;
    this.loadSentReminders();
  }

  async updateAttendance(phoneNumber, attendance, postponed) {
    try {
      console.log(`Updating attendance for ${phoneNumber}`);
      const postponedString = String(postponed).toLowerCase();
      const phoneWithPlus = phoneNumber.startsWith("+") ? phoneNumber : "+" + phoneNumber;
      const phoneWithoutPlus = phoneNumber.startsWith("+") ? phoneNumber.slice(1) : phoneNumber;

      // Fetch the last message timestamp from Firebase
      const lastMessageTimestamp = await this.getLastMessageTimestampFromPostgreSQL(phoneWithPlus);
      if (!lastMessageTimestamp) {
        console.log(`No last message timestamp found for ${phoneWithPlus}`);
        return;
      }

      // Convert the timestamp to a date
      const lastMessageDate = moment.unix(lastMessageTimestamp);
      const classDay = lastMessageDate.format("dddd").toUpperCase();

      // Translate the class day to Malay
      const classDayMalay = this.translateDayToMalay(classDay);

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.range,
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        console.log("No data found in the spreadsheet.");
        return;
      }

      // Find the column index for the class day
      const dayIndex = rows[3].findIndex((day) => day.trim().toLowerCase() === classDayMalay.toLowerCase());
      if (dayIndex === -1) {
        console.log(`Column for ${classDayMalay} (${classDay}) not found.`);
        return;
      }

      // Find the row index based on the phone number
      const phoneColumnIndex = dayIndex + 1;
      let rowIndex = -1;
      for (let i = 4; i < rows.length; i++) {
        // Start from row 5 (index 4) to skip headers
        if (rows[i][phoneColumnIndex] === phoneWithoutPlus) {
          rowIndex = i;
          break;
        }
      }

      if (rowIndex === -1) {
        console.log(`Phone number ${phoneWithoutPlus} not found in the spreadsheet.`);
        return;
      }

      if (postponedString === "true") {
        // Find the column index for the new day
        const newDayIndex = rows[3].findIndex(
          (day) => day.trim().toLowerCase() === this.translateDayToMalay(attendance).toLowerCase()
        );

        // Determine if the postponement is within the same week or to the next week
        const days = ["Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu", "Ahad"];
        const currentDayIndex = days.indexOf(classDayMalay);
        const newDayIndexInWeek = days.indexOf(this.translateDayToMalay(attendance));
        const isNextWeek = newDayIndexInWeek <= currentDayIndex;

        if (isNextWeek || newDayIndex === -1) {
          // Update the KEHADIRAN column with "next [day]" for next week postponements
          const attendanceColumn = dayIndex + 6;
          const updateRange = `${this.range.split("!")[0]}!${this.columnToLetter(attendanceColumn + 1)}${rowIndex + 1}`;

          console.log(
            `Updating attendance in row ${rowIndex + 1}, column ${this.columnToLetter(
              attendanceColumn + 1
            )} with "next ${attendance.toLowerCase()}" (${classDayMalay})`
          );

          await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: updateRange,
            valueInputOption: "USER_ENTERED",
            resource: {
              values: [[`${attendance.toLowerCase()} depan`]],
            },
          });

          console.log(
            `Attendance updated for ${phoneWithoutPlus} in row ${rowIndex + 1}, column ${this.columnToLetter(
              attendanceColumn + 1
            )} to indicate postponement to next week`
          );
        } else {
          // Existing code for same-week postponements
          // Find the first empty row in the new day's column
          let newRowIndex = -1;
          for (let i = 6; i < rows.length; i++) {
            if (!rows[i][newDayIndex] && !rows[i][newDayIndex + 1]) {
              newRowIndex = i;
              break;
            }
          }

          if (newRowIndex === -1) {
            console.log(`No empty row found in the ${attendance} column.`);
            return;
          }

          // Copy only the specific cells for the class
          const dataToCopy = rows[rowIndex].slice(dayIndex, dayIndex + 7);

          console.log(`dataToCopy:`, dataToCopy);

          // Update only the specific range in the spreadsheet
          const updateRange = `${this.range.split("!")[0]}!${this.columnToLetter(newDayIndex + 1)}${
            newRowIndex + 1
          }:${this.columnToLetter(newDayIndex + 7)}${newRowIndex + 1}`;
          await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: updateRange,
            valueInputOption: "USER_ENTERED",
            resource: {
              values: [dataToCopy],
            },
          });

          console.log(
            `Class postponed: Data copied from row ${rowIndex + 1}, columns ${this.columnToLetter(
              dayIndex + 1
            )}:${this.columnToLetter(dayIndex + 7)} to row ${newRowIndex + 1}, columns ${this.columnToLetter(
              newDayIndex + 1
            )}:${this.columnToLetter(newDayIndex + 7)} for ${attendance}`
          );

          // Clear the original cells
          const clearRequest = {
            spreadsheetId: this.spreadsheetId,
            resource: {
              requests: [
                {
                  updateCells: {
                    range: {
                      sheetId: sheetId,
                      startRowIndex: rowIndex,
                      endRowIndex: rowIndex + 1,
                      startColumnIndex: dayIndex,
                      endColumnIndex: dayIndex + 7,
                    },
                    fields: "userEnteredValue",
                  },
                },
              ],
            },
          };

          await this.sheets.spreadsheets.batchUpdate(clearRequest);
          console.log(
            `Original cells in row ${rowIndex + 1}, columns ${this.columnToLetter(dayIndex + 1)}:${this.columnToLetter(
              dayIndex + 7
            )} cleared.`
          );
        }
      } else {
        // Update the KEHADIRAN column (original behavior)
        const attendanceColumn = dayIndex + 6;
        const updateRange = `${this.range.split("!")[0]}!${this.columnToLetter(attendanceColumn + 1)}${rowIndex + 1}`;

        console.log(
          `Updating attendance in row ${rowIndex + 1}, column ${this.columnToLetter(
            attendanceColumn + 1
          )} with ${attendance}  (${classDayMalay})`
        );

        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: updateRange,
          valueInputOption: "USER_ENTERED",
          resource: {
            values: [[attendance]],
          },
        });

        console.log(
          `Attendance updated for ${phoneWithoutPlus} in row ${rowIndex + 1}, column ${this.columnToLetter(
            attendanceColumn + 1
          )}`
        );
      }
    } catch (error) {
      console.error("Error updating attendance:", error);
    }
  }

  translateDayToMalay(day) {
    const dayTranslations = {
      MONDAY: "Ahad",
      TUESDAY: "Isnin",
      WEDNESDAY: "Selasa",
      THURSDAY: "Rabu",
      FRIDAY: "Khamis",
      SATURDAY: "Jumaat",
      SUNDAY: "Sabtu",
    };
    return dayTranslations[day] || day;
  }

  columnToLetter(column) {
    let temp,
      letter = "";
    while (column > 0) {
      temp = (column - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      column = (column - temp - 1) / 26;
    }
    return letter;
  }

  async getLastMessageTimestampFromPostgreSQL(phoneNumber) {
    try {
      // Query to find the most recent message containing "sahkan kehadiran"
      const query = `
        SELECT timestamp
        FROM messages
        WHERE 
          company_id = $1
          AND customer_phone = $2
          AND content ILIKE '%sahkan kehadiran%'
        ORDER BY timestamp DESC
        LIMIT 1;
      `;

      const result = await pool.query(query, [this.botName, phoneNumber]);

      if (result.rows.length === 0) {
        console.log('No message with "sahkan kehadiran" found.');
        return null;
      }

      return result.rows[0].timestamp;
    } catch (error) {
      console.error("Error fetching last message timestamp:", error);
      return null;
    }
  }

  async loadSentReminders() {
    try {
      const data = await fs.promises.readFile(this.remindersFile, "utf8");
      const cleanedData = this.cleanJSONString(data);
      this.sentReminders = JSON.parse(cleanedData);
    } catch (error) {
      if (error.code === "ENOENT") {
        console.log("Reminders file not found, starting with empty reminders");
        this.sentReminders = {};
      } else if (error instanceof SyntaxError) {
        console.error("Error parsing reminders JSON:", error);
        console.error("Attempting to recover...");
        this.sentReminders = this.recoverCorruptedJSON(cleanedData);
      } else {
        console.error("Error loading reminders:", error);
        this.sentReminders = {};
      }
    }
  }

  cleanJSONString(jsonString) {
    // Remove any non-printable characters and ensure valid JSON structure
    return jsonString
      .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  recoverCorruptedJSON(jsonString) {
    try {
      // Attempt to recover by wrapping in curly braces if not present
      if (!jsonString.startsWith("{")) jsonString = "{" + jsonString;
      if (!jsonString.endsWith("}")) jsonString = jsonString + "}";

      return JSON.parse(jsonString);
    } catch (error) {
      console.error("Unable to recover JSON. Starting with empty reminders.");
      return {};
    }
  }

  async saveSentReminders() {
    try {
      await fs.promises.writeFile(this.remindersFile, JSON.stringify(this.sentReminders, null, 2));
    } catch (error) {
      console.error("Error saving reminders:", error);
    }
  }

  async refreshAndProcessTimetable() {
    try {
      console.log(`Refreshing and processing timetable for bot ${this.botName}`);

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.range,
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        console.log("No data found in the spreadsheet.");
        return;
      }

      console.log(`Total rows in spreadsheet: ${rows.length}`);

      const currentDate = moment().format("dddd").toUpperCase();
      const currentTime = moment();

      let currentDateMalay;
      switch (currentDate) {
        case "MONDAY":
          currentDateMalay = "Ahad";
          break;
        case "TUESDAY":
          currentDateMalay = "Isnin";
          break;
        case "WEDNESDAY":
          currentDateMalay = "Selasa";
          break;
        case "THURSDAY":
          currentDateMalay = "Rabu";
          break;
        case "FRIDAY":
          currentDateMalay = "Khamis";
          break;
        case "SATURDAY":
          currentDateMalay = "Jumaat";
          break;
        case "SUNDAY":
          currentDateMalay = "Sabtu";
          break;
        default:
          currentDateMalay = currentDate;
          break;
      }

      const dayIndex = rows[3].findIndex((day) => day.trim().toLowerCase() === currentDateMalay.toLowerCase());
      if (dayIndex === -1) {
        console.log(`Column for ${currentDateMalay} (${currentDate}) not found. Available columns:`, rows[3]);
        return;
      }

      console.log(`Found column for ${currentDateMalay} (${currentDate}) at index ${dayIndex}`);
      console.log(`Processing rows starting from index 5`);

      // Fix the timing checks for reports
      const currentHour = currentTime.format("HH");
      const currentMinute = currentTime.format("mm");

      // Check for Tuesday student reports at 12:00
      if (currentDate === "TUESDAY" && currentHour === "12" && currentMinute === "00") {
        console.log("Processing Tuesday student reports...");
        const response = await this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: this.range,
        });
        await this.sendStudentReports(response.data.values);
      }

      for (let i = 5; i < rows.length; i++) {
        const timeSlot = rows[i][0];
        if (!timeSlot) {
          continue;
        }

        const currentTime = moment().format("HH:mm");
        const classStartTime = moment(timeSlot, "h:mm A").format("HH:mm");

        // Check if the current time matches the class start time
        if (currentTime === classStartTime) {
          console.log(`  Current time matches the class start time: ${timeSlot}`);

          const customerName = rows[i][dayIndex];
          const customerPhone = rows[i][dayIndex + 1];
          const teacherName = rows[i][dayIndex + 2];

          console.log(`  Customer: ${customerName}, Phone: ${customerPhone}, Teacher: ${teacherName}`);

          if (customerName && customerPhone) {
            const reminderKey = `row-${i}-${moment().format("YYYY-MM-DD")}`;

            if (!this.sentReminders[reminderKey]) {
              console.log(`  Sending reminder...`);
              await this.sendReminderToCustomer(customerName, customerPhone, teacherName, i);
              this.sentReminders[reminderKey] = Date.now();
              await this.saveSentReminders();
            } else {
              console.log(`  Reminder already sent for row ${i} at ${classStartTime}`);
            }
          } else {
            console.log(`  Missing customer name or phone number, skipping customer reminder`);
          }
        }
      }
      console.log(`Finished processing timetable`);
    } catch (error) {
      console.error("Error processing timetable:", error);
    }
  }

  async addMessageToPostgres(msg, idSubstring, extractedNumber, contactName) {
    console.log(`�� [CONTACT_TRACKING] Adding message to PostgreSQL`);

    if (!extractedNumber || !extractedNumber.startsWith("+60") && !extractedNumber.startsWith("+65")) {
      console.error("Invalid extractedNumber for database:", extractedNumber);
      return;
    }

    if (!idSubstring) {
      console.error("Invalid idSubstring for database");
      return;
    }

    const contactID = idSubstring + "-" + (extractedNumber.startsWith("+") ? extractedNumber.slice(1) : extractedNumber);
    console.log(`�� [CONTACT_TRACKING] Generated contactID: ${contactID}`);

    const basicInfo = await extractBasicMessageInfo(msg);
    const messageData = await prepareMessageData(msg, idSubstring, null);

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

    let mediaUrl = null;
    let mediaData = null;
    let mediaMetadata = {};

    if (msg.hasMedia) {
      if (msg.type === "video") {
        mediaUrl = messageData.video?.link || null;
      } else if (msg.type !== "audio" && msg.type !== "ptt") {
        mediaData = messageData[msg.type]?.data || null;
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
      }
    }

    const quotedMessage = messageData.text?.context || null;

    let author = null;
    if (msg.from.includes("@g.us") && basicInfo.author) {
      const authorData = await getContactDataFromDatabaseByPhone(basicInfo.author, idSubstring);
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
        console.log(`�� [CONTACT_TRACKING] Checking for existing contact with contact_id: ${contactID}, company_id: ${idSubstring}`);
        const contactResult = await client.query(contactCheckQuery, [contactID, idSubstring]);

        if (contactResult.rows.length === 0) {
          console.log(`�� [CONTACT_TRACKING] ⚠️ CREATING NEW CONTACT: ${contactID} for company: ${idSubstring}`);
          console.log(`�� [CONTACT_TRACKING] Contact details:`, {
            contact_id: contactID,
            company_id: idSubstring,
            name: contactName || extractedNumber,
            contact_name: contactName || extractedNumber,
            phone: extractedNumber
          });
          
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
          console.log(`�� [CONTACT_TRACKING] ✅ Contact created successfully: ${contactID}`);
        } else {
          const existingContact = contactResult.rows[0];
          console.log(`�� [CONTACT_TRACKING] ✅ Contact already exists:`, {
            id: existingContact.id,
            contact_id: existingContact.contact_id,
            name: existingContact.name,
            contact_name: existingContact.contact_name,
            phone: existingContact.phone,
            company_id: existingContact.company_id
          });
          
          // Check if name is just the phone number (potential duplicate indicator)
          if (existingContact.name === extractedNumber || existingContact.name === extractedNumber.slice(1)) {
            console.log(`�� [CONTACT_TRACKING] ⚠️ WARNING: Contact name is phone number - potential duplicate:`, {
              contact_id: existingContact.contact_id,
              name: existingContact.name,
              phone: existingContact.phone
            });
          }
        }

        // Insert the message
        const messageQuery = `
          INSERT INTO public.messages (
            message_id, company_id, contact_id, thread_id, customer_phone,
            content, message_type, media_url, timestamp, direction,
            status, from_me, chat_id, author, quoted_message, media_data, media_metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (message_id) DO NOTHING
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
          Object.keys(mediaMetadata).length > 0 ? JSON.stringify(mediaMetadata) : null,
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
            }),
            contactID,
            idSubstring,
          ]
        );

        await client.query("COMMIT");
        console.log(`�� [CONTACT_TRACKING] Message successfully added to PostgreSQL with ID: ${messageDbId}`);
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Error in PostgreSQL transaction:", error);
        throw error;
      } finally {
        client.release();
        await addNotificationToUser(idSubstring, messageBody, contactName);
      }
    } catch (error) {
      console.error("PostgreSQL connection error:", error);
      throw error;
    }
  }

  async getContactDataFromDatabaseByPhone(phoneNumber, idSubstring) {
    const sqlClient = await pool.connect();

    try {
      if (!phoneNumber) {
        throw new Error("Phone number is undefined or null");
      }

      console.log(`�� [CONTACT_TRACKING] Searching for contact - Phone: ${phoneNumber}, Company: ${idSubstring}`);

      await sqlClient.query("BEGIN");

      const query = `
        SELECT * FROM public.contacts
        WHERE phone = $1 AND company_id = $2
        LIMIT 1
      `;

      const result = await sqlClient.query(query, [phoneNumber, idSubstring]);

      await sqlClient.query("COMMIT");

      if (result.rows.length === 0) {
        console.log(`�� [CONTACT_TRACKING] No contact found for phone: ${phoneNumber}, company: ${idSubstring}`);
        return null;
      } else {
        const contactData = result.rows[0];
        const contactName = contactData.contact_name || contactData.name;
        const threadID = contactData.thread_id;

        console.log(`�� [CONTACT_TRACKING] Found contact:`, {
          contact_id: contactData.contact_id,
          contact_name: contactData.contact_name,
          name: contactData.name,
          phone: contactData.phone,
          company_id: contactData.company_id,
          thread_id: threadID
        });

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

  async createThread() {
    console.log("Creating a new thread...");
    const thread = await openai.beta.threads.create();
    return thread;
  }

  async customWait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async saveThreadIDPostgres(contactID, threadID, idSubstring) {
    let sqlClient;
    try {
      sqlClient = await pool.connect();

      await sqlClient.query("BEGIN");

      const properContactID = idSubstring + "-" + (contactID.startsWith("+") ? contactID.slice(1) : contactID);

      const checkQuery = `
        SELECT id FROM public.contacts
        WHERE contact_id = $1 AND company_id = $2
      `;

      const checkResult = await sqlClient.query(checkQuery, [
        properContactID,
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
          properContactID,
          idSubstring,
          threadID,
          contactID,
          contactID,
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

        await sqlClient.query(updateQuery, [threadID, properContactID, idSubstring]);
        console.log(
          `Thread ID updated in PostgreSQL for existing contact ${properContactID}`
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

  async sendReminderToCustomer(customerName, phoneNumber, teacherName, rowNumber) {
    const message = `Assalamualaikum ${customerName},
Kelas bersama ${teacherName} telah berlangsung semalam.
    
Mohon sahkan kehadiran dengan membalas:
- 'Hadir' jika hadir
- 'Tak Hadir' jika tidak hadir
    
Sekiranya kelas ditunda, sila pilih hari baru dengan membalas:
- 'Tunda' jika ditunda
    
Terima kasih`;

    const botData = this.botMap.get(this.botName);
    if (!botData || !botData[0].client) {
      console.log(`WhatsApp client not found for bot ${this.botName}`);
      return;
    }
    const client = botData[0].client;
    const extractedNumber = "+" + phoneNumber.split("@")[0];
    let contactID;
    let contactName;
    let threadID;
    let stopTag;
    let unreadCount;
    try {
      const contactData = await this.getContactDataFromDatabaseByPhone(extractedNumber, this.botName);
      if (contactData !== null) {
        stopTag = contactData.tags;
        console.log(stopTag);
        unreadCount = contactData.unreadCount ?? 0;
        contactID = extractedNumber;
        contactName = contactData.contactName ?? customerName ?? extractedNumber;

        if (contactData.threadid) {
          threadID = contactData.threadid;
        } else {
          const thread = await this.createThread();
          threadID = thread.id;
          await this.saveThreadIDPostgres(contactID, threadID, this.botName);
        }
      } else {
        await this.customWait(2500);

        contactID = extractedNumber;
        contactName = customerName || extractedNumber;

        const thread = await this.createThread();
        threadID = thread.id;
        console.log(threadID);
        await this.saveThreadIDPostgres(contactID, threadID, this.botName);
        console.log(`Created a new contact in PostgreSQL for contact ${contactID} in BHQ Spreadsheet`);
      }

      const sentMessage = await client.sendMessage(`${phoneNumber}@c.us`, message);
      await this.tagContactWithAttendance(phoneNumber);
      await this.addMessageToPostgres(sentMessage, this.botName, extractedNumber);
      console.log(`Reminder sent to ${teacherName} (${phoneNumber})`);
    } catch (error) {
      console.error(`Error sending reminder to ${teacherName} (${phoneNumber}):`, error);
    }
  }

  async tagContactWithAttendance(phoneNumber) {
    const contactID =
      this.botName +
      "-" +
      phoneNumber.split("@")[0];
    const tag = "attendance";

    const sqlClient = await pool.connect();

    try {
      await sqlClient.query("BEGIN");

      const checkQuery = `
        SELECT 1 FROM public.contacts 
        WHERE contact_id = $1 AND company_id = $2
      `;
      const checkResult = await sqlClient.query(checkQuery, [
        contactID,
        this.botName,
      ]);

      if (checkResult.rows.length === 0) {
        throw new Error("Contact does not exist!");
      }

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
        this.botName,
      ]);

      if (!addResult.rows[0].tag_existed_before_update) {
        console.log(`Tag "${tag}" added successfully to contact ${contactID}`);
      } else {
        console.log(`Tag "${tag}" already exists for contact ${contactID}`);
      }

      await sqlClient.query("COMMIT");
    } catch (error) {
      await sqlClient.query("ROLLBACK");
      console.error("Error managing tags in PostgreSQL:", error);
    } finally {
      sqlClient.release();
    }
  }

  async sendStudentReports(rows) {
    try {
      console.log("Starting student report generation...");
      const studentHoursByDay = {};
      const days = ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"];

      // Validate header row exists
      if (!rows[3] || !Array.isArray(rows[3])) {
        console.error("Invalid header row structure:", rows[3]);
        return;
      }

      // Find column indices with error checking
      const dayIndices = days.map((day) => {
        const index = rows[3].findIndex((col) => col?.trim().toLowerCase() === day.toLowerCase());
        if (index === -1) {
          console.warn(`Warning: Column for day ${day} not found`);
        }
        console.log(`Found index ${index} for day ${day}`);
        return index;
      });

      // Verify at least some day columns were found
      if (dayIndices.every((index) => index === -1)) {
        console.error("No valid day columns found in spreadsheet");
        return;
      }

      // Process each row
      for (let i = 5; i < rows.length; i++) {
        try {
          const timeSlot = rows[i]?.[0];
          if (!timeSlot) continue;

          dayIndices.forEach((dayIndex, idx) => {
            if (dayIndex === -1) {
              console.log(`Skipping day ${days[idx]} because index is -1`);
              return;
            }
            try {
              const studentName = rows[i]?.[dayIndex]?.trim(); // Student name
              if (!studentName) return; // Skip if no student name

              const tempohCol = dayIndex + 5; // TEMPOH column
              const attendanceCol = dayIndex + 6; // KEHADIRAN column
              const tempohValue = parseFloat(rows[i]?.[tempohCol]) || 0;
              const attendanceValue = rows[i]?.[attendanceCol];

              // Check if attendance is marked (1 or 2 indicates attendance)
              const attended =
                attendanceValue === "1" ||
                attendanceValue === "2" ||
                attendanceValue === 1 ||
                attendanceValue === 2 ||
                attendanceValue?.toString().toUpperCase() === "TRUE";

              if (studentName && tempohValue > 0) {
                if (!studentHoursByDay[days[idx]]) {
                  studentHoursByDay[days[idx]] = {};
                }
                if (!studentHoursByDay[days[idx]][studentName]) {
                  studentHoursByDay[days[idx]][studentName] = { total: 0, completed: 0 };
                }
                studentHoursByDay[days[idx]][studentName].total += tempohValue;
                if (attended) {
                  studentHoursByDay[days[idx]][studentName].completed += tempohValue;
                }
              }
            } catch (rowError) {
              console.error(`Error processing row ${i} for day ${days[idx]}:`, rowError);
            }
          });
        } catch (rowError) {
          console.error(`Error processing row ${i}:`, rowError);
          continue;
        }
      }

      // Generate report
      let reportMessage = "Weekly Student Report\n";
      reportMessage += "===================\n\n";

      if (Object.keys(studentHoursByDay).length > 0) {
        days.forEach((day) => {
          if (studentHoursByDay[day] && Object.keys(studentHoursByDay[day]).length > 0) {
            reportMessage += `${day}\n======\n`;
            const sortedStudents = Object.entries(studentHoursByDay[day]).sort(([nameA], [nameB]) =>
              nameA.localeCompare(nameB)
            );

            sortedStudents.forEach(([student, hours]) => {
              const percentage = ((hours.completed / hours.total) * 100).toFixed(1);
              reportMessage += `${student} : ${hours.completed}/${hours.total} hours (${percentage}%)\n`;
            });
            reportMessage += "======\n\n";
          } else {
            console.log(`Debug: No data for ${day}`);
          }
        });
      } else {
        reportMessage += "No class hours were recorded for any students this week.\n";
        reportMessage += "Please ensure class hours are properly marked in the spreadsheet.\n";
      }

      // Send the report
      const botData = this.botMap.get(this.botName);
      if (!botData || !botData[0].client) {
        console.error(`WhatsApp client not found for bot ${this.botName}`);
        return;
      }

      const whatsappGroupId = "120363225984522400@g.us";
      const client = botData[0].client;

      try {
        await client.sendMessage(whatsappGroupId, reportMessage);
        console.log("Student report sent successfully");
      } catch (error) {
        console.error("Error sending student report:", error);
      }
    } catch (error) {
      console.error("Critical error in sendStudentReports:", error);
      console.error(error.stack);
    }
  }

  async generateMonthlyReport(month, year) {
    try {
      // Convert month to number (1-12)
      const monthMap = {
        JAN: 1,
        FEB: 2,
        MAC: 3,
        APR: 4,
        MAY: 5,
        JUN: 6,
        JUL: 7,
        AUG: 8,
        SEP: 9,
        OCT: 10,
        NOV: 11,
        DEC: 12,
      };
      const reverseMonthMap = {
        1: "JAN",
        2: "FEB",
        3: "MAC",
        4: "APR",
        5: "MAY",
        6: "JUN",
        7: "JUL",
        8: "AUG",
        9: "SEP",
        10: "OCT",
        11: "NOV",
        12: "DEC",
      };

      // Get current month number
      const currentMonthNum = monthMap[month];
      // Calculate previous month
      let prevMonthNum = currentMonthNum - 1;
      let prevYear = year;

      // Handle January case (previous month is December of previous year)
      if (prevMonthNum === 0) {
        prevMonthNum = 12;
        prevYear = parseInt(year) - 1;
      }

      // Get previous month name
      const prevMonth = reverseMonthMap[prevMonthNum];

      const baseWeeks = ["W1", "W2", "W3", "W4"];
      const studentData = {};

      let maxClasses = 0;
      let processedWeeks = 0;

      const formatTime = (time) => {
        return time % 1 === 0 ? time.toFixed(0) : time.toFixed(2);
      };

      // First process base weeks W1-W4
      for (const week of baseWeeks) {
        const sheetName = `${prevMonth}${prevYear} ${week}`;
        console.log(`Processing sheet: ${sheetName}`);

        try {
          const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${sheetName}!A1:AY`,
          });
          processedWeeks++;

          const rows = response.data.values;
          if (!rows || rows.length < 4) {
            console.error(`Invalid data in sheet ${sheetName}`);
            continue;
          }

          const days = ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"];
          const dayIndices = days.map((day) => {
            const index = rows[3].findIndex((col) => col?.trim().toLowerCase() === day.toLowerCase());
            if (index === -1) {
              console.log(`${day} column not found in ${sheetName}`);
            }
            return index;
          });

          console.log(`Day indices for ${sheetName}:`, dayIndices);

          const maxRows = 60;

          for (let i = 4; i < maxRows; i++) {
            dayIndices.forEach((dayIndex, idx) => {
              if (dayIndex === -1) return;

              const teacherName = rows[i]?.[dayIndex + 2]?.trim();
              const customerName = rows[i]?.[dayIndex + 0]?.trim();
              if (!teacherName || !customerName) {
                // Log only if there's any data in this row for this day
                if (rows[i]?.[dayIndex] || rows[i]?.[dayIndex + 1] || rows[i]?.[dayIndex + 2]) {
                  console.log(`Missing teacher or customer name in ${sheetName}, row ${i + 1}, day ${days[idx]}`);
                }
                return;
              }

              const tempohCol = dayIndex + 5;
              const attendanceCol = dayIndex + 6;
              const classTypeCol = dayIndex + 4;
              const tempohValue = parseFloat(rows[i]?.[tempohCol]);
              const attendanceValue = rows[i]?.[attendanceCol];
              const classType = rows[i]?.[classTypeCol]?.trim().toLowerCase();

              if (isNaN(tempohValue)) {
                console.log(
                  `Invalid tempoh value for ${teacherName} - ${customerName} in ${sheetName}, row ${i + 1}, day ${
                    days[idx]
                  }`
                );
                return;
              }

              const attended = ["1", "2", "TRUE"].includes(attendanceValue?.toString().toUpperCase());

              if (!studentData[teacherName]) {
                studentData[teacherName] = { totalClasses: 0, customers: {} };
              }
              if (!studentData[teacherName].customers[customerName]) {
                studentData[teacherName].customers[customerName] = {
                  classes: [],
                  attended: 0,
                  canceled: 0,
                  total: 0,
                  offline: 0,
                  online: 0,
                };
              }

              studentData[teacherName].customers[customerName].total += tempohValue;
              if (attended) {
                studentData[teacherName].customers[customerName].attended += tempohValue;
              } else if (tempohValue > 0) {
                studentData[teacherName].customers[customerName].canceled += tempohValue;
              }

              if (classType === "offline") {
                studentData[teacherName].customers[customerName].offline += 1;
              } else if (classType === "online") {
                studentData[teacherName].customers[customerName].online += 1;
              }

              // Format the class information
              const attendedTime = attended ? tempohValue : 0;
              const classInfo = `${formatTime(attendedTime)}/${formatTime(tempohValue)} jam`;
              studentData[teacherName].customers[customerName].classes.push(classInfo);

              studentData[teacherName].totalClasses += 1;
            });
          }
        } catch (error) {
          console.log(`Sheet ${sheetName} not found or error accessing it, skipping...`);
          continue;
        }
      }

      // Check if W5 exists and process it
      const w5SheetName = `${prevMonth}${prevYear} W5`;
      try {
        const w5Response = await this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: `${w5SheetName}!A1:AY`,
        });
        console.log(`Processing sheet: ${w5SheetName}`);
        processedWeeks++;

        const w5Rows = w5Response.data.values;
        if (!w5Rows || w5Rows.length < 4) {
          console.error(`Invalid data in sheet ${w5SheetName}`);
        } else {
          const days = ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"];
          const dayIndices = days.map((day) => {
            const index = w5Rows[3].findIndex((col) => col?.trim().toLowerCase() === day.toLowerCase());
            if (index === -1) {
              console.log(`${day} column not found in ${w5SheetName}`);
            }
            return index;
          });

          console.log(`Day indices for ${w5SheetName}:`, dayIndices);

          const maxRows = 60;

          for (let i = 4; i < maxRows; i++) {
            dayIndices.forEach((dayIndex, idx) => {
              if (dayIndex === -1) return;

              const teacherName = w5Rows[i]?.[dayIndex + 2]?.trim();
              const customerName = w5Rows[i]?.[dayIndex + 0]?.trim();
              if (!teacherName || !customerName) {
                // Log only if there's any data in this row for this day
                if (w5Rows[i]?.[dayIndex] || w5Rows[i]?.[dayIndex + 1] || w5Rows[i]?.[dayIndex + 2]) {
                  console.log(`Missing teacher or customer name in ${w5SheetName}, row ${i + 1}, day ${days[idx]}`);
                }
                return;
              }

              const tempohCol = dayIndex + 5;
              const attendanceCol = dayIndex + 6;
              const classTypeCol = dayIndex + 4;
              const tempohValue = parseFloat(w5Rows[i]?.[tempohCol]);
              const attendanceValue = w5Rows[i]?.[attendanceCol];
              const classType = w5Rows[i]?.[classTypeCol]?.trim().toLowerCase();

              if (isNaN(tempohValue)) {
                console.log(
                  `Invalid tempoh value for ${teacherName} - ${customerName} in ${w5SheetName}, row ${i + 1}, day ${
                    days[idx]
                  }`
                );
                return;
              }

              const attended = ["1", "2", "TRUE"].includes(attendanceValue?.toString().toUpperCase());

              if (!studentData[teacherName]) {
                studentData[teacherName] = { totalClasses: 0, customers: {} };
              }
              if (!studentData[teacherName].customers[customerName]) {
                studentData[teacherName].customers[customerName] = {
                  classes: [],
                  attended: 0,
                  canceled: 0,
                  total: 0,
                  offline: 0,
                  online: 0,
                };
              }

              studentData[teacherName].customers[customerName].total += tempohValue;
              if (attended) {
                studentData[teacherName].customers[customerName].attended += tempohValue;
              } else if (tempohValue > 0) {
                studentData[teacherName].customers[customerName].canceled += tempohValue;
              }

              if (classType === "offline") {
                studentData[teacherName].customers[customerName].offline += 1;
              } else if (classType === "online") {
                studentData[teacherName].customers[customerName].online += 1;
              }

              // Format the class information
              const attendedTime = attended ? tempohValue : 0;
              const classInfo = `${formatTime(attendedTime)}/${formatTime(tempohValue)} jam`;
              studentData[teacherName].customers[customerName].classes.push(classInfo);

              studentData[teacherName].totalClasses += 1;
            });
          }
        }
      } catch (error) {
        console.log(`Week 5 sheet (${w5SheetName}) not found, continuing with weeks 1-4 only`);
      }

      console.log(`Processed ${processedWeeks} weeks out of ${baseWeeks.length + 1}`);

      for (const [teacher, data] of Object.entries(studentData)) {
        for (const [customer, customerData] of Object.entries(data.customers)) {
          maxClasses = Math.max(maxClasses, customerData.classes.length);
        }
      }

      const headerRow = ["GURU", "PELAJAR"];
      for (let i = 1; i <= maxClasses; i++) {
        headerRow.push(`KELAS ${i}`);
      }
      headerRow.push(
        "BERJALAN",
        "CANCEL",
        "SEBENAR",
        "OFFLINE",
        "ONLINE",
        "TOTAL CLASSES",
        "BAYARAN PELANGGAN PER JAM",
        "TOTAL BAYARAN PELANGGAN",
        "BAYARAN GURU PER JAM",
        "TOTAL BAYARAN GURU"
      );

      const monthlyReportSheet = `${prevMonth}${prevYear} MONTHLY REPORT`;
      const reportData = [headerRow];

      for (const [teacher, data] of Object.entries(studentData)) {
        let isFirstCustomer = true;
        for (const [customer, customerData] of Object.entries(data.customers)) {
          const row = new Array(headerRow.length).fill("");

          if (isFirstCustomer) {
            row[0] = `${teacher} (Jumlah Keseluruhan: ${data.totalClasses})`;
            isFirstCustomer = false;
          }

          row[1] = customer;

          for (let i = 0; i < maxClasses; i++) {
            row[i + 2] = customerData.classes[i] || null;
          }

          row[maxClasses + 2] = `${formatTime(customerData.attended)} jam`;
          row[maxClasses + 3] = `${formatTime(customerData.canceled)} jam`;
          row[maxClasses + 4] = `${formatTime(customerData.total)} jam`;
          row[maxClasses + 5] = customerData.offline;
          row[maxClasses + 6] = customerData.online;
          row[maxClasses + 7] = customerData.offline + customerData.online;

          reportData.push(row);
        }

        if (Object.keys(studentData).indexOf(teacher) < Object.keys(studentData).length - 1) {
          reportData.push(new Array(headerRow.length).fill(""));
        }
      }

      // Calculate totals for each column
      const totalsRow = new Array(headerRow.length).fill("");
      totalsRow[0] = "JUMLAH:";

      // Get all data excluding header
      const dataRows = reportData.slice(1);

      // Process each column
      for (let colIndex = 0; colIndex < headerRow.length; colIndex++) {
        const columnHeader = headerRow[colIndex];

        if (columnHeader === "GURU") {
          // Count unique teachers (non-empty cells in GURU column)
          const uniqueTeachers = new Set(
            dataRows.map((row) => row[colIndex]).filter((cell) => cell && cell.trim() !== "")
          );
          totalsRow[colIndex] = uniqueTeachers.size.toString();
        } else if (columnHeader === "PELAJAR") {
          // Count unique students (non-empty cells in PELAJAR column)
          const uniqueStudents = new Set(
            dataRows.map((row) => row[colIndex]).filter((cell) => cell && cell.trim() !== "")
          );
          totalsRow[colIndex] = uniqueStudents.size.toString();
        } else if (columnHeader.includes("KELAS") || ["BERJALAN", "CANCEL", "SEBENAR"].includes(columnHeader)) {
          // Sum up hours for class columns and time-related columns
          let totalHours = 0;
          let totalMinutes = 0;

          dataRows.forEach((row) => {
            const cell = row[colIndex];
            if (cell && typeof cell === "string") {
              // Extract hours and minutes from strings like "1/1 jam" or "0.5/0.50 jam"
              const match = cell.match(/(\d+(?:\.\d+)?)\/?(\d+(?:\.\d+)?)?\s*jam/);
              if (match) {
                // If there's a fraction (e.g., "1.5/1.50 jam"), take the first number
                const hours = parseFloat(match[1]);
                if (!isNaN(hours)) {
                  totalHours += hours;
                }
              }
            }
          });

          // Convert total minutes to hours if any
          totalHours += totalMinutes / 60;

          // Format the total with one decimal place if it's not a whole number
          totalsRow[colIndex] = totalHours % 1 === 0 ? `${totalHours} jam` : `${totalHours.toFixed(2)} jam`;
        } else if (["OFFLINE", "ONLINE", "TOTAL CLASSES"].includes(columnHeader)) {
          // Sum up numeric values
          const total = dataRows.reduce((sum, row) => {
            const value = parseInt(row[colIndex]);
            return sum + (isNaN(value) ? 0 : value);
          }, 0);
          totalsRow[colIndex] = total.toString();
        }
      }

      // Add an empty row before totals
      reportData.push(new Array(headerRow.length).fill(""));
      // Add the totals row
      reportData.push(totalsRow);

      // First, ensure the sheet exists or create it
      try {
        // Check if sheet exists
        await this.sheets.spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          ranges: [monthlyReportSheet],
          fields: "sheets.properties.title",
        });
      } catch (error) {
        // Sheet doesn't exist, create it
        console.log("Creating new sheet:", monthlyReportSheet);
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: monthlyReportSheet,
                  },
                },
              },
            ],
          },
        });
      }

      // Now write the data
      console.log("Writing data to sheet:", monthlyReportSheet);
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: monthlyReportSheet,
      });

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${monthlyReportSheet}!A1`,
        valueInputOption: "USER_ENTERED",
        resource: { values: reportData },
      });

      // Get the sheet ID for formatting
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: "sheets(properties(sheetId,title))",
      });

      const sheetId = response.data.sheets.find((sheet) => sheet.properties.title === monthlyReportSheet).properties
        .sheetId;

      // Apply formatting
      await this.applyFormatting(sheetId, reportData.length, headerRow.length, monthlyReportSheet);

      console.log(`Monthly report generated for ${prevMonth} ${prevYear}`);
    } catch (error) {
      console.error("Error generating monthly report:", error);
      throw error;
    }
  }

  async applyFormatting(sheetId, rowCount, columnCount, sheetName) {
    const requests = [
      // Make header row bold
      {
        repeatCell: {
          range: {
            sheetId: sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
          },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
            },
          },
          fields: "userEnteredFormat.textFormat.bold",
        },
      },
      // Add borders to the entire table
      {
        updateBorders: {
          range: {
            sheetId: sheetId,
            startRowIndex: 0,
            endRowIndex: rowCount,
            startColumnIndex: 0,
            endColumnIndex: columnCount,
          },
          top: { style: "SOLID" },
          bottom: { style: "SOLID" },
          left: { style: "SOLID" },
          right: { style: "SOLID" },
          innerHorizontal: { style: "SOLID" },
          innerVertical: { style: "SOLID" },
        },
      },
    ];

    // Get the header row to find column positions
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A1:${this.columnToLetter(columnCount)}1`,
    });

    const headerRow = response.data.values[0];

    // Define base colors
    const columnColors = {
      GURU: { red: 0.9, green: 0.9, blue: 0.9 }, // Light gray
      PELAJAR: { red: 0.95, green: 0.9, blue: 0.8 }, // Light peach
      BERJALAN: { red: 0.95, green: 0.85, blue: 0.85 }, // Light pink
      CANCEL: { red: 0.85, green: 0.95, blue: 0.85 }, // Light green
      SEBENAR: { red: 0.85, green: 0.85, blue: 0.95 }, // Light blue
      OFFLINE: { red: 0.95, green: 0.95, blue: 0.85 }, // Light yellow
      ONLINE: { red: 0.85, green: 0.95, blue: 0.95 }, // Light cyan
      "TOTAL CLASSES": { red: 0.95, green: 0.85, blue: 0.95 }, // Light purple
    };

    // Process each column
    headerRow.forEach((columnName, columnIndex) => {
      let color;
      if (columnName.includes("KELAS")) {
        // Simple pastel color for KELAS columns
        color = {
          red: 0.9,
          green: 0.9,
          blue: 0.95,
        };
      } else {
        color = columnColors[columnName];
      }

      if (color) {
        requests.push({
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: 1, // Start after header
              endRowIndex: rowCount,
              startColumnIndex: columnIndex,
              endColumnIndex: columnIndex + 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: color,
              },
            },
            fields: "userEnteredFormat.backgroundColor",
          },
        });
      }
    });

    // Make header row white background
    requests.push({
      repeatCell: {
        range: {
          sheetId: sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: columnCount,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 1, green: 1, blue: 1 }, // White
          },
        },
        fields: "userEnteredFormat.backgroundColor",
      },
    });

    // Apply all formatting
    try {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: { requests },
      });
      console.log("Formatting applied successfully");
    } catch (error) {
      console.error("Error applying formatting:", error);
    }
  }

  initialize() {
    // Run the refresh immediately when initialized
    this.refreshAndProcessTimetable();

    const cronConfig = {
      timezone: "Asia/Kuala_Lumpur",
      scheduled: true,
      runOnInit: false,
    };

    // Schedule regular refreshes every 5 minutes
    cron.schedule(
      "*/15 * * * *",
      async () => {
        console.log(`Refreshing timetable for bot ${this.botName}...`);
        await this.refreshAndProcessTimetable();
      },
      cronConfig
    );

    // Schedule student reports for 11:30 PM on Sundays
    cron.schedule(
      "30 23 * * 1",
      async () => {
        console.log("Running scheduled Sunday reports...");
        const response = await this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: this.range,
        });

        // Send student reports
        await this.sendStudentReports(response.data.values);
      },
      cronConfig
    );

    // Schedule monthly report generation check every 2 minutes
    cron.schedule(
      "*/5 * * * *",
      async () => {
        try {
          console.log("Checking for monthly report generation...");

          // Get the header row from the main sheet
          const headerResponse = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${this.sheetName}!F4`, // Assuming headers are in first 4 rows
          });

          const headerRows = headerResponse.data.values;
          if (!headerRows) {
            console.log("No header data found");
            return;
          }

          // Check if any cell in the header contains 'Generate'
          const hasGenerate = headerRows.some((row) =>
            row.some((cell) => cell && cell.toString().trim().toUpperCase() === "GENERATE")
          );

          if (hasGenerate) {
            console.log('Found "Generate" in headers, proceeding with report generation...');

            // ... existing code ...
            const currentDate = new Date();
            const monthName = currentDate.toLocaleString("en-US", { month: "short" }).toUpperCase();
            const yearShort = currentDate.getFullYear() % 100;
            // ... existing code ...

            const monthlyReportSheet = `${monthName}${yearShort} MONTHLY REPORT`;

            // Generate the report
            await this.generateMonthlyReport(monthName, yearShort);
            console.log(`Generated monthly report for ${monthName} ${yearShort}`);

            // Update 'Generate' to 'GENERATED' in the header
            const updateRequests = [];

            // Find and update all instances of 'Generate'
            headerRows.forEach((row, rowIndex) => {
              row.forEach((cell, colIndex) => {
                if (cell && cell.toString().trim().toUpperCase() === "GENERATE") {
                  updateRequests.push({
                    range: `${this.sheetName}!${this.columnToLetter(colIndex + 1)}${rowIndex + 1}`,
                    values: [["GENERATED"]],
                  });
                }
              });
            });

            // Batch update all 'Generate' cells to 'GENERATED'
            if (updateRequests.length > 0) {
              await this.sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                resource: {
                  valueInputOption: "RAW",
                  data: updateRequests,
                },
              });
              console.log('Updated "Generate" to "GENERATED" in headers');
            }
          } else {
            console.log('No "Generate" found in headers, skipping report generation');
          }
        } catch (error) {
          console.error("Error in monthly report generation check:", error);
        }
      },
      cronConfig
    );

    // Clear old reminders every 5 minutes
    cron.schedule(
      "*/15 * * * *",
      async () => {
        console.log("Clearing old sent reminders");
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        for (const [key, timestamp] of Object.entries(this.sentReminders)) {
          if (timestamp < oneDayAgo) {
            delete this.sentReminders[key];
          }
        }
        await this.saveSentReminders();
      },
      cronConfig
    );
  }
}

module.exports = bhqSpreadsheet;