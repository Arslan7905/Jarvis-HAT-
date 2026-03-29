const fs = require('node:fs');
const path = require('node:path');

const STORE_FILE = process.env.SETTINGS_STORE_FILE
  ? path.resolve(process.env.SETTINGS_STORE_FILE)
  : path.join(__dirname, '..', 'data', 'settings-store.json');

const DEFAULT_SETTINGS = {
  aiEndpoint:
    process.env.REACT_APP_AI_API_URL || 'http://localhost:3001/api/ai/chat',
  deviceTransport:
    process.env.REACT_APP_ESP32_PROTOCOL === 'http' ? 'http' : 'websocket',
  httpEndpoint: process.env.REACT_APP_ESP32_HTTP_URL || '',
  websocketEndpoint: process.env.REACT_APP_ESP32_WS_URL || '',
  useMockDevices: true,
  mockDeviceLatencyMs: 450,
  allowInterruptions: true,
  requireDangerousConfirmation: true,
  mockLaptopActions: true,
  laptopPermissions: {
    allowPower: false,
    allowApps: true,
    allowUrls: true,
    allowVolume: true,
  },
};

const DEFAULT_STORE = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  sessions: {},
};

function ensureStoreFile() {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });

  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(DEFAULT_STORE, null, 2));
  }
}

function mergeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    laptopPermissions: {
      ...DEFAULT_SETTINGS.laptopPermissions,
      ...(settings?.laptopPermissions || {}),
    },
  };
}

function readStore() {
  ensureStoreFile();

  try {
    const rawStore = fs.readFileSync(STORE_FILE, 'utf8');
    const parsedStore = JSON.parse(rawStore);

    return {
      ...DEFAULT_STORE,
      ...parsedStore,
      settings: mergeSettings(parsedStore?.settings || {}),
      sessions: parsedStore?.sessions || {},
    };
  } catch (error) {
    return {
      ...DEFAULT_STORE,
      settings: mergeSettings(DEFAULT_STORE.settings),
    };
  }
}

function writeStore(store) {
  ensureStoreFile();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  return store;
}

function sanitizeSessionId(sessionId) {
  const normalizedId = String(sessionId || '').trim();

  if (!normalizedId || normalizedId.length > 160) {
    throw new Error('A valid session id is required.');
  }

  return normalizedId.replace(/[^a-zA-Z0-9:_-]/g, '');
}

function sanitizeText(value, fallback, maxLength = 80) {
  const normalizedValue = String(value || '').trim().slice(0, maxLength);
  return normalizedValue || fallback;
}

function sanitizeDeviceType(value) {
  return ['desktop', 'mobile', 'tablet'].includes(value) ? value : 'desktop';
}

function sanitizeSessionMetadata(metadata = {}) {
  return {
    label: sanitizeText(metadata.label, 'Unknown Device'),
    browser: sanitizeText(metadata.browser, 'Unknown Browser', 40),
    platform: sanitizeText(metadata.platform, 'Unknown Platform', 40),
    deviceType: sanitizeDeviceType(metadata.deviceType),
    appName: sanitizeText(metadata.appName, 'JarvisAI Web', 40),
    appVersion: sanitizeText(metadata.appVersion, 'dev', 24),
  };
}

function toPublicSessionRecord(session, currentSessionId) {
  return {
    id: session.id,
    label: session.label,
    browser: session.browser,
    platform: session.platform,
    deviceType: session.deviceType,
    appName: session.appName,
    appVersion: session.appVersion,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    isCurrent: session.id === currentSessionId,
  };
}

function buildSessionInventory(store, currentSessionId) {
  const sessions = Object.values(store.sessions)
    .filter((session) => !session.revokedAt)
    .sort((left, right) => {
      if (left.id === currentSessionId) {
        return -1;
      }

      if (right.id === currentSessionId) {
        return 1;
      }

      return (
        new Date(right.lastSeenAt || 0).getTime() -
        new Date(left.lastSeenAt || 0).getTime()
      );
    })
    .map((session) => toPublicSessionRecord(session, currentSessionId));

  return {
    currentSessionId: currentSessionId || '',
    sessions,
  };
}

function getSettingsSnapshot() {
  const store = readStore();

  return {
    version: store.version,
    settings: store.settings,
  };
}

function patchSettings(patch = {}) {
  const store = readStore();
  store.settings = mergeSettings({
    ...store.settings,
    ...patch,
    laptopPermissions: {
      ...(store.settings?.laptopPermissions || {}),
      ...(patch?.laptopPermissions || {}),
    },
  });
  writeStore(store);

  return {
    version: store.version,
    settings: store.settings,
  };
}

function registerSession(sessionId, metadata = {}) {
  const normalizedSessionId = sanitizeSessionId(sessionId);
  const store = readStore();
  const now = new Date().toISOString();
  const nextMetadata = sanitizeSessionMetadata(metadata);
  const existingSession = store.sessions[normalizedSessionId] || {};

  store.sessions[normalizedSessionId] = {
    ...existingSession,
    ...nextMetadata,
    id: normalizedSessionId,
    createdAt: existingSession.createdAt || now,
    lastSeenAt: now,
    revokedAt: null,
  };

  writeStore(store);
  return buildSessionInventory(store, normalizedSessionId);
}

function listSessions(currentSessionId = '') {
  const store = readStore();
  const normalizedSessionId = currentSessionId
    ? sanitizeSessionId(currentSessionId)
    : '';

  return buildSessionInventory(store, normalizedSessionId);
}

function revokeSession(targetSessionId, currentSessionId = '') {
  const normalizedTargetSessionId = sanitizeSessionId(targetSessionId);
  const normalizedCurrentSessionId = currentSessionId
    ? sanitizeSessionId(currentSessionId)
    : '';
  const store = readStore();

  if (store.sessions[normalizedTargetSessionId]) {
    store.sessions[normalizedTargetSessionId] = {
      ...store.sessions[normalizedTargetSessionId],
      revokedAt: new Date().toISOString(),
    };
    writeStore(store);
  }

  return buildSessionInventory(store, normalizedCurrentSessionId);
}

function revokeOtherSessions(currentSessionId) {
  const normalizedCurrentSessionId = sanitizeSessionId(currentSessionId);
  const store = readStore();
  const revokedAt = new Date().toISOString();

  Object.keys(store.sessions).forEach((sessionId) => {
    if (sessionId !== normalizedCurrentSessionId) {
      store.sessions[sessionId] = {
        ...store.sessions[sessionId],
        revokedAt,
      };
    }
  });

  writeStore(store);
  return buildSessionInventory(store, normalizedCurrentSessionId);
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettingsSnapshot,
  listSessions,
  mergeSettings,
  patchSettings,
  registerSession,
  revokeOtherSessions,
  revokeSession,
};
