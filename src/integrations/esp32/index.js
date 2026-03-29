import { createMockEsp32Transport } from './mockTransport';
import { createHttpEsp32Transport } from './httpTransport';
import { createWebSocketEsp32Transport } from './websocketTransport';

export function createEsp32Transport({
  useMockDevices,
  transport,
  httpEndpoint,
  websocketEndpoint,
  timeoutMs,
  retryCount,
  mockDeviceLatencyMs,
  onHealthChange,
  onFeedback,
}) {
  if (useMockDevices) {
    return createMockEsp32Transport({
      latencyMs: mockDeviceLatencyMs,
      onHealthChange,
    });
  }

  if (transport === 'http') {
    return createHttpEsp32Transport({
      endpoint: httpEndpoint,
      timeoutMs,
      retryCount,
      onHealthChange,
    });
  }

  return createWebSocketEsp32Transport({
    endpoint: websocketEndpoint,
    timeoutMs,
    retryCount,
    onHealthChange,
    onFeedback,
  });
}

