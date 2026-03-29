import {
  ACTION_RESULT_STATUS,
  ACTION_TYPES,
  createAction,
  createActionResult,
} from './actionSchema';
import { createActionQueue } from './actionQueue';

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

test('runs actions sequentially and can be cancelled before the next action', async () => {
  const queue = createActionQueue();
  const firstActionBarrier = createDeferred();
  const actions = [
    createAction({
      type: ACTION_TYPES.AI_QUERY,
      summary: 'Answer the first question',
      target: { service: 'ai' },
      payload: { prompt: 'first' },
    }),
    createAction({
      type: ACTION_TYPES.AI_QUERY,
      summary: 'Answer the second question',
      target: { service: 'ai' },
      payload: { prompt: 'second' },
    }),
  ];

  const executeAction = jest.fn(async (action) => {
    if (action === actions[0]) {
      await firstActionBarrier.promise;
    }

    return createActionResult(action, {
      ok: true,
      status: ACTION_RESULT_STATUS.SUCCESS,
      message: `${action.summary} complete`,
    });
  });

  const runPromise = queue.run({
    actions,
    executeAction,
  });

  expect(queue.isBusy()).toBe(true);
  queue.cancel('Cancelled by test.');
  firstActionBarrier.resolve();

  const runResult = await runPromise;

  expect(executeAction).toHaveBeenCalledTimes(1);
  expect(runResult.status).toBe(ACTION_RESULT_STATUS.CANCELLED);
  expect(runResult.results[1].status).toBe(ACTION_RESULT_STATUS.CANCELLED);
});

test('can interrupt an in-flight action queue', async () => {
  const queue = createActionQueue();
  const firstActionBarrier = createDeferred();
  const actions = [
    createAction({
      type: ACTION_TYPES.AI_QUERY,
      summary: 'Handle the first request',
      target: { service: 'ai' },
      payload: { prompt: 'first' },
    }),
    createAction({
      type: ACTION_TYPES.AI_QUERY,
      summary: 'Handle the second request',
      target: { service: 'ai' },
      payload: { prompt: 'second' },
    }),
  ];

  const runPromise = queue.run({
    actions,
    executeAction: async (action) => {
      if (action === actions[0]) {
        await firstActionBarrier.promise;
      }

      return createActionResult(action, {
        ok: true,
        status: ACTION_RESULT_STATUS.SUCCESS,
        message: `${action.summary} complete`,
      });
    },
  });

  queue.interrupt('Interrupted by test.');
  firstActionBarrier.resolve();

  const runResult = await runPromise;

  expect(runResult.status).toBe(ACTION_RESULT_STATUS.INTERRUPTED);
  expect(runResult.results[1].status).toBe(ACTION_RESULT_STATUS.INTERRUPTED);
});
