export const LOCATION_LABELS = {
  living_room: 'Living Room',
  bedroom: 'Bedroom',
};

export const DEVICE_LABELS = {
  fan: 'Fan',
  lights: 'Lights',
  ac: 'AC',
};

export const DEVICE_CATALOG = [
  {
    device: 'fan',
    location: 'living_room',
    label: 'Living Room Fan',
  },
  {
    device: 'lights',
    location: 'living_room',
    label: 'Living Room Lights',
  },
  {
    device: 'lights',
    location: 'bedroom',
    label: 'Bedroom Lights',
  },
  {
    device: 'ac',
    location: 'living_room',
    label: 'Living Room AC',
  },
];

export const QUICK_PROMPTS = [
  'Turn on the living room fan',
  'Turn on fan and bedroom light',
  'Switch off all lights',
  'Turn off the bedroom light',
  'What can you do?',
];

export const DEFAULT_PROTOCOL =
  process.env.REACT_APP_ESP32_PROTOCOL === 'http' ? 'http' : 'websocket';

export const DEFAULT_AI_ENDPOINT =
  process.env.REACT_APP_AI_API_URL || 'http://localhost:3001/api/ai/chat';

export const DEFAULT_HTTP_ENDPOINT = process.env.REACT_APP_ESP32_HTTP_URL || '';
export const DEFAULT_WEBSOCKET_ENDPOINT =
  process.env.REACT_APP_ESP32_WS_URL || '';

const DEFAULT_LOCATION_BY_DEVICE = {
  fan: 'living_room',
  lights: 'living_room',
  ac: 'living_room',
};

const ACTION_PATTERNS = {
  on: /\b(turn|switch)\s+on\b|\bstart\b|\benable\b|\bactivate\b/,
  off: /\b(turn|switch)\s+off\b|\bstop\b|\bdisable\b|\bdeactivate\b|\bstandby\b|\bsleep\b/,
};

const DEVICE_PATTERNS = [
  { device: 'fan', matcher: /\bfan\b/ },
  { device: 'lights', matcher: /\blight\b|\blights\b|\blamp\b/ },
  { device: 'ac', matcher: /\bac\b|\bair\s*conditioner\b|\baircon\b/ },
];

const LOCATION_PATTERNS = [
  { location: 'living_room', matcher: /\bliving\s*room\b|\blounge\b/ },
  { location: 'bedroom', matcher: /\bbed\s*room\b|\bbedroom\b/ },
];

const CLAUSE_SPLIT_PATTERN = /\s*(?:,|\band then\b|\bthen\b|\band\b)\s*/;
const ALL_DEVICES_PATTERN = /\beverything\b|\ball\s+devices?\b|\ball\s+relays?\b/;
const ALL_PATTERN = /\ball\b|\beverything\b/;

export function buildDeviceStateKey(device, location) {
  return `${location}:${device}`;
}

export function createInitialDeviceStates() {
  return DEVICE_CATALOG.reduce((deviceStates, entry) => {
    deviceStates[buildDeviceStateKey(entry.device, entry.location)] = 'OFF';
    return deviceStates;
  }, {});
}

export function getDeviceLabel(device, location) {
  const existingDevice = DEVICE_CATALOG.find(
    (entry) => entry.device === device && entry.location === location
  );

  if (existingDevice) {
    return existingDevice.label;
  }

  const locationLabel = LOCATION_LABELS[location] || 'Unknown Location';
  const deviceLabel = DEVICE_LABELS[device] || device;
  return `${locationLabel} ${deviceLabel}`;
}

function findMatch(input, patterns, key) {
  const match = patterns.find((entry) => entry.matcher.test(input));
  return match ? match[key] : null;
}

function findAction(input) {
  if (ACTION_PATTERNS.on.test(input)) {
    return 'on';
  }

  if (ACTION_PATTERNS.off.test(input)) {
    return 'off';
  }

  return null;
}

function findDevice(input) {
  return findMatch(input, DEVICE_PATTERNS, 'device');
}

function findDevices(input) {
  return DEVICE_PATTERNS.filter((entry) => entry.matcher.test(input)).map(
    (entry) => entry.device
  );
}

function findLocation(input) {
  return findMatch(input, LOCATION_PATTERNS, 'location');
}

function buildCommand(device, action, location) {
  return {
    device,
    action,
    location,
  };
}

function dedupeValues(values) {
  return [...new Set(values)];
}

function dedupeCommands(commands) {
  const seenCommands = new Set();

  return commands.filter((command) => {
    const commandKey = `${command.location}:${command.device}:${command.action}`;

    if (seenCommands.has(commandKey)) {
      return false;
    }

    seenCommands.add(commandKey);
    return true;
  });
}

function splitIntoClauses(input) {
  const clauses = input
    .split(CLAUSE_SPLIT_PATTERN)
    .map((clause) => clause.trim())
    .filter(Boolean);

  return clauses.length ? clauses : [input];
}

