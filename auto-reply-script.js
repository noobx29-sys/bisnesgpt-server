// Auto-Reply Script for Multiple Companies
// Checks for unreplied messages in the last X hours and automatically responds

// Configuration
const DEFAULT_HOURS_THRESHOLD = 24;
const DRY_RUN = false; // Set to true to only log what would be replied to

class AutoReplyChecker {
    constructor() {
        this.stats = new Map(); // Store stats per company
        this.isRunning = new Map(); // Track running status per company
    }

    // Get database pool from global scope
    getPool() {
        if (global.pool) {
            return global.pool;
        }
        throw new Error('Database pool not available globally');
    }

    // Get WhatsApp client for a company
    getWhatsAppClient(companyId, phoneIndex = 0) {
        try {
            const botMap = global.botMap;
            
            if (!botMap) {
                throw new Error('botMap not available globally');
            }

            const botData = botMap.get(companyId);
            console.log(`🔍 Looking for company ${companyId}, phone index ${phoneIndex}`);
            console.log(`📊 Available companies in botMap:`, Array.from(botMap.keys()));
            
            if (!botData) {
                throw new Error(`No bot data found for company ${companyId}`);
            }

            // Handle both array and single client structures
            if (Array.isArray(botData)) {
                if (phoneIndex >= botData.length) {
                    throw new Error(`Phone index ${phoneIndex} out of range for company ${companyId}`);
                }
                const phoneData = botData[phoneIndex];
                if (!phoneData || !phoneData.client) {
                    throw new Error(`No client found for company ${companyId}, phone index ${phoneIndex}`);
                }
                return {
                    client: phoneData.client,
                    phoneIndex: phoneIndex
                };
            } else {
                if (!botData.client) {
                    throw new Error(`No client found for company ${companyId}`);
                }
                return {
                    client: botData.client,
                    phoneIndex: 0
                };
            }
        } catch (error) {
            console.error(`❌ WhatsApp client not available: ${error.message}`);
            throw error;
        }
    }

