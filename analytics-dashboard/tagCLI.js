#!/usr/bin/env node

// =====================================================
// Contact Tagger CLI Tool
// Easy command-line interface for testing the tagging system
// =====================================================

require('dotenv').config();
const { ContactTagger } = require('./contactTagger');
const sqlDb = require('../db');

// ANSI colors for pretty output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

// =====================================================
// CLI Functions
// =====================================================

async function showHelp() {
  console.log(`
${colors.bright}${colors.cyan}Contact Tagger CLI${colors.reset}
${colors.yellow}${'='.repeat(60)}${colors.reset}

${colors.bright}Usage:${colors.reset}
  node tagCLI.js <command> [options]

${colors.bright}Commands:${colors.reset}
  ${colors.green}tag-one${colors.reset} <companyId> <contactId>
    Tag a single contact
    Example: node tagCLI.js tag-one abc-123 +60123456789

  ${colors.green}tag-all${colors.reset} <companyId> [limit]
    Tag all contacts for a company
    Example: node tagCLI.js tag-all abc-123
    Example: node tagCLI.js tag-all abc-123 50

  ${colors.green}test${colors.reset} <companyId> <contactId>
    Test tagging without saving (dry run)
    Example: node tagCLI.js test abc-123 +60123456789

  ${colors.green}stats${colors.reset} <companyId>
    Show tagging statistics for a company
    Example: node tagCLI.js stats abc-123

  ${colors.green}list-tags${colors.reset}
    List all available tags and their descriptions

  ${colors.green}help${colors.reset}
    Show this help message

${colors.bright}Options:${colors.reset}
  --verbose, -v    Show detailed output
  --no-ai          Disable AI analysis (faster, cheaper)
  --dry-run        Don't save changes, only show what would happen

${colors.bright}Examples:${colors.reset}
  # Tag one contact with verbose output
  node tagCLI.js tag-one abc-123 +60123456789 --verbose

  # Test tagging without AI
  node tagCLI.js test abc-123 +60123456789 --no-ai

  # Tag all contacts (max 100) without saving
  node tagCLI.js tag-all abc-123 100 --dry-run

${colors.yellow}${'='.repeat(60)}${colors.reset}
`);
}

async function listTags() {
  const { DEFAULT_TAGS } = require('./tagConfig');

  console.log(`\n${colors.bright}${colors.cyan}Available Tags${colors.reset}`);
  console.log(colors.yellow + '='.repeat(60) + colors.reset);

  const categories = {
    status: [],
    engagement: [],
    behavioral: [],
    action: []
  };

  for (const [tagName, tagConfig] of Object.entries(DEFAULT_TAGS)) {
    categories[tagConfig.category].push({ tagName, tagConfig });
  }

  for (const [category, tags] of Object.entries(categories)) {
    console.log(`\n${colors.bright}${colors.magenta}${category.toUpperCase()}${colors.reset}`);
    for (const { tagName, tagConfig } of tags) {
      console.log(`  ${colors.green}${tagName}${colors.reset}`);
      console.log(`    ${colors.white}${tagConfig.description}${colors.reset}`);
      console.log(`    Priority: ${tagConfig.priority}, Color: ${tagConfig.color}`);
    }
  }

  console.log('\n' + colors.yellow + '='.repeat(60) + colors.reset + '\n');
}

