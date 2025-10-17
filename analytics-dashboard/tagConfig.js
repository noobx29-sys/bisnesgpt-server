// =====================================================
// Tag Configuration
// Defines all tag categories, rules, and AI prompts
// =====================================================

const TAG_CATEGORIES = {
  STATUS: 'status',
  ENGAGEMENT: 'engagement',
  BEHAVIORAL: 'behavioral',
  ACTION: 'action',
  FOLLOWUP: 'followup', // For tracking follow-up sequences
  QUALIFICATION: 'qualification', // Lead qualification status
  SYSTEM: 'system' // System-level tags (group, etc)
};

// Default tags with their rules
const DEFAULT_TAGS = {
  // SYSTEM TAGS
  group: {
    category: TAG_CATEGORIES.SYSTEM,
    description: 'WhatsApp group chat (not an individual contact)',
    color: '#9CA3AF',
    priority: 200, // Highest priority - check first
    rules: {
      manual: true // Applied manually by system when detecting groups
    }
  },

  // STATUS TAGS
  new: {
    category: TAG_CATEGORIES.STATUS,
    description: 'New contact with no interaction yet',
    color: '#3B82F6',
    priority: 100,
    rules: {
      totalMessages: { max: 0 }, // Changed from messageCount
      daysSinceFirstContact: { max: 1 }
    }
  },

  active: {
    category: TAG_CATEGORIES.STATUS,
    description: 'Currently in active conversation',
    color: '#10B981',
    priority: 90,
    rules: {
      daysSinceLastMessage: { max: 3 },
      hasRecentExchange: true, // Both parties messaged recently
      totalMessages: { min: 1 } // FIX: Changed from messageCount to totalMessages
    }
  },

  query: {
    category: TAG_CATEGORIES.STATUS,
    description: 'Has pending questions or inquiries',
    color: '#F59E0B',
    priority: 85,
    rules: {
      lastMessageFromContact: true,
      containsQuestionMarks: true // hasQuestionWords is checked separately
    }
  },

  closed: {
    category: TAG_CATEGORIES.STATUS,
    description: 'Conversation completed or resolved',
    color: '#6B7280',
    priority: 80,
    rules: {
      hasClosingPhrases: true, // FIX: Changed from closingPhrases array
      daysSinceLastMessage: { min: 2 } // FIX: Use existing metric
    }
  },

  dormant: {
    category: TAG_CATEGORIES.STATUS,
    description: 'No activity in last 30 days',
    color: '#9CA3AF',
    priority: 70,
    rules: {
      daysSinceLastMessage: { min: 30 }
    }
  },

  cold: {
    category: TAG_CATEGORIES.STATUS,
    description: 'No response to multiple outreach attempts',
    color: '#374151',
    priority: 60,
    rules: {
      consecutiveOutboundMessages: { min: 3 }, // This is calculated correctly
      daysSinceLastMessage: { min: 7 } // FIX: Use existing metric
    }
  },

  // ENGAGEMENT TAGS
  'hot-lead': {
    category: TAG_CATEGORIES.ENGAGEMENT,
    description: 'High engagement with quick responses',
    color: '#EF4444',
    priority: 95,
    rules: {
      averageResponseTime: { max: 3600 }, // 1 hour in seconds
      messageExchangeRate: { min: 0.3 } // FIX: Lowered threshold, removed positiveKeywords
    }
  },

  'warm-lead': {
    category: TAG_CATEGORIES.ENGAGEMENT,
    description: 'Moderate engagement level',
    color: '#F59E0B',
    priority: 85,
    rules: {
      averageResponseTime: { min: 3600, max: 86400 }, // 1-24 hours - FIX: Added min to prevent overlap
      messageExchangeRate: { min: 0.2 } // FIX: Simplified rule
    }
  },

  'cold-lead': {
    category: TAG_CATEGORIES.ENGAGEMENT,
    description: 'Low engagement or unresponsive',
    color: '#3B82F6',
    priority: 75,
    rules: {
      averageResponseTime: { min: 86400 } // 24+ hours - FIX: Changed from 48hrs
    }
  },

  interested: {
    category: TAG_CATEGORIES.ENGAGEMENT,
    description: 'Showing buying signals or interest',
    color: '#10B981',
    priority: 88,
    rules: {
      manual: true // Disabled - redundant with lead tags
    }
  },

  'not-interested': {
    category: TAG_CATEGORIES.ENGAGEMENT,
    description: 'Expressed lack of interest',
    color: '#6B7280',
    priority: 65,
    rules: {
      hasRejectionKeywords: true // FIX: Use calculated metric
    }
  },

  // BEHAVIORAL TAGS
  'quick-responder': {
    category: TAG_CATEGORIES.BEHAVIORAL,
    description: 'Average response time under 1 hour',
    color: '#8B5CF6',
    priority: 80,
    rules: {
      manual: true // Disabled - redundant with hot/warm/cold-lead
    }
  },

  'slow-responder': {
    category: TAG_CATEGORIES.BEHAVIORAL,
    description: 'Average response time over 24 hours',
    color: '#EC4899',
    priority: 70,
    rules: {
      manual: true // Disabled - redundant with hot/warm/cold-lead
    }
  },

  'night-owl': {
    category: TAG_CATEGORIES.BEHAVIORAL,
    description: 'Active during night hours (10PM-6AM)',
    color: '#6366F1',
    priority: 60,
    rules: {
      manual: true // Disabled - less important
    }
  },

  'business-hours': {
    category: TAG_CATEGORIES.BEHAVIORAL,
    description: 'Active during business hours (9AM-5PM)',
    color: '#14B8A6',
    priority: 60,
    rules: {
      manual: true // Disabled - less important
    }
  },

  'weekend-active': {
    category: TAG_CATEGORIES.BEHAVIORAL,
    description: 'Active on weekends',
    color: '#F97316',
    priority: 55,
    rules: {
      manual: true // Disabled - less important
    }
  },

  // ACTION TAGS
  'follow-up-needed': {
    category: TAG_CATEGORIES.ACTION,
    description: 'Requires follow-up action',
    color: '#DC2626',
    priority: 100,
    rules: {
      lastMessageFromContact: true,
      daysSinceLastMessage: { min: 2, max: 7 },
      containsQuestionMarks: true // FIX: Use existing metric instead of hasUnansweredQuestion
    }
  },

  'awaiting-response': {
    category: TAG_CATEGORIES.ACTION,
    description: 'Waiting for their reply',
    color: '#FBBF24',
    priority: 90,
    rules: {
      lastMessageFromMe: true,
      daysSinceLastMessage: { max: 7 }
    }
  },

  'needs-attention': {
    category: TAG_CATEGORIES.ACTION,
    description: 'Flagged for manual review',
    color: '#EF4444',
    priority: 95,
    rules: {
      hasUrgentKeywords: true // FIX: Use calculated metric
    }
  },

  vip: {
    category: TAG_CATEGORIES.ACTION,
    description: 'High-value or priority contact',
    color: '#7C3AED',
    priority: 100,
    rules: {
      // This is typically manually assigned or based on external data
      manual: true
    }
  },

  // FOLLOW-UP TAGS (automatically detected from scheduled_messages table)
  'followup-active': {
    category: TAG_CATEGORIES.FOLLOWUP,
    description: 'Currently in a follow-up sequence',
    color: '#8B5CF6',
    priority: 85,
    rules: {
      hasActiveFollowup: true // Has scheduled messages with template_id
    }
  },

  'followup-completed': {
    category: TAG_CATEGORIES.FOLLOWUP,
    description: 'Completed follow-up sequence',
    color: '#10B981',
    priority: 75,
    rules: {
      hasCompletedFollowup: true // All template messages sent
    }
  },

  'followup-responded': {
    category: TAG_CATEGORIES.FOLLOWUP,
    description: 'Responded during follow-up sequence',
    color: '#22C55E',
    priority: 80,
    rules: {
      hasFollowupResponse: true // Contact replied during sequence
    }
  },

  // QUALIFICATION TAGS (Automatically detect if contact is a lead)
  // Priority: Higher priority tags are checked first and will prevent lower priority ones

  'not-a-lead': {
    category: TAG_CATEGORIES.QUALIFICATION,
    description: 'Not a sales lead (spam, general inquiry, etc)',
    color: '#6B7280',
    priority: 100, // Check this FIRST
    rules: {
      // Spam, general chat, or feedback - not sales related
      aiIntent: ['spam', 'general', 'feedback']
    }
  },

  'unresponsive': {
    category: TAG_CATEGORIES.QUALIFICATION,
    description: 'No response from contact (only outbound)',
    color: '#475569',
    priority: 99, // Check before lead tags
    rules: {
      // Only outbound messages, no engagement
      inboundMessages: { max: 0 },
      outboundMessages: { min: 1 }
    }
  },

  'qualified-lead': {
    category: TAG_CATEGORIES.QUALIFICATION,
    description: 'High-quality lead with buying intent',
    color: '#16A34A',
    priority: 95,
    rules: {
      // Must have inquiry or purchase intent (NOT support/complaint)
      aiIntent: ['inquiry', 'purchase'],
      // Must have good engagement (back-and-forth conversation)
      messageExchangeRate: { min: 0.25 },
      // Must have inbound messages (they initiated or responded)
      inboundMessages: { min: 2 },
      // More than just a quick exchange
      totalMessages: { min: 3 }
    }
  },

  'customer': {
    category: TAG_CATEGORIES.QUALIFICATION,
    description: 'Existing customer (support or complaint)',
    color: '#0891B2',
    priority: 93,
    rules: {
      // Support or complaint intent = existing customer
      aiIntent: ['support', 'complaint'],
      // Has engagement history
      totalMessages: { min: 3 }
    }
  },

  'potential-lead': {
    category: TAG_CATEGORIES.QUALIFICATION,
    description: 'Could be a lead but low engagement',
    color: '#CA8A04',
    priority: 85,
    rules: {
      // Has inquiry or purchase intent
      aiIntent: ['inquiry', 'purchase'],
      // Has responded but low engagement
      inboundMessages: { min: 1 },
      totalMessages: { min: 1 }
    }
  }
};

