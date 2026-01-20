# Phone Management Frontend Implementation Guide

## Overview
This guide outlines the frontend changes needed to implement the phone management feature that allows companies to add and remove phones from their account.

## Backend API Endpoints Available

### 1. Get Phone Information
```
GET /api/companies/{companyId}/phones
```
**Response:**
```json
{
  "success": true,
  "companyId": "001",
  "phoneCount": 2,
  "maxPhones": 5,
  "plan": "business",
  "canAddPhone": true,
  "phones": [
    {
      "phoneIndex": 0,
      "status": "ready",
      "phoneInfo": "+60123456789",
      "qrCode": null,
      "canRemove": false
    },
    {
      "phoneIndex": 1,
      "status": "qr",
      "phoneInfo": null,
      "qrCode": "data:image/png;base64,...",
      "canRemove": true
    }
  ]
}
```

### 2. Add Phone
```
POST /api/companies/{companyId}/phones/add
```
**Response:**
```json
{
  "success": true,
  "message": "Phone 2 added successfully. Initialization in progress.",
  "companyId": "001",
  "previousPhoneCount": 1,
  "newPhoneCount": 2,
  "newPhoneIndex": 1,
  "status": "initializing"
}
```

### 3. Remove Phone
```
DELETE /api/companies/{companyId}/phones/{phoneIndex}
```
**Response:**
```json
{
  "success": true,
  "message": "Phone 2 removed successfully",
  "companyId": "001",
  "removedPhoneIndex": 1,
  "previousPhoneCount": 2,
  "newPhoneCount": 1
}
```

## Frontend Implementation Requirements

### 1. Phone Management Page/Component

#### UI Elements Needed:
- **Phone List Display**: Show all phones with their status
- **Add Phone Button**: With plan limit validation
- **Remove Phone Buttons**: For removable phones only
- **Status Indicators**: Visual status for each phone
- **QR Code Display**: For phones needing authentication
- **Plan Information**: Show current plan and limits

#### Example React Component Structure:
```jsx
function PhoneManagement({ companyId }) {
  const [phones, setPhones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [phoneCount, setPhoneCount] = useState(0);
  const [maxPhones, setMaxPhones] = useState(0);
  const [canAddPhone, setCanAddPhone] = useState(false);

  // Fetch phone data
  const fetchPhones = async () => {
    try {
      const response = await fetch(`/api/companies/${companyId}/phones`);
      const data = await response.json();
      
      if (data.success) {
        setPhones(data.phones);
        setPhoneCount(data.phoneCount);
        setMaxPhones(data.maxPhones);
        setCanAddPhone(data.canAddPhone);
      }
    } catch (error) {
      console.error('Error fetching phones:', error);
    } finally {
      setLoading(false);
    }
  };

  // Add new phone
  const handleAddPhone = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/companies/${companyId}/phones/add`, {
        method: 'POST'
      });
      const data = await response.json();
      
      if (data.success) {
        showNotification('Phone added successfully!', 'success');
        await fetchPhones(); // Refresh the list
      } else {
        showNotification(data.error, 'error');
      }
    } catch (error) {
      showNotification('Failed to add phone', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Remove phone
  const handleRemovePhone = async (phoneIndex) => {
    if (!confirm(`Are you sure you want to remove Phone ${phoneIndex + 1}?`)) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/companies/${companyId}/phones/${phoneIndex}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      
      if (data.success) {
        showNotification('Phone removed successfully!', 'success');
        await fetchPhones(); // Refresh the list
      } else {
        showNotification(data.error, 'error');
      }
    } catch (error) {
      showNotification('Failed to remove phone', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="phone-management">
      <h2>Phone Management</h2>
      
      {/* Plan Info */}
      <div className="plan-info">
        <p>Phones: {phoneCount} / {maxPhones}</p>
        <p>Plan: {plan}</p>
      </div>

      {/* Add Phone Button */}
      <button 
        onClick={handleAddPhone}
        disabled={!canAddPhone || loading}
        className="add-phone-btn"
      >
        {canAddPhone ? 'Add Phone' : `Limit Reached (${maxPhones})`}
      </button>

      {/* Phone List */}
      <div className="phones-list">
        {phones.map((phone) => (
          <PhoneCard
            key={phone.phoneIndex}
            phone={phone}
            onRemove={handleRemovePhone}
          />
        ))}
      </div>
    </div>
  );
}
```

### 2. Phone Card Component

```jsx
function PhoneCard({ phone, onRemove }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'ready': return 'green';
      case 'qr': return 'orange';
      case 'initializing': return 'blue';
      case 'disconnected': return 'red';
      default: return 'gray';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'ready': return 'Connected';
      case 'qr': return 'Scan QR Code';
      case 'initializing': return 'Initializing...';
      case 'disconnected': return 'Disconnected';
      default: return 'Unknown';
    }
  };

  return (
    <div className="phone-card">
      <div className="phone-header">
        <h3>Phone {phone.phoneIndex + 1}</h3>
        <span 
          className={`status-badge status-${phone.status}`}
          style={{ color: getStatusColor(phone.status) }}
        >
          {getStatusText(phone.status)}
        </span>
      </div>

      {/* Phone Info */}
      {phone.phoneInfo && (
        <p className="phone-number">{phone.phoneInfo}</p>
      )}

      {/* QR Code */}
      {phone.qrCode && (
        <div className="qr-code-container">
          <p>Scan this QR code with WhatsApp:</p>
          <img src={phone.qrCode} alt="QR Code" />
        </div>
      )}

      {/* Remove Button */}
      {phone.canRemove && (
        <button 
          onClick={() => onRemove(phone.phoneIndex)}
          className="remove-phone-btn"
        >
          Remove Phone
        </button>
      )}
    </div>
  );
}
```

### 3. Integration with Existing Bot Status

Update the existing bot status component to include phone management:

```jsx
// In your existing BotStatus component
function BotStatus({ companyId }) {
  // ... existing code ...

  return (
    <div className="bot-status">
      {/* Existing status display */}
      
      {/* Add Phone Management Link/Button */}
      <button onClick={() => navigate(`/company/${companyId}/phones`)}>
        Manage Phones ({phoneCount})
      </button>
    </div>
  );
}
```

### 4. Routing

Add route for phone management:

```jsx
// In your router configuration
<Route 
  path="/company/:companyId/phones" 
  element={<PhoneManagement />} 