async function tagOne(companyId, contactId, options) {
  console.log(`\n${colors.cyan}Tagging contact: ${contactId}${colors.reset}`);
  console.log(`Company: ${companyId}\n`);

  const tagger = new ContactTagger(companyId, {
    verbose: options.verbose,
    aiEnabled: options.aiEnabled,
    dryRun: options.dryRun
  });

  const startTime = Date.now();
  const result = await tagger.tagContact(contactId);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  if (result.success) {
    console.log(`\n${colors.green}✓ Success!${colors.reset} (${duration}s)\n`);

    console.log(`${colors.bright}Current Tags:${colors.reset}`);
    console.log(`  ${result.tags.current.join(', ') || '(none)'}`);

    console.log(`\n${colors.bright}Recommended Tags:${colors.reset}`);
    console.log(`  ${result.tags.recommended.join(', ') || '(none)'}`);

    if (result.tags.toAdd.length > 0) {
      console.log(`\n${colors.green}Tags Added:${colors.reset}`);
      console.log(`  ${result.tags.toAdd.join(', ')}`);
    }

    if (result.tags.toRemove.length > 0) {
      console.log(`\n${colors.red}Tags Removed:${colors.reset}`);
      console.log(`  ${result.tags.toRemove.join(', ')}`);
    }

    if (result.dryRun) {
      console.log(`\n${colors.yellow}⚠ DRY RUN - No changes were saved${colors.reset}`);
    }

    // Only show metrics if not a group
    if (result.metrics) {
      console.log(`\n${colors.bright}Key Metrics:${colors.reset}`);
      console.log(`  Total Messages: ${result.metrics.totalMessages}`);
      console.log(`  Days Since Last Message: ${result.metrics.daysSinceLastMessage}`);
      console.log(`  Last Message From: ${result.metrics.lastMessageFromMe ? 'You' : 'Contact'}`);

      if (result.metrics.aiSentiment) {
        console.log(`  AI Sentiment: ${result.metrics.aiSentiment}`);
      }
      if (result.metrics.aiIntent) {
        console.log(`  AI Intent: ${result.metrics.aiIntent}`);
      }
      if (result.metrics.aiStage) {
        console.log(`  AI Stage: ${result.metrics.aiStage}`);
      }
    } else if (result.isGroup) {
      console.log(`\n${colors.yellow}👥 This is a group chat - no metrics analyzed${colors.reset}`);
    }

  } else {
    console.log(`\n${colors.red}✗ Error:${colors.reset} ${result.error}\n`);
  }
}

