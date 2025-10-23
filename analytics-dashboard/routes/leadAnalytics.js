// =====================================================
// Lead Analytics API Routes
// Provides bottleneck analysis, follow-up performance,
// pipeline visualization, and reactivation detection
// =====================================================

const express = require('express');
const router = express.Router();
const sqlDb = require('../db');

// =====================================================
// 1. BOTTLENECK ANALYSIS
// Shows where leads stop responding
// =====================================================

/**
 * GET /api/lead-analytics/:companyId/bottlenecks
 * Returns analysis of where leads drop off in the conversation
 */
router.get('/:companyId/bottlenecks', async (req, res) => {
  try {
    const { companyId } = req.params;
    const timeRange = req.query.timeRange || 120; // Default to 120 days if not specified

    // Use all contacts - no time filter
    const activityFilterClause = `TRUE`;
    // Initialize tag filter as empty (no tag filtering by default)
    const tagFilterClause = '';

    // Get bottleneck distribution
    const bottleneckQuery = `
      SELECT
        custom_fields->'analytics'->>'last_response_stage' as stage,
        COUNT(*) as count,
        ROUND(AVG((custom_fields->'analytics'->>'days_since_last_message')::numeric), 1) as avg_days_dormant,
        ROUND(AVG((custom_fields->'analytics'->>'consecutive_no_reply')::numeric), 1) as avg_unanswered
      FROM contacts
      WHERE company_id = $1
        AND custom_fields->'analytics' IS NOT NULL
        AND custom_fields->'analytics'->>'last_response_stage' IS NOT NULL
        AND ${activityFilterClause}
        ${tagFilterClause}
      GROUP BY custom_fields->'analytics'->>'last_response_stage'
      ORDER BY count DESC
    `;

    const bottlenecks = await sqlDb.query(bottleneckQuery, [companyId]);

    // Get detailed drop-off points with enhanced analytics
    const dropPointQuery = `
      WITH drop_analysis AS (
        SELECT
          custom_fields->'analytics'->'response_drop_point'->>'stage' as drop_stage,
          custom_fields->'analytics'->'response_drop_point'->>'unanswered_count' as unanswered_count,
          contact_id,
          name,
          phone,
          custom_fields->'analytics'->'response_drop_point'->'unanswered_messages' as unanswered_messages,
          (custom_fields->'analytics'->>'days_since_last_message')::numeric as days_dormant,
          (custom_fields->'analytics'->>'message_exchange_rate')::numeric as engagement_rate,
          custom_fields->'analytics'->>'last_response_stage' as response_stage,
          tags
        FROM contacts
        WHERE company_id = $1
          AND custom_fields->'analytics'->'response_drop_point' IS NOT NULL
          AND ${activityFilterClause}
      )
      SELECT
        drop_stage,
        COUNT(*) as contact_count,

        -- Calculate averages for insights
        ROUND(AVG(days_dormant), 1) as avg_days_dormant,
        ROUND(AVG(engagement_rate), 2) as avg_engagement_rate,
        ROUND(AVG(unanswered_count::numeric), 1) as avg_unanswered_count,

        -- Count how many became customers despite dropping off
        COUNT(*) FILTER (WHERE tags ? 'customer') as became_customers,

        -- Get sample contacts with full data (limit to 10 per stage)
        COALESCE(
          json_agg(
            jsonb_build_object(
              'contact_id', contact_id,
              'name', name,
              'phone', phone,
              'unanswered_messages', unanswered_messages,
              'days_dormant', days_dormant,
              'engagement_rate', engagement_rate,
              'is_customer', tags ? 'customer'
            )
            ORDER BY days_dormant DESC
          ) FILTER (WHERE unanswered_messages IS NOT NULL),
          '[]'::json
        ) as sample_contacts
      FROM drop_analysis
      GROUP BY drop_stage
      ORDER BY contact_count DESC
      LIMIT 10
    `;

    const dropPoints = await sqlDb.query(dropPointQuery, [companyId]);

    // Analyze message patterns for drop-offs
    const messagePatternQuery = `
      WITH all_unanswered AS (
        SELECT
          custom_fields->'analytics'->'response_drop_point'->>'stage' as drop_stage,
          jsonb_array_elements(custom_fields->'analytics'->'response_drop_point'->'unanswered_messages') as msg
        FROM contacts
        WHERE company_id = $1
          AND custom_fields->'analytics'->'response_drop_point'->'unanswered_messages' IS NOT NULL
          AND ${activityFilterClause}
      )
      SELECT
        drop_stage,
        COUNT(*) as total_unanswered_messages,
        ROUND(AVG((msg->>'days_ago')::numeric), 1) as avg_days_since_sent,

        -- Analyze message length patterns (filter out empty/null content)
        ROUND(
          AVG(LENGTH(msg->>'content')) FILTER (WHERE msg->>'content' IS NOT NULL AND msg->>'content' != ''),
          0
        ) as avg_message_length,

        -- Get common message samples (filter out empty/null and limit to 5)
        ARRAY_AGG(DISTINCT SUBSTRING(msg->>'content', 1, 150) ORDER BY SUBSTRING(msg->>'content', 1, 150))
          FILTER (WHERE msg->>'content' IS NOT NULL AND msg->>'content' != '' AND LENGTH(msg->>'content') > 5) as message_samples
      FROM all_unanswered
      GROUP BY drop_stage
    `;

    const messagePatterns = await sqlDb.query(messagePatternQuery, [companyId]);

    // Define filter to exclude non-leads and groups
    const leadFilterClause = `
      AND is_group = false
      AND NOT (tags ? 'not_a_lead')
    `;

    // Calculate conversion rates by stage (only actual leads)
    const totalLeads = await sqlDb.query(
      `SELECT COUNT(*) as total FROM contacts
       WHERE company_id = $1
       AND ${activityFilterClause}
       ${leadFilterClause}`,
      [companyId]
    );

    const repliedLeads = await sqlDb.query(
      `SELECT COUNT(*) as total FROM contacts
       WHERE company_id = $1
       AND custom_fields->'analytics'->>'last_response_stage' NOT IN ('never_replied', 'never_contacted')
       AND ${activityFilterClause}
       ${leadFilterClause}`,
      [companyId]
    );

    const activeLeads = await sqlDb.query(
      `SELECT COUNT(*) as total FROM contacts
       WHERE company_id = $1
       AND custom_fields->'analytics'->>'last_response_stage' = 'active'
       AND ${activityFilterClause}
       ${leadFilterClause}`,
      [companyId]
    );

    const customerContacts = await sqlDb.query(
      `SELECT COUNT(*) as total FROM contacts
       WHERE company_id = $1
       AND tags ? 'customer'`,
      [companyId]
    );

    const total = parseInt(totalLeads.rows[0]?.total || 0);
    const replied = parseInt(repliedLeads.rows[0]?.total || 0);
    const active = parseInt(activeLeads.rows[0]?.total || 0);
    const customers = parseInt(customerContacts.rows[0]?.total || 0);

    // Create message pattern lookup
    const patternLookup = {};
    messagePatterns.rows.forEach(row => {
      patternLookup[row.drop_stage] = {
        total_unanswered: parseInt(row.total_unanswered_messages || 0),
        avg_days_since_sent: parseFloat(row.avg_days_since_sent || 0),
        avg_message_length: parseInt(row.avg_message_length || 0),
        message_samples: (row.message_samples || []).filter(s => s && s.trim()).slice(0, 5)
      };
    });

    res.json({
      success: true,
      timeRange: `${timeRange} days`,
      summary: {
        total_leads: total,
        replied_count: replied,
        active_count: active,
        customer_count: customers,
        reply_rate: total > 0 ? ((replied / total) * 100).toFixed(2) + '%' : '0%',
        active_rate: total > 0 ? ((active / total) * 100).toFixed(2) + '%' : '0%',
        customer_rate: total > 0 ? ((customers / total) * 100).toFixed(2) + '%' : '0%'
      },
      bottlenecks: bottlenecks.rows.map(row => ({
        stage: row.stage,
        count: parseInt(row.count),
        percentage: total > 0 ? ((parseInt(row.count) / total) * 100).toFixed(2) + '%' : '0%',
        avg_days_dormant: parseFloat(row.avg_days_dormant || 0),
        avg_unanswered_messages: parseFloat(row.avg_unanswered || 0)
      })),
      drop_points: dropPoints.rows.map(row => {
        const patterns = patternLookup[row.drop_stage] || {};
        const contactCount = parseInt(row.contact_count);
        const becameCustomers = parseInt(row.became_customers || 0);
        const conversionRate = contactCount > 0 ? ((becameCustomers / contactCount) * 100).toFixed(1) : 0;

        return {
          stage: row.drop_stage,
          avg_unanswered_count: parseFloat(row.avg_unanswered_count || 0),
          contact_count: contactCount,
          avg_days_dormant: parseFloat(row.avg_days_dormant || 0),
          avg_engagement_rate: parseFloat(row.avg_engagement_rate || 0),
          became_customers: becameCustomers,
          conversion_rate: conversionRate,

          // Message pattern insights
          message_patterns: {
            total_unanswered: patterns.total_unanswered || 0,
            avg_days_since_sent: patterns.avg_days_since_sent || 0,
            avg_message_length: patterns.avg_message_length || 0,
            samples: (patterns.message_samples || []).slice(0, 3)
          },

          sample_contacts: Array.isArray(row.sample_contacts) ? row.sample_contacts.slice(0, 10) : []
        };
      })
    });

  } catch (error) {
    console.error('Bottleneck analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// 2. FOLLOW-UP PERFORMANCE TRACKING
// Analyzes which follow-up sequences perform best
// =====================================================

/**
 * GET /api/lead-analytics/:companyId/followup-performance
 * Returns performance metrics for follow-up sequences
 */
router.get('/:companyId/followup-performance', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { templateId } = req.query;

    let templateFilter = '';
    let queryParams = [companyId];

    if (templateId) {
      templateFilter = 'AND template_id = $2';
      queryParams.push(templateId);
    }

    // Get total customers for the company (global count)
    const totalCustomersQuery = await sqlDb.query(
      `SELECT COUNT(*) as total FROM contacts WHERE company_id = $1 AND tags ? 'customer'`,
      [companyId]
    );
    const globalCustomerCount = parseInt(totalCustomersQuery.rows[0]?.total || 0);

    // Get follow-up template performance
    const performanceQuery = `
      WITH followup_stats AS (
        SELECT
          sm.template_id,
          ft.name as template_name,
          ft.content as template_content,
          COUNT(DISTINCT sm.contact_id) as total_sent,
          COUNT(DISTINCT CASE
            WHEN c.custom_fields->'analytics'->>'followup_responded' = 'true'
            THEN sm.contact_id
          END) as responded_count,
          COUNT(DISTINCT CASE
            WHEN c.custom_fields->'analytics'->>'followup_responded' = 'true'
            AND c.tags ? 'customer'
            THEN sm.contact_id
          END) as customers_count,
          AVG(CASE
            WHEN c.custom_fields->'analytics'->>'avg_response_time_seconds' IS NOT NULL
            THEN (c.custom_fields->'analytics'->>'avg_response_time_seconds')::numeric
          END) as avg_response_time,
          COUNT(DISTINCT CASE
            WHEN sm.status = 'sent'
            THEN sm.contact_id
          END) as completed_count
        FROM scheduled_messages sm
        LEFT JOIN followup_templates ft ON sm.template_id = ft.id::text
        LEFT JOIN contacts c ON sm.contact_id = c.contact_id AND sm.company_id = c.company_id
        WHERE sm.company_id = $1
          AND sm.template_id IS NOT NULL
          ${templateFilter}
        GROUP BY sm.template_id, ft.name, ft.content
      )
      SELECT
        template_id,
        template_name,
        template_content,
        total_sent,
        responded_count,
        customers_count,
        completed_count,
        ROUND((responded_count::numeric / NULLIF(total_sent, 0) * 100), 2) as response_rate,
        ROUND((customers_count::numeric / NULLIF(responded_count, 0) * 100), 2) as customer_conversion_rate,
        ROUND(avg_response_time / 3600, 2) as avg_response_hours
      FROM followup_stats
      ORDER BY response_rate DESC NULLS LAST
    `;

    const performance = await sqlDb.query(performanceQuery, queryParams);

    // Get message-level performance (which message in sequence performs best)
    const messagePerformanceQuery = `
      SELECT 
        sm.template_id,
        COUNT(*) FILTER (WHERE sm.status = 'sent') as messages_sent,
        COUNT(*) FILTER (WHERE sm.status = 'scheduled') as messages_pending,
        COUNT(*) FILTER (WHERE sm.status = 'failed') as messages_failed,
        AVG(EXTRACT(EPOCH FROM (sm.sent_at - sm.scheduled_time))) as avg_send_delay_seconds
      FROM scheduled_messages sm
      WHERE sm.company_id = $1
        AND sm.template_id IS NOT NULL
        ${templateFilter}
      GROUP BY sm.template_id
    `;

    const messagePerf = await sqlDb.query(messagePerformanceQuery, queryParams);

    // Get best/worst performing templates
    const templates = performance.rows.map((row, index) => ({
      template_id: row.template_id,
      template_name: row.template_name || `Template ${row.template_id}`,
      template_content: row.template_content || '',
      total_sent: parseInt(row.total_sent || 0),
      responded: parseInt(row.responded_count || 0),
      customers: parseInt(row.customers_count || 0),
      completed: parseInt(row.completed_count || 0),
      response_rate: parseFloat(row.response_rate || 0),
      customer_conversion_rate: parseFloat(row.customer_conversion_rate || 0),
      avg_response_hours: parseFloat(row.avg_response_hours || 0),
      rank: index + 1,
      performance_tier:
        parseFloat(row.response_rate || 0) >= 30 ? 'excellent' :
        parseFloat(row.response_rate || 0) >= 15 ? 'good' :
        parseFloat(row.response_rate || 0) >= 5 ? 'average' : 'poor'
    }));

    const best = templates.length > 0 ? templates[0] : null;
    const worst = templates.length > 0 ? templates[templates.length - 1] : null;

    // Calculate aggregate statistics
    const totalSent = templates.reduce((sum, t) => sum + t.total_sent, 0);
    const totalResponded = templates.reduce((sum, t) => sum + t.responded, 0);
    const avgResponseRate = templates.length > 0
      ? (templates.reduce((sum, t) => sum + t.response_rate, 0) / templates.length).toFixed(2)
      : 0;
    const avgCustomerRate = templates.length > 0
      ? (templates.reduce((sum, t) => sum + t.customer_conversion_rate, 0) / templates.length).toFixed(2)
      : 0;
    const avgResponseTime = templates.length > 0
      ? (templates.reduce((sum, t) => sum + t.avg_response_hours, 0) / templates.length).toFixed(2)
      : 0;

    res.json({
      success: true,
      summary: {
        total_templates: templates.length,
        total_sent: totalSent,
        total_responded: totalResponded,
        total_customers: globalCustomerCount,  // Use global customer count
        avg_response_rate: avgResponseRate + '%',
        avg_customer_rate: avgCustomerRate + '%',
        avg_response_time: avgResponseTime + 'h',
        overall_response_rate: totalSent > 0 ? ((totalResponded / totalSent) * 100).toFixed(2) + '%' : '0%',
        overall_customer_rate: totalResponded > 0 ? ((globalCustomerCount / totalResponded) * 100).toFixed(2) + '%' : '0%',
        best_performing: best,
        worst_performing: worst
      },
      templates,
      message_stats: messagePerf.rows[0] || {}
    });

  } catch (error) {
    console.error('Follow-up performance error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// 2B. FOLLOW-UP RESPONSE DETAILS
// Shows detailed responses to automated follow-ups
// =====================================================

/**
 * GET /api/lead-analytics/:companyId/followup-responses
 * Returns detailed list of contacts who responded to automated follow-ups
 */
router.get('/:companyId/followup-responses', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { templateId } = req.query;

    let templateFilter = '';
    let queryParams = [companyId];

    if (templateId) {
      templateFilter = 'AND sm.template_id = $2';
      queryParams.push(templateId);
    }

    // Get detailed follow-up responses
    const responsesQuery = `
      SELECT
        c.contact_id,
        c.name,
        c.phone,
        c.tags,
        sm.template_id,
        ft.name as template_name,
        ft.content as template_content,
        sm.scheduled_time as followup_scheduled,
        sm.sent_at as followup_sent_at,
        sm.status as followup_status,
        c.custom_fields->'analytics'->>'followup_responded' as responded,
        c.custom_fields->'analytics'->>'avg_response_time_seconds' as avg_response_time,
        c.custom_fields->'analytics'->>'message_exchange_rate' as engagement_rate,
        c.custom_fields->'analytics'->>'last_response_stage' as response_stage,
        c.last_updated,
        (
          SELECT json_agg(
            json_build_object(
              'from_me', m.from_me,
              'body', m.content,
              'timestamp', m.timestamp,
              'type', m.message_type
            )
            ORDER BY m.timestamp DESC
          )
          FROM messages m
          WHERE m.contact_id = c.contact_id
            AND m.company_id = c.company_id
            AND m.timestamp >= sm.sent_at
          LIMIT 10
        ) as messages_after_followup
      FROM scheduled_messages sm
      LEFT JOIN followup_templates ft ON sm.template_id = ft.id::text
      LEFT JOIN contacts c ON sm.contact_id = c.contact_id AND sm.company_id = c.company_id
      WHERE sm.company_id = $1
        AND sm.template_id IS NOT NULL
        AND sm.status = 'sent'
        ${templateFilter}
      ORDER BY sm.sent_at DESC
      LIMIT 100
    `;

    const responses = await sqlDb.query(responsesQuery, queryParams);

    // Organize by template
    const byTemplate = {};
    responses.rows.forEach(row => {
      const templateId = row.template_id;
      if (!byTemplate[templateId]) {
        byTemplate[templateId] = {
          template_id: templateId,
          template_name: row.template_name || `Template ${templateId}`,
          template_content: row.template_content || '',
          contacts: []
        };
      }

      byTemplate[templateId].contacts.push({
        contact_id: row.contact_id,
        name: row.name,
        phone: row.phone,
        tags: row.tags,
        followup_sent_at: row.followup_sent_at,
        responded: row.responded === 'true',
        is_customer: row.tags && (
          (typeof row.tags === 'object' && Array.isArray(row.tags) && row.tags.includes('customer')) ||
          (typeof row.tags === 'object' && !Array.isArray(row.tags) && row.tags.customer)
        ),
        avg_response_time_hours: row.avg_response_time
          ? (parseFloat(row.avg_response_time) / 3600).toFixed(2)
          : null,
        engagement_rate: parseFloat(row.engagement_rate || 0),
        response_stage: row.response_stage,
        messages_after_followup: row.messages_after_followup || []
      });
    });

    // Calculate stats per template
    const templates = Object.values(byTemplate).map(template => {
      const total = template.contacts.length;
      const responded = template.contacts.filter(c => c.responded).length;
      const customers = template.contacts.filter(c => c.is_customer).length;

      return {
        ...template,
        stats: {
          total_sent: total,
          responded_count: responded,
          customer_count: customers,
          response_rate: total > 0 ? ((responded / total) * 100).toFixed(2) + '%' : '0%',
          customer_rate: responded > 0 ? ((customers / responded) * 100).toFixed(2) + '%' : '0%'
        }
      };
    });

    res.json({
      success: true,
      total_contacts: responses.rows.length,
      templates
    });

  } catch (error) {
    console.error('Follow-up responses error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// 3. PIPELINE STAGE VISUALIZATION
// Shows distribution of leads across pipeline stages
// =====================================================

/**
 * GET /api/lead-analytics/:companyId/pipeline
 * Returns lead distribution across pipeline stages
 */
router.get('/:companyId/pipeline', async (req, res) => {
  try {
    const { companyId } = req.params;

    // Define sales pipeline stages based on response stage and tags
    const pipelineQuery = `
      WITH lead_stages AS (
        SELECT
          contact_id,
          name,
          phone,
          tags,
          custom_fields->'analytics'->>'last_response_stage' as response_stage,
          custom_fields->'analytics'->>'days_since_last_message' as days_dormant,
          custom_fields->'analytics'->>'message_exchange_rate' as engagement_rate,
          CASE
            -- Stage 1: Prospecting (new leads, never contacted or never replied)
            WHEN tags ? 'customer' OR tags ? 'closed' THEN 'closed_won'
            WHEN tags ? 'not_a_lead' THEN 'closed_lost'

            -- Stage 6: Closing (active conversation with high engagement)
            WHEN custom_fields->'analytics'->>'last_response_stage' = 'active'
              AND (custom_fields->'analytics'->>'message_exchange_rate')::numeric > 0.3
              THEN 'closing'

            -- Stage 5: Proposal/Negotiation (stopped replying but was engaged)
            WHEN custom_fields->'analytics'->>'last_response_stage' IN ('stopped_replying', 'went_dormant')
              AND (custom_fields->'analytics'->>'message_exchange_rate')::numeric > 0.2
              THEN 'proposal'

            -- Stage 4: Nurturing (some engagement, back and forth)
            WHEN custom_fields->'analytics'->>'last_response_stage' = 'active'
              OR (custom_fields->'analytics'->>'message_exchange_rate')::numeric BETWEEN 0.1 AND 0.3
              THEN 'nurturing'

            -- Stage 3: Qualification (replied at least once)
            WHEN custom_fields->'analytics'->>'last_response_stage' NOT IN ('never_replied', 'never_contacted')
              AND custom_fields->'analytics'->>'last_response_stage' != 'active'
              THEN 'qualification'

            -- Stage 2: Contacted (waiting for first reply)
            WHEN custom_fields->'analytics'->>'last_response_stage' = 'awaiting_reply'
              THEN 'contacted'

            -- Stage 1: Prospecting
            WHEN custom_fields->'analytics'->>'last_response_stage' IN ('never_contacted', 'never_replied')
              THEN 'prospecting'

            ELSE 'prospecting'
          END as pipeline_stage,
          created_at,
          last_updated
        FROM contacts
        WHERE company_id = $1
          AND custom_fields->'analytics' IS NOT NULL
          AND is_group = false
          AND NOT (tags ? 'not_a_lead')
      ),
      ranked_contacts AS (
        SELECT 
          pipeline_stage,
          contact_id,
          name,
          phone,
          response_stage,
          days_dormant,
          last_updated,
          ROW_NUMBER() OVER (PARTITION BY pipeline_stage ORDER BY last_updated DESC) as rn
        FROM lead_stages
      )
      SELECT
        ls.pipeline_stage,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE ls.tags ? 'customer') as customer_count,
        ROUND(AVG((ls.days_dormant)::numeric), 1) as avg_days_dormant,
        ROUND(AVG((ls.engagement_rate)::numeric), 2) as avg_engagement,
        COALESCE(
          json_agg(
            json_build_object(
              'contact_id', rc.contact_id,
              'name', rc.name,
              'phone', rc.phone,
              'response_stage', rc.response_stage,
              'days_dormant', rc.days_dormant
            )
            ORDER BY rc.last_updated DESC
          ) FILTER (WHERE rc.rn <= 5),
          '[]'::json
        ) as sample_contacts
      FROM lead_stages ls
      LEFT JOIN ranked_contacts rc ON ls.pipeline_stage = rc.pipeline_stage AND rc.rn <= 5
      GROUP BY ls.pipeline_stage
      ORDER BY
        CASE ls.pipeline_stage
          WHEN 'prospecting' THEN 1
          WHEN 'contacted' THEN 2
          WHEN 'qualification' THEN 3
          WHEN 'nurturing' THEN 4
          WHEN 'proposal' THEN 5
          WHEN 'closing' THEN 6
          WHEN 'closed_won' THEN 7
          WHEN 'closed_lost' THEN 8
          ELSE 9
        END
    `;

    const pipeline = await sqlDb.query(pipelineQuery, [companyId]);

    // Calculate total and percentages
    const total = pipeline.rows.reduce((sum, row) => sum + parseInt(row.count), 0);

    const stages = pipeline.rows.map(row => {
      const count = parseInt(row.count);
      const customerCount = parseInt(row.customer_count || 0);
      return {
        stage: row.pipeline_stage,
        stage_label: {
          'prospecting': 'Prospecting',
          'contacted': 'Contacted',
          'qualification': 'Qualification',
          'nurturing': 'Nurturing',
          'proposal': 'Proposal',
          'closing': 'Closing',
          'closed_won': 'Closed Won',
          'closed_lost': 'Closed Lost'
        }[row.pipeline_stage] || row.pipeline_stage,
        count: count,
        customer_count: customerCount,
        customer_percentage: count > 0 ? ((customerCount / count) * 100).toFixed(1) + '%' : '0%',
        percentage: total > 0 ? ((count / total) * 100).toFixed(2) + '%' : '0%',
        avg_days_dormant: parseFloat(row.avg_days_dormant || 0),
        avg_engagement: parseFloat(row.avg_engagement || 0),
        sample_contacts: row.sample_contacts || []
      };
    });

    // Calculate conversion rates between stages
    const prospecting = stages.find(s => s.stage === 'prospecting')?.count || 0;
    const contacted = stages.find(s => s.stage === 'contacted')?.count || 0;
    const qualification = stages.find(s => s.stage === 'qualification')?.count || 0;
    const nurturing = stages.find(s => s.stage === 'nurturing')?.count || 0;
    const proposal = stages.find(s => s.stage === 'proposal')?.count || 0;
    const closing = stages.find(s => s.stage === 'closing')?.count || 0;
    const closedWon = stages.find(s => s.stage === 'closed_won')?.count || 0;
    const closedLost = stages.find(s => s.stage === 'closed_lost')?.count || 0;

    const totalActive = prospecting + contacted + qualification + nurturing + proposal + closing;

    res.json({
      success: true,
      total_leads: total,
      stages,
      conversion_rates: {
        prospecting_to_contacted: prospecting > 0 ? ((contacted / prospecting) * 100).toFixed(1) + '%' : 'N/A',
        contacted_to_qualified: contacted > 0 ? ((qualification / contacted) * 100).toFixed(1) + '%' : 'N/A',
        qualified_to_nurturing: qualification > 0 ? ((nurturing / qualification) * 100).toFixed(1) + '%' : 'N/A',
        nurturing_to_proposal: nurturing > 0 ? ((proposal / nurturing) * 100).toFixed(1) + '%' : 'N/A',
        proposal_to_closing: proposal > 0 ? ((closing / proposal) * 100).toFixed(1) + '%' : 'N/A',
        win_rate: (closedWon + closedLost) > 0 ? ((closedWon / (closedWon + closedLost)) * 100).toFixed(1) + '%' : 'N/A',
        overall_conversion: totalActive > 0 ? ((closedWon / totalActive) * 100).toFixed(1) + '%' : '0%'
      }
    });

  } catch (error) {
    console.error('Pipeline visualization error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// 4. REACTIVATION CANDIDATES
// Identifies contacts that should be reactivated
// =====================================================

/**
 * GET /api/lead-analytics/:companyId/reactivation
 * Returns list of contacts eligible for reactivation
 */
router.get('/:companyId/reactivation', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { minPriority = 5 } = req.query;  // Removed limit parameter

    const reactivationQuery = `
      SELECT 
        c.contact_id,
        c.name,
        c.phone,
        c.tags,
        c.custom_fields->'analytics'->>'reactivation_eligible' as eligible,
        c.custom_fields->'analytics'->>'reactivation_priority' as priority,
        c.custom_fields->'analytics'->>'days_since_last_message' as days_dormant,
        c.custom_fields->'analytics'->>'message_exchange_rate' as engagement_rate,
        c.custom_fields->'analytics'->>'avg_response_time_seconds' as avg_response_time,
        c.custom_fields->'analytics'->>'last_response_stage' as last_stage,
        c.last_updated,
        c.created_at
      FROM contacts c
      WHERE c.company_id = $1
        AND c.custom_fields->'analytics'->>'reactivation_eligible' = 'true'
        AND (c.custom_fields->'analytics'->>'reactivation_priority')::numeric >= $2
        AND c.is_group = false
      ORDER BY (c.custom_fields->'analytics'->>'reactivation_priority')::numeric DESC
      -- Removed LIMIT to return all records
    `;

    const candidates = await sqlDb.query(reactivationQuery, [
      companyId,
      parseInt(minPriority)
    ]);

    // Group by priority tiers
    const highPriority = candidates.rows.filter(c => parseInt(c.priority) >= 8);
    const mediumPriority = candidates.rows.filter(c => parseInt(c.priority) >= 5 && parseInt(c.priority) < 8);
    const lowPriority = candidates.rows.filter(c => parseInt(c.priority) < 5);

    res.json({
      success: true,
      total_candidates: candidates.rows.length,
      priority_distribution: {
        high: highPriority.length,
        medium: mediumPriority.length,
        low: lowPriority.length
      },
      candidates: candidates.rows.map(row => ({
        contact_id: row.contact_id,
        name: row.name,
        phone: row.phone,
        tags: row.tags,
        priority: parseInt(row.priority || 0),
        priority_tier: 
          parseInt(row.priority) >= 8 ? 'high' :
          parseInt(row.priority) >= 5 ? 'medium' : 'low',
        days_dormant: parseInt(row.days_dormant || 0),
        engagement_rate: parseFloat(row.engagement_rate || 0),
        avg_response_hours: row.avg_response_time 
          ? (parseFloat(row.avg_response_time) / 3600).toFixed(2)
          : null,
        last_stage: row.last_stage,
        last_updated: row.last_updated,
        created_at: row.created_at
      }))
    });

  } catch (error) {
    console.error('Reactivation candidates error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// 5. TRIGGER REACTIVATION CAMPAIGN
// Starts a reactivation campaign for selected contacts
// =====================================================

/**
 * POST /api/lead-analytics/:companyId/reactivation/trigger
 * Triggers reactivation campaign for eligible contacts
 */
router.post('/:companyId/reactivation/trigger', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { 
      contactIds, 
      templateId, 
      minPriority = 5,
      autoSelect = false 
    } = req.body;

    let targetContacts = [];

    if (autoSelect) {
      // Auto-select contacts based on priority
      const autoSelectQuery = `
        SELECT contact_id, phone
        FROM contacts
        WHERE company_id = $1
          AND custom_fields->'analytics'->>'reactivation_eligible' = 'true'
          AND (custom_fields->'analytics'->>'reactivation_priority')::numeric >= $2
          AND is_group = false
        ORDER BY (custom_fields->'analytics'->>'reactivation_priority')::numeric DESC
        -- Removed LIMIT to return all records
      `;
      const result = await sqlDb.query(autoSelectQuery, [companyId, parseInt(minPriority)]);
      targetContacts = result.rows;
    } else if (contactIds && contactIds.length > 0) {
      // Use provided contact IDs
      const selectQuery = `
        SELECT contact_id, phone
        FROM contacts
        WHERE company_id = $1
          AND contact_id = ANY($2::text[])
      `;
      const result = await sqlDb.query(selectQuery, [companyId, contactIds]);
      targetContacts = result.rows;
    } else {
      return res.status(400).json({
        success: false,
        error: 'Either provide contactIds or set autoSelect=true'
      });
    }

    if (targetContacts.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No eligible contacts found for reactivation'
      });
    }

    // TODO: Integrate with your follow-up system to schedule messages
    // For now, just return the contacts that would be reactivated

    res.json({
      success: true,
      message: `Reactivation campaign prepared for ${targetContacts.length} contacts`,
      template_id: templateId,
      contacts: targetContacts.map(c => ({
        contact_id: c.contact_id,
        phone: c.phone
      })),
      next_steps: [
        'Review the contact list',
        'Configure reactivation message template',
        'Schedule the campaign',
        'Monitor response rates'
      ]
    });

  } catch (error) {
    console.error('Trigger reactivation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// 6. COMPANY ANALYSIS
// Provides comprehensive analysis of company's lead performance
// =====================================================

/**
 * GET /api/lead-analytics/:companyId/analyze
 * Returns a comprehensive analysis of the company's lead performance
 */
router.get('/:companyId/analyze', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    // Get company-wide metrics
    const metricsQuery = `
      WITH 
      -- Total leads
      total_leads AS (
        SELECT COUNT(*) as count FROM contacts 
        WHERE company_id = $1 AND is_group = false
      ),
      -- Active leads (recent interaction)
      active_leads AS (
        SELECT COUNT(*) as count FROM contacts 
        WHERE company_id = $1 
          AND is_group = false
          AND (custom_fields->'analytics'->>'days_since_last_message')::numeric <= 7
      ),
      -- Customers
      customers AS (
        SELECT COUNT(*) as count FROM contacts 
        WHERE company_id = $1 
          AND is_group = false 
          AND tags ? 'customer'
      ),
      -- Conversion rate
      conversion_metrics AS (
        SELECT 
          ROUND(COUNT(*) FILTER (WHERE tags ? 'customer') * 100.0 / 
                NULLIF(COUNT(*) FILTER (WHERE tags ? 'lead'), 0), 1) as lead_to_customer_rate
        FROM contacts 
        WHERE company_id = $1 
          AND is_group = false
      ),
      -- Response rate
      response_metrics AS (
        SELECT 
          ROUND(AVG((custom_fields->'analytics'->>'reply_rate')::numeric), 1) as avg_reply_rate,
          ROUND(AVG((custom_fields->'analytics'->>'response_time_minutes')::numeric), 0) as avg_response_time_minutes
        FROM contacts 
        WHERE company_id = $1 
          AND is_group = false
          AND custom_fields->'analytics'->>'reply_rate' IS NOT NULL
      )
      
      SELECT 
        t.count as total_leads,
        a.count as active_leads,
        c.count as customers,
        m.lead_to_customer_rate,
        r.avg_reply_rate,
        r.avg_response_time_minutes
      FROM total_leads t, active_leads a, customers c, conversion_metrics m, response_metrics r
    `;

    const metricsResult = await sqlDb.query(metricsQuery, [companyId]);
    const metrics = metricsResult.rows[0];

    // Get top performing tags
    const tagsQuery = `
      SELECT 
        tag,
        COUNT(*) as lead_count,
        ROUND(COUNT(*) FILTER (WHERE tags ? 'customer') * 100.0 / COUNT(*), 1) as conversion_rate
      FROM contacts, jsonb_array_elements_text(tags) as tag
      WHERE company_id = $1 
        AND is_group = false
      GROUP BY tag
      ORDER BY lead_count DESC
      LIMIT 10
    `;
    const tagsResult = await sqlDb.query(tagsQuery, [companyId]);

    // Get drop-off analysis
    const dropOffQuery = `
      SELECT 
        custom_fields->'analytics'->'response_drop_point'->>'stage' as drop_stage,
        COUNT(*) as count,
        ROUND(AVG((custom_fields->'analytics'->>'days_since_last_message')::numeric), 1) as avg_days_dormant
      FROM contacts
      WHERE company_id = $1 
        AND is_group = false
        AND custom_fields->'analytics'->'response_drop_point' IS NOT NULL
      GROUP BY drop_stage
      ORDER BY count DESC
      LIMIT 5
    `;
    const dropOffResult = await sqlDb.query(dropOffQuery, [companyId]);

    // Generate key findings
    const keyFindings = [
      `You have ${metrics.total_leads} total leads with a ${metrics.lead_to_customer_rate}% conversion rate to customers.`,
      `${metrics.active_leads} leads (${Math.round((metrics.active_leads / metrics.total_leads) * 100)}%) have been active in the last 7 days.`,
      `Average reply rate across all leads is ${metrics.avg_reply_rate}% with an average response time of ${Math.floor(metrics.avg_response_time_minutes / 60)}h ${metrics.avg_response_time_minutes % 60}m.`,
      `Top performing tag is "${tagsResult.rows[0]?.tag || 'N/A'}" with ${tagsResult.rows[0]?.lead_count || 0} leads.`
    ];

    // Add drop-off insights if available
    if (dropOffResult.rows.length > 0) {
      const topDropOff = dropOffResult.rows[0];
      keyFindings.push(
        `Most common drop-off point is "${topDropOff.drop_stage}" with ${topDropOff.count} leads (${Math.round((topDropOff.count / metrics.total_leads) * 100)}%).`
      );
    }

    res.json({
      success: true,
      metrics: {
        total_leads: parseInt(metrics.total_leads),
        active_leads: parseInt(metrics.active_leads),
        customers: parseInt(metrics.customers),
        lead_to_customer_rate: parseFloat(metrics.lead_to_customer_rate) || 0,
        avg_reply_rate: parseFloat(metrics.avg_reply_rate) || 0,
        avg_response_time_minutes: parseInt(metrics.avg_response_time_minutes) || 0
      },
      top_tags: tagsResult.rows,
      drop_off_analysis: dropOffResult.rows,
      key_findings: keyFindings,
      recommendations: [
        'Consider re-engaging with leads that have dropped off in the early stages',
        'Analyze top performing tags to replicate successful lead sources',
        'Review and optimize response times to improve engagement',
        'Implement targeted follow-ups for leads showing interest but not converting'
      ]
    });

  } catch (error) {
    console.error('Company analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
