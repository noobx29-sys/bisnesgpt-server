// =====================================================
// Lead Analytics Dashboard - Frontend Logic
// =====================================================

const API_BASE = window.location.origin;
let currentCompany = null;
let charts = {};
let selectedContacts = new Set();

// =====================================================
// INITIALIZATION
// =====================================================

document.addEventListener('DOMContentLoaded', async () => {
    await loadCompanies();
    
    document.getElementById('companySelect').addEventListener('change', (e) => {
        currentCompany = e.target.value;
        if (currentCompany) {
            loadDashboard();
        } else {
            showNoCompanyState();
        }
    });
    
    showNoCompanyState();
});

// =====================================================
// COMPANY SELECTION
// =====================================================

async function loadCompanies() {
    try {
        const response = await fetch(`${API_BASE}/api/companies`);
        const data = await response.json();
        
        const select = document.getElementById('companySelect');
        data.companies.forEach(company => {
            const option = document.createElement('option');
            option.value = company.company_id;
            option.textContent = `${company.company_id} (${company.contact_count} contacts)`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading companies:', error);
    }
}

// =====================================================
// DASHBOARD LOADING
// =====================================================

async function loadDashboard() {
    showLoadingState();
    
    try {
        await Promise.all([
            loadBottlenecksData(),
            loadFollowupData(),
            loadPipelineData(),
            loadReactivationData()
        ]);
        
        showDashboardContent();
    } catch (error) {
        console.error('Error loading dashboard:', error);
        alert('Error loading dashboard data. Please try again.');
    }
}

async function refreshData() {
    if (!currentCompany) {
        alert('Please select a company first');
        return;
    }
    await loadDashboard();
}

// =====================================================
// BOTTLENECKS TAB
// =====================================================

async function loadBottlenecksData() {
    const response = await fetch(`${API_BASE}/api/lead-analytics/${currentCompany}/bottlenecks?timeRange=120`);
    const data = await response.json();
    
    // Update summary cards
    document.getElementById('totalContacts').textContent = data.summary.total_leads.toLocaleString();
    document.getElementById('replyRate').textContent = data.summary.reply_rate;
    document.getElementById('activeRate').textContent = data.summary.active_rate;
    document.getElementById('customerCount').textContent = data.summary.customer_count.toLocaleString();
    document.getElementById('customerRate').textContent = data.summary.customer_rate;

    if (data.bottlenecks.length > 0) {
        const biggest = data.bottlenecks[0];
        document.getElementById('biggestBottleneck').textContent =
            `${formatStageName(biggest.stage)} (${biggest.percentage})`;
    }
    
    // Render bottleneck chart
    renderBottleneckChart(data.bottlenecks);
    
    // Render drop points list
    renderDropPointsList(data.drop_points);
}

function renderBottleneckChart(bottlenecks) {
    const ctx = document.getElementById('bottleneckChart');
    
    if (charts.bottleneck) {
        charts.bottleneck.destroy();
    }
    
    const colors = {
        'never_contacted': '#94a3b8',
        'never_replied': '#ef4444',
        'stopped_replying': '#f59e0b',
        'went_dormant': '#6b7280',
        'awaiting_reply': '#3b82f6',
        'active': '#10b981'
    };
    
    charts.bottleneck = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: bottlenecks.map(b => formatStageName(b.stage)),
            datasets: [{
                data: bottlenecks.map(b => b.count),
                backgroundColor: bottlenecks.map(b => colors[b.stage] || '#9ca3af'),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const item = bottlenecks[context.dataIndex];
                            return [
                                `Count: ${item.count}`,
                                `Percentage: ${item.percentage}`,
                                `Avg Days Dormant: ${item.avg_days_dormant}`
                            ];
                        }
                    }
                }
            }
        }
    });
}

function renderDropPointsList(dropPoints) {
    const container = document.getElementById('dropPointsList');
    container.innerHTML = '';

    if (dropPoints.length === 0) {
        container.innerHTML = '<p class="text-slate-400 text-sm">No drop-off data available</p>';
        return;
    }

    // Calculate total contacts for percentage
    const totalContacts = dropPoints.reduce((sum, point) => sum + point.contact_count, 0);

    dropPoints.slice(0, 5).forEach((point, index) => {
        const div = document.createElement('div');
        const percentage = ((point.contact_count / totalContacts) * 100).toFixed(1);

        // Determine severity based on percentage and count
        let severityClass = 'border-slate-700 hover:border-blue-500';
        let severityIcon = 'fa-exclamation-circle';
        let severityColor = 'text-yellow-500';

        if (percentage > 30 || point.contact_count > 50) {
            severityClass = 'border-red-500/30 hover:border-red-500';
            severityIcon = 'fa-exclamation-triangle';
            severityColor = 'text-red-500';
        } else if (percentage > 20 || point.contact_count > 30) {
            severityClass = 'border-orange-500/30 hover:border-orange-500';
            severityIcon = 'fa-exclamation-circle';
            severityColor = 'text-orange-500';
        }

        div.className = `p-4 bg-slate-800/30 rounded-lg border ${severityClass} transition-all cursor-pointer hover:shadow-lg hover:bg-slate-800/50`;

        // Generate insights based on data
        const patterns = point.message_patterns || {};
        const conversionRate = parseFloat(point.conversion_rate || 0);

        let insightsHtml = '';
        let recommendationsHtml = '';

        // Build insights section
        const insights = [];
        if (point.avg_days_dormant) {
            insights.push(`Avg ${point.avg_days_dormant} days dormant`);
        }
        if (patterns.avg_message_length) {
            insights.push(`Message length: ${patterns.avg_message_length} chars`);
        }
        if (conversionRate > 0) {
            insights.push(`${conversionRate}% became customers`);
        }
        if (point.avg_engagement_rate) {
            insights.push(`${(point.avg_engagement_rate * 100).toFixed(0)}% engagement`);
        }

        if (insights.length > 0) {
            insightsHtml = `
                <div class="mt-2 flex flex-wrap gap-2">
                    ${insights.map(insight => `
                        <span class="px-2 py-1 bg-blue-500/10 text-blue-300 text-xs rounded border border-blue-500/30">
                            ${insight}
                        </span>
                    `).join('')}
                </div>
            `;
        }

        // Generate smart recommendations
        const recommendations = generateRecommendations(point);
        if (recommendations.length > 0) {
            recommendationsHtml = `
                <div class="mt-3 pt-3 border-t border-slate-600">
                    <p class="text-xs font-semibold text-yellow-300 mb-2">
                        <i class="fas fa-lightbulb mr-1"></i>How to improve:
                    </p>
                    <ul class="space-y-1">
                        ${recommendations.slice(0, 2).map(rec => `
                            <li class="text-xs text-slate-300 pl-3 border-l-2 border-yellow-500/50">
                                ${rec}
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }

        // Sample message preview - filter out empty messages
        let messagePreviewHtml = '';
        if (patterns.samples && patterns.samples.length > 0) {
            const validSamples = patterns.samples.filter(s => s && s.trim().length > 0);
            if (validSamples.length > 0) {
                const sample = validSamples[0];
                const preview = sample.length > 80 ? sample.substring(0, 80) + '...' : sample;
                messagePreviewHtml = `
                    <div class="mt-3 pt-3 border-t border-slate-600">
                        <p class="text-xs font-semibold text-slate-400 mb-2">Common unanswered message:</p>
                        <div class="bg-slate-700/50 rounded p-2 border-l-2 border-orange-500">
                            <p class="text-xs text-slate-300">"${preview}"</p>
                        </div>
                    </div>
                `;
            }
        }

        div.innerHTML = `
            <div class="flex items-start justify-between mb-2">
                <div class="flex items-center gap-2">
                    <i class="fas ${severityIcon} ${severityColor}"></i>
                    <p class="font-semibold text-white">${formatStageName(point.stage)}</p>
                </div>
                <span class="text-2xl font-bold text-blue-400">${point.contact_count}</span>
            </div>
            <div class="flex items-center gap-4 text-sm mb-1">
                <span class="text-slate-300">${percentage}% of drop-offs</span>
                ${point.avg_unanswered_count > 0 ? `<span class="text-orange-400"><i class="fas fa-envelope-open-text mr-1"></i>~${point.avg_unanswered_count.toFixed(1)} unanswered avg</span>` : ''}
            </div>
            ${insightsHtml}
            ${recommendationsHtml}
            ${messagePreviewHtml}
            <div class="mt-3 flex items-center justify-end gap-2">
                <span class="text-xs text-slate-500">Click for full analysis</span>
                <i class="fas fa-chevron-right text-slate-500 text-xs"></i>
            </div>
        `;

        // Make it clickable to show more details
        div.onclick = () => showDropPointDetails(point);

        container.appendChild(div);
    });
}