function buildClarifyMessage(labels) {
  if (!labels.length) {
    return 'Tell me which device to control, then say whether you want it on or off.';
  }

  if (labels.length > 3) {
    return 'I heard multiple devices. Say whether you want them on or off.';
  }

  if (labels.length === 1) {
    return `I heard ${labels[0]}. Say whether you want it on or off.`;
  }

  return `I heard ${labels
    .slice(0, -1)
    .join(', ')}, and ${labels[labels.length - 1]}. Say whether you want them on or off.`;
}

function getCatalogEntriesForDevice(device) {
  return DEVICE_CATALOG.filter((entry) => entry.device === device);
}

function resolveDeviceCommands(
  device,
  action,
  { explicitLocation = null, inheritedLocation = null, requestAll = false } = {}
) {
  const matchingEntries = getCatalogEntriesForDevice(device);

  if (!matchingEntries.length) {
    return [];
  }

  if (requestAll) {
    const targetedEntries = explicitLocation
      ? matchingEntries.filter((entry) => entry.location === explicitLocation)
      : matchingEntries;

    return targetedEntries.map((entry) =>
      buildCommand(entry.device, action, entry.location)
    );
  }

  if (explicitLocation) {
    const explicitEntry = matchingEntries.find(
      (entry) => entry.location === explicitLocation
    );

    return explicitEntry
      ? [buildCommand(explicitEntry.device, action, explicitEntry.location)]
      : [];
  }

  if (inheritedLocation) {
    const inheritedEntry = matchingEntries.find(
      (entry) => entry.location === inheritedLocation
    );

    if (inheritedEntry) {
      return [
        buildCommand(inheritedEntry.device, action, inheritedEntry.location),
      ];
    }
  }

  const defaultLocation = DEFAULT_LOCATION_BY_DEVICE[device];
  const defaultEntry =
    matchingEntries.find((entry) => entry.location === defaultLocation) ||
    matchingEntries[0];

  return defaultEntry
    ? [buildCommand(defaultEntry.device, action, defaultEntry.location)]
    : [];
}

function buildMentionLabels(
  devices,
  { explicitLocation = null, inheritedLocation = null, requestAll = false, requestAllDevices = false } = {}
) {
  if (requestAllDevices) {
    const entries = explicitLocation
      ? DEVICE_CATALOG.filter((entry) => entry.location === explicitLocation)
      : DEVICE_CATALOG;

    return dedupeValues(
      entries.map((entry) => getDeviceLabel(entry.device, entry.location))
    );
  }

  return dedupeValues(
    devices.flatMap((device) => {
      const resolvedCommands = resolveDeviceCommands(device, 'on', {
        explicitLocation,
        inheritedLocation,
        requestAll,
      });

      if (resolvedCommands.length) {
        return resolvedCommands.map((command) =>
          getDeviceLabel(command.device, command.location)
        );
      }

      const fallbackLocation =
        explicitLocation ||
        inheritedLocation ||
        DEFAULT_LOCATION_BY_DEVICE[device] ||
        'living_room';

      return [getDeviceLabel(device, fallbackLocation)];
    })
  );
}

function buildCommandsFromClause(clause, action, inheritedLocation) {
  const explicitLocation = findLocation(clause);
  const devices = findDevices(clause);
  const requestAllDevices = ALL_DEVICES_PATTERN.test(clause);
  const requestAll = ALL_PATTERN.test(clause) || requestAllDevices;
  const labels = buildMentionLabels(devices, {
    explicitLocation,
    inheritedLocation,
    requestAll,
    requestAllDevices,
  });

  if (!action) {
    return {
      commands: [],
      labels,
      explicitLocation,
      deviceMentioned: devices.length > 0 || requestAllDevices,
    };
  }

  if (requestAllDevices) {
    const targetedEntries = explicitLocation
      ? DEVICE_CATALOG.filter((entry) => entry.location === explicitLocation)
      : DEVICE_CATALOG;

    return {
      commands: targetedEntries.map((entry) =>
        buildCommand(entry.device, action, entry.location)
      ),
      labels,
      explicitLocation,
      deviceMentioned: true,
    };
  }

  if (!devices.length) {
    return {
      commands: [],
      labels,
      explicitLocation,
      deviceMentioned: false,
    };
  }

  return {
    commands: devices.flatMap((device) =>
      resolveDeviceCommands(device, action, {
        explicitLocation,
        inheritedLocation,
        requestAll,
      })
    ),
    labels,
    explicitLocation,
    deviceMentioned: true,
  };
}

