import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { DEFAULT_AUTOMATION_SETTINGS, STORAGE_KEYS } from './automation/settings';

class MockSpeechRecognition {
  static latestInstance = null;

  constructor() {
    this.onstart = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this.continuous = false;
    this.interimResults = false;
    this.lang = 'en-US';
    MockSpeechRecognition.latestInstance = this;
  }

  start = jest.fn(() => {
    this.onstart?.();
  });

  stop = jest.fn(() => {
    this.onend?.();
  });
}

async function startVoiceSession() {
  await userEvent.click(
    screen.getByRole('button', { name: /start jarvis/i })
  );

  await waitFor(() => {
    expect(MockSpeechRecognition.latestInstance.start).toHaveBeenCalled();
  });
}

function emitFinalTranscript(transcript) {
  act(() => {
    MockSpeechRecognition.latestInstance.onresult?.({
      resultIndex: 0,
      results: [
        {
          0: { transcript },
          isFinal: true,
        },
      ],
    });
  });
}

function seedAutomationSettings(overrides = {}) {
  window.localStorage.setItem(
    STORAGE_KEYS.settings,
    JSON.stringify({
      ...DEFAULT_AUTOMATION_SETTINGS,
      ...overrides,
      laptopPermissions: {
        ...DEFAULT_AUTOMATION_SETTINGS.laptopPermissions,
        ...(overrides.laptopPermissions || {}),
      },
    })
  );
}

function buildSession(overrides = {}) {
  return {
    id: overrides.id || `sess_${Math.random().toString(16).slice(2, 8)}`,
    label: overrides.label || 'Windows Device',
    browser: overrides.browser || 'Google Chrome',
    platform: overrides.platform || 'Windows',
    deviceType: overrides.deviceType || 'desktop',
    appName: 'JarvisAI Web',
    appVersion: 'test',
    createdAt: overrides.createdAt || '2026-03-27T10:00:00.000Z',
    lastSeenAt: overrides.lastSeenAt || '2026-03-27T10:05:00.000Z',
    isCurrent: Boolean(overrides.isCurrent),
  };
}

function createJsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function createBackendFetchMock({
  aiText = 'Secure AI says hello from the backend.',
  settingsOverrides = {},
  sessions = [
    buildSession({
      id: 'sess_current',
      label: 'Current Windows Device',
      isCurrent: true,
    }),
    buildSession({
      id: 'sess_other',
      label: 'Other Android Phone',
      browser: 'Firefox',
      platform: 'Android',
      deviceType: 'mobile',
    }),
  ],
} = {}) {
  let currentSettings = {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ...settingsOverrides,
    laptopPermissions: {
      ...DEFAULT_AUTOMATION_SETTINGS.laptopPermissions,
      ...(settingsOverrides.laptopPermissions || {}),
    },
  };
  let currentInventory = {
    currentSessionId: 'sess_current',
    sessions,
  };

  const fetchMock = jest.fn(async (url, options = {}) => {
    const requestUrl = String(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;

    if (requestUrl.includes('/api/settings/sessions/register')) {
      if (body?.sessionId) {
        currentInventory = {
          ...currentInventory,
          currentSessionId: body.sessionId,
          sessions: currentInventory.sessions.map((session) => ({
            ...session,
            isCurrent: session.id === body.sessionId,
          })),
        };
      }

      return createJsonResponse(currentInventory);
    }

    if (requestUrl.includes('/api/settings/sessions/revoke-others')) {
      currentInventory = {
        ...currentInventory,
        sessions: currentInventory.sessions.filter((session) => session.isCurrent),
      };
      return createJsonResponse(currentInventory);
    }

    if (
      requestUrl.includes('/api/settings/sessions/') &&
      method === 'DELETE'
    ) {
      const targetSessionId = decodeURIComponent(
        requestUrl.split('/api/settings/sessions/')[1].split('?')[0]
      );
      currentInventory = {
        ...currentInventory,
        sessions: currentInventory.sessions.filter(
          (session) => session.id !== targetSessionId
        ),
      };
      return createJsonResponse(currentInventory);
    }

    if (requestUrl.includes('/api/settings/sessions')) {
      return createJsonResponse(currentInventory);
    }

    if (requestUrl.endsWith('/api/settings') && method === 'PATCH') {
      currentSettings = {
        ...currentSettings,
        ...(body?.patch || {}),
        laptopPermissions: {
          ...currentSettings.laptopPermissions,
          ...(body?.patch?.laptopPermissions || {}),
        },
      };
      return createJsonResponse({
        version: 1,
        settings: currentSettings,
      });
    }

    if (requestUrl.endsWith('/api/settings')) {
      return createJsonResponse({
        version: 1,
        settings: currentSettings,
      });
    }

    if (requestUrl.includes('/api/ai/chat')) {
      return createJsonResponse({
        text: aiText,
      });
    }

    return createJsonResponse({});
  });

  fetchMock.getAiCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/ai/chat'));

  return fetchMock;
}

beforeEach(() => {
  const originalConsoleError = console.error.bind(console);
  window.localStorage.setItem(STORAGE_KEYS.sessionId, 'sess_current');
  window.SpeechRecognition = MockSpeechRecognition;
  window.webkitSpeechRecognition = undefined;
  window.SpeechSynthesisUtterance = function MockUtterance(text) {
    this.text = text;
  };
  window.speechSynthesis = {
    speak: jest.fn((utterance) => {
      setTimeout(() => {
        utterance.onend?.();
      }, 0);
    }),
    cancel: jest.fn(),
  };
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (
      typeof message === 'string' &&
      message.includes('not wrapped in act')
    ) {
      return;
    }

    originalConsoleError(message, ...args);
  });
  global.fetch = createBackendFetchMock();
});