// Generate smart recommendations based on drop-off data
function generateRecommendations(point) {
    const recommendations = [];
    const stage = point.stage;
    const patterns = point.message_patterns || {};
    const avgDays = point.avg_days_dormant || 0;
    const msgLength = patterns.avg_message_length || 0;
    const engagementRate = point.avg_engagement_rate || 0;
    const conversionRate = parseFloat(point.conversion_rate || 0);

    // Stage-specific recommendations
    if (stage === 'never_replied') {
        if (msgLength > 200) {
            recommendations.push('Messages too long - try shorter, more direct messages');
        } else if (msgLength < 50) {
            recommendations.push('Messages too brief - add more value/context');
        }
        recommendations.push('Test different opening messages or value propositions');
        recommendations.push('Try sending at different times of day');
    } else if (stage === 'stopped_replying') {
        if (avgDays < 7) {
            recommendations.push('Wait 1-2 more days before following up');
        } else if (avgDays > 14) {
            recommendations.push('Send reactivation message - it\'s been too long');
        }
        recommendations.push('Reference previous conversation to re-engage');
        if (conversionRate > 5) {
            recommendations.push(`${conversionRate}% converted - worth pursuing!`);
        }
    } else if (stage === 'went_dormant') {
        recommendations.push('Launch reactivation campaign with special offer');
        recommendations.push('Share new product/service updates');
        if (engagementRate > 0.3) {
            recommendations.push('Previously engaged - good reactivation candidates');
        }
    } else if (stage === 'awaiting_reply') {
        recommendations.push('Send gentle reminder after 48 hours');
        recommendations.push('Ask a direct question to prompt response');
    } else if (stage === 'never_contacted') {
        recommendations.push('Initiate contact with personalized message');
        recommendations.push('Start with value proposition, not sales pitch');
    }

    return recommendations;
}

