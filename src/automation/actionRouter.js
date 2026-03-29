import {
  ACTION_RESULT_STATUS,
  ACTION_TYPES,
  createActionResult,
} from './actionSchema';

export async function routeAction(action, executors) {
  switch (action.type) {
    case ACTION_TYPES.DEVICE:
      return executors.device.execute(action);
    case ACTION_TYPES.AI_QUERY:
      return executors.ai.execute(action);
    case ACTION_TYPES.LAPTOP:
      return executors.laptop.execute(action);
    default:
      return createActionResult(action, {
        ok: false,
        status: ACTION_RESULT_STATUS.ERROR,
        message: 'Unsupported action type.',
        haltQueue: true,
      });
  }
}

