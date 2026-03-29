import { ACTION_RESULT_STATUS } from './actionSchema';

let queueRunCounter = 0;

export function createActionQueue() {
  let currentRun = null;

  return {
    getState() {
      return currentRun;
    },
    isBusy() {
      return Boolean(currentRun);
    },
    cancel(reason = 'Action queue cancelled.') {
      if (!currentRun) {
        return false;
      }

      currentRun.cancelled = true;
      currentRun.reason = reason;
      return true;
    },
    interrupt(reason = 'Action queue interrupted.') {
      if (!currentRun) {
        return false;
      }

      currentRun.interrupted = true;
      currentRun.reason = reason;
      return true;
    },
    async run({ actions, executeAction, onActionStart, onActionResult }) {
      queueRunCounter += 1;
      const runId = `run-${queueRunCounter}`;
      currentRun = {
        runId,
        cancelled: false,
        interrupted: false,
        reason: '',
      };

      const results = [];

      try {
        for (const action of actions) {
          if (currentRun.cancelled || currentRun.interrupted) {
            results.push({
              actionId: action.id,
              type: action.type,
              ok: false,
              status: currentRun.interrupted
                ? ACTION_RESULT_STATUS.INTERRUPTED
                : ACTION_RESULT_STATUS.CANCELLED,
              summary: action.summary,
              message: currentRun.reason,
              haltQueue: true,
            });
            break;
          }

          onActionStart?.({ runId, action });

          let result;

          try {
            result = await executeAction(action, { runId });
          } catch (error) {
            result = {
              actionId: action.id,
              type: action.type,
              ok: false,
              status: ACTION_RESULT_STATUS.ERROR,
              summary: action.summary,
              message: error.message || 'Action execution failed.',
              haltQueue: true,
            };
          }

          results.push(result);
          onActionResult?.({ runId, action, result });

          if (result.haltQueue) {
            break;
          }
        }

        return {
          runId,
          results,
          status: currentRun?.interrupted
            ? ACTION_RESULT_STATUS.INTERRUPTED
            : currentRun?.cancelled
              ? ACTION_RESULT_STATUS.CANCELLED
              : results.some((result) => !result.ok)
                ? ACTION_RESULT_STATUS.ERROR
                : ACTION_RESULT_STATUS.SUCCESS,
        };
      } finally {
        currentRun = null;
      }
    },
  };
}
