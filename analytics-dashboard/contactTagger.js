// =====================================================
// Contact Tagging System
// Automatically tags contacts based on message analysis
// Uses GPT-4o-mini for cost-effective AI classification
// =====================================================

require('dotenv').config();
const OpenAI = require('openai');
const sqlDb = require('../db');
const {
  TAG_CATEGORIES,
  DEFAULT_TAGS,
  AI_PROMPTS,
  TIME_CONSTANTS,
  ANALYSIS_CONFIG,
  KEYWORDS
} = require('./tagConfig');

// Initialize OpenAI with GPT-4o-mini (cheap model)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// =====================================================
// MESSAGE ANALYZER
// =====================================================

class MessageAnalyzer {
  constructor(messages, contactId, companyId, companyContext = '') {
    this.messages = messages || [];
    this.contactId = contactId;
    this.companyId = companyId;
    this.companyContext = companyContext;
    this.metrics = {};
  }

  /**
   * Run complete analysis on messages
   */
  async analyze(skipAI = false) {
    if (this.messages.length === 0) {
      return this.getDefaultMetrics();
    }

    // Sort messages by timestamp (newest first)
    this.messages.sort((a, b) => b.timestamp - a.timestamp);

    // Calculate all metrics
    this.calculateBasicMetrics();
    this.calculateTimeMetrics();
    this.calculateBehavioralMetrics();
    this.calculateEngagementMetrics();
    this.analyzeContent();

    // Check for follow-up sequences
    await this.checkFollowupStatus();

    // Run AI analysis only if enabled and not explicitly skipped
    if (ANALYSIS_CONFIG.enableAI && !skipAI) {
      await this.runAIAnalysis();
    }

    return this.metrics;
  }

  /**
   * Calculate basic message metrics
   */
  calculateBasicMetrics() {
    const totalMessages = this.messages.length;
    const inboundMessages = this.messages.filter(m => !m.from_me).length;
    const outboundMessages = this.messages.filter(m => m.from_me).length;

    const lastMessage = this.messages[0]; // Most recent
    const firstMessage = this.messages[this.messages.length - 1]; // Oldest

    this.metrics.totalMessages = totalMessages;
    this.metrics.inboundMessages = inboundMessages;
    this.metrics.outboundMessages = outboundMessages;
    this.metrics.lastMessageFromMe = lastMessage?.from_me || false;
    this.metrics.lastMessageFromContact = !lastMessage?.from_me || false;
    // FIX: timestamp is already a Date object, no need to multiply by 1000
    this.metrics.firstContactDate = firstMessage?.timestamp ? new Date(firstMessage.timestamp) : null;
    this.metrics.lastMessageDate = lastMessage?.timestamp ? new Date(lastMessage.timestamp) : null;
  }

  /**
   * Calculate time-based metrics
   */
  calculateTimeMetrics() {
    const now = Date.now();
    const lastMessageTime = this.metrics.lastMessageDate?.getTime() || now;
    const firstContactTime = this.metrics.firstContactDate?.getTime() || now;

    this.metrics.daysSinceLastMessage = Math.floor((now - lastMessageTime) / (TIME_CONSTANTS.DAY * 1000));
    this.metrics.daysSinceFirstContact = Math.floor(
      (now - firstContactTime) / (TIME_CONSTANTS.DAY * 1000)
    );

    // Calculate average response time (customer's response to our messages)
    const responseTimes = [];
    for (let i = 0; i < this.messages.length - 1; i++) {
      const currentMsg = this.messages[i];
      const previousMsg = this.messages[i + 1];

      // If current is from contact and previous is from us
      if (!currentMsg.from_me && previousMsg.from_me) {
        // FIX: timestamps are already Date objects, convert to milliseconds
        const currentTime = new Date(currentMsg.timestamp).getTime();
        const previousTime = new Date(previousMsg.timestamp).getTime();
        const responseTime = (currentTime - previousTime) / 1000; // Convert to seconds
        if (responseTime > 0 && responseTime < TIME_CONSTANTS.WEEK) { // Filter outliers
          responseTimes.push(responseTime);
        }
      }
    }

    this.metrics.averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : null;

    // Calculate consecutive outbound messages (for cold lead detection)
    let consecutiveOutbound = 0;
    for (const msg of this.messages) {
      if (msg.from_me) {
        consecutiveOutbound++;
      } else {
        break; // Stop at first inbound message
      }
    }
    this.metrics.consecutiveOutboundMessages = consecutiveOutbound;
  }

