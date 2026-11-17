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
  const dispatch = browser.runtime.onMessage;
  const sendUI = (type) => dispatch.emit({ type }, { tab });
  const speech = (name, extra = {}) => port.onMessage.emit({ version: 1, event: name, ...extra });
  const actions = () => sent.map((message) => message.action);
  const state = () => vm.runInContext("publicState()", context);

  sendUI("openTuner");
  await flush();
  assert.equal(state().panelMode, "tuner");
  assert.equal(actions().at(-1), "stop_wakeword");
  speech("wakeword_stopped");
  assert.equal(actions().at(-1), "start_tuner");
  speech("tuner_started", { tunerId: "first" });
  await flush();
  assert.equal(state().tunerStatus, "active");

  window.focused = false;
  browser.windows.onFocusChanged.emit(-1);
  await flush();
  assert.equal(actions().at(-1), "stop_tuner");
  speech("tuner_stopped", { tunerId: "first" });
  await flush();
  assert.equal(state().tunerStatus, "paused");
  assert.equal(state().voiceStatus, "paused");

  window.focused = true;
  browser.windows.onFocusChanged.emit(2);
  await flush();
  assert.equal(actions().at(-1), "stop_wakeword");
  speech("wakeword_stopped");
  assert.equal(actions().at(-1), "start_tuner");
  speech("tuner_started", { tunerId: "second" });
  await flush();
  assert.equal(state().tunerStatus, "active");

  sendUI("closeTuner");
  await flush();
  assert.equal(state().panelMode, "metronome");
  assert.equal(actions().at(-1), "stop_tuner");
  speech("tuner_stopped", { tunerId: "second" });
  await flush();
  assert.equal(actions().at(-1), "start_wakeword");

  // Closing while the start request is in flight must release its later lease.
  sendUI("openTuner");
  await flush();
  speech("wakeword_stopped");
  sendUI("closeTuner");
  await flush();
  speech("tuner_started", { tunerId: "late" });
  await flush();
  assert.equal(actions().at(-1), "stop_tuner");
  assert.equal(sent.at(-1).tunerId, "late");
  speech("tuner_stopped", { tunerId: "late" });
  await flush();
  assert.equal(state().panelMode, "metronome");

  // Another client may acquire the microphone while the tuner is paused.
  sendUI("openTuner");
  await flush();
  speech("wakeword_stopped");
  speech("error", { code: "BUSY" });
  await flush();
  assert.equal(state().tunerStatus, "busy");
  const countBeforeRetry = sent.length;
  await flush();
  assert.equal(sent.length, countBeforeRetry);
  sendUI("resumeTuner");
  await flush();
  assert.equal(actions().at(-1), "stop_wakeword");
  speech("wakeword_stopped");
  speech("tuner_started", { tunerId: "retry" });
  await flush();
  assert.equal(state().tunerStatus, "active");
  tab.active = false;
  browser.tabs.onActivated.emit({ tabId: 3 });
  await flush();
  assert.equal(actions().at(-1), "stop_tuner");
  speech("tuner_stopped", { tunerId: "retry" });
  await flush();
  assert.equal(state().tunerStatus, "paused");
  sendUI("closeTuner");
  await flush();

  // Deactivation before KWS stop acknowledgement must not start capture.
  tab.active = true;
  browser.tabs.onActivated.emit({ tabId: 1 });
  await flush();
  sendUI("openTuner");
  await flush();
  window.state = "minimized";
  window.focused = false;
  browser.windows.onFocusChanged.emit(-1);
  await flush();
  const beforeAck = sent.length;
  speech("wakeword_stopped");
  await flush();
  assert.equal(sent.length, beforeAck);
  assert.equal(state().tunerStatus, "paused");
  window.state = "normal";
  window.focused = true;
  browser.windows.onFocusChanged.emit(2);
  await flush();
  assert.equal(actions().at(-1), "stop_wakeword");
  speech("wakeword_stopped");
  speech("tuner_started", { tunerId: "minimize" });
  await flush();
  sendUI("closeTuner");
  await flush();
  speech("tuner_stopped", { tunerId: "minimize" });
  await flush();
  vm.runInContext("if (inactivityTimer) clearTimeout(inactivityTimer)", context);
  process.stdout.write("tuner lifecycle: OK\n");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
