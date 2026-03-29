import {
  ACTION_CONTROL_TYPES,
  ACTION_RISK_LEVELS,
  ACTION_TYPES,
  createAction,
} from './actionSchema';
import { getDeviceLabel } from './deviceRegistry';
import { findSupportedApp, resolveUrlTarget } from './laptopCatalog';
import { parseVoiceCommand } from '../utils/jarvis';

const CANCEL_PATTERN =
  /^(?:cancel(?: it| that| pending action)?|abort|never ?mind|stop(?: that)?|forget it)$/i;
const CONFIRM_PATTERN =
  /^(?:yes|confirm|go ahead|do it|proceed|yes please|confirm it|okay do it|okay proceed)$/i;
const INTERRUPT_PATTERN = /^(?:interrupt|pause the queue|stop the queue)$/i;
const CLAUSE_SPLIT_PATTERN = /\s*(?:,|\band then\b|\bthen\b|\balso\b|\bplus\b|\band\b)\s*/i;
const DEVICE_HINT_PATTERN =
  /\bfan\b|\blight\b|\blights\b|\blamp\b|\bac\b|\bair\s*conditioner\b|\baircon\b|\bliving\s*room\b|\bbedroom\b|\ball\b|\beverything\b/i;
const DEVICE_ON_PATTERN = /\b(turn|switch)\s+on\b|\bstart\b|\benable\b|\bactivate\b/i;
const DEVICE_OFF_PATTERN =
  /\b(turn|switch)\s+off\b|\bstop\b|\bdisable\b|\bdeactivate\b|\bstandby\b|\bsleep\b/i;