  /**
   * Calculate behavioral patterns
   */
  calculateBehavioralMetrics() {
    if (this.messages.length < ANALYSIS_CONFIG.minMessagesForBehavior) {
      this.metrics.behaviorAnalyzed = false;
      return;
    }

    const contactMessages = this.messages.filter(m => !m.from_me);

    // Analyze message timing - FIX: timestamp is already a Date object
    const nightMessages = contactMessages.filter(m => {
      const hour = new Date(m.timestamp).getHours();
      return hour >= 22 || hour < 6;
    }).length;

    const businessHourMessages = contactMessages.filter(m => {
      const hour = new Date(m.timestamp).getHours();
      return hour >= 9 && hour < 17;
    }).length;

    const weekendMessages = contactMessages.filter(m => {
      const day = new Date(m.timestamp).getDay();
      return day === 0 || day === 6; // Sunday or Saturday
    }).length;

    this.metrics.nightMessagePercentage = contactMessages.length > 0
      ? nightMessages / contactMessages.length
      : 0;

    this.metrics.businessHourPercentage = contactMessages.length > 0
      ? businessHourMessages / contactMessages.length
      : 0;

    this.metrics.weekendMessagePercentage = contactMessages.length > 0
      ? weekendMessages / contactMessages.length
      : 0;

    this.metrics.behaviorAnalyzed = true;
  }

  /**
   * Calculate engagement metrics
   */
  calculateEngagementMetrics() {
    // Message exchange rate (how balanced is the conversation)
    const totalMessages = this.metrics.totalMessages;
    const inboundMessages = this.metrics.inboundMessages;

    this.metrics.messageExchangeRate = totalMessages > 0
      ? Math.min(inboundMessages, totalMessages - inboundMessages) / totalMessages
      : 0;

    // Has recent exchange (both parties messaged in last 3 days)
    // FIX: timestamp is already a Date object
    const threeDaysAgo = Date.now() - (3 * TIME_CONSTANTS.DAY * 1000);
    const recentMessages = this.messages.filter(m => new Date(m.timestamp).getTime() > threeDaysAgo);
    const hasInbound = recentMessages.some(m => !m.from_me);
    const hasOutbound = recentMessages.some(m => m.from_me);

    this.metrics.hasRecentExchange = hasInbound && hasOutbound;

    // Extract unanswered messages for drop-off analysis
    this.metrics.unansweredMessages = this.extractUnansweredMessages();
  }

  /**
   * Extract the last few unanswered outbound messages (what we sent that they didn't reply to)
   * Only includes messages from the last 4 months (120 days)
   */
  extractUnansweredMessages() {
    // Get consecutive outbound messages starting from the most recent
    const unansweredMessages = [];
    const limit = ANALYSIS_CONFIG.unansweredMessageSampleLimit || 3;
    const fourMonthsAgo = Date.now() - (120 * 24 * 60 * 60 * 1000); // 120 days in milliseconds

    for (const msg of this.messages) {
      if (msg.from_me) {
        const messageTime = new Date(msg.timestamp).getTime();
        const days_ago = Math.floor((Date.now() - messageTime) / (1000 * 60 * 60 * 24));

        // Only include messages from the last 4 months
        if (messageTime >= fourMonthsAgo) {
          unansweredMessages.push({
            content: msg.content,
            timestamp: msg.timestamp,
            message_id: msg.message_id,
            days_ago: days_ago
          });

          // Limit to configured number of messages
          if (unansweredMessages.length >= limit) {
            break;
          }
        }
      } else {
        // Stop at first inbound message (they responded to everything before this)
        break;
      }
    }

    return unansweredMessages;
  }

  /**
   * Analyze message content for keywords
   */
  analyzeContent() {
    const allContent = this.messages
      .map(m => m.content?.toLowerCase() || '')
      .join(' ');

    const lastContactMessage = this.messages.find(m => !m.from_me);
    const lastContactContent = lastContactMessage?.content?.toLowerCase() || '';

    // Check for question marks and question words
    this.metrics.containsQuestionMarks = lastContactContent.includes('?');
    this.metrics.hasQuestionWords = KEYWORDS.questions.some(word =>
      lastContactContent.includes(word)
    );

    // Check for closing phrases
    this.metrics.hasClosingPhrases = KEYWORDS.closing.some(phrase =>
      lastContactContent.includes(phrase)
    );

    // Check for interest keywords
    this.metrics.hasInterestKeywords = KEYWORDS.interest.some(word =>
      allContent.includes(word)
    );

    // Check for rejection keywords
    this.metrics.hasRejectionKeywords = KEYWORDS.rejection.some(word =>
      allContent.includes(word)
    );

    // Check for urgent keywords
    this.metrics.hasUrgentKeywords = KEYWORDS.urgent.some(word =>
      allContent.includes(word)
    );

    // Check for complaint keywords
    this.metrics.hasComplaintKeywords = KEYWORDS.complaint.some(word =>
      allContent.includes(word)
    );
  }

