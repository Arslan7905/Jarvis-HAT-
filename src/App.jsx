import { useEffect, useRef, useState } from 'react';
import {
  Button,
  MantineProvider,
  createTheme,
} from '@mantine/core';
import {
  ACTION_CONTROL_TYPES,
  ACTION_RESULT_STATUS,
  ACTION_TYPES,
  createActionResult,
} from './automation/actionSchema';
import {
  detectControlCommand,
  normalizeAutomationText,
  parsePromptToActions,
} from './automation/actionParser';
import { validateActionBatch } from './automation/actionValidator';
import { summarizeActionPlan, summarizeActionResults } from './automation/actionSummary';
import { createActionQueue } from './automation/actionQueue';
import { createConfirmationStateMachine } from './automation/confirmationState';
import {
  mergeAutomationSettings,
  readActionLogs,
  readAutomationSettings,
  writeActionLogs,
  writeAutomationSettings,
} from './automation/settings';
import JarvisAvatar from './components/JarvisAvatar';
import SpeechBubble from './components/SpeechBubble';
import { routeAction } from './automation/actionRouter';
import { createEsp32Transport } from './integrations/esp32';
import { sendAiPrompt } from './integrations/aiClient';
import { executeLaptopAction } from './integrations/laptopClient';
import {
  buildClientSessionMetadata,
  getOrCreateSessionId,
  loadSettingsSnapshot,
  loadSessionInventory,
  patchSettingsSnapshot,
  registerClientSession,
  revokeOtherSessions,
  revokeSession,
  resolveSettingsApiUrl,
} from './integrations/settingsClient';
import {
  applyFeedbackUpdates,
  buildFeedbackMessage,
  buildLocalAssistantReply,
  createInitialDeviceStates,
} from './utils/jarvis';

const theme = createTheme({
  primaryColor: 'cyan',
  fontFamily: 'Space Grotesk, sans-serif',
  defaultRadius: 'xl',
  components: {
    Button: {
      defaultProps: {
        radius: 'xl',
        size: 'xl',
      },
    },
  },
});

const initialConversation = [];

const initialStatusPanel = {
  label: 'Stand By',
  message:
    'Enable voice capture, then begin each request with "Hey Jarvis".',
  tone: 'neutral',
};

const MAX_VISIBLE_MESSAGES = 10;
const WAKE_WORD_PATTERN = /^\s*hey[\s,.-]*jarvis\b[\s,!:.-]*/i;

function wait(delay) {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

function getConnectionCopy(protocol, status, useMockDevices = false) {
  if (useMockDevices) {
    if (status === 'testing') {
      return 'Mock devices testing';
    }

    if (status === 'sending') {
      return 'Mock devices executing';
    }

    return 'Mock devices enabled';
  }

  if (protocol === 'http') {
    if (status === 'connected') {
      return 'HTTP endpoint reachable';
    }

    if (status === 'testing') {
      return 'Testing HTTP endpoint';
    }

    if (status === 'sending') {
      return 'Sending HTTP command';
    }

    if (status === 'configured') {
      return 'HTTP endpoint configured';
    }

    if (status === 'error') {
      return 'HTTP error';
    }

    return 'HTTP not configured';
  }

  if (status === 'connected') {
    return 'WebSocket connected';
  }

  if (status === 'connecting') {
    return 'WebSocket connecting';
  }

  if (status === 'error') {
    return 'WebSocket error';
  }

  if (status === 'disconnected') {
    return 'WebSocket disconnected';
  }

  return 'WebSocket not configured';
}

function getAiConnectionCopy(status) {
  if (status === 'connected') {
    return 'AI backend reachable';
  }

  if (status === 'sending') {
    return 'Querying AI backend';
  }

  if (status === 'configured') {
    return 'AI backend configured';
  }

  if (status === 'error') {
    return 'AI backend error';
  }

  return 'AI backend not configured';
}

function buildVoiceErrorMessage(errorCode) {
  if (errorCode === 'no-speech') {
    return "Sorry, I didn't catch that. Please try again.";
  }

  if (errorCode === 'audio-capture') {
    return 'The microphone is unavailable right now. Check the mic input and try again.';
  }

  if (errorCode === 'network') {
    return 'Voice recognition lost its network connection. Please try again.';
  }

  if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
    return 'Microphone permission is blocked. Allow microphone access and try again.';
  }

  return 'Voice recognition hit an error. Please try again.';
}

