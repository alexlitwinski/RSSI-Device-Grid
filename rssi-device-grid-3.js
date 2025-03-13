/**
 * RSSI Device Grid Card for Home Assistant
 * 
 * This component finds all entities whose names end with "RSSI",
 * locates their associated device_tracker entities, and displays them in a grid with:
 * - Entity name (without the "RSSI" suffix)
 * - MAC address (from device_tracker attributes)
 * - IP address (from device_tracker attributes)
 * - Reconnect button (calls the Omada service to reconnect the device)
 * - Added: Reconnect All Weak Signals button (reconnects all devices with signal < 50%)
 * 
 * Version: 1.1.0
 */

class RssiDeviceGrid extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    
    // Cache for DOM elements and states
    this._cache = {
      elements: {},
      lastStates: {},
      deviceList: []
    };
    
    // Set up styles
    this._setupStyles();
    
    // Flags for rendering control
    this._isInitialRender = true;
    this._updateTimerId = null;
    
    // Initial sort state
    this._sortState = {
      column: 'name',
      order: 'asc'
    };
    
    // Track reconnection operations
    this._reconnectingAll = false;
    this._reconnectQueue = [];
  }

  setConfig(config) {
    this.config = {
      title: config.title || 'RSSI Devices',
      service: config.service || 'tplink_omada.reconnect_client',
      service_domain: config.service_domain || 'tplink_omada',
      service_action: config.service_action || 'reconnect_client',
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
      reconnect_all_button: config.reconnect_all_button !== false // Show reconnect all button
    };
    
    // Initialize empty filter
    this._textFilter = '';
    
    // Set initial sort state based on configuration
    this._sortState = {
      column: this.config.sort_by,
      order: this.config.sort_order
    };
    
    this._isInitialRender = true;
  }

  set hass(hass) {
    this._hass = hass;
    
    // Save previous filter to detect changes
    this._previousTextFilter = this._textFilter;
    
    // Update device list and check for changes
    if (this._updateDeviceList() || this._isInitialRender) {
      this._throttledUpdate();
    }
  }

  // Helper function to normalize text (remove accents and convert to lowercase)
  _normalizeText(text) {
    if (!text) return '';
    return text.normalize('NFD')
               .replace(/[\u0300-\u036f]/g, '') // Remove accents
               .toLowerCase();
  }
  
  _updateDeviceList() {
    if (!this._hass) return false;
    
    const newDeviceList = [];
    let hasChanges = false;
    const normalizedFilter = this._normalizeText(this._textFilter);
    
    // Helper function to find device_tracker entity for a device
    const findDeviceTracker = (deviceId) => {
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
    };
    
    // Get all entities ending with "RSSI"
    Object.entries(this._hass.states).forEach(([entityId, stateObj]) => {
      if (entityId.endsWith('_rssi') || 
          (stateObj.attributes.friendly_name && 
           stateObj.attributes.friendly_name.endsWith('RSSI'))) {
        
        // Get device ID for this entity
        const deviceId = this._hass.entities[entityId]?.device_id;
        
        if (deviceId) {
          // Find device_tracker entity for this device
          const deviceTracker = findDeviceTracker(deviceId);
          
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
              tracker_entity_id: deviceTracker.entity_id
            };
            
            // Check if we should show offline devices
            if (!this.config.show_offline && 
                (deviceTracker.state === 'not_home' || deviceTracker.state === 'fora_de_casa')) {
              return;
            }
            
            // Apply text filter if it exists
            if (normalizedFilter) {
              const normalizedName = this._normalizeText(device.name);
              const normalizedMac = this._normalizeText(device.mac);
              const normalizedIp = this._normalizeText(device.ip);
              
              // Check if device contains filter text
              const matchesFilter = 
                normalizedName.includes(normalizedFilter) || 
                normalizedMac.includes(normalizedFilter) || 
                normalizedIp.includes(normalizedFilter);
              
              if (!matchesFilter) {
                return;
              }
            }
            
            newDeviceList.push(device);
            
            // Check if there were changes for this device
            const deviceKey = `${entityId}_${device.state}_${device.ip}_${device.mac}_${device.rssi}`;
            if (!this._cache.lastStates[entityId] || this._cache.lastStates[entityId] !== deviceKey) {
              this._cache.lastStates[entityId] = deviceKey;
              hasChanges = true;
            }
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
    
    // Check if list size changed
    if (this._cache.deviceList.length !== newDeviceList.length) {
      hasChanges = true;
    }
    
    this._cache.deviceList = newDeviceList;
    return hasChanges || this._textFilter !== this._previousTextFilter;
  }

  _sortDeviceList(deviceList) {
    const { column, order } = this._sortState;
    
    deviceList.sort((a, b) => {
      let valA = a[column];
      let valB = b[column];
      
      // Handle null or undefined values
      if (valA === null || valA === undefined) valA = '';
      if (valB === null || valB === undefined) valB = '';
      
      // For RSSI values (which are negative numbers), sort by signal strength
      if (column === 'rssi') {
        // Convert to numbers and compare
        valA = parseFloat(valA);
        valB = parseFloat(valB);
        
        // Handle non-number values
        if (isNaN(valA)) valA = -999;
        if (isNaN(valB)) valB = -999;
        
        // For RSSI, higher (less negative) values are better
        if (order === 'asc') {
          return valA - valB; // Ascending = weaker to stronger
        } else {
          return valB - valA; // Descending = stronger to weaker
        }
      }
      
      // Convert to lowercase for case-insensitive sorting if it's a string
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      
      if (valA < valB) return order === 'asc' ? -1 : 1;
      if (valA > valB) return order === 'asc' ? 1 : -1;
      return 0;
    });
  }

  _throttledUpdate() {
    // If we're already processing, don't trigger another
    if (this._updateTimerId !== null) {
      clearTimeout(this._updateTimerId);
    }
    
    this._updateTimerId = setTimeout(() => {
      this._updateTimerId = null;
      this._updateCard();
      
      // Update the reconnect all button state if it exists
      if (this._cache.elements && this._cache.elements.reconnectAllButton && !this._reconnectingAll) {
        const weakDevices = this._getWeakSignalDevices();
        const reconnectAllButton = this._cache.elements.reconnectAllButton;
        
        if (weakDevices.length > 0) {
          reconnectAllButton.disabled = false;
          reconnectAllButton.innerHTML = 
            `<ha-icon icon="mdi:wifi-refresh"></ha-icon> Reconectar ${weakDevices.length} sinais fracos`;
        } else {
          reconnectAllButton.disabled = false;
          reconnectAllButton.innerHTML = 
            `<ha-icon icon="mdi:wifi-refresh"></ha-icon> Reconectar sinais fracos`;
        }
      }
    }, 100); // 100ms debounce
  }

  _updateCard() {
    if (!this._hass || !this.config) return;
    
    if (this._isInitialRender) {
      this._renderCard();
      this._isInitialRender = false;
    } else {
      this._updateGrid();
    }
  }

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
      
      .mac-address {
        font-family: monospace;
        font-size: 13px;
      }
      
      .ip-address {
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
      
      .reconnect-progress {
        font-size: 12px;
        font-weight: 400;
        margin-left: 5px;
      }
      
      .empty-message {
        padding: 24px;
        text-align: center;
        color: var(--secondary-text-color);
        font-size: 14px;
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
      
      .no-results {
        padding: 24px;
        text-align: center;
        color: var(--secondary-text-color);
        font-style: italic;
      }
      
      /* Styles for sortable headers */
      .sortable {
        cursor: pointer;
        user-select: none;
        position: relative;
      }
      
      .sortable:hover {
        color: var(--primary-color);
      }
      
      .sort-icon {
        margin-left: 5px;
        font-size: 12px;
        position: relative;
        top: 1px;
      }
      
      .sort-asc:after {
        content: "▲";
        display: inline-block;
        margin-left: 5px;
      }
      
      .sort-desc:after {
        content: "▼";
        display: inline-block;
        margin-left: 5px;
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
    
    // Add reconnect all button if configured
    if (this.config.reconnect_all_button) {
      const reconnectAllButton = document.createElement('button');
      reconnectAllButton.className = 'reconnect-all-button';
      reconnectAllButton.id = 'reconnect-all-button';
      reconnectAllButton.innerHTML = '<ha-icon icon="mdi:wifi-refresh"></ha-icon> Reconectar sinais fracos';
      reconnectAllButton.addEventListener('click', () => this._reconnectWeakSignals());
      headerRight.appendChild(reconnectAllButton);
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
        this._updateDeviceList();
        this._updateGrid();
        
        // Show/hide clear button
        if (this._textFilter && this._textFilter.length > 0) {
          clearButton.style.display = 'flex';
        } else {
          clearButton.style.display = 'none';
        }
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
        this._updateDeviceList();
        this._updateGrid();
      });
      filterContainer.appendChild(clearButton);
      
      cardContent.appendChild(filterContainer);
    }
    
    // Device grid
    if (this._cache.deviceList.length > 0) {
      const gridContainer = document.createElement('table');
      gridContainer.className = 'grid-container';
      
      // Headers
      const headerRow = document.createElement('tr');
      
      this.config.columns_order.forEach(column => {
        if (column === 'name') {
          const th = document.createElement('th');
          th.textContent = 'Name';
          
          // Make sortable if configured
          if (this.config.enable_sorting && this.config.sortable_columns.includes('name')) {
            this._makeSortable(th, 'name');
          }
          
          headerRow.appendChild(th);
        } else if (column === 'rssi') {
          const th = document.createElement('th');
          th.textContent = 'RSSI';
          
          // Make sortable if configured
          if (this.config.enable_sorting && this.config.sortable_columns.includes('rssi')) {
            this._makeSortable(th, 'rssi');
          }
          
          headerRow.appendChild(th);
        } else if (column === 'mac') {
          const th = document.createElement('th');
          th.textContent = 'MAC';
          
          // Make sortable if configured
          if (this.config.enable_sorting && this.config.sortable_columns.includes('mac')) {
            this._makeSortable(th, 'mac');
          }
          
          headerRow.appendChild(th);
        } else if (column === 'ip') {
          const th = document.createElement('th');
          th.textContent = 'IP';
          
          // Make sortable if configured
          if (this.config.enable_sorting && this.config.sortable_columns.includes('ip')) {
            this._makeSortable(th, 'ip');
          }
          
          headerRow.appendChild(th);
        } else if (column === 'actions') {
          const th = document.createElement('th');
          th.textContent = '';
          headerRow.appendChild(th);
        }
      });
      
      const thead = document.createElement('thead');
      thead.appendChild(headerRow);
      gridContainer.appendChild(thead);
      
      // Table body
      const tbody = document.createElement('tbody');
      gridContainer.appendChild(tbody);
      
      // Store reference for updates
      this._cache.elements = {
        card,
        gridContainer,
        tbody,
        reconnectAllButton: this.config.reconnect_all_button ? 
                           this.shadowRoot.querySelector('#reconnect-all-button') : null,
        filterInput: this.config.show_filter ? cardContent.querySelector('.filter-input') : null
      };
      
      cardContent.appendChild(gridContainer);
      
      // Initialize grid with devices
      this._updateGrid();
    } else {
      // Check if there are no results due to filter
      let messageText = 'No devices found with current settings.';
      
      if (this._textFilter) {
        messageText = `No devices found for filter "${this._textFilter}".`;
      }
      
      const emptyMessage = document.createElement('div');
      emptyMessage.className = this._textFilter ? 'no-results' : 'empty-message';
      emptyMessage.innerHTML = messageText;
      cardContent.appendChild(emptyMessage);
      
      // Store reference for reconnectAllButton and filter input even with no results
      this._cache.elements = {
        card,
        reconnectAllButton: this.config.reconnect_all_button ? 
                           this.shadowRoot.querySelector('#reconnect-all-button') : null,
        filterInput: this.config.show_filter ? cardContent.querySelector('.filter-input') : null
      };
    }
  }

  // Method to make a header sortable
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
    let percentage = Math.max(0, Math.min(100, ((rssiValue + 90) / 60) * 100));
    percentage = Math.round(percentage);
    
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
      // Parse RSSI value
      const rssiValue = parseInt(device.rssi, 10);
      if (isNaN(rssiValue)) return false;
      
      // Calculate percentage
      const percentage = Math.max(0, Math.min(100, ((rssiValue + 90) / 60) * 100));
      
      // Check if below threshold
      return percentage < this.config.weak_signal_threshold;
    });
  }
  
  // Reconnect all devices with weak signals
  _reconnectWeakSignals() {
    if (!this._hass || this._reconnectingAll) return;
    
    // Find devices with weak signals
    const weakDevices = this._getWeakSignalDevices();
    
    // If no weak devices, nothing to do
    if (weakDevices.length === 0) {
      // Flash success message even though nothing was done
      const reconnectAllButton = this._cache.elements.reconnectAllButton;
      if (reconnectAllButton) {
        const originalText = reconnectAllButton.innerHTML;
        reconnectAllButton.innerHTML = '<ha-icon icon="mdi:check"></ha-icon> Nenhum dispositivo com sinal fraco';
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
    const reconnectAllButton = this._cache.elements.reconnectAllButton;
    if (reconnectAllButton) {
      reconnectAllButton.disabled = true;
      reconnectAllButton.innerHTML = 
        `<ha-icon icon="mdi:loading" class="loading-icon"></ha-icon> 
         Reconectando <span class="reconnect-progress">0/${weakDevices.length}</span>`;
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
    const reconnectAllButton = this._cache.elements.reconnectAllButton;
    
    // Update progress display
    if (reconnectAllButton) {
      const totalDevices = this._getWeakSignalDevices().length;
      const processed = totalDevices - this._reconnectQueue.length - 1;
      reconnectAllButton.querySelector('.reconnect-progress').textContent = 
        `${processed}/${totalDevices}`;
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
    const reconnectAllButton = this._cache.elements.reconnectAllButton;
    if (reconnectAllButton) {
      if (success) {
        reconnectAllButton.innerHTML = '<ha-icon icon="mdi:check"></ha-icon> Reconexão completa!';
        reconnectAllButton.classList.add('success');
      } else {
        reconnectAllButton.innerHTML = '<ha-icon icon="mdi:alert"></ha-icon> Erro na reconexão!';
        reconnectAllButton.classList.add('error');
      }
      
      // Re-enable button after delay
      setTimeout(() => {
        reconnectAllButton.disabled = false;
        reconnectAllButton.classList.remove('success', 'error');
        reconnectAllButton.innerHTML = '<ha-icon icon="mdi:wifi-refresh"></ha-icon> Reconectar sinais fracos';
      }, 3000);
    }
  }

// Register the custom card
customElements.define('rssi-device-grid', RssiDeviceGrid);

// Information for HACS
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'rssi-device-grid',
  name: 'RSSI Device Grid',
  description: 'Displays entities with RSSI and their associated device_tracker information with reconnect functionality'
});
