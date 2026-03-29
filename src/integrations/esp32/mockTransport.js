import { DEVICE_TRANSPORT_NAMES, getDeviceLabel } from '../../automation/deviceRegistry';

function wait(delay) {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

export function createMockEsp32Transport({
  latencyMs = 450,
  onHealthChange,
} = {}) {
  let health = 'connected';

  const updateHealth = (nextHealth) => {
    health = nextHealth;
    onHealthChange?.(nextHealth);
  };

  updateHealth('connected');

  return {
    mode: 'mock',
    name: DEVICE_TRANSPORT_NAMES.mock,
    getHealth() {
      return health;
    },
    async testConnection() {
      updateHealth('testing');
      await wait(Math.max(180, latencyMs / 2));
      updateHealth('connected');
      return {
        ok: true,
        status: 'mocked',
        message: 'Mock devices are enabled and responding.',
      };
    },
    async execute(command) {
      updateHealth('sending');
      await wait(latencyMs);
      updateHealth('connected');
      return {
        ok: true,
        status: 'mocked',
        message: `[MOCK ESP32] ${getDeviceLabel(
          command.device,
          command.location
        )} -> ${command.action.toUpperCase()}`,
        updates: [
          {
            device: command.device,
            location: command.location,
            state: command.action.toUpperCase(),
          },
        ],
        transport: 'mock',
      };
    },
    disconnect() {
      updateHealth('connected');
    },
  };
}