afterEach(() => {
  window.localStorage.clear();
  jest.restoreAllMocks();
});

test('renders the simplified front screen', () => {
  render(<App />);

  expect(screen.queryByText(/voice-first jarvis/i)).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      /voice mode is ready\. enable the microphone and speak naturally\./i
    )
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', {
      name: /start jarvis/i,
    })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', {
      name: /^mute$/i,
    })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', {
      name: /admin panel/i,
    })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', {
      name: /hide ai chat/i,
    })
  ).toBeInTheDocument();
  expect(screen.getAllByText(/ai chat/i).length).toBeGreaterThan(0);
  expect(
    screen.getAllByText(/jarvis chat will appear here/i).length
  ).toBeGreaterThan(0);
  expect(
    screen.queryByText(/standing by for the next voice command\./i)
  ).not.toBeInTheDocument();
});

test('can hide and show the desktop ai chat panel', async () => {
  render(<App />);

  expect(screen.getAllByText(/jarvis chat will appear here/i).length).toBe(2);

  await userEvent.click(
    screen.getByRole('button', { name: /hide ai chat/i })
  );

  expect(
    screen.getByRole('button', { name: /show ai chat/i })
  ).toBeInTheDocument();
  expect(screen.getAllByText(/jarvis chat will appear here/i).length).toBe(1);

  await userEvent.click(
    screen.getByRole('button', { name: /show ai chat/i })
  );

  expect(
    screen.getByRole('button', { name: /hide ai chat/i })
  ).toBeInTheDocument();
  expect(screen.getAllByText(/jarvis chat will appear here/i).length).toBe(2);
});

test('opens the admin panel from the top-right control', async () => {
  render(<App />);

  await userEvent.click(screen.getByRole('button', { name: /admin panel/i }));

  expect(
    screen.getByText(/operations, health, and maintenance/i)
  ).toBeInTheDocument();
  expect(screen.getByText(/problems and issues/i)).toBeInTheDocument();
  expect(screen.getByText(/system controls/i)).toBeInTheDocument();
  expect(screen.getByText(/action logs/i)).toBeInTheDocument();
  expect(screen.getByText(/use mock devices/i)).toBeInTheDocument();
});

test('does not add a visible error bubble for no-speech timeouts', async () => {
  render(<App />);

  await userEvent.click(
    screen.getByRole('button', { name: /start jarvis/i })
  );

  await waitFor(() => {
    expect(MockSpeechRecognition.latestInstance.start).toHaveBeenCalled();
  });

  act(() => {
    MockSpeechRecognition.latestInstance.onerror?.({
      error: 'no-speech',
    });
  });

  expect(
    screen.queryByText(/sorry, i didn't catch that\. please try again\./i)
  ).not.toBeInTheDocument();
});

test('routes voice questions through the ai backend and shows the reply', async () => {
  global.fetch = createBackendFetchMock({
    aiText: 'Secure AI says hello from the backend.',
  });

  render(<App />);

  await startVoiceSession();

  act(() => {
    MockSpeechRecognition.latestInstance.onresult?.({
      resultIndex: 0,
      results: [
        {
          0: { transcript: 'Hey Jarvis what is AI?' },
          isFinal: false,
        },
      ],
    });
  });

  expect(screen.getAllByText(/hey jarvis what is ai\?/i).length).toBeGreaterThan(
    0
  );

  act(() => {
    MockSpeechRecognition.latestInstance.onresult?.({
      resultIndex: 0,
      results: [
        {
          0: { transcript: 'Hey Jarvis what is AI?' },
          isFinal: true,
        },
      ],
    });
  });

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/ai/chat',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: 'what is AI' }),
      })
    );
  });

  expect(
    (await screen.findAllByText(/secure ai says hello from the backend\./i)).length
  ).toBeGreaterThan(0);
  expect(window.speechSynthesis.speak).toHaveBeenCalled();
});

