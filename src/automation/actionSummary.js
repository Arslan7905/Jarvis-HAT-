import { ACTION_TYPES } from './actionSchema';
import { getDeviceLabel } from './deviceRegistry';

function joinLabels(labels) {
  if (!labels.length) {
    return '';
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

export function summarizeAction(action) {
  if (action.type === ACTION_TYPES.DEVICE) {
    const deviceLabel = getDeviceLabel(action.target.device, action.target.location);
    const verb = action.payload.state === 'ON' ? 'turn on' : 'turn off';
    return `${verb} ${deviceLabel}`;
  }

  if (action.type === ACTION_TYPES.AI_QUERY) {
    return `answer "${action.payload.prompt}"`;
  }

  if (action.type === ACTION_TYPES.LAPTOP) {
    const operation = action.target.operation;

    switch (operation) {
      case 'shutdown':
        return 'shut down the laptop';
      case 'restart':
        return 'restart the laptop';
      case 'sleep':
        return 'put the laptop to sleep';
      case 'lock':
        return 'lock the laptop';
      case 'open_app':
        return `open ${action.payload.appLabel || action.payload.app}`;
      case 'close_app':
        return `close ${action.payload.appLabel || action.payload.app}`;
      case 'open_url':
        return `open ${action.payload.urlLabel || action.payload.url}`;
      case 'volume_up':
        return 'raise the volume';
      case 'volume_down':
        return 'lower the volume';
      case 'mute':
        return 'mute the volume';
      case 'unmute':
        return 'unmute the volume';
      default:
        return operation;
    }
  }

  return action.summary;
}

export function summarizeActionPlan(actions) {
  return joinLabels(actions.map((action) => action.summary || summarizeAction(action)));
}

export function summarizeActionResults(results) {
  const successfulResults = results.filter((result) => result.ok);
  const failedResults = results.filter((result) => !result.ok);

  if (!results.length) {
    return 'No actions were executed.';
  }

  if (!failedResults.length) {
    return `Completed ${joinLabels(
      successfulResults.map((result) => result.summary)
    )}.`;
  }

  if (!successfulResults.length) {
    return failedResults[0].message || 'The requested actions could not be completed.';
  }

  return `Completed ${joinLabels(
    successfulResults.map((result) => result.summary)
  )}, but ${failedResults[0].message || 'one action failed'}.`;
}

