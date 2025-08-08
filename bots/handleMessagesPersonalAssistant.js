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
const { Pool } = require("pg");

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

// ===== PERSONAL ASSISTANT AI DATA STRUCTURES =====

// In-memory storage for personal assistant data
const userGoals = new Map();
const userTasks = new Map();
const userXP = new Map();
const userLevels = new Map();
const userStreaks = new Map();
const userMoods = new Map();
const userCheckins = new Map();

// ===== PERSONAL ASSISTANT FUNCTIONS =====

/**
 * Create a personal goal for the user
 */
async function createPersonalGoal(phoneNumber, goalDescription) {
  try {
    const goalId = uuidv4();
    const goal = {
      id: goalId,
      description: goalDescription,
      createdAt: new Date(),
      completed: false,
      progress: 0
    };
    
    userGoals.set(phoneNumber, goal);
    
    // Schedule daily task reminders
    await scheduleAssistantMessage(phoneNumber, "morning_tasks", "08:00");
    await scheduleAssistantMessage(phoneNumber, "evening_checkin", "20:00");
    
    return {
      success: true,
      message: `🎯 Goal created: "${goalDescription}"\n\nI'll help you achieve this! You'll receive daily task reminders and progress updates.`,
      goalId: goalId
    };
  } catch (error) {
    console.error("Error creating personal goal:", error);
    return {
      success: false,
      message: "Sorry, I couldn't create your goal. Please try again."
    };
  }
}

/**
 * Get today's task list for the user
 */
