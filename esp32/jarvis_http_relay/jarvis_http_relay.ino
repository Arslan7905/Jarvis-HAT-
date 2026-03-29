#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const int RELAY_PIN = 26;
const bool RELAY_ACTIVE_LOW = true;

const char* DEVICE_NAME = "lights";
const char* DEVICE_LOCATION = "living_room";
const char* DEVICE_LABEL = "Living Room Lights";

WebServer server(80);
bool relayIsOn = false;

void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

void writeRelayState(bool nextState) {
  relayIsOn = nextState;

  if (RELAY_ACTIVE_LOW) {
    digitalWrite(RELAY_PIN, nextState ? LOW : HIGH);
    return;
  }

  digitalWrite(RELAY_PIN, nextState ? HIGH : LOW);
}

void sendJsonResponse(int statusCode, const String& message) {
  StaticJsonDocument<256> responseDoc;
  JsonArray updates = responseDoc.createNestedArray("updates");
  JsonObject update = updates.createNestedObject();

  responseDoc["message"] = message;
  update["device"] = DEVICE_NAME;
  update["location"] = DEVICE_LOCATION;
  update["state"] = relayIsOn ? "ON" : "OFF";

  String responseBody;
  serializeJson(responseDoc, responseBody);

  addCorsHeaders();
  server.send(statusCode, "application/json", responseBody);
}

void handleOptions() {
  addCorsHeaders();
  server.send(204);
}

void handleControl() {
  if (!server.hasArg("plain")) {
    addCorsHeaders();
    server.send(400, "application/json", "{\"error\":\"Missing JSON body.\"}");
    return;
  }

  StaticJsonDocument<512> requestDoc;
  DeserializationError error = deserializeJson(requestDoc, server.arg("plain"));

  if (error) {
    addCorsHeaders();
    server.send(400, "application/json", "{\"error\":\"Invalid JSON.\"}");
    return;
  }

  if (requestDoc["ping"] == true) {
    sendJsonResponse(200, "ESP32 HTTP endpoint responded successfully.");
    return;
  }

  const char* device = requestDoc["device"] | "";
  const char* location = requestDoc["location"] | "";
  const char* action = requestDoc["action"] | "";

  if (String(device) != DEVICE_NAME || String(location) != DEVICE_LOCATION) {
    addCorsHeaders();
    server.send(400, "application/json", "{\"error\":\"Unsupported device target.\"}");
    return;
  }

  if (String(action) == "on") {
    writeRelayState(true);
    sendJsonResponse(200, String(DEVICE_LABEL) + " turned on");
    return;
  }

  if (String(action) == "off") {
    writeRelayState(false);
    sendJsonResponse(200, String(DEVICE_LABEL) + " turned off");
    return;
  }

  addCorsHeaders();
  server.send(400, "application/json", "{\"error\":\"Unsupported action.\"}");
}

void connectToWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("Connected. ESP32 IP: ");
  Serial.println(WiFi.localIP());
  Serial.println("HTTP control endpoint: /control");
}

void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  writeRelayState(false);

  connectToWifi();

  server.on("/control", HTTP_OPTIONS, handleOptions);
  server.on("/control", HTTP_POST, handleControl);
  server.begin();

  Serial.println("Jarvis relay server is ready.");
}

void loop() {
  server.handleClient();
}
