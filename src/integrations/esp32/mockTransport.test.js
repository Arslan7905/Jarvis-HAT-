import { createMockEsp32Transport } from './mockTransport';

test('mock esp32 transport reports health and simulated updates', async () => {
  const healthChanges = [];
  const transport = createMockEsp32Transport({
    latencyMs: 10,
    onHealthChange: (health) => healthChanges.push(health),
  });

  expect(transport.getHealth()).toBe('connected');

  const testResult = await transport.testConnection();
  const executionResult = await transport.execute({
    device: 'fan',
    location: 'living_room',
    action: 'on',
  });

  expect(testResult).toEqual({
    ok: true,
    status: 'mocked',
    message: 'Mock devices are enabled and responding.',
  });
  expect(executionResult.status).toBe('mocked');
  expect(executionResult.message).toBe('[MOCK ESP32] Living Room Fan -> ON');
  expect(executionResult.updates).toEqual([
    {
      device: 'fan',
      location: 'living_room',
      state: 'ON',
    },
  ]);
  expect(healthChanges).toEqual(
    expect.arrayContaining(['connected', 'testing', 'sending'])
  );
});
