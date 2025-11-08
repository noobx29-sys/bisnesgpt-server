# BisnESGPT Backend API Documentation

## Base URL
```
https://bisnesgpt.jutateknologi.com
```

## Table of Contents
- [Authentication & User Management](#authentication--user-management)
- [Contact Management](#contact-management)
- [Tag Management](#tag-management)
- [Message Operations](#message-operations)
- [Message Scheduling](#message-scheduling)
- [Company & Bot Management](#company--bot-management)
- [AI Responses](#ai-responses)
- [Follow-up Templates](#follow-up-templates)
- [Split Testing](#split-testing)
- [Lead Analytics](#lead-analytics)
- [Facebook Lead Integration](#facebook-lead-integration)
- [Sync Operations](#sync-operations)
- [Quick Replies](#quick-replies)
- [Data Structures](#data-structures)

---

## Authentication & User Management

### Get User Configuration
**Endpoint:** `GET /api/user/config`

**Query Parameters:**
- `email` (required): User email address

**Response:**
```json
{
  "company_id": "string",
  "role": "string",
  "name": "string",
  "email": "string"
}
```

---

### Get User Context
**Endpoint:** `GET /api/user-context`

**Query Parameters:**
- `email` (required): User email address

**Response:**
```json
{
  "companyId": "string",
  "role": "string",
  "employees": [
    {
      "id": "string",
      "name": "string",
      "email": "string",
      "role": "string",
      "employeeId": "string",
      "phoneNumber": "string"
    }
  ],
  "phoneNames": {
    "0": "Phone 1",
    "1": "Phone 2"
  },
  "apiUrl": "string",
  "stopBot": false,
  "stopBots": {}
}
```

---

### Get User Page Context
**Endpoint:** `GET /api/user-page-context`

**Query Parameters:**
- `email` (required): User email address

**Response:**
```json
{
  "phoneNames": {
    "0": "Phone 1",
    "1": "Phone 2"
  }
}
```

---

### Get User Company Data
**Endpoint:** `GET /api/user-company-data`

**Query Parameters:**
- `email` (required): User email address

**Response:**
```json
{
  "companyId": "string",
  "accessToken": "string",
  "locationId": "string"
}
```

---

### Update User
**Endpoint:** `PUT /api/update-user`

**Request Body:**
```json
{
  "email": "string",
  "password": "string",
  "role": "string",
  "name": "string"
}
```

---

### Delete User
**Endpoint:** `DELETE /api/delete-user`

**Request Body:**
```json
{
  "email": "string"
}
```

---

### Login
**Endpoint:** `POST /api/login`

**Request Body:**
```json
{
  "email": "string",
  "password": "string"
}
```

---

### Forgot Password
**Endpoint:** `POST /api/forgot-password`

**Request Body:**
```json
{
  "phoneNumber": "string"
}
```

---

### Reset Password
**Endpoint:** `POST /api/reset-password`

**Request Body:**
```json
{
  "phoneNumber": "string",
  "code": "string",
  "newPassword": "string"
}
```

---

## Contact Management

### Get All Contacts
**Endpoint:** `GET /api/companies/{companyId}/contacts`

**Path Parameters:**
- `companyId` (required): Company identifier

**Query Parameters:**
- `email` (required): User email for authorization

**Response:**
```json
{
  "contacts": [
    {
      "contact_id": "string",
      "contactName": "string",
      "firstName": "string",
      "lastName": "string",
      "email": "string",
      "phone": "string",
      "company": "string",
      "tags": ["string"],
      "assignedTo": "string",
      "chat_id": "string",
      "createdAt": "string",
      "customFields": {
        "field_name": "value"
      },
      "branch": "string",
      "vehicleNumber": "string",
      "ic": "string",
      "expiryDate": "string",
      "pinned": false
    }
  ]
}
```

---

### Create Contact
**Endpoint:** `POST /api/contacts`

**Request Body:**
```json
{
  "contactName": "string",
  "lastName": "string",
  "email": "string",
  "phone": "string",
  "address1": "string",
  "companyName": "string",
  "locationId": "string",
  "branch": "string",
  "expiryDate": "string",
  "vehicleNumber": "string",
  "ic": "string",
  "notes": "string",
  "customFields": {
    "field_name": "value"
  },
  "tags": ["string"],
  "company_id": "string"
}
```

**Response:**
```json
{
  "success": true,
  "contact": {
    "contact_id": "string",
    "contactName": "string"
  }
}
```

---

### Bulk Create Contacts
**Endpoint:** `POST /api/contacts/bulk`

**Request Body:**
```json
{
  "contacts": [
    {
      "contactName": "string",
      "phone": "string",
      "email": "string",
      "tags": ["string"],
      "customFields": {}
    }
  ],
  "companyId": "string"
}
```

**Response:**
```json
{
  "success": true,
  "created": 10,
  "updated": 5,
  "failed": 0
}
```

---

### Update Contact
**Endpoint:** `PUT /api/contacts/{contact_id}`

**Path Parameters:**
- `contact_id` (required): Contact identifier

**Request Body:**
```json
{
  "contactName": "string",
  "email": "string",
  "phone": "string",
  "customFields": {},
  "tags": ["string"],
  "notes": "string"
}
```

---

### Update Contact Pinned Status
**Endpoint:** `PUT /api/contacts/{contact_id}/pinned`

**Request Body:**
```json
{
  "pinned": true,
  "companyId": "string"
}
```

---

### Delete Contact
**Endpoint:** `DELETE /api/contacts/{contact_id}`

**Query Parameters:**
- `companyId` (required): Company identifier

---

### Force Delete Contact
**Endpoint:** `DELETE /api/contacts/{contactId}/force`

**Query Parameters:**
- `companyId` (required): Company identifier

---

### Mass Delete Contacts
**Endpoint:** `DELETE /api/contacts/mass-delete`

**Request Body:**
```json
{
  "contactIds": ["string"],
  "companyId": "string"
}
```

---

### Mark Contact as Unread
**Endpoint:** `POST /api/contacts/{contactId}/mark-unread`

**Request Body:**
```json
{
  "companyId": "string"
}
```

---

### Mark Contact as Read
**Endpoint:** `POST /api/contacts/{contactId}/mark-read`

**Request Body:**
```json
{
  "companyId": "string"
}
```

---

### Import Contacts from CSV
**Endpoint:** `POST /api/import-csv/{companyId}`

**Request Body:**
```json
{
  "csvUrl": "string",
  "tags": ["string"]
}
```

---

### Assign Employee to Contact
**Endpoint:** `POST /api/contacts/{companyId}/{contactId}/assign-employee`

**Request Body:**
```json
{
  "employeeName": "string"
}
```

---

### Get Contact Assignments
**Endpoint:** `GET /api/contacts/{companyId}/{contactId}/assignments`

---

### Delete All Assignments for Contact
**Endpoint:** `DELETE /api/contacts/{companyId}/{contactId}/assignments`

---

### Delete Specific Assignment
**Endpoint:** `DELETE /api/assignments/contact/{contactId}`

**Request Body:**
```json
{
  "companyId": "string",
  "employeeId": "string"
}
```

---

## Tag Management

### Get All Tags
**Endpoint:** `GET /api/companies/{companyId}/tags`

**Response:**
```json
{
  "tags": [
    {
      "id": "string",
      "name": "string"
    }
  ]
}
```

---

### Create Tag
**Endpoint:** `POST /api/companies/{companyId}/tags`

**Request Body:**
```json
{
  "name": "string"
}
```

---

### Update Tag
**Endpoint:** `PUT /api/companies/{companyId}/tags/{tagId}`

**Request Body:**
```json
{
  "name": "string"
}
```

---

### Delete Tag
**Endpoint:** `DELETE /api/companies/{companyId}/tags/{tagId}`

---

### Add Tags to Contact
**Endpoint:** `POST /api/contacts/{companyId}/{contactId}/tags`

**Request Body:**
```json
{
  "tags": ["tag1", "tag2"]
}
```

---

### Remove Tags from Contact
**Endpoint:** `DELETE /api/contacts/{companyId}/{contactId}/tags`

**Request Body:**
```json
{
  "tags": ["tag1", "tag2"]
}
```

---

## Message Operations

### Get Messages
**Endpoint:** `GET /api/messages`

**Query Parameters:**
- `companyId` (required): Company identifier
- `contactId` (required): Contact identifier
- `phoneIndex` (optional): Phone index

---

### Get Paginated Messages
**Endpoint:** `GET /api/message-pages`

**Query Parameters:**
- `companyId` (required): Company identifier
- `contactId` (required): Contact identifier
- `page` (optional): Page number
- `limit` (optional): Items per page

---

### Search Messages
**Endpoint:** `GET /api/search-messages/{companyId}`

**Query Parameters:**
- `query` (required): Search query
- `phoneIndex` (optional): Phone index

---

### Send Text Message
**Endpoint:** `POST /api/v2/messages/text/{companyId}/{chatId}`

**Request Body:**
```json
{
  "message": "string",
  "userName": "string",
  "phoneIndex": 0
}
```

---

### Send Image Message
**Endpoint:** `POST /api/v2/messages/image/{companyId}/{chatId}`

**Request Body:**
```json
{
  "imageUrl": "string",
  "caption": "string",
  "phoneIndex": 0
}
```

---

### Send Audio Message
**Endpoint:** `POST /api/v2/messages/audio/{companyId}/{chatId}`

**Request Body:**
```json
{
  "audioUrl": "string",
  "phoneIndex": 0
}
```

---

### Send Video Message
**Endpoint:** `POST /api/v2/messages/video/{companyId}/{chatId}`

**Request Body:**
```json
{
  "videoUrl": "string",
  "caption": "string",
  "phoneIndex": 0
}
```

---

### Send Document Message
**Endpoint:** `POST /api/v2/messages/document/{companyId}/{chatId}`

**Request Body:**
```json
{
  "documentUrl": "string",
  "fileName": "string",
  "phoneIndex": 0
}
```

---

### React to Message
**Endpoint:** `POST /api/messages/react/{companyId}/{messageId}`

**Request Body:**
```json
{
  "emoji": "string",
  "phoneIndex": 0
}
```

---

### Edit Message
**Endpoint:** `PUT /api/v2/messages/{companyId}/{chatId}/{messageId}`

**Request Body:**
```json
{
  "newText": "string",
  "phoneIndex": 0
}
```

---

### Delete Message
**Endpoint:** `DELETE /api/v2/messages/{companyId}/{chatId}/{messageId}`

**Request Body:**
```json
{
  "phoneIndex": 0,
  "deleteForEveryone": false
}
```

---

## Message Scheduling

### Schedule Message
**Endpoint:** `POST /api/schedule-message/{companyId}`

**Request Body:**
```json
{
  "chatIds": ["string"],
  "message": "string",
  "messages": [
    {
      "chatId": "string",
      "message": "string",
      "contactData": {}
    }
  ],
  "batchQuantity": 10,
  "contact_id": ["string"],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "documentUrl": "string",
  "fileName": "string",
  "mediaUrl": "string",
  "mimeType": "string",
  "repeatInterval": 0,
  "repeatUnit": "minutes",
  "scheduledTime": "2024-01-01T10:00:00.000Z",
  "status": "scheduled",
  "v2": true,
  "phoneIndex": 0,
  "minDelay": 1,
  "maxDelay": 2,
  "activateSleep": false,
  "sleepAfterMessages": 20,
  "sleepDuration": 5,
  "multiple": true,
  "activeHours": {
    "start": "09:00",
    "end": "17:00"
  },
  "infiniteLoop": false,
  "numberOfBatches": 1
}
```

---

### Get Scheduled Messages
**Endpoint:** `GET /api/scheduled-messages`

**Query Parameters:**
- `companyId` (required): Company identifier

---

### Get Scheduled Messages for Contact
**Endpoint:** `GET /api/scheduled-messages/contact`

**Query Parameters:**
- `companyId` (required): Company identifier
- `contactId` (required): Contact identifier

---

### Update Scheduled Message
**Endpoint:** `PUT /api/schedule-message/{companyId}/{messageId}`

**Request Body:**
```json
{
  "message": "string",
  "messages": [],
  "processedMessages": [],
  "documentUrl": "string",
  "fileName": "string",
  "mediaUrl": "string",
  "mimeType": "string",
  "scheduledTime": "string",
  "status": "scheduled",
  "isConsolidated": true
}
```

---

### Delete Scheduled Message
**Endpoint:** `DELETE /api/schedule-message/{companyId}/{messageId}`

---

### Delete Scheduled Messages by Template
**Endpoint:** `DELETE /api/schedule-message/{companyId}/template/{templateId}/contact/{contactId}`

---

### Stop Scheduled Message
**Endpoint:** `POST /api/schedule-message/{companyId}/{messageId}/stop`

---

### Delete All Scheduled Messages for Contact
**Endpoint:** `DELETE /api/schedule-message/{companyId}/contact/{contactId}`

---

## Company & Bot Management

### Get Company Details
**Endpoint:** `GET /api/companies/{companyId}`

---

### Delete Company
**Endpoint:** `DELETE /api/companies/{companyId}`

---

### Get Company Config
**Endpoint:** `GET /api/company-config/{companyId}`

---

### Get Bot Status
**Endpoint:** `GET /api/bot-status/{companyId}`

**Response:**
```json
{
  "qrCode": "string",
  "status": "authenticated",
  "phoneInfo": true,
  "phones": [
    {
      "phoneIndex": 0,
      "status": "ready",
      "qrCode": null,
      "phoneInfo": "+1234567890"
    }
  ],
  "companyId": "string",
  "v2": true,
  "trialEndDate": "string",
  "apiUrl": "string",
  "phoneCount": 2
}
```

**Status Values:**
- `ready` / `authenticated`: Phone is connected
- `qr`: QR code needs to be scanned
- `loading`: Connection in progress
- `disconnected`: Not connected

---

### Get All Bot Statuses
**Endpoint:** `GET /api/bot-statuses`

---

### Get All Bots
**Endpoint:** `GET /api/bots`

---

### Update Bot Category
**Endpoint:** `PUT /api/bots/{botId}/category`

**Request Body:**
```json
{
  "category": "string"
}
```

---

### Delete Bot Trial End Date
**Endpoint:** `DELETE /api/bots/{botId}/trial-end-date`

---

### Reinitialize Bot
**Endpoint:** `POST /api/bots/reinitialize`

**Request Body:**
```json
{
  "botName": "string",
  "specificPhoneIndex": 0
}
```

---

### Disconnect Bot
**Endpoint:** `POST /api/bots/{botName}/disconnect`

**Request Body:**
```json
{
  "phoneIndex": 0
}
```

---

### Request Pairing Code
**Endpoint:** `POST /api/request-pairing-code/{botName}`

**Request Body:**
```json
{
  "phoneNumber": "string",
  "phoneIndex": 0
}
```

---

### Get Phone Status
**Endpoint:** `GET /api/phone-status/{companyId}`

---

### Update Phone Name
**Endpoint:** `PUT /api/update-phone-name`

**Request Body:**
```json
{
  "companyId": "string",
  "phoneIndex": 0,
  "name": "string"
}
```

---

### Get Employees Data
**Endpoint:** `GET /api/employees-data/{companyId}`

---

### Update Monthly Assignments
**Endpoint:** `POST /api/employees/update-monthly-assignments`

**Request Body:**
```json
{
  "companyId": "string",
  "employeeName": "string",
  "incrementValue": 1,
  "contactId": "string",
  "assignmentType": "manual"
}
```

---

### Get Company Statistics
**Endpoint:** `GET /api/stats/{companyId}`

---

### Get Dashboard Data
**Endpoint:** `GET /api/dashboard/{companyId}`

---

### Get Monthly Usage
**Endpoint:** `GET /api/companies/{companyId}/monthly-usage`

---

### Get Daily Usage
**Endpoint:** `GET /api/daily-usage/{companyId}`

---

### Get Contacts with Replies
**Endpoint:** `GET /api/companies/{companyId}/replies`

---

### Get Scheduled Messages Summary
**Endpoint:** `GET /api/companies/{companyId}/scheduled-messages-summary`

---

### Get Employee Stats
**Endpoint:** `GET /api/companies/{companyId}/employee-stats/{employeeId}`

---

## AI Responses

### Get AI Responses
**Endpoint:** `GET /api/ai-responses`

**Query Parameters:**
- `companyId` (required): Company identifier

---

### Create AI Response
**Endpoint:** `POST /api/ai-responses`

**Request Body:**
```json
{
  "companyId": "string",
  "type": "assign|tag|document|image|video|voice",
  "keywords": ["string"],
  "keywordSource": "incoming|outgoing|both",
  "actionData": {
    "employeeName": "string",
    "role": "string",
    "tags": ["string"],
    "url": "string",
    "fileName": "string",
    "mimeType": "string",
    "caption": "string"
  }
}
```

---

### Update AI Response
**Endpoint:** `PUT /api/ai-responses/{id}`

**Request Body:**
```json
{
  "keywords": ["string"],
  "keywordSource": "incoming|outgoing|both",
  "actionData": {}
}
```

---

### Delete AI Response
**Endpoint:** `DELETE /api/ai-responses/{id}`

**Query Parameters:**
- `companyId` (required): Company identifier

---

### AI Response Brainstorm
**Endpoint:** `POST /api/ai-response-brainstorm/`

**Request Body:**
```json
{
  "email": "string",
  "message": "string",
  "threadId": "string",
  "currentKeywords": ["string"],
  "currentResponse": "string",
  "conversationContext": "string"
}
```

---

## Follow-up Templates

### Get Follow-up Templates
**Endpoint:** `GET /api/followup-templates`

**Query Parameters:**
- `companyId` (required): Company identifier

---

### Create Follow-up Template
**Endpoint:** `POST /api/followup-templates`

**Request Body:**
```json
{
  "companyId": "string",
  "name": "string",
  "tagName": "string",
  "scheduleType": "interval|datetime",
  "intervalValue": 1,
  "intervalUnit": "minutes|hours|days",
  "scheduledDateTime": "2024-01-01T10:00:00.000Z"
}
```

---

### Update Follow-up Template
**Endpoint:** `PUT /api/followup-templates/{templateId}`

**Request Body:**
```json
{
  "name": "string",
  "tagName": "string",
  "scheduleType": "interval|datetime",
  "intervalValue": 1,
  "intervalUnit": "minutes|hours|days"
}
```

---

### Delete Follow-up Template
**Endpoint:** `DELETE /api/followup-templates/{templateId}`

---

### Get Template Messages
**Endpoint:** `GET /api/followup-templates/{templateId}/messages`

---

### Add Template Message
**Endpoint:** `POST /api/followup-templates/{templateId}/messages`

**Request Body:**
```json
{
  "text": "string",
  "delay": 1,
  "delayUnit": "minutes|hours|days",
  "type": "text|image|document|video|voice",
  "url": "string",
  "fileName": "string",
  "mimeType": "string",
  "caption": "string",
  "sequenceNumber": 1
}
```

---

### Update Template Message
**Endpoint:** `PUT /api/followup-templates/{templateId}/messages/{messageId}`

---

### Delete Template Message
**Endpoint:** `DELETE /api/followup-templates/{templateId}/messages/{messageId}`

---

### Follow-up Brainstorm
**Endpoint:** `POST /api/followup-brainstorm/`

**Request Body:**
```json
{
  "email": "string",
  "message": "string",
  "threadId": "string",
  "context": "string"
}
```

---

## Split Testing

### Get Variations
**Endpoint:** `GET /api/split-test/variations`

**Query Parameters:**
- `companyId` (required): Company identifier

---

### Save Variations
**Endpoint:** `POST /api/split-test/variations`

**Request Body:**
```json
{
  "companyId": "string",
  "variations": [
    {
      "id": "string",
      "name": "string",
      "instructions": "string",
      "isActive": true
    }
  ]
}
```

---

### Toggle Variation
**Endpoint:** `PATCH /api/split-test/variations/{variationId}/toggle`

**Request Body:**
```json
{
  "companyId": "string"
}
```

---

### Delete Variation
**Endpoint:** `DELETE /api/split-test/variations/{variationId}`

**Query Parameters:**
- `companyId` (required): Company identifier

---

### Get Performance Dashboard
**Endpoint:** `GET /api/split-test/performance`

**Query Parameters:**
- `companyId` (required): Company identifier

---

### Assign Customer to Variation
**Endpoint:** `POST /api/split-test/assign-customer`

**Request Body:**
```json
{
  "customerId": "string",
  "companyId": "string"
}
```

---

### Mark Customer as Closed
**Endpoint:** `POST /api/split-test/mark-closed`

**Request Body:**
```json
{
  "customerId": "string",
  "companyId": "string"
}
```

---

## Lead Analytics

### Get Bottleneck Analysis
**Endpoint:** `GET /api/lead-analytics/{companyId}/bottlenecks`

**Query Parameters:**
- `timeRange` (optional): Days to analyze (default: 120)

---

### Get Follow-up Performance
**Endpoint:** `GET /api/lead-analytics/{companyId}/followup-performance`

**Query Parameters:**
- `templateId` (optional): Filter by template

---

### Get Follow-up Responses
**Endpoint:** `GET /api/lead-analytics/{companyId}/followup-responses`

**Query Parameters:**
- `templateId` (optional): Filter by template

---

### Get Pipeline Visualization
**Endpoint:** `GET /api/lead-analytics/{companyId}/pipeline`

---

### Get Reactivation Candidates
**Endpoint:** `GET /api/lead-analytics/{companyId}/reactivation`

**Query Parameters:**
- `minPriority` (optional): Minimum priority (default: 5)
- `limit` (optional): Maximum results (default: 100)

---

### Trigger Reactivation Campaign
**Endpoint:** `POST /api/lead-analytics/{companyId}/reactivation/trigger`

**Request Body:**
```json
{
  "contactIds": ["string"],
  "templateId": "string",
  "minPriority": 5,
  "autoSelect": false
}
```

---

### Get Company Analysis
**Endpoint:** `GET /api/lead-analytics/{companyId}/analyze`

---

## Facebook Lead Integration

### Facebook Webhook Verification
**Endpoint:** `GET /api/facebook-lead-webhook`

**Query Parameters:**
- `hub.mode`: "subscribe"
- `hub.verify_token`: Verification token
- `hub.challenge`: Challenge string

---

### Facebook Lead Webhook Handler
**Endpoint:** `POST /api/facebook-lead-webhook`

---

### Get Facebook Token Status
**Endpoint:** `GET /api/facebook-token-status`

**Query Parameters:**
- `pageId` (required): Facebook page ID

---

### Get Facebook Form Mappings
**Endpoint:** `GET /api/facebook-form-mappings`

**Query Parameters:**
- `companyId` (required): Company identifier

---

### Create Form Mapping
**Endpoint:** `POST /api/facebook-form-mappings`

**Request Body:**
```json
{
  "companyId": "string",
  "formId": "string",
  "formName": "string",
  "pageId": "string",
  "pageName": "string",
  "welcomeMessage": "string"
}
```

---

### Update Form Mapping
**Endpoint:** `PUT /api/facebook-form-mappings/{id}`

---

### Delete Form Mapping
**Endpoint:** `DELETE /api/facebook-form-mappings/{id}`

---

### Get Facebook Leads
**Endpoint:** `GET /api/facebook-leads`

**Query Parameters:**
- `companyId` (required): Company identifier
- `startDate` (optional): Start date filter
- `endDate` (optional): End date filter

---

### Get Facebook Lead Analytics
**Endpoint:** `GET /api/facebook-lead-analytics`

**Query Parameters:**
- `companyId` (required): Company identifier

---

## Sync Operations

### Sync Contacts
**Endpoint:** `POST /api/sync-contacts/{companyId}`

---

### Sync Contact Names
**Endpoint:** `POST /api/sync-contact-names/{companyId}`

---

### Sync Single Contact
**Endpoint:** `POST /api/sync-single-contact/{companyId}`

**Request Body:**
```json
{
  "phoneNumber": "string"
}
```

---

### Sync Single Contact Name
**Endpoint:** `POST /api/sync-single-contact-name/{companyId}`

**Request Body:**
```json
{
  "phoneNumber": "string"
}
```

---

### Sync Firebase to Neon
**Endpoint:** `POST /api/sync-firebase-to-neon/{companyId}`

---

## Quick Replies

### Get Quick Replies
**Endpoint:** `GET /api/quick-replies`

**Query Parameters:**
- `email` (required): User email

---

### Create Quick Reply
**Endpoint:** `POST /api/quick-replies`

**Request Body:**
```json
{
  "email": "string",
  "shortcut": "string",
  "content": "string",
  "category": "string"
}
```

---

### Update Quick Reply
**Endpoint:** `PUT /api/quick-replies/{id}`

**Request Body:**
```json
{
  "email": "string",
  "shortcut": "string",
  "content": "string",
  "category": "string"
}
```

---

### Delete Quick Reply
**Endpoint:** `DELETE /api/quick-replies/{id}`

**Query Parameters:**
- `email` (required): User email

---

### Get Quick Reply Categories
**Endpoint:** `GET /api/quick-reply-categories`

**Query Parameters:**
- `email` (required): User email

---

## Assistant Files Management

### Upload File
**Endpoint:** `POST /api/upload-file`

**Request:** Multipart form data with file

---

### Save Assistant File Metadata
**Endpoint:** `POST /api/assistant-files`

**Request Body:**
```json
{
  "companyId": "string",
  "fileName": "string",
  "fileUrl": "string",
  "fileType": "string",
  "fileSize": 1024
}
```

---

### Get Assistant Files
**Endpoint:** `GET /api/assistant-files`

**Query Parameters:**
- `companyId` (required): Company identifier

---

### Delete Assistant File
**Endpoint:** `DELETE /api/assistant-files/{fileId}`

**Query Parameters:**
- `companyId` (required): Company identifier

---

## Auto-Reply Management

### Get Auto-Reply Status
**Endpoint:** `GET /api/auto-reply/status/{companyId}`

---

### Trigger Auto-Reply Check
**Endpoint:** `POST /api/auto-reply/trigger/{companyId}`

---

### Test Auto-Reply
**Endpoint:** `POST /api/auto-reply/test/{companyId}`

**Request Body:**
```json
{
  "phoneNumber": "string"
}
```

---

### Get Unreplied Messages
**Endpoint:** `GET /api/auto-reply/unreplied/{companyId}`

---

### Get Auto-Reply Settings
**Endpoint:** `GET /api/auto-reply/settings/{companyId}`

---

### Update Auto-Reply Settings
**Endpoint:** `POST /api/auto-reply/settings/{companyId}`

**Request Body:**
```json
{
  "enabled": true,
  "autoReplyHours": 24,
  "customMessage": "string"
}
```

---

### Manual Sync and Auto-Reply
**Endpoint:** `POST /api/manual-sync-auto-reply/{companyId}`

---

## Payment Integration (PayEx)

### Create Top-up Payment
**Endpoint:** `POST /api/payex/create-topup`

**Request Body:**
```json
{
  "companyId": "string",
  "amount": 100,
  "plan": "starter|professional|enterprise",
  "returnUrl": "string"
}
```

---

### PayEx Webhook
**Endpoint:** `POST /api/payex/webhook`

---

### Get Top-up History
**Endpoint:** `GET /api/payex/topup-history/{companyId}`

---

### Get Quota Status
**Endpoint:** `GET /api/payex/quota-status/{companyId}`

---

## Reports & Analytics

### Schedule Daily Report
**Endpoint:** `POST /api/daily-report/{companyId}`

**Request Body:**
```json
{
  "cronExpression": "0 9 * * *",
  "timezone": "Asia/Kuala_Lumpur",
  "targetNumber": "string"
}
```

---

### Trigger Daily Report
**Endpoint:** `POST /api/daily-report/{companyId}/trigger`

---

### Trigger Weekly Report
**Endpoint:** `POST /api/weekly-report/{companyId}/trigger`

---

### Trigger Health Report
**Endpoint:** `POST /api/health-report/trigger`

---

## Certificates

### Generate and Send Certificate
**Endpoint:** `POST /api/certificates/generate-and-send`

**Request Body:**
```json
{
  "phoneNumber": "string",
  "formId": "string",
  "formTitle": "string",
  "companyId": "string"
}
```

---

## Log Management

### Get Log Files
**Endpoint:** `GET /api/logs/files`

---

### Read Log File
**Endpoint:** `GET /api/logs/read/{filename}`

---

### Get Crash Summary
**Endpoint:** `GET /api/logs/crash-summary`

---

### Search Logs
**Endpoint:** `POST /api/logs/search`

**Request Body:**
```json
{
  "query": "string",
  "startDate": "string",
  "endDate": "string"
}
```

---

### Get Log Statistics
**Endpoint:** `GET /api/logs/stats`

---

### Download Log File
**Endpoint:** `GET /api/logs/download/{filename}`

---

### Rotate Logs
**Endpoint:** `POST /api/logs/rotate`

---

### Clean Old Logs
**Endpoint:** `POST /api/logs/clean`

---

### Log Custom Event
**Endpoint:** `POST /api/logs/event`

**Request Body:**
```json
{
  "level": "info|warn|error",
  "message": "string",
  "metadata": {}
}
```

---

## Queue Management

### Get Queue Diagnostics
**Endpoint:** `GET /api/queue/diagnose`

---

### Reset Queue
**Endpoint:** `POST /api/queue/reset`

---

### Force Process Queue
**Endpoint:** `POST /api/queue/force-process`

---

### Requeue Scheduled Messages
**Endpoint:** `POST /api/requeue-scheduled-messages`

---

### Cleanup Stale Jobs
**Endpoint:** `POST /api/queue/cleanup-stale`

---

### Cleanup Company-Specific Jobs
**Endpoint:** `POST /api/queue/cleanup-stale/{companyId}`

---

### Requeue Company Messages
**Endpoint:** `POST /api/queue/requeue/{companyId}`

---

### Cleanup Bot Jobs
**Endpoint:** `POST /api/cleanup-jobs/{botId}`

---

## Data Structures

### Contact Object
```typescript
interface Contact {
  contact_id: string;
  contactName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone: string;
  company?: string;
  companyName?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  tags?: string[];
  assignedTo?: string;
  locationId?: string;
  chat_id?: string;
  chat_pic_full?: string;
  profileUrl?: string;
  createdAt?: string;
  dateAdded?: string;
  dateUpdated?: string;
  branch?: string;
  vehicleNumber?: string;
  ic?: string;
  expiryDate?: string;
  pinned?: boolean;
  customFields?: {
    [key: string]: string;
  };
  notes?: string;
  company_id?: string;
  is_group?: boolean;
  last_updated?: string;
  unread_count?: number;
}
```

---

### Scheduled Message Object
```typescript
interface ScheduledMessage {
  id?: string;
  scheduleId?: string;
  chatIds: string[];
  message: string;
  messageContent: string;
  messages?: Array<{
    text: string;
    type?: string;
    url?: string;
    mimeType?: string;
    fileName?: string;
    caption?: string;
    isMain?: boolean;
  }>;
  contactId?: string;
  contactIds?: string[];
  multiple?: boolean;
  mediaUrl?: string;
  documentUrl?: string;
  mimeType?: string;
  fileName?: string;
  scheduledTime: string;
  batchQuantity: number;
  repeatInterval: number;
  repeatUnit: "minutes" | "hours" | "days";
  status: "scheduled" | "sent" | "failed";
  createdAt: Timestamp;
  sentAt?: Timestamp;
  error?: string;
  v2?: boolean;
  whapiToken?: string;
  phoneIndex: number;
  minDelay: number;
  maxDelay: number;
  activateSleep: boolean;
  sleepAfterMessages: number | null;
  sleepDuration: number | null;
  activeHours?: {
    start: string; // Format: "HH:MM" (24-hour)
    end: string;   // Format: "HH:MM" (24-hour)
  };
  infiniteLoop: boolean;
  numberOfBatches: number;
  processedMessages?: Array<{
    chatId: string;
    message: string;
    contactData?: ContactData;
  }>;
  isConsolidated?: boolean;
}
```

---

### AI Response Object
```typescript
interface AIResponse {
  id: string;
  company_id: string;
  type: "assign" | "tag" | "document" | "image" | "video" | "voice" | "followup";
  keywords: string[];
  keyword_source: "incoming" | "outgoing" | "both";
  action_data: {
    employeeName?: string;
    role?: string;
    tags?: string[];
    templateId?: string;
    url?: string;
    fileName?: string;
    mimeType?: string;
    caption?: string;
  };
  created_at: string;
  updated_at: string;
}
```

---

### Follow-up Template Object
```typescript
interface FollowUpTemplate {
  id: string;
  company_id: string;
  name: string;
  tag_name: string;
  schedule_type: "interval" | "datetime";
  interval_value?: number;
  interval_unit?: "minutes" | "hours" | "days";
  scheduled_datetime?: string;
  created_at: string;
  updated_at: string;
  messages: TemplateMessage[];
}

interface TemplateMessage {
  id: string;
  template_id: string;
  text: string;
  delay: number;
  delay_unit: "minutes" | "hours" | "days";
  type: "text" | "image" | "document" | "video" | "voice";
  url?: string;
  file_name?: string;
  mime_type?: string;
  caption?: string;
  sequence_number: number;
  created_at: string;
}
```

---

### Split Test Variation Object
```typescript
interface SplitTestVariation {
  id: string;
  company_id: string;
  name: string;
  instructions: string;
  is_active: boolean;
  customers: number;
  closed_customers: number;
  created_at: string;
  updated_at: string;
}
```

---

## Error Handling

All endpoints follow a consistent error response format:

```json
{
  "success": false,
  "error": "Error message description",
  "code": "ERROR_CODE"
}
```

**Common HTTP Status Codes:**
- `200`: Success
- `201`: Created
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `422`: Unprocessable Entity (Validation Error)
- `500`: Internal Server Error

---

## Rate Limiting

API endpoints may be rate-limited based on company plan:
- **Free Plan**: 100 requests/minute
- **Starter Plan**: 500 requests/minute
- **Professional Plan**: 2000 requests/minute
- **Enterprise Plan**: Unlimited

Check response headers:
- `X-RateLimit-Limit`: Maximum requests per time window
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Time when the limit resets

---

## WebSocket Events

The server supports WebSocket connections for real-time updates:

**Connection URL:** `wss://bisnesgpt.jutateknologi.com`

**Events:**
- `new-message`: New message received
- `message-status`: Message status update
- `bot-status`: Bot connection status change
- `qr-code`: QR code for authentication
- `contact-update`: Contact information updated

---

## Best Practices

1. **Authentication**: Always include user email in query parameters for user-scoped endpoints
2. **Batch Operations**: Use bulk endpoints for creating/updating multiple records
3. **Pagination**: For large datasets, implement pagination on the frontend
4. **Error Handling**: Always check the `success` field in responses
5. **Time Zones**: All timestamps are in ISO 8601 format and UTC timezone
6. **Active Hours**: When scheduling messages with `activeHours`, ensure times are in 24-hour format (HH:MM)
7. **Backwards Compatibility**: The `activeHours` field is optional in scheduled messages for backwards compatibility
8. **File Uploads**: Use multipart/form-data for file uploads with proper MIME types
9. **Phone Index**: Always specify phoneIndex when working with multi-phone setups
10. **Tag Management**: Use JSONB array format for tags in PostgreSQL queries

---

## Changelog

### Version 3.0 (Current - November 2024)
- Added Lead Analytics endpoints with bottleneck analysis
- Added Split Testing functionality
- Enhanced follow-up template system with AI brainstorming
- Added Facebook Lead Integration
- Implemented auto-reply management system
- Added PayEx payment integration
- Enhanced message scheduling with active hours support
- Added quick replies functionality
- Improved queue management system

### Version 2.0 (September 2024)
- Added `activeHours` support for scheduled messages
- Enhanced contact management with custom fields
- Improved tag management with bulk operations
- Added mass delete functionality for contacts
- Implemented AI response system

### Version 1.0 (Initial Release)
- Basic contact, tag, and message scheduling functionality
- WhatsApp Web.js integration
- Multi-phone support

---

## Support

For API support and questions:
- Email: support@jutateknologi.com
- Documentation: https://docs.bisnesgpt.com
- Status Page: https://status.bisnesgpt.com

---

## Security

- All API endpoints use HTTPS encryption
- CORS is configured for approved domains only
- Database connections use connection pooling with SSL
- Sensitive data is encrypted at rest
- Rate limiting prevents abuse
- Authentication tokens expire after 24 hours

---

*Last Updated: November 8, 2024*