async function tagAll(companyId, limit, options) {
  console.log(`\n${colors.cyan}Tagging all contacts for company: ${companyId}${colors.reset}`);
  if (limit) {
    console.log(`Limit: ${limit} contacts`);
  }
  console.log('');

  const tagger = new ContactTagger(companyId, {
    verbose: options.verbose,
    aiEnabled: options.aiEnabled,
    dryRun: options.dryRun
  });

  const startTime = Date.now();
  const result = await tagger.tagAllContacts(limit);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n${colors.green}✓ Batch Processing Complete!${colors.reset} (${duration}s)\n`);
  console.log(`Total Contacts: ${result.total}`);
  console.log(`${colors.green}Success: ${result.success}${colors.reset}`);
  console.log(`${colors.red}Failed: ${result.failed}${colors.reset}`);

  if (options.dryRun) {
    console.log(`\n${colors.yellow}⚠ DRY RUN - No changes were saved${colors.reset}`);
  }

  // Show summary of tags applied
  const tagCounts = {};
  for (const r of result.results) {
    if (r.success && r.tags) {
      for (const tag of r.tags.toAdd) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
  }

  if (Object.keys(tagCounts).length > 0) {
    console.log(`\n${colors.bright}Tags Applied:${colors.reset}`);
    const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
    for (const [tag, count] of sortedTags) {
      console.log(`  ${colors.green}${tag}${colors.reset}: ${count} contacts`);
    }
  }

  console.log('');
}

async function showStats(companyId) {
  console.log(`\n${colors.cyan}Tagging Statistics for Company: ${companyId}${colors.reset}`);
  console.log(colors.yellow + '='.repeat(60) + colors.reset + '\n');

  try {
    // Get total contacts
    const totalResult = await sqlDb.query(
      'SELECT COUNT(*) as count FROM contacts WHERE company_id = $1',
      [companyId]
    );
    const totalContacts = parseInt(totalResult.rows[0].count);

    console.log(`${colors.bright}Total Contacts:${colors.reset} ${totalContacts}`);

    // Get tag distribution
    const tagDistQuery = `
      SELECT
        unnest(string_to_array(tags, ',')) as tag,
        COUNT(*) as count
      FROM contacts
      WHERE company_id = $1 AND tags IS NOT NULL AND tags != ''
      GROUP BY tag
      ORDER BY count DESC
    `;

    const tagDistResult = await sqlDb.query(tagDistQuery, [companyId]);

    if (tagDistResult.rows.length > 0) {
      console.log(`\n${colors.bright}Tag Distribution:${colors.reset}`);
      for (const row of tagDistResult.rows) {
        const percentage = ((row.count / totalContacts) * 100).toFixed(1);
        const bar = '█'.repeat(Math.floor(row.count / totalContacts * 50));
        console.log(`  ${colors.green}${row.tag.padEnd(20)}${colors.reset} ${row.count.toString().padStart(5)} (${percentage}%) ${bar}`);
      }
    }

    // Get recent tag history
    const historyQuery = `
      SELECT tag, action, COUNT(*) as count
      FROM contact_tag_history
      WHERE company_id = $1 AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY tag, action
      ORDER BY count DESC
      LIMIT 10
    `;

    const historyResult = await sqlDb.query(historyQuery, [companyId]);

    if (historyResult.rows.length > 0) {
      console.log(`\n${colors.bright}Recent Tag Activity (Last 7 days):${colors.reset}`);
      for (const row of historyResult.rows) {
        const color = row.action === 'added' ? colors.green : colors.red;
        console.log(`  ${color}${row.action.padEnd(8)}${colors.reset} ${row.tag.padEnd(20)} ${row.count} times`);
      }
    }

    console.log('\n' + colors.yellow + '='.repeat(60) + colors.reset + '\n');

  } catch (error) {
    console.error(`${colors.red}Error fetching stats:${colors.reset}`, error.message);
  }
}

// =====================================================
// Main CLI Handler
// =====================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help') {
    await showHelp();
    process.exit(0);
  }

  // Parse options
  const options = {
    verbose: args.includes('--verbose') || args.includes('-v'),
    aiEnabled: !args.includes('--no-ai'),
    dryRun: args.includes('--dry-run')
  };

  // Remove option flags from args
  const cleanArgs = args.filter(arg => !arg.startsWith('--') && !arg.startsWith('-'));

  const command = cleanArgs[0];

  try {
    switch (command) {
      case 'list-tags':
        await listTags();
        break;

      case 'tag-one':
        if (cleanArgs.length < 3) {
          console.error(`${colors.red}Error: Missing arguments${colors.reset}`);
          console.log('Usage: node tagCLI.js tag-one <companyId> <contactId>');
          process.exit(1);
        }
        await tagOne(cleanArgs[1], cleanArgs[2], options);
        break;

      case 'tag-all':
        if (cleanArgs.length < 2) {
          console.error(`${colors.red}Error: Missing company ID${colors.reset}`);
          console.log('Usage: node tagCLI.js tag-all <companyId> [limit]');
          process.exit(1);
        }
        const limit = cleanArgs[2] ? parseInt(cleanArgs[2]) : null;
        await tagAll(cleanArgs[1], limit, options);
        break;

      case 'test':
        if (cleanArgs.length < 3) {
          console.error(`${colors.red}Error: Missing arguments${colors.reset}`);
          console.log('Usage: node tagCLI.js test <companyId> <contactId>');
          process.exit(1);
        }
        options.dryRun = true;
        options.verbose = true;
        await tagOne(cleanArgs[1], cleanArgs[2], options);
        break;

      case 'stats':
        if (cleanArgs.length < 2) {
          console.error(`${colors.red}Error: Missing company ID${colors.reset}`);
          console.log('Usage: node tagCLI.js stats <companyId>');
          process.exit(1);
        }
        await showStats(cleanArgs[1]);
        break;

      default:
        console.error(`${colors.red}Error: Unknown command '${command}'${colors.reset}`);
        console.log('Run "node tagCLI.js help" for usage information');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error(`\n${colors.red}Fatal Error:${colors.reset}`, error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run CLI
if (require.main === module) {
  main();
}

module.exports = { main };
