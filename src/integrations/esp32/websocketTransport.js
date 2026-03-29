import { DEVICE_TRANSPORT_NAMES } from '../../automation/deviceRegistry';
import { extractEsp32Feedback } from '../../utils/jarvis';

function wait(delay) {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

export function createWebSocketEsp32Transport({
  endpoint,
  timeoutMs = 4500,
  retryCount = 1,
  onHealthChange,
  onFeedback,
} = {}) {
  let socket = null;
  let health = endpoint ? 'disconnected' : 'not_configured';

  const updateHealth = (nextHealth) => {
    health = nextHealth;
    onHealthChange?.(nextHealth);
  };

  const closeSocket = () => {
    if (socket) {
      socket.close();
      socket = null;
    }
  };

  const waitForReady = () =>
    new Promise((resolve, reject) => {
      if (socket && socket.readyState === window.WebSocket.OPEN) {
        resolve(socket);
        return;
      }

      const startedAt = Date.now();
      const intervalId = window.setInterval(() => {
        if (socket && socket.readyState === window.WebSocket.OPEN) {
          window.clearInterval(intervalId);
          resolve(socket);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(intervalId);
          reject(new Error('WebSocket connection timed out.'));
        }
      }, 120);
    });

  const connect = () => {
    if (!endpoint?.trim()) {
      updateHealth('not_configured');
      throw new Error('ESP32 WebSocket endpoint is not configured.');
    }

    if (socket && socket.readyState <= window.WebSocket.OPEN) {
      return;
    }

    updateHealth('connecting');
    socket = new window.WebSocket(endpoint.trim());

    socket.onopen = () => {
      updateHealth('connected');
    };

    socket.onmessage = (event) => {
      const feedback = extractEsp32Feedback(event.data);

      if (!feedback.updates.length && !feedback.message) {
        return;
      }

      onFeedback?.(feedback);
    };

    socket.onerror = () => {
      updateHealth('error');
    };

    socket.onclose = () => {
      socket = null;
      updateHealth(endpoint ? 'disconnected' : 'not_configured');
    };
  };

  return {
    mode: 'websocket',
    name: DEVICE_TRANSPORT_NAMES.websocket,
    getHealth() {
      return health;
    },
    async testConnection() {
      connect();
      await waitForReady();
      return {
        ok: true,
        status: 'success',
        message: 'ESP32 WebSocket connected successfully.',
      };
    },
    async execute(command) {
      let lastError = null;

      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
          connect();
          const readySocket = await waitForReady();
          updateHealth('sending');
          readySocket.send(JSON.stringify(command));
          await wait(160);
          updateHealth('connected');

          return {
            ok: true,
            status: 'success',
            message: 'Command queued over WebSocket. Waiting for ESP32 feedback.',
            updates: [],
            transport: 'websocket',
          };
        } catch (error) {
          lastError = error;
          closeSocket();

          if (attempt < retryCount) {
            await wait(700);
            continue;
          }
        }
      }

      updateHealth('error');
      throw lastError || new Error('ESP32 WebSocket execution failed.');
    },
    disconnect() {
      closeSocket();
      updateHealth(endpoint ? 'disconnected' : 'not_configured');
    },
  };
}

