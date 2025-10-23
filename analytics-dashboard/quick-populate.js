// =====================================================
// Quick Populate - Run analytics for a specific company
// Usage: node quick-populate.js YOUR_COMPANY_ID
// =====================================================

require('dotenv').config();
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});
const { ContactTagger } = require('./contactTagger');
const OpenAI = require('openai');
const fs = require('fs').promises;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const companyId = process.argv[2];

if (!companyId) {
  console.log('\n❌ Error: Please provide a company ID');
  console.log('\nUsage:');
  console.log('  node quick-populate.js YOUR_COMPANY_ID');
  console.log('\nExample:');
  console.log('  node quick-populate.js 0210\n');
  process.exit(1);
}

// Function to prompt for company context
async function getCompanyContext() {
  return new Promise((resolve) => {
    console.log('\n📝 Please provide some context about this company to help with AI analysis:');
    console.log('(e.g., Industry, product/service, target audience, or any specific criteria for tagging)');
    console.log('(Press Enter twice to finish or type "skip" to continue without context)\n');

    let context = [];
    
    const promptLine = () => {
      readline.question('> ', (input) => {
        if (input.toLowerCase() === 'skip') {
          readline.close();
          resolve('');
          return;
        }
        
        if (input === '') {
          if (context.length > 0) {
            readline.close();
            resolve(context.join('\n'));
            return;
          }
        } else {
          context.push(input);
        }
        
        promptLine();
      });
    };
    
    promptLine();
  });
}

async function run() {
  console.log('='.repeat(60));
  console.log(`📊 Analyzing Company: ${companyId}`);
  console.log('📅 Processing: All contacts (no date filter)');
  console.log('='.repeat(60));
  
  // Get company context
  const companyContext = await getCompanyContext();
  
  if (companyContext) {
    console.log('\nℹ️  Using company context for analysis...');
  } else {
    console.log('\nℹ️  No company context provided. Using default analysis settings.');
  }

  try {
    const tagger = new ContactTagger(companyId, {
      verbose: true,
      dryRun: false,
      companyContext: companyContext || ''
    });

    const startTime = Date.now();
    // Process all contacts (null means no limit)
    const limit = null; // Set to a number to limit the number of contacts processed
    const results = await tagger.tagAllContacts(limit);
  console.log('\n✅ Contact tagging completed!');
  
  // Generate final report
  await generateFinalReport(results, companyContext);
  
  console.log('\n📊 Final report has been generated and saved to report.txt');
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log('✅ Analysis Complete!');
    console.log('='.repeat(60));
    console.log(`Total: ${results.total}`);
    console.log(`Success: ${results.total - (results.failed || 0)}`);
    console.log(`Failed: ${results.failed || 0}`);
    console.log(`Duration: ${duration}s`);
    console.log('='.repeat(60) + '\n');

    console.log('📊 Next steps:');
    console.log('  1. Start analytics server: node analytics-server.js');
    console.log('  2. Open dashboard: http://localhost:3005');
    console.log(`  3. Select company "${companyId}" and view analytics\n`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Generate a final report using GPT-4o-mini
 */
async function generateFinalReport(results, companyContext) {
  try {
    console.log('\n📊 Generating final report...');
    
    // Extract key metrics
    const metrics = {
      totalContacts: results.total || 0,
      taggedContacts: results.updated || 0,
      failedContacts: results.failed || 0,
      commonTags: {},
      aiInsights: {
        sentiment: {},
        intent: {},
        stage: {}
      }
    };

    // Count tag frequencies
    if (Array.isArray(results.contacts)) {
      results.contacts.forEach(contact => {
        if (contact.tags) {
          contact.tags.forEach(tag => {
            metrics.commonTags[tag] = (metrics.commonTags[tag] || 0) + 1;
          });
        }

        // Count AI analysis results
        if (contact.metrics) {
          ['aiSentiment', 'aiIntent', 'aiStage'].forEach(metric => {
            if (contact.metrics[metric]) {
              const key = metric.replace('ai', '').toLowerCase();
              const value = contact.metrics[metric];
              metrics.aiInsights[key][value] = (metrics.aiInsights[key][value] || 0) + 1;
            }
          });
        }
      });
    }

    // Sort tags by frequency
    const sortedTags = Object.entries(metrics.commonTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // Top 10 most common tags

    // Prepare data for AI analysis
    const reportData = {
      companyContext: companyContext || 'No company context provided',
      metrics: metrics,
      topTags: sortedTags,
      totalProcessed: results.contacts?.length || 0,
      date: new Date().toISOString()
    };

    // Generate AI analysis
    const analysis = await generateAIAnalysis(reportData);
    
    // Format the report
    const report = `# 📊 Contact Analysis Report
## Company: ${companyContext || 'N/A'}
## Date: ${new Date().toLocaleString()}

### 📈 Key Metrics
- Total Contacts: ${metrics.totalContacts}
- Successfully Tagged: ${metrics.taggedContacts}
- Failed to Process: ${metrics.failedContacts}

### 🏷️ Top 10 Most Common Tags
${sortedTags.map(([tag, count]) => `- ${tag}: ${count} contacts`).join('\n')}

### 🤖 AI Insights
#### Sentiment Analysis
${formatAIData(metrics.aiInsights.sentiment)}

#### Conversation Intents
${formatAIData(metrics.aiInsights.intent)}

#### Conversation Stages
${formatAIData(metrics.aiInsights.stage)}

### 📝 AI Analysis
${analysis}
`;

    // Save to file
    await fs.writeFile('report.txt', report);
    return report;

  } catch (error) {
    console.error('Error generating report:', error);
    return 'Error generating report: ' + error.message;
  }
}

/**
 * Generate AI analysis using GPT-4o-mini
 */
async function generateAIAnalysis(data) {
  try {
    const prompt = `Analyze the following contact data and provide insights:

Company Context: ${data.companyContext}

Key Metrics:
- Total Contacts: ${data.metrics.totalContacts}
- Successfully Tagged: ${data.metrics.taggedContacts}
- Failed to Process: ${data.metrics.failedContacts}

Top Tags:
${data.topTags.map(([tag, count]) => `- ${tag}: ${count}`).join('\n')}

AI Analysis Results:
- Sentiment: ${JSON.stringify(data.metrics.aiInsights.sentiment)}
- Intents: ${JSON.stringify(data.metrics.aiInsights.intent)}
- Stages: ${JSON.stringify(data.metrics.aiInsights.stage)}

Provide a detailed analysis including:
1. Overall engagement level of contacts
2. Common conversation patterns
3. Potential areas for improvement
4. Recommendations for follow-up actions
5. Any interesting trends or anomalies

Format the response in clear, well-structured markdown.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: 1000,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful AI assistant that analyzes contact data and provides business insights.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    return completion.choices[0]?.message?.content || 'No analysis available';
  } catch (error) {
    console.error('Error in AI analysis:', error);
    return 'AI analysis could not be generated. ' + error.message;
  }
}

/**
 * Format AI data for display
 */
function formatAIData(data) {
  const total = Object.values(data).reduce((sum, count) => sum + count, 0);
  if (total === 0) return 'No data available';
  
  return Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `- ${key}: ${count} (${((count / total) * 100).toFixed(1)}%)`)
    .join('\n');
}

run();
