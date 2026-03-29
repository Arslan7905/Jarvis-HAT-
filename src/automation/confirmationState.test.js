import { createConfirmationStateMachine } from './confirmationState';

test('stores and clears a pending confirmation request', () => {
  const machine = createConfirmationStateMachine();
  const request = machine.set({
    summary: 'shut down the laptop',
    prompt: 'shutdown the laptop',
    source: 'voice',
    actions: [{ id: 'laptop-1' }],
  });

  expect(machine.hasPending()).toBe(true);
  expect(machine.get()).toEqual(request);
  expect(typeof request.requestedAt).toBe('number');

  const clearedRequest = machine.clear();

  expect(clearedRequest).toEqual(request);
  expect(machine.hasPending()).toBe(false);
  expect(machine.get()).toBeNull();
});
