import {
  applyFeedbackUpdates,
  buildDeviceStateKey,
  createInitialDeviceStates,
  extractEsp32Feedback,
  parseVoiceCommand,
} from './jarvis';

test('parses a living room fan command into structured JSON', () => {
  expect(parseVoiceCommand('Turn on the living room fan')).toEqual({
    kind: 'device',
    command: {
      device: 'fan',
      action: 'on',
      location: 'living_room',
    },
  });
});

test('parses a bedroom light command into structured JSON', () => {
  expect(parseVoiceCommand('Turn off bedroom light')).toEqual({
    kind: 'device',
    command: {
      device: 'lights',
      action: 'off',
      location: 'bedroom',
    },
  });
});

test('parses a multi-device command into sequential device payloads', () => {
  expect(parseVoiceCommand('Turn on fan and bedroom light')).toEqual({
    kind: 'device_batch',
    commands: [
      {
        device: 'fan',
        action: 'on',
        location: 'living_room',
      },
      {
        device: 'lights',
        action: 'on',
        location: 'bedroom',
      },
    ],
  });
});

test('parses all-lights commands across locations', () => {
  expect(parseVoiceCommand('Switch off all lights')).toEqual({
    kind: 'device_batch',
    commands: [
      {
        device: 'lights',
        action: 'off',
        location: 'living_room',
      },
      {
        device: 'lights',
        action: 'off',
        location: 'bedroom',
      },
    ],
  });
});

test('treats general questions separately from device commands', () => {
  expect(parseVoiceCommand('What is AI?')).toEqual({
    kind: 'general',
    prompt: 'What is AI?',
  });
});

test('returns device not found when the command names an unknown device', () => {
  expect(parseVoiceCommand('Turn on XYZ')).toEqual({
    kind: 'device_not_found',
    message: 'Device not found. Try fan, lights, or AC.',
  });
});

test('extracts ESP32 feedback and applies device state updates', () => {
  const currentStates = createInitialDeviceStates();
  const feedback = extractEsp32Feedback({
    device: 'fan',
    location: 'living room',
    state: 'on',
  });

  const nextStates = applyFeedbackUpdates(currentStates, feedback.updates);

  expect(nextStates[buildDeviceStateKey('fan', 'living_room')]).toBe('ON');
});
