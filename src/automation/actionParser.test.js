import { ACTION_CONTROL_TYPES, ACTION_TYPES } from './actionSchema';
import { parsePromptToActions } from './actionParser';

test('parses a mixed device and laptop command into structured actions', () => {
  const result = parsePromptToActions('Turn on the fan and open chrome', 'voice');

  expect(result.kind).toBe('actions');
  expect(result.actions).toHaveLength(2);
  expect(result.actions.map((action) => action.type)).toEqual([
    ACTION_TYPES.DEVICE,
    ACTION_TYPES.LAPTOP,
  ]);
  expect(result.actions[0].target).toEqual({
    device: 'fan',
    location: 'living_room',
  });
  expect(result.actions[0].payload.state).toBe('ON');
  expect(result.actions[1].target.operation).toBe('open_app');
  expect(result.actions[1].payload.app).toBe('chrome');
});

test('parses confirm commands into a control action', () => {
  const result = parsePromptToActions('confirm', 'voice');

  expect(result.kind).toBe('control');
  expect(result.actions).toHaveLength(1);
  expect(result.actions[0].type).toBe(ACTION_TYPES.CONTROL);
  expect(result.actions[0].target.control).toBe(ACTION_CONTROL_TYPES.CONFIRM);
});

test('parses cancel commands into a control action', () => {
  const result = parsePromptToActions('cancel', 'voice');

  expect(result.kind).toBe('control');
  expect(result.actions[0].target.control).toBe(ACTION_CONTROL_TYPES.CANCEL);
});

test('falls back general questions into an ai action', () => {
  const result = parsePromptToActions('What is artificial intelligence?', 'voice');

  expect(result.kind).toBe('actions');
  expect(result.actions).toHaveLength(1);
  expect(result.actions[0].type).toBe(ACTION_TYPES.AI_QUERY);
  expect(result.actions[0].payload.prompt).toBe('What is artificial intelligence');
});

test('parses shut down my laptop as a dangerous laptop action', () => {
  const result = parsePromptToActions('shut down my laptop', 'voice');

  expect(result.kind).toBe('actions');
  expect(result.actions).toHaveLength(1);
  expect(result.actions[0].type).toBe(ACTION_TYPES.LAPTOP);
  expect(result.actions[0].target.operation).toBe('shutdown');
  expect(result.actions[0].requiresConfirmation).toBe(true);
});

test('parses turn off my laptop as a shutdown laptop action', () => {
  const result = parsePromptToActions('turn off my laptop', 'voice');

  expect(result.kind).toBe('actions');
  expect(result.actions[0].type).toBe(ACTION_TYPES.LAPTOP);
  expect(result.actions[0].target.operation).toBe('shutdown');
});

test('parses open file explorer as a supported laptop app action', () => {
  const result = parsePromptToActions('open file explorer', 'voice');

  expect(result.kind).toBe('actions');
  expect(result.actions[0].type).toBe(ACTION_TYPES.LAPTOP);
  expect(result.actions[0].target.operation).toBe('open_app');
  expect(result.actions[0].payload.app).toBe('explorer');
});

test('parses open chrome with punctuation as a supported laptop app action', () => {
  const result = parsePromptToActions('open chrome.', 'voice');

  expect(result.kind).toBe('actions');
  expect(result.actions[0].type).toBe(ACTION_TYPES.LAPTOP);
  expect(result.actions[0].target.operation).toBe('open_app');
  expect(result.actions[0].payload.app).toBe('chrome');
});

test('parses cancel with punctuation as a local control command', () => {
  const result = parsePromptToActions('cancel.', 'voice');

  expect(result.kind).toBe('control');
  expect(result.actions[0].target.control).toBe('cancel');
});