// AI Classification Prompts (using GPT-4o-mini for cost efficiency)
const AI_PROMPTS = {
  sentiment: {
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 50,
    systemPrompt: (companyContext) => `You are a sentiment analyzer for WhatsApp business conversations. 
${companyContext ? `Company context: ${companyContext}\n\n` : ''}Analyze the overall sentiment and respond with ONLY one word: "positive", "negative", or "neutral".

Consider:
- Tone and language used
- Buying signals vs rejection signals
- Enthusiasm level
- Complaint or praise indicators`,

    userPrompt: (messages) => `Analyze the sentiment of this conversation (most recent messages first):

${messages.map((m, i) => `${m.from_me ? 'Business' : 'Customer'}: ${m.content}`).join('\n')}

Respond with ONLY: positive, negative, or neutral`
  },

  intent: {
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 100,
    systemPrompt: (companyContext) => `You are an intent classifier for business conversations. 
${companyContext ? `Company context: ${companyContext}\n\n` : ''}Identify the primary intent and respond with ONE of these intents: "inquiry", "purchase", "support", "complaint", "feedback", "general", "spam".

Intent definitions:
- inquiry: Asking questions about products/services, price inquiries, information requests (POTENTIAL LEAD)
- purchase: Ready to buy, discussing orders, payment, delivery (QUALIFIED LEAD)
- support: Needs help with existing product/service, technical issues (EXISTING CUSTOMER)
- complaint: Expressing dissatisfaction or issues (EXISTING CUSTOMER)
- feedback: Providing opinions or suggestions
- general: Casual conversation, greetings, off-topic chat (NOT A LEAD)
- spam: Irrelevant, promotional, or automated messages (NOT A LEAD)`,

    userPrompt: (messages) => `What is the primary intent of this conversation? Focus on identifying if this is a sales lead.

${messages.map((m, i) => `${m.from_me ? 'Business' : 'Customer'}: ${m.content}`).join('\n')}

Respond with ONLY the intent word: inquiry, purchase, support, complaint, feedback, general, or spam.`
  },

  stage: {
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 100,
    systemPrompt: `You are a conversation stage analyzer. Determine the current stage and respond with ONE word: "initial", "ongoing", "closing", "closed", "stalled".

Stage definitions:
- initial: First contact or early conversation
- ongoing: Active back-and-forth discussion
- closing: Near completion, wrapping up
- closed: Conversation ended naturally
- stalled: No recent activity or engagement dropped`,

    userPrompt: (messages, daysSinceLastMessage) => `Analyze this conversation and determine its current stage. (Last message was ${daysSinceLastMessage} days ago).

${messages.map((m, i) => `${m.from_me ? 'Business' : 'Customer'}: ${m.content}`).join('\n')}

Consider the flow of conversation, last interaction, and engagement level. Respond with ONLY one of these stage words: initial, ongoing, closing, closed, or stalled.`
  },

  summary: {
    model: 'gpt-4o-mini',
    temperature: 0.5,
    maxTokens: 200,
    systemPrompt: (companyContext) => `You are a helpful assistant that summarizes conversations. 
${companyContext ? `Company context: ${companyContext}\n\n` : ''}Provide a concise 1-2 sentence summary focusing on key points, decisions, and next steps.`,
    
    userPrompt: (messages) => `Please summarize this conversation concisely:

${messages.map((m, i) => `${m.from_me ? 'Business' : 'Customer'}: ${m.content}`).join('\n')}`
  }
};