/>
```

### 5. CSS Styles

```css
.phone-management {
  padding: 20px;
}

.plan-info {
  background: #f5f5f5;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.add-phone-btn {
  background: #007bff;
  color: white;
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 20px;
}

.add-phone-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.phones-list {
  display: grid;
  gap: 20px;
}

.phone-card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 20px;
  background: white;
}

.phone-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
}

.qr-code-container {
  text-align: center;
  margin: 15px 0;
}

.qr-code-container img {
  max-width: 200px;
  height: auto;
}

.remove-phone-btn {
  background: #dc3545;
  color: white;
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.phone-number {
  font-family: monospace;
  font-weight: bold;
  color: #333;
}
```

## User Experience Flow

### 1. Adding a Phone
1. User clicks "Add Phone" button
2. System validates plan limits
3. If allowed, phone is added and initialization begins
4. User sees new phone card with "Initializing..." status
5. When ready, QR code appears for scanning
6. After scanning, phone shows as "Connected"

### 2. Removing a Phone
1. User clicks "Remove Phone" on any removable phone
2. Confirmation dialog appears
3. If confirmed, phone is removed immediately
4. Phone list updates to reflect change

### 3. Error Handling
- Show clear error messages for plan limits
- Handle network errors gracefully
- Provide feedback for all actions

## Real-time Updates

Consider implementing WebSocket or polling to update phone status in real-time:

```jsx
// Poll for status updates
useEffect(() => {
  const interval = setInterval(fetchPhones, 10000); // Every 10 seconds
  return () => clearInterval(interval);
}, [companyId]);

// WebSocket alternative
useEffect(() => {
  const ws = new WebSocket(`ws://localhost:8443/ws/${companyId}`);
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'phone_status_update') {
      fetchPhones(); // Refresh phone data
    }
  };

  return () => ws.close();
}, [companyId]);
```

## Testing Checklist

- [ ] Can view all phones for a company
- [ ] Can add phone within plan limits
- [ ] Cannot add phone when limit reached
- [ ] Can remove phones (except phone 0)
- [ ] Cannot remove when only 1 phone exists
- [ ] QR codes display correctly
- [ ] Status updates work properly
- [ ] Error messages are clear
- [ ] Loading states are handled
- [ ] Responsive design works on mobile

## Plan Upgrade Integration

Consider adding a plan upgrade option when users hit their phone limit:

```jsx
{!canAddPhone && (
  <div className="upgrade-prompt">
    <p>You've reached your plan limit of {maxPhones} phones.</p>
    <button onClick={handleUpgradePlan}>
      Upgrade Plan for More Phones
    </button>
  </div>
)}
```

This completes the frontend implementation guide for the phone management feature!