function showDropPointDetails(point) {
    if (!point.sample_contacts || point.sample_contacts.length === 0) {
        alert('No detailed data available for this drop-off point');
        return;
    }

    // Calculate insights
    const totalUnanswered = point.sample_contacts.reduce((sum, c) => sum + (c.unanswered_messages?.length || 0), 0);
    const avgUnanswered = (totalUnanswered / point.sample_contacts.length).toFixed(1);
    const patterns = point.message_patterns || {};
    const conversionRate = parseFloat(point.conversion_rate || 0);
    const becameCustomers = point.became_customers || 0;

    // Get common patterns in unanswered messages
    let commonPatterns = [];
    const allMessages = point.sample_contacts.flatMap(c => c.unanswered_messages || []);
    if (allMessages.length > 0) {
        const avgDaysAgo = (allMessages.reduce((sum, m) => sum + m.days_ago, 0) / allMessages.length).toFixed(0);
        commonPatterns.push(`Avg ${avgDaysAgo} days since last message`);
    }
    if (patterns.avg_message_length) {
        commonPatterns.push(`Avg message length: ${patterns.avg_message_length} characters`);
    }
    if (becameCustomers > 0) {
        commonPatterns.push(`${becameCustomers} (${conversionRate}%) became customers anyway`);
    }

    // Generate all recommendations
    const allRecommendations = generateRecommendations(point);

    let detailsHtml = `
        <div style="max-height: 600px; overflow-y: auto;">
            <!-- Header -->
            <div class="mb-4">
                <h3 class="text-2xl font-bold text-white mb-2">${formatStageName(point.stage)}</h3>
                <div class="flex items-center gap-4 text-sm text-slate-400">
                    <span><i class="fas fa-users mr-1"></i>${point.contact_count} contacts</span>
                    ${point.avg_unanswered_count > 0 ? `<span><i class="fas fa-envelope-open-text mr-1"></i>~${point.avg_unanswered_count.toFixed(1)} unanswered avg</span>` : ''}
                    ${becameCustomers > 0 ? `<span class="text-green-400"><i class="fas fa-star mr-1"></i>${becameCustomers} became customers</span>` : ''}
                </div>
            </div>

            <!-- WHY They Dropped Off -->
            <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
                <h4 class="text-sm font-semibold text-red-300 mb-3">
                    <i class="fas fa-question-circle mr-1"></i>Why They Dropped Off
                </h4>
                <div class="grid grid-cols-2 gap-3 text-xs">
                    <div class="bg-slate-800/50 rounded p-2">
                        <p class="text-slate-400">Avg Time Silent</p>
                        <p class="text-white font-bold text-lg">${point.avg_days_dormant || 0} days</p>
                    </div>
                    <div class="bg-slate-800/50 rounded p-2">
                        <p class="text-slate-400">Engagement Rate</p>
                        <p class="text-white font-bold text-lg">${((point.avg_engagement_rate || 0) * 100).toFixed(0)}%</p>
                    </div>
                    ${patterns.avg_message_length ? `
                        <div class="bg-slate-800/50 rounded p-2">
                            <p class="text-slate-400">Message Length</p>
                            <p class="text-white font-bold text-lg">${patterns.avg_message_length} chars</p>
                        </div>
                    ` : ''}
                    <div class="bg-slate-800/50 rounded p-2">
                        <p class="text-slate-400">Unanswered Msgs</p>
                        <p class="text-white font-bold text-lg">${avgUnanswered}</p>
                    </div>
                </div>
            </div>

            <!-- HOW to Improve -->
            ${allRecommendations.length > 0 ? `
                <div class="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
                    <h4 class="text-sm font-semibold text-yellow-300 mb-3">
                        <i class="fas fa-lightbulb mr-1"></i>How to Do Better
                    </h4>
                    <ol class="space-y-2">
                        ${allRecommendations.map((rec, idx) => `
                            <li class="flex items-start gap-2">
                                <span class="flex-shrink-0 w-5 h-5 bg-yellow-500/20 text-yellow-300 rounded-full flex items-center justify-center text-xs font-bold">
                                    ${idx + 1}
                                </span>
                                <span class="text-xs text-slate-200 flex-1">${rec}</span>
                            </li>
                        `).join('')}
                    </ol>
                </div>
            ` : ''}

            <!-- Data Insights -->
            <div class="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
                <h4 class="text-sm font-semibold text-blue-300 mb-2"><i class="fas fa-chart-bar mr-1"></i>Key Insights</h4>
                <ul class="text-xs text-slate-300 space-y-1">
                    ${commonPatterns.map(p => `<li>• ${p}</li>`).join('')}
                    <li>• Showing ${point.sample_contacts.length} of ${point.contact_count} contacts in this stage</li>
                </ul>
            </div>

            <!-- Common Message Patterns -->
            ${(() => {
                const validSamples = (patterns.samples || []).filter(s => s && s.trim().length > 0);
                return validSamples.length > 0 ? `
                    <div class="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 mb-4">
                        <h4 class="text-sm font-semibold text-orange-300 mb-3">
                            <i class="fas fa-comment-slash mr-1"></i>Messages That Got Ignored
                        </h4>
                        <div class="space-y-2">
                            ${validSamples.map(sample => `
                                <div class="bg-slate-800/50 rounded p-2 text-xs text-slate-300 border-l-2 border-orange-500">
                                    "${sample}"
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : '';
            })()}

            <!-- Contacts List -->
            <div class="space-y-3">
                <h4 class="text-sm font-semibold text-slate-300 mb-2">Sample Contacts:</h4>
    `;

    point.sample_contacts.forEach((contact, idx) => {
        const unansweredMsgs = contact.unanswered_messages || [];
        const isCustomer = contact.is_customer || false;
        const engagement = contact.engagement_rate || 0;
        const daysDormant = contact.days_dormant || 0;

        detailsHtml += `
            <div class="border ${isCustomer ? 'border-green-500/50 bg-green-500/5' : 'border-slate-600'} rounded-lg p-4 bg-slate-700/50 hover:bg-slate-700/70 transition-colors">
                <div class="flex justify-between items-start mb-2">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <p class="font-semibold text-white">${contact.name || 'Contact #' + (idx + 1)}</p>
                            ${isCustomer ? '<span class="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full border border-green-500/30"><i class="fas fa-star mr-1"></i>Customer</span>' : ''}
                        </div>
                        <div class="flex items-center gap-3 text-xs text-slate-400">
                            ${contact.phone ? `<span>${contact.phone}</span>` : ''}
                            <span>${daysDormant}d dormant</span>
                            <span>${(engagement * 100).toFixed(0)}% engaged</span>
                        </div>
                    </div>
                    ${unansweredMsgs.length > 0 ? `
                        <span class="px-2 py-1 bg-orange-500/20 text-orange-400 text-xs rounded-full border border-orange-500/30">
                            ${unansweredMsgs.length} unanswered
                        </span>
                    ` : ''}
                </div>

                ${unansweredMsgs.length > 0 ? `
                    <div class="mt-3 space-y-2">
                        <p class="text-xs font-semibold text-slate-400">Messages they didn't respond to:</p>
                        ${unansweredMsgs.map((msg, msgIdx) => `
                            <div class="bg-slate-800/50 p-3 rounded border-l-2 ${msgIdx === 0 ? 'border-red-500' : 'border-slate-600'}">
                                <div class="flex justify-between items-start mb-1">
                                    <span class="text-xs text-slate-500">${msg.days_ago} days ago</span>
                                    ${msgIdx === 0 ? '<span class="text-xs text-red-400">Most recent</span>' : ''}
                                </div>
                                <p class="text-sm text-slate-200">"${msg.content}"</p>
                            </div>
                        `).join('')}
                    </div>
                ` : '<p class="text-sm text-slate-500 italic mt-2">No unanswered messages recorded</p>'}
            </div>
        `;
    });

    detailsHtml += `
            </div>
            ${point.sample_contacts.length < point.contact_count ?
                `<div class="mt-4 p-3 bg-slate-800/30 rounded-lg border border-slate-700 text-center">
                    <p class="text-sm text-slate-400">
                        <i class="fas fa-info-circle mr-1"></i>
                        Showing ${point.sample_contacts.length} of ${point.contact_count} total contacts in this drop-off stage
                    </p>
                </div>`
                : ''}
        </div>
    `;

    // Create a modal
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="card-dark rounded-xl p-6 max-w-3xl w-full shadow-2xl">
            ${detailsHtml}
            <div class="flex gap-3 mt-6">
                <button onclick="this.closest('.fixed').remove()"
                        class="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-lg hover:from-blue-700 hover:to-blue-600 transition-all shadow-lg">
                    <i class="fas fa-times mr-2"></i>Close
                </button>
            </div>
        </div>
    `;
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
    document.body.appendChild(modal);
}

// =====================================================
// FOLLOW-UP PERFORMANCE TAB
// =====================================================

async function loadFollowupData() {
    const response = await fetch(`${API_BASE}/api/lead-analytics/${currentCompany}/followup-performance`);
    const data = await response.json();

    // Update summary cards - Row 1
    document.getElementById('totalTemplates').textContent = data.summary.total_templates;
    document.getElementById('totalSent').textContent = data.summary.total_sent.toLocaleString();
    document.getElementById('totalResponded').textContent = data.summary.total_responded.toLocaleString();
    document.getElementById('totalCustomers').textContent = data.summary.total_customers.toLocaleString();

    // Update summary cards - Row 2
    document.getElementById('avgResponseRate').textContent = data.summary.avg_response_rate;
    document.getElementById('avgCustomerRate').textContent = data.summary.avg_customer_rate;
    document.getElementById('avgResponseTime').textContent = data.summary.avg_response_time;

    if (data.summary.best_performing) {
        document.getElementById('bestTemplate').textContent =
            `${data.summary.best_performing.template_name} (${data.summary.best_performing.response_rate}%)`;
    }

    // Render templates table
    renderTemplatesTable(data.templates);
}

function renderTemplatesTable(templates) {
    const tbody = document.getElementById('templatesTableBody');
    tbody.innerHTML = '';

    if (templates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="px-6 py-4 text-center text-slate-400">No follow-up templates found</td></tr>';
        return;
    }

    templates.forEach(template => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-700/30';

        const tierColors = {
            'excellent': 'bg-green-500/20 text-green-400 border border-green-500/30',
            'good': 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
            'average': 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
            'poor': 'bg-red-500/20 text-red-400 border border-red-500/30'
        };

        const customerRate = template.customer_conversion_rate || 0;

        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">#${template.rank}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${template.template_name}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-slate-400">${template.total_sent}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-slate-400">${template.responded}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-400">${template.customers || 0}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-400">${template.response_rate}%</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-purple-400">${customerRate}%</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-slate-400">${template.avg_response_hours}h</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 py-1 text-xs font-semibold rounded-full ${tierColors[template.performance_tier]}">
                    ${template.performance_tier}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <button onclick="showTemplateResponses('${template.template_id}')"
                        class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors">
                    <i class="fas fa-comments mr-1"></i>View Responses
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// =====================================================
// PIPELINE TAB
// =====================================================

async function loadPipelineData() {
    const response = await fetch(`${API_BASE}/api/lead-analytics/${currentCompany}/pipeline`);
    const data = await response.json();

    // Update conversion metrics
    document.getElementById('convNewToContacted').textContent = data.conversion_rates.prospecting_to_contacted;
    document.getElementById('convContactedToEngaged').textContent = data.conversion_rates.win_rate;
    document.getElementById('convOverall').textContent = data.conversion_rates.overall_conversion;

    // Render pipeline chart
    renderPipelineChart(data.stages);

    // Render stage details
    renderStageDetails(data.stages);
}

function renderPipelineChart(stages) {
    const ctx = document.getElementById('pipelineChart');
    
    if (charts.pipeline) {
        charts.pipeline.destroy();
    }
    
    const stageColors = {
        'new_lead': '#3b82f6',
        'contacted': '#8b5cf6',
        'engaged': '#10b981',
        'stalled': '#f59e0b',
        'dormant': '#6b7280'
    };
    
    charts.pipeline = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: stages.map(s => s.stage_label),
            datasets: [{
                label: 'Number of Leads',
                data: stages.map(s => s.count),
                backgroundColor: stages.map(s => stageColors[s.stage] || '#9ca3af'),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const stage = stages[context.dataIndex];
                            return [
                                `Count: ${stage.count}`,
                                `Percentage: ${stage.percentage}`,
                                `Avg Days Dormant: ${stage.avg_days_dormant}`,
                                `Avg Engagement: ${(stage.avg_engagement * 100).toFixed(1)}%`
                            ];
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function renderStageDetails(stages) {
    const container = document.getElementById('stageDetails');
    container.innerHTML = '';

    // Define colors and icons for each stage
    const stageStyles = {
        'prospecting': { color: 'orange', icon: 'fa-search', border: 'border-orange-500' },
        'contacted': { color: 'blue', icon: 'fa-phone', border: 'border-blue-500' },
        'qualification': { color: 'cyan', icon: 'fa-clipboard-check', border: 'border-cyan-500' },
        'nurturing': { color: 'teal', icon: 'fa-seedling', border: 'border-teal-500' },
        'proposal': { color: 'purple', icon: 'fa-file-contract', border: 'border-purple-500' },
        'closing': { color: 'yellow', icon: 'fa-handshake', border: 'border-yellow-500' },
        'closed_won': { color: 'green', icon: 'fa-trophy', border: 'border-green-500' },
        'closed_lost': { color: 'red', icon: 'fa-times-circle', border: 'border-red-500' }
    };

    stages.forEach(stage => {
        const div = document.createElement('div');
        const customerCount = stage.customer_count || 0;
        const hasCustomers = customerCount > 0;
        const style = stageStyles[stage.stage] || { color: 'slate', icon: 'fa-question', border: 'border-slate-500' };

        div.className = `card-dark rounded-xl shadow-lg p-6 hover:shadow-${style.color}-500/10 transition-all border-l-4 ${style.border}`;
        div.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <div class="flex items-center gap-2">
                    <i class="fas ${style.icon} text-${style.color}-400"></i>
                    <h4 class="font-semibold text-white">${stage.stage_label}</h4>
                </div>
                ${hasCustomers ? '<i class="fas fa-star text-green-400"></i>' : ''}
            </div>
            <p class="text-3xl font-bold text-${style.color}-400 mb-1">${stage.count}</p>
            <p class="text-sm text-slate-400 mb-3">${stage.percentage} of total</p>

            ${hasCustomers ? `
                <div class="bg-green-500/10 border border-green-500/30 rounded-lg p-2 mb-3">
                    <p class="text-xs text-green-300 font-semibold">
                        <i class="fas fa-star mr-1"></i>${customerCount} Customers (${stage.customer_percentage})
                    </p>
                </div>
            ` : ''}

            <div class="space-y-1 text-xs text-slate-400">
                <p>Avg Days in Stage: <span class="font-semibold text-white">${stage.avg_days_dormant}</span></p>
                <p>Avg Engagement: <span class="font-semibold text-white">${(stage.avg_engagement * 100).toFixed(1)}%</span></p>
            </div>
        `;
        container.appendChild(div);
    });
}

