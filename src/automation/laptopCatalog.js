export const SUPPORTED_APPS = {
  chrome: {
    key: 'chrome',
    label: 'Chrome',
    aliases: ['chrome', 'google chrome', 'browser'],
  },
  edge: {
    key: 'edge',
    label: 'Microsoft Edge',
    aliases: ['edge', 'microsoft edge'],
  },
  notepad: {
    key: 'notepad',
    label: 'Notepad',
    aliases: ['notepad'],
  },
  calculator: {
    key: 'calculator',
    label: 'Calculator',
    aliases: ['calculator', 'calc'],
  },
  explorer: {
    key: 'explorer',
    label: 'File Explorer',
    aliases: ['file explorer', 'explorer', 'windows explorer'],
  },
  vscode: {
    key: 'vscode',
    label: 'Visual Studio Code',
    aliases: ['vscode', 'visual studio code', 'code editor', 'vs code', 'code'],
  },
  spotify: {
    key: 'spotify',
    label: 'Spotify',
    aliases: ['spotify'],
  },
};

export const URL_ALIASES = {
  youtube: {
    label: 'YouTube',
    url: 'https://www.youtube.com',
  },
  google: {
    label: 'Google',
    url: 'https://www.google.com',
  },
  gmail: {
    label: 'Gmail',
    url: 'https://mail.google.com',
  },
  github: {
    label: 'GitHub',
    url: 'https://github.com',
  },
  discord: {
    label: 'Discord',
    url: 'https://discord.com/app',
  },
  openai: {
    label: 'OpenAI',
    url: 'https://openai.com',
  },
};

const EDGE_PUNCTUATION_PATTERN = /^[`"'.,!?;:()-]+|[`"'.,!?;:()-]+$/g;
const QUOTE_PATTERN = /^[`"']+|[`"']+$/g;

function normalizeTarget(target) {
  return target.trim().toLowerCase().replace(EDGE_PUNCTUATION_PATTERN, '');
}

export function findSupportedApp(target) {
  const normalizedTarget = normalizeTarget(target);

  return Object.values(SUPPORTED_APPS).find((app) =>
    app.aliases.some((alias) => alias === normalizedTarget)
  );
}

export function resolveUrlTarget(target) {
  const normalizedTarget = normalizeTarget(target);
  const trimmedTarget = target.trim().replace(QUOTE_PATTERN, '');

  if (URL_ALIASES[normalizedTarget]) {
    return URL_ALIASES[normalizedTarget];
  }

  if (/^https?:\/\//i.test(trimmedTarget)) {
    return {
      label: trimmedTarget,
      url: trimmedTarget,
    };
  }

  if (/^[a-z0-9-]+\.[a-z]{2,}(?:\/.*)?$/i.test(trimmedTarget)) {
    return {
      label: trimmedTarget,
      url: `https://${trimmedTarget}`,
    };
  }

  return null;
}
