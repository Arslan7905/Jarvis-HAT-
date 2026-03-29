import {
  DEFAULT_AI_ENDPOINT,
  DEFAULT_HTTP_ENDPOINT,
  DEFAULT_PROTOCOL,
  DEFAULT_WEBSOCKET_ENDPOINT,
} from '../utils/jarvis';

export const STORAGE_KEYS = {
  settings: 'jarvis.automation-settings',
  actionLogs: 'jarvis.action-logs',
  sessionId: 'jarvis.session-id',
};

export const DEFAULT_AUTOMATION_SETTINGS = {
  aiEndpoint: DEFAULT_AI_ENDPOINT,
  deviceTransport: DEFAULT_PROTOCOL,
  httpEndpoint: DEFAULT_HTTP_ENDPOINT,
  websocketEndpoint: DEFAULT_WEBSOCKET_ENDPOINT,
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

export function mergeAutomationSettings(settings = {}) {
  return {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ...settings,
    laptopPermissions: {
      ...DEFAULT_AUTOMATION_SETTINGS.laptopPermissions,
      ...(settings?.laptopPermissions || {}),
    },
  };
}

function safeParseJson(value, fallbackValue) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallbackValue;
  }
}

export function readAutomationSettings() {
  if (typeof window === 'undefined') {
    return DEFAULT_AUTOMATION_SETTINGS;
  }

  try {
    const rawSettings = window.localStorage.getItem(STORAGE_KEYS.settings);

    if (!rawSettings) {
      return DEFAULT_AUTOMATION_SETTINGS;
    }

    const parsedSettings = safeParseJson(
      rawSettings,
      DEFAULT_AUTOMATION_SETTINGS
    );

    return mergeAutomationSettings(parsedSettings);
  } catch (error) {
    return DEFAULT_AUTOMATION_SETTINGS;
  }
}

export function writeAutomationSettings(settings) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify(mergeAutomationSettings(settings))
    );
  } catch (error) {
    // Ignore local storage write failures.
  }
}

export function readActionLogs() {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawLogs = window.localStorage.getItem(STORAGE_KEYS.actionLogs);
    return rawLogs ? safeParseJson(rawLogs, []) : [];
  } catch (error) {
    return [];
  }
}

export function writeActionLogs(logs) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEYS.actionLogs, JSON.stringify(logs));
  } catch (error) {
    // Ignore local storage write failures.
  }
}

export function readSessionId() {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    return window.localStorage.getItem(STORAGE_KEYS.sessionId) || '';
  } catch (error) {
    return '';
  }
}

export function writeSessionId(sessionId) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEYS.sessionId, sessionId);
  } catch (error) {
    // Ignore local storage write failures.
  }
}
