import { useEffect, useRef, useState } from 'react';
import {
  Button,
  MantineProvider,
  createTheme,
} from '@mantine/core';
import JarvisAvatar from './components/JarvisAvatar';
import SpeechBubble from './components/SpeechBubble';
import {
  DEFAULT_AI_ENDPOINT,
  DEFAULT_HTTP_ENDPOINT,
  DEFAULT_PROTOCOL,
  DEFAULT_WEBSOCKET_ENDPOINT,
  applyFeedbackUpdates,
  buildFeedbackMessage,
  buildLocalAssistantReply,
  createInitialDeviceStates,
  extractEsp32Feedback,
  getDeviceLabel,
  parseVoiceCommand,
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

const STORAGE_KEYS = {
  aiEndpoint: 'jarvis.ai-endpoint',
  protocol: 'jarvis.protocol',
  httpEndpoint: 'jarvis.http-endpoint',
  websocketEndpoint: 'jarvis.websocket-endpoint',
};

const initialConversation = [];

const initialStatusPanel = {
  label: 'Stand By',
  message:
    'Enable voice capture, then begin each request with "Hey Jarvis".',
  tone: 'neutral',
};

const MAX_VISIBLE_MESSAGES = 10;
const WAKE_WORD_PATTERN = /^\s*hey[\s,.-]*jarvis\b[\s,!:.-]*/i;

function readStoredValue(key, fallbackValue) {
  if (typeof window === 'undefined') {
    return fallbackValue;
  }

  try {
    return window.localStorage.getItem(key) || fallbackValue;
  } catch (error) {
    return fallbackValue;
  }
}

function wait(delay) {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

function getConnectionCopy(protocol, status) {
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

function describeCommandTargets(commands) {
  return commands
    .map((command) => getDeviceLabel(command.device, command.location))
    .join(', ');
}

function buildDispatchMessage(commands) {
  const targetSummary = describeCommandTargets(commands);

  if (commands.length === 1) {
    return `Processing ${targetSummary}.`;
  }

  return `Processing ${commands.length} commands sequentially: ${targetSummary}.`;
}

function buildQueuedMessage(commands) {
  const targetSummary = describeCommandTargets(commands);

  if (commands.length === 1) {
    return `Command sent over WebSocket for ${targetSummary}. Waiting for ESP32 feedback.`;
  }

  return `Queued ${commands.length} commands over WebSocket for ${targetSummary}. Waiting for ESP32 feedback.`;
}

function buildBatchSuccessMessage(commands) {
  return `Completed ${commands.length} commands successfully: ${describeCommandTargets(
    commands
  )}.`;
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

function extractWakeWordPrompt(prompt) {
  const match = prompt.match(WAKE_WORD_PATTERN);

  if (!match) {
    return null;
  }

  return prompt.slice(match[0].length).trim();
}

function App() {
  const [activity, setActivity] = useState('idle');
  const [recognizedText, setRecognizedText] = useState('');
  const [conversation, setConversation] = useState(initialConversation);
  const [, setDeviceStates] = useState(createInitialDeviceStates);
  const aiEndpoint = readStoredValue(STORAGE_KEYS.aiEndpoint, DEFAULT_AI_ENDPOINT);
  const [aiStatus, setAiStatus] = useState(() =>
    aiEndpoint.trim() ? 'configured' : 'not_configured'
  );
  const transportProtocol = readStoredValue(STORAGE_KEYS.protocol, DEFAULT_PROTOCOL);
  const httpEndpoint = readStoredValue(
    STORAGE_KEYS.httpEndpoint,
    DEFAULT_HTTP_ENDPOINT
  );
  const websocketEndpoint = readStoredValue(
    STORAGE_KEYS.websocketEndpoint,
    DEFAULT_WEBSOCKET_ENDPOINT
  );
  const [connectionStatus, setConnectionStatus] = useState('not_configured');
  const [statusPanel, setStatusPanel] = useState(initialStatusPanel);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [speechOutputEnabled, setSpeechOutputEnabled] = useState(true);
  const [chatPanelOpen, setChatPanelOpen] = useState(true);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [liveReply, setLiveReply] = useState({
    label: 'Jarvis',
    message: 'Replies will stream here while Jarvis speaks.',
    tone: 'neutral',
    streaming: false,
  });
  const messageCounterRef = useRef(1);
  const timeoutIdsRef = useRef([]);
  const streamTimeoutIdsRef = useRef([]);
  const socketRef = useRef(null);
  const recognitionRef = useRef(null);
  const recognitionActiveRef = useRef(false);
  const speechUtteranceRef = useRef(null);
  const activityRef = useRef(activity);
  const appendConversationEntryRef = useRef(() => {});
  const processPromptRef = useRef(() => {});
  const promptLockRef = useRef(false);
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

  const sendAiPrompt = async (prompt, attempt = 1) => {
    const trimmedAiEndpoint = aiEndpoint.trim();

    if (!trimmedAiEndpoint) {
      throw new Error('AI backend endpoint is not configured.');
    }

    setAiStatus('sending');

    try {
      const response = await fetch(trimmedAiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      });

      let payload;

      try {
        payload = await response.json();
      } catch (error) {
        throw new Error('AI backend returned invalid JSON.');
      }

      if (!response.ok) {
        throw new Error(payload?.error || `AI backend returned HTTP ${response.status}.`);
      }

      if (typeof payload?.text !== 'string' || !payload.text.trim()) {
        throw new Error('AI backend returned an empty reply.');
      }

      setAiStatus('connected');
      return payload.text.trim();
    } catch (error) {
      if (attempt === 1) {
        await wait(900);
        return sendAiPrompt(prompt, 2);
      }

      setAiStatus('error');
      throw error;
    }
  };

  const sendHttpCommand = async (command, attempt = 1) => {
    const trimmedEndpoint = httpEndpoint.trim();

    if (!trimmedEndpoint) {
      throw new Error('ESP32 HTTP endpoint is not configured.');
    }

    setConnectionStatus('sending');

    try {
      const response = await fetch(trimmedEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
      });

      if (!response.ok) {
        throw new Error(`ESP32 returned HTTP ${response.status}.`);
      }

      const responseText = await response.text();
      const payload = responseText ? responseText : { message: '' };

      setConnectionStatus('connected');
      return extractEsp32Feedback(payload);
    } catch (error) {
      if (attempt === 1) {
        await wait(900);
        return sendHttpCommand(command, 2);
      }

      setConnectionStatus('error');
      throw error;
    }
  };

  const connectWebSocket = () => {
    const trimmedEndpoint = websocketEndpoint.trim();

    if (!trimmedEndpoint) {
      setConnectionStatus('not_configured');
      updateStatusPanel(
        'ESP32',
        'Set a WebSocket endpoint before trying to connect to the ESP32.',
        'error'
      );
      return;
    }

    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
      setConnectionStatus('error');
      updateStatusPanel(
        'ESP32',
        'WebSocket is not available in this browser.',
        'error'
      );
      return;
    }

    if (
      socketRef.current &&
      (socketRef.current.readyState === window.WebSocket.OPEN ||
        socketRef.current.readyState === window.WebSocket.CONNECTING)
    ) {
      return;
    }

    setConnectionStatus('connecting');
    updateStatusPanel(
      'ESP32',
      'Connecting to the ESP32 over WebSocket.',
      'pending'
    );

    const socket = new window.WebSocket(trimmedEndpoint);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnectionStatus('connected');
      updateStatusPanel(
        'ESP32',
        'WebSocket connected. Device feedback can stream back to the TV UI.',
        'success'
      );
    };

    socket.onmessage = (event) => {
      const feedback = extractEsp32Feedback(event.data);

      if (!feedback.updates.length && !feedback.message) {
        return;
      }

      handleFeedback(feedback);
    };

    socket.onerror = () => {
      setConnectionStatus('error');
      updateStatusPanel(
        'ESP32',
        'WebSocket error. Check the ESP32 IP, port, and Wi-Fi connection.',
        'error'
      );
    };

    socket.onclose = () => {
      socketRef.current = null;
      setConnectionStatus(
        trimmedEndpoint ? 'disconnected' : 'not_configured'
      );
      updateStatusPanel(
        'ESP32',
        'WebSocket disconnected. Reconnect when the ESP32 is reachable again.',
        trimmedEndpoint ? 'pending' : 'error'
      );
    };
  };

  const disconnectWebSocket = () => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  };

  const waitForWebSocketReady = (timeout = 4500) =>
    new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
        reject(new Error('WebSocket is unavailable in this browser.'));
        return;
      }

      if (
        socketRef.current &&
        socketRef.current.readyState === window.WebSocket.OPEN
      ) {
        resolve(socketRef.current);
        return;
      }

      const startedAt = Date.now();
      const intervalId = window.setInterval(() => {
        if (
          socketRef.current &&
          socketRef.current.readyState === window.WebSocket.OPEN
        ) {
          window.clearInterval(intervalId);
          resolve(socketRef.current);
          return;
        }

        if (Date.now() - startedAt >= timeout) {
          window.clearInterval(intervalId);
          reject(new Error('WebSocket connection timed out.'));
        }
      }, 120);
    });

  const ensureWebSocketConnection = async () => {
    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
      throw new Error('WebSocket is unavailable in this browser.');
    }

    if (
      socketRef.current &&
      socketRef.current.readyState === window.WebSocket.OPEN
    ) {
      return socketRef.current;
    }

    connectWebSocket();
    return waitForWebSocketReady();
  };

  const sendWebSocketCommand = async (command, attempt = 1) => {
    try {
      const socket = await ensureWebSocketConnection();
      socket.send(JSON.stringify(command));
    } catch (error) {
      if (attempt === 1) {
        disconnectWebSocket();
        await wait(700);
        return sendWebSocketCommand(command, 2);
      }

      setConnectionStatus('error');
      throw error;
    }
  };

  const dispatchHttpCommands = async (commands) => {
    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index];
      const deviceLabel = getDeviceLabel(command.device, command.location);

      updateStatusPanel(
        'Dispatch',
        `Sending ${index + 1} of ${commands.length}: ${deviceLabel}.`,
        'pending'
      );

      const feedback = await sendHttpCommand(command);
      await handleFeedback(feedback, command, 'ESP32', {
        setSpeaking: commands.length === 1,
        tone: 'success',
        speak: commands.length === 1,
      });
    }

    if (commands.length > 1) {
      await deliverAssistantMessage(
        'Jarvis',
        buildBatchSuccessMessage(commands),
        'success'
      );
    }
  };

  const dispatchWebSocketCommands = async (commands) => {
    for (let index = 0; index < commands.length; index += 1) {
      updateStatusPanel(
        'Dispatch',
        `Queueing ${index + 1} of ${commands.length}: ${getDeviceLabel(
          commands[index].device,
          commands[index].location
        )}.`,
        'pending'
      );

      await sendWebSocketCommand(commands[index]);

      if (commands.length > 1 && index < commands.length - 1) {
        await wait(220);
      }
    }

    const queuedMessage = buildQueuedMessage(commands);
    appendConversationEntry('assistant', 'Jarvis', queuedMessage, 'pending');
    updateStatusPanel('ESP32', queuedMessage, 'pending');
    resetActivitySoon(900);
  };

  const processPrompt = async (prompt, source = 'typed') => {
    let trimmedPrompt = prompt.trim();
    let wakeWordPrompt = trimmedPrompt;

    if (source === 'voice') {
      wakeWordPrompt = extractWakeWordPrompt(trimmedPrompt);

      if (wakeWordPrompt === null) {
        setRecognizedText('');
        updateStatusPanel(
          'Wake Word',
          'Waiting for "Hey Jarvis" at the start of your command.',
          'pending'
        );
        return;
      }

      if (!wakeWordPrompt) {
        setRecognizedText('');
        updateStatusPanel(
          'Wake Word',
          'Wake word heard. Say your full request after "Hey Jarvis".',
          'pending'
        );
        return;
      }

      trimmedPrompt = wakeWordPrompt;
    }

    const fingerprint = normalizePromptFingerprint(trimmedPrompt);
    const now = Date.now();

    if (!trimmedPrompt) {
      return;
    }

    if (
      lastAcceptedPromptRef.current.fingerprint === fingerprint &&
      now - lastAcceptedPromptRef.current.at < 2500
    ) {
      return;
    }

    if (promptLockRef.current) {
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

    stopSpeechOutput();

    if (recognitionRef.current && recognitionActiveRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (error) {
        // Ignore stop failures from repeated toggles.
      }
    }

    try {
      setRecognizedText(trimmedPrompt);
      appendConversationEntry(
        'user',
        source === 'voice' ? 'Voice Transcript' : 'You',
        trimmedPrompt,
        'user'
      );

      const parsedResult = parseVoiceCommand(trimmedPrompt);

      if (parsedResult.kind === 'empty') {
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

        updateStatusPanel(panelLabel, parsedResult.message, panelTone);
        await deliverAssistantMessage('Jarvis', parsedResult.message, panelTone);
        return;
      }

      setActivity('thinking');

      if (parsedResult.kind === 'general') {
        if (!aiEndpoint.trim()) {
          updateStatusPanel(
            'AI',
            'AI backend not configured. Answering locally for now.',
            'pending'
          );

          await wait(650);
          await deliverAssistantMessage(
            'Jarvis',
            buildLocalAssistantReply(parsedResult.prompt),
            'neutral'
          );

          return;
        }

        updateStatusPanel(
          'AI',
          'Sending this question to the secure AI backend.',
          'pending'
        );

        try {
          const reply = await sendAiPrompt(parsedResult.prompt);
          await deliverAssistantMessage('Jarvis AI', reply, 'success');
        } catch (error) {
          const fallbackReply = buildLocalAssistantReply(parsedResult.prompt);
          const errorMessage = `AI backend unavailable. ${
            error.message || 'Request failed.'
          }`;

          appendConversationEntry('assistant', 'Jarvis', errorMessage, 'error');
          updateStatusPanel('AI', errorMessage, 'error');

          await wait(450);
          await deliverAssistantMessage('Jarvis', fallbackReply, 'neutral');
        }

        return;
      }

      const commands =
        parsedResult.kind === 'device_batch'
          ? parsedResult.commands
          : [parsedResult.command];
      const dispatchMessage = buildDispatchMessage(commands);

      updateStatusPanel('Dispatch', dispatchMessage, 'pending');

      if (commands.length > 1) {
        appendConversationEntry('assistant', 'Jarvis', dispatchMessage, 'pending');
      }

      try {
        if (transportProtocol === 'http') {
          await dispatchHttpCommands(commands);
          return;
        }

        await dispatchWebSocketCommands(commands);
      } catch (error) {
        await deliverAssistantMessage(
          'Jarvis',
          `Device unreachable. ${
            error.message || 'The ESP32 did not respond.'
          }`,
          'error'
        );
      }
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
    if (transportProtocol === 'websocket') {
      disconnectWebSocket();
      setConnectionStatus(
        websocketEndpoint.trim() ? 'disconnected' : 'not_configured'
      );
      return;
    }

    disconnectWebSocket();
    setConnectionStatus(httpEndpoint.trim() ? 'configured' : 'not_configured');
  }, [transportProtocol, httpEndpoint, websocketEndpoint]);

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
      disconnectWebSocket();
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

  const controlsDisabled = activity === 'thinking';
  const connectionCopy = getConnectionCopy(transportProtocol, connectionStatus);
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
    ['Status Panel', `${statusPanel.label}: ${statusPanel.message}`],
    ['Last Transcript', recognizedText || 'No transcript captured yet'],
    ['Current Reply', liveReply.message || 'No active reply'],
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

                <section className="mt-6 grid gap-6 lg:grid-cols-2">
                  <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5">
                    <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/75">
                      Settings And Backend
                    </div>
                    <div className="mt-4 space-y-3">
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
                  </div>

                  <div className="space-y-6">
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
                    Troubleshooting
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {adminTroubleshooting.map((item) => (
                      <div
                        key={item}
                        className="rounded-[1.1rem] border border-white/10 bg-slate-950/55 px-4 py-3 text-sm leading-6 text-slate-200"
                      >
                        {item}
                      </div>
                    ))}
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