  /**
   * Check if contact is in a follow-up sequence
   */
  async checkFollowupStatus() {
    try {
      // Query scheduled_messages table for this contact
      const query = `
        SELECT
          template_id,
          status,
          scheduled_time,
          sent_at,
          COUNT(*) OVER (PARTITION BY template_id) as total_messages,
          COUNT(*) FILTER (WHERE status = 'sent') OVER (PARTITION BY template_id) as sent_count,
          COUNT(*) FILTER (WHERE status = 'scheduled') OVER (PARTITION BY template_id) as scheduled_count
        FROM scheduled_messages
        WHERE contact_id = $1 AND company_id = $2 AND template_id IS NOT NULL
        ORDER BY scheduled_time DESC
        LIMIT 1
      `;

      const result = await sqlDb.query(query, [this.contactId, this.companyId]);

      if (result.rows.length > 0) {
        const followupData = result.rows[0];

        // Check if there are scheduled messages (active follow-up)
        this.metrics.hasActiveFollowup = followupData.scheduled_count > 0;

        // Check if all messages are sent (completed follow-up)
        this.metrics.hasCompletedFollowup =
          followupData.scheduled_count === 0 &&
          followupData.sent_count > 0;

        // Check if contact responded during follow-up
        // (has inbound messages after the first template message was sent)
        if (followupData.sent_count > 0 && this.metrics.inboundMessages > 0) {
          const firstTemplateSentQuery = `
            SELECT MIN(sent_at) as first_sent
            FROM scheduled_messages
            WHERE contact_id = $1 AND company_id = $2 AND template_id = $3 AND status = 'sent'
          `;
          const firstSentResult = await sqlDb.query(firstTemplateSentQuery, [
            this.contactId,
            this.companyId,
            followupData.template_id
          ]);

          if (firstSentResult.rows[0]?.first_sent) {
            const firstSentTime = new Date(firstSentResult.rows[0].first_sent).getTime();
            const hasResponseAfterFollowup = this.messages.some(
              m => !m.from_me && new Date(m.timestamp).getTime() > firstSentTime
            );
            this.metrics.hasFollowupResponse = hasResponseAfterFollowup;
          } else {
            this.metrics.hasFollowupResponse = false;
          }
        } else {
          this.metrics.hasFollowupResponse = false;
        }

        // Store template info for reference
        this.metrics.followupTemplateId = followupData.template_id;
        this.metrics.followupProgress = `${followupData.sent_count}/${followupData.total_messages}`;

      } else {
        // No follow-up sequence
        this.metrics.hasActiveFollowup = false;
        this.metrics.hasCompletedFollowup = false;
        this.metrics.hasFollowupResponse = false;
      }

    } catch (error) {
      console.error(`Error checking follow-up status for ${this.contactId}:`, error.message);
      // Set defaults on error
      this.metrics.hasActiveFollowup = false;
      this.metrics.hasCompletedFollowup = false;
      this.metrics.hasFollowupResponse = false;
    }
  }

  /**
   * Run AI-based analysis using a Multi-Agent System (MAS) Approach
   * Specialized agents analyze the same context concurrently
   */
  async runAIAnalysis() {
    try {
      // Limit messages sent to AI to save costs and filter out any messages with null/empty content
      const recentMessages = this.messages
        .filter(m => m.content && m.content.trim() !== '') // Filter out empty/null content
        .slice(0, ANALYSIS_CONFIG.aiMessageLimit)
        .reverse(); // Oldest to newest for AI

      // Skip analysis if no valid messages
      if (recentMessages.length === 0) {
        console.log(`[Orchestrator] Skipping MAS analysis for ${this.contactId} - no valid messages`);
        return;
      }

      // ━━━ Multi-Agent System (MAS) Orchestration ━━━
      // Deploying specialized AI agents concurrently to analyze conversation
      const activeAgents = [];

      // Agent 1: Sentiment Intelligence
      if (ANALYSIS_CONFIG.enableSentimentAnalysis) {
        activeAgents.push((async () => {
          this.metrics.aiSentiment = await this.analyzeWithAI('sentiment', recentMessages);
          console.log(`[Sentiment Agent] evaluated ${this.contactId} -> ${this.metrics.aiSentiment}`);
        })());
      }

      // Agent 2: Buyer Intent Identifier
      if (ANALYSIS_CONFIG.enableIntentAnalysis) {
        activeAgents.push((async () => {
          this.metrics.aiIntent = await this.analyzeWithAI('intent', recentMessages);
          console.log(`[Intent Agent] evaluated ${this.contactId} -> ${this.metrics.aiIntent}`);
        })());
      }

      // Agent 3: Pipeline Stage Assessor
      if (ANALYSIS_CONFIG.enableStageAnalysis) {
        activeAgents.push((async () => {
          this.metrics.aiStage = await this.analyzeWithAI('stage', recentMessages, this.metrics.daysSinceLastMessage);
          console.log(`[Stage Agent] evaluated ${this.contactId} -> ${this.metrics.aiStage}`);
        })());
      }

      // Agent 4: Conversation Summarizer (optional, more expensive)
      if (ANALYSIS_CONFIG.enableSummary) {
        activeAgents.push((async () => {
          this.metrics.aiSummary = await this.analyzeWithAI('summary', recentMessages);
          console.log(`[Summary Agent] generated report for ${this.contactId}`);
        })());
      }

      // Execute all analytical agents simultaneously
      await Promise.all(activeAgents);

    } catch (error) {
      console.error(`[Orchestrator] MAS Analysis Error for contact ${this.contactId}:`, error.message);
      this.metrics.aiError = error.message;
    }
  }

