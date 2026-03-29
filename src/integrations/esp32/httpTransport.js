import { DEVICE_TRANSPORT_NAMES } from '../../automation/deviceRegistry';
import { extractEsp32Feedback } from '../../utils/jarvis';

function wait(delay) {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function createHttpEsp32Transport({
  endpoint,
  timeoutMs = 4500,
  retryCount = 1,
  onHealthChange,
} = {}) {
  let health = endpoint ? 'configured' : 'not_configured';

  const updateHealth = (nextHealth) => {
    health = nextHealth;
    onHealthChange?.(nextHealth);
  };

  return {
    mode: 'http',
    name: DEVICE_TRANSPORT_NAMES.http,
    getHealth() {
      return health;
    },
    async testConnection() {
      if (!endpoint?.trim()) {
        updateHealth('not_configured');
        throw new Error('ESP32 HTTP endpoint is not configured.');
      }

      updateHealth('testing');

      try {
        const response = await fetchWithTimeout(
          endpoint.trim(),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ping: true }),
          },
          timeoutMs
        );

        if (!response.ok) {
          throw new Error(`ESP32 returned HTTP ${response.status}.`);
        }

        updateHealth('connected');
        return {
          ok: true,
          status: 'success',
          message: 'ESP32 HTTP endpoint responded successfully.',
        };
      } catch (error) {
        updateHealth('error');
        throw error;
      }
    },
    async execute(command) {
      if (!endpoint?.trim()) {
        updateHealth('not_configured');
        throw new Error('ESP32 HTTP endpoint is not configured.');
      }

      let lastError = null;

      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
          updateHealth('sending');

          const response = await fetchWithTimeout(
            endpoint.trim(),
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(command),
            },
            timeoutMs
          );

          if (!response.ok) {
            throw new Error(`ESP32 returned HTTP ${response.status}.`);
          }

          const responseText = await response.text();
          const feedback = extractEsp32Feedback(
            responseText ? responseText : { message: '' }
          );
          updateHealth('connected');

          return {
            ok: true,
            status: 'success',
            message: feedback.message || 'ESP32 acknowledged the request.',
            updates: feedback.updates,
            transport: 'http',
          };
        } catch (error) {
          lastError = error;

          if (attempt < retryCount) {
            await wait(900);
            continue;
          }
        }
      }

      updateHealth('error');
      throw lastError || new Error('ESP32 HTTP execution failed.');
    },
    disconnect() {
      updateHealth(endpoint ? 'configured' : 'not_configured');
    },
  };
}

