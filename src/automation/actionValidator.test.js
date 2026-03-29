import { ACTION_TYPES, createAction } from './actionSchema';
import { validateAction, validateActionBatch } from './actionValidator';

test('accepts a valid structured device action', () => {
  const action = createAction({
    type: ACTION_TYPES.DEVICE,
    summary: 'Turn on Living Room Fan',
    target: {
      device: 'fan',
      location: 'living_room',
    },
    payload: {
      state: 'ON',
    },
  });

  expect(validateAction(action)).toEqual({
    ok: true,
    errors: [],
  });
});

test('rejects an unknown device target', () => {
  const action = createAction({
    type: ACTION_TYPES.DEVICE,
    summary: 'Turn on Garage Fan',
    target: {
      device: 'fan',
      location: 'garage',
    },
    payload: {
      state: 'ON',
    },
  });

  expect(validateAction(action)).toEqual({
    ok: false,
    errors: ['Device action references an unknown device target.'],
  });
});

test('rejects incomplete laptop url actions in batch validation', () => {
  const action = createAction({
    type: ACTION_TYPES.LAPTOP,
    summary: 'Open a URL',
    target: {
      operation: 'open_url',
    },
    payload: {},
  });

  const batchValidation = validateActionBatch([action]);

  expect(batchValidation.ok).toBe(false);
  expect(batchValidation.failures).toHaveLength(1);
  expect(batchValidation.failures[0].validation.errors).toContain(
    'Open URL actions require a URL target.'
  );
});
