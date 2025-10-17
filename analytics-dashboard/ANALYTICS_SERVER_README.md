# Lead Analytics Server

Standalone analytics server with web dashboard for visualizing lead behavior, bottlenecks, follow-up performance, and reactivation opportunities.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Make sure your `.env` file has the database credentials:
```env
DATABASE_URL=your_neon_database_url
ANALYTICS_PORT=3001
```

### 3. Start the Server
```bash
# Using the startup script
chmod +x start-analytics.sh
./start-analytics.sh

# Or directly with node
node analytics-server.js

# Or with auto-reload during development
npm run dev
```

### 4. Access the Dashboard
Open your browser and navigate to:
```
http://localhost:3001
```

## 📊 Features

### Dashboard Tabs

#### 1. **Bottlenecks**
- Visual funnel showing where leads drop off
- Response stage distribution chart
- Drop-off point analysis
- Reply rate and active rate metrics

#### 2. **Follow-up Performance**
- Template performance comparison
- Response rate rankings
- Best/worst performing templates
- Average response time per template

#### 3. **Pipeline**
- Lead distribution across 5 stages:
  - New Lead
  - Initial Contact
  - Engaged
  - Stalled
  - Dormant
- Conversion rates between stages
- Stage-specific metrics

#### 4. **Reactivation**
- List of reactivation candidates
- Priority scoring (1-10)
- Filter by priority level
- Bulk reactivation campaign trigger

## 🔌 API Endpoints

All endpoints are available at `http://localhost:3001/api/lead-analytics`

### Available Endpoints

```
GET  /api/companies
GET  /api/health
GET  /api/lead-analytics/:companyId/bottlenecks
GET  /api/lead-analytics/:companyId/followup-performance
GET  /api/lead-analytics/:companyId/pipeline
GET  /api/lead-analytics/:companyId/reactivation
POST /api/lead-analytics/:companyId/reactivation/trigger
```

See `LEAD_ANALYTICS_README.md` for detailed API documentation.

## 📁 Project Structure

```
bisnesgpt-server/
├── analytics-server.js           # Main server file
├── analytics-dashboard/           # Web dashboard
│   ├── index.html                # Dashboard UI
│   └── app.js                    # Frontend logic
├── routes/
│   └── leadAnalytics.js          # API routes
├── contactTagger.js              # Analytics data generator
├── start-analytics.sh            # Startup script
└── package-analytics.json        # Dependencies
```

## 🔄 Data Flow

1. **Contact Tagger** analyzes messages and stores analytics in `contacts.custom_fields.analytics`
2. **Analytics Server** reads this data and exposes it via API
3. **Web Dashboard** visualizes the data with charts and tables

## 🛠️ Development

### Running in Development Mode
```bash
npm run dev
```
This uses `nodemon` to auto-reload on file changes.

### Changing the Port
```bash
export ANALYTICS_PORT=4000
node analytics-server.js
```

Or update `.env`:
```env
ANALYTICS_PORT=4000
```

## 📝 Usage Examples

### 1. View Bottlenecks
1. Select a company from the dropdown
2. Click on "Bottlenecks" tab
3. View the funnel chart and drop-off analysis

### 2. Compare Follow-up Templates
1. Go to "Follow-up Performance" tab
2. See ranked list of templates
3. Identify best/worst performers

### 3. Visualize Pipeline
1. Go to "Pipeline" tab
2. See lead distribution across stages
3. Check conversion rates

### 4. Trigger Reactivation Campaign
1. Go to "Reactivation" tab
2. Filter by priority (e.g., ≥7)
3. Select contacts to reactivate
4. Click "Trigger Campaign"

## 🔧 Troubleshooting

### Server won't start
- Check if port 3001 is already in use
- Verify database credentials in `.env`
- Ensure all dependencies are installed

### No data showing
- Run the contact tagger first to populate analytics data
- Check if the selected company has contacts
- Verify database connection

### Charts not rendering
- Check browser console for errors
- Ensure Chart.js is loading (check network tab)
- Try refreshing the page

## 🚀 Production Deployment

### Using PM2
```bash
pm2 start analytics-server.js --name "lead-analytics"
pm2 save
pm2 startup
```

### Using Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3001
CMD ["node", "analytics-server.js"]
```

### Environment Variables
```env
NODE_ENV=production
ANALYTICS_PORT=3001
DATABASE_URL=your_production_database_url
```

## 📊 Performance

- Lightweight: ~50MB RAM usage
- Fast queries: Uses indexed JSONB queries
- Scalable: Can handle 100k+ contacts
- Responsive: Dashboard loads in <2 seconds

## 🔐 Security

- CORS enabled for cross-origin requests
- No authentication (add if needed)
- SQL injection protected (parameterized queries)
- XSS protected (sanitized inputs)

## 📈 Monitoring

Check server health:
```bash
curl http://localhost:3001/api/health
```

Response:
```json
{
  "success": true,
  "service": "Lead Analytics Server",
  "status": "running",
  "timestamp": "2025-10-16T10:00:00.000Z"
}
```

## 🤝 Integration

### With Main Server
The analytics server is completely independent and can run alongside your main server:
- Main server: `http://localhost:3000`
- Analytics server: `http://localhost:3001`

### With Frontend
```javascript
const ANALYTICS_API = 'http://localhost:3001/api/lead-analytics';

// Fetch bottlenecks
const response = await fetch(`${ANALYTICS_API}/0210/bottlenecks`);
const data = await response.json();
```

## 📝 Notes

- Analytics data is updated when contact tagger runs
- Dashboard auto-refreshes on company selection
- All timestamps are in ISO 8601 format
- Charts use Chart.js for visualization
- Responsive design works on mobile/tablet

## 🆘 Support

For issues or questions:
1. Check the logs: `tail -f analytics-server.log`
2. Verify database connection
3. Check API responses in browser DevTools
4. Review `LEAD_ANALYTICS_README.md` for API details