  /**
   * Helper to call OpenAI API
   */
  async analyzeWithAI(analysisType, messages, extraData = null) {
    const prompt = AI_PROMPTS[analysisType];
    if (!prompt) {
      throw new Error(`Unknown analysis type: ${analysisType}`);
    }

    try {
      // Filter out any messages with null/empty content (defensive check)
      const validMessages = messages.filter(m => m.content && m.content.trim() !== '');

      // If no valid messages, return a default value based on analysis type
      if (validMessages.length === 0) {
        console.log(`No valid messages for ${analysisType} analysis on ${this.contactId}`);
        return this.getDefaultAIResult(analysisType);
      }

      const systemContent = typeof prompt.systemPrompt === 'function'
        ? prompt.systemPrompt(this.companyContext)
        : prompt.systemPrompt;

      const userContent = typeof prompt.userPrompt === 'function'
        ? prompt.userPrompt(validMessages, extraData)
        : prompt.userPrompt;

      // Additional validation for content
      if (!userContent || typeof userContent !== 'string' || userContent.trim() === '') {
        console.error(`Invalid user content for ${analysisType} analysis on ${this.contactId}`);
        return this.getDefaultAIResult(analysisType);
      }

      const completion = await openai.chat.completions.create({
        model: prompt.model,
        temperature: prompt.temperature,
        max_tokens: prompt.maxTokens,
        messages: [
          {
            role: 'system',
            content: systemContent
          },
          {
            role: 'user',
            content: userContent
          }
        ]
      });

      const result = completion.choices[0]?.message?.content?.trim().toLowerCase();
      console.log(`AI ${analysisType} for ${this.contactId}: ${result}`);
      return result || this.getDefaultAIResult(analysisType);

    } catch (error) {
      console.error(`OpenAI API Error (${analysisType}):`, error.message);
      return null;
    }
  }

  /**
   * Get default AI result based on analysis type
   */
  getDefaultAIResult(analysisType) {
    switch (analysisType) {
      case 'sentiment':
        return 'neutral';
      case 'intent':
        return 'general';
      case 'stage':
        return 'stalled';
      case 'summary':
        return 'No summary available';
      default:
        return null;
    }
  }

  /**
   * Get default metrics for contacts with no messages
   */
  getDefaultMetrics() {
    return {
      totalMessages: 0,
      inboundMessages: 0,
      outboundMessages: 0,
      lastMessageFromMe: false,
      lastMessageFromContact: false,
      daysSinceLastMessage: Infinity,
      daysSinceFirstContact: 0,
      averageResponseTime: null,
      consecutiveOutboundMessages: 0,
      messageExchangeRate: 0,
      hasRecentExchange: false,
      behaviorAnalyzed: false,
      containsQuestionMarks: false,
      hasQuestionWords: false,
      hasClosingPhrases: false,
      hasInterestKeywords: false,
      hasRejectionKeywords: false,
      hasUrgentKeywords: false,
      hasComplaintKeywords: false
    };
  }
}

// =====================================================
// TAG CLASSIFIER
// =====================================================

class TagClassifier {
  constructor(metrics, currentTags = []) {
    this.metrics = metrics;
    // Handle JSONB array format (already parsed by pg driver as JS array)
    this.currentTags = Array.isArray(currentTags) ? currentTags : [];
    this.recommendedTags = [];
    this.tagsToAdd = [];
    this.tagsToRemove = [];
  }

  /**
   * Classify and generate tag recommendations
   */
  classify() {
    // Sort tags by priority (higher priority evaluated first)
    const sortedTags = Object.entries(DEFAULT_TAGS)
      .sort(([, a], [, b]) => b.priority - a.priority);

    // Track if we've already assigned a qualification tag
    let hasQualificationTag = false;
    const qualificationTags = ['qualified-lead', 'potential-lead', 'customer', 'not-a-lead', 'unresponsive'];

    // Store all matching tags with their priority for sorting
    const matchingTags = [];

    for (const [tagName, tagConfig] of sortedTags) {
      // For qualification tags, only apply the FIRST one that matches (mutually exclusive)
      if (qualificationTags.includes(tagName)) {
        if (hasQualificationTag) {
          continue; // Skip other qualification tags
        }
        if (this.evaluateTag(tagName, tagConfig)) {
          matchingTags.push({ name: tagName, priority: tagConfig.priority });
          hasQualificationTag = true;
        }
      } else {
        // Non-qualification tags can all be applied
        if (this.evaluateTag(tagName, tagConfig)) {
          matchingTags.push({ name: tagName, priority: tagConfig.priority });
        }
      }
    }

    // Sort all matching tags by priority (highest first) and take top 3
    const topTags = matchingTags
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3)
      .map(tag => tag.name);

