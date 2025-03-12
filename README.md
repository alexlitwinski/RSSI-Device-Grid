# RSSI Device Grid Card for Home Assistant

![HACS Badge](https://img.shields.io/badge/HACS-Custom-orange.svg)

This custom card for Home Assistant displays entities whose names end with "RSSI", finds their associated device_tracker entities, and shows them in a grid with reconnect functionality.

## Features

- 🔍 Automatically finds all entities ending with "RSSI"
- 📡 Identifies the associated device_tracker entities for each device
- 📊 Displays MAC address and IP information from device_tracker attributes
- 🔄 Includes a reconnect button that calls your Omada service
- 🔢 Shows signal strength values with color coding
- 🔤 Sortable columns (name, RSSI, MAC, IP)
- 🧮 Filtering functionality
- 🎨 Themeable to match your Home Assistant theme

## Installation

### HACS Installation (Recommended)

1. Open HACS in your Home Assistant instance
2. Go to the "Frontend" section
3. Click the three dots in the top right corner
4. Select "Custom repositories"
5. Add this repository URL: `https://github.com/YOUR_USERNAME/rssi-device-grid`
6. Select "Lovelace" as the category
7. Click "Add"
8. Find and install "RSSI Device Grid" from the list

### Manual Installation

1. Download the `rssi-device-grid.js` file from the latest release
2. Upload it to your Home Assistant's `/config/www/` directory
3. Add the resource to your Lovelace configuration:

```yaml
resources:
  - url: /local/rssi-device-grid.js
    type: module
```

## Usage

### Basic Configuration

```yaml
type: custom:rssi-device-grid
title: WiFi Devices
```

### Full Configuration Options

```yaml
type: custom:rssi-device-grid
title: WiFi Devices
service_domain: tplink_omada
service_action: reconnect_client
mac_param: mac
format_mac: true
columns_order:
  - name
  - rssi
  - mac
  - ip
  - actions
show_offline: true
max_devices: 0
sort_by: name
sort_order: asc
state_text: true
alternating_rows: true
show_filter: true
filter_placeholder: Filter devices...
sortable_columns:
  - name
  - rssi
  - mac
  - ip
enable_sorting: true
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | `RSSI Devices` | Card title |
| `service_domain` | string | `tplink_omada` | Service domain for reconnect |
| `service_action` | string | `reconnect_client` | Service name for reconnect |
| `mac_param` | string | `mac` | Parameter name for MAC address |
| `format_mac` | boolean | `true` | Format MAC address (replace : with - and uppercase) |
| `columns_order` | array | `['name', 'rssi', 'mac', 'ip', 'actions']` | Column order |
| `show_offline` | boolean | `true` | Show offline devices |
| `max_devices` | number | `0` | Maximum devices to show (0 = unlimited) |
| `sort_by` | string | `name` | Default sort column |
| `sort_order` | string | `asc` | Default sort order (asc/desc) |
| `state_text` | boolean | `true` | Show state indicator |
| `alternating_rows` | boolean | `true` | Use alternating row colors |
| `show_filter` | boolean | `true` | Show filter input |
| `filter_placeholder` | string | `Filter devices...` | Placeholder for filter input |
| `sortable_columns` | array | `['name', 'rssi', 'mac', 'ip']` | Columns that can be sorted |
| `enable_sorting` | boolean | `true` | Enable column sorting |

## How It Works

1. The card finds all entities ending with "RSSI" in their name
2. For each entity, it locates the associated device and finds any device_tracker entities for that device
3. If multiple device_tracker entities exist, it prioritizes ones with "home" state
4. MAC address and IP are extracted from the device_tracker attributes
5. When the reconnect button is clicked, it calls the Omada service with the MAC address as a parameter

## Example Use Cases

- Monitor WiFi signal strength for devices on your network
- Easily reconnect devices with poor signal
- Track device IP addresses
- Monitor device connection status

## Support

If you encounter any issues or have suggestions, please open an issue on GitHub.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
