import {
  ACTION_CONTROL_TYPES,
  ACTION_RESULT_STATUS,
  ACTION_TYPES,
} from './actionSchema';
import { getDeviceEntry } from './deviceRegistry';

function validateDeviceAction(action) {
  const { device, location } = action.target;
  const { state } = action.payload;

  if (!device || !location || !state) {
    return ['Device actions require device, location, and state.'];
  }

  if (!getDeviceEntry(device, location)) {
    return ['Device action references an unknown device target.'];
  }

  if (!['ON', 'OFF'].includes(state)) {
    return ['Device state must be ON or OFF.'];
  }

  return [];
}

function validateAiAction(action) {
  if (!action.payload?.prompt || typeof action.payload.prompt !== 'string') {
    return ['AI actions require a prompt string.'];
  }

  return [];
}

function validateLaptopAction(action) {
  const operation = action.target?.operation;

  if (!operation) {
    return ['Laptop actions require an operation.'];
  }

  if (operation === 'open_app' || operation === 'close_app') {
    if (!action.payload?.app) {
      return ['App actions require an app target.'];
    }
  }

  if (operation === 'open_url' && !action.payload?.url) {
    return ['Open URL actions require a URL target.'];
  }

  return [];
}

function validateControlAction(action) {
  if (!Object.values(ACTION_CONTROL_TYPES).includes(action.target?.control)) {
    return ['Control actions require a supported control type.'];
  }

  return [];
}

export function validateAction(action) {
  const errors = [];

  if (!action || typeof action !== 'object') {
    return { ok: false, errors: ['Action must be an object.'] };
  }

  if (!Object.values(ACTION_TYPES).includes(action.type)) {
    errors.push('Action type is unsupported.');
  }

  if (!action.id) {
    errors.push('Action id is required.');
  }

  if (!action.summary) {
    errors.push('Action summary is required.');
  }

  if (!errors.length) {
    switch (action.type) {
      case ACTION_TYPES.DEVICE:
        errors.push(...validateDeviceAction(action));
        break;
      case ACTION_TYPES.AI_QUERY:
        errors.push(...validateAiAction(action));
        break;
      case ACTION_TYPES.LAPTOP:
        errors.push(...validateLaptopAction(action));
        break;
      case ACTION_TYPES.CONTROL:
        errors.push(...validateControlAction(action));
        break;
      default:
        break;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function validateActionBatch(actions) {
  const results = actions.map((action) => ({
    action,
    validation: validateAction(action),
  }));
  const failures = results.filter((entry) => !entry.validation.ok);

  return {
    ok: failures.length === 0,
    results,
    failures,
    status: failures.length ? ACTION_RESULT_STATUS.ERROR : ACTION_RESULT_STATUS.SUCCESS,
  };
}