    // Update recommended tags with top 3
    this.recommendedTags = topTags;

    // ONLY ADD tags, never remove existing tags (additive only)
    // But limit to only the top 3 most important new tags
    this.tagsToAdd = this.recommendedTags
      .filter(tag => !this.currentTags.includes(tag))
      .slice(0, 3); // Ensure we don't add more than 3 new tags

    this.tagsToRemove = []; // Never remove tags

    // Merge current tags with new recommendations, but limit to max 3 most important tags
    const finalTags = [...new Set([...this.currentTags, ...this.recommendedTags])];

    // If we have more than 3 tags, keep only the most important ones
    const prioritizedTags = sortedTags
      .filter(([tagName]) => finalTags.includes(tagName))
      .sort(([, a], [, b]) => b.priority - a.priority)
      .slice(0, 3)
      .map(([tagName]) => tagName);

    return {
      recommended: prioritizedTags, // Only include top 3 most important tags
      toAdd: this.tagsToAdd,
      toRemove: this.tagsToRemove,
      current: this.currentTags,
      _allMatchingTags: matchingTags // For debugging purposes
    };
  }

  /**
   * Evaluate if a tag should be applied based on rules
   */
  evaluateTag(tagName, tagConfig) {
    const rules = tagConfig.rules;
    if (!rules || rules.manual) {
      return false; // Skip manual tags or tags without rules
    }

    // Check each rule condition
    for (const [ruleKey, ruleValue] of Object.entries(rules)) {
      if (!this.checkRule(ruleKey, ruleValue)) {
        return false; // Rule not met
      }
    }

    return true; // All rules met
  }

  /**
   * Check individual rule against metrics
   */
  checkRule(ruleKey, ruleValue) {
    const metric = this.metrics[ruleKey];

    // Handle different rule types
    if (typeof ruleValue === 'boolean') {
      return metric === ruleValue;
    }

    // Check arrays BEFORE objects (arrays are objects in JS!)
    if (Array.isArray(ruleValue)) {
      // Check if metric matches any value in array (exact match, not substring)
      return ruleValue.some(val => metric === val);
    }

    if (typeof ruleValue === 'object' && ruleValue !== null) {
      // Range check (min/max)
      if ('min' in ruleValue && metric < ruleValue.min) return false;
      if ('max' in ruleValue && metric > ruleValue.max) return false;
      return true;
    }

    if (typeof ruleValue === 'string') {
      // String comparison
      return metric === ruleValue;
    }

    return true;
  }
}

// =====================================================
// CONTACT TAGGER (Main Class)
// =====================================================

class ContactTagger {
  constructor(companyId, options = {}) {
    this.companyId = companyId;
    this.options = {
      dryRun: options.dryRun || false,
      verbose: options.verbose || false,
      aiEnabled: options.aiEnabled !== false, // Default true
      daysFilter: options.daysFilter || null, // Filter by days of activity
      ...options
    };
  }

