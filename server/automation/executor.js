const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getSupportedApp } = require('./catalog');

const execFileAsync = promisify(execFile);

function ensureWindowsPlatform() {
  if (process.platform !== 'win32') {
    throw new Error('Laptop automation is only implemented for Windows right now.');
  }
}

function ensureAllowedRealExecution() {
  if (process.env.AUTOMATION_REAL_ENABLED !== 'true') {
    throw new Error(
      'Real laptop automation is disabled on this server. Set AUTOMATION_REAL_ENABLED=true to enable it.'
    );
  }
}

async function runCommand(file, args = []) {
  return execFileAsync(file, args, {
    windowsHide: true,
  });
}

function resolveWindowsAppPath(app) {
  return (
    app.windowsCandidates.find((candidate) => fs.existsSync(candidate)) ||
    app.windowsCandidates[0]
  );
}

async function executeOpenApp(action) {
  const app = getSupportedApp(action.payload?.app);

  if (!app) {
    throw new Error('Requested app is not supported.');
  }

  const appPath = resolveWindowsAppPath(app);
  await runCommand(appPath, []);

  return {
    ok: true,
    status: 'success',
    message: `${app.label} was opened.`,
    data: {
      operation: 'open_app',
      app: app.key,
    },
  };
}

async function executeCloseApp(action) {
  const app = getSupportedApp(action.payload?.app);

  if (!app) {
    throw new Error('Requested app is not supported.');
  }

  await runCommand('taskkill.exe', ['/IM', app.processName, '/F']);

  return {
    ok: true,
    status: 'success',
    message: `${app.label} was closed.`,
    data: {
      operation: 'close_app',
      app: app.key,
    },
  };
}

async function executeOpenUrl(action) {
  const url = String(action.payload?.url || '').trim();

  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Only http and https URLs are allowed.');
  }

  await runCommand('rundll32.exe', ['url.dll,FileProtocolHandler', url]);

  return {
    ok: true,
    status: 'success',
    message: `Opened ${url}.`,
    data: {
      operation: 'open_url',
      url,
    },
  };
}

async function executeVolumeKey(virtualKeyCode, message, operation) {
  await runCommand('powershell.exe', [
    '-NoProfile',
    '-Command',
    `(New-Object -ComObject WScript.Shell).SendKeys([char]${virtualKeyCode})`,
  ]);

  return {
    ok: true,
    status: 'success',
    message,
    data: {
      operation,
    },
  };
}

async function executeSleep() {
  await runCommand('powershell.exe', [
    '-NoProfile',
    '-Command',
    'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState("Suspend", $false, $false)',
  ]);

  return {
    ok: true,
    status: 'success',
    message: 'The laptop is going to sleep.',
    data: {
      operation: 'sleep',
    },
  };
}

async function executeShutdown() {
  await runCommand('shutdown.exe', ['/s', '/t', '0']);
  return {
    ok: true,
    status: 'success',
    message: 'The laptop is shutting down.',
    data: {
      operation: 'shutdown',
    },
  };
}

async function executeRestart() {
  await runCommand('shutdown.exe', ['/r', '/t', '0']);
  return {
    ok: true,
    status: 'success',
    message: 'The laptop is restarting.',
    data: {
      operation: 'restart',
    },
  };
}

async function executeLock() {
  await runCommand('rundll32.exe', ['user32.dll,LockWorkStation']);
  return {
    ok: true,
    status: 'success',
    message: 'The laptop was locked.',
    data: {
      operation: 'lock',
    },
  };
}

function validateLaptopAction(action) {
  if (!action || action.type !== 'laptop') {
    throw new Error('Laptop automation requires a structured laptop action.');
  }

  if (!action.target?.operation) {
    throw new Error('Laptop action operation is required.');
  }
}

async function executeLaptopAction(action) {
  validateLaptopAction(action);
  ensureWindowsPlatform();
  ensureAllowedRealExecution();

  switch (action.target.operation) {
    case 'shutdown':
      return executeShutdown();
    case 'restart':
      return executeRestart();
    case 'sleep':
      return executeSleep();
    case 'lock':
      return executeLock();
    case 'open_app':
      return executeOpenApp(action);
    case 'close_app':
      return executeCloseApp(action);
    case 'open_url':
      return executeOpenUrl(action);
    case 'volume_up':
      return executeVolumeKey(175, 'Raised the laptop volume.', 'volume_up');
    case 'volume_down':
      return executeVolumeKey(174, 'Lowered the laptop volume.', 'volume_down');
    case 'mute':
      return executeVolumeKey(173, 'Muted the laptop volume.', 'mute');
    case 'unmute':
      return executeVolumeKey(173, 'Toggled laptop mute.', 'unmute');
    default:
      throw new Error('Unsupported laptop automation action.');
  }
}

module.exports = {
  executeLaptopAction,
};