// =====================================================
// AI MESSAGE GENERATOR
// =====================================================

let generatedMessages = new Map();

function showAIMessageGenerator() {
    if (selectedContacts.size === 0) {
        alert('Please select at least one contact to generate messages for');
        return;
    }
    
    document.getElementById('aiMessageModal').classList.remove('hidden');
    document.getElementById('selectedCount').textContent = `${selectedContacts.size} selected`;
    
    // Reset message preview
    const preview = document.getElementById('messagePreview');
    preview.innerHTML = `
        <div class="text-center text-slate-500 py-12">
            <i class="fas fa-robot text-4xl mb-3 text-indigo-400"></i>
            <p class="text-sm">Your AI-generated messages will appear here.</p>
            <p class="text-xs mt-2 text-slate-600">Click "Generate Messages" to begin.</p>
        </div>
    `;
    
    // Disable send button until messages are generated
    document.getElementById('sendMessagesBtn').disabled = true;
}

function closeAIMessageModal() {
    document.getElementById('aiMessageModal').classList.add('hidden');
    generatedMessages.clear();
}

async function generateAIMessages() {
    const style = document.getElementById('messageStyle').value;
    const tone = document.getElementById('messageTone').value;
    const keyPoints = document.getElementById('keyPoints').value;
    const customInstructions = document.getElementById('customInstructions').value;
    
    if (selectedContacts.size === 0) {
        alert('Please select at least one contact');
        return;
    }
    
    try {
        // Show loading state
        const preview = document.getElementById('messagePreview');
        preview.innerHTML = `
            <div class="text-center py-12">
                <i class="fas fa-spinner fa-spin text-4xl text-indigo-400 mb-3"></i>
                <p class="text-slate-300">Generating personalized messages...</p>
                <p class="text-xs text-slate-500 mt-2">This may take a moment.</p>
            </div>
        `;
        
        // Get contact details for selected contacts
        const response = await fetch(`${API_BASE}/api/lead-analytics/${currentCompany}/reactivation/candidates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contactIds: Array.from(selectedContacts),
                includeHistory: true
            })
        });
        
        if (!response.ok) throw new Error('Failed to fetch contact details');
        const { candidates } = await response.json();
        
        // Generate messages for each contact
        const messagePromises = candidates.map(async (contact) => {
            const message = await generateAIMessage(contact, { style, tone, keyPoints, customInstructions });
            return { contact, message };
        });
        
        const results = await Promise.all(messagePromises);
        
        // Store generated messages
        generatedMessages.clear();
        results.forEach(({ contact, message }) => {
            generatedMessages.set(contact.contact_id, { contact, message });
        });
        
        // Display messages
        renderAIMessages(results);
        
        // Enable send button
        document.getElementById('sendMessagesBtn').disabled = false;
        
    } catch (error) {
        console.error('Error generating messages:', error);
        const preview = document.getElementById('messagePreview');
        preview.innerHTML = `
            <div class="text-center py-12 text-red-400">
                <i class="fas fa-exclamation-triangle text-4xl mb-3"></i>
                <p class="text-sm">Failed to generate messages.</p>
                <p class="text-xs mt-2">${error.message || 'Please try again later.'}</p>
                <button onclick="generateAIMessages()" class="mt-4 text-indigo-400 hover:text-indigo-300 text-sm">
                    <i class="fas fa-sync-alt mr-1"></i> Retry
                </button>
            </div>
        `;
    }
}

async function generateAIMessage(contact, options) {
    const { style, tone, keyPoints, customInstructions } = options;
    
    // Prepare the prompt for the AI
    const prompt = `
        You are a helpful assistant that generates personalized reactivation messages for leads.
        
        Contact Details:
        - Name: ${contact.name || 'Not provided'}
        - Last Interaction: ${contact.last_interaction || 'Unknown'}
        - Last Stage: ${contact.last_stage || 'N/A'}
        - Dormant For: ${contact.days_dormant} days
        - Previous Messages: ${contact.message_history?.slice(0, 3).map(m => `[${m.date}] ${m.content}`).join('\n') || 'No recent messages'}
        
        Message Style: ${style}
        Tone: ${tone}
        ${keyPoints ? `Key Points to Include: ${keyPoints}\n` : ''}
        ${customInstructions ? `Additional Instructions: ${customInstructions}\n` : ''}
        
        Generate a personalized message to re-engage this lead. Keep it concise (1-2 short paragraphs).
    `;
    
    try {
        // Call your AI service (replace with your actual API call)
        const response = await fetch(`${API_BASE}/api/ai/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });
        
        if (!response.ok) throw new Error('AI service error');
        const { message } = await response.json();
        
        return message.trim();
    } catch (error) {
        console.error('Error generating AI message:', error);
        // Fallback message if AI service fails
        return `Hi${contact.name ? ` ${contact.name}` : ''}, I hope you're doing well! I noticed we haven't connected in a while. I'd love to catch up and see how we can assist you. Let me know a good time to talk!`;
    }
}

