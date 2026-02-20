# Contact Sync - WhatsApp Cloud API Compatibility Fix

## Problem
The Contact Sync Service was throwing an error: **"WhatsApp client not found for this company"** when trying to sync contacts for companies using WhatsApp Cloud API (Official API) instead of WhatsApp Web.js.

## Root Cause
The service was designed to work only with WhatsApp Web.js clients, which are stored in the `botMap`. However, companies using WhatsApp Cloud API don't have Web.js clients because they use the official Meta WhatsApp Business API instead.

## Solution
Updated `ContactSyncService.js` to support all three connection types:

1. **wwebjs** - WhatsApp Web.js (QR code method)
2. **official** - 360Dialog Cloud API
3. **meta_direct** - Meta Direct WhatsApp Business API

### Changes Made

1. **Modified `getWhatsAppClient()` method**
   - Changed from throwing an error to returning `null` when client not found
   - Now gracefully handles missing Web.js clients

2. **Added `usesCloudAPI()` method**
   - Checks `phone_configs` table for `connection_type = 'official' OR connection_type = 'meta_direct'`
   - Returns `true` if company uses any Cloud API type, `false` otherwise
   - Logs the specific connection type found for debugging

3. **Updated `formatContactsForSheets()` method**
   - Checks if company uses Cloud API before attempting to use Web.js features
   - Skips profile picture and business status checks for Cloud API users
   - Still syncs all contact data (phone, name, tags, message stats, etc.)

### What Works Now

#### For WhatsApp Web.js Users (QR Code Method)
- ✅ All contact data synced
- ✅ Profile pictures included
- ✅ Business account status included
- ✅ Message statistics included

#### For WhatsApp Cloud API Users (Official API or Meta Direct)
- ✅ All contact data synced
- ✅ Message statistics included
- ✅ No errors thrown
- ⚠️ Profile pictures not included (requires Web.js)
- ⚠️ Business account status not included (requires Web.js)

## Technical Details

### Connection Type Detection
```javascript
async usesCloudAPI() {
  const query = `
    SELECT connection_type 
    FROM phone_configs 
    WHERE company_id = $1 
    AND (connection_type = 'official' OR connection_type = 'meta_direct')
    LIMIT 1
  `;
  const result = await this.pool.query(query, [this.companyId]);
  
  if (result.rows.length > 0) {
    console.log(`Company uses Cloud API (${result.rows[0].connection_type})`);
    return true;
  }
  
  return false;
}
```

### Conditional Feature Usage
```javascript
// Check if company uses Cloud API
isCloudAPI = await this.usesCloudAPI();

if (isCloudAPI) {
  console.log(`Company uses WhatsApp Cloud API - skipping Web.js features`);
} else {
  // Try to get Web.js client for enhanced features
  client = this.getWhatsAppClient();
}

// Only use Web.js features if available and not Cloud API
if (client && !isCloudAPI) {
  profilePicUrl = await this.getProfilePicUrl(client, whatsappId);
  isBusiness = await this.isBusinessAccount(client, whatsappId);
}
```

## Testing

### To Test the Fix

1. **For Cloud API companies:**
   ```bash
   curl -X POST http://localhost:8443/api/sync/contacts-to-sheets \
     -H "Content-Type: application/json" \
     -d '{
       "companyId": "YOUR_CLOUD_API_COMPANY_ID"
     }'
   ```

2. **For Web.js companies:**
   ```bash
   curl -X POST http://localhost:8443/api/sync/contacts-to-sheets \
     -H "Content-Type: application/json" \
     -d '{
       "companyId": "YOUR_WEBJS_COMPANY_ID"
     }'
   ```

### Expected Results

- ✅ No errors for either connection type
- ✅ Contacts synced to Google Sheets
- ✅ Appropriate log messages indicating connection type
- ✅ Web.js companies get profile pictures and business status
- ✅ Cloud API companies get all other data without errors

## Database Schema

### phone_configs Table
```sql
CREATE TABLE phone_configs (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL,
  phone_index INT NOT NULL DEFAULT 0,
  connection_type VARCHAR(20) DEFAULT 'wwebjs',
  -- Connection types: 
  --   'wwebjs' - WhatsApp Web.js (QR code)
  --   'official' - 360Dialog Cloud API
  --   'meta_direct' - Meta Direct WhatsApp Business API
  ...
);
```

## Future Enhancements

Potential improvements for Cloud API users:

1. **Profile Pictures via Cloud API**
   - Use Meta Graph API to fetch profile pictures
   - Requires implementing `/v1/whatsapp_profile_pic` endpoint

2. **Business Account Detection**
   - Use Meta Business API to check business account status
   - May require additional API permissions

3. **Enhanced Contact Info**
   - Fetch contact details via Cloud API
   - Use `/v1/contacts` endpoint for additional metadata

## Related Files

- `services/ContactSyncService.js` - Main service file (fixed)
- `routes/contactSync.js` - API endpoint handler
- `spreadsheet/contactSyncSpreadsheet.js` - Google Sheets integration
- `migrations/001_phone_configs.sql` - Database schema

## Conclusion

The Contact Sync Service now works seamlessly with both WhatsApp Web.js and WhatsApp Cloud API connections, providing a consistent experience for all users while respecting the capabilities of each connection type.
