/**
 * RSSI Device Grid Card for Home Assistant
 * 
 * This component displays entities with RSSI values and their associated device_tracker information,
 * allowing reconnection of individual devices or all weak signal devices, and syncing device names
 * directly with Omada Controller with automatic entity name updates.
 * 
 * Version: 1.3.0 - Direct Omada Integration with Name Updates
 */

class RssiDeviceGrid extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    
    // Cache for DOM elements and states
    this._cache = {
      deviceList: []
    };
    
    // Flags for rendering control
    this._isInitialRender = true;
    this._updatePending = false;
    
    // Initial sort state
    this._sortState = {
      column: 'name',
      order: 'asc'
    };
    
    // Track operations
    this._reconnectingAll = false;
    this._syncingNames = false;
    this._reconnectQueue = [];
    
    // Text filter
    this._textFilter = '';
    this._previousTextFilter = '';
    
    // Card elements
    this._elements = {};
    
    // Omada Controller direct connection cache
    this._omadaConnection = {
      authenticated: false,
      controllerId: null,
      token: null,
      lastLogin: null,
      sessionTimeout: 3600000 // 1 hour
    };
  }

  setConfig(config) {
    this.config = {
      title: config.title || 'RSSI Devices',
      service: config.service || 'tplink_omada.reconnect_client',
      service_domain: config.service_domain || 'tplink_omada',
      service_action: config.service_action || 'reconnect_client',
      sync_service_action: config.sync_service_action || 'update_entities', // Service for refreshing entities
      mac_param: config.mac_param || 'mac',
      format_mac: config.format_mac !== false, // Format MAC by default
      columns_order: config.columns_order || ['name', 'rssi', 'mac', 'ip', 'actions'],
      show_offline: config.show_offline !== false, // Show offline devices by default
      max_devices: config.max_devices || 0, // 0 = no limit
      sort_by: config.sort_by || 'name',
      sort_order: config.sort_order || 'asc',
      state_text: config.state_text !== false,
      alternating_rows: config.alternating_rows !== false,
      show_filter: config.show_filter !== false, // Show filter field by default
      filter_placeholder: config.filter_placeholder || 'Filter devices...',
      sortable_columns: config.sortable_columns || ['name', 'rssi', 'mac', 'ip'], // Columns that can be sorted
      enable_sorting: config.enable_sorting !== false, // Enable sorting by default
      weak_signal_threshold: config.weak_signal_threshold || 50, // Threshold for weak signal (percentage)
      reconnect_all_button: config.reconnect_all_button !== false, // Show reconnect all button
      sync_names_button: config.sync_names_button === true, // Show sync names button (disabled by default)
      update_interval: config.update_interval || 5000, // Update interval in milliseconds (5 seconds default)
      
      // NEW: Direct Omada Controller connection settings (optional)
      omada_controller_url: config.omada_controller_url || '',
      omada_username: config.omada_username || '',
      omada_password: config.omada_password || '',
      omada_site: config.omada_site || 'Default',
      omada_verify_ssl: config.omada_verify_ssl !== false,
      omada_update_ha_names: config.omada_update_ha_names !== false // NEW: Actually update entity names in HA
    };
    
    // Set initial sort state based on configuration
    this._sortState = {
      column: this.config.sort_by,
      order: this.config.sort_order
    };
    
    this._isInitialRender = true;
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    
    // Save previous filter to detect changes
    this._previousTextFilter = this._textFilter;
    
    // Initial render or significant changes
    if (!oldHass || this._isInitialRender || this._textFilter !== this._previousTextFilter) {
      this._throttledRender();
    } else {
      // Otherwise, perform light update (entity states only)
      this._updateEntityStates();
    }
  }

  /* --- Performance Optimizations --- */
  
  // Schedule a render if one is not already pending
  _throttledRender() {
    if (!this._updatePending) {
      this._updatePending = true;
      
      // Use requestAnimationFrame for smoother rendering
      window.requestAnimationFrame(() => {
        this._updatePending = false;
        
        if (this._isInitialRender) {
          // Full render for first time
          this._setupStyles();
          this._renderCard();
          this._isInitialRender = false;
        } else {
          // Update device list and grid
          this._updateDeviceList();
          this._updateGrid();
        }
      });
    }
  }
  
  // More efficient entity state updates without full re-render
  _updateEntityStates() {
    if (!this._hass || !this._elements.tbody) return;
    
    let hasChanges = false;
    const weaksBeforeUpdate = this._getWeakSignalDevices().length;
    
    // Update existing device list without rebuilding it
    this._cache.deviceList.forEach((device, index) => {
      // Get current state for the RSSI entity
      const newState = this._hass.states[device.entity_id];
      if (newState && newState.state !== device.rssi) {
        device.rssi = newState.state;
        hasChanges = true;
        
        // Update just the RSSI cell if it exists
        const row = this._elements.tbody.children[index];
        if (row) {
          const columns = this.config.columns_order;
          const rssiIndex = columns.indexOf('rssi');
          if (rssiIndex >= 0) {
            const cell = row.children[rssiIndex];
            if (cell) {
              this._updateRssiCell(cell, device.rssi);
            }
          }
        }
      }
      
      // Update device tracker state
      if (device.tracker_entity_id) {
        const trackerState = this._hass.states[device.tracker_entity_id];
        if (trackerState && trackerState.state !== device.state) {
          device.state = trackerState.state;
          hasChanges = true;
          
          // Update state indicator if configured
          if (this.config.state_text) {
            const row = this._elements.tbody.children[index];
            if (row) {
              const nameIndex = this.config.columns_order.indexOf('name');
              if (nameIndex >= 0) {
                const cell = row.children[nameIndex];
                if (cell && cell.firstChild && cell.firstChild.classList.contains('device-state')) {
                  cell.firstChild.className = `device-state state-${device.state}`;
                }
              }
            }
          }
        }
      }
    });
    
    // Update reconnect all button if the number of weak devices changed
    if (hasChanges && this.config.reconnect_all_button && !this._reconnectingAll) {
      const weakDevices = this._getWeakSignalDevices();
      if (weakDevices.length !== weaksBeforeUpdate) {
        this._updateReconnectAllButton(weakDevices.length);
      }
    }
  }
  
  // Normalize text helper (for filtering)
  _normalizeText(text) {
    if (!text) return '';
    return text.toString().normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase();
  }
  
  /* --- Direct Omada Controller Connection --- */
  
  async _connectToOmada() {
    if (!this.config.omada_controller_url || !this.config.omada_username || !this.config.omada_password) {
      console.warn('Omada Controller connection not configured');
      return false;
    }
    
    // Check if we have a valid session
    if (this._omadaConnection.authenticated && 
        this._omadaConnection.lastLogin && 
        (Date.now() - this._omadaConnection.lastLogin) < this._omadaConnection.sessionTimeout) {
      return true;
    }
    
    try {
      console.log('Connecting to Omada Controller...');
      
      // Step 1: Get Controller ID
      const infoUrl = `${this.config.omada_controller_url}/api/info`;
      const infoResponse = await fetch(infoUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!infoResponse.ok) {
        throw new Error(`Failed to get controller info: ${infoResponse.status} ${infoResponse.statusText}`);
      }
      
      const infoData = await infoResponse.json();
      if (!infoData.result || !infoData.result.omadacId) {
        throw new Error('Invalid controller info response');
      }
      
      this._omadaConnection.controllerId = infoData.result.omadacId;
      console.log('Got controller ID:', this._omadaConnection.controllerId);
      
      // Step 2: Login
      const loginUrl = `${this.config.omada_controller_url}/${this._omadaConnection.controllerId}/api/v2/login`;
      const loginResponse = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          username: this.config.omada_username,
          password: this.config.omada_password
        })
      });
      
      if (!loginResponse.ok) {
        throw new Error(`Login failed: ${loginResponse.status} ${loginResponse.statusText}`);
      }
      
      const loginData = await loginResponse.json();
      
      if (loginData.errorCode !== 0) {
        throw new Error(`Login error: ${loginData.msg || 'Unknown error'}`);
      }
      
      this._omadaConnection.token = loginData.result.token;
      this._omadaConnection.authenticated = true;
      this._omadaConnection.lastLogin = Date.now();
      
      console.log('Successfully connected to Omada Controller');
      return true;
      
    } catch (error) {
      console.error('Failed to connect to Omada Controller:', error);
      this._omadaConnection.authenticated = false;
      return false;
    }
  }
  
  async _getOmadaDeviceNames() {
    if (!await this._connectToOmada()) {
      throw new Error('Failed to connect to Omada Controller');
    }
    
    try {
      // Get clients from Omada Controller
      const clientsUrl = `${this.config.omada_controller_url}/${this._omadaConnection.controllerId}/api/v2/sites/${this.config.omada_site}/clients?currentPage=1&currentPageSize=1000`;
      
      const response = await fetch(clientsUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Csrf-Token': this._omadaConnection.token
        },
        credentials: 'include'
      });
      
      if (!response.ok) {
        // Try to reconnect on authentication errors
        if (response.status === 401 || response.status === 403) {
          this._omadaConnection.authenticated = false;
          if (await this._connectToOmada()) {
            // Retry with new token
            const retryResponse = await fetch(clientsUrl, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                'Csrf-Token': this._omadaConnection.token
              },
              credentials: 'include'
            });
            
            if (!retryResponse.ok) {
              throw new Error(`Failed to get clients after retry: ${retryResponse.status}`);
            }
            
            const retryData = await retryResponse.json();
            if (retryData.errorCode !== 0) {
              throw new Error(`API error after retry: ${retryData.msg}`);
            }
            
            return retryData.result.data || [];
          }
        }
        throw new Error(`Failed to get clients: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.errorCode !== 0) {
        throw new Error(`API error: ${data.msg || 'Unknown error'}`);
      }
      
      const clientsCount = data.result.data ? data.result.data.length : 0;
      console.log(`Retrieved ${clientsCount} clients from Omada Controller`);
      return data.result.data || [];
      
    } catch (error) {
      console.error('Error getting Omada device names:', error);
      throw error;
    }
  }
  
  async _syncDeviceNamesWithOmada() {
    try {
      const omadaClients = await this._getOmadaDeviceNames();
      
      // Create a map of MAC addresses to names from Omada
      const omadaNames = new Map();
      omadaClients.forEach(client => {
        if (client.mac && (client.name || client.hostName)) {
          // Normalize MAC address for comparison
          const normalizedMac = client.mac.toLowerCase().replace(/[:-]/g, '');
          omadaNames.set(normalizedMac, {
            name: client.name || client.hostName,
            ip: client.ip,
            ssid: client.ssid,
            originalMac: client.mac
          });
        }
      });
      
      // Compare with current Home Assistant devices and prepare updates
      const updates = [];
      const currentDevices = this._cache.deviceList;
      
      for (const device of currentDevices) {
        if (device.mac) {
          const normalizedMac = device.mac.toLowerCase().replace(/[:-]/g, '');
          const omadaDevice = omadaNames.get(normalizedMac);
          
          if (omadaDevice && omadaDevice.name !== device.name) {
            updates.push({
              entityId: device.entity_id,
              trackerId: device.tracker_entity_id,
              mac: device.mac,
              currentName: device.name,
              omadaName: omadaDevice.name,
              ip: omadaDevice.ip,
              ssid: omadaDevice.ssid
            });
          }
        }
      }
      
      return {
        totalOmadaDevices: omadaClients.length,
        foundUpdates: updates.length,
        updates: updates
      };
      
    } catch (error) {
      console.error('Error syncing with Omada:', error);
      throw error;
    }
  }
  
  async _updateEntityNamesInHA(updates) {
    if (!updates || updates.length === 0) {
      return { updated: 0, errors: [] };
    }
    
    let updated = 0;
    const errors = [];
    
    for (const update of updates) {
      try {
        // Update RSSI entity friendly name
        if (update.entityId) {
          await this._updateEntityFriendlyName(update.entityId, `${update.omadaName} RSSI`);
          console.log(`Updated RSSI entity ${update.entityId}: "${update.currentName}" -> "${update.omadaName} RSSI"`);
        }
        
        // Update device tracker friendly name
        if (update.trackerId) {
          await this._updateEntityFriendlyName(update.trackerId, update.omadaName);
          console.log(`Updated tracker entity ${update.trackerId}: "${update.currentName}" -> "${update.omadaName}"`);
        }
        
        updated++;
        
      } catch (error) {
        console.error(`Failed to update entity names for ${update.mac}:`, error);
        errors.push({
          mac: update.mac,
          error: error.message
        });
      }
    }
    
    return { updated, errors };
  }
  
  async _updateEntityFriendlyName(entityId, newName) {
    if (!this._hass || !entityId || !newName) {
      throw new Error('Missing required parameters for entity update');
    }
    
    try {
      // Method 1: Try using entity registry service (Home Assistant 2023.7+)
      await this._hass.callService('homeassistant', 'update_entity', {
        entity_id: entityId,
        name: newName
      });
      
    } catch (error) {
      console.warn(`Method 1 failed for ${entityId}, trying method 2:`, error);
      
      try {
        // Method 2: Try using the REST API directly
        const response = await fetch('/api/config/entity_registry/' + entityId, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._hass.auth.accessToken}`
          },
          body: JSON.stringify({
            name: newName
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
      } catch (restError) {
        console.warn(`Method 2 failed for ${entityId}, trying method 3:`, restError);
        
        try {
          // Method 3: Try using entity customization (fallback)
          await this._hass.callService('homeassistant', 'set_entity_customization', {
            entity_id: entityId,
            friendly_name: newName
          });
          
        } catch (customError) {
          console.error(`All methods failed for ${entityId}:`, customError);
          throw new Error(`Failed to update entity name: ${customError.message}`);
        }
      }
    }
  }
  
  /* --- Device Data Management --- */
  
  _updateDeviceList() {
    if (!this._hass) return false;
    
    const newDeviceList = [];
    const normalizedFilter = this._normalizeText(this._textFilter);
    
    // Find all RSSI entities
    Object.entries(this._hass.states).forEach(([entityId, stateObj]) => {
      if (this._isRssiEntity(entityId, stateObj)) {
        // Get device ID for this entity
        const deviceId = this._hass.entities[entityId]?.device_id;
        
        if (deviceId) {
          // Find device_tracker entity for this device
          const deviceTracker = this._findDeviceTracker(deviceId);
          
          if (deviceTracker && deviceTracker.attributes.mac) {
            // Create device object
            const entityName = stateObj.attributes.friendly_name || entityId;
            const displayName = entityName.replace(/\sRSSI$/, '').replace(/_rssi$/, '');
            
            const device = {
              entity_id: entityId,
              name: displayName,
              rssi: stateObj.state,
              mac: deviceTracker.attributes.mac,
              ip: deviceTracker.attributes.ip || '',
              state: deviceTracker.state,
              tracker_entity_id: deviceTracker.entity_id,
              device_id: deviceId
            };
            
            // Skip offline devices if configured
            if (!this.config.show_offline && 
                (deviceTracker.state === 'not_home' || deviceTracker.state === 'fora_de_casa')) {
              return;
            }
            
            // Apply text filter if it exists
            if (normalizedFilter) {
              const normalizedName = this._normalizeText(device.name);
              const normalizedMac = this._normalizeText(device.mac);
              const normalizedIp = this._normalizeText(device.ip);
              
              const matchesFilter = 
                normalizedName.includes(normalizedFilter) || 
                normalizedMac.includes(normalizedFilter) || 
                normalizedIp.includes(normalizedFilter);
              
              if (!matchesFilter) {
                return;
              }
            }
            
            newDeviceList.push(device);
          }
        }
      }
    });
    
    // Sort the list
    this._sortDeviceList(newDeviceList);
    
    // Apply maximum device limit
    if (this.config.max_devices > 0 && newDeviceList.length > this.config.max_devices) {
      newDeviceList.length = this.config.max_devices;
    }
    
    this._cache.deviceList = newDeviceList;
    return true;
  }

  // Helper to check if an entity is an RSSI entity
  _isRssiEntity(entityId, stateObj) {
    return entityId.endsWith('_rssi') || 
           (stateObj.attributes.friendly_name && 
            stateObj.attributes.friendly_name.endsWith('RSSI'));
  }
  
  // Find device_tracker entity for a device
  _findDeviceTracker(deviceId) {
    const deviceTrackers = [];
    
    // Find all device_tracker entities for this device
    Object.entries(this._hass.states).forEach(([entityId, stateObj]) => {
      if (entityId.startsWith('device_tracker.') && 
          this._hass.entities[entityId] && 
          this._hass.entities[entityId].device_id === deviceId) {
        deviceTrackers.push({
          entity_id: entityId,
          state: stateObj.state,
          attributes: stateObj.attributes
        });
      }
    });
    
    // If there are multiple device_trackers, prioritize ones with 'home' state
    if (deviceTrackers.length > 0) {
      const homeTracker = deviceTrackers.find(tracker => 
        tracker.state === 'home' || tracker.state === 'em_casa');
      
      return homeTracker || deviceTrackers[0];
    }
    
    return null;
  }

  _sortDeviceList(deviceList) {
    const { column, order } = this._sortState;
    
    deviceList.sort((a, b) => {
      let valA = a[column];
      let valB = b[column];
      
      // Handle null or undefined values
      if (valA === null || valA === undefined) valA = '';
      if (valB === null || valB === undefined) valB = '';
      
      // For RSSI values, sort by signal strength
      if (column === 'rssi') {
        // Convert to numbers
        valA = parseFloat(valA);
        valB = parseFloat(valB);
        
        // Handle non-number values
        if (isNaN(valA)) valA = -999;
        if (isNaN(valB)) valB = -999;
        
        // For RSSI, higher (less negative) values are better
        return order === 'asc' ? valA - valB : valB - valA;
      }
      
      // Case-insensitive string comparison
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      
      if (valA < valB) return order === 'asc' ? -1 : 1;
      if (valA > valB) return order === 'asc' ? 1 : -1;
      return 0;
    });
  }

  /* --- RSSI Calculation --- */
  
  _getRssiInfo(rssi) {
    // Convert RSSI to number
    const rssiValue = parseInt(rssi, 10);
    
    // If not a valid number, return unknown
    if (isNaN(rssiValue)) {
      return {
        class: 'rssi-unknown',
        percentage: 0
      };
    }
    
    // Calculate percentage (typical WiFi RSSI range is -30 to -90 dBm)
    // -30 dBm = 100%, -90 dBm = 0%
    const percentage = Math.max(0, Math.min(100, Math.round(((rssiValue + 90) / 60) * 100)));
    
    // Classify RSSI
    let signalClass;
    if (rssiValue >= -60) {
      signalClass = 'rssi-good';
    } else if (rssiValue >= -75) {
      signalClass = 'rssi-medium';
    } else {
      signalClass = 'rssi-bad';
    }
    
    return {
      class: signalClass,
      percentage: percentage
    };
  }

  // Find devices with weak signals
  _getWeakSignalDevices() {
    if (!this._cache.deviceList || this._cache.deviceList.length === 0) {
      return [];
    }
    
    return this._cache.deviceList.filter(device => {
      const rssiValue = parseInt(device.rssi, 10);
      if (isNaN(rssiValue)) return false;
      
      const percentage = Math.max(0, Math.min(100, ((rssiValue + 90) / 60) * 100));
      return percentage < this.config.weak_signal_threshold;
    });
  }
  
  /* --- UI Creation --- */
  
  _setupStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        --primary-color: var(--card-primary-color, var(--primary-color));
        --text-color: var(--card-text-color, var(--primary-text-color));
        --secondary-text-color: var(--card-secondary-text-color, var(--secondary-text-color));
        --background-color: var(--card-background-color, var(--card-background-color, var(--ha-card-background)));
        --secondary-background-color: var(--card-secondary-background-color, var(--secondary-background-color));
        --border-color: var(--card-border-color, var(--divider-color));
        --shadow-color: var(--card-shadow-color, rgba(0,0,0,0.08));
        --border-radius: var(--card-border-radius, var(--ha-card-border-radius, 12px));
        --input-text-color: var(--text-color);
        --input-background-color: var(--background-color);
        --accent-color: var(--card-accent-color, #e74c3c);
      }
      
      ha-card {
        border-radius: var(--border-radius);
        background-color: var(--background-color);
        color: var(--text-color);
        box-shadow: 0 4px 15px var(--shadow-color);
        overflow: hidden;
      }
      
      .card-header {
        padding: 14px 20px;
        background-color: var(--background-color);
        color: var(--text-color);
        font-weight: 500;
        font-size: 18px;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
      }
      
      .header-left {
        display: flex;
        align-items: center;
        flex: 1;
      }
      
      .header-right {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      
      .header-icon {
        margin-right: 10px;
        color: var(--primary-color);
        font-size: 20px;
        display: flex;
        align-items: center;
      }
      
      .card-content {
        padding: 12px 16px;
        overflow-x: auto;
      }
      
      .grid-container {
        width: 100%;
        border-collapse: collapse;
        margin-top: 8px;
      }
      
      .grid-container th {
        text-align: left;
        padding: 8px 12px;
        color: var(--secondary-text-color);
        font-weight: 500;
        font-size: 14px;
        border-bottom: 1px solid var(--border-color);
        white-space: nowrap;
      }
      
      .grid-container td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border-color);
        font-size: 14px;
        white-space: nowrap;
      }
      
      .grid-container tr:last-child td {
        border-bottom: none;
      }
      
      .grid-container tr.alternate {
        background-color: var(--secondary-background-color);
      }
      
      .device-state {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-right: 8px;
      }
      
      .state-home, .state-em_casa {
        background-color: #2ecc71;
      }
      
      .state-not_home, .state-fora_de_casa {
        background-color: #e74c3c;
      }
      
      .state-unknown {
        background-color: #95a5a6;
      }
      
      .rssi-value {
        font-family: monospace;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .rssi-good {
        color: #2ecc71;
      }
      
      .rssi-medium {
        color: #f39c12;
      }
      
      .rssi-bad {
        color: #e74c3c;
      }
      
      .rssi-bar-container {
        width: 60px;
        height: 8px;
        background-color: rgba(0, 0, 0, 0.1);
        border-radius: 4px;
        overflow: hidden;
      }
      
      .rssi-bar {
        height: 100%;
        border-radius: 4px;
      }
      
      .rssi-bar.rssi-good {
        background-color: #2ecc71;
      }
      
      .rssi-bar.rssi-medium {
        background-color: #f39c12;
      }
      
      .rssi-bar.rssi-bad {
        background-color: #e74c3c;
      }
      
      .rssi-percentage {
        min-width: 40px;
        text-align: right;
      }
      
      .mac-address, .ip-address {
        font-family: monospace;
        font-size: 13px;
      }
      
      .reconnect-button {
        background-color: #1a4b8c;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 6px 12px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 2px 4px rgba(26, 75, 140, 0.2);
      }
      
      .reconnect-button:hover {
        background-color: #0D3880;
      }
      
      .reconnect-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      
      .reconnect-all-button {
        background-color: #e74c3c;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 8px 14px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 2px 4px rgba(231, 76, 60, 0.3);
        transition: background-color 0.2s;
      }
      
      .reconnect-all-button:hover {
        background-color: #c0392b;
      }
      
      .reconnect-all-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      
      .reconnect-all-button.success {
        background-color: #2ecc71;
      }
      
      .reconnect-all-button.error {
        background-color: #e74c3c;
      }
      
      .sync-names-button {
        background-color: #3498db;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 8px 14px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 2px 4px rgba(52, 152, 219, 0.3);
        transition: background-color 0.2s;
      }
      
      .sync-names-button:hover {
        background-color: #2980b9;
      }
      
      .sync-names-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      
      .sync-names-button.success {
        background-color: #2ecc71;
      }
      
      .sync-names-button.error {
        background-color: #e74c3c;
      }
      
      .progress-container {
        margin-top: 10px;
        padding: 8px 0;
      }
      
      .progress-bar {
        width: 100%;
        height: 6px;
        background-color: rgba(0, 0, 0, 0.1);
        border-radius: 3px;
        overflow: hidden;
      }
      
      .progress-fill {
        height: 100%;
        background-color: #3498db;
        border-radius: 3px;
        transition: width 0.3s ease;
        width: 0%;
      }
      
      .progress-text {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin-top: 4px;
        text-align: center;
      }
      
      .empty-message, .no-results {
        padding: 24px;
        text-align: center;
        color: var(--secondary-text-color);
        font-size: 14px;
      }
      
      .no-results {
        font-style: italic;
      }
      
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      .loading-icon {
        animation: spin 1s linear infinite;
      }
      
      .filter-container {
        position: relative;
        margin-bottom: 16px;
      }
      
      .filter-input {
        width: 100%;
        padding: 10px 10px 10px 35px;
        font-size: 14px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background-color: var(--input-background-color);
        color: var(--input-text-color);
        box-sizing: border-box;
        transition: border-color 0.3s;
      }
      
      .filter-input:focus {
        outline: none;
        border-color: var(--primary-color);
      }
      
      .filter-input::placeholder {
        color: var(--secondary-text-color);
        opacity: 0.7;
      }
      
      .filter-icon {
        position: absolute;
        left: 10px;
        top: 50%;
        transform: translateY(-50%);
        color: var(--secondary-text-color);
        opacity: 0.7;
      }
      
      .clear-filter {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        color: var(--secondary-text-color);
        opacity: 0.7;
        cursor: pointer;
        background: none;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }
      
      .clear-filter:hover {
        opacity: 1;
      }
      
      /* Styles for sortable headers */
      .sortable {
        cursor: pointer;
        user-select: none;
      }
      
      .sortable:hover {
        color: var(--primary-color);
      }
      
      .sort-asc:after {
        content: "▲";
        display: inline-block;
        margin-left: 5px;
        font-size: 12px;
      }
      
      .sort-desc:after {
        content: "▼";
        display: inline-block;
        margin-left: 5px;
        font-size: 12px;
      }
      
      /* Estilos para linhas clicáveis */
      .clickable-row {
        cursor: pointer;
      }
      
      .clickable-row:hover {
        background-color: rgba(var(--rgb-primary-color, 0, 140, 255), 0.1);
      }
      
      /* Responsive header buttons */
      @media (max-width: 768px) {
        .header-right {
          gap: 8px;
        }
        
        .reconnect-all-button,
        .sync-names-button {
          padding: 6px 10px;
          font-size: 12px;
        }
        
        .reconnect-all-button span,
        .sync-names-button span {
          display: none;
        }
      }
    `;
    
    this.shadowRoot.appendChild(style);
  }

  _renderCard() {
    // Clear previous content
    this.shadowRoot.innerHTML = '';
    this._setupStyles();
    
    const card = document.createElement('ha-card');
    this.shadowRoot.appendChild(card);
    
    // Header
    const cardHeader = document.createElement('div');
    cardHeader.className = 'card-header';
    
    const headerLeft = document.createElement('div');
    headerLeft.className = 'header-left';
    headerLeft.innerHTML = `
      <span class="header-icon"><ha-icon icon="mdi:wifi"></ha-icon></span>
      ${this.config.title}
    `;
    
    const headerRight = document.createElement('div');
    headerRight.className = 'header-right';
    
    // Add sync names button if configured
    if (this.config.sync_names_button) {
      const syncNamesButton = document.createElement('button');
      syncNamesButton.className = 'sync-names-button';
      syncNamesButton.id = 'sync-names-button';
      syncNamesButton.innerHTML = '<ha-icon icon="mdi:sync"></ha-icon><span> Sincronizar nomes</span>';
      syncNamesButton.addEventListener('click', () => this._syncDeviceNames());
      headerRight.appendChild(syncNamesButton);
      
      // Store reference to button
      this._elements.syncNamesButton = syncNamesButton;
    }
    
    // Add reconnect all button if configured
    if (this.config.reconnect_all_button) {
      const reconnectAllButton = document.createElement('button');
      reconnectAllButton.className = 'reconnect-all-button';
      reconnectAllButton.id = 'reconnect-all-button';
      reconnectAllButton.innerHTML = '<ha-icon icon="mdi:wifi-refresh"></ha-icon><span> Reconectar sinais fracos</span>';
      reconnectAllButton.addEventListener('click', () => this._reconnectWeakSignals());
      headerRight.appendChild(reconnectAllButton);
      
      // Store reference to button
      this._elements.reconnectAllButton = reconnectAllButton;
    }
    
    cardHeader.appendChild(headerLeft);
    cardHeader.appendChild(headerRight);
    card.appendChild(cardHeader);
    
    // Content
    const cardContent = document.createElement('div');
    cardContent.className = 'card-content';
    card.appendChild(cardContent);
    
    // Filter field
    if (this.config.show_filter) {
      const filterContainer = this._createFilterInput();
      cardContent.appendChild(filterContainer);
    }
    
    // Update device list
    this._updateDeviceList();
    
    // Device grid
    if (this._cache.deviceList.length > 0) {
      const gridContainer = document.createElement('table');
      gridContainer.className = 'grid-container';
      
      // Add headers
      const thead = document.createElement('thead');
      gridContainer.appendChild(thead);
      
      const headerRow = this._createHeaderRow();
      thead.appendChild(headerRow);
      
      // Table body
      const tbody = document.createElement('tbody');
      gridContainer.appendChild(tbody);
      
      cardContent.appendChild(gridContainer);
      
      // Store references
      this._elements = {
        ...this._elements,
        card,
        gridContainer,
        tbody,
        cardContent
      };
      
      // Populate grid with devices
      this._updateGrid();
      
      // Update reconnect all button state if it exists
      if (this.config.reconnect_all_button) {
        const weakDevices = this._getWeakSignalDevices();
        this._updateReconnectAllButton(weakDevices.length);
      }
    } else {
      // Show empty message
      this._showEmptyMessage(cardContent);
      
      // Store references
      this._elements = {
        ...this._elements,
        card,
        cardContent
      };
    }
  }

  _createFilterInput() {
    const filterContainer = document.createElement('div');
    filterContainer.className = 'filter-container';
    
    const filterIcon = document.createElement('ha-icon');
    filterIcon.icon = 'mdi:magnify';
    filterIcon.className = 'filter-icon';
    filterContainer.appendChild(filterIcon);
    
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'filter-input';
    filterInput.placeholder = this.config.filter_placeholder;
    filterInput.value = this._textFilter;
    filterInput.addEventListener('input', (e) => {
      this._previousTextFilter = this._textFilter;
      this._textFilter = e.target.value;
      
      // Use throttled render for better performance
      this._throttledRender();
      
      // Show/hide clear button
      clearButton.style.display = this._textFilter ? 'flex' : 'none';
    });
    filterContainer.appendChild(filterInput);
    
    const clearButton = document.createElement('button');
    clearButton.className = 'clear-filter';
    clearButton.innerHTML = '<ha-icon icon="mdi:close"></ha-icon>';
    clearButton.style.display = this._textFilter ? 'flex' : 'none';
    clearButton.addEventListener('click', () => {
      this._previousTextFilter = this._textFilter;
      this._textFilter = '';
      filterInput.value = '';
      clearButton.style.display = 'none';
      
      this._throttledRender();
    });
    filterContainer.appendChild(clearButton);
    
    this._elements.filterInput = filterInput;
    return filterContainer;
  }
  
  _createHeaderRow() {
    const headerRow = document.createElement('tr');
    
    // Column headers map
    const columnTitles = {
      'name': 'Name',
      'rssi': 'RSSI',
      'mac': 'MAC',
      'ip': 'IP',
      'actions': '' // empty title for actions column
    };
    
    this.config.columns_order.forEach(column => {
      if (columnTitles.hasOwnProperty(column)) {
        const th = document.createElement('th');
        th.textContent = columnTitles[column];
        
        // Make sortable if applicable
        if (this.config.enable_sorting && 
            this.config.sortable_columns.includes(column) && 
            column !== 'actions') {
          this._makeSortable(th, column);
        }
        
        headerRow.appendChild(th);
      }
    });
    
    return headerRow;
  }
  
  // Make a header sortable
  _makeSortable(headerElement, column) {
    headerElement.className = 'sortable';
    
// Add sort indicator if this column is currently sorted
    if (this._sortState.column === column) {
      headerElement.classList.add(this._sortState.order === 'asc' ? 'sort-asc' : 'sort-desc');
    }
    
    headerElement.addEventListener('click', () => {
      // If already sorting by this column, reverse the order
      if (this._sortState.column === column) {
        this._sortState.order = this._sortState.order === 'asc' ? 'desc' : 'asc';
      } else {
        // Otherwise, switch to this column in ascending order
        this._sortState.column = column;
        this._sortState.order = 'asc';
      }
      
      // Re-sort and update the grid
      this._sortDeviceList(this._cache.deviceList);
      
      // Update visual indicators on all headers
      const headers = this.shadowRoot.querySelectorAll('.sortable');
      headers.forEach(header => {
        header.classList.remove('sort-asc', 'sort-desc');
      });
      
      headerElement.classList.add(this._sortState.order === 'asc' ? 'sort-asc' : 'sort-desc');
      
      this._updateGrid();
    });
  }
  
  _showEmptyMessage(container) {
    let messageText = 'No devices found with current settings.';
    
    if (this._textFilter) {
      messageText = `No devices found for filter "${this._textFilter}".`;
    }
    
    const emptyMessage = document.createElement('div');
    emptyMessage.className = this._textFilter ? 'no-results' : 'empty-message';
    emptyMessage.textContent = messageText;
    container.appendChild(emptyMessage);
  }
  
  _updateGrid() {
    if (!this._elements.tbody) return;
    
    const tbody = this._elements.tbody;
    
    // Clear previous content without creating DOM nodes
    while (tbody.firstChild) {
      tbody.removeChild(tbody.firstChild);
    }
    
    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    this._cache.deviceList.forEach((device, index) => {
      const row = document.createElement('tr');
      
      // Apply alternating style for rows
      if (this.config.alternating_rows && index % 2 === 1) {
        row.className = 'alternate';
      }
      
      this.config.columns_order.forEach(column => {
        if (column === 'name') {
          const td = this._createNameCell(device);
          row.appendChild(td);
        } else if (column === 'rssi') {
          const td = this._createRssiCell(device.rssi, device);
          row.appendChild(td);
        } else if (column === 'mac') {
          const td = document.createElement('td');
          td.className = 'mac-address';
          td.textContent = device.mac;
          
          // Make cell clickable
          td.classList.add('clickable-row');
          td.addEventListener('click', (e) => {
            e.stopPropagation();
            this._showDeviceMoreInfo(device.device_id);
          });
          
          row.appendChild(td);
        } else if (column === 'ip') {
          const td = document.createElement('td');
          td.className = 'ip-address';
          td.textContent = device.ip || 'N/A';
          
          // Make cell clickable
          td.classList.add('clickable-row');
          td.addEventListener('click', (e) => {
            e.stopPropagation();
            this._showDeviceMoreInfo(device.device_id);
          });
          
          row.appendChild(td);
        } else if (column === 'actions') {
          const td = this._createActionsCell(device);
          row.appendChild(td);
        }
      });
      
      // Make entire row clickable
      row.classList.add('clickable-row');
      row.addEventListener('click', () => {
        this._showDeviceMoreInfo(device.device_id);
      });
      
      fragment.appendChild(row);
    });
    
    // Add all rows at once (more efficient)
    tbody.appendChild(fragment);
    
    // Update reconnect all button
    if (this.config.reconnect_all_button && !this._reconnectingAll) {
      const weakDevices = this._getWeakSignalDevices();
      this._updateReconnectAllButton(weakDevices.length);
    }
  }
  
  _createNameCell(device) {
    const td = document.createElement('td');
    
    // If configured to show state as text
    if (this.config.state_text) {
      const stateIndicator = document.createElement('span');
      stateIndicator.className = `device-state state-${device.state}`;
      td.appendChild(stateIndicator);
    }
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = device.name;
    td.appendChild(nameSpan);
    
    // Make cell clickable to show device properties
    td.classList.add('clickable-row');
    td.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showDeviceMoreInfo(device.device_id);
    });
    
    return td;
  }
  
  _createRssiCell(rssi, device) {
    const td = document.createElement('td');
    
    if (rssi && !isNaN(parseInt(rssi, 10))) {
      // Get RSSI info with class and percentage
      const rssiInfo = this._getRssiInfo(rssi);
      
      // Create container
      td.className = `rssi-value ${rssiInfo.class}`;
      
      // RSSI value
      const rssiValue = document.createElement('span');
      rssiValue.textContent = rssi;
      td.appendChild(rssiValue);
      
      // RSSI bar
      const barContainer = document.createElement('div');
      barContainer.className = 'rssi-bar-container';
      
      const bar = document.createElement('div');
      bar.className = `rssi-bar ${rssiInfo.class}`;
      bar.style.width = `${rssiInfo.percentage}%`;
      barContainer.appendChild(bar);
      
      td.appendChild(barContainer);
      
      // RSSI percentage
      const percentage = document.createElement('span');
      percentage.className = 'rssi-percentage';
      percentage.textContent = `${rssiInfo.percentage}%`;
      td.appendChild(percentage);
    } else {
      td.textContent = 'N/A';
    }
    
    // Make cell clickable to show device properties
    if (device) {
      td.classList.add('clickable-row');
      td.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showDeviceMoreInfo(device.device_id);
      });
    }
    
    return td;
  }
  
  _updateRssiCell(cell, rssi) {
    // Clear existing content
    while (cell.firstChild) {
      cell.removeChild(cell.firstChild);
    }
    
    if (rssi && !isNaN(parseInt(rssi, 10))) {
      // Get RSSI info with class and percentage
      const rssiInfo = this._getRssiInfo(rssi);
      
      // Update class
      cell.className = `rssi-value ${rssiInfo.class}`;
      
      // RSSI value
      const rssiValue = document.createElement('span');
      rssiValue.textContent = rssi;
      cell.appendChild(rssiValue);
      
      // RSSI bar
      const barContainer = document.createElement('div');
      barContainer.className = 'rssi-bar-container';
      
      const bar = document.createElement('div');
      bar.className = `rssi-bar ${rssiInfo.class}`;
      bar.style.width = `${rssiInfo.percentage}%`;
      barContainer.appendChild(bar);
      
      cell.appendChild(barContainer);
      
      // RSSI percentage
      const percentage = document.createElement('span');
      percentage.className = 'rssi-percentage';
      percentage.textContent = `${rssiInfo.percentage}%`;
      cell.appendChild(percentage);
    } else {
      cell.textContent = 'N/A';
      cell.className = 'rssi-value';
    }
  }
  
  _createActionsCell(device) {
    const td = document.createElement('td');
    
    const reconnectButton = document.createElement('button');
    reconnectButton.className = 'reconnect-button';
    reconnectButton.innerHTML = '<ha-icon icon="mdi:refresh"></ha-icon> Reconnect';
    reconnectButton.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent row click
      this._reconnectDevice(device, reconnectButton);
    });
    
    td.appendChild(reconnectButton);
    return td;
  }
  
  _updateReconnectAllButton(weakDevicesCount) {
    if (!this._elements.reconnectAllButton) return;
    
    const button = this._elements.reconnectAllButton;
    
    if (weakDevicesCount > 0) {
      button.disabled = false;
      button.innerHTML = `<ha-icon icon="mdi:wifi-refresh"></ha-icon><span> Reconectar ${weakDevicesCount} sinais fracos</span>`;
    } else {
      button.disabled = false;
      button.innerHTML = `<ha-icon icon="mdi:wifi-refresh"></ha-icon><span> Reconectar sinais fracos</span>`;
    }
  }
  
  /* --- Device Names Synchronization --- */
  
  // Sync device names from Omada controller OR refresh entities
  _syncDeviceNames() {
    if (!this._hass || this._syncingNames) return;
    
    this._syncingNames = true;
    const syncButton = this._elements.syncNamesButton;
    
    if (syncButton) {
      const originalText = syncButton.innerHTML;
      
      // Create progress container
      const progressContainer = this._createProgressContainer();
      syncButton.parentNode.insertBefore(progressContainer, syncButton.nextSibling);
      
      // Check if Omada is configured
      if (this.config.omada_controller_url && this.config.omada_username && this.config.omada_password) {
        this._updateProgress(progressContainer, 0, 'Conectando ao Omada Controller...');
        syncButton.disabled = true;
        syncButton.innerHTML = '<ha-icon icon="mdi:loading" class="loading-icon"></ha-icon><span> Conectando...</span>';
        
        this._syncWithOmadaController(syncButton, originalText, progressContainer);
      } else {
        this._updateProgress(progressContainer, 0, 'Omada não configurado. Usando método alternativo...');
        syncButton.disabled = true;
        syncButton.innerHTML = '<ha-icon icon="mdi:loading" class="loading-icon"></ha-icon><span> Atualizando...</span>';
        
        // Go directly to integration reload since Omada is not configured
        this._syncWithIntegrationReload(syncButton, originalText, progressContainer);
      }
    }
  }
  
  _createProgressContainer() {
    const container = document.createElement('div');
    container.className = 'progress-container';
    container.style.display = 'none';
    
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    
    const progressFill = document.createElement('div');
    progressFill.className = 'progress-fill';
    progressBar.appendChild(progressFill);
    
    const progressText = document.createElement('div');
    progressText.className = 'progress-text';
    progressText.textContent = 'Iniciando...';
    
    container.appendChild(progressBar);
    container.appendChild(progressText);
    
    return container;
  }
  
  _updateProgress(container, percentage, text) {
    if (!container) return;
    
    container.style.display = 'block';
    const progressFill = container.querySelector('.progress-fill');
    const progressText = container.querySelector('.progress-text');
    
    if (progressFill) {
      progressFill.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
    }
    
    if (progressText) {
      progressText.textContent = text;
    }
  }
  
  _removeProgress(container) {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
  
  async _syncWithOmadaController(syncButton, originalText, progressContainer) {
    try {
      this._updateProgress(progressContainer, 20, 'Autenticando com Omada...');
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for visual feedback
      
      this._updateProgress(progressContainer, 40, 'Buscando dispositivos do Omada...');
      const syncResult = await this._syncDeviceNamesWithOmada();
      
      this._updateProgress(progressContainer, 60, 'Comparando nomes dos dispositivos...');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (syncResult.foundUpdates > 0) {
        // Check if user wants to actually update names in HA
        if (this.config.omada_update_ha_names) {
          this._updateProgress(progressContainer, 80, `Atualizando ${syncResult.foundUpdates} nomes no Home Assistant...`);
          
          // Actually update the entity names in Home Assistant
          const updateResult = await this._updateEntityNamesInHA(syncResult.updates);
          
          this._updateProgress(progressContainer, 100, 'Sincronização e atualização concluídas!');
          
          // Show detailed results
          console.log('Name sync results:', syncResult);
          console.log('Update results:', updateResult);
          
          // Display results to user
          let message = `Atualizados ${updateResult.updated} de ${syncResult.foundUpdates} dispositivos:`;
          syncResult.updates.forEach(update => {
            console.log(`${update.mac}: "${update.currentName}" -> "${update.omadaName}" (UPDATED IN HA)`);
          });
          
          if (updateResult.errors.length > 0) {
            console.warn('Errors during update:', updateResult.errors);
            message += `\n⚠️ ${updateResult.errors.length} erros durante atualização.`;
          }
          
          syncButton.innerHTML = '<ha-icon icon="mdi:check-circle"></ha-icon><span> Nomes atualizados no HA!</span>';
          syncButton.classList.add('success');
          
          // Show notification with details
          this._showNotification(`✅ Omada Sync: ${updateResult.updated} nomes ATUALIZADOS no HA de ${syncResult.totalOmadaDevices} dispositivos. ${updateResult.errors.length > 0 ? updateResult.errors.length + ' erros.' : 'Sucesso total!'} Verifique o console (F12) para detalhes.`);
          
          // Force refresh the card to show updated names
          setTimeout(() => {
            this._throttledRender();
          }, 1000);
          
        } else {
          // Just compare, don't update
          this._updateProgress(progressContainer, 100, 'Comparação concluída (sem atualização)!');
          
          // Show detailed results
          console.log('Name sync results (COMPARISON ONLY):', syncResult);
          
          // Display results to user
          let message = `Encontradas ${syncResult.foundUpdates} diferenças de nomes (APENAS COMPARAÇÃO):`;
          syncResult.updates.forEach(update => {
            console.log(`${update.mac}: "${update.currentName}" -> "${update.omadaName}" (NOT UPDATED)`);
          });
          
          syncButton.innerHTML = '<ha-icon icon="mdi:check-circle"></ha-icon><span> Comparação completa!</span>';
          syncButton.classList.add('success');
          
          // Show notification with details
          this._showNotification(`ℹ️ Omada Sync: ${syncResult.foundUpdates} diferenças ENCONTRADAS de ${syncResult.totalOmadaDevices} dispositivos. Configure 'omada_update_ha_names: true' para atualizar automaticamente. Verifique o console (F12) para detalhes.`);
        }
        
      } else {
        this._updateProgress(progressContainer, 100, 'Nenhuma atualização necessária!');
        
        syncButton.innerHTML = '<ha-icon icon="mdi:check-circle"></ha-icon><span> Nomes já sincronizados!</span>';
        syncButton.classList.add('success');
        
        this._showNotification(`✅ Todos os ${syncResult.totalOmadaDevices} dispositivos já estão com nomes atualizados no Omada.`);
      }
      
      setTimeout(() => {
        this._restoreSyncButton(syncButton, originalText, progressContainer);
      }, 4000);
      
    } catch (error) {
      console.error('Omada sync failed:', error);
      this._updateProgress(progressContainer, 100, `Erro: ${error.message}`);
      
      syncButton.innerHTML = '<ha-icon icon="mdi:alert-circle"></ha-icon><span> Erro na conexão Omada!</span>';
      syncButton.classList.add('error');
      
      this._showNotification(`❌ Erro ao conectar com Omada: ${error.message}`);
      
      setTimeout(() => {
        this._updateProgress(progressContainer, 0, 'Tentando método alternativo...');
        this._syncWithIntegrationReload(syncButton, originalText, progressContainer);
      }, 2000);
    }
  }
  
  _syncWithIntegrationReload(syncButton, originalText, progressContainer) {
    this._updateProgress(progressContainer, 20, 'Procurando integração TP-Link Omada...');
    
    if (this._hass.config_entries) {
      const omadaEntry = Object.values(this._hass.config_entries).find(entry => 
        entry.domain === this.config.service_domain);
      
      if (omadaEntry) {
        this._updateProgress(progressContainer, 40, 'Recarregando integração...');
        syncButton.innerHTML = '<ha-icon icon="mdi:loading" class="loading-icon"></ha-icon><span> Recarregando integração...</span>';
        
        this._hass.callService('homeassistant', 'reload_config_entry', {
          entry_id: omadaEntry.entry_id
        }).then(() => {
          this._updateProgress(progressContainer, 100, 'Integração recarregada com sucesso!');
          
          syncButton.innerHTML = '<ha-icon icon="mdi:check-circle"></ha-icon><span> Integração recarregada!</span>';
          syncButton.classList.add('success');
          
          this._showNotification('✅ Integração TP-Link Omada recarregada com sucesso.');
          
          setTimeout(() => {
            this._restoreSyncButton(syncButton, originalText, progressContainer);
          }, 3000);
        }).catch((error) => {
          console.error('Error reloading integration:', error);
          this._updateProgress(progressContainer, 60, 'Erro ao recarregar. Tentando atualizar card...');
          
          // Final fallback: just refresh the card
          setTimeout(() => {
            this._updateProgress(progressContainer, 100, 'Card atualizado!');
            syncButton.innerHTML = '<ha-icon icon="mdi:refresh"></ha-icon><span> Card atualizado!</span>';
            syncButton.classList.add('success');
            this._throttledRender();
            
            this._showNotification('ℹ️ Card atualizado. Integração pode não ter sido recarregada.');
            
            setTimeout(() => {
              this._restoreSyncButton(syncButton, originalText, progressContainer);
            }, 3000);
          }, 1000);
        });
      } else {
        this._updateProgress(progressContainer, 60, 'Integração não encontrada. Atualizando card...');
        
        // Just refresh the card
        setTimeout(() => {
          this._updateProgress(progressContainer, 100, 'Card atualizado!');
          syncButton.innerHTML = '<ha-icon icon="mdi:refresh"></ha-icon><span> Card atualizado!</span>';
          syncButton.classList.add('success');
          this._throttledRender();
          
          this._showNotification('ℹ️ Card atualizado. Configure conexão direta com Omada para melhor funcionalidade.');
          
          setTimeout(() => {
            this._restoreSyncButton(syncButton, originalText, progressContainer);
          }, 3000);
        }, 1000);
      }
    } else {
      this._updateProgress(progressContainer, 100, 'Erro: Sistema não suportado');
      syncButton.innerHTML = '<ha-icon icon="mdi:alert-circle"></ha-icon><span> Sistema não suportado!</span>';
      syncButton.classList.add('error');
      
      this._showNotification('❌ Não foi possível acessar as configurações do Home Assistant.');
      
      setTimeout(() => {
        this._restoreSyncButton(syncButton, originalText, progressContainer);
      }, 3000);
    }
  }
  
  _showNotification(message) {
    if (this._hass && this._hass.callService) {
      this._hass.callService('persistent_notification', 'create', {
        message: message,
        title: 'RSSI Device Grid',
        notification_id: `rssi_grid_${Date.now()}`
      });
    } else {
      // Fallback to console
      console.log(`[RSSI Device Grid] ${message}`);
    }
  }
  
  _restoreSyncButton(button, originalText, progressContainer = null) {
    this._syncingNames = false;
    button.innerHTML = originalText;
    button.disabled = false;
    button.classList.remove('success', 'error');
    
    // Remove progress container after a delay
    if (progressContainer) {
      setTimeout(() => {
        this._removeProgress(progressContainer);
      }, 1000);
    }
  }
  
  /* --- Device Reconnection --- */
  
  // Reconnect a single device
  _reconnectDevice(device, button) {
    if (!this._hass || !device.mac) return;
    
    const originalButtonText = button.innerHTML;
    
    // Visual feedback
    button.innerHTML = '<ha-icon icon="mdi:loading" class="loading-icon"></ha-icon> Reconnecting...';
    button.style.backgroundColor = '#0D3880';
    button.disabled = true;
    
    let macAddress = device.mac;
    
    // Format MAC if configured
    if (this.config.format_mac) {
      macAddress = macAddress.replace(/:/g, '-').toUpperCase();
    }
    
    // Parameters for the service
    const params = {};
    params[this.config.mac_param] = macAddress;
    
    this._hass.callService(
      this.config.service_domain,
      this.config.service_action,
      params
    ).then(() => {
      button.innerHTML = '<ha-icon icon="mdi:check"></ha-icon> Sent!';
      button.style.backgroundColor = '#2ecc71';
      
      setTimeout(() => {
        this._restoreButton(button, originalButtonText);
      }, 3000);
    }).catch(error => {
      console.error('Error reconnecting device:', error);
      button.innerHTML = '<ha-icon icon="mdi:alert"></ha-icon> Error!';
      button.style.backgroundColor = '#e74c3c';
      
      setTimeout(() => {
        this._restoreButton(button, originalButtonText);
      }, 3000);
    });
  }
  
  _restoreButton(button, originalText) {
    button.innerHTML = originalText;
    button.disabled = false;
    button.style.backgroundColor = '#1a4b8c';
  }
  
  // Reconnect all devices with weak signals
  _reconnectWeakSignals() {
    if (!this._hass || this._reconnectingAll) return;
    
    // Find devices with weak signals
    const weakDevices = this._getWeakSignalDevices();
    
    // If no weak devices, nothing to do
    if (weakDevices.length === 0) {
      // Flash success message even though nothing was done
      const reconnectAllButton = this._elements.reconnectAllButton;
      if (reconnectAllButton) {
        const originalText = reconnectAllButton.innerHTML;
        reconnectAllButton.innerHTML = '<ha-icon icon="mdi:check"></ha-icon><span> Nenhum dispositivo com sinal fraco</span>';
        reconnectAllButton.classList.add('success');
        
        setTimeout(() => {
          reconnectAllButton.innerHTML = originalText;
          reconnectAllButton.classList.remove('success');
        }, 3000);
      }
      return;
    }
    
    // Start reconnection process
    this._reconnectingAll = true;
    this._reconnectQueue = [...weakDevices];
    
    // Update button state
    const reconnectAllButton = this._elements.reconnectAllButton;
    if (reconnectAllButton) {
      reconnectAllButton.disabled = true;
      reconnectAllButton.innerHTML = 
        `<ha-icon icon="mdi:loading" class="loading-icon"></ha-icon><span> 
         Reconectando <span class="reconnect-progress">0/${weakDevices.length}</span></span>`;
    }
    
    // Start processing queue
    this._processReconnectQueue();
  }
  
  // Process reconnect queue
  _processReconnectQueue() {
    // If queue is empty, finish
    if (this._reconnectQueue.length === 0) {
      this._finishReconnectAll(true);
      return;
    }
    
    const device = this._reconnectQueue.shift();
    const reconnectAllButton = this._elements.reconnectAllButton;
    
    // Update progress display
    if (reconnectAllButton) {
      const totalDevices = this._getWeakSignalDevices().length;
      const processed = totalDevices - this._reconnectQueue.length - 1;
      
      const progressEl = reconnectAllButton.querySelector('.reconnect-progress');
      if (progressEl) {
        progressEl.textContent = `${processed}/${totalDevices}`;
      }
    }
    
    // Format MAC address if needed
    let macAddress = device.mac;
    if (this.config.format_mac) {
      macAddress = macAddress.replace(/:/g, '-').toUpperCase();
    }
    
    // Prepare service parameters
    const params = {};
    params[this.config.mac_param] = macAddress;
    
    // Call service to reconnect device
    this._hass.callService(
      this.config.service_domain,
      this.config.service_action,
      params
    ).then(() => {
      // Wait a short delay before processing next device
      setTimeout(() => {
        this._processReconnectQueue();
      }, 500);
    }).catch(error => {
      console.error('Error reconnecting device:', error);
      // Continue with next device despite error
      setTimeout(() => {
        this._processReconnectQueue();
      }, 500);
    });
  }
  
  // Finish reconnect all operation
  _finishReconnectAll(success) {
    this._reconnectingAll = false;
    
    // Update button state
    const reconnectAllButton = this._elements.reconnectAllButton;
    if (reconnectAllButton) {
      if (success) {
        reconnectAllButton.innerHTML = '<ha-icon icon="mdi:check"></ha-icon><span> Reconexão completa!</span>';
        reconnectAllButton.classList.add('success');
      } else {
        reconnectAllButton.innerHTML = '<ha-icon icon="mdi:alert"></ha-icon><span> Erro na reconexão!</span>';
        reconnectAllButton.classList.add('error');
      }
      
      // Re-enable button after delay
      setTimeout(() => {
        reconnectAllButton.disabled = false;
        reconnectAllButton.classList.remove('success', 'error');
        reconnectAllButton.innerHTML = '<ha-icon icon="mdi:wifi-refresh"></ha-icon><span> Reconectar sinais fracos</span>';
      }, 3000);
    }
  }

  // Método para mostrar as propriedades do dispositivo
_showDeviceMoreInfo(deviceId) {
  if (!deviceId) return;
  
  // Solução mais direta para o Home Assistant: usar window.history.pushState
  // Isso efetivamente navega para a URL da página do dispositivo
  try {
    const url = `/config/devices/device/${deviceId}`;
    window.history.pushState(null, '', url);
    
    // Dispara um evento de navegação para notificar o Home Assistant sobre a mudança de URL
    const navEvent = new Event('location-changed', {
      bubbles: true,
      composed: true
    });
    window.dispatchEvent(navEvent);
    
    console.log('Navegação para dispositivo realizada:', deviceId);
    return;
  } catch (e) {
    console.error('Erro durante navegação direta:', e);
  }
  
  // Método alternativo usando a API do Home Assistant
  if (this._hass && this._hass.navigate) {
    try {
      this._hass.navigate(`/config/devices/device/${deviceId}`);
      console.log('Navegação via hass.navigate realizada:', deviceId);
      return;
    } catch (e) {
      console.error('Erro ao usar hass.navigate:', e);
    }
  }
  
  // Método alternativo via evento mais-info
  try {
    // Documentação oficial do HA recomenda este formato
    const event = new CustomEvent('hass-more-info', {
      bubbles: true,
      composed: true,
      detail: {
        entityId: null,
        deviceId: deviceId
      }
    });
    this.dispatchEvent(event);
    console.log('Evento hass-more-info enviado para deviceId:', deviceId);
  } catch (e) {
    console.error('Erro ao enviar evento hass-more-info:', e);
  }
}
  
  getCardSize() {
    return 1 + Math.min(this._cache.deviceList.length, 5);
  }
}

// Register the custom card
customElements.define('rssi-device-grid', RssiDeviceGrid);

// Information for HACS
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'rssi-device-grid',
  name: 'RSSI Device Grid',
  description: 'Displays entities with RSSI and their associated device_tracker information with reconnect functionality and automatic Omada name sync - Version 1.3.0'
});
