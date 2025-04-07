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
      button.innerHTML = `<ha-icon icon="mdi:wifi-refresh"></ha-icon> Reconectar ${weakDevicesCount} sinais fracos`;
    } else {
      button.disabled = false;
      button.innerHTML = `<ha-icon icon="mdi:wifi-refresh"></ha-icon> Reconectar sinais fracos`;
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
    const reconnectAllButton = this._elements.reconnectAllButton;
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
  
  // Método para mostrar as propriedades do dispositivo
  _showDeviceMoreInfo(deviceId) {
    if (!deviceId) return;
    
    // Método mais direto usando a navegação do Home Assistant
    // Esta é a maneira recomendada a partir do HA 2023.11+
    if (this._hass && this._hass.navigate) {
      // Método moderno usando a API de navegação
      try {
        this._hass.navigate(`/config/devices/device/${deviceId}`);
        return;
      } catch (e) {
        console.error("Erro ao usar o método de navegação:", e);
      }
    }
    
    // Método alternativo - usar o evento personalizado
    try {
      this.dispatchEvent(new CustomEvent('hass-more-info', {
        bubbles: true,
        composed: true,
        detail: {
          entityId: null,
          deviceId: deviceId
        }
      }));
      console.log('Evento hass-more-info enviado para deviceId:', deviceId);
    } catch (e) {
      console.error("Erro ao enviar evento hass-more-info:", e);
      
      // Último recurso - tentar abrir diretamente via URL
      const hassRoot = document.querySelector('home-assistant');
      if (hassRoot && hassRoot.hassNavigate) {
        hassRoot.hassNavigate(`/config/devices/device/${deviceId}`);
      }
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
  description: 'Displays entities with RSSI and their associated device_tracker information with reconnect functionality - Optimized Version'
});