  /**
   * Tag a single contact
   */
  async tagContact(contactId, localOptions = {}) {
    const skipAI = localOptions.skipAI || false;
    try {
      if (this.options.verbose) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Tagging contact: ${contactId}${skipAI ? ' [rule-based only]' : ''}`);
        console.log('='.repeat(60));
      }

      // Fetch contact data first to check phone number
      const contact = await this.getContact(contactId);
      if (!contact) {
        throw new Error(`Contact ${contactId} not found`);
      }

      // Check if this is a group chat
      // Groups have phone ending with @g.us, individuals end with @c.us
      // Also detect group by phone containing '120363' (WhatsApp group format)
      const isGroup = (contact.phone && contact.phone.includes('@g.us')) ||
        (contact.phone && contact.phone.includes('120363'));

      if (isGroup) {
        if (this.options.verbose) {
          console.log('👥 Detected group chat - tagging as "group"');
        }

        // Only add 'group' tag if not already present
        const currentTags = Array.isArray(contact.tags) ? contact.tags : [];
        const hasGroupTag = currentTags.includes('group');

        if (!hasGroupTag && !this.options.dryRun) {
          const newTags = [...currentTags, 'group'];
          await this.updateContactTags(contactId, {
            recommended: newTags,
            toAdd: ['group'],
            toRemove: [],
            current: currentTags
          });
        }

        return {
          contactId,
          success: true,
          isGroup: true,
          tags: {
            current: currentTags,
            recommended: hasGroupTag ? currentTags : [...currentTags, 'group'],
            toAdd: hasGroupTag ? [] : ['group'],
            toRemove: []
          }
        };
      }

      // Fetch messages
      const messages = await this.getMessages(contactId);

      if (this.options.verbose) {
        console.log(`Found ${messages.length} messages for contact ${contactId}`);
      }

      // Analyze messages with company context
      const metrics = await this.analyzeMessages(contactId, messages, skipAI);

      if (this.options.verbose) {
        console.log('\nMetrics:', JSON.stringify(metrics, null, 2));
      }

      // Classify tags
      const classifier = new TagClassifier(metrics, contact.tags);
      const tagResult = classifier.classify();

      // Check if contact is not a sales lead (either newly classified OR already has the tag)
      // Non-sales contacts: not-a-lead, unresponsive, customer (support/existing customer)
      const nonSalesLeadTags = ['not-a-lead', 'unresponsive', 'customer'];
      const currentTags = Array.isArray(contact.tags) ? contact.tags : [];
      const alreadyHasNonLeadTag = currentTags.some(tag => nonSalesLeadTags.includes(tag));
      const newlyClassifiedAsNonLead = tagResult.toAdd.some(tag => nonSalesLeadTags.includes(tag));

      if (alreadyHasNonLeadTag || newlyClassifiedAsNonLead) {
        if (this.options.verbose) {
          const reason = alreadyHasNonLeadTag
            ? `Already tagged as non-lead`
            : `Newly classified as non-lead`;
          console.log(`\n⚠️  ${reason} - not adding any tags`);
        }

        if (newlyClassifiedAsNonLead) {
          // Only add the qualification tag
          const qualificationTag = tagResult.toAdd.find(tag => nonSalesLeadTags.includes(tag));
          tagResult.toAdd = [qualificationTag];
          tagResult.recommended = [...currentTags, qualificationTag];
        } else {
          // Already has non-sales-lead tag, don't add anything
          tagResult.toAdd = [];
          tagResult.recommended = currentTags;
        }
      }

      if (this.options.verbose) {
        console.log('\nTag Classification:');
        console.log('  Current:', tagResult.current);
        console.log('  Recommended:', tagResult.recommended);
        console.log('  To Add:', tagResult.toAdd);
        console.log('  To Remove:', tagResult.toRemove);
      }

      // Update database (unless dry run)
      if (!this.options.dryRun) {
        await this.updateContactTags(contactId, tagResult, metrics);
      }

      return {
        contactId,
        success: true,
        metrics,
        tags: tagResult,
        dryRun: this.options.dryRun
      };

    } catch (error) {
      console.error(`Error tagging contact ${contactId}:`, error);
      return {
        contactId,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tag multiple contacts (batch processing)
   */
  async tagAllContacts(limit = null) {
    try {
      console.log(`\nFetching contacts for company ${this.companyId}...`);

      const contacts = await this.getAllContacts(limit);
      console.log(`Found ${contacts.length} contacts to process\n`);

      const results = [];
      let successCount = 0;
      let failCount = 0;

      // Process in batches
      for (let i = 0; i < contacts.length; i += ANALYSIS_CONFIG.batchSize) {
        const batch = contacts.slice(i, i + ANALYSIS_CONFIG.batchSize);

        console.log(`\nProcessing batch ${Math.floor(i / ANALYSIS_CONFIG.batchSize) + 1}/${Math.ceil(contacts.length / ANALYSIS_CONFIG.batchSize)}`);

        for (const contact of batch) {
          const result = await this.tagContact(contact.contact_id);
          results.push(result);

          if (result.success) {
            successCount++;
          } else {
            failCount++;
          }

          // Add small delay to avoid overwhelming the database/API
          await this.delay(100);
        }
      }

      console.log(`\n${'='.repeat(60)}`);
      console.log('Batch Processing Complete');
      console.log('='.repeat(60));
      console.log(`Total: ${contacts.length}`);
      console.log(`Success: ${successCount}`);
      console.log(`Failed: ${failCount}`);

      return {
        total: contacts.length,
        success: successCount,
        failed: failCount,
        results
      };

    } catch (error) {
      console.error('Error in batch tagging:', error);
      throw error;
    }
  }

  /**
   * Get contact from database
   */
  async getContact(contactId) {
    const query = 'SELECT * FROM contacts WHERE contact_id = $1 AND company_id = $2';
    const result = await sqlDb.query(query, [contactId, this.companyId]);
    return result.rows[0];
  }

  /**
   * Get all contacts for company (exclude groups, only get individual leads)
   */
  async getAllContacts(limit = null) {
    // Only get individual contacts (phone ending with @c.us), exclude groups (@g.us)
    let query = `
      SELECT c.contact_id, c.phone, c.name, c.tags
      FROM contacts c
      WHERE c.company_id = $1
        AND (c.phone NOT LIKE '%@g.us' OR c.phone IS NULL)
    `;
    const params = [this.companyId];
    let paramIndex = 2;

    // Filter by contacts with messages in last N days
    if (this.options.daysFilter) {
      query += `
        AND EXISTS (
          SELECT 1 FROM messages m
          WHERE m.contact_id = c.contact_id
            AND m.company_id = c.company_id
            AND m.timestamp >= NOW() - INTERVAL '${parseInt(this.options.daysFilter)} days'
        )
      `;
    }

    query += ' ORDER BY c.last_updated DESC';

    if (limit) {
      query += ` LIMIT $${paramIndex}`;
      params.push(limit);
    }

    const result = await sqlDb.query(query, params);
    return result.rows;
  }

  /**
   * Analyze messages with company context
   */
  async analyzeMessages(contactId, messages, skipAI = false) {
    try {
      const analyzer = new MessageAnalyzer(
        messages,
        contactId,
        this.companyId,
        this.options.companyContext || ''
      );
      return await analyzer.analyze(skipAI);
    } catch (error) {
      console.error(`Error analyzing messages for ${contactId}:`, error);
      return this.getDefaultMetrics();
    }
  }

  /**
   * Get messages for contact
   */
  async getMessages(contactId) {
    const query = `
      SELECT message_id, content, from_me, timestamp
      FROM messages
      WHERE contact_id = $1 AND company_id = $2
      ORDER BY timestamp DESC
      LIMIT $3
    `;

    const result = await sqlDb.query(query, [
      contactId,
      this.companyId,
      ANALYSIS_CONFIG.messageLimit
    ]);

    return result.rows;
  }

  /**
   * Update contact tags and analytics in database
   */
  async updateContactTags(contactId, tagResult, metrics = null) {
    const client = await sqlDb.pool.connect();

    try {
      await client.query('BEGIN');

      // Get current tags first
      const currentTagsResult = await client.query(
        'SELECT tags FROM contacts WHERE contact_id = $1 AND company_id = $2',
        [contactId, this.companyId]
      );
      const currentTags = currentTagsResult.rows[0]?.tags || [];

      // Merge existing tags with new ones to preserve any manual tags
      const existingTagsSet = new Set(currentTags);
      const tagsToAdd = tagResult.toAdd || [];

      // Add new tags
      tagsToAdd.forEach(tag => existingTagsSet.add(tag));

      // Remove tags that are explicitly marked for removal
      const tagsToRemove = tagResult.toRemove || [];
      tagsToRemove.forEach(tag => existingTagsSet.delete(tag));

      // Convert back to array and stringify for storage
      const mergedTags = Array.from(existingTagsSet);
      const newTags = JSON.stringify(mergedTags);

      if (this.options.verbose) {
        console.log('Tag changes:', {
          currentTags,
          recommended: tagResult.recommended,
          toAdd: tagResult.toAdd,
          toRemove: tagResult.toRemove,
          finalTags: mergedTags
        });
      }

      // Prepare analytics data for custom_fields
      let analyticsData = {};
      if (metrics) {
        analyticsData = {
          // Bottleneck detection
          last_response_stage: this.detectResponseStage(metrics),
          response_drop_point: this.detectDropPoint(metrics),
          consecutive_no_reply: metrics.consecutiveOutboundMessages,

          // Engagement metrics
          avg_response_time_seconds: metrics.averageResponseTime,
          message_exchange_rate: metrics.messageExchangeRate,
          days_since_last_message: metrics.daysSinceLastMessage,

          // Follow-up tracking
          followup_template_id: metrics.followupTemplateId || null,
          followup_progress: metrics.followupProgress || null,
          followup_responded: metrics.hasFollowupResponse || false,

          // Reactivation eligibility
          reactivation_eligible: this.isReactivationEligible(metrics),
          reactivation_priority: this.calculateReactivationPriority(metrics),

          // Last analysis timestamp
          last_analyzed_at: new Date().toISOString()
        };
      }

      // Get existing custom_fields and merge with analytics
      const existingResult = await client.query(
        'SELECT custom_fields FROM contacts WHERE contact_id = $1 AND company_id = $2',
        [contactId, this.companyId]
      );

      const existingCustomFields = existingResult.rows[0]?.custom_fields || {};
      const updatedCustomFields = {
        ...existingCustomFields,
        analytics: analyticsData
      };

      await client.query(
        'UPDATE contacts SET tags = $1::jsonb, custom_fields = $2::jsonb, last_updated = NOW() WHERE contact_id = $3 AND company_id = $4',
        [newTags, JSON.stringify(updatedCustomFields), contactId, this.companyId]
      );

      // Record tag additions in history
      for (const tag of tagResult.toAdd) {
        await client.query(
          `INSERT INTO contact_tag_history (company_id, contact_id, tag, action, method, reason, metadata)
           VALUES ($1, $2, $3, 'added', 'auto', 'Rule-based classification', NULL)`,
          [this.companyId, contactId, tag]
        );
      }

      // Record tag removals in history
      for (const tag of tagResult.toRemove) {
        await client.query(
          `INSERT INTO contact_tag_history (company_id, contact_id, tag, action, method, reason, metadata)
           VALUES ($1, $2, $3, 'removed', 'auto', 'No longer meets criteria', NULL)`,
          [this.companyId, contactId, tag]
        );
      }

      await client.query('COMMIT');

      if (this.options.verbose) {
        console.log(`✓ Tags updated for ${contactId}`);
      }

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Detect which stage the lead stopped responding
   */
  detectResponseStage(metrics) {
    if (metrics.totalMessages === 0) return 'never_contacted';
    if (metrics.inboundMessages === 0) return 'never_replied';
    if (metrics.consecutiveOutboundMessages >= 3) return 'stopped_replying';
    if (metrics.daysSinceLastMessage > 30) return 'went_dormant';
    if (metrics.lastMessageFromMe) return 'awaiting_reply';
    return 'active';
  }

  /**
   * Detect the exact drop-off point in conversation
   * Captures the last unanswered messages to understand what led to drop-off
   */
  detectDropPoint(metrics) {
    const stage = this.detectResponseStage(metrics);

    // Get unanswered messages from metrics (extracted during analysis)
    const unansweredMessages = metrics.unansweredMessages || [];

    if (stage === 'never_contacted') {
      return {
        stage: 'never_contacted',
        last_message_days_ago: metrics.daysSinceLastMessage,
        total_messages: metrics.totalMessages,
        unanswered_messages: []
      };
    }

    if (stage === 'never_replied') {
      return {
        stage: 'initial_outreach',
        messages_sent: metrics.outboundMessages,
        last_message_days_ago: metrics.daysSinceLastMessage,
        unanswered_messages: unansweredMessages
      };
    }

    if (stage === 'awaiting_reply') {
      return {
        stage: 'awaiting_reply',
        unanswered_count: metrics.consecutiveOutboundMessages,
        last_message_days_ago: metrics.daysSinceLastMessage,
        recent_outbound: metrics.lastMessageFromMe === true,
        unanswered_messages: unansweredMessages
      };
    }

    if (stage === 'stopped_replying') {
      return {
        stage: 'mid_conversation',
        unanswered_count: metrics.consecutiveOutboundMessages,
        last_message_days_ago: metrics.daysSinceLastMessage,
        had_engagement: metrics.messageExchangeRate > 0.2,
        unanswered_messages: unansweredMessages
      };
    }

    if (stage === 'went_dormant') {
      return {
        stage: 'dormant',
        last_engagement_days_ago: metrics.daysSinceLastMessage,
        total_exchanges: metrics.totalMessages,
        unanswered_messages: unansweredMessages
      };
    }

    if (stage === 'active') {
      return {
        stage: 'active_engagement',
        last_message_days_ago: metrics.daysSinceLastMessage,
        total_messages: metrics.totalMessages,
        message_exchange_rate: metrics.messageExchangeRate,
        unanswered_messages: []
      };
    }

    return null;
  }

  /**
   * Check if contact is eligible for reactivation
   */
  isReactivationEligible(metrics) {
    // Criteria for reactivation:
    // 1. Had previous engagement (replied at least once)
    // 2. Not currently active
    // 3. Between 7-90 days since last message
    // 4. No active follow-up running
    // 5. Not marked as not-interested or spam

    return (
      metrics.inboundMessages >= 1 &&
      metrics.daysSinceLastMessage >= 7 &&
      metrics.daysSinceLastMessage <= 90 &&
      !metrics.hasActiveFollowup &&
      !metrics.hasRejectionKeywords
    );
  }

  /**
   * Calculate reactivation priority (1-10, higher = more priority)
   */
  calculateReactivationPriority(metrics) {
    if (!this.isReactivationEligible(metrics)) return 0;

    let priority = 5; // Base priority

    // Higher priority for previously engaged leads
    if (metrics.messageExchangeRate > 0.3) priority += 2;
    else if (metrics.messageExchangeRate > 0.2) priority += 1;

    // Higher priority for recent dormancy (7-30 days)
    if (metrics.daysSinceLastMessage >= 7 && metrics.daysSinceLastMessage <= 30) {
      priority += 2;
    } else if (metrics.daysSinceLastMessage > 60) {
      priority -= 1; // Lower priority for very old leads
    }

    // Higher priority if they showed interest
    if (metrics.hasInterestKeywords) priority += 1;

    // Higher priority for quick responders
    if (metrics.averageResponseTime && metrics.averageResponseTime < 3600) {
      priority += 1;
    }

    return Math.min(10, Math.max(1, priority));
  }

  /**
   * Helper delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  ContactTagger,
  MessageAnalyzer,
  TagClassifier
};
