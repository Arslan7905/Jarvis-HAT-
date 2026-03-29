const SUPPORTED_APPS = {
  chrome: {
    key: 'chrome',
    label: 'Chrome',
    processName: 'chrome.exe',
    windowsCandidates: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
  },
  edge: {
    key: 'edge',
    label: 'Microsoft Edge',
    processName: 'msedge.exe',
    windowsCandidates: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
  },
  notepad: {
    key: 'notepad',
    label: 'Notepad',
    processName: 'notepad.exe',
    windowsCandidates: ['notepad.exe'],
  },
  calculator: {
    key: 'calculator',
    label: 'Calculator',
    processName: 'CalculatorApp.exe',
    windowsCandidates: ['calc.exe'],
  },
  explorer: {
    key: 'explorer',
    label: 'File Explorer',
    processName: 'explorer.exe',
    windowsCandidates: ['explorer.exe'],
  },
  vscode: {
    key: 'vscode',
    label: 'Visual Studio Code',
    processName: 'Code.exe',
    windowsCandidates: [
      'C:\\Users\\HP\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    ],
  },
  spotify: {
    key: 'spotify',
    label: 'Spotify',
    processName: 'Spotify.exe',
    windowsCandidates: [
      'C:\\Users\\HP\\AppData\\Roaming\\Spotify\\Spotify.exe',
    ],
  },
};

function getSupportedApp(appKey) {
  return SUPPORTED_APPS[appKey] || null;
}

module.exports = {
  SUPPORTED_APPS,
  getSupportedApp,
};
