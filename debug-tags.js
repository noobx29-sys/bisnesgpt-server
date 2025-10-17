#!/usr/bin/env node

// Debug tag accuracy for a specific contact
require('dotenv').config();
const { ContactTagger, MessageAnalyzer, TagClassifier } = require('./contactTagger');
const sqlDb = require('./db');
const { DEFAULT_TAGS } = require('./tagConfig');

async function debugContact(companyId, contactId) {
  console.log('\n' + '='.repeat(70));
  console.log('CONTACT TAG DEBUGGING');
  console.log('='.repeat(70));

  try {
    const tagger = new ContactTagger(companyId, { verbose: false });

    // Get contact
    const contact = await tagger.getContact(contactId);
    console.log('\n📋 CONTACT INFO:');
    console.log('  ID:', contactId);
    console.log('  Phone:', contact.phone);
    console.log('  Name:', contact.name);
    console.log('  Current Tags:', contact.tags || '(none)');

    // Get messages
    const messages = await tagger.getMessages(contactId);
    console.log('\n💬 MESSAGES:');
    console.log('  Total Messages:', messages.length);

    if (messages.length > 0) {
      console.log('\n  Recent Messages (last 5):');
      messages.slice(0, 5).forEach((msg, i) => {
        const date = new Date(msg.timestamp * 1000);
        const preview = msg.content?.substring(0, 50) || '(no content)';
        console.log(`    ${i + 1}. [${msg.from_me ? 'YOU' : 'THEM'}] ${date.toLocaleDateString()} - ${preview}...`);
      });
    }

    // Analyze
    const analyzer = new MessageAnalyzer(messages, contactId, companyId);
    const metrics = await analyzer.analyze();

    console.log('\n📊 CALCULATED METRICS:');
    console.log('  Total Messages:', metrics.totalMessages);
    console.log('  Inbound (from contact):', metrics.inboundMessages);
    console.log('  Outbound (from you):', metrics.outboundMessages);
    console.log('  Days Since Last Message:', metrics.daysSinceLastMessage);
    console.log('  Days Since First Contact:', metrics.daysSinceFirstContact);
    console.log('  Last Message From:', metrics.lastMessageFromMe ? 'YOU' : 'THEM');

    if (metrics.averageResponseTime !== null) {
      const hours = (metrics.averageResponseTime / 3600).toFixed(1);
      console.log('  Avg Response Time:', `${hours} hours`);
    }

    console.log('  Message Exchange Rate:', (metrics.messageExchangeRate * 100).toFixed(1) + '%');
    console.log('  Recent Exchange:', metrics.hasRecentExchange ? 'Yes' : 'No');
    console.log('  Consecutive Outbound:', metrics.consecutiveOutboundMessages);

    console.log('\n🔍 CONTENT ANALYSIS:');
    console.log('  Contains Questions:', metrics.containsQuestionMarks || metrics.hasQuestionWords);
    console.log('  Has Closing Phrases:', metrics.hasClosingPhrases);
    console.log('  Has Interest Keywords:', metrics.hasInterestKeywords);
    console.log('  Has Rejection Keywords:', metrics.hasRejectionKeywords);
    console.log('  Has Urgent Keywords:', metrics.hasUrgentKeywords);

    if (metrics.behaviorAnalyzed) {
      console.log('\n⏰ BEHAVIORAL PATTERNS:');
      console.log('  Night Messages:', (metrics.nightMessagePercentage * 100).toFixed(1) + '%');
      console.log('  Business Hours:', (metrics.businessHourPercentage * 100).toFixed(1) + '%');
      console.log('  Weekend Messages:', (metrics.weekendMessagePercentage * 100).toFixed(1) + '%');
    }

    if (metrics.aiSentiment) {
      console.log('\n🤖 AI ANALYSIS:');
      console.log('  Sentiment:', metrics.aiSentiment);
      console.log('  Intent:', metrics.aiIntent);
      console.log('  Stage:', metrics.aiStage);
    }

    if (metrics.followupTemplateId) {
      console.log('\n📨 FOLLOW-UP STATUS:');
      console.log('  Template ID:', metrics.followupTemplateId);
      console.log('  Progress:', metrics.followupProgress);
      console.log('  Active:', metrics.hasActiveFollowup ? 'Yes' : 'No');
      console.log('  Completed:', metrics.hasCompletedFollowup ? 'Yes' : 'No');
      console.log('  Responded:', metrics.hasFollowupResponse ? 'Yes' : 'No');
    }

    // Classify tags
    const classifier = new TagClassifier(metrics, contact.tags);
    const tagResult = classifier.classify();

    console.log('\n🏷️  TAG CLASSIFICATION:');
    console.log('  Current Tags:', tagResult.current.length > 0 ? tagResult.current.join(', ') : '(none)');
    console.log('  Recommended Tags:', tagResult.recommended.join(', '));
    console.log('  Tags to Add:', tagResult.toAdd.length > 0 ? tagResult.toAdd.join(', ') : '(none)');

    console.log('\n🔬 TAG RULES EVALUATION:');
    for (const tag of tagResult.recommended) {
      if (DEFAULT_TAGS[tag]) {
        const config = DEFAULT_TAGS[tag];
        console.log(`\n  ✓ ${tag} (${config.category})`);
        console.log(`    Description: ${config.description}`);
        console.log(`    Priority: ${config.priority}`);

        if (config.rules && !config.rules.manual) {
          console.log('    Rules matched:');
          for (const [ruleKey, ruleValue] of Object.entries(config.rules)) {
            const metricValue = metrics[ruleKey];
            let matched = true;
            let display = '';

            if (typeof ruleValue === 'object' && ruleValue !== null) {
              if ('min' in ruleValue) display += `>= ${ruleValue.min}`;
              if ('max' in ruleValue) display += (display ? ' and ' : '') + `<= ${ruleValue.max}`;
            } else {
              display = `= ${ruleValue}`;
            }

            console.log(`      ${ruleKey}: ${metricValue} ${display}`);
          }
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ Debug complete!');
    console.log('='.repeat(70) + '\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

// Get command line args
const companyId = process.argv[2];
const contactId = process.argv[3];

if (!companyId || !contactId) {
  console.log('Usage: node debug-tags.js <companyId> <contactId>');
  console.log('Example: node debug-tags.js 0210 0210-60123456789');
  process.exit(1);
}

debugContact(companyId, contactId);
