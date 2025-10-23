// Reactivation Manager Component
// Handles CRUD operations for reactivation candidates

class ReactivationManager {
  constructor(companyId) {
    this.companyId = companyId;
    this.initializeUI();
    this.loadReactivationCandidates();
  }

  // Initialize the UI elements
  initializeUI() {
    const container = document.createElement('div');
    container.className = 'reactivation-manager';
    container.innerHTML = `
      <div class="bg-white rounded-lg shadow-sm p-6">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-xl font-semibold text-gray-900">Reactivation Manager</h2>
          <button id="addReactivationBtn" class="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            + Add to Reactivation
          </button>
        </div>
        
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Eligible</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Updated</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody id="reactivationTableBody" class="bg-white divide-y divide-gray-200">
              <!-- Rows will be added dynamically -->
              <tr>
                <td colspan="6" class="px-6 py-4 text-center text-gray-500">Loading reactivation candidates...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Reactivation Modal -->
      <div id="reactivationModal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full">
        <div class="relative top-20 mx-auto p-5 border w-1/2 shadow-lg rounded-md bg-white">
          <div class="mt-3 text-left">
            <h3 class="text-lg leading-6 font-medium text-gray-900 mb-4">
              <span id="modalTitle">Add to Reactivation</span>
              <button id="closeModal" class="float-right text-gray-400 hover:text-gray-500">
                &times;
              </button>
            </h3>
            
            <form id="reactivationForm" class="space-y-4">
              <input type="hidden" id="contactId">
              
              <div>
                <label class="flex items-center">
                  <input type="checkbox" id="eligible" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                  <span class="ml-2 text-sm text-gray-700">Eligible for Reactivation</span>
                </label>
              </div>
              
              <div>
                <label for="priority" class="block text-sm font-medium text-gray-700">Priority (1-10)</label>
                <select id="priority" class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">
                  ${Array.from({length: 10}, (_, i) => i + 1).map(n => 
                    `<option value="${n}">${n} - ${n <= 3 ? 'High' : n <= 7 ? 'Medium' : 'Low'}</option>`
                  ).join('')}
                </select>
              </div>
              
              <div>
                <label for="notes" class="block text-sm font-medium text-gray-700">Notes</label>
                <textarea id="notes" rows="3" class="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 mt-1 block w-full sm:text-sm border border-gray-300 rounded-md p-2"></textarea>
              </div>
              
              <div class="flex justify-end space-x-3 pt-4">
                <button type="button" id="cancelBtn" class="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                  Cancel
                </button>
                <button type="submit" class="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    // Add the container to the reactivation tab
    const reactivationTab = document.querySelector('#reactivation-tab');
    if (reactivationTab) {
      reactivationTab.appendChild(container);
      this.bindEvents();
    } else {
      console.error('Reactivation tab not found');
    }
  }

  // Bind event listeners
  bindEvents() {
    // Add button
    document.getElementById('addReactivationBtn')?.addEventListener('click', () => this.showModal());
    
    // Modal close buttons
    document.getElementById('closeModal')?.addEventListener('click', () => this.hideModal());
    document.getElementById('cancelBtn')?.addEventListener('click', () => this.hideModal());
    
    // Form submission
    document.getElementById('reactivationForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveReactivationData();
    });
  }

  // Show the modal for adding/editing
  showModal(contact = null) {
    const modal = document.getElementById('reactivationModal');
    const modalTitle = document.getElementById('modalTitle');
    const form = document.getElementById('reactivationForm');
    
    if (contact) {
      // Edit mode
      modalTitle.textContent = 'Edit Reactivation';
      document.getElementById('contactId').value = contact.contact_id;
      document.getElementById('eligible').checked = contact.eligible === true || contact.eligible === 'true';
      document.getElementById('priority').value = contact.priority || 5;
      document.getElementById('notes').value = contact.notes || '';
    } else {
      // Add mode
      modalTitle.textContent = 'Add to Reactivation';
      form.reset();
      document.getElementById('contactId').value = '';
    }
    
    modal.classList.remove('hidden');
  }

  // Hide the modal
  hideModal() {
    const modal = document.getElementById('reactivationModal');
    modal.classList.add('hidden');
  }

  // Load reactivation candidates from the server
  async loadReactivationCandidates() {
    const tbody = document.getElementById('reactivationTableBody');
    if (!tbody) return;
    
    try {
      const response = await fetch(`/api/lead-analytics/${this.companyId}/reactivation`);
      const data = await response.json();
      
      if (data.success) {
        this.renderReactivationTable(data.candidates || []);
      } else {
        throw new Error(data.error || 'Failed to load reactivation candidates');
      }
    } catch (error) {
      console.error('Error loading reactivation candidates:', error);
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="px-6 py-4 text-center text-red-500">
            Error loading reactivation candidates: ${error.message}
          </td>
        </tr>`;
    }
  }

  // Render the reactivation candidates table
  renderReactivationTable(candidates) {
    const tbody = document.getElementById('reactivationTableBody');
    if (!tbody) return;
    
    if (candidates.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="px-6 py-4 text-center text-gray-500">
            No reactivation candidates found. Click "Add to Reactivation" to add contacts.
          </td>
        </tr>`;
      return;
    }
    
    tbody.innerHTML = candidates.map(contact => `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
          ${contact.name || 'No Name'}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${contact.phone || 'N/A'}
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
            ${contact.eligible === 'true' || contact.eligible === true ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
            ${contact.eligible === 'true' || contact.eligible === true ? 'Yes' : 'No'}
          </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          <span class="px-2 py-1 rounded-full text-xs font-medium 
            ${contact.priority <= 3 ? 'bg-red-100 text-red-800' : 
              contact.priority <= 7 ? 'bg-yellow-100 text-yellow-800' : 
              'bg-green-100 text-green-800'}">
            ${contact.priority} (${contact.priority <= 3 ? 'High' : contact.priority <= 7 ? 'Medium' : 'Low'})
          </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${contact.updated_at ? new Date(contact.updated_at).toLocaleString() : 'Never'}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          <button class="text-indigo-600 hover:text-indigo-900 mr-3 edit-btn" data-contact='${JSON.stringify(contact).replace(/'/g, "\\'")}'>
            Edit
          </button>
          <button class="text-red-600 hover:text-red-900 delete-btn" data-contact-id="${contact.contact_id}">
            Remove
          </button>
        </td>
      </tr>
    `).join('');
    
    // Add event listeners to dynamically created buttons
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const contact = JSON.parse(btn.dataset.contact);
        this.showModal(contact);
      });
    });
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (confirm('Are you sure you want to remove this contact from reactivation?')) {
          this.deleteReactivationData(btn.dataset.contactId);
        }
      });
    });
  }

  // Save reactivation data
  async saveReactivationData() {
    const form = document.getElementById('reactivationForm');
    const contactId = document.getElementById('contactId').value;
    const eligible = document.getElementById('eligible').checked;
    const priority = parseInt(document.getElementById('priority').value) || 5;
    const notes = document.getElementById('notes').value;

    try {
      const response = await fetch(`/api/lead-analytics/${this.companyId}/reactivation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contactId,
          eligible,
          priority,
          notes
        })
      });

      const data = await response.json();

      if (data.success) {
        this.hideModal();
        await this.loadReactivationCandidates();
        this.showToast('Reactivation data saved successfully', 'success');
      } else {
        throw new Error(data.error || 'Failed to save reactivation data');
      }
    } catch (error) {
      console.error('Error saving reactivation data:', error);
      this.showToast(`Error: ${error.message}`, 'error');
    }
  }

  // Delete reactivation data
  async deleteReactivationData(contactId) {
    if (!confirm('Are you sure you want to remove this contact from reactivation?')) {
      return;
    }

    try {
      const response = await fetch(`/api/lead-analytics/${this.companyId}/reactivation/${contactId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        await this.loadReactivationCandidates();
        this.showToast('Contact removed from reactivation', 'success');
      } else {
        throw new Error(data.error || 'Failed to delete reactivation data');
      }
    } catch (error) {
      console.error('Error deleting reactivation data:', error);
      this.showToast(`Error: ${error.message}`, 'error');
    }
  }

  // Trigger reactivation for selected contacts
  async triggerReactivation(contactIds) {
    if (!contactIds || contactIds.length === 0) {
      this.showToast('No contacts selected for reactivation', 'warning');
      return;
    }

    if (!confirm(`Are you sure you want to trigger reactivation for ${contactIds.length} contacts?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/lead-analytics/${this.companyId}/reactivation/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contactIds
        })
      });

      const data = await response.json();

      if (data.success) {
        this.showToast(`Reactivation triggered for ${data.contacts.length} contacts`, 'success');
        await this.loadReactivationCandidates();
      } else {
        throw new Error(data.error || 'Failed to trigger reactivation');
      }
    } catch (error) {
      console.error('Error triggering reactivation:', error);
      this.showToast(`Error: ${error.message}`, 'error');
    }
  }
}

// Initialize the Reactivation Manager when the page loads
function initReactivationManager(companyId) {
  // Only initialize if we're on the reactivation tab
  if (document.querySelector('#reactivation-tab')) {
    return new ReactivationManager(companyId);
  }
  return null;
}

export { ReactivationManager, initReactivationManager };