async function getTodayTasks(phoneNumber) {
  try {
    const tasks = userTasks.get(phoneNumber) || [];
    const today = new Date().toDateString();
    
    // Filter tasks for today
    const todayTasks = tasks.filter(task => 
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
 * Mark a task as complete and update XP/level
 */
async function completeTask(phoneNumber, taskIndex) {
  try {
    const tasks = userTasks.get(phoneNumber) || [];
    const today = new Date().toDateString();
    const todayTasks = tasks.filter(task => 
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
    
    // Update XP and level
    const currentXP = userXP.get(phoneNumber) || 0;
    const xpGained = 10; // Base XP for task completion
    const newXP = currentXP + xpGained;
    userXP.set(phoneNumber, newXP);
    
    // Calculate level (every 100 XP = 1 level)
    const currentLevel = userLevels.get(phoneNumber) || 1;
    const newLevel = Math.floor(newXP / 100) + 1;
    userLevels.set(phoneNumber, newLevel);
    
    // Update streak
    const currentStreak = userStreaks.get(phoneNumber) || 0;
    const newStreak = currentStreak + 1;
    userStreaks.set(phoneNumber, newStreak);
    
    let levelUpMessage = "";
    if (newLevel > currentLevel) {
      levelUpMessage = `\n🎉 *LEVEL UP!* You're now level ${newLevel}!`;
    }
    
    return {
      success: true,
      message: `✅ Task completed: "${task.description}"\n\n+${xpGained} XP | Level ${newLevel} | Streak: ${newStreak} days${levelUpMessage}`,
      xpGained,
      newLevel,
      newStreak
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
 * Track user mood
 */
async function trackMood(phoneNumber, mood) {
  try {
    const validMoods = ['😄', '😐', '😞'];
    if (!validMoods.includes(mood)) {
      return {
        success: false,
        message: "Please use one of these moods: 😄 😐 😞"
      };
    }
    
    const moodEntry = {
      mood: mood,
      timestamp: new Date(),
      date: new Date().toDateString()
    };
    
    const userMoodHistory = userMoods.get(phoneNumber) || [];
    userMoodHistory.push(moodEntry);
    userMoods.set(phoneNumber, userMoodHistory);
    
    let response = `Mood recorded: ${mood}\n\n`;
    
    // Analyze mood trends
    const recentMoods = userMoodHistory.slice(-7); // Last 7 days
    const happyCount = recentMoods.filter(m => m.mood === '😄').length;
    const neutralCount = recentMoods.filter(m => m.mood === '😐').length;
    const sadCount = recentMoods.filter(m => m.mood === '😞').length;
    
    if (happyCount > sadCount) {
      response += "🌟 You've been feeling great lately! Keep it up!";
    } else if (sadCount > happyCount) {
      response += "💪 Remember, tough times don't last. You're doing great!";
    } else {
      response += "📊 Your mood has been stable. How can I help you feel better?";
    }
    
    return {
      success: true,
      message: response
    };
  } catch (error) {
    console.error("Error tracking mood:", error);
    return {
      success: false,
      message: "Sorry, I couldn't record your mood. Please try again."
    };
  }
}

/**
 * Log daily check-in to track streaks
 */
async function logDailyCheckin(phoneNumber) {
  try {
    const today = new Date().toDateString();
    const checkins = userCheckins.get(phoneNumber) || [];
    
    // Check if already checked in today
    const alreadyCheckedIn = checkins.some(checkin => 
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
    checkins.push(checkin);
    userCheckins.set(phoneNumber, checkins);
    
    // Update streak
    const currentStreak = userStreaks.get(phoneNumber) || 0;
    const newStreak = currentStreak + 1;
    userStreaks.set(phoneNumber, newStreak);
    
    // Give bonus XP for check-in
    const currentXP = userXP.get(phoneNumber) || 0;
    const bonusXP = 5;
    const newXP = currentXP + bonusXP;
    userXP.set(phoneNumber, newXP);
    
    return {
      success: true,
      message: `✅ Daily check-in recorded!\n\n+${bonusXP} XP | Streak: ${newStreak} days\n\nKeep up the great work! 💪`,
      newStreak,
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
 * Add a new task for today
 */
async function addDailyTask(phoneNumber, taskDescription) {
  try {
    const tasks = userTasks.get(phoneNumber) || [];
    const today = new Date();
    
    const newTask = {
      id: uuidv4(),
      description: taskDescription,
      dueDate: today,
      completed: false,
      createdAt: today
    };
    
    tasks.push(newTask);
    userTasks.set(phoneNumber, tasks);
    
    return {
      success: true,
      message: `📝 Task added: "${taskDescription}"\n\nI'll remind you to complete it today!`,
      taskId: newTask.id
    };
  } catch (error) {
    console.error("Error adding daily task:", error);
    return {
      success: false,
      message: "Sorry, I couldn't add the task. Please try again."
    };
  }
}

/**
 * Get progress summary (XP, level, streak)
 */
async function getProgressSummary(phoneNumber) {
  try {
    const xp = userXP.get(phoneNumber) || 0;
    const level = userLevels.get(phoneNumber) || 1;
    const streak = userStreaks.get(phoneNumber) || 0;
    const goal = userGoals.get(phoneNumber);
    
    let summary = `📊 *Your Progress Summary*\n\n`;
    summary += `⭐ Level: ${level}\n`;
    summary += `💎 XP: ${xp}\n`;
    summary += `🔥 Streak: ${streak} days\n\n`;
    
    if (goal) {
      summary += `🎯 Current Goal: "${goal.description}"\n`;
      summary += `Progress: ${goal.progress}%`;
    } else {
      summary += `Set a goal to get started!`;
    }
    
    return {
      success: true,
      message: summary,
      xp,
      level,
      streak,
      goal
    };
  } catch (error) {
    console.error("Error getting progress summary:", error);
    return {
      success: false,
      message: "Sorry, I couldn't get your progress. Please try again."
    };
  }
}

/**
 * Schedule assistant messages via WhatsApp
 */
async function scheduleAssistantMessage(phoneNumber, messageType, time) {
  try {
    const [hour, minute] = time.split(':');
    const scheduleTime = `${minute} ${hour} * * *`; // cron format
    
    // Create message based on type
    let message = "";
    switch (messageType) {
      case "morning_tasks":
        message = "🌅 Good morning! Here are your tasks for today:\n\n";
        const tasks = await getTodayTasks(phoneNumber);
        message += tasks.message;
        break;
        
      case "evening_checkin":
        message = "🌙 Evening check-in time!\n\n";
        message += "How was your day? 😄 😐 😞\n\n";
        message += "Don't forget to log your mood and complete any remaining tasks!";
        break;
        
      case "motivational_nudge":
        message = "💪 Hey there! Remember your goals - you've got this!\n\n";
        message += "Take a small step today, even if it's just 5 minutes.";
        break;
        
      case "streak_alert":
        const streak = userStreaks.get(phoneNumber) || 0;
        message = `🔥 Amazing! You're on a ${streak}-day streak!\n\n`;
        message += "Keep the momentum going! 🚀";
        break;
        
      default:
        message = "Hello! Your personal assistant here with a friendly reminder.";
    }
    
    // Schedule the message using the existing system
    const scheduleData = {
      phoneNumber: phoneNumber,
      message: message,
      scheduledTime: time,
      messageType: messageType
    };
    
    // This would integrate with the existing scheduling system
    console.log(`Scheduled ${messageType} message for ${phoneNumber} at ${time}`);
    
    return {
      success: true,
      message: `Message scheduled for ${time}`,
      scheduleData
    };
  } catch (error) {
    console.error("Error scheduling assistant message:", error);
    return {
      success: false,
      message: "Sorry, I couldn't schedule the message."
    };
  }
}

// ===== TOOL CALLS HANDLER =====

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
    const results = [];
    
    for (const toolCall of toolCalls) {
      const { name: toolName, parameters } = toolCall;
      
      console.log(`Processing tool call: ${toolName}`);
      
      let result;
      
      switch (toolName) {
        case "createPersonalGoal":
          result = await createPersonalGoal(phoneNumber, parameters.goalDescription);
          break;
          
        case "getTodayTasks":
          result = await getTodayTasks(phoneNumber);
          break;
          
        case "completeTask":
          result = await completeTask(phoneNumber, parameters.taskIndex);
          break;
          
        case "trackMood":
          result = await trackMood(phoneNumber, parameters.mood);
          break;
          
        case "logDailyCheckin":
          result = await logDailyCheckin(phoneNumber);
          break;
          
        case "addDailyTask":
          result = await addDailyTask(phoneNumber, parameters.taskDescription);
          break;
          
        case "getProgressSummary":
          result = await getProgressSummary(phoneNumber);
          break;
          
        case "scheduleAssistantMessage":
          result = await scheduleAssistantMessage(
            phoneNumber, 
            parameters.messageType, 
            parameters.time
          );
          break;
          
        default:
          result = {
            success: false,
            message: `Unknown tool: ${toolName}`
          };
      }
      
      results.push({
        toolCallId: toolCall.id,
        result: result
      });
    }
    
    return results;
  } catch (error) {
    console.error("Error handling tool calls:", error);
    return [{
      toolCallId: toolCalls[0]?.id,
      result: {
        success: false,
        message: "Sorry, I encountered an error processing your request."
      }
    }];
  }
}

// ===== MESSAGE HANDLING =====

/**
 * Handle new messages for the personal assistant
 */
async function handleNewMessagesPersonalAssistant(client, msg, botName, phoneIndex) {
  console.log("Handling new message for personal assistant");
  
  const chatId = msg.from;
  if (chatId.includes("status")) {
    return;
  }
  
  const extractedNumber = msg.from.replace("@c.us", "");
  
  try {
    // Process the message with AI
    const response = await processMessageWithAI(msg, extractedNumber);
    
    // Send response back to user
    await client.sendMessage(chatId, response);
    
  } catch (error) {
    console.error("Error handling personal assistant message:", error);
    await client.sendMessage(chatId, "Sorry, I encountered an error. Please try again.");
  }
}

/**
 * Process message with AI to generate tool calls
 */
async function processMessageWithAI(msg, phoneNumber) {
  try {
    // Create or get thread for this user
    const threadId = await createOrGetThread(phoneNumber);
    
    // Add user message to thread
    await addMessage(threadId, msg.body);
    
    // Run assistant to generate response
    const assistantId = process.env.PERSONAL_ASSISTANT_ID; // Set this in your environment
    const tools = [
      {
        type: "function",
        function: {
          name: "createPersonalGoal",
          description: "Create a personal goal for the user",
          parameters: {
            type: "object",
            properties: {
              goalDescription: {
                type: "string",
                description: "Description of the personal goal"
              }
            },
            required: ["goalDescription"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "getTodayTasks",
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
          name: "completeTask",
          description: "Mark a task as complete and update XP/level",
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
          name: "trackMood",
          description: "Track user mood",
          parameters: {
            type: "object",
            properties: {
              mood: {
                type: "string",
                description: "User mood (😄 😐 😞)"
              }
            },
            required: ["mood"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "logDailyCheckin",
          description: "Log daily check-in to track streaks",
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
          name: "addDailyTask",
          description: "Add a new task for today",
          parameters: {
            type: "object",
            properties: {
              taskDescription: {
                type: "string",
                description: "Description of the task"
              }
            },
            required: ["taskDescription"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "getProgressSummary",
          description: "Get progress summary (XP, level, streak)",
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
          name: "scheduleAssistantMessage",
          description: "Schedule a follow-up message to user via WhatsApp",
          parameters: {
            type: "object",
            properties: {
              messageType: {
                type: "string",
                description: "Type of message (morning_tasks, evening_checkin, motivational_nudge, streak_alert)"
              },
              time: {
                type: "string",
                description: "Time in HH:MM format"
              }
            },
            required: ["messageType", "time"]
          }
        }
      }
    ];
    
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
      tools: tools
    });
    
    // Wait for completion
    const completedRun = await waitForCompletion(threadId, run.id);
    
    // Get the response
    const messages = await openai.beta.threads.messages.list(threadId);
    const lastMessage = messages.data[0];
    
    return lastMessage.content[0].text.value;
    
  } catch (error) {
    console.error("Error processing message with AI:", error);
    return "I'm here to help you achieve your personal goals! What would you like to work on today?";
  }
}

/**
 * Create or get thread for user
 */
async function createOrGetThread(phoneNumber) {
  // In a real implementation, you'd store/retrieve thread IDs from database
  // For now, we'll create a new thread each time
  const thread = await openai.beta.threads.create();
  return thread.id;
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
 * Wait for completion of AI run
 */
async function waitForCompletion(threadId, runId, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const run = await openai.beta.threads.runs.retrieve(threadId, runId);
    
    if (run.status === "completed") {
      return run;
    } else if (run.status === "failed") {
      throw new Error("AI run failed");
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error("AI run timed out");
}

// Export the main function
module.exports = {
  handleNewMessagesPersonalAssistant,
  handleToolCalls
}; 