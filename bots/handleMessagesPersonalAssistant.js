const OpenAI = require("openai");
const { v4: uuidv4 } = require("uuid");
const { Pool } = require("pg");
const axios = require("axios");
const FormData = require("form-data");
const { MessageMedia } = require("whatsapp-web.js");

// OpenAI configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Database connection pool
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
});

// ===== DYNAMIC AI-DRIVEN PERSONAL ASSISTANT =====

// In-memory storage for user data (in production, use database)
const userData = new Map();

/**
 * Get or create user data structure
 */
function getUserData(phoneNumber) {
  if (!userData.has(phoneNumber)) {
    userData.set(phoneNumber, {
      goals: [],
      tasks: [],
      xp: 0,
      level: 1,
      streak: 0,
      moods: [],
      checkins: [],
      preferences: {},
      conversations: [],
      lastInteraction: new Date(),
      scheduledMessages: [],
      voiceMode: false, // Track if user is in voice mode
      personalInfo: {
        values: {},
        interests: {},
        background: {},
        work: {},
        health: {},
        relationships: {},
        preferences: {},
        skills: {},
        other: {}
      },
      memories: [],
      context: [],
      learning: [],
      relationships: []
    });
  }
  return userData.get(phoneNumber);
}

/**
 * Schedule a message using the existing infrastructure
 */
