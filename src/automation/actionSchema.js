let actionCounter = 0;

export const ACTION_TYPES = {
  DEVICE: 'device',
  AI_QUERY: 'ai_query',
  LAPTOP: 'laptop',
  CONTROL: 'control',
};

export const ACTION_CONTROL_TYPES = {
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
  INTERRUPT: 'interrupt',
};

export const ACTION_RISK_LEVELS = {
  SAFE: 'safe',
  CAUTION: 'caution',
  DANGEROUS: 'dangerous',
};

export const ACTION_RESULT_STATUS = {
  SUCCESS: 'success',
  ERROR: 'error',
  MOCKED: 'mocked',
  CANCELLED: 'cancelled',
  INTERRUPTED: 'interrupted',
  CONFIRMATION_REQUIRED: 'confirmation_required',
  DENIED: 'denied',
};

function nextActionId(type) {
  actionCounter += 1;
  return `${type}-${actionCounter}`;
}

export function createAction({
  type,
  source = 'voice',
  summary = '',
  riskLevel = ACTION_RISK_LEVELS.SAFE,
  requiresConfirmation = false,
  target = {},
  payload = {},
  metadata = {},
}) {
  return {
    id: nextActionId(type),
    type,
    source,
    summary,
    riskLevel,
    requiresConfirmation,
    target,
    payload,
    metadata,
  };
}

export function createActionResult(action, {
  ok,
  status,
  message,
  data = {},
  haltQueue = false,
}) {
  return {
    actionId: action.id,
    type: action.type,
    ok,
    status,
    message,
    summary: action.summary,
    data,
    haltQueue,
  };
}

