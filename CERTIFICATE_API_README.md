# Certificate Generation & WhatsApp Sending API

This API endpoint automatically generates personalized certificates for participants and sends them via WhatsApp along with a thank you message.

## API Endpoint

```
POST /api/certificates/generate-and-send
```

## Request Body

```json
{
  "phoneNumber": "+60123456789",
  "formId": "form_123",
  "formTitle": "FUTUREX.AI 2025 Feedback Form",
  "companyId": "123456"
}
```

## Field Descriptions

### Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `phoneNumber` | string | Participant's phone number in international format | `"+60123456789"` |
| `formId` | string | Unique identifier for the feedback form | `"form_123"` |
| `formTitle` | string | Human-readable title of the form | `"FUTUREX.AI 2025 Feedback Form"` |
| `companyId` | string | Company identifier to determine WhatsApp account | `"123456"` |

## How It Works

### 1. Participant Lookup
- Fetches participant data from the Google Sheets CSV
- Searches for participant by phone number
- Extracts participant name and program date

### 2. Certificate Generation
- Creates a beautiful PDF certificate using Puppeteer
- Includes participant name and program date
- Uses professional design with gradients and styling

### 3. WhatsApp Integration
- Sends personalized thank you message
- Attaches the generated certificate as a PDF document
- Uses the company's WhatsApp account via botMap

## Response Format

### Success Response
```json
{
  "success": true,
  "message": "Certificate generation and WhatsApp sending completed successfully",
  "participantName": "John Doe",
  "filename": "John_Doe_FUTUREX.AI_2025_Certificate.pdf",
  "phoneNumber": "60123456789@c.us",
  "companyId": "123456"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Participant not found in CSV data",
  "details": "No participant found with phone number +60123456789"
}
```

## CSV Data Structure

The API expects CSV data from Google Sheets with these columns:

| Column | Description | Example |
|--------|-------------|---------|
| `Phone` or `Mobile Number` | Participant's phone number | `+60123456789` |
| `Full Name` or `Nama` | Participant's full name | `John Doe` |
| `Program Date & Time` | Event date (optional) | `7 August 2025` |

## Phone Number Formatting

The API automatically:
1. Removes all non-digits from phone numbers
2. Ensures it starts with "6" (Malaysia country code)
3. Formats as WhatsApp chat ID: `6XXXXXXXXX@c.us`

## WhatsApp Message Content

The API sends this exact message:

```
Dear [Participant Name]

Thank You for Attending FUTUREX.AI 2025

On behalf of the organizing team, we would like to extend our heartfelt thanks for your participation in FUTUREX.AI 2025 held on [Program Date].

Your presence and engagement in the Business Automation & AI Chatbot Experience session greatly contributed to the success of the event.

We hope the experience was insightful and inspiring as we continue to explore how artificial intelligence and robotics can shape the future.

We hope you can join our next event as well.

Please find your digital certificate of participation attached.

Warm regards,
Co9P AI Chatbot
```

## Certificate Design

The generated certificate features:
- Professional gradient background
- Company branding and logo
- Participant name prominently displayed
- Program details and date
- Professional typography and layout
- A4 format with proper margins

## Error Handling

### Common Error Scenarios

1. **Missing Required Fields**
   - Returns 400 status with field validation details

2. **Participant Not Found**
   - Returns 404 status when phone number not in CSV

3. **WhatsApp Client Not Available**
   - Returns 404 when company's WhatsApp client is offline

4. **CSV Fetch Failure**
   - Returns 500 status for network or parsing errors

## Testing

### Health Check
```
GET /api/certificates/health
```

### Test Request
```bash
curl -X POST http://localhost:3000/api/certificates/generate-and-send \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+60123456789",
    "formId": "test_form",
    "formTitle": "Test Feedback Form",
    "companyId": "123456"
  }'
```

## Dependencies

- **Puppeteer**: PDF generation from HTML
- **Axios**: CSV data fetching
- **WhatsApp Web.js**: WhatsApp message sending
- **UUID**: Unique file naming

## Security Considerations

- Phone numbers are validated and sanitized
- Temporary files are automatically cleaned up
- Company ID validation ensures proper WhatsApp account usage
- Rate limiting can be applied at the server level

## Performance Notes

- PDF generation takes 2-5 seconds depending on server resources
- WhatsApp sending is asynchronous and may take additional time
- CSV data is cached for the duration of the request
- Temporary files are cleaned up immediately after sending

## Troubleshooting

### Common Issues

1. **Puppeteer Launch Failures**
   - Ensure server has proper permissions for headless browser
   - Check if running in containerized environment

2. **WhatsApp Client Offline**
   - Verify company's WhatsApp account is connected
   - Check botMap configuration

3. **CSV Parsing Errors**
   - Verify Google Sheets URL is accessible
   - Check CSV format and encoding

4. **File Permission Errors**
   - Ensure `/tmp` directory is writable
   - Check disk space availability

## Future Enhancements

- Firebase/Cloud Storage integration for certificate persistence
- Multiple certificate templates support
- Batch processing for multiple participants
- Certificate verification system
- Analytics and tracking