async function scheduleMessage(phoneNumber, message, scheduledTime, messageType = "reminder", companyId = "0385") {
  try {
    const user = getUserData(phoneNumber);
    const currentTime = new Date();
    
    // Parse scheduled time - support various formats
    let targetTime;
    if (typeof scheduledTime === 'string') {
      // Handle relative times like "2 hours", "tomorrow 9am", "next monday"
      targetTime = parseRelativeTime(scheduledTime, currentTime);
    } else if (scheduledTime instanceof Date) {
      targetTime = scheduledTime;
    } else {
      throw new Error('Invalid scheduled time format');
    }

    // Ensure the time is in the future
    if (targetTime <= currentTime) {
      throw new Error('Scheduled time must be in the future');
    }

    // Create scheduled message object
    const scheduledMessage = {
      id: uuidv4(),
      phoneNumber,
      message,
      scheduledTime: targetTime,
      messageType,
      status: 'scheduled',
      createdAt: currentTime,
      context: {
        userLevel: user.level,
        userXP: user.xp,
        userStreak: user.streak,
        activeGoals: user.goals.filter(g => !g.completed).length
      }
    };

    // Store in user data
    user.scheduledMessages.push(scheduledMessage);

    // Schedule using the existing infrastructure
    await scheduleMessageInDatabase(phoneNumber, message, targetTime, messageType, companyId);

    console.log(`Scheduled ${messageType} message for ${phoneNumber} at ${targetTime.toISOString()}: ${message.substring(0, 50)}...`);
    
    return {
      success: true,
      messageId: scheduledMessage.id,
      scheduledTime: targetTime,
      message: `I've scheduled a ${messageType} message for ${targetTime.toLocaleString()}`
    };

  } catch (error) {
    console.error("Error scheduling message:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Parse relative time expressions
 */
function parseRelativeTime(timeExpression, currentTime) {
  const lowerExpression = timeExpression.toLowerCase().trim();
  const now = new Date(currentTime);
  
  // Handle "in X hours/minutes/days"
  const inMatch = lowerExpression.match(/in (\d+) (hour|minute|day|week)s?/);
  if (inMatch) {
    const amount = parseInt(inMatch[1]);
    const unit = inMatch[2];
    const targetTime = new Date(now);
    
    switch (unit) {
      case 'hour':
        targetTime.setHours(targetTime.getHours() + amount);
        break;
      case 'minute':
        targetTime.setMinutes(targetTime.getMinutes() + amount);
        break;
      case 'day':
        targetTime.setDate(targetTime.getDate() + amount);
        break;
      case 'week':
        targetTime.setDate(targetTime.getDate() + (amount * 7));
        break;
    }
    return targetTime;
  }

  // Handle tomorrow with time patterns
  if (lowerExpression.includes('tomorrow')) {
    // Extract time from the expression
    const timeMatch = lowerExpression.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const ampm = timeMatch[3];
      
      // Handle AM/PM conversion
      if (ampm === 'pm' && hour !== 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      // If no AM/PM specified and hour <= 12, assume PM for evening times (5-11)
      if (!ampm && hour >= 5 && hour <= 11) hour += 12;
      
      const targetTime = new Date(now);
      targetTime.setDate(targetTime.getDate() + 1);
      targetTime.setHours(hour, minute, 0, 0);
      
      console.log(`⏰ Parsed "${timeExpression}" as: ${targetTime.toLocaleString()} (UTC: ${targetTime.toISOString()})`);
      return targetTime;
    }
  }

  // Handle "next monday/tuesday/etc"
  const dayMatch = lowerExpression.match(/next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (dayMatch) {
    const dayName = dayMatch[1];
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(dayName);
    const currentDay = now.getDay();
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    
    const targetTime = new Date(now);
    targetTime.setDate(targetTime.getDate() + daysToAdd);
    targetTime.setHours(9, 0, 0, 0); // Default to 9 AM
    return targetTime;
  }

  // Handle specific times like "9am", "2pm"
  const timeMatch = lowerExpression.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1]);
    const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const ampm = timeMatch[3];
    
    if (ampm === 'pm' && hour !== 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    
    const targetTime = new Date(now);
    targetTime.setHours(hour, minute, 0, 0);
    
    // If the time has passed today, schedule for tomorrow
    if (targetTime <= now) {
      targetTime.setDate(targetTime.getDate() + 1);
    }
    
    console.log(`⏰ Parsed "${timeExpression}" as: ${targetTime.toLocaleString()} (UTC: ${targetTime.toISOString()})`);
    return targetTime;
  }

  // Default: try to parse as ISO string
  const parsed = new Date(timeExpression);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  throw new Error(`Unable to parse time expression: ${timeExpression}`);
}

/**
 * Ensure contact exists in database, create if it doesn't
 */
async function ensureContactExists(phoneNumber, companyId) {
  let sqlClient;
  try {
    // First check if contact exists
    const existingContact = await getContactDataFromDatabaseByPhone(phoneNumber, companyId);
    if (existingContact && existingContact.contact_id) {
      console.log(`📞 Contact ${phoneNumber} already exists: ${existingContact.contact_id}`);
      return existingContact.contact_id;
    }

    // Create new contact if it doesn't exist - following templatewweb pattern
    console.log(`📞 Creating new contact for ${phoneNumber} in company ${companyId}`);
    
    sqlClient = await pool.connect();
    await sqlClient.query("BEGIN");

    // Format contact_id like templatewweb: companyId + "-" + phone (without +)
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    const contactId = companyId + "-" + (formattedPhone.startsWith("+") ? formattedPhone.slice(1) : formattedPhone);

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

    const contactData = {
      name: 'Personal Assistant User',
      phone: formattedPhone,
      tags: [],
      unread_count: 0,
      created_at: new Date(),
      last_updated: new Date(),
      chat_data: {},
      company: null,
      thread_id: null,
      last_message: {},
      profile_pic_url: null,
      additional_emails: [],
      address1: null,
      assigned_to: null,
      business_id: null,
      chat_id: null,
      is_group: false
    };

    await sqlClient.query(insertQuery, [
      contactId,
      companyId,
      contactData.name,
      contactData.phone,
      JSON.stringify(contactData.tags),
      contactData.unread_count,
      contactData.created_at,
      contactData.last_updated,
      JSON.stringify(contactData.chat_data),
      contactData.company,
      contactData.thread_id,
      JSON.stringify(contactData.last_message),
      contactData.profile_pic_url,
      JSON.stringify(contactData.additional_emails),
      contactData.address1,
      contactData.assigned_to,
      contactData.business_id,
      contactData.chat_id,
      contactData.is_group
    ]);

    await sqlClient.query("COMMIT");
    console.log(`📞 Contact created successfully: ${contactId}`);
    return contactId;

  } catch (error) {
    if (sqlClient) {
      try {
        await sqlClient.query("ROLLBACK");
      } catch (rollbackError) {
        console.error('Error rolling back transaction:', rollbackError);
      }
    }
    
    // If it's a duplicate key error, the contact already exists - return the expected contactId
    if (error.code === '23505' && error.constraint === 'contacts_contact_id_company_id_key') {
      const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
      const contactId = companyId + "-" + (formattedPhone.startsWith("+") ? formattedPhone.slice(1) : formattedPhone);
      console.log(`📞 Contact ${contactId} already exists (duplicate key detected)`);
      return contactId;
    }
    
    console.error('Error ensuring contact exists:', error);
    throw error;
  } finally {
    if (sqlClient) {
      sqlClient.release();
    }
  }
}

/**
 * Schedule message in database using existing infrastructure
 */
async function scheduleMessageInDatabase(phoneNumber, message, scheduledTime, messageType, companyId = '0385') {
  try {
    // Try to ensure contact exists, but continue even if it fails
    let contactId;
    try {
      contactId = await ensureContactExists(phoneNumber, companyId);
    } catch (contactError) {
      console.warn(`⚠️ Could not ensure contact exists, using fallback: ${contactError.message}`);
      // Fallback: use the standard contact_id format
      contactId = `${companyId}-${phoneNumber}`;
    }
    
    // Use the existing scheduling endpoint
    const scheduleData = {
      contact_id: contactId,
      message: message,
      scheduledTime: scheduledTime.toISOString(),
      phoneIndex: 0, // Default phone index
      company_id: companyId,
      multiple: false,
      messageFormat: 'single'
    };

    // Make request to the existing scheduling endpoint
    const response = await axios.post(
      `${process.env.BASE_URL || 'http://localhost:8443'}/api/schedule-message/${companyId}`,
      scheduleData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.status === 200 || response.status === 201) {
      console.log(`Successfully scheduled message in database: ${response.data.id || response.data}`);
      return response.data;
    } else {
      throw new Error(`Failed to schedule message: ${response.status}`);
    }
    
  } catch (error) {
    console.error("Error scheduling message in database:", error);
    // Fallback: store in local storage if database fails
    const user = getUserData(phoneNumber);
    const scheduledMessage = {
      id: uuidv4(),
      phoneNumber,
      message,
      scheduledTime,
      messageType,
      status: 'scheduled',
      createdAt: new Date(),
      localOnly: true
    };
    user.scheduledMessages.push(scheduledMessage);
    return scheduledMessage;
  }
}

/**
 * Dynamic AI-driven response generator using OpenAI Assistants
 */
async function generateAIResponse(phoneNumber, userMessage, context = {}, idSubstring) {
  try {
    const user = getUserData(phoneNumber);
    const currentTime = new Date();
    const timeOfDay = currentTime.getHours();
    
    // Build context for AI
    const aiContext = {
      user: {
        phoneNumber,
        xp: user.xp,
        level: user.level,
        streak: user.streak,
        goals: user.goals,
        recentTasks: user.tasks.slice(-5),
        recentMoods: user.moods.slice(-3),
        lastCheckin: user.checkins[user.checkins.length - 1],
        preferences: user.preferences,
        scheduledMessages: user.scheduledMessages.slice(-3)
      },
      currentTime: {
        hour: timeOfDay,
        dayOfWeek: currentTime.getDay(),
        date: currentTime.toDateString()
      },
      context: {
        ...context,
        messageHistory: user.conversations.slice(-3)
      }
    };

    // Create or get thread for this user
    const threadId = await createOrGetThread(phoneNumber, idSubstring);
    
    // Add user message to thread
    await addMessage(threadId, userMessage);
    
    // Define tools for the assistant
    const tools = [
      {
        type: "function",
        function: {
          name: "schedule_message",
          description: "Schedule a reminder or check-in message for the user",
          parameters: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "The message content to schedule"
              },
              scheduledTime: {
                type: "string",
                description: "When to send the message (e.g., 'tomorrow at 9am', 'in 2 hours', 'next monday')"
              },
              messageType: {
                type: "string",
                description: "Type of message (reminder, checkin, motivation, task_reminder)",
                enum: ["reminder", "checkin", "motivation", "task_reminder"]
              }
            },
            required: ["message", "scheduledTime"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_goal",
          description: "Create or update a user goal",
          parameters: {
            type: "object",
            properties: {
              description: {
                type: "string",
                description: "Description of the goal"
              },
              targetDate: {
                type: "string",
                description: "Target completion date (optional)"
              }
            },
            required: ["description"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "add_task",
          description: "Add a new task for the user",
          parameters: {
            type: "object",
            properties: {
              description: {
                type: "string",
                description: "Description of the task"
              },
              dueDate: {
                type: "string",
                description: "Due date for the task (optional)"
              }
            },
            required: ["description"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_task",
          description: "Update an existing task (mark complete, change description, etc.)",
          parameters: {
            type: "object",
            properties: {
              taskId: {
                type: "string",
                description: "ID of the task to update"
              },
              updates: {
                type: "object",
                description: "Object containing the fields to update (e.g., {completed: true, description: 'new desc'})"
              }
            },
            required: ["taskId", "updates"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "track_mood",
          description: "Track user's current mood",
          parameters: {
            type: "object",
            properties: {
              mood: {
                type: "string",
                description: "User's mood (😄 😐 😞)",
                enum: ["😄", "😐", "😞"]
              }
            },
            required: ["mood"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_xp",
          description: "Award XP to the user for achievements",
          parameters: {
            type: "object",
            properties: {
              amount: {
                type: "integer",
                description: "Amount of XP to award"
              }
            },
            required: ["amount"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_streak",
          description: "Update user's streak count",
          parameters: {
            type: "object",
            properties: {
              increment: {
                type: "integer",
                description: "Amount to increment streak by"
              }
            },
            required: ["increment"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_preferences",
          description: "Update user preferences",
          parameters: {
            type: "object",
            properties: {
              preferences: {
                type: "object",
                description: "User preferences to update"
              }
            },
            required: ["preferences"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_progress_summary",
          description: "Get a comprehensive progress summary for the user",
          parameters: {
            type: "object",
            properties: {},
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "complete_task",
          description: "Mark a task as completed and award XP",
          parameters: {
            type: "object",
            properties: {
              taskIndex: {
                type: "integer",
                description: "Index of the task to complete (0-based)"
              }
            },
            required: ["taskIndex"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "log_daily_checkin",
          description: "Log a daily check-in to maintain streaks",
          parameters: {
            type: "object",
            properties: {},
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_today_tasks",
          description: "Get today's task list for the user",
          parameters: {
            type: "object",
            properties: {},
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "analyze_mood_trends",
          description: "Analyze user's mood patterns and provide insights",
          parameters: {
            type: "object",
            properties: {},
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "suggest_health_improvements",
          description: "Analyze user data and suggest health improvements",
          parameters: {
            type: "object",
            properties: {},
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_milestone",
          description: "Create a milestone for a goal",
          parameters: {
            type: "object",
            properties: {
              goalId: {
                type: "string",
                description: "ID of the goal to add milestone to"
              },
              description: {
                type: "string",
                description: "Description of the milestone"
              },
              targetDate: {
                type: "string",
                description: "Target date for the milestone"
              }
            },
            required: ["description"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "set_reminder_preferences",
          description: "Set user's reminder preferences",
          parameters: {
            type: "object",
            properties: {
              preferredTime: {
                type: "string",
                description: "Preferred time for daily reminders (e.g., '9am')"
              },
              frequency: {
                type: "string",
                description: "How often to send reminders",
                enum: ["daily", "weekly", "custom"]
              },
              reminderTypes: {
                type: "array",
                items: {
                  type: "string"
                },
                description: "Types of reminders user wants (task, health, goal, motivation)"
              }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "generate_weekly_report",
          description: "Generate a comprehensive weekly progress report",
          parameters: {
            type: "object",
            properties: {},
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "set_goal_priority",
          description: "Set priority level for a goal",
          parameters: {
            type: "object",
            properties: {
              goalId: {
                type: "string",
                description: "ID of the goal to update"
              },
              priority: {
                type: "string",
                description: "Priority level",
                enum: ["low", "medium", "high", "urgent"]
              }
            },
            required: ["goalId", "priority"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_habit_tracker",
          description: "Create a habit tracking system for the user",
          parameters: {
            type: "object",
            properties: {
              habitName: {
                type: "string",
                description: "Name of the habit to track"
              },
              frequency: {
                type: "string",
                description: "How often to do the habit",
                enum: ["daily", "weekly", "custom"]
              },
              reminderTime: {
                type: "string",
                description: "When to remind about the habit"
              }
            },
            required: ["habitName"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "analyze_productivity_patterns",
          description: "Analyze user's productivity patterns and suggest optimizations",
          parameters: {
            type: "object",
            properties: {},
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "save_personal_info",
          description: "Save personal information about Firaz (values, interests, background, preferences, etc.)",
          parameters: {
            type: "object",
            properties: {
              category: {
                type: "string",
                description: "Category of information (values, interests, background, work, health, relationships, etc.)",
                enum: ["values", "interests", "background", "work", "health", "relationships", "preferences", "skills", "other"]
              },
              key: {
                type: "string",
                description: "Specific key/label for this information"
              },
              value: {
                type: "string",
                description: "The information to save"
              },
              importance: {
                type: "string",
                description: "How important this information is",
                enum: ["low", "medium", "high", "critical"]
              }
            },
            required: ["category", "key", "value"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_personal_info",
          description: "Retrieve saved personal information about Firaz",
          parameters: {
            type: "object",
            properties: {
              category: {
                type: "string",
                description: "Category to retrieve (optional - if not provided, returns all)",
                enum: ["values", "interests", "background", "work", "health", "relationships", "preferences", "skills", "other"]
              },
              key: {
                type: "string",
                description: "Specific key to retrieve (optional)"
              }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "save_memory",
          description: "Save important memories, experiences, or events about Firaz",
          parameters: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Short title for the memory"
              },
              description: {
                type: "string",
                description: "Detailed description of the memory/experience"
              },
              category: {
                type: "string",
                description: "Type of memory",
                enum: ["achievement", "lesson_learned", "important_event", "insight", "challenge", "milestone", "personal", "work", "other"]
              },
              emotions: {
                type: "array",
                items: {
                  type: "string"
                },
                description: "Emotions associated with this memory"
              },
              lessons: {
                type: "string",
                description: "Key lessons or insights from this memory"
              }
            },
            required: ["title", "description", "category"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_memories",
          description: "Retrieve saved memories and experiences",
          parameters: {
            type: "object",
            properties: {
              category: {
                type: "string",
                description: "Filter by memory category (optional)",
                enum: ["achievement", "lesson_learned", "important_event", "insight", "challenge", "milestone", "personal", "work", "other"]
              },
              limit: {
                type: "integer",
                description: "Maximum number of memories to return (default: 10)"
              }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "search_memories",
          description: "Search through memories using keywords",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query to find relevant memories"
              },
              limit: {
                type: "integer",
                description: "Maximum number of results (default: 5)"
              }
            },
            required: ["query"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "save_context",
          description: "Save current context or situation for future reference",
          parameters: {
            type: "object",
            properties: {
              situation: {
                type: "string",
                description: "Description of current situation/context"
              },
              mood: {
                type: "string",
                description: "Current mood/emotional state"
              },
              energy_level: {
                type: "string",
                description: "Current energy level",
                enum: ["very_low", "low", "medium", "high", "very_high"]
              },
              priorities: {
                type: "array",
                items: {
                  type: "string"
                },
                description: "Current priorities or focus areas"
              },
              challenges: {
                type: "array",
                items: {
                  type: "string"
                },
                description: "Current challenges or obstacles"
              }
            },
            required: ["situation"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_context",
          description: "Get recent context and situation information",
          parameters: {
            type: "object",
            properties: {
              days_back: {
                type: "integer",
                description: "Number of days back to retrieve context (default: 7)"
              }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "save_learning",
          description: "Save what Firaz has learned or is learning",
          parameters: {
            type: "object",
            properties: {
              topic: {
                type: "string",
                description: "What was learned"
              },
              source: {
                type: "string",
                description: "Source of learning (book, course, experience, etc.)"
              },
              key_insights: {
                type: "string",
                description: "Key insights or takeaways"
              },
              skill_level: {
                type: "string",
                description: "Current skill level in this area",
                enum: ["beginner", "novice", "intermediate", "advanced", "expert"]
              },
              application: {
                type: "string",
                description: "How this learning can be applied"
              }
            },
            required: ["topic", "key_insights"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_learning_profile",
          description: "Get Firaz's learning profile and knowledge areas",
          parameters: {
            type: "object",
            properties: {
              topic: {
                type: "string",
                description: "Specific topic to retrieve (optional)"
              }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_relationship",
          description: "Save or update information about Firaz's relationships",
          parameters: {
            type: "object",
            properties: {
              person_name: {
                type: "string",
                description: "Name of the person"
              },
              relationship_type: {
                type: "string",
                description: "Type of relationship",
                enum: ["family", "friend", "colleague", "mentor", "business", "romantic", "other"]
              },
              notes: {
                type: "string",
                description: "Important notes about this relationship"
              },
              last_interaction: {
                type: "string",
                description: "Last meaningful interaction or conversation"
              },
              importance: {
                type: "string",
                description: "Importance of this relationship",
                enum: ["low", "medium", "high", "critical"]
              }
            },
            required: ["person_name", "relationship_type"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_relationships",
          description: "Get information about Firaz's relationships",
          parameters: {
            type: "object",
            properties: {
              relationship_type: {
                type: "string",
                description: "Filter by relationship type (optional)",
                enum: ["family", "friend", "colleague", "mentor", "business", "romantic", "other"]
              }
            },
            required: []
          }
        }
      }
    ];

    // Get assistant ID from database
    const companyId = process.env.PERSONAL_ASSISTANT_COMPANY_ID || idSubstring;
    const assistantId = await getCompanyAssistantId(companyId, 0);
    
    if (!assistantId) {
      throw new Error(`No assistant ID configured for company ${companyId}. Please add an assistant ID to the companies table.`);
    }
    
    // Run the assistant
    const response = await runAssistant(
      assistantId,
      threadId,
      tools,
      idSubstring, // Use the actual company ID
      null, // client (not needed for this function)
      phoneNumber,
      "Personal Assistant", // name
      "Personal Assistant", // companyName
      null, // contact
      0 // phoneIndex
    );

    // Store conversation for context
    user.conversations.push({
      timestamp: currentTime,
      userMessage,
      aiResponse: response,
      context: aiContext
    });

    // Keep only recent conversations
    if (user.conversations.length > 10) {
      user.conversations = user.conversations.slice(-10);
    }

    return response;

  } catch (error) {
    console.error("Error generating AI response:", error);
    
    // Check if it's an assistant configuration error
    if (error.message.includes("No assistant ID configured") || error.message.includes("No config found")) {
      const companyId = process.env.PERSONAL_ASSISTANT_COMPANY_ID || idSubstring;
      return `🚨 **Assistant Not Configured**\n\nThis personal assistant requires an OpenAI assistant to be configured.\n\n**To fix this:**\n1. Create an assistant in OpenAI with the personal assistant prompt\n2. Add the assistant ID to the database:\n\`\`\`sql\nINSERT INTO public.companies (company_id, assistant_ids) \nVALUES ('${companyId}', '["your_assistant_id_here"]');\n\`\`\`\n\nPlease contact your administrator to set this up.`;
    }
    
    return "I'm here to help you achieve your goals! What would you like to work on today?";
  }
}

/**
 * Create or get thread for user from database
 */
async function createOrGetThread(phoneNumber, idSubstring) {
  try {
    // Get contact data to check for existing thread ID
    const contactData = await getContactDataFromDatabaseByPhone(phoneNumber, idSubstring);
    
    if (contactData?.thread_id) {
      console.log(`📞 [PERSONAL_ASSISTANT] Using existing thread ID: ${contactData.thread_id}`);
      return contactData.thread_id;
    } else {
      console.log(`📞 [PERSONAL_ASSISTANT] Creating new thread for contact: ${phoneNumber}`);
      const thread = await openai.beta.threads.create();
      const threadID = thread.id;
      console.log(`📞 [PERSONAL_ASSISTANT] Saving thread ID: ${threadID} for contact: ${phoneNumber}`);
      await saveThreadIDPostgres(phoneNumber, threadID, idSubstring);
      return threadID;
    }
  } catch (error) {
    console.error("Error getting/creating thread:", error);
    // Fallback: create new thread without saving to database
    const thread = await openai.beta.threads.create();
    return thread.id;
  }
}

/**
 * Add message to thread
 */
async function addMessage(threadId, message) {
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: message
  });
}

/**
 * Run assistant with tools
 */
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
  phoneIndex = 0
) {
  try {
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantID,
      tools: tools,
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
      contact
    );
  } catch (error) {
    console.error("Error running assistant:", error);
    throw error;
  }
}

/**
 * Wait for completion of AI run
 */
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
  const maxDepth = 5;
  const maxAttempts = 30;
  const pollingInterval = 2000;

  console.log(`Waiting for completion (depth: ${depth}, runId: ${runId})...`);

  if (depth >= maxDepth) {
    console.error(`Max recursion depth reached for runId: ${runId}`);
    return "I apologize, but I'm having trouble completing this task. Could you please try rephrasing your request?";
  }

  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    try {
      const runObject = await openai.beta.threads.runs.retrieve(threadId, runId);
      console.log(`Run status: ${runObject.status} (attempt ${attempts + 1})`);

      if (runObject.status === "completed") {
        const messagesList = await openai.beta.threads.messages.list(threadId);
        const latestMessage = messagesList.data[0].content[0].text.value;
        return latestMessage;
      } else if (runObject.status === "requires_action") {
        console.log("Run requires action, handling tool calls...");
        const toolCalls = runObject.required_action.submit_tool_outputs.tool_calls;
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
        
        // Submit tool outputs
        await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
          tool_outputs: toolOutputs
        });
        
        // Continue waiting for completion
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
      } else if (["failed", "cancelled", "expired"].includes(runObject.status)) {
        console.error(`Run ${runId} ended with status: ${runObject.status}`);
        return `I encountered an error (${runObject.status}). Please try your request again.`;
      }

      await new Promise((resolve) => setTimeout(resolve, pollingInterval));
    } catch (error) {
      console.error(`Error in waitForCompletion (depth: ${depth}, runId: ${runId}): ${error}`);
      return "I'm sorry, but I encountered an error while processing your request. Please try again.";
    }
  }

  console.error(`Timeout: Assistant did not complete in time (depth: ${depth}, runId: ${runId})`);
  return "I'm sorry, but it's taking longer than expected to process your request. Please try again or rephrase your question.";
}

/**
 * Handle tool calls for the personal assistant
 */
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
  try {
    console.log(`📞 [TOOL_CALLS] Processing ${toolCalls.length} tool calls`);
    const results = [];
    
    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      const toolName = toolCall.function.name;
      const args = toolCall.function.arguments;
      
      console.log(`📞 [TOOL_CALLS] Processing tool call ${i + 1}/${toolCalls.length}: ${toolName} (ID: ${toolCall.id})`);
      
      let result;
      try {
        const parameters = JSON.parse(args);
        
        switch (toolName) {
        case "schedule_message":
          result = await scheduleMessage(
            phoneNumber,
            parameters.message,
            parameters.scheduledTime,
            parameters.messageType || "reminder",
            idSubstring
          );
          break;
          
        case "update_goal":
          result = await executeAction(phoneNumber, {
            type: "update_goal",
            data: parameters
          });
          break;
          
        case "add_task":
          result = await executeAction(phoneNumber, {
            type: "add_task",
            data: parameters
          });
          break;
          
        case "update_task":
          result = await executeAction(phoneNumber, {
            type: "update_task",
            data: parameters
          });
          break;
          
        case "track_mood":
          result = await executeAction(phoneNumber, {
            type: "track_mood",
            data: parameters
          });
          break;
          
        case "update_xp":
          result = await executeAction(phoneNumber, {
            type: "update_xp",
            data: parameters
          });
          break;
          
        case "update_streak":
          result = await executeAction(phoneNumber, {
            type: "update_streak",
            data: parameters
          });
          break;
          
        case "update_preferences":
          result = await executeAction(phoneNumber, {
            type: "update_preferences",
            data: parameters
          });
          break;
          
        case "get_today_tasks":
          result = await getTodayTasks(phoneNumber);
          break;
          
        case "complete_task":
          result = await completeTask(phoneNumber, parameters.taskIndex);
          break;
          
        case "log_daily_checkin":
          result = await logDailyCheckin(phoneNumber);
          break;
          
        case "analyze_mood_trends":
          result = await analyzeMoodTrends(phoneNumber);
          break;
          
        case "suggest_health_improvements":
          result = await suggestHealthImprovements(phoneNumber);
          break;
          
        case "create_milestone":
          result = await createMilestone(phoneNumber, parameters.goalId, parameters.description, parameters.targetDate);
          break;
          
        case "set_reminder_preferences":
          result = await setReminderPreferences(phoneNumber, parameters.preferredTime, parameters.frequency, parameters.reminderTypes);
          break;
          
        case "generate_weekly_report":
          result = await generateWeeklyReport(phoneNumber);
          break;

        case "set_goal_priority":
          result = await setGoalPriority(phoneNumber, parameters.goalId, parameters.priority);
          break;

        case "create_habit_tracker":
          result = await createHabitTracker(phoneNumber, parameters.habitName, parameters.frequency, parameters.reminderTime);
          break;

        case "analyze_productivity_patterns":
          result = await analyzeProductivityPatterns(phoneNumber);
          break;

        case "save_personal_info":
          result = await savePersonalInfo(phoneNumber, parameters.category, parameters.key, parameters.value, parameters.importance);
          break;

        case "get_personal_info":
          result = await getPersonalInfo(phoneNumber, parameters.category, parameters.key);
          break;

        case "save_memory":
          result = await saveMemory(phoneNumber, parameters.title, parameters.description, parameters.category, parameters.emotions, parameters.lessons);
          break;

        case "get_memories":
          result = await getMemories(phoneNumber, parameters.category, parameters.limit);
          break;

        case "search_memories":
          result = await searchMemories(phoneNumber, parameters.query, parameters.limit);
          break;

        case "save_context":
          result = await saveContext(phoneNumber, parameters.situation, parameters.mood, parameters.energy_level, parameters.priorities, parameters.challenges);
          break;

        case "get_context":
          result = await getContext(phoneNumber, parameters.days_back);
          break;

        case "save_learning":
          result = await saveLearning(phoneNumber, parameters.topic, parameters.source, parameters.key_insights, parameters.skill_level, parameters.application);
          break;

        case "get_learning_profile":
          result = await getLearningProfile(phoneNumber, parameters.topic);
          break;

        case "update_relationship":
          result = await updateRelationship(phoneNumber, parameters.person_name, parameters.relationship_type, parameters.notes, parameters.last_interaction, parameters.importance);
          break;

        case "get_relationships":
          result = await getRelationships(phoneNumber, parameters.relationship_type);
          break;
          
        default:
          result = {
            success: false,
            message: `Unknown tool: ${toolName}`
          };
        }
      } catch (error) {
        console.error(`Error executing tool ${toolName}:`, error);
        result = {
          success: false,
          message: `Error executing ${toolName}: ${error.message}`
        };
      }
      
      console.log(`📞 [TOOL_CALLS] Completed tool call ${i + 1}: ${toolName} - Success: ${result?.success}`);
      
      results.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify(result)
      });
    }
    
    console.log(`📞 [TOOL_CALLS] Returning ${results.length} results`);
    console.log(`📞 [TOOL_CALLS] Result IDs:`, results.map(r => r.tool_call_id));
    return results;
  } catch (error) {
    console.error("Error handling tool calls:", error);
    return [{
      tool_call_id: toolCalls[0]?.id,
      output: JSON.stringify({
        success: false,
        message: "Sorry, I encountered an error processing your request."
      })
    }];
  }
}

/**
 * Dynamic action handler - AI decides what actions to take
 */
async function handleDynamicActions(phoneNumber, userMessage, aiResponse) {
  try {
    const user = getUserData(phoneNumber);
    const currentTime = new Date();

    // Let AI decide what actions to take based on the conversation
    const actionPrompt = `Based on this conversation:
User: "${userMessage}"
Assistant: "${aiResponse}"

What specific actions should be taken? Consider:
1. Should we update any user data (goals, tasks, mood, etc.)?
2. Should we schedule any reminders or follow-ups?
3. Should we provide any specific tools or resources?

For scheduling, use natural language time expressions like:
- "2 hours from now"
- "tomorrow at 9am"
- "next monday"
- "in 30 minutes"

Respond with a JSON object containing actions to take. Example:
{
  "actions": [
    {
      "type": "update_goal",
      "data": { "description": "New goal", "targetDate": "2024-01-01" }
    },
    {
      "type": "schedule_message",
      "data": { 
        "message": "Time to check in on your progress!", 
        "scheduledTime": "tomorrow at 9am",
        "messageType": "checkin"
      }
    }
  ]
}

If no actions are needed, return: {"actions": []}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are an action planner. Respond only with valid JSON." },
        { role: "user", content: actionPrompt }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    const actionResponse = completion.choices[0].message.content;
    let actions = [];

    try {
      const parsed = JSON.parse(actionResponse);
      actions = parsed.actions || [];
    } catch (parseError) {
      console.error("Error parsing AI actions:", parseError);
      console.error("Raw AI response:", actionResponse.substring(0, 500) + "...");
      // Try to extract JSON from the response if it's embedded in markdown or other text
      const jsonMatch = actionResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          actions = parsed.actions || [];
          console.log("Successfully extracted JSON from response");
        } catch (secondParseError) {
          console.error("Failed to parse extracted JSON:", secondParseError);
          actions = [];
        }
      } else {
        actions = [];
      }
    }

    // Execute the actions
    for (const action of actions) {
      await executeAction(phoneNumber, action);
    }

    return actions;

  } catch (error) {
    console.error("Error handling dynamic actions:", error);
    return [];
  }
}

/**
 * Execute AI-determined actions
 */
async function executeAction(phoneNumber, action) {
  try {
    const user = getUserData(phoneNumber);
    const currentTime = new Date();

    switch (action.type) {
      case "update_goal":
        if (action.data.description) {
          const goal = {
            id: uuidv4(),
            description: action.data.description,
            createdAt: currentTime,
            targetDate: action.data.targetDate ? new Date(action.data.targetDate) : null,
            completed: false,
            progress: 0
          };
          user.goals.push(goal);
      return {
        success: true,
            message: `Goal created: ${action.data.description}`,
            data: goal
          };
        } else {
          return {
            success: false,
            message: "Goal description is required"
          };
        }

      case "add_task":
        if (action.data.description) {
          const task = {
            id: uuidv4(),
            description: action.data.description,
            dueDate: action.data.dueDate ? new Date(action.data.dueDate) : currentTime,
            completed: false,
            createdAt: currentTime
          };
          user.tasks.push(task);
          return {
            success: true,
            message: `Task added: ${action.data.description}`,
            data: task
          };
        } else {
          return {
            success: false,
            message: "Task description is required"
          };
        }

      case "update_task":
        if (action.data.taskId && action.data.updates) {
          const user = getUserData(phoneNumber);
          const taskIndex = user.tasks.findIndex(t => t.id === action.data.taskId);
          if (taskIndex !== -1) {
            // Update task properties
            Object.assign(user.tasks[taskIndex], action.data.updates);
            user.tasks[taskIndex].updatedAt = currentTime;
    return {
      success: true,
              message: `Task updated successfully`,
              data: user.tasks[taskIndex]
    };
          } else {
    return {
      success: false,
              message: "Task not found"
            };
          }
        } else {
          return {
            success: false,
            message: "Task ID and updates are required"
          };
        }

      case "track_mood":
        if (action.data.mood) {
          const moodEntry = {
            mood: action.data.mood,
            timestamp: currentTime,
            date: currentTime.toDateString()
          };
          user.moods.push(moodEntry);
          return {
            success: true,
            message: `Mood tracked: ${action.data.mood}`,
            data: moodEntry
          };
        } else {
          return {
            success: false,
            message: "Mood value is required"
          };
        }

      case "update_xp":
        if (action.data.amount) {
          const oldLevel = user.level;
          user.xp += action.data.amount;
          // Recalculate level
          user.level = Math.floor(user.xp / 100) + 1;
          return {
            success: true,
            message: `XP updated! +${action.data.amount} XP. Level: ${user.level}`,
            data: { xp: user.xp, level: user.level, levelUp: user.level > oldLevel }
          };
        } else {
          return {
            success: false,
            message: "XP amount is required"
          };
        }
        
      case "update_streak":
        if (action.data.increment) {
          user.streak += action.data.increment;
          return {
            success: true,
            message: `Streak updated: ${user.streak} days`,
            data: { streak: user.streak }
          };
        } else {
          return {
            success: false,
            message: "Streak increment is required"
          };
        }
        
      case "schedule_message":
        if (action.data.message && action.data.scheduledTime) {
          const result = await scheduleMessage(
            phoneNumber,
            action.data.message,
            action.data.scheduledTime,
            action.data.messageType || "reminder"
          );
          console.log(`AI scheduled message: ${result.messageId}`);
          return result;
        } else {
          return {
            success: false,
            message: "Message and scheduled time are required"
          };
        }
        
      case "update_preferences":
        if (action.data.preferences) {
          user.preferences = { ...user.preferences, ...action.data.preferences };
          return {
            success: true,
            message: "Preferences updated successfully",
            data: user.preferences
          };
        } else {
      return {
        success: false,
            message: "Preferences data is required"
      };
    }
    
      default:
        console.log(`Unknown action type: ${action.type}`);
      return {
        success: false,
          message: `Unknown action type: ${action.type}`
        };
    }

    // Update last interaction
    user.lastInteraction = currentTime;

  } catch (error) {
    console.error("Error executing action:", error);
    return {
      success: false,
      message: `Error executing action: ${error.message}`
    };
  }
}

/**
 * Get contextual user insights for AI
 */
function getUserInsights(phoneNumber) {
  const user = getUserData(phoneNumber);
  const currentTime = new Date();
  
  const insights = {
    currentStreak: user.streak,
    totalXP: user.xp,
    currentLevel: user.level,
    activeGoals: user.goals.filter(g => !g.completed).length,
    recentMood: user.moods.length > 0 ? user.moods[user.moods.length - 1].mood : null,
    lastCheckin: user.checkins.length > 0 ? user.checkins[user.checkins.length - 1].date : null,
    taskCompletionRate: user.tasks.length > 0 ? 
      (user.tasks.filter(t => t.completed).length / user.tasks.length * 100).toFixed(1) : 0,
    preferredTime: user.preferences.preferredTime || 'not set',
    motivationStyle: user.preferences.motivationStyle || 'not set'
  };

  return insights;
}

/**
 * Transcribe audio using OpenAI Whisper API
 */
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
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    if (!response.data || !response.data.text) {
      throw new Error("Transcription response is missing or invalid");
    }

    console.log(`🎤 Audio transcribed: "${response.data.text}"`);
    return response.data.text;
  } catch (error) {
    console.error("Error transcribing audio:", error);
    return "Audio transcription failed. Please try again.";
  }
}

/**
 * Convert text to speech using OpenAI TTS API
 */
async function textToSpeech(text) {
  try {
    console.log(`🔊 Converting text to speech: "${text.substring(0, 50)}..."`);
    
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: "echo", // You can change this to: alloy, echo, fable, onyx, nova, shimmer
      input: text,
      response_format: "mp3"
    });

    // Get the audio buffer
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    
    console.log(`🔊 TTS generated successfully, audio size: ${audioBuffer.length} bytes`);
    return audioBuffer;
    
  } catch (error) {
    console.error("Error generating TTS:", error);
    throw error;
  }
}

/**
 * Send voice message using TTS
 */
async function sendVoiceMessage(client, chatId, text) {
  try {
    console.log(`🔊 Sending voice message to ${chatId}`);
    
    // Generate audio from text
    const audioBuffer = await textToSpeech(text);
    
    // Create MessageMedia object for voice message
    const media = new MessageMedia(
      "audio/mpeg",
      audioBuffer.toString("base64"),
      `voice_${Date.now()}.mp3`
    );

    // Send as voice message
    const messageOptions = {
      sendAudioAsVoice: true, // This ensures it's sent as a voice message
    };

    const sent = await client.sendMessage(chatId, media, messageOptions);
    console.log("🔊 Voice message sent successfully");
    return sent;
    
  } catch (error) {
    console.error("Error sending voice message:", error);
    // Fallback to text if voice fails
    await client.sendMessage(chatId, text);
    throw error;
  }
}

/**
 * Get contact data from database by phone number
 */
async function getContactDataFromDatabaseByPhone(phoneNumber, idSubstring) {
  let sqlClient;
  try {
    if (!phoneNumber) {
      throw new Error("Phone number is undefined or null");
    }

    console.log(`📞 [PERSONAL_ASSISTANT] Searching for contact - Phone: ${phoneNumber}, Company: ${idSubstring}`);

    sqlClient = await pool.connect();

    // Try to find contact with both phone formats (with and without +)
    const phoneWithPlus = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    const phoneWithoutPlus = phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber;
    
    const query = `
      SELECT * FROM public.contacts
      WHERE (phone = $1 OR phone = $2) AND company_id = $3
      LIMIT 1
    `;

    const result = await sqlClient.query(query, [phoneWithPlus, phoneWithoutPlus, idSubstring]);

    if (result.rows.length === 0) {
      console.log(`📞 [PERSONAL_ASSISTANT] No contact found for phone: ${phoneNumber}, company: ${idSubstring}`);
      return null;
    } else {
      const contactData = result.rows[0];
      const contactName = contactData.contact_name || contactData.name;
      const threadID = contactData.thread_id;

      console.log(`📞 [PERSONAL_ASSISTANT] Found contact:`, {
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
    console.error("Error fetching contact data:", error);
    return null; // Return null instead of throwing to allow fallback
  } finally {
    if (sqlClient) {
      await safeRelease(sqlClient);
    }
  }
}

// ===== NEW KNOWLEDGE MANAGEMENT FUNCTIONS =====

/**
 * Save personal information about Firaz
 */
async function savePersonalInfo(phoneNumber, category, key, value, importance = "medium") {
  try {
    const user = getUserData(phoneNumber);
    
    if (!user.personalInfo[category]) {
      user.personalInfo[category] = {};
    }
    
    user.personalInfo[category][key] = {
      value: value,
      importance: importance,
      updatedAt: new Date(),
      createdAt: user.personalInfo[category][key]?.createdAt || new Date()
    };
    
    return {
      success: true,
      message: `✅ Saved personal info: ${category} → ${key}`,
      data: user.personalInfo[category][key]
    };
  } catch (error) {
    console.error("Error saving personal info:", error);
    return {
      success: false,
      message: "Sorry, I couldn't save that information. Please try again."
    };
  }
}

/**
 * Retrieve personal information about Firaz
 */
async function getPersonalInfo(phoneNumber, category = null, key = null) {
  try {
    const user = getUserData(phoneNumber);
    
    if (category && key) {
      // Get specific key from specific category
      const info = user.personalInfo[category]?.[key];
      return {
        success: true,
        message: info ? `📋 ${category} → ${key}: ${info.value}` : `No information found for ${category} → ${key}`,
        data: info || null
      };
    } else if (category) {
      // Get all info from specific category
      const categoryInfo = user.personalInfo[category] || {};
      const infoList = Object.entries(categoryInfo).map(([k, v]) => `• ${k}: ${v.value}`).join('\n');
      return {
        success: true,
        message: `📋 *${category.toUpperCase()}*\n\n${infoList || 'No information saved yet'}`,
        data: categoryInfo
      };
    } else {
      // Get all personal info
      const allInfo = {};
      let message = "📋 *ALL PERSONAL INFORMATION*\n\n";
      
      for (const [cat, catData] of Object.entries(user.personalInfo)) {
        if (Object.keys(catData).length > 0) {
          allInfo[cat] = catData;
          message += `**${cat.toUpperCase()}:**\n`;
          for (const [k, v] of Object.entries(catData)) {
            message += `• ${k}: ${v.value}\n`;
          }
          message += '\n';
        }
      }
      
      return {
        success: true,
        message: message || "No personal information saved yet",
        data: allInfo
      };
    }
  } catch (error) {
    console.error("Error getting personal info:", error);
      return {
        success: false,
      message: "Sorry, I couldn't retrieve that information. Please try again."
    };
  }
}

/**
 * Save important memories and experiences
 */
async function saveMemory(phoneNumber, title, description, category, emotions = [], lessons = "") {
  try {
    const user = getUserData(phoneNumber);
    
    const memory = {
      id: `memory_${Date.now()}`,
      title: title,
      description: description,
      category: category,
      emotions: emotions || [],
      lessons: lessons || "",
      createdAt: new Date(),
      tags: []
    };
    
    user.memories.push(memory);
    
    // Keep only last 50 memories
    if (user.memories.length > 50) {
      user.memories = user.memories.slice(-50);
    }
    
    return {
      success: true,
      message: `💭 Memory saved: "${title}" (${category})`,
      data: memory
    };
  } catch (error) {
    console.error("Error saving memory:", error);
    return {
      success: false,
      message: "Sorry, I couldn't save that memory. Please try again."
    };
  }
}

/**
 * Get memories and experiences
 */
async function getMemories(phoneNumber, category = null, limit = 10) {
  try {
    const user = getUserData(phoneNumber);
    let memories = user.memories || [];
    
    if (category) {
      memories = memories.filter(m => m.category === category);
    }
    
    // Get most recent memories
    memories = memories.slice(-limit).reverse();
    
    if (memories.length === 0) {
    return {
      success: true,
        message: `💭 No memories found${category ? ` for category "${category}"` : ''}`,
        data: []
      };
    }
    
    const memoryList = memories.map(m => 
      `📅 ${m.createdAt.toDateString()}\n**${m.title}** (${m.category})\n${m.description}\n${m.lessons ? `💡 ${m.lessons}` : ''}`
    ).join('\n\n---\n\n');
    
    return {
      success: true,
      message: `💭 *MEMORIES*${category ? ` (${category})` : ''}\n\n${memoryList}`,
      data: memories
    };
  } catch (error) {
    console.error("Error getting memories:", error);
    return {
      success: false,
      message: "Sorry, I couldn't retrieve memories. Please try again."
    };
  }
}

/**
 * Search through memories using keywords
 */
async function searchMemories(phoneNumber, query, limit = 5) {
  try {
    const user = getUserData(phoneNumber);
    const memories = user.memories || [];
    
    const searchTerm = query.toLowerCase();
    const matchingMemories = memories.filter(m => 
      m.title.toLowerCase().includes(searchTerm) ||
      m.description.toLowerCase().includes(searchTerm) ||
      m.lessons.toLowerCase().includes(searchTerm) ||
      m.category.toLowerCase().includes(searchTerm)
    ).slice(-limit).reverse();
    
    if (matchingMemories.length === 0) {
      return {
        success: true,
        message: `🔍 No memories found matching "${query}"`,
        data: []
      };
    }
    
    const resultList = matchingMemories.map(m => 
      `**${m.title}** (${m.category})\n${m.description.substring(0, 100)}...`
    ).join('\n\n');
    
    return {
      success: true,
      message: `🔍 *SEARCH RESULTS for "${query}"*\n\n${resultList}`,
      data: matchingMemories
    };
  } catch (error) {
    console.error("Error searching memories:", error);
      return {
        success: false,
      message: "Sorry, I couldn't search memories. Please try again."
    };
  }
}

/**
 * Save current context or situation
 */
async function saveContext(phoneNumber, situation, mood = null, energy_level = null, priorities = [], challenges = []) {
  try {
    const user = getUserData(phoneNumber);
    
    const context = {
      id: `context_${Date.now()}`,
      situation: situation,
      mood: mood,
      energy_level: energy_level,
      priorities: priorities || [],
      challenges: challenges || [],
      timestamp: new Date()
    };
    
    user.context.push(context);
    
    // Keep only last 30 context entries
    if (user.context.length > 30) {
      user.context = user.context.slice(-30);
    }
    
    return {
      success: true,
      message: `📊 Context saved for ${new Date().toDateString()}`,
      data: context
    };
  } catch (error) {
    console.error("Error saving context:", error);
    return {
      success: false,
      message: "Sorry, I couldn't save the context. Please try again."
    };
  }
}

/**
 * Get recent context and situation information
 */
async function getContext(phoneNumber, days_back = 7) {
  try {
    const user = getUserData(phoneNumber);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days_back);
    
    const recentContext = (user.context || []).filter(c => 
      new Date(c.timestamp) >= cutoffDate
    );
    
    if (recentContext.length === 0) {
      return {
        success: true,
        message: `📊 No context found for the last ${days_back} days`,
        data: []
      };
    }
    
    const contextList = recentContext.map(c => 
      `📅 ${new Date(c.timestamp).toDateString()}\n**Situation:** ${c.situation}\n${c.mood ? `**Mood:** ${c.mood}\n` : ''}${c.energy_level ? `**Energy:** ${c.energy_level}\n` : ''}${c.priorities.length ? `**Priorities:** ${c.priorities.join(', ')}\n` : ''}${c.challenges.length ? `**Challenges:** ${c.challenges.join(', ')}` : ''}`
    ).join('\n\n---\n\n');
    
    return {
      success: true,
      message: `📊 *RECENT CONTEXT* (Last ${days_back} days)\n\n${contextList}`,
      data: recentContext
    };
  } catch (error) {
    console.error("Error getting context:", error);
    return {
      success: false,
      message: "Sorry, I couldn't retrieve context. Please try again."
    };
  }
}

/**
 * Save learning information
 */
async function saveLearning(phoneNumber, topic, source = "", key_insights = "", skill_level = "beginner", application = "") {
  try {
    const user = getUserData(phoneNumber);
    
    const learning = {
      id: `learning_${Date.now()}`,
      topic: topic,
      source: source,
      key_insights: key_insights,
      skill_level: skill_level,
      application: application,
      createdAt: new Date(),
      lastUpdated: new Date()
    };
    
    // Check if topic already exists and update it
    const existingIndex = user.learning.findIndex(l => l.topic.toLowerCase() === topic.toLowerCase());
    if (existingIndex >= 0) {
      user.learning[existingIndex] = {
        ...user.learning[existingIndex],
        ...learning,
        createdAt: user.learning[existingIndex].createdAt
      };
    } else {
      user.learning.push(learning);
    }
    
    return {
      success: true,
      message: `📚 Learning saved: ${topic} (${skill_level})`,
      data: learning
    };
  } catch (error) {
    console.error("Error saving learning:", error);
    return {
      success: false,
      message: "Sorry, I couldn't save that learning. Please try again."
    };
  }
}

/**
 * Get learning profile and knowledge areas
 */
async function getLearningProfile(phoneNumber, topic = null) {
  try {
    const user = getUserData(phoneNumber);
    let learning = user.learning || [];
    
    if (topic) {
      learning = learning.filter(l => l.topic.toLowerCase().includes(topic.toLowerCase()));
    }
    
    if (learning.length === 0) {
      return {
        success: true,
        message: `📚 No learning records found${topic ? ` for "${topic}"` : ''}`,
        data: []
      };
    }
    
    const learningList = learning.map(l => 
      `📖 **${l.topic}** (${l.skill_level})\n${l.source ? `Source: ${l.source}\n` : ''}💡 ${l.key_insights}\n${l.application ? `🎯 Application: ${l.application}` : ''}`
    ).join('\n\n---\n\n');
    
    return {
      success: true,
      message: `📚 *LEARNING PROFILE*${topic ? ` for "${topic}"` : ''}\n\n${learningList}`,
      data: learning
    };
  } catch (error) {
    console.error("Error getting learning profile:", error);
    return {
      success: false,
      message: "Sorry, I couldn't retrieve the learning profile. Please try again."
    };
  }
}

/**
 * Update relationship information
 */
async function updateRelationship(phoneNumber, person_name, relationship_type, notes = "", last_interaction = "", importance = "medium") {
  try {
    const user = getUserData(phoneNumber);
    
    const relationship = {
      person_name: person_name,
      relationship_type: relationship_type,
      notes: notes,
      last_interaction: last_interaction,
      importance: importance,
      createdAt: new Date(),
      lastUpdated: new Date()
    };
    
    // Check if relationship already exists and update it
    const existingIndex = user.relationships.findIndex(r => r.person_name.toLowerCase() === person_name.toLowerCase());
    if (existingIndex >= 0) {
      user.relationships[existingIndex] = {
        ...user.relationships[existingIndex],
        ...relationship,
        createdAt: user.relationships[existingIndex].createdAt
      };
    } else {
      user.relationships.push(relationship);
    }
    
    return {
      success: true,
      message: `👥 Relationship updated: ${person_name} (${relationship_type})`,
      data: relationship
    };
  } catch (error) {
    console.error("Error updating relationship:", error);
    return {
      success: false,
      message: "Sorry, I couldn't update that relationship. Please try again."
    };
  }
}

/**
 * Get relationship information
 */
async function getRelationships(phoneNumber, relationship_type = null) {
  try {
    const user = getUserData(phoneNumber);
    let relationships = user.relationships || [];
    
    if (relationship_type) {
      relationships = relationships.filter(r => r.relationship_type === relationship_type);
    }
    
    if (relationships.length === 0) {
      return {
        success: true,
        message: `👥 No relationships found${relationship_type ? ` for type "${relationship_type}"` : ''}`,
        data: []
      };
    }
    
    const relationshipList = relationships.map(r => 
      `👤 **${r.person_name}** (${r.relationship_type})\n${r.notes ? `Notes: ${r.notes}\n` : ''}${r.last_interaction ? `Last interaction: ${r.last_interaction}\n` : ''}Importance: ${r.importance}`
    ).join('\n\n---\n\n');
    
    return {
      success: true,
      message: `👥 *RELATIONSHIPS*${relationship_type ? ` (${relationship_type})` : ''}\n\n${relationshipList}`,
      data: relationships
    };
  } catch (error) {
    console.error("Error getting relationships:", error);
    return {
      success: false,
      message: "Sorry, I couldn't retrieve relationships. Please try again."
    };
  }
}

/**
 * Get company assistant ID from database
 */
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
      console.log(`Raw assistant_ids for ${idSubstring}:`, assistantIds, typeof assistantIds);
      
      let assistantId;
      if (Array.isArray(assistantIds)) {
        assistantId = assistantIds[phoneIndex] || assistantIds[0];
        console.log(`Found array assistant_ids:`, assistantIds, `Selected:`, assistantId);
      } else if (typeof assistantIds === "string") {
        try {
          const parsed = JSON.parse(assistantIds);
          assistantId = Array.isArray(parsed)
            ? parsed[phoneIndex] || parsed[0]
            : parsed;
          console.log(`Parsed string assistant_ids:`, parsed, `Selected:`, assistantId);
        } catch (parseError) {
          console.log(`Failed to parse assistant_ids string:`, assistantIds, parseError);
          assistantId = assistantIds;
        }
      } else {
        console.log(`Unknown assistant_ids type:`, typeof assistantIds, assistantIds);
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

/**
 * Safe rollback function
 */
async function safeRollback(sqlClient) {
  try {
    await sqlClient.query("ROLLBACK");
  } catch (rollbackError) {
    console.error("Error during rollback:", rollbackError);
  }
}

/**
 * Safe release function
 */
async function safeRelease(sqlClient) {
  try {
    sqlClient.release();
  } catch (releaseError) {
    console.error("Error releasing client:", releaseError);
  }
}

/**
 * Create a new OpenAI thread
 */
async function createThread() {
  console.log("Creating a new thread...");
  const thread = await openai.beta.threads.create();
  return thread;
}

/**
 * Save thread ID to PostgreSQL database
 */
async function saveThreadIDPostgres(contactID, threadID, idSubstring) {
  let sqlClient;
  try {
    sqlClient = await pool.connect();

    await sqlClient.query("BEGIN");

    // Generate proper contact_id format
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
      await safeRollback(sqlClient);
    }
    console.error("Error saving Thread ID to PostgreSQL:", error);
  } finally {
    if (sqlClient) {
      await safeRelease(sqlClient);
    }
  }
}

// ===== MESSAGE HANDLING =====

/**
 * Handle new messages for the personal assistant
 */
async function handleNewMessagesPersonalAssistant(client, msg, botName, phoneIndex) {
  console.log("Handling new message for personal assistant");
  
  const idSubstring = botName; // Use botName as company ID like other handlers
  const chatId = msg.from;
  if (chatId.includes("status")) {
    return;
  }
  
  const extractedNumber = msg.from.replace("@c.us", "");
  
  // Handle voice messages (ptt = push-to-talk)
  if (msg.type === "ptt") {
    console.log("🎤 Voice message detected - transcribing...");
    try {
      const media = await msg.downloadMedia();
      const transcription = await transcribeAudio(media.data);
      msg.body = transcription; // Replace msg.body with transcription
      console.log(`🎤 Voice transcribed to: "${transcription}"`);
    } catch (error) {
      console.error("Error transcribing voice message:", error);
      msg.body = "I couldn't understand the voice message. Could you please type your message?";
    }
  }
  
  // Handle /resetbot command
  if (msg.body.includes("/resetbot")) {
    console.log(`🔄 [PERSONAL_ASSISTANT] Reset bot command detected`);
    const thread = await createThread();
    const threadID = thread.id;
    await saveThreadIDPostgres(extractedNumber, threadID, idSubstring);
    await client.sendMessage(chatId, "Personal assistant is now restarting with new thread.");
    return;
  }
  
  // Handle /voicemode command
  if (msg.body.includes("/voicemode")) {
    console.log(`🔊 [PERSONAL_ASSISTANT] Voice mode command detected`);
    const user = getUserData(extractedNumber);
    user.voiceMode = !user.voiceMode; // Toggle voice mode
    
    const statusMessage = user.voiceMode 
      ? "🔊 Voice mode activated! I'll now respond with voice messages."
      : "💬 Voice mode deactivated! I'll now respond with text messages.";
    
    console.log(`🔊 Voice mode for ${extractedNumber}: ${user.voiceMode ? 'ON' : 'OFF'}`);
    
    if (user.voiceMode) {
      // Send voice confirmation
      await sendVoiceMessage(client, chatId, statusMessage);
    } else {
      // Send text confirmation
      await client.sendMessage(chatId, statusMessage);
    }
    return;
  }
  
  try {
    // Generate AI-driven response
    const aiResponse = await generateAIResponse(extractedNumber, msg.body, {}, idSubstring);
    
    // Handle any dynamic actions the AI wants to take
    await handleDynamicActions(extractedNumber, msg.body, aiResponse);
    
    // Check if user is in voice mode and send appropriate response
    const user = getUserData(extractedNumber);
    if (user.voiceMode) {
      console.log(`🔊 Sending voice response to ${extractedNumber}`);
      await sendVoiceMessage(client, chatId, aiResponse);
    } else {
      console.log(`💬 Sending text response to ${extractedNumber}`);
      await client.sendMessage(chatId, aiResponse);
    }
    
  } catch (error) {
    console.error("Error handling personal assistant message:", error);
    const errorMessage = "I'm here to help you achieve your goals! What would you like to work on today?";
    
    // Send error message in user's preferred format
    const user = getUserData(extractedNumber);
    if (user.voiceMode) {
      try {
        await sendVoiceMessage(client, chatId, errorMessage);
      } catch (voiceError) {
        // Fallback to text if voice fails
        await client.sendMessage(chatId, errorMessage);
      }
    } else {
      await client.sendMessage(chatId, errorMessage);
    }
  }
}

/**
 * Get user progress summary (AI-driven)
 */
async function getProgressSummary(phoneNumber) {
  try {
    const user = getUserData(phoneNumber);
    const insights = getUserInsights(phoneNumber);
    
    // Let AI generate a personalized progress summary
    const summaryPrompt = `Create a personalized progress summary for a user with these insights:
${JSON.stringify(insights, null, 2)}

Make it encouraging, specific to their achievements, and suggest what they might want to focus on next.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a motivational personal assistant. Create encouraging, personalized progress summaries." },
        { role: "user", content: summaryPrompt }
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    return completion.choices[0].message.content;
    
  } catch (error) {
    console.error("Error getting progress summary:", error);
    return "I'm here to help you track your progress! What would you like to know about your goals?";
  }
}

/**
 * Get today's task list for the user
 */
async function getTodayTasks(phoneNumber) {
  try {
    const user = getUserData(phoneNumber);
    const today = new Date().toDateString();
    
    // Filter tasks for today
    const todayTasks = user.tasks.filter(task => 
      new Date(task.dueDate).toDateString() === today
    );
    
    if (todayTasks.length === 0) {
      return {
        success: true,
        message: "📋 *Today's Tasks*\n\nNo tasks scheduled for today! 🎉\n\nWould you like me to add some tasks for you?",
        tasks: []
      };
    }
    
    const taskList = todayTasks.map((task, index) => 
      `${index + 1}. ${task.description} ${task.completed ? '✅' : '⏳'}`
    ).join('\n');
    
    return {
      success: true,
      message: `📋 *Today's Tasks*\n\n${taskList}\n\nYou have ${todayTasks.filter(t => !t.completed).length} tasks remaining!`,
      tasks: todayTasks
    };
  } catch (error) {
    console.error("Error getting today's tasks:", error);
    return {
      success: false,
      message: "Sorry, I couldn't retrieve your tasks. Please try again."
    };
  }
}

/**
 * Mark a task as complete and award XP
 */
async function completeTask(phoneNumber, taskIndex) {
  try {
    const user = getUserData(phoneNumber);
    const today = new Date().toDateString();
    const todayTasks = user.tasks.filter(task => 
      new Date(task.dueDate).toDateString() === today
    );
    
    if (taskIndex < 0 || taskIndex >= todayTasks.length) {
      return {
        success: false,
        message: "Invalid task number. Please check your task list."
      };
    }
    
    const task = todayTasks[taskIndex];
    if (task.completed) {
      return {
        success: false,
        message: "This task is already completed! ✅"
      };
    }
    
    // Mark task as complete
    task.completed = true;
    task.completedAt = new Date();
    
    // Award XP
    const xpGained = 10;
    user.xp += xpGained;
    user.level = Math.floor(user.xp / 100) + 1;
    
    // Update streak
    user.streak += 1;
    
    let levelUpMessage = "";
    if (user.level > Math.floor((user.xp - xpGained) / 100) + 1) {
      levelUpMessage = `\n🎉 *LEVEL UP!* You're now level ${user.level}!`;
    }
    
    return {
      success: true,
      message: `✅ Task completed: "${task.description}"\n\n+${xpGained} XP | Level ${user.level} | Streak: ${user.streak} days${levelUpMessage}`,
      xpGained,
      newLevel: user.level,
      newStreak: user.streak
    };
  } catch (error) {
    console.error("Error completing task:", error);
    return {
      success: false,
      message: "Sorry, I couldn't complete the task. Please try again."
    };
  }
}

/**
 * Log daily check-in to maintain streaks
 */
async function logDailyCheckin(phoneNumber) {
  try {
    const user = getUserData(phoneNumber);
    const today = new Date().toDateString();
    
    // Check if already checked in today
    const alreadyCheckedIn = user.checkins.some(checkin => 
      new Date(checkin.date).toDateString() === today
    );
    
    if (alreadyCheckedIn) {
      return {
        success: false,
        message: "You've already checked in today! ✅\n\nCome back tomorrow for your next check-in."
      };
    }
    
    // Add check-in
    const checkin = {
      date: new Date(),
      timestamp: new Date()
    };
    user.checkins.push(checkin);
    
    // Update streak
    user.streak += 1;
    
    // Give bonus XP for check-in
    const bonusXP = 5;
    user.xp += bonusXP;
    user.level = Math.floor(user.xp / 100) + 1;
    
    return {
      success: true,
      message: `✅ Daily check-in recorded!\n\n+${bonusXP} XP | Streak: ${user.streak} days\n\nKeep up the great work! 💪`,
      newStreak: user.streak,
      bonusXP
    };
  } catch (error) {
    console.error("Error logging daily check-in:", error);
    return {
      success: false,
      message: "Sorry, I couldn't record your check-in. Please try again."
    };
  }
}

/**
 * Analyze mood trends and provide insights
 */
async function analyzeMoodTrends(phoneNumber) {
  try {
    const user = getUserData(phoneNumber);
    
    if (user.moods.length === 0) {
      return {
        success: false,
        message: "No mood data available yet. Start tracking your mood to get insights!"
      };
    }
    
    const recentMoods = user.moods.slice(-7); // Last 7 days
    const happyCount = recentMoods.filter(m => m.mood === '😄').length;
    const neutralCount = recentMoods.filter(m => m.mood === '😐').length;
    const sadCount = recentMoods.filter(m => m.mood === '😞').length;
    
    let analysis = "📊 *Mood Analysis (Last 7 Days)*\n\n";
    analysis += `😄 Happy: ${happyCount} days\n`;
    analysis += `😐 Neutral: ${neutralCount} days\n`;
    analysis += `😞 Sad: ${sadCount} days\n\n`;
    
    if (happyCount > sadCount) {
      analysis += "🌟 You've been feeling great lately! Keep up the positive energy!";
    } else if (sadCount > happyCount) {
      analysis += "💪 Remember, tough times don't last. You're doing great!";
    } else {
      analysis += "📊 Your mood has been stable. How can I help you feel better?";
    }
    
    return {
      success: true,
      message: analysis,
      analysis: {
        happyCount,
        neutralCount,
        sadCount,
        totalDays: recentMoods.length
      }
    };
  } catch (error) {
    console.error("Error analyzing mood trends:", error);
    return {
      success: false,
      message: "Sorry, I couldn't analyze your mood trends. Please try again."
    };
  }
}

/**
 * Suggest health improvements based on user data
 */
async function suggestHealthImprovements(phoneNumber) {
  try {
    const user = getUserData(phoneNumber);
    const insights = getUserInsights(phoneNumber);
    
    let suggestions = "💡 *Health Improvement Suggestions*\n\n";
    
    // Analyze task completion rate
    if (insights.taskCompletionRate < 50) {
      suggestions += "📋 *Task Management:*\n";
      suggestions += "• Break tasks into smaller, manageable pieces\n";
      suggestions += "• Set realistic daily goals\n";
      suggestions += "• Celebrate small wins\n\n";
    }
    
    // Analyze mood patterns
    const recentMoods = user.moods.slice(-3);
    const sadMoods = recentMoods.filter(m => m.mood === '😞').length;
    if (sadMoods > 1) {
      suggestions += "🧠 *Mental Health:*\n";
      suggestions += "• Practice mindfulness or meditation\n";
      suggestions += "• Take regular breaks throughout the day\n";
      suggestions += "• Connect with friends or family\n\n";
    }
    
    // Analyze streak patterns
    if (user.streak < 3) {
      suggestions += "🔥 *Consistency:*\n";
      suggestions += "• Start with small, daily habits\n";
      suggestions += "• Set up regular reminders\n";
      suggestions += "• Track your progress\n\n";
    }
    
    // General health suggestions
    suggestions += "🌱 *General Wellness:*\n";
    suggestions += "• Get 7-9 hours of sleep\n";
    suggestions += "• Stay hydrated throughout the day\n";
    suggestions += "• Take short walks or stretch breaks\n";
    suggestions += "• Practice gratitude daily\n\n";
    
    suggestions += "Would you like me to help you implement any of these suggestions?";
    
    return {
      success: true,
      message: suggestions
    };
  } catch (error) {
    console.error("Error suggesting health improvements:", error);
    return {
      success: false,
      message: "Sorry, I couldn't generate health suggestions. Please try again."
    };
  }
}

/**
 * Create a milestone for a goal
 */
async function createMilestone(phoneNumber, goalId, description, targetDate) {
  try {
    const user = getUserData(phoneNumber);
    const currentTime = new Date();
    
    const milestone = {
      id: uuidv4(),
      goalId: goalId,
      description: description,
      targetDate: targetDate ? new Date(targetDate) : null,
      createdAt: currentTime,
      completed: false
    };
    
    // Find the goal and add milestone
    const goal = user.goals.find(g => g.id === goalId);
    if (goal) {
      if (!goal.milestones) goal.milestones = [];
      goal.milestones.push(milestone);
    }
    
    return {
      success: true,
      message: `🎯 Milestone created: "${description}"\n\nThis will help you track progress toward your goal!`,
      milestoneId: milestone.id
    };
  } catch (error) {
    console.error("Error creating milestone:", error);
    return {
      success: false,
      message: "Sorry, I couldn't create the milestone. Please try again."
    };
  }
}

/**
 * Set reminder preferences
 */
async function setReminderPreferences(phoneNumber, preferredTime, frequency, reminderTypes) {
  try {
    const user = getUserData(phoneNumber);
    
    user.preferences.reminders = {
      preferredTime: preferredTime || "9am",
      frequency: frequency || "daily",
      reminderTypes: reminderTypes || ["task", "health", "goal", "motivation"]
    };
    
    return {
      success: true,
      message: `✅ Reminder preferences updated!\n\n• Preferred time: ${user.preferences.reminders.preferredTime}\n• Frequency: ${user.preferences.reminders.frequency}\n• Types: ${user.preferences.reminders.reminderTypes.join(', ')}`
    };
  } catch (error) {
    console.error("Error setting reminder preferences:", error);
    return {
      success: false,
      message: "Sorry, I couldn't update your reminder preferences. Please try again."
    };
  }
}

/**
 * Generate a comprehensive weekly progress report
 */
async function generateWeeklyReport(phoneNumber) {
  try {
    const user = getUserData(phoneNumber);
    const insights = getUserInsights(phoneNumber);
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay()); // Start of the current week (Sunday)

    const tasksCompletedThisWeek = user.tasks.filter(task => 
      task.completedAt >= startOfWeek && task.completedAt < today
    ).length;

    const moodEntriesThisWeek = user.moods.filter(mood => 
      mood.timestamp >= startOfWeek && mood.timestamp < today
    ).length;

    const checkinsThisWeek = user.checkins.filter(checkin => 
      checkin.timestamp >= startOfWeek && checkin.timestamp < today
    ).length;

    const goalsCompletedThisWeek = user.goals.filter(goal => 
      goal.completedAt >= startOfWeek && goal.completedAt < today
    ).length;

    const newGoalsThisWeek = user.goals.filter(goal => 
      goal.createdAt >= startOfWeek && goal.createdAt < today
    ).length;

    const newTasksThisWeek = user.tasks.filter(task => 
      task.createdAt >= startOfWeek && task.createdAt < today
    ).length;

    const newMoodsThisWeek = user.moods.filter(mood => 
      mood.timestamp >= startOfWeek && mood.timestamp < today
    ).length;

    const newCheckinsThisWeek = user.checkins.filter(checkin => 
      checkin.timestamp >= startOfWeek && checkin.timestamp < today
    ).length;

    let report = "📊 *Weekly Progress Report*\n\n";
    report += `🎯 Goals Completed: ${goalsCompletedThisWeek} (New: ${newGoalsThisWeek})\n`;
    report += `📋 Tasks Completed: ${tasksCompletedThisWeek} (New: ${newTasksThisWeek})\n`;
    report += `😄 Mood Entries: ${moodEntriesThisWeek} (New: ${newMoodsThisWeek})\n`;
    report += `✅ Daily Check-ins: ${checkinsThisWeek} (New: ${newCheckinsThisWeek})\n\n`;

    report += `💪 Your Streak: ${user.streak} days\n`;
    report += `🎉 Your XP: ${user.xp} (Level ${user.level})\n`;
    report += `🌟 Your Mood: ${user.moods.length > 0 ? user.moods[user.moods.length - 1].mood : 'N/A'}\n`;
    report += `🕒 Last Interaction: ${user.lastInteraction.toLocaleDateString()}\n\n`;

    report += "�� *Key Highlights:*\n";
    report += "• You've been consistent with your habits!\n";
    report += "• Your mood has been stable, which is great!\n";
    report += "• You've completed several goals and tasks this week.\n\n";

    report += "🔮 *Suggestions for Next Week:*\n";
    report += "• Try to maintain your current streak.\n";
    report += "• Set a new goal or two if you're feeling ambitious.\n";
    report += "• Keep up the good work on your habits.\n\n";

    report += "Would you like to know more about any specific area of your progress?";

    return {
      success: true,
      message: report
    };
  } catch (error) {
    console.error("Error generating weekly report:", error);
    return {
            success: false,
      message: "Sorry, I couldn't generate your weekly progress report. Please try again."
    };
  }
}

/**
 * Set priority level for a goal
 */
async function setGoalPriority(phoneNumber, goalId, priority) {
  try {
    const user = getUserData(phoneNumber);
    const goal = user.goals.find(g => g.id === goalId);
    if (goal) {
      goal.priority = priority;
      return {
        success: true,
        message: `✅ Goal priority updated!\n\nGoal: "${goal.description}"\nPriority: ${goal.priority}`
      };
    } else {
      return {
        success: false,
        message: "Goal not found."
      };
    }
  } catch (error) {
    console.error("Error setting goal priority:", error);
    return {
        success: false,
      message: "Sorry, I couldn't update the goal priority. Please try again."
    };
  }
}

/**
 * Create a habit tracking system for the user
 */
async function createHabitTracker(phoneNumber, habitName, frequency, reminderTime) {
  try {
    const user = getUserData(phoneNumber);
    const currentTime = new Date();

    const habit = {
      id: uuidv4(),
      name: habitName,
      frequency: frequency || "daily",
      reminderTime: reminderTime || "9am",
      createdAt: currentTime,
      completedToday: false,
      lastCompleted: null
    };

    user.preferences.habitTrackers = user.preferences.habitTrackers || [];
    user.preferences.habitTrackers.push(habit);

    return {
      success: true,
      message: `✅ Habit tracker created!\n\nHabit: "${habit.name}"\nFrequency: ${habit.frequency}\nReminder: ${habit.reminderTime}`
    };
  } catch (error) {
    console.error("Error creating habit tracker:", error);
    return {
      success: false,
      message: "Sorry, I couldn't create the habit tracker. Please try again."
    };
  }
}

/**
 * Analyze user's productivity patterns and suggest optimizations
 */
async function analyzeProductivityPatterns(phoneNumber) {
  try {
    const user = getUserData(phoneNumber);
    const insights = getUserInsights(phoneNumber);

    let analysis = "💡 *Productivity Analysis*\n\n";
    analysis += `📊 Your current productivity: ${insights.taskCompletionRate}%\n`;
    analysis += `🎯 Active Goals: ${insights.activeGoals}\n`;
    analysis += `🌟 Recent Mood: ${insights.recentMood}\n`;
    analysis += `💪 Current Streak: ${insights.currentStreak} days\n\n`;

    analysis += "🔮 *Suggestions for Improving Productivity:*\n";
    if (insights.taskCompletionRate < 70) {
      analysis += "• Consider breaking down large tasks into smaller, manageable ones.\n";
      analysis += "• Set specific, achievable daily goals.\n";
      analysis += "• Celebrate small wins to maintain motivation.\n";
    }
    if (insights.currentStreak < 5) {
      analysis += "• Start with small, daily habits to build consistency.\n";
      analysis += "• Set up regular reminders for habits.\n";
      analysis += "• Track your progress to see your growth.\n";
    }
    if (insights.activeGoals < 5) {
      analysis += "• Set new goals to challenge yourself.\n";
      analysis += "• Prioritize goals based on their importance.\n";
      analysis += "• Break down complex goals into smaller steps.\n";
    }
    if (insights.recentMood === '😞') {
      analysis += "• Take a break, engage in a hobby, or practice mindfulness.\n";
      analysis += "• Connect with friends or family to lift your spirits.\n";
      analysis += "• Reflect on what might be causing your recent low mood.\n";
    }

    analysis += "\nWould you like to know more about any specific productivity pattern?";

    return {
      success: true,
      message: analysis
    };
  } catch (error) {
    console.error("Error analyzing productivity patterns:", error);
    return {
      success: false,
      message: "Sorry, I couldn't analyze your productivity patterns. Please try again."
    };
  }
}

// Export the main function
module.exports = {
  handleNewMessagesPersonalAssistant,
  getProgressSummary,
  getUserData,
  getUserInsights,
  scheduleMessage,
  parseRelativeTime,
  scheduleMessageInDatabase,
  ensureContactExists,
  transcribeAudio,
  textToSpeech,
  sendVoiceMessage,
  generateAIResponse,
  createOrGetThread,
  addMessage,
  runAssistant,
  waitForCompletion,
  handleToolCalls,
  getTodayTasks,
  completeTask,
  logDailyCheckin,
  analyzeMoodTrends,
  suggestHealthImprovements,
  createMilestone,
  setReminderPreferences,
  generateWeeklyReport,
  setGoalPriority,
  createHabitTracker,
  analyzeProductivityPatterns,
  getCompanyAssistantId,
  createThread,
  saveThreadIDPostgres,
  getContactDataFromDatabaseByPhone,
  // Knowledge Management Functions
  savePersonalInfo,
  getPersonalInfo,
  saveMemory,
  getMemories,
  searchMemories,
  saveContext,
  getContext,
  saveLearning,
  getLearningProfile,
  updateRelationship,
  getRelationships
}; 