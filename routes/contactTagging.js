// =====================================================
// Contact Tagging API Routes
// REST API endpoints for the contact tagging system
// =====================================================

const express = require('express');
const router = express.Router();
const { ContactTagger } = require('../contactTagger');
const sqlDb = require('../db');
const { DEFAULT_TAGS, TAG_CATEGORIES } = require('../tagConfig');

// =====================================================
// POST /api/tags/contact/:contactId
// Tag a single contact
// =====================================================
router.post('/contact/:contactId', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { companyId, dryRun = false, verbose = false } = req.body;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'companyId is required'
      });
    }

    const tagger = new ContactTagger(companyId, {
      dryRun,
      verbose,
      aiEnabled: true
    });

    const result = await tagger.tagContact(contactId);

    if (result.success) {
      return res.json({
        success: true,
        data: {
          contactId: result.contactId,
          currentTags: result.tags.current,
          recommendedTags: result.tags.recommended,
          tagsAdded: result.tags.toAdd,
          tagsRemoved: result.tags.toRemove,
          metrics: result.metrics,
          dryRun: result.dryRun
        }
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Error in POST /api/tags/contact:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// POST /api/tags/batch
// Tag multiple contacts in batch
// =====================================================
router.post('/batch', async (req, res) => {
  try {
    const { companyId, limit = null, dryRun = false } = req.body;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'companyId is required'
      });
    }

    const tagger = new ContactTagger(companyId, {
      dryRun,
      verbose: false,
      aiEnabled: true
    });

    // Start async processing
    const result = await tagger.tagAllContacts(limit);

    return res.json({
      success: true,
      data: {
        total: result.total,
        successCount: result.success,
        failedCount: result.failed,
        dryRun
      }
    });

  } catch (error) {
    console.error('Error in POST /api/tags/batch:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// GET /api/tags/contact/:contactId
// Get current tags for a contact
// =====================================================
router.get('/contact/:contactId', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'companyId is required'
      });
    }

    const query = 'SELECT contact_id, phone, name, tags, last_updated FROM contacts WHERE contact_id = $1 AND company_id = $2';
    const result = await sqlDb.query(query, [contactId, companyId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
    }

    const contact = result.rows[0];
    // tags column is JSONB array type (pg driver auto-parses to JS array)
    const tags = Array.isArray(contact.tags) ? contact.tags : [];

    return res.json({
      success: true,
      data: {
        contactId: contact.contact_id,
        phone: contact.phone,
        name: contact.name,
        tags,
        lastUpdated: contact.last_updated
      }
    });

  } catch (error) {
    console.error('Error in GET /api/tags/contact:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// PUT /api/tags/contact/:contactId
// Manually update tags for a contact
// =====================================================
router.put('/contact/:contactId', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { companyId, tags, action = 'set' } = req.body;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'companyId is required'
      });
    }

    if (!tags || !Array.isArray(tags)) {
      return res.status(400).json({
        success: false,
        error: 'tags must be an array'
      });
    }

    const client = await sqlDb.pool.connect();

    try {
      await client.query('BEGIN');

      // Get current tags
      const contactResult = await client.query(
        'SELECT tags FROM contacts WHERE contact_id = $1 AND company_id = $2',
        [contactId, companyId]
      );

      if (contactResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Contact not found'
        });
      }

      // tags column is JSONB array type (pg driver auto-parses to JS array)
      const currentTags = Array.isArray(contactResult.rows[0].tags)
        ? contactResult.rows[0].tags
        : [];

      let newTags = [];
      let addedTags = [];
      let removedTags = [];

      if (action === 'set') {
        // Replace all tags
        newTags = tags;
        addedTags = tags.filter(t => !currentTags.includes(t));
        removedTags = currentTags.filter(t => !tags.includes(t));

      } else if (action === 'add') {
        // Add tags
        newTags = [...new Set([...currentTags, ...tags])];
        addedTags = tags.filter(t => !currentTags.includes(t));

      } else if (action === 'remove') {
        // Remove tags
        newTags = currentTags.filter(t => !tags.includes(t));
        removedTags = tags.filter(t => currentTags.includes(t));

      } else {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Invalid action. Must be "set", "add", or "remove"'
        });
      }

      // Update contact (tags is JSONB array type)
      await client.query(
        'UPDATE contacts SET tags = $1::jsonb, last_updated = NOW() WHERE contact_id = $2 AND company_id = $3',
        [JSON.stringify(newTags), contactId, companyId]
      );

      // Record additions in history
      for (const tag of addedTags) {
        await client.query(
          `INSERT INTO contact_tag_history (company_id, contact_id, tag, action, method, reason, metadata)
           VALUES ($1, $2, $3, 'added', 'manual', 'Manual update via API', NULL)`,
          [companyId, contactId, tag]
        );
      }

      // Record removals in history
      for (const tag of removedTags) {
        await client.query(
          `INSERT INTO contact_tag_history (company_id, contact_id, tag, action, method, reason, metadata)
           VALUES ($1, $2, $3, 'removed', 'manual', 'Manual update via API', NULL)`,
          [companyId, contactId, tag]
        );
      }

      await client.query('COMMIT');

      return res.json({
        success: true,
        data: {
          contactId,
          previousTags: currentTags,
          currentTags: newTags,
          tagsAdded: addedTags,
          tagsRemoved: removedTags
        }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error in PUT /api/tags/contact:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// GET /api/tags/analytics
// Get tagging analytics for a company
// =====================================================
router.get('/analytics', async (req, res) => {
  try {
    const { companyId, days = 7 } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'companyId is required'
      });
    }

    // Get total contacts
    const totalResult = await sqlDb.query(
      'SELECT COUNT(*) as count FROM contacts WHERE company_id = $1',
      [companyId]
    );
    const totalContacts = parseInt(totalResult.rows[0].count);

    // Get tagged contacts
    const taggedResult = await sqlDb.query(
      'SELECT COUNT(*) as count FROM contacts WHERE company_id = $1 AND tags IS NOT NULL AND tags != \'\'',
      [companyId]
    );
    const taggedContacts = parseInt(taggedResult.rows[0].count);

    // Get tag distribution
    const distributionQuery = `
      SELECT
        unnest(string_to_array(tags, ',')) as tag,
        COUNT(*) as count
      FROM contacts
      WHERE company_id = $1 AND tags IS NOT NULL AND tags != ''
      GROUP BY tag
      ORDER BY count DESC
    `;
    const distributionResult = await sqlDb.query(distributionQuery, [companyId]);

    // Get recent activity
    const activityQuery = `
      SELECT tag, action, COUNT(*) as count, MAX(created_at) as last_used
      FROM contact_tag_history
      WHERE company_id = $1 AND created_at > NOW() - INTERVAL '${days} days'
      GROUP BY tag, action
      ORDER BY count DESC
    `;
    const activityResult = await sqlDb.query(activityQuery, [companyId]);

    // Get top tags
    const topTags = distributionResult.rows.slice(0, 10).map(row => ({
      tag: row.tag,
      count: parseInt(row.count),
      percentage: ((parseInt(row.count) / totalContacts) * 100).toFixed(1)
    }));

    return res.json({
      success: true,
      data: {
        totalContacts,
        taggedContacts,
        untaggedContacts: totalContacts - taggedContacts,
        taggedPercentage: ((taggedContacts / totalContacts) * 100).toFixed(1),
        topTags,
        recentActivity: activityResult.rows.map(row => ({
          tag: row.tag,
          action: row.action,
          count: parseInt(row.count),
          lastUsed: row.last_used
        })),
        distributionByCategory: this.groupByCategory(distributionResult.rows)
      }
    });

  } catch (error) {
    console.error('Error in GET /api/tags/analytics:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// GET /api/tags/definitions
// Get all available tag definitions
// =====================================================
router.get('/definitions', async (req, res) => {
  try {
    const tags = Object.entries(DEFAULT_TAGS).map(([tagName, config]) => ({
      name: tagName,
      category: config.category,
      description: config.description,
      color: config.color,
      priority: config.priority
    }));

    // Group by category
    const grouped = {};
    for (const tag of tags) {
      if (!grouped[tag.category]) {
        grouped[tag.category] = [];
      }
      grouped[tag.category].push(tag);
    }

    return res.json({
      success: true,
      data: {
        tags,
        categories: TAG_CATEGORIES,
        grouped
      }
    });

  } catch (error) {
    console.error('Error in GET /api/tags/definitions:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// GET /api/tags/history/:contactId
// Get tag history for a contact
// =====================================================
router.get('/history/:contactId', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { companyId, limit = 50 } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'companyId is required'
      });
    }

    const query = `
      SELECT tag, action, method, reason, confidence, created_at
      FROM contact_tag_history
      WHERE contact_id = $1 AND company_id = $2
      ORDER BY created_at DESC
      LIMIT $3
    `;

    const result = await sqlDb.query(query, [contactId, companyId, limit]);

    return res.json({
      success: true,
      data: {
        contactId,
        history: result.rows.map(row => ({
          tag: row.tag,
          action: row.action,
          method: row.method,
          reason: row.reason,
          confidence: row.confidence,
          timestamp: row.created_at
        }))
      }
    });

  } catch (error) {
    console.error('Error in GET /api/tags/history:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// GET /api/tags/search
// Search contacts by tags
// =====================================================
router.get('/search', async (req, res) => {
  try {
    const { companyId, tags, matchAll = false, limit = 100 } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'companyId is required'
      });
    }

    if (!tags) {
      return res.status(400).json({
        success: false,
        error: 'tags parameter is required'
      });
    }

    const tagArray = Array.isArray(tags) ? tags : tags.split(',');

    let query;
    let params;

    if (matchAll === 'true' || matchAll === true) {
      // Match all tags (AND) - JSONB array must contain all specified tags
      query = `
        SELECT contact_id, phone, name, tags, last_updated
        FROM contacts
        WHERE company_id = $1 AND tags @> $2::jsonb
        ORDER BY last_updated DESC
        LIMIT $3
      `;
      params = [companyId, JSON.stringify(tagArray), limit];
    } else {
      // Match any tag (OR) - JSONB array overlaps with specified tags
      // Use jsonb_array_elements_text to check if any element matches
      query = `
        SELECT DISTINCT contact_id, phone, name, tags, last_updated
        FROM contacts, jsonb_array_elements_text(tags) as tag
        WHERE company_id = $1 AND tag = ANY($2::text[])
        ORDER BY last_updated DESC
        LIMIT $3
      `;
      params = [companyId, tagArray, limit];
    }

    const result = await sqlDb.query(query, params);

    return res.json({
      success: true,
      data: {
        count: result.rows.length,
        contacts: result.rows.map(row => ({
          contactId: row.contact_id,
          phone: row.phone,
          name: row.name,
          tags: Array.isArray(row.tags) ? row.tags : [],
          lastUpdated: row.last_updated
        }))
      }
    });

  } catch (error) {
    console.error('Error in GET /api/tags/search:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// Helper Functions
// =====================================================

function groupByCategory(rows) {
  const categories = {};

  for (const row of rows) {
    const tagName = row.tag;
    const tagConfig = DEFAULT_TAGS[tagName];

    if (tagConfig) {
      const category = tagConfig.category;
      if (!categories[category]) {
        categories[category] = {
          name: category,
          tags: [],
          totalCount: 0
        };
      }

      categories[category].tags.push({
        tag: tagName,
        count: parseInt(row.count)
      });
      categories[category].totalCount += parseInt(row.count);
    }
  }

  return Object.values(categories);
}

module.exports = router;