// Time constants in seconds
const TIME_CONSTANTS = {
  HOUR: 3600,
  DAY: 86400,
  WEEK: 604800,
  MONTH: 2592000
};

// Analysis configuration
const ANALYSIS_CONFIG = {
  // How many recent messages to analyze
  messageLimit: 50,

  // How many messages to send to AI (to save costs)
  aiMessageLimit: 10,

  // How many unanswered outbound messages to capture for drop-off insight
  unansweredMessageSampleLimit: 3,

  // Minimum messages needed for behavioral analysis
  minMessagesForBehavior: 5,

  // Cache AI results for this many seconds
  aiCacheSeconds: 3600, // 1 hour

  // Batch size for processing multiple contacts
  batchSize: 50,

  // Enable/disable AI classification (can be toggled to save costs)
  enableAI: true,

  // Enable/disable specific AI analyses
  enableSentimentAnalysis: true,
  enableIntentAnalysis: true,
  enableStageAnalysis: true,
  enableSummary: false // More expensive, only when needed
};

// Keywords for rule-based classification
const KEYWORDS = {
  questions: ['?', 'how', 'what', 'when', 'where', 'why', 'which', 'who', 'can you', 'could you', 'would you'],
  closing: ['thank you', 'thanks', 'perfect', 'great', 'got it', 'understood', 'appreciate', 'wonderful', 'awesome'],
  interest: ['price', 'cost', 'buy', 'purchase', 'order', 'interested', 'details', 'more info', 'tell me more', 'how much'],
  rejection: ['not interested', 'no thanks', 'don\'t need', 'not now', 'maybe later', 'stop', 'remove', 'unsubscribe'],
  urgent: ['urgent', 'asap', 'immediately', 'emergency', 'help', 'please', 'important', 'critical'],
  complaint: ['complaint', 'issue', 'problem', 'wrong', 'bad', 'terrible', 'disappointed', 'unhappy', 'not working']
};

module.exports = {
  TAG_CATEGORIES,
  DEFAULT_TAGS,
  AI_PROMPTS,
  TIME_CONSTANTS,
  ANALYSIS_CONFIG,
  KEYWORDS
};
