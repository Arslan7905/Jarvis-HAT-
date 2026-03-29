# ESP32 HTTP Setup

This project already supports live ESP32 control over HTTP from the browser.
The frontend sends JSON directly to the configured ESP32 endpoint.

## Recommended First Device Mapping

For the first real test, map a single relay-controlled bulb to:

- `device: "lights"`
- `location: "living_room"`

That matches the existing registry in `src/automation/deviceRegistry.js`.

## Request Contract

Jarvis sends a `POST` request with `Content-Type: application/json`.

### Ping Request

Used by the Admin Panel transport test:

```json
{
  "ping": true
}
```

### Device Command Request

```json
{
  "device": "lights",
  "location": "living_room",
  "action": "on"
}
```

Supported values in the current frontend:

- `device`: `fan`, `lights`, `ac`
- `location`: `living_room`, `bedroom`
- `action`: `on`, `off`

## Response Contract

The ESP32 should reply with JSON like this:

```json
{
  "message": "Living Room Lights turned on",
  "updates": [
    {
      "device": "lights",
      "location": "living_room",
      "state": "ON"
    }
  ]
}
```

Jarvis can also parse a simpler single-update response:

```json
{
  "device": "lights",
  "location": "living_room",
  "state": "ON"
}
```

## CORS Requirements

Because the browser calls the ESP32 directly, the firmware must allow:

- `POST`
- `OPTIONS`
- `Content-Type: application/json`

At minimum, include these headers in HTTP responses:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Methods: POST, OPTIONS
```

## Manual Test Order

1. Flash the example sketch from `esp32/jarvis_http_relay/jarvis_http_relay.ino`.
   Install the `ArduinoJson` library first if the IDE asks for it.
2. Update the Wi-Fi credentials and relay pin.
3. Open the serial monitor and note the ESP32 IP.
4. Confirm `http://<ESP32-IP>/control` is reachable.
5. In Jarvis Admin Panel:
   - disable `Use Mock Devices`
   - set `Transport Mode` to `HTTP`
   - set the HTTP endpoint to `http://<ESP32-IP>/control`
6. Click `Test device transport`.
7. Try a typed command:
   - `Turn on the living room light`
8. Try the off command:
   - `Turn off the living room light`
9. After typed commands work, test voice:
   - `Hey Jarvis, turn on the living room light`

## PowerShell Test Example

Replace the IP with your ESP32 address:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://192.168.1.50/control `
  -ContentType "application/json" `
  -Body '{"device":"lights","location":"living_room","action":"on"}'
```

## Notes

- The current project does not include Bluetooth transport.
- HTTP is the easiest first milestone. Add WebSocket only after HTTP works.
- If you want different device names or more relays, update both the ESP32 sketch and `src/automation/deviceRegistry.js`.