function renderAIMessages(messages) {
    const preview = document.getElementById('messagePreview');
    
    if (!messages || messages.length === 0) {
        preview.innerHTML = `
            <div class="text-center text-slate-500 py-12">
                <i class="fas fa-robot text-4xl mb-3 text-indigo-400"></i>
                <p class="text-sm">No messages were generated.</p>
                <p class="text-xs mt-2 text-slate-600">Please try again or adjust your settings.</p>
            </div>
        `;
        return;
    }
    
    preview.innerHTML = `
        <div class="space-y-6">
            ${messages.map(({ contact, message }, index) => `
                <div class="bg-slate-700/50 rounded-lg p-4">
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <h4 class="font-medium text-white">${contact.name || 'Contact'} (${contact.phone})</h4>
                            <p class="text-xs text-slate-400">
                                ${contact.last_stage ? `Last stage: ${formatStageName(contact.last_stage)} • ` : ''}
                                Dormant: ${contact.days_dormant} days
                            </p>
                        </div>
                        <div class="flex space-x-2">
                            <button onclick="regenerateMessage('${contact.contact_id}')" class="text-slate-400 hover:text-white" title="Regenerate">
                                <i class="fas fa-sync-alt text-xs"></i>
                            </button>
                            <button onclick="editMessage('${contact.contact_id}')" class="text-slate-400 hover:text-white" title="Edit">
                                <i class="fas fa-edit text-xs"></i>
                            </button>
                        </div>
                    </div>
                    <div class="bg-slate-800/50 p-3 rounded text-sm text-slate-200 whitespace-pre-line">
                        ${message.replace(/\n/g, '<br>')}
                            .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" class="text-blue-400 hover:underline" target="_blank">$1</a>')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

async function regenerateMessage(contactId) {
    const contact = generatedMessages.get(contactId)?.contact;
    if (!contact) return;
    
    const style = document.getElementById('messageStyle').value;
    const tone = document.getElementById('messageTone').value;
    const keyPoints = document.getElementById('keyPoints').value;
    const customInstructions = document.getElementById('customInstructions').value;
    
    try {
        const message = await generateAIMessage(contact, { style, tone, keyPoints, customInstructions });
        generatedMessages.set(contactId, { contact, message });
        
        // Re-render all messages
        renderAIMessages(Array.from(generatedMessages.values()));
    } catch (error) {
        console.error('Error regenerating message:', error);
        alert('Failed to regenerate message. Please try again.');
    }
}

function editMessage(contactId) {
    const messageData = generatedMessages.get(contactId);
    if (!messageData) return;
    
    const { contact, message } = messageData;
    const newMessage = prompt('Edit the message:', message);
    
    if (newMessage !== null && newMessage.trim() !== '') {
        generatedMessages.set(contactId, { contact, message: newMessage });
        renderAIMessages(Array.from(generatedMessages.values()));
    }
}

async function sendAIMessages() {
    if (generatedMessages.size === 0) {
        alert('No messages to send. Please generate messages first.');
        return;
    }
    
    if (!confirm(`Send ${generatedMessages.size} personalized messages?`)) {
        return;
    }
    
    try {
        const sendBtn = document.getElementById('sendMessagesBtn');
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Sending...';
        
        const messages = Array.from(generatedMessages.entries()).map(([contactId, { message }]) => ({
            contactId,
            message,
            timestamp: new Date().toISOString(),
            status: 'pending'
        }));
        
        const response = await fetch(`${API_BASE}/api/lead-analytics/${currentCompany}/reactivation/send-messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages })
        });
        
        if (!response.ok) throw new Error('Failed to send messages');
        
        const result = await response.json();
        
        if (result.success) {
            alert(`Successfully sent ${result.sentCount} messages!`);
            closeAIMessageModal();
            await loadReactivationData(); // Refresh the data
        } else {
            throw new Error(result.error || 'Failed to send messages');
        }
    } catch (error) {
        console.error('Error sending messages:', error);
        alert(`Error: ${error.message}`);
    } finally {
        const sendBtn = document.getElementById('sendMessagesBtn');
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i> Send to Selected';
    }
}

// =====================================================
// REACTIVATION TAB
// =====================================================

async function loadReactivationData() {
    try {
        // Default to showing all candidates (priority 5+)
        const response = await fetch(`${API_BASE}/api/lead-analytics/${currentCompany}/reactivation?minPriority=5&limit=100`);
        const data = await response.json();
        
        // Update summary cards
        document.getElementById('totalCandidates').textContent = data.total_candidates || 0;
        document.getElementById('highPriority').textContent = data.priority_distribution?.high || 0;
        document.getElementById('mediumPriority').textContent = data.priority_distribution?.medium || 0;
        
        // Render candidates table
        if (data.candidates) {
            renderCandidatesTable(data.candidates);
        }
    } catch (error) {
        console.error('Error loading reactivation data:', error);
        alert('Failed to load reactivation data. Please try again.');
    }
}

// =====================================================
// COMPANY ANALYSIS
// =====================================================

async function analyzeCompany() {
    if (!currentCompany) {
        alert('Please select a company first');
        return;
    }
    
    try {
        showLoadingState();
        // Call your analysis endpoint here
        const response = await fetch(`${API_BASE}/api/lead-analytics/${currentCompany}/analyze`);
        const data = await response.json();
        
        // Show analysis results (you'll need to implement this UI)
        alert(`Company analysis complete!\n\nKey Findings:\n- ${data.keyFindings.join('\n- ')}`);
        
        // Refresh the dashboard to show updated data
        await loadDashboard();
    } catch (error) {
        console.error('Error analyzing company:', error);
        alert('Failed to analyze company. Please try again.');
    } finally {
        showDashboardContent();
    }
}

// Function to format date in a readable format
function formatDate(dateString) {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  return date.toLocaleString();
}

// Function to log a contact attempt
async function logContact(contactId, message = '') {
  try {
    const response = await fetch(`/api/contacts/${contactId}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    
    const result = await response.json();
    if (!result.success) throw new Error(result.error || 'Failed to log contact');
    
    // Refresh the table to show updated contact info
    loadReactivationData();
    return result.data;
  } catch (error) {
    console.error('Error logging contact:', error);
    alert(`Failed to log contact: ${error.message}`);
    return null;
  }
}

// Function to show contact history in a modal
async function showContactHistory(contactId, contactName) {
  try {
    const response = await fetch(`/api/contacts/${contactId}/history`);
    const result = await response.json();
    
    if (!result.success) throw new Error(result.error || 'Failed to load contact history');
    
    // Create and show modal with contact history
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50';
    modal.onclick = (e) => e.target === modal && modal.remove();
    
    const historyHtml = result.data.length > 0 
      ? result.data.map(entry => `
          <div class="p-4 border-b border-slate-700">
            <div class="flex justify-between items-center">
              <span class="font-medium text-white">${formatDate(entry.contact_date)}</span>
              <span class="px-2 py-1 text-xs rounded-full bg-slate-700 text-slate-300">
                ${entry.status}
              </span>
            </div>
            ${entry.message ? `<p class="mt-2 text-slate-300">${entry.message}</p>` : ''}
          </div>
        `).join('')
      : '<p class="p-4 text-slate-400">No contact history found.</p>';
    
    modal.innerHTML = `
      <div class="bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onclick="event.stopPropagation()">
        <div class="p-6 border-b border-slate-700 flex justify-between items-center">
          <h3 class="text-xl font-bold text-white">Contact History: ${contactName || 'Contact'}</h3>
          <button onclick="this.closest('.bg-opacity-50').remove()" class="text-slate-400 hover:text-white">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <div class="overflow-y-auto flex-1">
          ${historyHtml}
        </div>
        <div class="p-4 border-t border-slate-700 flex justify-between items-center">
          <button 
            onclick="this.closest('.bg-opacity-50').remove()" 
            class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white"
          >
            Close
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
  } catch (error) {
    console.error('Error loading contact history:', error);
    alert(`Failed to load contact history: ${error.message}`);
  }
}

// Function to show contact log modal
function showContactLogModal(contactId, contactName) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50';
  modal.onclick = (e) => e.target === modal && modal.remove();
  
  modal.innerHTML = `
    <div class="bg-slate-800 rounded-xl shadow-2xl w-full max-w-md flex flex-col" onclick="event.stopPropagation()">
      <div class="p-6 border-b border-slate-700">
        <h3 class="text-xl font-bold text-white">Log Contact</h3>
        <p class="text-sm text-slate-400 mt-1">Log a contact attempt for ${contactName || 'this contact'}</p>
      </div>
      <div class="p-6">
        <div class="mb-4">
          <label class="block text-sm font-medium text-slate-300 mb-2">Notes</label>
          <textarea 
            id="contactNotes" 
            class="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            rows="4"
            placeholder="Add any notes about this contact..."
          ></textarea>
        </div>
      </div>
      <div class="p-4 border-t border-slate-700 flex justify-between">
        <button 
          onclick="this.closest('.bg-opacity-50').remove()" 
          class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white"
        >
          Cancel
        </button>
        <button 
          id="saveContactLog" 
          class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white"
        >
          Save Log
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add event listener for save button
  modal.querySelector('#saveContactLog').addEventListener('click', async () => {
    const notes = modal.querySelector('#contactNotes').value;
    await logContact(contactId, notes);
    modal.remove();
  });
}

function renderCandidatesTable(candidates) {
    const tbody = document.getElementById('candidatesTableBody');
    tbody.innerHTML = '';
    selectedContacts.clear();
    
    if (candidates.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="px-6 py-12 text-center">
                    <div class="flex flex-col items-center justify-center text-slate-400">
                        <i class="fas fa-user-clock text-4xl mb-3 opacity-50"></i>
                        <p class="text-lg font-medium">No reactivation candidates found</p>
                        <p class="text-sm mt-1">Check back later for new candidates</p>
                    </div>
                </td>
            </tr>`;
        return;
    }
    
    candidates.forEach((candidate, index) => {
        const tr = document.createElement('tr');
        tr.className = 'group hover:bg-slate-800/50 transition-colors border-b border-slate-700/50';
        
        const tierColors = {
            'high': 'bg-red-500/10 text-red-400 border-red-500/30',
            'medium': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
            'low': 'bg-blue-500/10 text-blue-400 border-blue-500/30'
        };
        
        const lastContact = candidate.last_contact 
            ? new Date(candidate.last_contact).toLocaleDateString() 
            : 'Never';
            
        const engagementColor = candidate.engagement_rate > 0.7 ? 'text-green-400' : 
                              candidate.engagement_rate > 0.3 ? 'text-yellow-400' : 'text-red-400';
        
        // Safely get first character of name for avatar
        const nameInitial = candidate.name && typeof candidate.name === 'string' 
            ? candidate.name.charAt(0).toUpperCase() 
            : '?';
            
        // Safely format priority tier display
        let priorityDisplay = 'N/A';
        if (candidate.priority_tier) {
            const tierText = String(candidate.priority_tier);
            priorityDisplay = tierText.charAt(0).toUpperCase() + tierText.slice(1);
        }
            
        tr.innerHTML = `
            <td class="px-4 py-3">
                <div class="flex items-center">
                    <div class="relative flex items-center h-5">
                        <input type="checkbox" 
                               class="contact-checkbox h-4 w-4 rounded border-slate-600 bg-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-800" 
                               data-contact-id="${candidate.contact_id || ''}">
                    </div>
                </div>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
                <div class="flex items-center">
                    <div class="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-slate-700 text-slate-300 font-medium group-hover:bg-slate-600 transition-colors">
                        ${nameInitial}
                    </div>
                    <div class="ml-4">
                        <div class="text-sm font-medium text-white">${candidate.name || 'Unknown Contact'}</div>
                        <div class="text-xs text-slate-400">${candidate.phone || 'No phone'}</div>
                    </div>
                </div>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
                <div class="flex items-center">
                    <div>
                        <div class="text-sm text-slate-300">${lastContact}</div>
                        <div class="text-xs text-slate-500">
                            ${candidate.contact_count ? `${candidate.contact_count} contacts` : 'Never contacted'}
                        </div>
                    </div>
                    ${candidate.last_contact ? `
                        <button 
                            onclick="event.stopPropagation(); showContactHistory('${candidate.contact_id || ''}', '${candidate.name || ''}')"
                            class="ml-2 p-1 text-slate-500 hover:text-indigo-400 transition-colors"
                            title="View contact history"
                        >
                            <i class="fas fa-history text-sm"></i>
                        </button>
                    ` : ''}
                </div>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
                <span class="px-2.5 py-1 text-xs font-medium rounded-full border ${tierColors[candidate.priority_tier] || 'bg-slate-700/50 text-slate-300 border-slate-600'}">
                    ${priorityDisplay}
                </span>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
                <div class="flex items-center">
                    <div class="w-full bg-slate-700 rounded-full h-2">
                        <div class="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full" style="width: ${candidate.engagement_rate * 100}%"></div>
                    </div>
                    <span class="ml-2 text-xs font-medium w-12 text-right ${engagementColor}">${(candidate.engagement_rate * 100).toFixed(0)}%</span>
                </div>
                <div class="text-xs text-slate-500 mt-1">Engagement</div>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
                <div class="text-sm text-slate-300">${candidate.days_dormant} days</div>
                <div class="text-xs text-slate-500">Inactive</div>
            </td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-slate-400">
                ${formatStageName(candidate.last_stage) || 'N/A'}
            </td>
            <td class="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                <div class="flex items-center justify-end space-x-2">
                    <button 
                        onclick="event.stopPropagation(); showContactLogModal('${candidate.contact_id || ''}', '${candidate.name || ''}')"
                        class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg transition-colors flex items-center"
                    >
                        <i class="fas fa-phone-alt mr-1.5 text-xs"></i>
                        Contacted
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
    
    // Add event listeners to checkboxes
    document.querySelectorAll('.contact-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const contactId = e.target.dataset.contactId;
            if (e.target.checked) {
                selectedContacts.add(contactId);
            } else {
                selectedContacts.delete(contactId);
            }
            
            // Update the selected count in the AI message modal if it's open
            const selectedCount = document.getElementById('selectedCount');
            if (selectedCount) {
                selectedCount.textContent = `${selectedContacts.size} selected`;
            }
        });
    });
    
    // Add event listeners to checkboxes
    document.querySelectorAll('.contact-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const contactId = e.target.dataset.contactId;
            if (e.target.checked) {
                selectedContacts.add(contactId);
            } else {
                selectedContacts.delete(contactId);
            }
        });
    });
}

