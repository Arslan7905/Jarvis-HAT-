import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

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

beforeEach(() => {
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
  expect(screen.getByText(/settings and backend/i)).toBeInTheDocument();
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
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      text: 'Secure AI says hello from the backend.',
    }),
  });

  render(<App />);

  await userEvent.click(
    screen.getByRole('button', { name: /start jarvis/i })
  );

  await waitFor(() => {
    expect(MockSpeechRecognition.latestInstance.start).toHaveBeenCalled();
  });

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
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/ai/chat',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: 'what is AI?' }),
      })
    );
  });

  expect(
    (await screen.findAllByText(/secure ai says hello from the backend\./i)).length
  ).toBeGreaterThan(0);
  expect(window.speechSynthesis.speak).toHaveBeenCalled();
});

test('accepts natural punctuation in the wake phrase', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      text: 'All good here.',
    }),
  });

  render(<App />);

  await userEvent.click(
    screen.getByRole('button', { name: /start jarvis/i })
  );

  await waitFor(() => {
    expect(MockSpeechRecognition.latestInstance.start).toHaveBeenCalled();
  });

  act(() => {
    MockSpeechRecognition.latestInstance.onresult?.({
      resultIndex: 0,
      results: [
        {
          0: { transcript: 'Hey, Jarvis! Whats up' },
          isFinal: true,
        },
      ],
    });
  });

  await waitFor(() => {
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
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      text: 'One clean reply.',
    }),
  });

  render(<App />);

  await userEvent.click(
    screen.getByRole('button', { name: /start jarvis/i })
  );

  await waitFor(() => {
    expect(MockSpeechRecognition.latestInstance.start).toHaveBeenCalled();
  });

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
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  expect((await screen.findAllByText(/one clean reply\./i)).length).toBeGreaterThan(
    0
  );
});

test('allows the same spoken prompt again after the next listening cycle starts', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      text: 'Repeated prompt answered.',
    }),
  });

  render(<App />);

  await userEvent.click(
    screen.getByRole('button', { name: /start jarvis/i })
  );

  await waitFor(() => {
    expect(MockSpeechRecognition.latestInstance.start).toHaveBeenCalled();
  });

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
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  expect(
    (await screen.findAllByText(/repeated prompt answered\./i)).length
  ).toBeGreaterThan(0);

  act(() => {
    MockSpeechRecognition.latestInstance.onstart?.();
  });

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
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

test('ignores spoken prompts that do not begin with the wake word', async () => {
  global.fetch = jest.fn();

  render(<App />);

  await userEvent.click(
    screen.getByRole('button', { name: /start jarvis/i })
  );

  await waitFor(() => {
    expect(MockSpeechRecognition.latestInstance.start).toHaveBeenCalled();
  });

  act(() => {
    MockSpeechRecognition.latestInstance.onresult?.({
      resultIndex: 0,
      results: [
        {
          0: { transcript: 'What is AI?' },
          isFinal: true,
        },
      ],
    });
  });

  expect(global.fetch).not.toHaveBeenCalled();
  expect(
    screen.queryByText(/what is ai\?/i)
  ).not.toBeInTheDocument();
});
