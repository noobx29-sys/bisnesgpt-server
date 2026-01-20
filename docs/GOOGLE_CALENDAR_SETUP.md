# Google Calendar Integration Setup

## ✅ Already Configured!

The Google Calendar integration uses your **existing** `sa_firebase.json` service account file. No additional setup needed!

## How It Works

The integration automatically uses:
- **Service Account File**: `sa_firebase.json` (symlinked to `service_account.json`)
- **Authentication**: Uses existing Firebase service account
- **Permissions**: Already has Google Calendar API access

## Setup Instructions (if needed)

### 1. Verify Service Account Permissions
Your existing service account should already have Calendar API access. If not:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select project: `onboarding-a5fcb`
3. Navigate to APIs & Services → Library
4. Search for "Google Calendar API" and enable it

### 2. Share Your Calendar (REQUIRED!)
**This step is critical for the integration to work:**

1. **Open Google Calendar** (https://calendar.google.com) with the `thealistmalaysia@gmail.com` account
2. **Go to Calendar Settings:**
   - Click the gear icon (⚙️) in the top right
   - Select "Settings"
   - In the left sidebar, click on the calendar you want to share (usually "thealistmalaysia@gmail.com")
3. **Share with service account:**
   - Scroll down to "Share with specific people"
   - Click "Add people"
   - Enter: `firebase-adminsdk-c26di@onboarding-a5fcb.iam.gserviceaccount.com`
   - Set permission to "See all event details" or "Make changes to events"
   - Click "Send"

⚠️ **Without this step, you'll get "Calendar not found or access denied" errors.**

### 3. No Environment Variables Needed
Unlike the original instructions, you don't need to add any environment variables. The integration uses the existing `service_account.json` pattern that's already used throughout your project.

## API Endpoints

### GET `/api/google-calendar/events`

**Query Parameters:**
```javascript
{
  "email": "user@example.com",           // User's email (required)
  "timeMin": "2024-01-20T00:00:00.000Z", // Start time in ISO format (required)
  "timeMax": "2024-01-20T23:59:59.999Z", // End time in ISO format (required)
  "calendarId": "primary"                // Calendar ID (optional, defaults to 'primary')
}
```

**Success Response:**
```json
{
  "success": true,
  "events": [
    {
      "summary": "Existing Meeting",
      "start": {
        "dateTime": "2024-01-20T10:00:00+08:00",
        "date": null
      },
      "end": {
        "dateTime": "2024-01-20T11:00:00+08:00",
        "date": null
      },
      "id": "event_id",
      "status": "confirmed",
      "transparency": null
    }
  ]
}
```

**Error Response:**
```json
{
  "success": false,
  "events": [],
  "error": "Error description"
}
```

### POST `/api/google-calendar/create-event`

**Request Body:**
```javascript
{
  "event": {
    "summary": "The A-List Introduction - John Doe",
    "description": "Appointment with John Doe\nPhone: +60123456789\nEmail: john@example.com\nStaff: Tika",
    "start": {
      "dateTime": "2025-08-12T10:00:00.000Z",
      "timeZone": "Asia/Kuala_Lumpur"
    },
    "end": {
      "dateTime": "2025-08-12T10:30:00.000Z", 
      "timeZone": "Asia/Kuala_Lumpur"
    },
    "attendees": [
      {
        "email": "john@example.com",
        "displayName": "John Doe"
      }
    ],
    "conferenceData": {
      "createRequest": {
        "requestId": "booking-1672531200000",
        "conferenceSolutionKey": {
          "type": "hangoutsMeet"
        }
      }
    }
  },
  "calendarId": "thealistmalaysia@gmail.com",
  "userEmail": "thealistmalaysia@gmail.com"
}
```

**Success Response:**
```json
{
  "success": true,
  "event": {
    "id": "event-id-from-google",
    "htmlLink": "https://calendar.google.com/event?eid=...",
    "hangoutLink": "https://meet.google.com/abc-defg-hij",
    "status": "confirmed",
    "created": "2025-08-12T02:30:00.000Z",
    "summary": "The A-List Introduction - John Doe",
    "start": {
      "dateTime": "2025-08-12T10:00:00+08:00",
      "timeZone": "Asia/Kuala_Lumpur"
    },
    "end": {
      "dateTime": "2025-08-12T10:30:00+08:00",
      "timeZone": "Asia/Kuala_Lumpur"
    },
    "attendees": [
      {
        "email": "john@example.com",
        "displayName": "John Doe",
        "responseStatus": "needsAction"
      }
    ],
    "conferenceData": {
      "conferenceId": "abc-defg-hij",
      "conferenceSolution": {
        "name": "Google Meet",
        "key": {
          "type": "hangoutsMeet"
        }
      }
    }
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error description"
}
```

## Features Implemented

✅ **User Authentication** - Validates user via email
✅ **Caching** - 5-minute cache to reduce API calls  
✅ **Error Handling** - Comprehensive error responses
✅ **Timezone Support** - Malaysia Time (GMT+08:00)
✅ **Rate Limiting** - Handles Google API rate limits
✅ **Security** - Validates user permissions
✅ **Filtering** - Excludes cancelled and transparent events
✅ **Performance** - Memory cache with cleanup

## Testing

### Quick Test:
```bash
# Test with primary calendar first (usually works without additional sharing)
curl "http://localhost:3000/api/google-calendar/events?email=thealistmalaysia@gmail.com&timeMin=2024-12-09T00:00:00.000Z&timeMax=2024-12-09T23:59:59.999Z&calendarId=primary"
```

### Expected Response:
```json
{
  "success": true,
  "events": [
    {
      "summary": "Meeting Title",
      "start": {
        "dateTime": "2024-12-09T10:00:00+08:00",
        "date": null
      },
      "end": {
        "dateTime": "2024-12-09T11:00:00+08:00",
        "date": null
      },
      "id": "event_id_123",
      "status": "confirmed"
    }
  ]
}
```

### Test with Different Calendar IDs:
```bash
# Primary calendar (works if service account has access to Google account)
curl "http://localhost:3000/api/google-calendar/events?email=thealistmalaysia@gmail.com&timeMin=2024-12-09T00:00:00Z&timeMax=2024-12-09T23:59:59Z&calendarId=primary"

# Specific calendar (ONLY works after sharing calendar with service account)
curl "http://localhost:3000/api/google-calendar/events?email=thealistmalaysia@gmail.com&timeMin=2024-12-09T00:00:00Z&timeMax=2024-12-09T23:59:59Z&calendarId=thealistmalaysia@gmail.com"
```

### 🔧 Troubleshooting:

**Error: "Calendar not found or access denied"**
- ✅ Make sure you've shared the calendar with the service account email
- ✅ Try using `calendarId=primary` instead of the specific email
- ✅ Verify the user email exists in your database
- ✅ Check that Google Calendar API is enabled in Google Cloud Console

**Error: "User not found"**
- ✅ Make sure `thealistmalaysia@gmail.com` exists in your `users` table in the database

## Security Notes

- Keep credentials secure and never commit to version control
- Use different service accounts for development and production
- Regularly rotate service account keys
- Monitor usage in Google Cloud Console
