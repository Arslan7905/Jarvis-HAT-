import {
  mergeAutomationSettings,
  readSessionId,
  writeSessionId,
} from '../automation/settings';
import { DEFAULT_AI_ENDPOINT } from '../utils/jarvis';

export const DEFAULT_SETTINGS_API_URL =
  process.env.REACT_APP_SETTINGS_API_URL || 'http://localhost:3001/api/settings';

function buildRandomId() {
  return `sess_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

export function getOrCreateSessionId() {
  const existingSessionId = readSessionId();

  if (existingSessionId) {
    return existingSessionId;
  }

  const nextSessionId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `sess_${crypto.randomUUID()}`
      : buildRandomId();

  writeSessionId(nextSessionId);
  return nextSessionId;
}

function detectBrowser(userAgent) {
  if (/Edg\//i.test(userAgent)) {
    return 'Microsoft Edge';
  }

  if (/Chrome\//i.test(userAgent) && !/Edg\//i.test(userAgent)) {
    return 'Google Chrome';
  }

  if (/Firefox\//i.test(userAgent)) {
    return 'Firefox';
  }

  if (/Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)) {
    return 'Safari';
  }

  return 'Unknown Browser';
}

function detectPlatform(userAgent, navigatorPlatform = '') {
  const combined = `${userAgent} ${navigatorPlatform}`.toLowerCase();

  if (combined.includes('windows')) {
    return 'Windows';
  }

  if (combined.includes('mac')) {
    return 'macOS';
  }

  if (combined.includes('android')) {
    return 'Android';
  }

  if (combined.includes('iphone') || combined.includes('ipad') || combined.includes('ios')) {
    return 'iOS';
  }

  if (combined.includes('linux')) {
    return 'Linux';
  }

  return 'Unknown Platform';
}

function detectDeviceType(userAgent) {
  if (/ipad|tablet/i.test(userAgent)) {
    return 'tablet';
  }

  if (/mobi|android|iphone/i.test(userAgent)) {
    return 'mobile';
  }

  return 'desktop';
}

export function buildClientSessionMetadata() {
  if (typeof window === 'undefined') {
    return {
      label: 'Unknown Device',
      browser: 'Unknown Browser',
      platform: 'Unknown Platform',
      deviceType: 'desktop',
      appName: 'JarvisAI Web',
      appVersion: 'dev',
    };
  }

  const userAgent = window.navigator?.userAgent || '';
  const platform = detectPlatform(userAgent, window.navigator?.platform || '');
  const browser = detectBrowser(userAgent);
  const deviceType = detectDeviceType(userAgent);
  const label = `${platform} ${deviceType === 'desktop' ? 'Device' : deviceType}`;

  return {
    label,
    browser,
    platform,
    deviceType,
    appName: 'JarvisAI Web',
    appVersion: process.env.REACT_APP_VERSION || 'dev',
  };
}

export function resolveSettingsApiUrl(aiEndpoint = '') {
  const trimmedEndpoint = String(aiEndpoint || '').trim();

  if (process.env.REACT_APP_SETTINGS_API_URL) {
    return process.env.REACT_APP_SETTINGS_API_URL;
  }

  if (!trimmedEndpoint) {
    return DEFAULT_SETTINGS_API_URL;
  }

  return trimmedEndpoint.replace(/\/api\/ai\/chat\/?$/i, '/api/settings');
}

function createApiUrl(pathname) {
  const baseOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  return new URL(pathname, baseOrigin);
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error('Settings backend returned invalid JSON.');
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      payload?.error || `Settings backend returned HTTP ${response.status}.`
    );
  }

  return payload;
}

export async function loadSettingsSnapshot(aiEndpoint = DEFAULT_AI_ENDPOINT) {
  const payload = await requestJson(resolveSettingsApiUrl(aiEndpoint));

  return {
    version: payload?.version || 1,
    settings: mergeAutomationSettings(payload?.settings || {}),
  };
}

export async function patchSettingsSnapshot(aiEndpoint, patch) {
  const payload = await requestJson(resolveSettingsApiUrl(aiEndpoint), {
    method: 'PATCH',
    body: JSON.stringify({ patch }),
  });

  return {
    version: payload?.version || 1,
    settings: mergeAutomationSettings(payload?.settings || {}),
  };
}

export async function registerClientSession(aiEndpoint, sessionId, metadata) {
  return requestJson(`${resolveSettingsApiUrl(aiEndpoint)}/sessions/register`, {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      metadata,
    }),
  });
}

export async function loadSessionInventory(aiEndpoint, currentSessionId) {
  const sessionsUrl = createApiUrl(`${resolveSettingsApiUrl(aiEndpoint)}/sessions`);

  if (currentSessionId) {
    sessionsUrl.searchParams.set('currentSessionId', currentSessionId);
  }

  return requestJson(sessionsUrl.toString());
}

export async function revokeSession(aiEndpoint, currentSessionId, sessionId) {
  const revokeUrl = createApiUrl(
    `${resolveSettingsApiUrl(aiEndpoint)}/sessions/${encodeURIComponent(sessionId)}`
  );

  if (currentSessionId) {
    revokeUrl.searchParams.set('currentSessionId', currentSessionId);
  }

  return requestJson(revokeUrl.toString(), {
    method: 'DELETE',
  });
}

export async function revokeOtherSessions(aiEndpoint, currentSessionId) {
  return requestJson(`${resolveSettingsApiUrl(aiEndpoint)}/sessions/revoke-others`, {
    method: 'POST',
    body: JSON.stringify({
      currentSessionId,
    }),
  });
}