test('routes "what\'s up?" to ai fallback', async () => {
  global.fetch = createBackendFetchMock({
    aiText: 'All good here.',
  });

  render(<App />);

  await startVoiceSession();
  emitFinalTranscript("Hey Jarvis what's up?");

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(1);
  });

  expect((await screen.findAllByText(/all good here\./i)).length).toBeGreaterThan(0);
});

test('accepts natural punctuation in the wake phrase', async () => {
  global.fetch = createBackendFetchMock({
    aiText: 'All good here.',
  });

  render(<App />);

  await startVoiceSession();

  emitFinalTranscript('Hey, Jarvis! Whats up');

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/ai/chat',
      expect.objectContaining({
        body: JSON.stringify({ prompt: 'Whats up' }),
      })
    );
  });

  expect((await screen.findAllByText(/all good here\./i)).length).toBeGreaterThan(
    0
  );
});

test('handles one spoken question once even if duplicate final results arrive', async () => {
  global.fetch = createBackendFetchMock({
    aiText: 'One clean reply.',
  });

  render(<App />);

  await startVoiceSession();

  emitFinalTranscript('Hey Jarvis what is AI?');
  emitFinalTranscript('Hey Jarvis what is AI?');

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(1);
  });

  expect((await screen.findAllByText(/one clean reply\./i)).length).toBeGreaterThan(
    0
  );
});

test('allows the same spoken prompt again after the next listening cycle starts', async () => {
  global.fetch = createBackendFetchMock({
    aiText: 'Repeated prompt answered.',
  });

  render(<App />);

  await startVoiceSession();

  emitFinalTranscript('Hey Jarvis what is AI?');

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(1);
  });

  expect(
    (await screen.findAllByText(/repeated prompt answered\./i)).length
  ).toBeGreaterThan(0);

  act(() => {
    MockSpeechRecognition.latestInstance.onstart?.();
  });

  emitFinalTranscript('Hey Jarvis what is AI?');

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(2);
  });
});

test('ignores spoken prompts that do not begin with the wake word', async () => {
  global.fetch = createBackendFetchMock();

  render(<App />);

  await startVoiceSession();

  emitFinalTranscript('What is AI?');

  expect(global.fetch.getAiCalls()).toHaveLength(0);
  expect(
    screen.queryByText(/what is ai\?/i)
  ).not.toBeInTheDocument();
});

test('admin quick actions can execute a mock device command and record it', async () => {
  render(<App />);

  await userEvent.click(screen.getByRole('button', { name: /admin panel/i }));
  await userEvent.click(screen.getByRole('button', { name: /mock fan on/i }));

  expect(
    (await screen.findAllByText(/\[mock esp32\] living room fan -> on/i)).length
  ).toBeGreaterThan(0);
  expect(
    (await screen.findAllByText(/turn on living room fan/i)).length
  ).toBeGreaterThan(0);
});

test('routes open chrome with punctuation to automation and not the ai backend', async () => {
  global.fetch = createBackendFetchMock();

  render(<App />);

  await startVoiceSession();
  emitFinalTranscript('Hey Jarvis open chrome.');

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(0);
  });

  expect((await screen.findAllByText(/\[mock laptop\] open chrome/i)).length).toBeGreaterThan(0);
});

test('routes mute volume to automation and not the ai backend', async () => {
  global.fetch = createBackendFetchMock();

  render(<App />);

  await startVoiceSession();
  emitFinalTranscript('Hey Jarvis mute volume');

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(0);
  });

  expect((await screen.findAllByText(/\[mock laptop\] mute the volume/i)).length).toBeGreaterThan(0);
});

test('routes turn on the fan to the device executor and not the ai backend', async () => {
  global.fetch = createBackendFetchMock();

  render(<App />);

  await startVoiceSession();
  emitFinalTranscript('Hey Jarvis turn on the fan');

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(0);
  });

  expect(
    (await screen.findAllByText(/\[mock esp32\] living room fan -> on/i)).length
  ).toBeGreaterThan(0);
});

test('routes a multi-action voice command to automation queue and not the ai backend', async () => {
  global.fetch = createBackendFetchMock();

  render(<App />);

  await startVoiceSession();
  emitFinalTranscript('Hey Jarvis turn on the fan and open chrome.');

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(0);
  });

  await userEvent.click(screen.getByRole('button', { name: /admin panel/i }));

  expect(
    (await screen.findAllByText(/\[mock esp32\] living room fan -> on/i)).length
  ).toBeGreaterThan(0);
  expect((await screen.findAllByText(/\[mock laptop\] open chrome/i)).length).toBeGreaterThan(0);
});