const EDGE_PUNCTUATION_PATTERN = /^[`"'.,!?;:()-]+|[`"'.,!?;:()-]+$/g;

export function normalizeAutomationText(prompt) {
  return String(prompt || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(EDGE_PUNCTUATION_PATTERN, '')
    .trim();
}

export function detectControlCommand(prompt) {
  const normalizedPrompt = normalizeAutomationText(prompt);

  if (!normalizedPrompt) {
    return null;
  }

  if (CONFIRM_PATTERN.test(normalizedPrompt)) {
    return ACTION_CONTROL_TYPES.CONFIRM;
  }

  if (CANCEL_PATTERN.test(normalizedPrompt)) {
    return ACTION_CONTROL_TYPES.CANCEL;
  }

  if (INTERRUPT_PATTERN.test(normalizedPrompt)) {
    return ACTION_CONTROL_TYPES.INTERRUPT;
  }

  return null;
}

function splitIntoClauses(prompt) {
  const clauses = prompt
    .split(CLAUSE_SPLIT_PATTERN)
    .map((clause) => normalizeAutomationText(clause))
    .filter(Boolean);

  return clauses.length ? clauses : [normalizeAutomationText(prompt)];
}

function findInheritedDeviceAction(clause) {
  if (DEVICE_ON_PATTERN.test(clause)) {
    return 'on';
  }

  if (DEVICE_OFF_PATTERN.test(clause)) {
    return 'off';
  }

  return null;
}

function createDeviceAction(command, source) {
  return createAction({
    type: ACTION_TYPES.DEVICE,
    source,
    summary: `${command.action === 'on' ? 'Turn on' : 'Turn off'} ${getDeviceLabel(
      command.device,
      command.location
    )}`,
    target: {
      device: command.device,
      location: command.location,
    },
    payload: {
      state: command.action.toUpperCase(),
    },
    metadata: {
      transportGroup: 'esp32',
    },
  });
}

function createAiAction(prompt, source) {
  return createAction({
    type: ACTION_TYPES.AI_QUERY,
    source,
    summary: `Answer: ${prompt}`,
    target: {
      service: 'ai',
    },
    payload: {
      prompt,
    },
  });
}

function createLaptopAction(operation, source, payload, riskLevel, requiresConfirmation, summary) {
  return createAction({
    type: ACTION_TYPES.LAPTOP,
    source,
    summary,
    riskLevel,
    requiresConfirmation,
    target: {
      operation,
    },
    payload,
  });
}

function parseLaptopClause(clause, source) {
  const normalizedClause = normalizeAutomationText(clause).toLowerCase();

  if (
    /^(?:shut\s*down|shutdown|power\s*off|turn\s*off)(?:\s+(?:(?:the|my)\s+)?)?(?:laptop|computer|pc|system)?$/i.test(
      normalizedClause
    )
  ) {
    return createLaptopAction(
      'shutdown',
      source,
      {},
      ACTION_RISK_LEVELS.DANGEROUS,
      true,
      'Shut down the laptop'
    );
  }

  if (
    /^(?:restart|reboot)(?:\s+(?:(?:the|my)\s+)?)?(?:laptop|computer|pc|system)?$/i.test(
      normalizedClause
    )
  ) {
    return createLaptopAction(
      'restart',
      source,
      {},
      ACTION_RISK_LEVELS.DANGEROUS,
      true,
      'Restart the laptop'
    );
  }

  if (
    /^(?:sleep|suspend)(?:\s+(?:(?:the|my)\s+)?)?(?:laptop|computer|pc|system)?$/i.test(
      normalizedClause
    )
  ) {
    return createLaptopAction(
      'sleep',
      source,
      {},
      ACTION_RISK_LEVELS.CAUTION,
      true,
      'Put the laptop to sleep'
    );
  }

  if (
    /^lock(?:\s+(?:(?:the|my)\s+)?)?(?:laptop|computer|pc|system)?$/i.test(
      normalizedClause
    )
  ) {
    return createLaptopAction(
      'lock',
      source,
      {},
      ACTION_RISK_LEVELS.SAFE,
      false,
      'Lock the laptop'
    );
  }

  if (/^(?:volume up|increase volume|raise volume|turn up volume)$/i.test(normalizedClause)) {
    return createLaptopAction(
      'volume_up',
      source,
      {},
      ACTION_RISK_LEVELS.SAFE,
      false,
      'Raise the volume'
    );
  }

  if (/^(?:volume down|decrease volume|lower volume|turn down volume)$/i.test(normalizedClause)) {
    return createLaptopAction(
      'volume_down',
      source,
      {},
      ACTION_RISK_LEVELS.SAFE,
      false,
      'Lower the volume'
    );
  }

  if (/^(?:mute|mute volume)$/i.test(normalizedClause)) {
    return createLaptopAction(
      'mute',
      source,
      {},
      ACTION_RISK_LEVELS.SAFE,
      false,
      'Mute the volume'
    );
  }

  if (/^(?:unmute|unmute volume)$/i.test(normalizedClause)) {
    return createLaptopAction(
      'unmute',
      source,
      {},
      ACTION_RISK_LEVELS.SAFE,
      false,
      'Unmute the volume'
    );
  }

  const openMatch = clause.match(/^(?:open|launch|start)\s+(.+)$/i);

  if (openMatch) {
    const target = normalizeAutomationText(openMatch[1]);
    const urlTarget = resolveUrlTarget(target);

    if (urlTarget) {
      return createLaptopAction(
        'open_url',
        source,
        {
          url: urlTarget.url,
          urlLabel: urlTarget.label,
        },
        ACTION_RISK_LEVELS.SAFE,
        false,
        `Open ${urlTarget.label}`
      );
    }

    const supportedApp = findSupportedApp(target);

    if (supportedApp) {
      return createLaptopAction(
        'open_app',
        source,
        {
          app: supportedApp.key,
          appLabel: supportedApp.label,
        },
        ACTION_RISK_LEVELS.SAFE,
        false,
        `Open ${supportedApp.label}`
      );
    }
  }

  const closeMatch = clause.match(/^(?:close|quit|exit)\s+(.+)$/i);

  if (closeMatch) {
    const supportedApp = findSupportedApp(normalizeAutomationText(closeMatch[1]));

    if (supportedApp) {
      return createLaptopAction(
        'close_app',
        source,
        {
          app: supportedApp.key,
          appLabel: supportedApp.label,
        },
        ACTION_RISK_LEVELS.SAFE,
        false,
        `Close ${supportedApp.label}`
      );
    }
  }

  return null;
}

function createControlAction(control, source) {
  return createAction({
    type: ACTION_TYPES.CONTROL,
    source,
    summary: control === ACTION_CONTROL_TYPES.CONFIRM ? 'Confirm pending action' : control,
    target: {
      control,
    },
    payload: {},
  });
}

function parseClauseActions(clause, source, inheritedDeviceActionRef) {
  const laptopAction = parseLaptopClause(clause, source);

  if (laptopAction) {
    return { kind: 'actions', actions: [laptopAction] };
  }

  const explicitDeviceAction = findInheritedDeviceAction(clause);

  if (explicitDeviceAction) {
    inheritedDeviceActionRef.current = explicitDeviceAction;
  }

  const looksLikeDeviceClause =
    DEVICE_HINT_PATTERN.test(clause) || Boolean(explicitDeviceAction);

  if (looksLikeDeviceClause) {
    const devicePrompt =
      explicitDeviceAction || !inheritedDeviceActionRef.current
        ? clause
        : `turn ${inheritedDeviceActionRef.current} ${clause}`;
    const parsedDevicePrompt = parseVoiceCommand(devicePrompt);

    if (parsedDevicePrompt.kind === 'device') {
      return {
        kind: 'actions',
        actions: [createDeviceAction(parsedDevicePrompt.command, source)],
      };
    }

    if (parsedDevicePrompt.kind === 'device_batch') {
      return {
        kind: 'actions',
        actions: parsedDevicePrompt.commands.map((command) =>
          createDeviceAction(command, source)
        ),
      };
    }

    return parsedDevicePrompt;
  }

  if (explicitDeviceAction) {
    return parseVoiceCommand(clause);
  }

  return {
    kind: 'actions',
    actions: [createAiAction(clause.trim(), source)],
  };
}

export function parsePromptToActions(prompt, source = 'voice') {
  const trimmedPrompt = normalizeAutomationText(prompt);

  if (!trimmedPrompt) {
    return { kind: 'empty' };
  }

  if (detectControlCommand(trimmedPrompt) === ACTION_CONTROL_TYPES.CONFIRM) {
    return {
      kind: 'control',
      actions: [createControlAction(ACTION_CONTROL_TYPES.CONFIRM, source)],
    };
  }

  if (detectControlCommand(trimmedPrompt) === ACTION_CONTROL_TYPES.CANCEL) {
    return {
      kind: 'control',
      actions: [createControlAction(ACTION_CONTROL_TYPES.CANCEL, source)],
    };
  }

  if (detectControlCommand(trimmedPrompt) === ACTION_CONTROL_TYPES.INTERRUPT) {
    return {
      kind: 'control',
      actions: [createControlAction(ACTION_CONTROL_TYPES.INTERRUPT, source)],
    };
  }

  const inheritedDeviceActionRef = { current: null };
  const actionList = [];

  for (const clause of splitIntoClauses(trimmedPrompt)) {
    const clauseResult = parseClauseActions(clause, source, inheritedDeviceActionRef);

    if (clauseResult.kind === 'clarify' || clauseResult.kind === 'device_not_found') {
      return clauseResult;
    }

    if (clauseResult.kind === 'actions') {
      actionList.push(...clauseResult.actions);
      continue;
    }

    if (clauseResult.kind === 'general') {
      actionList.push(createAiAction(clauseResult.prompt, source));
    }
  }

  if (!actionList.length) {
    return {
      kind: 'actions',
      actions: [createAiAction(trimmedPrompt, source)],
    };
  }

  return {
    kind: 'actions',
    actions: actionList,
  };
}
