# CRM Dashboard API Endpoints

This document describes the API endpoints created for the CRM dashboard to fetch attendance and event data from the Neon database.

## Base URL
All endpoints are prefixed with `/api`

## Authentication
All endpoints require a `company_id` query parameter for data security and filtering.

## Endpoints

### 1. Attendance Records Endpoint

**Endpoint:** `GET /api/attendance-records`

**Purpose:** Fetch all attendance records for a specific company

**Query Parameters:**
- `company_id` (required): The company ID to filter records
- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Number of records per page (default: 100, max: 1000)

**Example Request:**
```bash
GET /api/attendance-records?company_id=0380&page=1&limit=50
```

**Success Response (200):**
```json
{
  "success": true,
  "attendance_records": [
    {
      "id": "uuid",
      "event_id": "78387fc1-a028-4e52-8e49-ad6ab8e68e88",
      "event_slug": "business-automation-ai-chatbot-experience",
      "phone_number": "+60123456789",
      "confirmed_at": "2025-08-07 01:20:48.601",
      "company_id": "0380"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "total_pages": 3,
    "has_next": true,
    "has_prev": false
  }
}
```

**Error Response (422):**
```json
{
  "success": false,
  "error": "company_id is required"
}
```

**Error Response (422):**
```json
{
  "success": false,
  "error": "Invalid pagination parameters. page must be >= 1, limit must be between 1 and 1000"
}
```

### 2. Events Endpoint

**Endpoint:** `GET /api/events`

**Purpose:** Fetch all events for a specific company

**Query Parameters:**
- `company_id` (required): The company ID to filter events
- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Number of events per page (default: 100, max: 1000)

**Example Request:**
```bash
GET /api/events?company_id=0380&page=1&limit=25
```

**Success Response (200):**
```json
{
  "success": true,
  "events": [
    {
      "id": "78387fc1-a028-4e52-8e49-ad6ab8e68e88",
      "name": "Business Automation & AI Chatbot Experience",
      "slug": "business-automation-ai-chatbot-experience",
      "description": "Event description here",
      "start_date": "2025-08-07",
      "end_date": "2025-08-07",
      "start_time": "09:00:00",
      "end_time": "17:00:00",
      "location": "Event location",
      "company_id": "0380",
      "created_at": "2025-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 75,
    "total_pages": 3,
    "has_next": true,
    "has_prev": false
  }
}
```

**Error Response (422):**
```json
{
  "success": false,
  "error": "company_id is required"
}
```

**Error Response (422):**
```json
{
  "success": false,
  "error": "Invalid pagination parameters. page must be >= 1, limit must be between 1 and 1000"
}
```

## Database Schema

### Attendance Records Table
```sql
CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  event_slug VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  confirmed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  company_id VARCHAR(10) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Events Table
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  location VARCHAR(255),
  company_id VARCHAR(10) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Features

### Pagination
Both endpoints support pagination with the following features:
- Configurable page size (1-1000 records per page)
- Page navigation with `has_next` and `has_prev` flags
- Total count and total pages information
- Default page size of 100 records

### Security
- Company ID filtering ensures data isolation
- No cross-company data access possible
- Input validation for all parameters

### Performance
- Efficient database queries with proper indexing
- Connection pooling for database connections
- Rate limiting protection (60 requests per minute)

## Error Handling

All endpoints return appropriate HTTP status codes:
- **200**: Success
- **422**: Validation error (missing or invalid parameters)
- **500**: Internal server error

## Usage Examples

### Frontend Integration

```javascript
// Fetch attendance records
const fetchAttendanceRecords = async (companyId, page = 1, limit = 100) => {
  try {
    const response = await fetch(
      `/api/attendance-records?company_id=${companyId}&page=${page}&limit=${limit}`
    );
    const data = await response.json();
    
    if (data.success) {
      return {
        records: data.attendance_records,
        pagination: data.pagination
      };
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    console.error('Error fetching attendance records:', error);
    throw error;
  }
};

// Fetch events
const fetchEvents = async (companyId, page = 1, limit = 100) => {
  try {
    const response = await fetch(
      `/api/events?company_id=${companyId}&page=${page}&limit=${limit}`
    );
    const data = await response.json();
    
    if (data.success) {
      return {
        events: data.events,
        pagination: data.pagination
      };
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    console.error('Error fetching events:', error);
    throw error;
  }
};
```

### Calculate Attendance Statistics

```javascript
const calculateAttendanceStats = async (companyId) => {
  const { records } = await fetchAttendanceRecords(companyId, 1, 1000);
  const { events } = await fetchEvents(companyId, 1, 1000);
  
  const stats = events.map(event => {
    const eventAttendance = records.filter(record => record.event_id === event.id);
    return {
      event_id: event.id,
      event_name: event.name,
      event_slug: event.slug,
      total_attendance: eventAttendance.length,
      attendance_records: eventAttendance
    };
  });
  
  return stats;
};
```

## Testing

A test script is provided to verify endpoint functionality:

```bash
node test_endpoints.js
```

The test script will:
1. Test both endpoints with valid company IDs
2. Verify pagination functionality
3. Test error handling for missing parameters
4. Display sample data responses

## Dependencies

- Express.js for routing
- PostgreSQL with connection pooling
- UUID generation for unique identifiers
- Environment variables for database configuration

## Environment Variables

Ensure these environment variables are set:
- `DATABASE_URL`: Neon database connection string
- `PORT`: Server port (default: 3000)