    // Check for unreplied messages for a specific company
    async checkUnrepliedMessages(companyId, hoursThreshold = DEFAULT_HOURS_THRESHOLD, specificPhoneNumber = null) {
        let client;
        try {
            console.log(`🧪 Starting auto-reply ${specificPhoneNumber ? 'TEST' : 'check'} for company ${companyId}${specificPhoneNumber ? ` on ${specificPhoneNumber}` : ''}`);
            console.log(`Looking for messages from last ${hoursThreshold} hours`);

            if (this.isRunning.get(companyId)) {
                throw new Error(`Auto-reply check already running for company ${companyId}`);
            }

            this.isRunning.set(companyId, true);
            
            const pool = this.getPool();
            client = await pool.connect();
            console.log('Database connection acquired from pool');

            // Get the actual unreplied messages
            let query = `
                WITH latest_messages AS (
                    SELECT DISTINCT ON (customer_phone) 
                        customer_phone,
                        direction,
                        created_at,
                        content,
                        from_me
                    FROM messages 
                    WHERE company_id = $1 
                        AND created_at > NOW() - INTERVAL '${hoursThreshold} hours'
                        ${specificPhoneNumber ? 'AND customer_phone = $2' : ''}
                    ORDER BY customer_phone, created_at DESC
                ),
                unreplied AS (
                    SELECT 
                        lm.*,
                        (
                            SELECT MAX(created_at) 
                            FROM messages m2 
                            WHERE m2.customer_phone = lm.customer_phone 
                                AND m2.company_id = $1 
                                AND m2.from_me = true 
                                AND m2.created_at > lm.created_at
                        ) as last_reply_time
                    FROM latest_messages lm
                    WHERE lm.direction = 'inbound' 
                        AND lm.from_me = false
                        AND NOT EXISTS (
                            SELECT 1 FROM messages m2 
                            WHERE m2.customer_phone = lm.customer_phone 
                                AND m2.company_id = $1 
                                AND m2.from_me = true 
                                AND m2.created_at > lm.created_at
                        )
                )
                SELECT * FROM unreplied 
                ORDER BY created_at DESC
                LIMIT 50
            `;

            const params = specificPhoneNumber ? [companyId, specificPhoneNumber] : [companyId];
            const result = await client.query(query, params);

            console.log(`📱 Found ${result.rows.length} unreplied messages`);

            if (result.rows.length === 0) {
                const stats = this.updateStats(companyId, 0, 0);
                return {
                    success: true,
                    message: 'No unreplied messages found',
                    count: 0,
                    total: 0,
                    data: { 
                        count: 0, 
                        messages: [],
                        lastCheck: new Date().toISOString(),
                        messagesReplied: stats.messagesReplied
                    }
                };
            }

            // Process unreplied messages by calling OpenAI directly
            let repliedCount = 0;
            const whatsappClient = this.getWhatsAppClient(companyId, 0);
            
            // Import required functions from server.js and create local helpers
            const { handleNewMessagesTemplateWweb } = require('./bots/handleMessagesTemplateWweb.js');
            
            // Helper function to get contact data from database
            const getContactDataFromDatabaseByPhone = async (phoneNumber, companyId) => {
                const pool = this.getPool();
                const client = await pool.connect();
                try {
                    console.log(`🔍 [CONTACT_TRACKING] Searching for contact - Phone: ${phoneNumber}, Company: ${companyId}`);
                    
                    const result = await client.query(`
                        SELECT * FROM public.contacts
                        WHERE phone = $1 AND company_id = $2
                        LIMIT 1
                    `, [phoneNumber, companyId]);

                    if (result.rows.length === 0) {
                        console.log(`🔍 [CONTACT_TRACKING] No contact found for phone: ${phoneNumber}, company: ${companyId}`);
                        return null;
                    } else {
                        const contactData = result.rows[0];
                        const contactName = contactData.contact_name || contactData.name;
                        const threadID = contactData.thread_id;

                        console.log(`🔍 [CONTACT_TRACKING] Found contact:`, {
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
                } finally {
                    const safeRelease = global.safeRelease;
                    if (safeRelease) {
                        safeRelease(client);
                    } else {
                        client.release();
                    }
                }
            };
            
            // Helper function to create thread
            const createThread = async () => {
                const openai = require('openai');
                const openaiClient = new openai({ apiKey: process.env.OPENAI_API_KEY });
                const thread = await openaiClient.beta.threads.create();
                console.log("Thread created:", thread.id);
                return thread;
            };
            
            // Helper function to save thread ID
            const saveThreadIDPostgres = async (contactID, threadID, idSubstring) => {
                const pool = this.getPool();
                const client = await pool.connect();
                try {
                    await client.query("BEGIN");
                    
                    // Generate proper contact_id format
                    const properContactID = idSubstring + "-" + (contactID.startsWith("+") ? contactID.slice(1) : contactID);
                    
                    const checkQuery = `
                        SELECT id FROM public.contacts
                        WHERE contact_id = $1 AND company_id = $2
                    `;
                    
                    const checkResult = await client.query(checkQuery, [properContactID, idSubstring]);
                    
                    if (checkResult.rows.length === 0) {
                        const insertQuery = `
                            INSERT INTO public.contacts (
                                contact_id, company_id, thread_id, name, phone, last_updated, created_at
                            ) VALUES (
                                $1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                            )
                        `;
                        
                        await client.query(insertQuery, [
                            properContactID,
                            idSubstring,
                            threadID,
                            contactID,
                            contactID,
                        ]);
                        console.log(`New contact created with Thread ID for contact ${properContactID}`);
                    } else {
                        const updateQuery = `
                            UPDATE public.contacts
                            SET thread_id = $1, last_updated = CURRENT_TIMESTAMP
                            WHERE contact_id = $2 AND company_id = $3
                        `;
                        
                        await client.query(updateQuery, [threadID, properContactID, idSubstring]);
                        console.log(`Thread ID updated for existing contact ${properContactID}`);
                    }
                    
                    await client.query("COMMIT");
                } catch (error) {
                    await client.query("ROLLBACK");
                    console.error("Error saving Thread ID:", error);
                    throw error;
                } finally {
                    const safeRelease = global.safeRelease;
                    if (safeRelease) {
                        safeRelease(client);
                    } else {
                        client.release();
                    }
                }
            };
            
            // Helper function to call OpenAI Assistant just like handleMessagesTemplateWweb
            const handleOpenAIAssistant = async (message, threadID, tags, phoneNumber, idSubstring, client, name, phoneIndex) => {
                const openai = require('openai');
                const openaiClient = new openai({ apiKey: process.env.OPENAI_API_KEY });
                
                // Fetch company config to get assistant ID
                let companyConfig = {};
                try {
                    const pool = this.getPool();
                    const sqlClient = await pool.connect();
                    try {
                        const query = `
                            SELECT *
                            FROM public.companies 
                            WHERE company_id = $1
                        `;
                        
                        const result = await sqlClient.query(query, [idSubstring]);
                        
                        if (result.rows.length === 0) {
                            throw new Error(`No company config found for ${idSubstring}`);
                        }
                        
                        companyConfig = result.rows[0];
                        
                        // Parse assistant IDs
                        let assistantIds = companyConfig.assistant_ids;
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
                        companyConfig.assistantId = assistantId;
                        
                        console.log(`🔔 [AUTO_REPLY] Using assistant ID: ${assistantId} for company ${idSubstring}`);
                        
                    } finally {
                        const safeRelease = global.safeRelease;
                        if (safeRelease) {
                            safeRelease(sqlClient);
                        } else {
                            sqlClient.release();
                        }
                    }
                } catch (error) {
                    console.error(`Error fetching company config for ${idSubstring}:`, error);
                    throw error;
                }
                
                // Add message to thread (like addMessage function)
                await openaiClient.beta.threads.messages.create(threadID, {
                    role: "user",
                    content: `${message}\n\n[SYSTEM NOTE: This message was received some time ago and is being responded to automatically. Please acknowledge the delay and provide a helpful response.]`
                });
                
                // Basic tools - simplified version of what's in handleOpenAIAssistant
                const tools = []; // For auto-reply, we'll use basic tools only
                
                // Run assistant (like runAssistant function)
                const run = await openaiClient.beta.threads.runs.create(threadID, {
                    assistant_id: companyConfig.assistantId,
                    tools: tools,
                });
                
                console.log(`🔔 [AUTO_REPLY] Created run: ${run.id}`);
                
                // Wait for completion (simplified version of waitForCompletion)
                const maxAttempts = 30;
                const pollingInterval = 2000; // 2 seconds
                
                for (let attempts = 0; attempts < maxAttempts; attempts++) {
                    try {
                        const runObject = await openaiClient.beta.threads.runs.retrieve(threadID, run.id);
                        console.log(`🔔 [AUTO_REPLY] Run status: ${runObject.status} (attempt ${attempts + 1})`);
                        
                        if (runObject.status === "completed") {
                            const messagesList = await openaiClient.beta.threads.messages.list(threadID);
                            const latestMessage = messagesList.data[0].content[0].text.value;
                            console.log(`🔔 [AUTO_REPLY] AI Response: ${latestMessage.substring(0, 100)}...`);
                            return latestMessage;
                        } else if (runObject.status === "requires_action") {
                            // For auto-reply, we'll skip tool calls to keep it simple
                            console.log(`🔔 [AUTO_REPLY] Run requires action, but skipping tool calls for auto-reply`);
                            return "I'm processing your request. Please wait a moment for a complete response.";
                        } else if (["failed", "cancelled", "expired"].includes(runObject.status)) {
                            console.error(`🔔 [AUTO_REPLY] Run ${run.id} ended with status: ${runObject.status}`);
                            return "I encountered an error. Please try your request again.";
                        }
                        
                        await new Promise((resolve) => setTimeout(resolve, pollingInterval));
                    } catch (error) {
                        console.error(`🔔 [AUTO_REPLY] Error in waitForCompletion (runId: ${run.id}): ${error}`);
                        return "I'm sorry, but I encountered an error while processing your request. Please try again.";
                    }
                }
                
                console.error(`🔔 [AUTO_REPLY] Timeout: Assistant did not complete in time (runId: ${run.id})`);
                return "I'm processing your message. Please wait a moment and try again.";
            };

            for (const row of result.rows) {
                try {
                    if (DRY_RUN) {
                        console.log(`🧪 DRY RUN: Would reply to ${row.customer_phone}: ${row.content}`);
                        repliedCount++;
                        continue;
                    }

                    console.log(`📤 ${specificPhoneNumber ? 'TEST ' : ''}Auto-replying to ${row.customer_phone}...`);
                    console.log(`🔔 [AUTO_REPLY] ===== PROCESSING UNREPLIED MESSAGE =====`);
                    console.log(`🔔 [AUTO_REPLY] Bot: ${companyId}`);
                    console.log(`🔔 [AUTO_REPLY] From: ${row.customer_phone}`);
                    console.log(`🔔 [AUTO_REPLY] Body: ${row.content}`);
                    
                    // Get contact data from database
                    const contactData = await getContactDataFromDatabaseByPhone(row.customer_phone, companyId);
                    console.log(`🔔 [AUTO_REPLY] Contact data:`, contactData ? 'Found' : 'Not found');
                    
                    // Get or create thread ID
                    let threadID = contactData?.thread_id;
                    if (!threadID) {
                        console.log(`🔔 [AUTO_REPLY] Creating new thread for contact: ${row.customer_phone}`);
                        const thread = await createThread();
                        threadID = thread.id;
                        console.log(`🔔 [AUTO_REPLY] Created thread ID: ${threadID}`);
                        
                        if (contactData) {
                            await saveThreadIDPostgres(row.customer_phone, threadID, companyId);
                        }
                    } else {
                        console.log(`🔔 [AUTO_REPLY] Using existing thread ID: ${threadID}`);
                    }
                    
                    // Get contact name
                    const contactName = contactData?.name || contactData?.contact_name || row.customer_phone;
                    
                    console.log(`🔔 [AUTO_REPLY] Calling OpenAI Assistant directly...`);
                    
                    // Call OpenAI assistant directly with the message content
                    const aiResponse = await handleOpenAIAssistant(
                        row.content,           // message
                        threadID,              // threadID 
                        contactData?.tags,     // tags
                        row.customer_phone,    // phoneNumber
                        companyId,             // idSubstring
                        whatsappClient.client, // client
                        contactName,           // name
                        whatsappClient.phoneIndex || 0  // phoneIndex
                    );

                    console.log(`🔔 [AUTO_REPLY] AI Response: ${aiResponse?.substring(0, 100)}...`);
                    
                    // Send the AI response back to the customer
                    if (aiResponse && aiResponse.trim()) {
                        // Handle || separator for multiple message bubbles (like processBotResponse in template)
                        const parts = aiResponse.split(/\s*\|\|\s*/);
                        console.log(`🔔 [AUTO_REPLY] Sending ${parts.length} message part(s) to ${row.customer_phone}`);
                        
                        for (let i = 0; i < parts.length; i++) {
                            const part = parts[i].trim();
                            if (!part) continue;
                            
                            console.log(`🔔 [AUTO_REPLY] Sending part ${i + 1}/${parts.length}: ${part.substring(0, 50)}...`);
                            
                            await whatsappClient.client.sendMessage(
                                `${row.customer_phone.replace('+', '')}@c.us`, 
                                part
                            );
                            
                            // Add small delay between multiple messages to ensure proper order
                            if (i < parts.length - 1) {
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        }
                        
                        console.log(`✅ Successfully sent auto-reply to ${row.customer_phone}`);
                    } else {
                        console.log(`⚠️ No AI response generated for ${row.customer_phone}`);
                    }

                    repliedCount++;
                    console.log(`🔔 [AUTO_REPLY] ===== AUTO REPLY COMPLETE =====`);
                    
                    // Add delay between replies to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 2000));

                } catch (error) {
                    console.error(`❌ Failed to ${specificPhoneNumber ? 'TEST ' : ''}auto-reply to ${row.customer_phone}:`, error.message);
                    console.error(`❌ Error stack:`, error.stack);
                }
            }

            const stats = this.updateStats(companyId, repliedCount, result.rows.length);
            
            return {
                success: true,
                message: `${specificPhoneNumber ? 'TEST ' : ''}Auto-reply completed: ${repliedCount}/${result.rows.length} messages processed`,
                count: repliedCount,
                total: result.rows.length,
                data: {
                    lastCheck: new Date().toISOString(),
                    messagesReplied: stats.messagesReplied,
                    // Include message details for test responses
                    messages: specificPhoneNumber ? result.rows.map(row => ({
                        phone: row.customer_phone,
                        content: row.content,
                        messageTime: row.created_at,
                        lastReplyTime: row.last_reply_time
                    })) : []
                }
            };

        } catch (error) {
            console.error(`❌ Auto-reply error for company ${companyId}:`, error);
            throw error;
        } finally {
            this.isRunning.set(companyId, false);
            if (client) {
                const safeRelease = global.safeRelease;
                if (safeRelease) {
                    safeRelease(client);
                } else {
                    client.release();
                }
                console.log('Database connection released back to pool');
            }
        }
    }

    // Get unreplied messages without auto-replying
    async getUnrepliedMessages(companyId, hoursThreshold = DEFAULT_HOURS_THRESHOLD) {
        let client;
        try {
            const pool = this.getPool();
            client = await pool.connect();

            const query = `
                WITH latest_messages AS (
                    SELECT DISTINCT ON (customer_phone) 
                        customer_phone,
                        direction,
                        created_at,
                        content,
                        from_me
                    FROM messages 
                    WHERE company_id = $1 
                        AND created_at > NOW() - INTERVAL '${hoursThreshold} hours'
                    ORDER BY customer_phone, created_at DESC
                ),
                unreplied AS (
                    SELECT 
                        lm.customer_phone,
                        lm.content,
                        lm.created_at as message_time,
                        (
                            SELECT MAX(created_at) 
                            FROM messages m2 
                            WHERE m2.customer_phone = lm.customer_phone 
                                AND m2.company_id = $1 
                                AND m2.from_me = true 
                                AND m2.created_at > lm.created_at
                        ) as last_reply_time
                    FROM latest_messages lm
                    WHERE lm.direction = 'inbound' 
                        AND lm.from_me = false
                        AND NOT EXISTS (
                            SELECT 1 FROM messages m2 
                            WHERE m2.customer_phone = lm.customer_phone 
                                AND m2.company_id = $1 
                                AND m2.from_me = true 
                                AND m2.created_at > lm.created_at
                        )
                )
                SELECT 
                    customer_phone,
                    content,
                    message_time,
                    last_reply_time
                FROM unreplied 
                ORDER BY message_time DESC
                LIMIT 50
            `;

            const result = await client.query(query, [companyId]);

            return {
                success: true,
                data: {
                    count: result.rows.length,
                    messages: result.rows.map(row => ({
                        phone: row.customer_phone,
                        content: row.content,
                        messageTime: row.message_time,
                        lastReplyTime: row.last_reply_time
                    }))
                }
            };

        } catch (error) {
            console.error(`Error getting unreplied messages for company ${companyId}:`, error);
            throw error;
        } finally {
            if (client) {
                const safeRelease = global.safeRelease;
                if (safeRelease) {
                    safeRelease(client);
                } else {
                    client.release();
                }
            }
        }
    }

    // Update stats for a company
    updateStats(companyId, newReplies, totalFound) {
        const currentStats = this.stats.get(companyId) || {
            messagesReplied: 0,
            lastCheck: null,
            totalChecks: 0
        };

        const updatedStats = {
            messagesReplied: currentStats.messagesReplied + newReplies,
            lastCheck: new Date().toISOString(),
            totalChecks: currentStats.totalChecks + 1,
            lastFoundCount: totalFound
        };

        this.stats.set(companyId, updatedStats);
        return updatedStats;
    }

    // Get stats for a company
    getStats(companyId) {
        return this.stats.get(companyId) || {
            messagesReplied: 0,
            lastCheck: null,
            totalChecks: 0,
            lastFoundCount: 0
        };
    }

    // Test auto-reply on specific phone number
    async testAutoReply(companyId, phoneNumber, hoursThreshold = DEFAULT_HOURS_THRESHOLD) {
        console.log(`🧪 Testing auto-reply for company ${companyId} on ${phoneNumber}`);
        return await this.checkUnrepliedMessages(companyId, hoursThreshold, phoneNumber);
    }
}

// Create singleton instance
const autoReplyChecker = new AutoReplyChecker();

module.exports = autoReplyChecker;