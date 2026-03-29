import { ACTION_RESULT_STATUS, ACTION_TYPES, createAction } from './actionSchema';
import { routeAction } from './actionRouter';

test('routes actions to the matching executor', async () => {
  const deviceAction = createAction({
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

  const deviceExecutor = jest.fn().mockResolvedValue({
    ok: true,
    status: ACTION_RESULT_STATUS.SUCCESS,
    message: 'done',
  });

  const result = await routeAction(deviceAction, {
    device: { execute: deviceExecutor },
    ai: { execute: jest.fn() },
    laptop: { execute: jest.fn() },
  });

  expect(deviceExecutor).toHaveBeenCalledWith(deviceAction);
  expect(result).toEqual({
    ok: true,
    status: ACTION_RESULT_STATUS.SUCCESS,
    message: 'done',
  });
});