function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll');
    const checkboxes = document.querySelectorAll('.contact-checkbox');
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAll.checked;
        const contactId = checkbox.dataset.contactId;
        if (selectAll.checked) {
            selectedContacts.add(contactId);
        } else {
            selectedContacts.delete(contactId);
        }
    });
}

async function triggerReactivation() {
    if (selectedContacts.size === 0) {
        alert('Please select at least one contact to reactivate');
        return;
    }
    
    if (!confirm(`Trigger reactivation campaign for ${selectedContacts.size} contacts?`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/lead-analytics/${currentCompany}/reactivation/trigger`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contactIds: Array.from(selectedContacts),
                templateId: 'default_reactivation', // TODO: Allow template selection
                autoSelect: false
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ ${data.message}\n\nNext steps:\n${data.next_steps.join('\n')}`);
            selectedContacts.clear();
            await loadReactivationData();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error triggering reactivation:', error);
        alert('Error triggering reactivation campaign');
    }
}

// =====================================================
// TAB SWITCHING
// =====================================================

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active', 'border-blue-600', 'text-blue-600');
        btn.classList.add('border-transparent', 'text-gray-500');
    });
    
    event.target.classList.add('active', 'border-blue-600', 'text-blue-600');
    event.target.classList.remove('border-transparent', 'text-gray-500');
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    
    document.getElementById(`${tabName}Tab`).classList.remove('hidden');
}