function normalizePromptFingerprint(prompt) {
  return prompt.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeFinalTranscript(prompt) {
  return String(prompt || '').trim().replace(/\s+/g, ' ');
}

function extractWakeWordPrompt(prompt) {
  const match = prompt.match(WAKE_WORD_PATTERN);

  if (!match) {
    return null;
  }

  return prompt.slice(match[0].length).trim();
}

function toSentenceCase(summary) {
  if (!summary) {
    return '';
  }

  return `${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;
}

function logRouteDecision(decision) {
  if (
    typeof console !== 'undefined' &&
    process.env.NODE_ENV !== 'production'
  ) {
    console.info('[Jarvis Routing]', decision);
  }
}

function serializeRouteActions(actions = []) {
  return actions.map((action) => ({
    type: action.type,
    summary: action.summary,
    target: action.target,
    payload: action.payload,
    requiresConfirmation: action.requiresConfirmation,
  }));
}

function App() {
  const [activity, setActivity] = useState('idle');
  const [recognizedText, setRecognizedText] = useState('');
  const [conversation, setConversation] = useState(initialConversation);
  const [, setDeviceStates] = useState(createInitialDeviceStates);
  const [settings, setSettings] = useState(readAutomationSettings);
  const [actionLogs, setActionLogs] = useState(readActionLogs);
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const aiEndpoint = settings.aiEndpoint;
  const transportProtocol = settings.deviceTransport;
  const httpEndpoint = settings.httpEndpoint;
  const websocketEndpoint = settings.websocketEndpoint;
  const [aiStatus, setAiStatus] = useState(() =>
    aiEndpoint.trim() ? 'configured' : 'not_configured'
  );
  const [connectionStatus, setConnectionStatus] = useState(() =>
    settings.useMockDevices
      ? 'connected'
      : transportProtocol === 'http'
        ? httpEndpoint.trim()
          ? 'configured'
          : 'not_configured'
        : websocketEndpoint.trim()
          ? 'disconnected'
          : 'not_configured'
  );
  const [statusPanel, setStatusPanel] = useState(initialStatusPanel);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [speechOutputEnabled, setSpeechOutputEnabled] = useState(true);
  const [chatPanelOpen, setChatPanelOpen] = useState(true);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [settingsSyncState, setSettingsSyncState] = useState({
    hydrated: false,
    saving: false,
    error: '',
  });
  const [sessionInventory, setSessionInventory] = useState({
    currentSessionId: '',
    sessions: [],
    loading: true,
    saving: false,
    error: '',
  });
  const [queueSnapshot, setQueueSnapshot] = useState({
    busy: false,
    lastRunStatus: 'idle',
    currentSummary: '',
  });
  const [liveReply, setLiveReply] = useState({
    label: 'Jarvis',
    message: 'Replies will stream here while Jarvis speaks.',
    tone: 'neutral',
    streaming: false,
  });
  const messageCounterRef = useRef(1);
  const initialAiEndpointRef = useRef(aiEndpoint);
  const timeoutIdsRef = useRef([]);
  const streamTimeoutIdsRef = useRef([]);
  const recognitionRef = useRef(null);
  const recognitionActiveRef = useRef(false);
  const speechUtteranceRef = useRef(null);
  const activityRef = useRef(activity);
  const appendConversationEntryRef = useRef(() => {});
  const processPromptRef = useRef(() => {});
  const promptLockRef = useRef(false);
  const actionQueueRef = useRef(createActionQueue());
  const confirmationMachineRef = useRef(createConfirmationStateMachine());
  const transportRef = useRef(null);
  const transportFeedbackHandlerRef = useRef(() => {});
  const currentSessionIdRef = useRef('');
  const skipNextSettingsSyncRef = useRef(false);
  const pendingSettingsPatchRef = useRef(null);
  const lastAcceptedPromptRef = useRef({
    fingerprint: '',
    at: 0,
  });
  const liveMessageTokenRef = useRef(0);
  const desktopChatScrollRef = useRef(null);
  const mobileChatScrollRef = useRef(null);

  const nextMessageId = (speaker) => {
    const nextId = `${speaker}-${messageCounterRef.current}`;
    messageCounterRef.current += 1;
    return nextId;
  };

  const updateSettings = (updates) => {
    pendingSettingsPatchRef.current = {
      ...(pendingSettingsPatchRef.current || {}),
      ...updates,
      laptopPermissions: {
        ...(pendingSettingsPatchRef.current?.laptopPermissions || {}),
        ...(updates.laptopPermissions || {}),
      },
    };
    setSettings((currentSettings) => ({
      ...currentSettings,
      ...updates,
      laptopPermissions: {
        ...currentSettings.laptopPermissions,
        ...(updates.laptopPermissions || {}),
      },
    }));
  };

  const appendActionLog = (entry) => {
    setActionLogs((currentLogs) =>
      [
        {
          id: `log-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          at: new Date().toISOString(),
          ...entry,
        },
        ...currentLogs,
      ].slice(0, 20)
    );
  };

  const applySettingsSnapshot = (nextSettings) => {
    const mergedSettings = mergeAutomationSettings(nextSettings);
    skipNextSettingsSyncRef.current = true;
    pendingSettingsPatchRef.current = null;
    setSettings(mergedSettings);
    writeAutomationSettings(mergedSettings);
    return mergedSettings;
  };

  const applySessionInventorySnapshot = (inventory, overrides = {}) => {
    setSessionInventory({
      currentSessionId:
        inventory?.currentSessionId || currentSessionIdRef.current || '',
      sessions: inventory?.sessions || [],
      loading: false,
      saving: false,
      error: '',
      ...overrides,
    });
  };

  const appendConversationEntry = (
    speaker,
    label,
    message,
    tone = speaker === 'user' ? 'user' : 'neutral',
    streaming = false
  ) => {
    const entryId = nextMessageId(speaker);

    setConversation((currentConversation) =>
      [
        ...currentConversation,
        {
          id: entryId,
          speaker,
          label,
          message,
          tone,
          streaming,
        },
      ].slice(-MAX_VISIBLE_MESSAGES)
    );

    return entryId;
  };

  const updateConversationEntry = (entryId, updates) => {
    setConversation((currentConversation) =>
      currentConversation.map((entry) =>
        entry.id === entryId ? { ...entry, ...updates } : entry
      )
    );
  };

  const updateStatusPanel = (label, message, tone = 'neutral') => {
    setStatusPanel({ label, message, tone });
  };

  const clearQueuedTimeouts = () => {
    timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timeoutIdsRef.current = [];
  };

  const clearStreamAnimation = () => {
    streamTimeoutIdsRef.current.forEach((timeoutId) =>
      window.clearTimeout(timeoutId)
    );
    streamTimeoutIdsRef.current = [];
  };

  const queueTimeout = (callback, delay) => {
    const timeoutId = window.setTimeout(callback, delay);
    timeoutIdsRef.current.push(timeoutId);
  };

  const resetActivitySoon = (delay = 1300) => {
    clearQueuedTimeouts();
    queueTimeout(() => {
      setActivity('idle');
    }, delay);
  };

  const cancelSpeechSynthesis = () => {
    if (
      typeof window !== 'undefined' &&
      window.speechSynthesis &&
      typeof window.speechSynthesis.cancel === 'function'
    ) {
      window.speechSynthesis.cancel();
    }

    speechUtteranceRef.current = null;
  };

  const stopSpeechOutput = () => {
    liveMessageTokenRef.current += 1;
    clearStreamAnimation();
    cancelSpeechSynthesis();
  };

  const animateConversationEntry = (entryId, label, message, tone, token) =>
    new Promise((resolve) => {
      clearStreamAnimation();

      if (liveMessageTokenRef.current !== token) {
        resolve();
        return;
      }

      setLiveReply({
        label,
        message: '',
        tone,
        streaming: Boolean(message),
      });

      if (!message) {
        updateConversationEntry(entryId, { message, streaming: false });
        setLiveReply({
          label,
          message,
          tone,
          streaming: false,
        });
        resolve();
        return;
      }

      const chunks = message.match(/\S+\s*/g) || [message];
      let visibleMessage = '';

      chunks.forEach((chunk, index) => {
        const timeoutId = window.setTimeout(() => {
          if (liveMessageTokenRef.current !== token) {
            resolve();
            return;
          }

          visibleMessage += chunk;
          updateConversationEntry(entryId, {
            message: visibleMessage.trimEnd(),
            streaming: index < chunks.length - 1,
          });
          setLiveReply({
            label,
            message: visibleMessage.trimEnd(),
            tone,
            streaming: index < chunks.length - 1,
          });

          if (index === chunks.length - 1) {
            resolve();
          }
        }, index * 72);

        streamTimeoutIdsRef.current.push(timeoutId);
      });
    });

  const speakText = (message) =>
    new Promise((resolve) => {
      if (
        !speechOutputEnabled ||
        !ttsSupported ||
        typeof window === 'undefined' ||
        !window.speechSynthesis ||
        typeof window.SpeechSynthesisUtterance === 'undefined'
      ) {
        resolve(false);
        return;
      }

      try {
        cancelSpeechSynthesis();

        const utterance = new window.SpeechSynthesisUtterance(message);
        utterance.rate = 1.02;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onend = () => {
          if (speechUtteranceRef.current === utterance) {
            speechUtteranceRef.current = null;
          }

          resolve(true);
        };

        utterance.onerror = () => {
          if (speechUtteranceRef.current === utterance) {
            speechUtteranceRef.current = null;
          }

          resolve(false);
        };

        speechUtteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        resolve(false);
      }
    });

  const deliverAssistantMessage = async (
    label,
    message,
    tone = 'neutral',
    { speak = true } = {}
  ) => {
    if (!message) {
      return;
    }

    const entryId = appendConversationEntry(
      'assistant',
      label,
      '',
      tone,
      true
    );

    updateStatusPanel(label, message, tone);
    setActivity('speaking');
    const token = liveMessageTokenRef.current + 1;
    liveMessageTokenRef.current = token;

    const tasks = [animateConversationEntry(entryId, label, message, tone, token)];

    if (speak) {
      tasks.push(speakText(message));
    }

    await Promise.allSettled(tasks);

    if (liveMessageTokenRef.current !== token) {
      return;
    }

    updateConversationEntry(entryId, {
      message,
      streaming: false,
    });
    setLiveReply({
      label,
      message,
      tone,
      streaming: false,
    });

    resetActivitySoon(220);
  };

  const handleFeedback = async (
    feedback,
    fallbackCommand = null,
    label = 'ESP32',
    { setSpeaking = true, tone = 'success', speak = true } = {}
  ) => {
    const fallbackUpdates = fallbackCommand
      ? [
          {
            device: fallbackCommand.device,
            location: fallbackCommand.location,
            state: fallbackCommand.action.toUpperCase(),
          },
        ]
      : [];

    const effectiveUpdates = feedback.updates.length
      ? feedback.updates
      : fallbackUpdates;

    if (effectiveUpdates.length) {
      setDeviceStates((currentStates) =>
        applyFeedbackUpdates(currentStates, effectiveUpdates)
      );
    }

    const message =
      feedback.message || buildFeedbackMessage(effectiveUpdates) || '';

    if (message) {
      await deliverAssistantMessage(label, message, tone, {
        speak: setSpeaking && speak,
      });
    }

    if (setSpeaking && !message) {
      setActivity('speaking');
      resetActivitySoon();
    }
  };
  transportFeedbackHandlerRef.current = handleFeedback;

  const waitForActionQueueToSettle = async (timeout = 1500) => {
    const startedAt = Date.now();

    while (actionQueueRef.current.isBusy()) {
      if (Date.now() - startedAt >= timeout) {
        break;
      }

      // eslint-disable-next-line no-await-in-loop
      await wait(60);
    }
  };

  const executeStructuredAction = async (action) =>
    routeAction(action, {
      device: {
        execute: async (deviceAction) => {
          const nextCommand = {
            device: deviceAction.target.device,
            location: deviceAction.target.location,
            action: deviceAction.payload.state.toLowerCase(),
          };
          const transport = transportRef.current;

          if (!transport) {
            throw new Error('Device transport is unavailable.');
          }

          updateStatusPanel('Dispatch', `Executing ${deviceAction.summary}.`, 'pending');
          const transportResult = await transport.execute(nextCommand);
          const effectiveUpdates =
            transportResult.updates && transportResult.updates.length
              ? transportResult.updates
              : [
                  {
                    device: nextCommand.device,
                    location: nextCommand.location,
                    state: nextCommand.action.toUpperCase(),
                  },
                ];

          setDeviceStates((currentStates) =>
            applyFeedbackUpdates(currentStates, effectiveUpdates)
          );

          return createActionResult(deviceAction, {
            ok: true,
            status:
              transportResult.status === 'mocked'
                ? ACTION_RESULT_STATUS.MOCKED
                : ACTION_RESULT_STATUS.SUCCESS,
            message:
              transportResult.message || buildFeedbackMessage(effectiveUpdates),
            data: {
              updates: effectiveUpdates,
              transport: transportResult.transport || transport.mode,
            },
          });
        },
      },
      ai: {
        execute: async (aiAction) => {
          if (!aiEndpoint.trim()) {
            const fallbackReply = buildLocalAssistantReply(aiAction.payload.prompt);
            updateStatusPanel(
              'AI',
              'AI backend not configured. Answering locally for now.',
              'pending'
            );

            return createActionResult(aiAction, {
              ok: true,
              status: ACTION_RESULT_STATUS.MOCKED,
              message: fallbackReply,
              data: {
                fallback: true,
              },
            });
          }

          setAiStatus('sending');
          updateStatusPanel(
            'AI',
            'Sending this question to the secure AI backend.',
            'pending'
          );

          try {
            const reply = await sendAiPrompt(aiEndpoint, aiAction.payload.prompt);
            setAiStatus('connected');
            return createActionResult(aiAction, {
              ok: true,
              status: ACTION_RESULT_STATUS.SUCCESS,
              message: reply,
            });
          } catch (error) {
            const fallbackReply = buildLocalAssistantReply(aiAction.payload.prompt);
            setAiStatus('error');
            appendActionLog({
              type: aiAction.type,
              summary: aiAction.summary,
              status: ACTION_RESULT_STATUS.ERROR,
              message: error.message || 'AI request failed.',
            });

            return createActionResult(aiAction, {
              ok: true,
              status: ACTION_RESULT_STATUS.MOCKED,
              message: fallbackReply,
              data: {
                fallback: true,
                warning: error.message || 'AI request failed.',
              },
            });
          }
        },
      },
      laptop: {
        execute: async (laptopAction) => {
          const operation = laptopAction.target.operation;

          if (
            ['shutdown', 'restart', 'sleep'].includes(operation) &&
            !settings.laptopPermissions.allowPower
          ) {
            return createActionResult(laptopAction, {
              ok: false,
              status: ACTION_RESULT_STATUS.DENIED,
              message: 'Power actions are disabled in the admin panel permissions.',
              haltQueue: true,
            });
          }

          if (
            ['open_app', 'close_app'].includes(operation) &&
            !settings.laptopPermissions.allowApps
          ) {
            return createActionResult(laptopAction, {
              ok: false,
              status: ACTION_RESULT_STATUS.DENIED,
              message: 'App automation is disabled in the admin panel permissions.',
              haltQueue: true,
            });
          }

          if (operation === 'open_url' && !settings.laptopPermissions.allowUrls) {
            return createActionResult(laptopAction, {
              ok: false,
              status: ACTION_RESULT_STATUS.DENIED,
              message: 'URL automation is disabled in the admin panel permissions.',
              haltQueue: true,
            });
          }

          if (
            ['volume_up', 'volume_down', 'mute', 'unmute'].includes(operation) &&
            !settings.laptopPermissions.allowVolume
          ) {
            return createActionResult(laptopAction, {
              ok: false,
              status: ACTION_RESULT_STATUS.DENIED,
              message: 'Volume automation is disabled in the admin panel permissions.',
              haltQueue: true,
            });
          }

          updateStatusPanel('Laptop', `Executing ${laptopAction.summary}.`, 'pending');
          const laptopResult = await executeLaptopAction(laptopAction, {
            useMock: settings.mockLaptopActions,
          });

          return createActionResult(laptopAction, {
            ok: Boolean(laptopResult.ok),
            status:
              laptopResult.status === 'mocked'
                ? ACTION_RESULT_STATUS.MOCKED
                : ACTION_RESULT_STATUS.SUCCESS,
            message: laptopResult.message,
            data: laptopResult.data,
          });
        },
      },
    });

  const runActionPlan = async (actions, prompt, source, overrideSummary = '') => {
    setQueueSnapshot({
      busy: true,
      lastRunStatus: queueSnapshot.lastRunStatus,
      currentSummary: overrideSummary || summarizeActionPlan(actions),
    });
    setActivity('thinking');

    const runResult = await actionQueueRef.current.run({
      actions,
      executeAction: executeStructuredAction,
      onActionStart: ({ action }) => {
        setQueueSnapshot((currentSnapshot) => ({
          ...currentSnapshot,
          busy: true,
          currentSummary: action.summary,
        }));
        appendActionLog({
          prompt,
          source,
          type: action.type,
          summary: action.summary,
          status: 'started',
          message: 'Action started.',
        });
      },
      onActionResult: ({ action, result }) => {
        appendActionLog({
          prompt,
          source,
          type: action.type,
          summary: action.summary,
          status: result.status,
          message: result.message,
        });
      },
    });

    const actionableResults = runResult.results.filter(
      (result) =>
        result.status !== ACTION_RESULT_STATUS.CANCELLED &&
        result.status !== ACTION_RESULT_STATUS.INTERRUPTED
    );
    const singleResult = actionableResults.length === 1 ? actionableResults[0] : null;
    const runTone =
      runResult.status === ACTION_RESULT_STATUS.SUCCESS
        ? 'success'
        : runResult.status === ACTION_RESULT_STATUS.CANCELLED ||
            runResult.status === ACTION_RESULT_STATUS.INTERRUPTED
          ? 'pending'
          : actionableResults.some((result) => !result.ok)
            ? 'error'
            : 'success';
    const runMessage =
      runResult.status === ACTION_RESULT_STATUS.CANCELLED
        ? 'Cancelled the current action queue.'
        : runResult.status === ACTION_RESULT_STATUS.INTERRUPTED
          ? 'Interrupted the previous action queue.'
          : singleResult
            ? singleResult.message
            : summarizeActionResults(actionableResults);
    const runLabel =
      singleResult?.type === ACTION_TYPES.AI_QUERY ? 'Jarvis AI' : 'Jarvis';

    if (singleResult?.data?.warning) {
      appendConversationEntry('assistant', 'Jarvis', singleResult.data.warning, 'error');
    }

    await deliverAssistantMessage(runLabel, runMessage, runTone);

    setQueueSnapshot({
      busy: false,
      lastRunStatus: runResult.status,
      currentSummary: '',
    });
  };

  const getSingleControlAction = (actions = []) =>
    actions.length === 1 && actions[0].type === ACTION_TYPES.CONTROL
      ? actions[0]
      : null;

  const handleControlAction = async (controlAction) => {
    if (controlAction.target.control === ACTION_CONTROL_TYPES.CONFIRM) {
      const pendingRequest = confirmationMachineRef.current.get();

      if (!pendingRequest) {
        updateStatusPanel(
          'Confirmation',
          'There is no pending action waiting for confirmation.',
          'pending'
        );
        await deliverAssistantMessage(
          'Jarvis',
          'There is nothing waiting for confirmation right now.',
          'pending'
        );
        return;
      }

      confirmationMachineRef.current.clear();
      setPendingConfirmation(null);
      stopSpeechOutput();
      await runActionPlan(
        pendingRequest.actions,
        pendingRequest.prompt,
        pendingRequest.source,
        pendingRequest.summary
      );
      return;
    }

    if (controlAction.target.control === ACTION_CONTROL_TYPES.CANCEL) {
      if (confirmationMachineRef.current.hasPending()) {
        confirmationMachineRef.current.clear();
        setPendingConfirmation(null);
        updateStatusPanel('Confirmation', 'Okay, canceled.', 'pending');
        await deliverAssistantMessage('Jarvis', 'Okay, canceled.', 'pending');
        return;
      }

      if (actionQueueRef.current.isBusy()) {
        actionQueueRef.current.cancel('Cancelled by user request.');
        stopSpeechOutput();
        await waitForActionQueueToSettle();
        setQueueSnapshot({
          busy: false,
          lastRunStatus: ACTION_RESULT_STATUS.CANCELLED,
          currentSummary: '',
        });
        updateStatusPanel('Queue', 'Okay, canceled.', 'pending');
        await deliverAssistantMessage('Jarvis', 'Okay, canceled.', 'pending');
        return;
      }

      updateStatusPanel('Queue', 'There is nothing to cancel right now.', 'pending');
      await deliverAssistantMessage(
        'Jarvis',
        'There is nothing to cancel right now.',
        'pending'
      );
      return;
    }

    if (controlAction.target.control === ACTION_CONTROL_TYPES.INTERRUPT) {
      if (!settings.allowInterruptions) {
        updateStatusPanel(
          'Queue',
          'Interruption is disabled in the admin panel settings.',
          'error'
        );
        await deliverAssistantMessage(
          'Jarvis',
          'Interruption is disabled in the admin panel settings.',
          'error'
        );
        return;
      }

      if (actionQueueRef.current.isBusy()) {
        actionQueueRef.current.interrupt('Interrupted by user request.');
        stopSpeechOutput();
        await waitForActionQueueToSettle();
        setQueueSnapshot({
          busy: false,
          lastRunStatus: ACTION_RESULT_STATUS.INTERRUPTED,
          currentSummary: '',
        });
        updateStatusPanel('Queue', 'Interrupted the current action queue.', 'pending');
        await deliverAssistantMessage(
          'Jarvis',
          'Interrupted the current action queue.',
          'pending'
        );
        return;
      }

      updateStatusPanel('Queue', 'There is no active action queue to interrupt.', 'pending');
      await deliverAssistantMessage(
        'Jarvis',
        'There is no active action queue to interrupt.',
        'pending'
      );
    }
  };

  const processPrompt = async (prompt, source = 'typed') => {
    const rawTranscript = String(prompt || '');
    const normalizedTranscript = normalizeFinalTranscript(rawTranscript);
    let wakeWordStrippedTranscript = normalizedTranscript;

    if (source === 'voice') {
      wakeWordStrippedTranscript = extractWakeWordPrompt(normalizedTranscript);

      if (wakeWordStrippedTranscript === null) {
        logRouteDecision({
          rawTranscript,
          normalizedTranscript,
          wakeWordStrippedTranscript: '',
          pendingConfirmationPresent: Boolean(
            confirmationMachineRef.current.get()
          ),
          cancelCommandDetected: false,
          parserMatched: false,
          parsedActionsCount: 0,
          parsedActionsPayload: [],
          validationAcceptedCount: 0,
          validationRejectedCount: 0,
          chosenRoute: 'wake_word_ignored',
          fallbackToAI: false,
        });
        setRecognizedText('');
        updateStatusPanel(
          'Wake Word',
          'Waiting for "Hey Jarvis" at the start of your command.',
          'pending'
        );
        return;
      }

      if (!wakeWordStrippedTranscript) {
        logRouteDecision({
          rawTranscript,
          normalizedTranscript,
          wakeWordStrippedTranscript: '',
          pendingConfirmationPresent: Boolean(
            confirmationMachineRef.current.get()
          ),
          cancelCommandDetected: false,
          parserMatched: false,
          parsedActionsCount: 0,
          parsedActionsPayload: [],
          validationAcceptedCount: 0,
          validationRejectedCount: 0,
          chosenRoute: 'wake_word_only',
          fallbackToAI: false,
        });
        setRecognizedText('');
        updateStatusPanel(
          'Wake Word',
          'Wake word heard. Say your full request after "Hey Jarvis".',
          'pending'
        );
        return;
      }
    }

    const trimmedPrompt = normalizeAutomationText(wakeWordStrippedTranscript);
    const fingerprint = normalizePromptFingerprint(trimmedPrompt);
    const now = Date.now();
    const pendingRequest = confirmationMachineRef.current.get();
    const detectedControl = detectControlCommand(trimmedPrompt);
    const cancelCommandDetected =
      detectedControl === ACTION_CONTROL_TYPES.CANCEL ||
      detectedControl === ACTION_CONTROL_TYPES.INTERRUPT;
    const buildRouteDecision = (overrides = {}) => ({
      rawTranscript,
      normalizedTranscript,
      wakeWordStrippedTranscript,
      pendingConfirmationPresent: Boolean(pendingRequest),
      cancelCommandDetected,
      parserMatched: false,
      parsedActionsCount: 0,
      parsedActionsPayload: [],
      validationAcceptedCount: 0,
      validationRejectedCount: 0,
      chosenRoute: 'ai',
      fallbackToAI: false,
      ...overrides,
    });

    if (!trimmedPrompt) {
      logRouteDecision(
        buildRouteDecision({
          chosenRoute: 'empty',
        })
      );
      return;
    }

    if (
      lastAcceptedPromptRef.current.fingerprint === fingerprint &&
      now - lastAcceptedPromptRef.current.at < 2500
    ) {
      logRouteDecision(
        buildRouteDecision({
          chosenRoute: 'duplicate_ignored',
        })
      );
      return;
    }

    if (
      promptLockRef.current &&
      (!settings.allowInterruptions || !actionQueueRef.current.isBusy())
    ) {
      logRouteDecision(
        buildRouteDecision({
          chosenRoute: 'busy',
        })
      );
      updateStatusPanel(
        'Busy',
        'Jarvis is still finishing the previous request. Please wait a moment.',
        'pending'
      );
      return;
    }

    promptLockRef.current = true;
    lastAcceptedPromptRef.current = {
      fingerprint,
      at: now,
    };

    try {
      setRecognizedText(trimmedPrompt);
      appendConversationEntry(
        'user',
        source === 'voice' ? 'Voice Transcript' : 'You',
        trimmedPrompt,
        'user'
      );

      if (pendingRequest) {
        if (detectedControl === ACTION_CONTROL_TYPES.CONFIRM) {
          logRouteDecision(
            buildRouteDecision({
              chosenRoute: 'confirmation',
              parserMatched: true,
              pendingActionId: pendingRequest.actions[0]?.id || null,
            })
          );
          await handleControlAction({
            target: { control: ACTION_CONTROL_TYPES.CONFIRM },
          });
          return;
        }

        if (
          detectedControl === ACTION_CONTROL_TYPES.CANCEL ||
          detectedControl === ACTION_CONTROL_TYPES.INTERRUPT
        ) {
          logRouteDecision(
            buildRouteDecision({
              chosenRoute: 'cancel',
              parserMatched: true,
              pendingActionId: pendingRequest.actions[0]?.id || null,
            })
          );
          await handleControlAction({
            target: { control: detectedControl },
          });
          return;
        }

        logRouteDecision(
          buildRouteDecision({
            chosenRoute: 'confirmation',
            pendingActionId: pendingRequest.actions[0]?.id || null,
          })
        );
        updateStatusPanel(
          'Confirmation',
          'Please say yes to confirm or cancel to stop.',
          'pending'
        );
        await deliverAssistantMessage(
          'Jarvis',
          'Please say yes to confirm or cancel to stop.',
          'pending'
        );
        return;
      }

      if (
        detectedControl === ACTION_CONTROL_TYPES.CANCEL ||
        detectedControl === ACTION_CONTROL_TYPES.INTERRUPT
      ) {
        logRouteDecision(
          buildRouteDecision({
            chosenRoute: 'cancel',
            parserMatched: true,
          })
        );
        await handleControlAction({
          target: { control: detectedControl },
        });
        return;
      }

      if (detectedControl === ACTION_CONTROL_TYPES.CONFIRM) {
        logRouteDecision(
          buildRouteDecision({
            chosenRoute: 'confirmation',
            parserMatched: true,
          })
        );
        await handleControlAction({
          target: { control: ACTION_CONTROL_TYPES.CONFIRM },
        });
        return;
      }

      const parsedResult = parsePromptToActions(trimmedPrompt, source);
      const parsedActions = parsedResult.actions || [];
      const controlAction = getSingleControlAction(parsedActions);
      const localActions = parsedActions.filter(
        (action) => action.type !== ACTION_TYPES.AI_QUERY
      );
      const aiActions = parsedActions.filter(
        (action) => action.type === ACTION_TYPES.AI_QUERY
      );
      const parsedActionsPayload = serializeRouteActions(parsedActions);

      if (parsedResult.kind === 'empty') {
        logRouteDecision(
          buildRouteDecision({
            chosenRoute: 'empty',
          })
        );
        return;
      }

      if (
        parsedResult.kind === 'clarify' ||
        parsedResult.kind === 'device_not_found'
      ) {
        const panelLabel =
          parsedResult.kind === 'device_not_found' ? 'Error' : 'Clarify';
        const panelTone =
          parsedResult.kind === 'device_not_found' ? 'error' : 'pending';

        logRouteDecision(
          buildRouteDecision({
            parserMatched: true,
            parsedActionsCount: parsedActions.length,
            parsedActionsPayload,
            validationRejectedCount: 1,
            chosenRoute: 'automation',
            reason: parsedResult.message,
          })
        );
        updateStatusPanel(panelLabel, parsedResult.message, panelTone);
        await deliverAssistantMessage('Jarvis', parsedResult.message, panelTone);
        return;
      }

      if (controlAction) {
        logRouteDecision(
          buildRouteDecision({
            parserMatched: true,
            parsedActionsCount: parsedActions.length,
            parsedActionsPayload,
            chosenRoute:
              controlAction.target.control === ACTION_CONTROL_TYPES.CONFIRM
                ? 'confirmation'
                : 'cancel',
          })
        );
        await handleControlAction(controlAction);
        return;
      }

      if (localActions.length) {
        const validation = validateActionBatch(localActions);
        const acceptedLocalActions = validation.results
          .filter((entry) => entry.validation.ok)
          .map((entry) => entry.action);
        const rejectedLocalActions = validation.failures;

        if (!acceptedLocalActions.length) {
          const validationMessage =
            rejectedLocalActions[0]?.validation?.errors?.[0] ||
            'Action validation failed.';

          logRouteDecision(
            buildRouteDecision({
              parserMatched: true,
              parsedActionsCount: parsedActions.length,
              parsedActionsPayload,
              validationAcceptedCount: 0,
              validationRejectedCount: rejectedLocalActions.length,
              chosenRoute: 'automation',
              reason: validationMessage,
            })
          );
          updateStatusPanel('Validation', validationMessage, 'error');
          await deliverAssistantMessage('Jarvis', validationMessage, 'error');
          return;
        }

        if (actionQueueRef.current.isBusy()) {
          if (!settings.allowInterruptions) {
            updateStatusPanel(
              'Busy',
              'Jarvis is still finishing the previous request. Please wait a moment.',
              'pending'
            );
            return;
          }

          actionQueueRef.current.interrupt('Interrupted by a new request.');
          stopSpeechOutput();
          updateStatusPanel(
            'Queue',
            'Interrupting the previous request before starting the new one.',
            'pending'
          );
          await waitForActionQueueToSettle();
        }

        const riskyActions = acceptedLocalActions.filter(
          (action) =>
            action.requiresConfirmation && settings.requireDangerousConfirmation
        );

        if (riskyActions.length) {
          const confirmationSummary = summarizeActionPlan(acceptedLocalActions);
          const nextPendingRequest = confirmationMachineRef.current.set({
            prompt: trimmedPrompt,
            source,
            actions: acceptedLocalActions,
            summary: confirmationSummary,
          });

          logRouteDecision(
            buildRouteDecision({
              parserMatched: true,
              parsedActionsCount: parsedActions.length,
              parsedActionsPayload,
              validationAcceptedCount: acceptedLocalActions.length,
              validationRejectedCount: rejectedLocalActions.length,
              chosenRoute: 'confirmation',
              pendingActionId: nextPendingRequest.actions[0]?.id || null,
            })
          );
          setPendingConfirmation(nextPendingRequest);
          updateStatusPanel(
            'Confirmation',
            `Are you sure you want me to ${toSentenceCase(confirmationSummary)}? Say yes to confirm or cancel to stop.`,
            'pending'
          );
          await deliverAssistantMessage(
            'Jarvis',
            `Are you sure you want me to ${toSentenceCase(confirmationSummary)}? Say yes to confirm or cancel to stop.`,
            'pending'
          );
          return;
        }

        logRouteDecision(
          buildRouteDecision({
            parserMatched: true,
            parsedActionsCount: parsedActions.length,
            parsedActionsPayload,
            validationAcceptedCount: acceptedLocalActions.length,
            validationRejectedCount: rejectedLocalActions.length,
            chosenRoute: 'automation',
            fallbackToAI: false,
          })
        );
        stopSpeechOutput();

        if (recognitionRef.current && recognitionActiveRef.current) {
          try {
            recognitionRef.current.stop();
          } catch (error) {
            // Ignore stop failures from repeated toggles.
          }
        }

        await runActionPlan(acceptedLocalActions, trimmedPrompt, source);
        return;
      }

      const validation = validateActionBatch(aiActions);

      if (!validation.ok) {
        const validationMessage =
          validation.failures[0]?.validation?.errors?.[0] ||
          'Action validation failed.';
        logRouteDecision(
          buildRouteDecision({
            parsedActionsCount: parsedActions.length,
            parsedActionsPayload,
            validationAcceptedCount: 0,
            validationRejectedCount: validation.failures.length,
            chosenRoute: 'ai',
            fallbackToAI: false,
            reason: validationMessage,
          })
        );
        updateStatusPanel('Validation', validationMessage, 'error');
        await deliverAssistantMessage('Jarvis', validationMessage, 'error');
        return;
      }

      if (actionQueueRef.current.isBusy()) {
        if (!settings.allowInterruptions) {
          updateStatusPanel(
            'Busy',
            'Jarvis is still finishing the previous request. Please wait a moment.',
            'pending'
          );
          return;
        }

        actionQueueRef.current.interrupt('Interrupted by a new request.');
        stopSpeechOutput();
        updateStatusPanel(
          'Queue',
          'Interrupting the previous request before starting the new one.',
          'pending'
        );
        await waitForActionQueueToSettle();
      }

      logRouteDecision(
        buildRouteDecision({
          parserMatched: false,
          parsedActionsCount: parsedActions.length,
          parsedActionsPayload,
          validationAcceptedCount: aiActions.length,
          validationRejectedCount: 0,
          chosenRoute: 'ai',
          fallbackToAI: true,
        })
      );
      stopSpeechOutput();

      if (recognitionRef.current && recognitionActiveRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (error) {
          // Ignore stop failures from repeated toggles.
        }
      }

      await runActionPlan(aiActions, trimmedPrompt, source);
    } finally {
      promptLockRef.current = false;
    }
  };

  appendConversationEntryRef.current = appendConversationEntry;
  processPromptRef.current = processPrompt;

  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  useEffect(() => {
    [desktopChatScrollRef.current, mobileChatScrollRef.current].forEach(
      (chatNode) => {
        if (!chatNode) {
          return;
        }

        chatNode.scrollTop = chatNode.scrollHeight;
      }
    );
  }, [conversation, recognizedText]);

  useEffect(() => {
    let isActive = true;
    const nextSessionId = getOrCreateSessionId();
    currentSessionIdRef.current = nextSessionId;

    const hydrateSettingsAndSession = async () => {
      try {
        const settingsSnapshot = await loadSettingsSnapshot(
          initialAiEndpointRef.current
        );

        if (isActive) {
          applySettingsSnapshot(settingsSnapshot.settings);
          setSettingsSyncState({
            hydrated: true,
            saving: false,
            error: '',
          });
        }
      } catch (error) {
        if (isActive) {
          setSettingsSyncState({
            hydrated: true,
            saving: false,
            error: error.message || 'Settings backend unavailable.',
          });
        }
      }

      try {
        const inventory = await registerClientSession(
          resolveSettingsApiUrl(initialAiEndpointRef.current),
          nextSessionId,
          buildClientSessionMetadata()
        );

        if (isActive) {
          applySessionInventorySnapshot(inventory);
        }
      } catch (error) {
        if (isActive) {
          setSessionInventory({
            currentSessionId: nextSessionId,
            sessions: [],
            loading: false,
            saving: false,
            error: error.message || 'Device session inventory is unavailable.',
          });
        }
      }
    };

    hydrateSettingsAndSession();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    writeAutomationSettings(settings);
  }, [settings]);

  useEffect(() => {
    writeActionLogs(actionLogs);
  }, [actionLogs]);

  useEffect(() => {
    if (!settingsSyncState.hydrated) {
      return undefined;
    }

    if (skipNextSettingsSyncRef.current) {
      skipNextSettingsSyncRef.current = false;
      return undefined;
    }

    const patch = pendingSettingsPatchRef.current;

    if (!patch) {
      return undefined;
    }

    let isActive = true;
    pendingSettingsPatchRef.current = null;
    setSettingsSyncState((currentState) => ({
      ...currentState,
      saving: true,
      error: '',
    }));

    patchSettingsSnapshot(aiEndpoint, patch)
      .then((snapshot) => {
        if (!isActive) {
          return;
        }

        applySettingsSnapshot(snapshot.settings);
        setSettingsSyncState({
          hydrated: true,
          saving: false,
          error: '',
        });
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        setSettingsSyncState((currentState) => ({
          ...currentState,
          saving: false,
          error: error.message || 'Settings sync failed.',
        }));
      });

    return () => {
      isActive = false;
    };
  }, [aiEndpoint, settings, settingsSyncState.hydrated]);

  useEffect(() => {
    setAiStatus((currentStatus) =>
      !aiEndpoint.trim()
        ? 'not_configured'
        : currentStatus === 'connected'
          ? 'connected'
          : 'configured'
    );
  }, [aiEndpoint]);

  useEffect(() => {
    transportRef.current?.disconnect?.();

    const nextTransport = createEsp32Transport({
      useMockDevices: settings.useMockDevices,
      transport: transportProtocol,
      httpEndpoint,
      websocketEndpoint,
      timeoutMs: 4500,
      retryCount: 1,
      mockDeviceLatencyMs: settings.mockDeviceLatencyMs,
      onHealthChange: setConnectionStatus,
      onFeedback: (feedback) =>
        transportFeedbackHandlerRef.current(feedback, null, 'ESP32', {
          setSpeaking: true,
          tone: 'success',
          speak: true,
        }),
    });

    transportRef.current = nextTransport;
    setConnectionStatus(nextTransport.getHealth());

    return () => {
      nextTransport.disconnect?.();
    };
  }, [
    settings.useMockDevices,
    settings.mockDeviceLatencyMs,
    transportProtocol,
    httpEndpoint,
    websocketEndpoint,
  ]);

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.speechSynthesis &&
      typeof window.SpeechSynthesisUtterance !== 'undefined'
    ) {
      setTtsSupported(true);
      return;
    }

    setTtsSupported(false);
    setSpeechOutputEnabled(false);
  }, []);

  useEffect(() => {
    if (!currentSessionIdRef.current) {
      return undefined;
    }

    let isActive = true;

    const refreshInventory = async () => {
      try {
        const inventory = await registerClientSession(
          resolveSettingsApiUrl(aiEndpoint),
          currentSessionIdRef.current,
          buildClientSessionMetadata()
        );

        if (isActive) {
          applySessionInventorySnapshot(inventory);
        }
      } catch (error) {
        if (isActive) {
          setSessionInventory((currentInventory) => ({
            ...currentInventory,
            loading: false,
            saving: false,
            error: error.message || 'Session inventory refresh failed.',
          }));
        }
      }
    };

    const heartbeatId = window.setInterval(refreshInventory, 60000);

    return () => {
      isActive = false;
      window.clearInterval(heartbeatId);
    };
  }, [aiEndpoint]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const SpeechRecognition =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      updateStatusPanel(
        'Voice',
        'Web Speech API is unavailable in this browser. Voice commands need a supported browser.',
        'error'
      );
      return undefined;
    }

    setSpeechSupported(true);

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      recognitionActiveRef.current = true;
      lastAcceptedPromptRef.current = {
        fingerprint: '',
        at: 0,
      };
      setRecognizedText('');
      setActivity('listening');
      updateStatusPanel(
        'Voice',
        'Listening live. Begin with "Hey Jarvis" and then say your request.',
        'pending'
      );
    };

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript || '';

        if (event.results[index].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      const combinedTranscript = `${finalTranscript} ${interimTranscript}`.trim();

      if (combinedTranscript) {
        setRecognizedText(combinedTranscript);
      }

      if (finalTranscript.trim()) {
        processPromptRef.current(finalTranscript.trim(), 'voice');
      }
    };

    recognition.onerror = (event) => {
      recognitionActiveRef.current = false;

      if (event.error === 'no-speech') {
        setRecognizedText('');
        updateStatusPanel(
          'Voice',
          'No speech was detected. Begin with "Hey Jarvis" when you are ready.',
          'pending'
        );

        if (activityRef.current === 'listening') {
          setActivity('idle');
        }

        return;
      }

      const errorMessage = buildVoiceErrorMessage(event.error);

      if (
        event.error === 'not-allowed' ||
        event.error === 'service-not-allowed'
      ) {
        setVoiceEnabled(false);
      }

      setRecognizedText('');
      appendConversationEntryRef.current(
        'assistant',
        'Jarvis',
        errorMessage,
        'error'
      );
      updateStatusPanel('Voice', errorMessage, 'error');

      if (activityRef.current === 'listening') {
        setActivity('idle');
      }
    };

    recognition.onend = () => {
      recognitionActiveRef.current = false;

      if (activityRef.current === 'listening') {
        setActivity('idle');
      }
    };

    recognitionRef.current = recognition;

    return () => {
      clearQueuedTimeouts();
      clearStreamAnimation();
      transportRef.current?.disconnect?.();
      cancelSpeechSynthesis();

      if (recognitionRef.current) {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;

        try {
          recognitionRef.current.stop();
        } catch (error) {
          // Ignore cleanup stop failures.
        }
      }

      recognitionRef.current = null;
      recognitionActiveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!voiceEnabled) {
      if (recognitionRef.current && recognitionActiveRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (error) {
          // Ignore stop failures from fast button presses.
        }
      }

      return;
    }

    if (!speechSupported || !recognitionRef.current) {
      return;
    }

    if (activity !== 'idle' || recognitionActiveRef.current) {
      return;
    }

    try {
      recognitionRef.current.start();
    } catch (error) {
      updateStatusPanel(
        'Voice',
        'Voice recognition could not start. Check microphone permissions and try again.',
        'error'
      );
      setVoiceEnabled(false);
    }
  }, [activity, speechSupported, voiceEnabled]);

  useEffect(() => {
    if (!adminPanelOpen || typeof window === 'undefined') {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setAdminPanelOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [adminPanelOpen]);

  useEffect(() => {
    if (!adminPanelOpen || !currentSessionIdRef.current) {
      return undefined;
    }

    let isActive = true;

    loadSessionInventory(aiEndpoint, currentSessionIdRef.current)
      .then((inventory) => {
        if (isActive) {
          applySessionInventorySnapshot(inventory);
        }
      })
      .catch((error) => {
        if (isActive) {
          setSessionInventory((currentInventory) => ({
            ...currentInventory,
            loading: false,
            saving: false,
            error: error.message || 'Failed to load session inventory.',
          }));
        }
      });

    return () => {
      isActive = false;
    };
  }, [adminPanelOpen, aiEndpoint]);

  const handleVoiceToggle = () => {
    if (!speechSupported) {
      updateStatusPanel(
        'Voice',
        'Voice recognition is unsupported in this browser.',
        'error'
      );
      return;
    }

    setVoiceEnabled((currentValue) => !currentValue);
  };

  const handleSpeechToggle = () => {
    if (!ttsSupported) {
      return;
    }

    setSpeechOutputEnabled((currentValue) => {
      const nextValue = !currentValue;

      if (!nextValue) {
        cancelSpeechSynthesis();
      }

      return nextValue;
    });
  };

  const handleSettingInputChange = (field) => (event) => {
    updateSettings({
      [field]: event.target.value,
    });
  };

  const handleNumericSettingChange = (field, minimum = 0) => (event) => {
    const parsedValue = Number(event.target.value);

    updateSettings({
      [field]: Number.isFinite(parsedValue)
        ? Math.max(minimum, parsedValue)
        : minimum,
    });
  };

  const handleBooleanSettingToggle = (field) => {
    updateSettings({
      [field]: !settings[field],
    });
  };

  const handleLaptopPermissionToggle = (permissionKey) => {
    updateSettings({
      laptopPermissions: {
        [permissionKey]: !settings.laptopPermissions[permissionKey],
      },
    });
  };

  const handleClearActionLogs = () => {
    setActionLogs([]);
  };

  const handleRevokeSession = async (sessionId) => {
    if (!sessionId || !currentSessionIdRef.current) {
      return;
    }

    setSessionInventory((currentInventory) => ({
      ...currentInventory,
      saving: true,
      error: '',
    }));

    try {
      const inventory = await revokeSession(
        aiEndpoint,
        currentSessionIdRef.current,
        sessionId
      );

      applySessionInventorySnapshot(inventory);
      appendActionLog({
        type: 'session_revoke',
        summary: `Revoke session ${sessionId}`,
        status: ACTION_RESULT_STATUS.SUCCESS,
        message: 'Session access was revoked.',
      });
    } catch (error) {
      setSessionInventory((currentInventory) => ({
        ...currentInventory,
        saving: false,
        error: error.message || 'Failed to revoke the selected session.',
      }));
    }
  };

  const handleRevokeOtherSessions = async () => {
    if (!currentSessionIdRef.current) {
      return;
    }

    setSessionInventory((currentInventory) => ({
      ...currentInventory,
      saving: true,
      error: '',
    }));

    try {
      const inventory = await revokeOtherSessions(
        aiEndpoint,
        currentSessionIdRef.current
      );

      applySessionInventorySnapshot(inventory);
      appendActionLog({
        type: 'session_revoke_others',
        summary: 'Revoke all other sessions',
        status: ACTION_RESULT_STATUS.SUCCESS,
        message: 'All other active sessions were revoked.',
      });
    } catch (error) {
      setSessionInventory((currentInventory) => ({
        ...currentInventory,
        saving: false,
        error: error.message || 'Failed to revoke other sessions.',
      }));
    }
  };

  const handleTransportTest = async () => {
    const transport = transportRef.current;

    if (!transport) {
      updateStatusPanel('ESP32', 'Device transport is unavailable.', 'error');
      return;
    }

    try {
      updateStatusPanel('ESP32', 'Testing the active device transport.', 'pending');
      const result = await transport.testConnection();
      appendActionLog({
        type: 'device_test',
        summary: 'Test device transport',
        status: result.status,
        message: result.message,
      });
      await deliverAssistantMessage('Jarvis', result.message, 'success', {
        speak: false,
      });
    } catch (error) {
      appendActionLog({
        type: 'device_test',
        summary: 'Test device transport',
        status: ACTION_RESULT_STATUS.ERROR,
        message: error.message || 'Transport test failed.',
      });
      updateStatusPanel('ESP32', error.message || 'Transport test failed.', 'error');
    }
  };

  const handleAdminPrompt = async (prompt) => {
    await processPromptRef.current(prompt, 'typed');
  };

  const controlsDisabled = activity === 'thinking';
  const connectionCopy = getConnectionCopy(
    transportProtocol,
    connectionStatus,
    settings.useMockDevices
  );
  const aiConnectionCopy = getAiConnectionCopy(aiStatus);
  const voiceButtonLabel = !speechSupported
    ? 'Voice Unsupported'
    : voiceEnabled
      ? 'Stop Jarvis'
      : 'Start Jarvis';
  const speechButtonLabel = !ttsSupported
    ? 'Speech Unavailable'
    : speechOutputEnabled
      ? 'Mute'
      : 'Unmute';
  const liveTranscriptVisible = Boolean(recognizedText) && activity === 'listening';
  const chatHasMessages = conversation.length > 0 || liveTranscriptVisible;
  const chatPanelStatus = liveTranscriptVisible
    ? 'Live'
    : conversation.length
      ? 'Active'
      : 'Ready';
  const chatPanelToggleLabel = chatPanelOpen ? 'Hide AI Chat' : 'Show AI Chat';
  const queueStatusCopy = queueSnapshot.busy
    ? `Running: ${queueSnapshot.currentSummary || 'action queue'}`
    : queueSnapshot.lastRunStatus === 'idle'
      ? 'Idle'
      : queueSnapshot.lastRunStatus;
  const settingsApiUrl = resolveSettingsApiUrl(aiEndpoint);
  const pendingConfirmationCopy = pendingConfirmation
    ? pendingConfirmation.summary
    : 'No action is waiting for confirmation.';
  const currentSessionRecord =
    sessionInventory.sessions.find((session) => session.isCurrent) || null;
  const otherActiveSessions = sessionInventory.sessions.filter(
    (session) => !session.isCurrent
  );
  const adminIssues = [];

  if (!speechSupported) {
    adminIssues.push({
      tone: 'error',
      title: 'Voice Input Unsupported',
      message:
        'This browser does not expose the Web Speech API, so voice commands will not work here.',
    });
  }

  if (!ttsSupported) {
    adminIssues.push({
      tone: 'pending',
      title: 'Voice Replies Limited',
      message:
        'Browser speech synthesis is unavailable, so Jarvis can only write responses on screen.',
    });
  }

  if (!aiEndpoint.trim()) {
    adminIssues.push({
      tone: 'error',
      title: 'AI Backend Missing',
      message:
        'General questions will stay on local fallback replies until the backend URL is configured.',
    });
  } else if (aiStatus === 'error') {
    adminIssues.push({
      tone: 'error',
      title: 'AI Backend Error',
      message:
        'The backend is configured but the last AI request failed. Check the server, model access, and API credentials.',
    });
  } else if (aiStatus === 'configured') {
    adminIssues.push({
      tone: 'pending',
      title: 'AI Backend Not Yet Verified',
      message:
        'The endpoint exists, but a successful live request is still needed before calling it production-ready.',
    });
  }

  if (transportProtocol === 'http' && !httpEndpoint.trim()) {
    adminIssues.push({
      tone: 'pending',
      title: 'HTTP Endpoint Missing',
      message:
        'HTTP device control is selected, but no ESP32 HTTP URL is configured.',
    });
  }

  if (transportProtocol === 'websocket' && !websocketEndpoint.trim()) {
    adminIssues.push({
      tone: 'pending',
      title: 'WebSocket Endpoint Missing',
      message:
        'WebSocket device control is selected, but no ESP32 socket URL is configured.',
    });
  }

  if (connectionStatus === 'error') {
    adminIssues.push({
      tone: 'error',
      title: 'Device Transport Error',
      message:
        'Jarvis could not reach the ESP32 path. Check Wi-Fi, endpoint address, and firmware.',
    });
  } else if (connectionStatus === 'disconnected') {
    adminIssues.push({
      tone: 'pending',
      title: 'Live Feedback Paused',
      message:
        'The WebSocket is configured but currently disconnected, so live relay feedback is paused.',
    });
  }

  if (pendingConfirmation) {
    adminIssues.push({
      tone: 'pending',
      title: 'Pending Confirmation',
      message: `Jarvis is waiting for confirmation before it can ${pendingConfirmation.summary}.`,
    });
  }

  if (settingsSyncState.error) {
    adminIssues.push({
      tone: 'error',
      title: 'Settings Sync Error',
      message: settingsSyncState.error,
    });
  }

  if (sessionInventory.error) {
    adminIssues.push({
      tone: 'error',
      title: 'Session Inventory Error',
      message: sessionInventory.error,
    });
  }

  if (!adminIssues.length) {
    adminIssues.push({
      tone: 'success',
      title: 'No Active Blockers',
      message:
        'Voice, AI, and transport paths are in a healthy state for the current session.',
    });
  }

  const adminSettings = [
    ['Wake Word', 'Hey Jarvis'],
    ['AI Endpoint', aiEndpoint.trim() || 'Not configured'],
    ['AI Status', aiConnectionCopy],
    ['Transport Mode', transportProtocol.toUpperCase()],
    ['HTTP Endpoint', httpEndpoint.trim() || 'Not configured'],
    ['WebSocket Endpoint', websocketEndpoint.trim() || 'Not configured'],
    ['Device Link', connectionCopy],
    ['Mic Support', speechSupported ? 'Available' : 'Unavailable'],
    ['Voice Capture', voiceEnabled ? 'Enabled' : 'Paused'],
    ['Speech Output', ttsSupported ? (speechOutputEnabled ? 'Enabled' : 'Muted') : 'Unavailable'],
    ['Current Activity', activity],
    ['Action Queue', queueStatusCopy],
    ['Pending Confirmation', pendingConfirmationCopy],
    ['Settings API', settingsApiUrl],
    ['Settings Sync', settingsSyncState.saving ? 'Saving' : settingsSyncState.hydrated ? 'Synced' : 'Loading'],
    ['Current Session', currentSessionRecord?.label || currentSessionIdRef.current || 'Loading'],
    ['Other Active Sessions', String(otherActiveSessions.length)],
    ['Status Panel', `${statusPanel.label}: ${statusPanel.message}`],
    ['Last Transcript', recognizedText || 'No transcript captured yet'],
    ['Current Reply', liveReply.message || 'No active reply'],
  ];

  const adminStatusCards = [
    {
      label: 'AI Backend',
      value: aiConnectionCopy,
      detail: aiEndpoint.trim() || 'No endpoint configured',
    },
    {
      label: 'Device Transport',
      value: connectionCopy,
      detail: settings.useMockDevices
        ? 'Mock ESP32 layer is active.'
        : transportProtocol === 'http'
          ? httpEndpoint.trim() || 'No HTTP endpoint configured'
          : websocketEndpoint.trim() || 'No WebSocket endpoint configured',
    },
    {
      label: 'Execution Queue',
      value: queueStatusCopy,
      detail: queueSnapshot.busy
        ? 'Jarvis is currently working through a structured action run.'
        : 'No actions are executing right now.',
    },
    {
      label: 'Confirmation',
      value: pendingConfirmation ? 'Waiting for confirmation' : 'Clear',
      detail: pendingConfirmationCopy,
    },
    {
      label: 'Session Inventory',
      value: currentSessionRecord ? currentSessionRecord.label : 'Loading session data',
      detail: otherActiveSessions.length
        ? `${otherActiveSessions.length} other active session(s) detected.`
        : 'No other active sessions are currently registered.',
    },
  ];

  const adminQuickActions = [
    {
      label: 'Test Device Link',
      onClick: handleTransportTest,
      variant: 'primary',
    },
    {
      label: 'Ask AI Test',
      onClick: () => handleAdminPrompt('What can you do?'),
      variant: 'secondary',
    },
    {
      label: 'Mock Fan On',
      onClick: () => handleAdminPrompt('Turn on the living room fan'),
      variant: 'secondary',
    },
    {
      label: 'Multi-Action Test',
      onClick: () => handleAdminPrompt('Turn on the fan and open chrome'),
      variant: 'secondary',
    },
  ];

  if (pendingConfirmation) {
    adminQuickActions.push({
      label: 'Confirm Pending',
      onClick: () => handleAdminPrompt('confirm'),
      variant: 'primary',
    });
  }

  if (pendingConfirmation || queueSnapshot.busy) {
    adminQuickActions.push({
      label: pendingConfirmation ? 'Cancel Pending' : 'Cancel Queue',
      onClick: () => handleAdminPrompt('cancel'),
      variant: 'danger',
    });
  }

  if (queueSnapshot.busy && settings.allowInterruptions) {
    adminQuickActions.push({
      label: 'Interrupt Queue',
      onClick: () => handleAdminPrompt('interrupt'),
      variant: 'danger',
    });
  }

  const laptopPermissionSettings = [
    {
      key: 'allowPower',
      label: 'Allow Power Actions',
      description: 'Shutdown, restart, and sleep actions.',
    },
    {
      key: 'allowApps',
      label: 'Allow App Automation',
      description: 'Open and close supported desktop apps.',
    },
    {
      key: 'allowUrls',
      label: 'Allow URL Automation',
      description: 'Open approved web links from voice commands.',
    },
    {
      key: 'allowVolume',
      label: 'Allow Volume Actions',
      description: 'Mute, unmute, and volume adjustments.',
    },
  ];

  const automationSwitches = [
    {
      key: 'useMockDevices',
      label: 'Use Mock Devices',
      description: 'Run the ESP32 layer in safe simulation mode.',
    },
    {
      key: 'mockLaptopActions',
      label: 'Mock Laptop Actions',
      description: 'Simulate laptop automation instead of executing it on Windows.',
    },
    {
      key: 'requireDangerousConfirmation',
      label: 'Require Dangerous Confirmation',
      description: 'Hold risky actions until you explicitly confirm them.',
    },
    {
      key: 'allowInterruptions',
      label: 'Allow Interruptions',
      description: 'Let a new command interrupt the current queue.',
    },
  ];

  const adminProcedure = [
    'Start the backend first and confirm the AI endpoint returns JSON successfully.',
    'Open the frontend, allow microphone permission, then enable voice capture.',
    'Begin each spoken request with "Hey Jarvis" so the assistant knows to listen.',
    'Ask one general AI question to confirm backend reachability and spoken replies.',
    'Try one device command and confirm the ESP32 path responds or the socket connects.',
    'If anything fails, use the issues section in this panel before continuing live testing.',
  ];

  const adminMaintenance = [
    'Rotate leaked or shared API keys immediately and keep secrets only in local env files.',
    'Verify the ESP32 IP, socket path, and relay firmware whenever the network changes.',
    'Check microphone permission, default audio output, and browser speech support after browser updates.',
    'Review the current model and quota whenever AI replies start failing or slowing down.',
    'Run the frontend build and tests after UI or command-routing changes before real-world demos.',
  ];

  const adminTroubleshooting = [
    'If AI fails, test the backend directly at /api/ai/chat before blaming the frontend.',
    'If voice fails, confirm Web Speech API support and microphone permission in the current browser.',
    'If spoken replies fail, check browser speech synthesis support and whether replies are muted.',
    'If devices fail, confirm the selected transport matches the configured ESP32 endpoint.',
  ];

  return (
    <MantineProvider theme={theme}>
      <main className="relative min-h-screen overflow-hidden bg-[var(--app-bg)] text-slate-50">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-[-8rem] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-cyan-300/25 blur-3xl" />
          <div className="absolute left-[-6rem] top-1/3 h-80 w-80 rounded-full bg-sky-400/15 blur-3xl" />
          <div className="absolute bottom-[-10rem] right-[-6rem] h-[30rem] w-[30rem] rounded-full bg-teal-300/18 blur-3xl" />
        </div>

        <button
          type="button"
          onClick={() => setAdminPanelOpen(true)}
          className="absolute right-5 top-5 z-20 rounded-full border border-cyan-300/20 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-50 backdrop-blur transition duration-200 hover:border-cyan-200/40 hover:bg-slate-900/80 sm:right-8 sm:top-8"
        >
          Admin Panel
        </button>

        <button
          type="button"
          aria-label={chatPanelToggleLabel}
          title={chatPanelToggleLabel}
          onClick={() => setChatPanelOpen((currentValue) => !currentValue)}
          className="absolute right-0 top-1/2 z-20 hidden h-20 w-10 -translate-y-1/2 items-center justify-center rounded-l-[1.2rem] border border-r-0 border-cyan-300/20 bg-slate-950/78 text-xl font-bold text-cyan-50 backdrop-blur transition duration-200 hover:border-cyan-200/40 hover:bg-slate-900/90 lg:flex"
        >
          {chatPanelOpen ? '>' : '<'}
        </button>

        <div className="relative mx-auto h-screen max-w-7xl px-6 sm:px-10">
          <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
            <div className="flex flex-col items-center">
              <div className="rounded-full">
                <JarvisAvatar activity={activity} />
              </div>

              <div className="mt-10 flex items-center gap-3 sm:mt-12">
                <Button
                  type="button"
                  color="cyan"
                  variant={voiceEnabled ? 'filled' : 'light'}
                  onClick={handleVoiceToggle}
                  disabled={!speechSupported}
                  className="h-11 px-6 text-xs font-bold uppercase tracking-[0.2em]"
                >
                  {voiceEnabled ? 'Stop Jarvis' : 'Start Jarvis'}
                </Button>
                <Button
                  type="button"
                  color="cyan"
                  variant={speechOutputEnabled ? 'outline' : 'filled'}
                  onClick={handleSpeechToggle}
                  disabled={!ttsSupported || controlsDisabled}
                  className="h-11 px-6 text-xs font-bold uppercase tracking-[0.2em]"
                >
                  {speechOutputEnabled ? 'Mute' : 'Unmute'}
                </Button>
              </div>
            </div>
          </div>

          {chatPanelOpen ? (
            <aside className="absolute right-10 top-1/2 z-10 hidden w-[22rem] -translate-y-1/2 lg:block">
              <section className="h-[21rem] overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(2,12,20,0.96)_0%,rgba(8,20,32,0.9)_100%)] p-4 shadow-[0_30px_120px_-48px_rgba(34,211,238,0.5)] backdrop-blur">
                <div className="flex h-full flex-col">
                  <div className="mb-4 flex items-start justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/70">
                        AI Chat
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-300">
                        Live transcript and Jarvis replies will appear here.
                      </div>
                    </div>
                    <div
                      className={`rounded-full border px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] ${
                        liveTranscriptVisible
                          ? 'border-cyan-300/25 bg-cyan-300/12 text-cyan-50'
                          : conversation.length
                            ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-50'
                            : 'border-white/10 bg-white/5 text-slate-300'
                      }`}
                    >
                      {chatPanelStatus}
                    </div>
                  </div>

                  <div
                    ref={desktopChatScrollRef}
                    className="flex-1 overflow-y-auto pr-1 no-scrollbar"
                  >
                    {chatHasMessages ? (
                      <div className="flex min-h-full flex-col justify-end gap-3">
                        {conversation.map((entry) => (
                          <SpeechBubble
                            key={entry.id}
                            speaker={entry.speaker}
                            label={entry.label}
                            message={entry.message}
                            tone={entry.tone}
                            compact
                            streaming={entry.streaming}
                          />
                        ))}

                        {liveTranscriptVisible ? (
                          <SpeechBubble
                            speaker="user"
                            label="Voice To Text"
                            message={recognizedText}
                            compact
                            streaming
                          />
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex min-h-full items-center">
                        <div className="w-full rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5">
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-cyan-100/70">
                            Conversation Dock
                          </div>
                          <div className="mt-3 text-lg font-semibold text-white">
                            Jarvis chat will appear here
                          </div>
                          <div className="mt-3 text-sm leading-6 text-slate-300">
                            Start with the wake phrase, then your request. This
                            panel will show both your live voice transcript and
                            Jarvis replies.
                          </div>
                          <div className="mt-4 rounded-[1rem] border border-cyan-300/15 bg-slate-950/75 px-4 py-3 text-sm font-medium text-cyan-50">
                            Try: "Hey Jarvis, what's up?"
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </aside>
          ) : null}

          <div className="absolute bottom-4 left-1/2 z-10 w-[calc(100%-2rem)] max-w-[20rem] -translate-x-1/2 lg:hidden">
            <section className="h-[16rem] overflow-hidden rounded-[1.7rem] border border-white/10 bg-[linear-gradient(180deg,rgba(2,12,20,0.96)_0%,rgba(8,20,32,0.9)_100%)] p-4 shadow-[0_30px_120px_-48px_rgba(34,211,238,0.5)] backdrop-blur">
              <div className="flex h-full flex-col">
                <div className="mb-3 flex items-start justify-between gap-3 border-b border-white/10 pb-3">
                  <div>
                    <div className="text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                      AI Chat
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-300">
                      Transcript and replies appear here.
                    </div>
                  </div>
                  <div
                    className={`rounded-full border px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.2em] ${
                      liveTranscriptVisible
                        ? 'border-cyan-300/25 bg-cyan-300/12 text-cyan-50'
                        : conversation.length
                          ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-50'
                          : 'border-white/10 bg-white/5 text-slate-300'
                    }`}
                  >
                    {chatPanelStatus}
                  </div>
                </div>
                <div
                  ref={mobileChatScrollRef}
                  className="flex-1 overflow-y-auto pr-1 no-scrollbar"
                >
                  {chatHasMessages ? (
                    <div className="flex min-h-full flex-col justify-end gap-3">
                      {conversation.map((entry) => (
                        <SpeechBubble
                          key={entry.id}
                          speaker={entry.speaker}
                          label={entry.label}
                          message={entry.message}
                          tone={entry.tone}
                          compact
                          streaming={entry.streaming}
                        />
                      ))}

                      {liveTranscriptVisible ? (
                        <SpeechBubble
                          speaker="user"
                          label="Voice To Text"
                          message={recognizedText}
                          compact
                          streaming
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex min-h-full items-center">
                      <div className="w-full rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[0.64rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                          Conversation Dock
                        </div>
                        <div className="mt-2 text-base font-semibold text-white">
                          Jarvis chat will appear here
                        </div>
                        <div className="mt-2 text-sm leading-5 text-slate-300">
                          Say "Hey Jarvis" and your live transcript plus reply
                          will stream into this panel.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>

        {adminPanelOpen ? (
          <div className="absolute inset-0 z-30 flex items-start justify-end bg-slate-950/75 px-4 py-4 backdrop-blur-sm sm:px-6 sm:py-6">
            <div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/92 shadow-[0_30px_120px_-48px_rgba(34,211,238,0.55)] sm:max-h-[calc(100vh-3rem)]">
              <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-5 sm:px-6">
                <div>
                  <div className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-100/80">
                    Admin Panel
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    Operations, Health, And Maintenance
                  </div>
                  <div className="mt-3 text-sm leading-6 text-slate-300">
                    Everything needed to understand the current system state, known blockers, backend setup, and operating procedure.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAdminPanelOpen(false)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-200 transition duration-200 hover:border-white/20 hover:bg-white/10"
                >
                  Close
                </button>
              </div>

              <div className="max-h-[calc(100vh-9rem)] overflow-y-auto px-5 py-5 sm:max-h-[calc(100vh-10rem)] sm:px-6">
                <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5">
                    <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/75">
                      Current Status
                    </div>
                    <div className="mt-3 text-xl font-semibold text-white">
                      {statusPanel.label}
                    </div>
                    <div className="mt-3 text-sm leading-7 text-slate-300">
                      {statusPanel.message}
                    </div>
                  </div>

                  <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5">
                    <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/75">
                      Session Snapshot
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Button
                        type="button"
                        color="cyan"
                        variant={voiceEnabled ? 'filled' : 'light'}
                        onClick={handleVoiceToggle}
                        disabled={!speechSupported}
                        className="h-12 text-sm font-bold tracking-[0.18em]"
                      >
                        {voiceButtonLabel}
                      </Button>
                      <Button
                        type="button"
                        color="cyan"
                        variant={speechOutputEnabled ? 'filled' : 'outline'}
                        onClick={handleSpeechToggle}
                        disabled={!ttsSupported || controlsDisabled}
                        className="h-12 text-sm font-bold tracking-[0.18em]"
                      >
                        {speechButtonLabel}
                      </Button>
                    </div>
                    <div className="mt-4 grid gap-3">
                      {adminSettings.slice(0, 4).map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-[1.1rem] border border-white/10 bg-slate-950/55 px-4 py-3"
                        >
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                            {label}
                          </div>
                          <div className="mt-2 text-sm leading-6 text-slate-200">
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="mt-6">
                  <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/75">
                    System Status
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {adminStatusCards.map((card) => (
                      <div
                        key={card.label}
                        className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5"
                      >
                        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                          {card.label}
                        </div>
                        <div className="mt-3 text-lg font-semibold text-white">
                          {card.value}
                        </div>
                        <div className="mt-3 break-words text-sm leading-6 text-slate-300">
                          {card.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="mt-6">
                  <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/75">
                    Problems And Issues
                  </div>
                  <div className="mt-4 grid gap-3">
                    {adminIssues.map((issue) => (
                      <div
                        key={issue.title}
                        className={`rounded-[1.4rem] border px-4 py-4 ${
                          issue.tone === 'success'
                            ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-50'
                            : issue.tone === 'pending'
                              ? 'border-amber-300/20 bg-amber-500/10 text-amber-50'
                              : 'border-rose-300/20 bg-rose-500/10 text-rose-50'
                        }`}
                      >
                        <div className="text-sm font-semibold uppercase tracking-[0.22em]">
                          {issue.title}
                        </div>
                        <div className="mt-2 text-sm leading-6">
                          {issue.message}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                  <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5">
                    <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/75">
                      System Controls
                    </div>
                    <div className="mt-4 space-y-6">
                      <div>
                        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                          Endpoint Configuration
                        </div>
                        <div className="mt-3 space-y-3">
                          <label className="block">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                              AI Endpoint
                            </span>
                            <input
                              type="text"
                              value={settings.aiEndpoint}
                              onChange={handleSettingInputChange('aiEndpoint')}
                              className="mt-2 w-full rounded-[1rem] border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                              placeholder="http://localhost:3001/api/ai/chat"
                            />
                          </label>

                          <div className="grid gap-3 md:grid-cols-[0.8fr_1fr]">
                            <label className="block">
                              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                                Real Transport
                              </span>
                              <select
                                value={settings.deviceTransport}
                                onChange={handleSettingInputChange('deviceTransport')}
                                className="mt-2 w-full rounded-[1rem] border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                              >
                                <option value="http">HTTP</option>
                                <option value="websocket">WebSocket</option>
                              </select>
                            </label>

                            <label className="block">
                              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                                Mock Device Latency (ms)
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="50"
                                value={settings.mockDeviceLatencyMs}
                                onChange={handleNumericSettingChange('mockDeviceLatencyMs', 0)}
                                className="mt-2 w-full rounded-[1rem] border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                              />
                            </label>
                          </div>

                          <label className="block">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                              ESP32 HTTP Endpoint
                            </span>
                            <input
                              type="text"
                              value={settings.httpEndpoint}
                              onChange={handleSettingInputChange('httpEndpoint')}
                              className="mt-2 w-full rounded-[1rem] border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                              placeholder="http://192.168.x.x/command"
                            />
                          </label>

                          <label className="block">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                              ESP32 WebSocket Endpoint
                            </span>
                            <input
                              type="text"
                              value={settings.websocketEndpoint}
                              onChange={handleSettingInputChange('websocketEndpoint')}
                              className="mt-2 w-full rounded-[1rem] border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                              placeholder="ws://192.168.x.x:81"
                            />
                          </label>
                        </div>
                      </div>

                      <div>
                        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                          Safety And Behavior
                        </div>
                        <div className="mt-3 grid gap-3">
                          {automationSwitches.map((item) => (
                            <label
                              key={item.key}
                              className="flex items-start justify-between gap-4 rounded-[1.15rem] border border-white/10 bg-slate-950/55 px-4 py-4"
                            >
                              <div>
                                <div className="text-sm font-semibold text-white">
                                  {item.label}
                                </div>
                                <div className="mt-1 text-sm leading-6 text-slate-300">
                                  {item.description}
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={settings[item.key]}
                                onChange={() => handleBooleanSettingToggle(item.key)}
                                className="mt-1 h-5 w-5 rounded border-white/20 bg-slate-900 text-cyan-400"
                              />
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                          Laptop Permissions
                        </div>
                        <div className="mt-3 grid gap-3">
                          {laptopPermissionSettings.map((item) => (
                            <label
                              key={item.key}
                              className="flex items-start justify-between gap-4 rounded-[1.15rem] border border-white/10 bg-slate-950/55 px-4 py-4"
                            >
                              <div>
                                <div className="text-sm font-semibold text-white">
                                  {item.label}
                                </div>
                                <div className="mt-1 text-sm leading-6 text-slate-300">
                                  {item.description}
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={settings.laptopPermissions[item.key]}
                                onChange={() => handleLaptopPermissionToggle(item.key)}
                                className="mt-1 h-5 w-5 rounded border-white/20 bg-slate-900 text-cyan-400"
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/75">
                          Device Tests And Quick Actions
                        </div>
                        <div className="rounded-full border border-white/10 bg-slate-950/55 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-300">
                          {settings.useMockDevices ? 'Mock Path' : 'Live Path'}
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {adminQuickActions.map((action) => (
                          <button
                            key={action.label}
                            type="button"
                            onClick={action.onClick}
                            className={`rounded-[1.1rem] border px-4 py-3 text-left text-sm font-semibold transition ${
                              action.variant === 'danger'
                                ? 'border-rose-300/20 bg-rose-500/10 text-rose-50 hover:border-rose-200/35'
                                : action.variant === 'primary'
                                  ? 'border-cyan-300/20 bg-cyan-400/10 text-cyan-50 hover:border-cyan-200/35'
                                  : 'border-white/10 bg-slate-950/55 text-slate-100 hover:border-white/20'
                            }`}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                      <div className="mt-4 rounded-[1.1rem] border border-white/10 bg-slate-950/55 px-4 py-4 text-sm leading-6 text-slate-300">
                        Use mock mode first to verify parsing, validation, routing, confirmation, and spoken replies without needing the real ESP32.
                      </div>
                    </div>

                    <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/75">
                          Action Logs
                        </div>
                        <button
                          type="button"
                          onClick={handleClearActionLogs}
                          className="rounded-full border border-white/10 bg-slate-950/55 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/20 hover:bg-white/10"
                        >
                          Clear Logs
                        </button>
                      </div>
                      <div className="mt-4 max-h-[19rem] space-y-3 overflow-y-auto pr-1 no-scrollbar">
                        {actionLogs.length ? (
                          actionLogs.map((log) => (
                            <div
                              key={log.id}
                              className="rounded-[1.1rem] border border-white/10 bg-slate-950/55 px-4 py-4"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold text-white">
                                  {log.summary}
                                </div>
                                <div
                                  className={`rounded-full px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.2em] ${
                                    log.status === ACTION_RESULT_STATUS.SUCCESS ||
                                    log.status === ACTION_RESULT_STATUS.MOCKED
                                      ? 'bg-emerald-500/10 text-emerald-100'
                                      : log.status === ACTION_RESULT_STATUS.ERROR ||
                                          log.status === ACTION_RESULT_STATUS.DENIED
                                        ? 'bg-rose-500/10 text-rose-100'
                                        : 'bg-amber-500/10 text-amber-100'
                                  }`}
                                >
                                  {log.status}
                                </div>
                              </div>
                              <div className="mt-2 text-xs uppercase tracking-[0.22em] text-slate-500">
                                {new Date(log.at).toLocaleString()}
                              </div>
                              <div className="mt-3 text-sm leading-6 text-slate-300">
                                {log.message}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-[1.1rem] border border-white/10 bg-slate-950/55 px-4 py-4 text-sm leading-6 text-slate-300">
                            No structured actions have been recorded yet.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/75">
                          Devices Settings
                        </div>
                        <button
                          type="button"
                          onClick={handleRevokeOtherSessions}
                          disabled={
                            sessionInventory.saving ||
                            !otherActiveSessions.length ||
                            sessionInventory.loading
                          }
                          className="rounded-full border border-white/10 bg-slate-950/55 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Revoke Other Sessions
                        </button>
                      </div>

                      <div className="mt-4 space-y-4">
                        <div className="rounded-[1.1rem] border border-cyan-300/15 bg-slate-950/55 px-4 py-4">
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                            Current Session
                          </div>
                          {currentSessionRecord ? (
                            <>
                              <div className="mt-3 text-base font-semibold text-white">
                                {currentSessionRecord.label}
                              </div>
                              <div className="mt-2 text-sm leading-6 text-slate-300">
                                {currentSessionRecord.browser} on {currentSessionRecord.platform} · {currentSessionRecord.deviceType}
                              </div>
                              <div className="mt-2 text-xs uppercase tracking-[0.22em] text-slate-500">
                                Last active {new Date(currentSessionRecord.lastSeenAt).toLocaleString()}
                              </div>
                            </>
                          ) : (
                            <div className="mt-3 text-sm leading-6 text-slate-300">
                              {sessionInventory.loading
                                ? 'Loading current session metadata...'
                                : 'Current session metadata is unavailable.'}
                            </div>
                          )}
                        </div>

                        <div className="rounded-[1.1rem] border border-white/10 bg-slate-950/55 px-4 py-4">
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                            Other Active Sessions
                          </div>
                          <div className="mt-3 space-y-3">
                            {otherActiveSessions.length ? (
                              otherActiveSessions.map((session) => (
                                <div
                                  key={session.id}
                                  className="rounded-[1rem] border border-white/10 bg-slate-900/70 px-4 py-4"
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <div className="text-sm font-semibold text-white">
                                        {session.label}
                                      </div>
                                      <div className="mt-2 text-sm leading-6 text-slate-300">
                                        {session.browser} on {session.platform} · {session.deviceType}
                                      </div>
                                      <div className="mt-2 text-xs uppercase tracking-[0.22em] text-slate-500">
                                        Last active {new Date(session.lastSeenAt).toLocaleString()}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleRevokeSession(session.id)}
                                      disabled={sessionInventory.saving}
                                      className="rounded-full border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-rose-50 transition hover:border-rose-200/35 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Revoke
                                    </button>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-sm leading-6 text-slate-300">
                                {sessionInventory.loading
                                  ? 'Loading other active sessions...'
                                  : 'No other active sessions were found.'}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5">
                      <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/75">
                        Procedure
                      </div>
                      <div className="mt-4 space-y-3">
                        {adminProcedure.map((step) => (
                          <div
                            key={step}
                            className="rounded-[1.1rem] border border-white/10 bg-slate-950/55 px-4 py-3 text-sm leading-6 text-slate-200"
                          >
                            {step}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5">
                      <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/75">
                        Maintenance
                      </div>
                      <div className="mt-4 space-y-3">
                        {adminMaintenance.map((item) => (
                          <div
                            key={item}
                            className="rounded-[1.1rem] border border-white/10 bg-slate-950/55 px-4 py-3 text-sm leading-6 text-slate-200"
                          >
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="mt-6 rounded-[1.6rem] border border-white/10 bg-white/5 p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/75">
                    Settings Snapshot And Troubleshooting
                  </div>
                  <div className="mt-4 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                    <div className="grid gap-3">
                      {adminSettings.map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-[1.1rem] border border-white/10 bg-slate-950/55 px-4 py-3"
                        >
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                            {label}
                          </div>
                          <div className="mt-2 break-words text-sm leading-6 text-slate-200">
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {adminTroubleshooting.map((item) => (
                      <div
                        key={item}
                        className="rounded-[1.1rem] border border-white/10 bg-slate-950/55 px-4 py-3 text-sm leading-6 text-slate-200"
                      >
                        {item}
                      </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </MantineProvider>
  );
}

export default App;
