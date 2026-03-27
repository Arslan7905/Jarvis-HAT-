require('dotenv').config();

const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const DEFAULT_PORT = Number(process.env.PORT) || 3001;
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-oss-20b:free';

function isOpenRouterKey(apiKey) {
  return typeof apiKey === 'string' && /^sk-or(?:-v1)?-/.test(apiKey.trim());
}

function resolveProvider() {
  const configuredProvider = (process.env.AI_PROVIDER || '').trim().toLowerCase();

  if (configuredProvider === 'openrouter' || configuredProvider === 'openai') {
    return configuredProvider;
  }

  if (isOpenRouterKey(process.env.OPENROUTER_API_KEY)) {
    return 'openrouter';
  }

  if (isOpenRouterKey(process.env.OPENAI_API_KEY)) {
    return 'openrouter';
  }

  return 'openai';
}

function getApiKey(provider) {
  if (provider === 'openrouter') {
    return (
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      ''
    ).trim();
  }

  return (process.env.OPENAI_API_KEY || '').trim();
}

function getModelName(provider) {
  if (provider === 'openrouter') {
    return (
      process.env.AI_MODEL ||
      process.env.OPENROUTER_MODEL ||
      DEFAULT_OPENROUTER_MODEL
    ).trim();
  }

  return (
    process.env.AI_MODEL ||
    process.env.OPENAI_MODEL ||
    DEFAULT_OPENAI_MODEL
  ).trim();
}

function createCorsOptions() {
  const configuredOrigins = (process.env.CORS_ORIGIN || process.env.TV_UI_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const localhostOriginPattern =
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (configuredOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      if (
        process.env.NODE_ENV !== 'production' &&
        localhostOriginPattern.test(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
  };
}

function createOpenAIClient() {
  const provider = resolveProvider();
  const apiKey = getApiKey(provider);

  if (!apiKey) {
    return null;
  }

  if (provider === 'openrouter') {
    return new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'JarvisAI',
      },
    });
  }

  return new OpenAI({ apiKey });
}

function extractAiText(completion) {
  const text = completion?.choices?.[0]?.message?.content;

  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('OpenAI returned an empty response.');
  }

  return text.trim();
}

function getErrorStatus(error) {
  const status = Number(error?.status);

  if (Number.isInteger(status) && status >= 400 && status < 600) {
    return status;
  }

  return 500;
}

function getErrorMessage(error) {
  return (
    error?.error?.message ||
    error?.response?.data?.error?.message ||
    error?.message ||
    'AI request failed'
  );
}

function buildErrorResponse(error) {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error);
  const response = {
    error:
      process.env.NODE_ENV === 'production' ? 'AI request failed' : message,
  };

  if (process.env.NODE_ENV !== 'production' && error?.code) {
    response.code = error.code;
  }

  return { status, message, response };
}

async function requestAiResponse(prompt) {
  const client = createOpenAIClient();
  const provider = resolveProvider();
  const model = getModelName(provider);

  if (!client) {
    throw new Error(
      provider === 'openrouter'
        ? 'OpenRouter API key is not configured.'
        : 'OPENAI_API_KEY is not configured.'
    );
  }

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  return extractAiText(completion);
}

function createApp() {
  const app = express();

  // Express server setup and middleware for CORS + JSON request parsing.
  app.use(cors(createCorsOptions()));
  app.use(express.json({ limit: '1mb' }));

  // Endpoint that forwards the user's prompt to OpenAI and returns only AI text.
  app.post('/api/ai/chat', async (req, res) => {
    const prompt =
      typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';

    if (!prompt) {
      return res.status(400).json({
        error: 'Prompt is required.',
      });
    }

    try {
      const text = await requestAiResponse(prompt);
      return res.json({ text });
    } catch (error) {
      const { status, message, response } = buildErrorResponse(error);
      console.error('AI request failed:', message);
      return res.status(status).json(response);
    }
  });

  // Error handling for malformed JSON bodies and other unexpected server issues.
  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({
        error: 'Invalid JSON request body.',
      });
    }

    if (error) {
      const { status, message, response } = buildErrorResponse(error);
      console.error('Unexpected server error:', message);
      return res.status(status).json(response);
    }

    return next();
  });

  return app;
}

const app = createApp();

function startServer(port = DEFAULT_PORT) {
  return app.listen(port, () => {
    console.log(`AI backend running on port ${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  createApp,
  startServer,
};