// =====================================================
// UI STATE MANAGEMENT
// =====================================================

function showLoadingState() {
    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('noCompanyState').classList.add('hidden');
    document.getElementById('dashboardContent').classList.add('hidden');
}

function showNoCompanyState() {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('noCompanyState').classList.remove('hidden');
    document.getElementById('dashboardContent').classList.add('hidden');
}

function showDashboardContent() {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('noCompanyState').classList.add('hidden');
    document.getElementById('dashboardContent').classList.remove('hidden');
}

// =====================================================
// TEMPLATE CONTENT VIEWER
// =====================================================

function showTemplateContent(template) {
    const content = template.template_content || 'No content available';

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="card-dark rounded-xl p-6 max-w-2xl w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h3 class="text-xl font-bold text-white">${template.template_name}</h3>
                    <p class="text-sm text-slate-400 mt-1">Template ID: ${template.template_id}</p>
                </div>
                <button onclick="this.closest('.fixed').remove()"
                        class="text-slate-400 hover:text-white text-2xl leading-none">
                    &times;
                </button>
            </div>

            <!-- Performance Stats -->
            <div class="grid grid-cols-4 gap-3 mb-4 p-4 bg-slate-800/50 rounded-lg">
                <div>
                    <p class="text-xs text-slate-400">Response Rate</p>
                    <p class="text-lg font-bold text-green-400">${template.response_rate}%</p>
                </div>
                <div>
                    <p class="text-xs text-slate-400">Total Sent</p>
                    <p class="text-lg font-bold text-blue-400">${template.total_sent}</p>
                </div>
                <div>
                    <p class="text-xs text-slate-400">Responded</p>
                    <p class="text-lg font-bold text-purple-400">${template.responded}</p>
                </div>
                <div>
                    <p class="text-xs text-slate-400">Customers</p>
                    <p class="text-lg font-bold text-yellow-400">${template.customers || 0}</p>
                    <p class="text-xs text-slate-500">${template.customer_conversion_rate || 0}% conversion</p>
                </div>
            </div>

            <!-- Template Content -->
            <div class="mb-4">
                <h4 class="text-sm font-semibold text-slate-300 mb-2">Follow-up Message:</h4>
                <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <p class="text-white whitespace-pre-wrap text-sm leading-relaxed">${content}</p>
                </div>
            </div>

            <button onclick="this.closest('.fixed').remove()"
                    class="w-full px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-lg hover:from-blue-700 hover:to-blue-600 transition-all">
                Close
            </button>
        </div>
    `;
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
    document.body.appendChild(modal);
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

function formatStageName(stage) {
    const names = {
        'never_contacted': 'Never Contacted',
        'never_replied': 'Never Replied',
        'stopped_replying': 'Stopped Replying',
        'went_dormant': 'Went Dormant',
        'awaiting_reply': 'Awaiting Reply',
        'active': 'Active',
        'initial_outreach': 'Initial Outreach',
        'mid_conversation': 'Mid Conversation',
        'dormant': 'Dormant'
    };
    return names[stage] || stage;
}

// =====================================================
// FOLLOW-UP RESPONSES MODAL
// =====================================================

async function showTemplateResponses(templateId) {
    const companyId = document.getElementById('companySelect').value;
    if (!companyId) return;

    const modal = document.getElementById('responsesModal');
    const content = document.getElementById('responsesModalContent');

    modal.classList.remove('hidden');
    content.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-4xl text-blue-500"></i><p class="text-slate-400 mt-4">Loading responses...</p></div>';

    try {
        const response = await fetch(`/api/lead-analytics/${companyId}/followup-responses?templateId=${templateId}`);
        const data = await response.json();

        console.log('Follow-up responses data:', data); // Debug log

        if (!data.success) {
            throw new Error(data.error);
        }

        const template = data.templates[0];
        console.log('Template data:', template); // Debug log
        if (!template || !template.contacts || template.contacts.length === 0) {
            content.innerHTML = '<p class="text-center text-slate-400">No responses found for this template.</p>';
            return;
        }

        // Ensure contacts is an array
        const contacts = Array.isArray(template.contacts) ? template.contacts : [];

        content.innerHTML = `
            <!-- Template Info -->
            <div class="bg-slate-700/30 rounded-lg p-4 mb-6 border border-slate-600">
                <h3 class="text-lg font-semibold text-white mb-2">${template.template_name}</h3>
                <p class="text-sm text-slate-300 mb-3">${template.template_content}</p>
                <div class="grid grid-cols-4 gap-4 text-center">
                    <div>
                        <p class="text-xs text-slate-400">Total Sent</p>
                        <p class="text-lg font-bold text-blue-400">${template.stats.total_sent}</p>
                    </div>
                    <div>
                        <p class="text-xs text-slate-400">Responded</p>
                        <p class="text-lg font-bold text-green-400">${template.stats.responded_count}</p>
                    </div>
                    <div>
                        <p class="text-xs text-slate-400">Customers</p>
                        <p class="text-lg font-bold text-yellow-400">${template.stats.customer_count}</p>
                    </div>
                    <div>
                        <p class="text-xs text-slate-400">Response Rate</p>
                        <p class="text-lg font-bold text-purple-400">${template.stats.response_rate}</p>
                    </div>
                </div>
            </div>

            <!-- Contacts List -->
            <div class="space-y-4">
                ${contacts.map(contact => `
                    <div class="bg-slate-700/30 rounded-lg p-4 border ${contact.is_customer ? 'border-yellow-500/50' : 'border-slate-600'}">
                        <div class="flex justify-between items-start mb-3">
                            <div>
                                <h4 class="text-white font-semibold flex items-center gap-2">
                                    ${contact.name || 'Unknown'}
                                    ${contact.is_customer ? '<span class="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded-full border border-yellow-500/30"><i class="fas fa-star mr-1"></i>Customer</span>' : ''}
                                    ${contact.responded ? '<span class="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full border border-green-500/30"><i class="fas fa-check mr-1"></i>Responded</span>' : '<span class="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full border border-red-500/30"><i class="fas fa-times mr-1"></i>No Response</span>'}
                                </h4>
                                <p class="text-sm text-slate-400">${contact.phone}</p>
                            </div>
                            <div class="text-right text-xs text-slate-400">
                                <p>Sent: ${new Date(contact.followup_sent_at).toLocaleDateString()}</p>
                                ${contact.avg_response_time_hours ? `<p>Avg Response: ${contact.avg_response_time_hours}h</p>` : ''}
                            </div>
                        </div>

                        ${contact.messages_after_followup && contact.messages_after_followup.length > 0 ? `
                            <div class="mt-3 space-y-2">
                                <p class="text-xs text-slate-400 font-semibold">Messages after follow-up:</p>
                                ${contact.messages_after_followup.slice(0, 5).reverse().map(msg => `
                                    <div class="flex ${msg.from_me ? 'justify-end' : 'justify-start'}">
                                        <div class="max-w-[80%] ${msg.from_me ? 'bg-blue-600/20 border-blue-500/30' : 'bg-slate-600/30 border-slate-500/30'} border rounded-lg px-3 py-2">
                                            <p class="text-xs ${msg.from_me ? 'text-blue-300' : 'text-slate-300'}">${msg.body || '[' + msg.type + ']'}</p>
                                            <p class="text-xs text-slate-500 mt-1">${new Date(msg.timestamp).toLocaleString()}</p>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        ` : '<p class="text-xs text-slate-500 italic mt-2">No messages recorded after follow-up</p>'}
                    </div>
                `).join('')}
            </div>
        `;

    } catch (error) {
        console.error('Error loading responses:', error);
        content.innerHTML = `<p class="text-center text-red-400">Error loading responses: ${error.message}</p>`;
    }
}

function closeResponsesModal() {
    document.getElementById('responsesModal').classList.add('hidden');
}

// Close modal on outside click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('responsesModal');
    if (e.target === modal) {
        closeResponsesModal();
    }
});
