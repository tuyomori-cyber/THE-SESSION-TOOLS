const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function event() { const listeners = []; return { addListener(fn) { listeners.push(fn); }, emit(...args) { for (const fn of listeners) fn(...args); } }; }
async function flush() { for (let i = 0; i < 8; i++) await new Promise(setImmediate); }

(async () => {
  const tab = { id: 1, windowId: 2, active: true, url: 'https://thesession.org/tunes' };
  const window = { id: 2, focused: false, state: 'normal', tabs: [tab] };
  const sent = [];
  const port = { onMessage: event(), onDisconnect: event(), postMessage(message) { sent.push(message); } };
  const browser = {
    storage: { local: { async get(defaults) { return defaults; }, async set() {} } },
    runtime: { onMessage: event(), connectNative() { return port; } },
    tabs: { onActivated: event(), onUpdated: event(), onRemoved: event(), async query() { return [tab]; }, async sendMessage() {} },
    windows: { onRemoved: event(), onFocusChanged: event(), async getAll() { return [window]; } }
  };
  const ctx = vm.createContext({ browser, console, URL, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(fs.readFileSync('extension/background.js', 'utf8'), ctx);
  await flush();
  const speech = (name, extra = {}) => port.onMessage.emit({ version: 1, event: name, ...extra });
  const action = () => sent.at(-1)?.action;
  speech('engine_prepared');
  await flush();
  assert.notEqual(action(), 'start_wakeword', 'inactive initialization must not start capture');
  window.focused = true;
  browser.windows.onFocusChanged.emit(2);
  await flush();
  assert.equal(action(), 'start_wakeword');
  speech('wakeword_waiting');
  await flush();
  window.focused = false;
  browser.windows.onFocusChanged.emit(-1);
  await flush();
  assert.equal(action(), 'stop_wakeword');
  speech('wakeword_waiting');
  assert.equal(action(), 'stop_wakeword', 'late start must be stopped');
  speech('wakeword_detected');
  assert.equal(action(), 'stop_wakeword', 'late detection must not start recording');
  window.focused = true;
  browser.windows.onFocusChanged.emit(2);
  await flush();
  speech('wakeword_waiting');
  await flush();
  browser.tabs.onRemoved.emit(1);
  await flush();
  assert.equal(action(), 'stop_wakeword', 'closing last tab releases capture even if windows still reports it');
  speech('started', { recordingId: 'late-recording' });
  assert.equal(action(), 'cancel_recording', 'late recording start is cancelled');
  vm.runInContext('if (inactivityTimer) clearTimeout(inactivityTimer)', ctx);
})().catch(error => { console.error(error); process.exitCode = 1; });