export function parseVoiceCommand(transcript) {
  const normalizedTranscript = transcript
    .trim()
    .toLowerCase()
    .replace(/[!?]/g, ' ')
    .replace(/\s+/g, ' ');

  if (!normalizedTranscript) {
    return { kind: 'empty' };
  }

  const clauses = splitIntoClauses(normalizedTranscript);
  const globalAction = findAction(normalizedTranscript);
  let inheritedAction = globalAction;
  let inheritedLocation = null;
  let deviceMentioned = false;
  const clarifyLabels = [];
  const commands = [];

  clauses.forEach((clause) => {
    const clauseAction = findAction(clause);

    if (clauseAction) {
      inheritedAction = clauseAction;
    }

    const nextAction = clauseAction || inheritedAction;
    const clauseResult = buildCommandsFromClause(
      clause,
      nextAction,
      inheritedLocation
    );

    if (clauseResult.deviceMentioned) {
      deviceMentioned = true;
    }

    if (!nextAction && clauseResult.labels.length) {
      clarifyLabels.push(...clauseResult.labels);
    }

    if (clauseResult.commands.length) {
      commands.push(...clauseResult.commands);
    }

    if (clauseResult.explicitLocation) {
      inheritedLocation = clauseResult.explicitLocation;
      return;
    }

    if (clauseResult.commands.length === 1) {
      inheritedLocation = clauseResult.commands[0].location;
    }
  });

  const uniqueCommands = dedupeCommands(commands);

  if (uniqueCommands.length > 1) {
    return {
      kind: 'device_batch',
      commands: uniqueCommands,
    };
  }

  if (uniqueCommands.length === 1) {
    return {
      kind: 'device',
      command: uniqueCommands[0],
    };
  }

  if (deviceMentioned && !globalAction) {
    return {
      kind: 'clarify',
      message: buildClarifyMessage(dedupeValues(clarifyLabels)),
    };
  }

  if (globalAction) {
    return {
      kind: 'device_not_found',
      message: 'Device not found. Try fan, lights, or AC.',
    };
  }

  return {
    kind: 'general',
    prompt: transcript.trim(),
  };
}

export function buildLocalAssistantReply(prompt) {
  const normalizedPrompt = prompt.trim().toLowerCase();

  if (/weather|temperature|forecast/.test(normalizedPrompt)) {
    return 'Weather answers are still local placeholders in this phase. Once an AI or weather backend is connected, I can answer with live conditions here.';
  }

  if (/who are you|your name|what can you do|help/.test(normalizedPrompt)) {
    return 'I am Jarvis, your TV-ready assistant. In Phase 5 I can capture live voice, parse single or multi-device commands into JSON, and route them toward the ESP32 while keeping general questions local.';
  }

  if (/what is ai|what's ai|explain ai/.test(normalizedPrompt)) {
    return 'AI is software that interprets patterns and language to help automate tasks. Here, it powers command parsing and the assistant experience around your smart-home controls.';
  }

  if (/how are you|are you ready/.test(normalizedPrompt)) {
    return 'Systems are ready. Voice capture, transport selection, and device status feedback are all standing by.';
  }

  return `That question is being handled locally for now: "${prompt}". A future backend can replace this with live AI answers.`;
}

export function formatCommandJson(command) {
  return JSON.stringify(command, null, 2);
}

function normalizeDeviceValue(value) {
  if (!value) {
    return null;
  }

  return findDevice(String(value).toLowerCase());
}

function normalizeLocationValue(value, device) {
  if (value) {
    const normalizedLocation = findLocation(String(value).toLowerCase());

    if (normalizedLocation) {
      return normalizedLocation;
    }
  }

  return device ? DEFAULT_LOCATION_BY_DEVICE[device] : null;
}

function normalizeStateValue(value) {
  if (value === true || value === 1) {
    return 'ON';
  }

  if (value === false || value === 0) {
    return 'OFF';
  }

  const normalizedValue = String(value || '').trim().toLowerCase();

  if (['on', 'start', 'enabled', 'true', '1'].includes(normalizedValue)) {
    return 'ON';
  }

  if (
    ['off', 'stop', 'disabled', 'false', '0', 'standby'].includes(
      normalizedValue
    )
  ) {
    return 'OFF';
  }

  return null;
}

function normalizeFeedbackEntry(entry) {
  const device = normalizeDeviceValue(entry.device);
  const location = normalizeLocationValue(entry.location, device);
  const state = normalizeStateValue(entry.state || entry.action);

  if (!device || !location || !state) {
    return null;
  }

  return { device, location, state };
}

function collectFeedbackEntries(payload) {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload.updates)) {
    return payload.updates;
  }

  if (payload.payload) {
    return collectFeedbackEntries(payload.payload);
  }

  if (payload.device || payload.state || payload.action) {
    return [payload];
  }

  return [];
}

export function extractEsp32Feedback(payload) {
  let parsedPayload = payload;

  if (typeof parsedPayload === 'string') {
    try {
      parsedPayload = JSON.parse(parsedPayload);
    } catch (error) {
      return {
        message: payload,
        updates: [],
      };
    }
  }

  const updates = collectFeedbackEntries(parsedPayload)
    .map((entry) => normalizeFeedbackEntry(entry))
    .filter(Boolean);

  return {
    message:
      typeof parsedPayload?.message === 'string' ? parsedPayload.message : '',
    updates,
  };
}

export function applyFeedbackUpdates(currentStates, updates) {
  return updates.reduce((nextStates, update) => {
    nextStates[buildDeviceStateKey(update.device, update.location)] =
      update.state;
    return nextStates;
  }, { ...currentStates });
}

export function buildFeedbackMessage(updates) {
  if (!updates.length) {
    return 'ESP32 acknowledged the request.';
  }

  return updates
    .map(
      (update) =>
        `${getDeviceLabel(update.device, update.location)} is now ${
          update.state
        }.`
    )
    .join(' ');
}
