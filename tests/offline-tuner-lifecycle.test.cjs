const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function event() {
  const listeners = [];
  return { addListener(fn) { listeners.push(fn); }, emit(...args) { for (const fn of listeners) fn(...args); } };
}

async function flush() { for (let i = 0; i < 8; i++) await new Promise(setImmediate); }

async function run() {
  const tab = { id: 1, windowId: 2, active: true, url: "about:neterror?e=dnsNotFound" };
  const window = { id: 2, focused: true, state: "normal", tabs: [tab] };
  const sent = [];
  const port = { onMessage: event(), onDisconnect: event(), postMessage(message) { sent.push(message); } };
  const browser = {
    storage: { local: { async get(defaults) { return defaults; }, async set() {} } },
    runtime: { onMessage: event(), connectNative() { return port; } },
    tabs: { onActivated: event(), onUpdated: event(), onRemoved: event(), async query() { return [tab]; }, async sendMessage() {} },
    windows: { onRemoved: event(), onFocusChanged: event(), async getAll() { return [window]; } },
    webRequest: { onBeforeRequest: event() }
  };
  const context = vm.createContext({ browser, console, URL, Date, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(fs.readFileSync("extension/background.js", "utf8"), context);
  await flush();
  const dispatch = browser.runtime.onMessage;
  const speech = (name, extra = {}) => port.onMessage.emit({ version: 1, event: name, ...extra });
  const actions = () => sent.map((message) => message.action);
  const state = () => vm.runInContext("publicState()", context);

  browser.webRequest.onBeforeRequest.emit({ type: "main_frame", tabId: 1, url: "https://thesession.org/tunes" });
  const beforeStart = await vm.runInContext("offlineTunerAvailability()", context);
  assert.deepEqual(JSON.parse(JSON.stringify(beforeStart)), { available: true, mode: "offline" });

  dispatch.emit({ type: "openOfflineTuner" }, {});
  await flush();
  assert.equal(state().panelMode, "tuner");
  assert.equal(actions().at(-1), "stop_wakeword");
  speech("wakeword_stopped");
  assert.equal(actions().at(-1), "start_tuner");
  speech("tuner_started", { tunerId: "offline" });
  await flush();
  assert.equal(state().tunerStatus, "active");

  // Leaving the network-error tab invalidates offline ownership and releases the microphone.
  tab.url = "https://example.com/";
  browser.tabs.onUpdated.emit(1, { status: "loading", url: tab.url });
  await flush();
  assert.equal(actions().at(-1), "stop_tuner");
  speech("tuner_stopped", { tunerId: "offline" });
  await flush();
  assert.equal(state().panelMode, "metronome");
  vm.runInContext("if (inactivityTimer) clearTimeout(inactivityTimer)", context);
  process.stdout.write("offline tuner lifecycle: OK\n");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