test('routes shutdown laptop into confirmation instead of ai fallback', async () => {
  global.fetch = createBackendFetchMock();

  render(<App />);

  await startVoiceSession();
  emitFinalTranscript('Hey Jarvis shut down my laptop');

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(0);
  });

  expect(
    (await screen.findAllByText(/are you sure you want me to shut down the laptop\?/i)).length
  ).toBeGreaterThan(0);
});

test('executes a pending confirmation when the user says yes', async () => {
  global.fetch = createBackendFetchMock({
    settingsOverrides: {
      laptopPermissions: {
        allowPower: true,
      },
    },
  });
  seedAutomationSettings({
    laptopPermissions: {
      allowPower: true,
    },
  });

  render(<App />);

  await startVoiceSession();
  emitFinalTranscript('Hey Jarvis shut down my laptop');

  expect(
    (await screen.findAllByText(/are you sure you want me to shut down the laptop\?/i)).length
  ).toBeGreaterThan(0);

  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 1600);
    });
  });

  act(() => {
    MockSpeechRecognition.latestInstance.onstart?.();
  });

  emitFinalTranscript('Hey Jarvis yes');

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(0);
  });

  expect(
    (await screen.findAllByText(/\[mock laptop\] shut down the laptop/i)).length
  ).toBeGreaterThan(0);
});

test('cancels a pending confirmation locally without calling ai', async () => {
  global.fetch = createBackendFetchMock();

  render(<App />);

  await startVoiceSession();
  emitFinalTranscript('Hey Jarvis shut down my laptop');

  expect(
    (await screen.findAllByText(/are you sure you want me to shut down the laptop\?/i)).length
  ).toBeGreaterThan(0);

  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 1600);
    });
  });

  act(() => {
    MockSpeechRecognition.latestInstance.onstart?.();
  });

  emitFinalTranscript('Hey Jarvis cancel');

  await waitFor(() => {
    expect(global.fetch.getAiCalls()).toHaveLength(0);
  });

  expect((await screen.findAllByText(/okay, canceled\./i)).length).toBeGreaterThan(0);
});

test('loads the device sessions section from backend inventory', async () => {
  global.fetch = createBackendFetchMock({
    sessions: [
      buildSession({
        id: 'sess_current',
        label: 'Current Windows Device',
        isCurrent: true,
      }),
      buildSession({
        id: 'sess_tablet',
        label: 'Bedroom Tablet',
        browser: 'Safari',
        platform: 'iOS',
        deviceType: 'tablet',
      }),
    ],
  });

  render(<App />);

  await userEvent.click(screen.getByRole('button', { name: /admin panel/i }));

  expect(await screen.findByText(/devices settings/i)).toBeInTheDocument();
  expect((await screen.findAllByText(/current windows device/i)).length).toBeGreaterThan(0);
  expect((await screen.findAllByText(/bedroom tablet/i)).length).toBeGreaterThan(0);
});

test('can revoke a single other session from the devices settings section', async () => {
  global.fetch = createBackendFetchMock({
    sessions: [
      buildSession({
        id: 'sess_current',
        label: 'Current Windows Device',
        isCurrent: true,
      }),
      buildSession({
        id: 'sess_phone',
        label: 'Travel Phone',
        browser: 'Firefox',
        platform: 'Android',
        deviceType: 'mobile',
      }),
    ],
  });

  render(<App />);

  await userEvent.click(screen.getByRole('button', { name: /admin panel/i }));
  expect(await screen.findByText(/travel phone/i)).toBeInTheDocument();

  await userEvent.click(screen.getAllByRole('button', { name: /^revoke$/i })[0]);

  await waitFor(() => {
    expect(screen.queryByText(/travel phone/i)).not.toBeInTheDocument();
  });
});

test('can revoke all other sessions from the devices settings section', async () => {
  global.fetch = createBackendFetchMock({
    sessions: [
      buildSession({
        id: 'sess_current',
        label: 'Current Windows Device',
        isCurrent: true,
      }),
      buildSession({
        id: 'sess_phone',
        label: 'Travel Phone',
        browser: 'Firefox',
        platform: 'Android',
        deviceType: 'mobile',
      }),
      buildSession({
        id: 'sess_tablet',
        label: 'Bedroom Tablet',
        browser: 'Safari',
        platform: 'iOS',
        deviceType: 'tablet',
      }),
    ],
  });

  render(<App />);

  await userEvent.click(screen.getByRole('button', { name: /admin panel/i }));
  expect(await screen.findByText(/travel phone/i)).toBeInTheDocument();
  expect(await screen.findByText(/bedroom tablet/i)).toBeInTheDocument();

  await userEvent.click(
    screen.getByRole('button', { name: /revoke other sessions/i })
  );

  await waitFor(() => {
    expect(screen.queryByText(/travel phone/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/bedroom tablet/i)).not.toBeInTheDocument();
  });
});
