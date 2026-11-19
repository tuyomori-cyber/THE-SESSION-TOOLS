const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function event() {
  const listeners = [];
  return { addListener(fn) { listeners.push(fn); }, emit(...args) { for (const fn of listeners) fn(...args); } };
}

async function flush() { for (let i = 0; i < 8; i++) await new Promise(setImmediate); }

async function run() {
  const tab = { id: 1, windowId: 2, active: true, url: "https://thesession.org/tunes" };
  const window = { id: 2, focused: true, state: "normal", tabs: [tab] };
  const sent = [];
  const port = { onMessage: event(), onDisconnect: event(), postMessage(message) { sent.push(message); } };
  const browser = {
    storage: { local: { async get(defaults) { return defaults; }, async set() {} } },
    runtime: { onMessage: event(), connectNative() { return port; } },
    tabs: { onActivated: event(), onUpdated: event(), onRemoved: event(), async query() { return [tab]; }, async sendMessage() {} },
    windows: { onRemoved: event(), onFocusChanged: event(), async getAll() { return [window]; } }
  };
  const context = vm.createContext({ browser, console, URL, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(fs.readFileSync("extension/background.js", "utf8"), context);
  await flush();
  const speech = (name, extra = {}) => port.onMessage.emit({ version: 1, event: name, ...extra });
  const actions = () => sent.map((message) => message.action);
  const state = () => vm.runInContext("publicState()", context);

  speech("status");
  speech("microphone_prepared");
  speech("engine_prepared");
  await flush();
  assert.equal(actions().at(-1), "start_wakeword");
  speech("wakeword_waiting");

  window.focused = false;
  browser.windows.onFocusChanged.emit(-1);
  await flush();
  assert.equal(actions().at(-1), "stop_wakeword");
  assert.equal(state().voiceStatus, "paused");

  // A detection already in transit must not restart capture after suspension.
  speech("wakeword_detected");
  assert.equal(actions().at(-1), "stop_wakeword");
  speech("started", { recordingId: "late" });
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))),
    { version: 1, action: "cancel_recording", recordingId: "late" });
  speech("cancelled", { recordingId: "late" });

  window.focused = true;
  browser.windows.onFocusChanged.emit(2);
  await flush();
  assert.equal(actions().at(-1), "start_wakeword");
  speech("wakeword_detected");
  speech("started", { recordingId: "voice" });
  await flush();

  window.focused = false;
  browser.windows.onFocusChanged.emit(-1);
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(sent.slice(-2))), [
    { version: 1, action: "cancel_recording", recordingId: "voice" },
    { version: 1, action: "stop_wakeword" }
  ]);

  window.focused = true;
  browser.windows.onFocusChanged.emit(2);
  await flush();
  assert.notEqual(actions().at(-1), "start_wakeword");
  speech("cancelled", { recordingId: "voice" });
  await flush();
  assert.equal(actions().at(-1), "start_wakeword");
  vm.runInContext("if (inactivityTimer) clearTimeout(inactivityTimer)", context);
  process.stdout.write("voice inactive lifecycle: OK\n");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
