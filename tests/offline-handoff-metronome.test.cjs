const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function event() {
  const listeners = [];
  return { addListener(fn) { listeners.push(fn); }, emit(...args) { return listeners.map((fn) => fn(...args)); } };
}
async function flush() { for (let i = 0; i < 8; i++) await new Promise(setImmediate); }

async function run() {
  const tab = { id: 1, windowId: 2, active: true, url: "about:neterror?e=dnsNotFound" };
  const window = { id: 2, focused: true, state: "normal", tabs: [tab] };
  const sent = [];
  const actionChanges = [];
  const port = { onMessage: event(), onDisconnect: event(), postMessage(message) { sent.push(message); } };
  const browser = {
    storage: { local: { async get(defaults) { return defaults; }, async set() {} } },
    runtime: { onMessage: event(), connectNative() { return port; } },
    tabs: { onActivated: event(), onUpdated: event(), onRemoved: event(), async query() { return [tab]; }, async sendMessage() {} },
    windows: { onRemoved: event(), onFocusChanged: event(), async getAll() { return [window]; } },
    webRequest: { onBeforeRequest: event() },
    action: { async enable(id) { actionChanges.push(["enable", id]); }, async disable(id) { actionChanges.push(["disable", id]); } }
  };
  const gain = { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  class AudioContext {
    constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
    createGain() { return gain; }
    createOscillator() { return { frequency: { setValueAtTime() {} }, connect() { return gain; }, start() {}, stop() {} }; }
  }
  const context = vm.createContext({ browser, AudioContext, console, URL, Date, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(fs.readFileSync("extension/background.js", "utf8"), context);
  await flush();
  const send = (type, extra = {}, sender = {}) => browser.runtime.onMessage.emit({ type, ...extra }, sender)[0];
  const speech = (name, extra = {}) => port.onMessage.emit({ version: 1, event: name, ...extra });
  const state = () => vm.runInContext("publicState()", context);
  browser.webRequest.onBeforeRequest.emit({ type: "main_frame", tabId: 1 });

  await send("offlinePlay");
  assert.equal(state().audioActuallyPlaying, true);
  await send("setBpm", { bpm: 137 });
  await send("setSubdivision", { subdivision: 3 });
  assert.equal(state().bpm, 137);
  assert.equal(state().subdivision, 3);
  await send("openOfflineTuner");
  speech("wakeword_stopped");
  speech("tuner_started", { tunerId: "offline" });
  await flush();
  assert.equal(state().tunerStatus, "active");

  tab.url = "https://thesession.org/tunes";
  let handoffFinished = false;
  const handoff = send("onlinePageReady", {}, { tab }).then(() => { handoffFinished = true; });
  await flush();
  assert.equal(state().audioActuallyPlaying, false);
  assert.equal(sent.at(-1).action, "stop_tuner");
  assert.equal(handoffFinished, false, "online panel must wait for microphone release");
  assert.equal(actionChanges.some(([action]) => action === "disable"), false);
  assert.equal((await send("getOfflineTunerState")).available, false);
  speech("tuner_stopped", { tunerId: "offline" });
  await handoff;
  assert.deepEqual(actionChanges.at(-1), ["disable", 1]);
  assert.equal(state().tunerStatus, "idle");
  assert.equal((await send("getOfflineTunerState")).mode, "online");
  assert.equal(state().bpm, 137);

  // A failed retry does not end the offline session; a later successful page does.
  tab.url = "about:neterror?e=netOffline";
  browser.webRequest.onBeforeRequest.emit({ type: "main_frame", tabId: 1 });
  assert.equal((await send("getOfflineTunerState")).available, true);
  await send("offlinePlay");
  assert.equal(state().audioActuallyPlaying, true);
  await send("openOfflineTuner");
  speech("wakeword_stopped");
  tab.url = "https://thesession.org/";
  const pendingHandoff = send("onlinePageReady", {}, { tab });
  await flush();
  speech("tuner_started", { tunerId: "late" });
  await flush();
  assert.equal(sent.at(-1).action, "stop_tuner");
  speech("tuner_stopped", { tunerId: "late" });
  await pendingHandoff;
  assert.equal(state().audioActuallyPlaying, false);

  // A stop already requested from the popup still has to complete before handoff.
  tab.url = "about:neterror?e=dnsNotFound";
  browser.webRequest.onBeforeRequest.emit({ type: "main_frame", tabId: 1 });
  await send("openOfflineTuner");
  speech("wakeword_stopped");
  speech("tuner_started", { tunerId: "closing" });
  await flush();
  await send("closeTuner");
  tab.url = "https://thesession.org/";
  let afterStopFinished = false;
  const afterStop = send("onlinePageReady", {}, { tab }).then(() => { afterStopFinished = true; });
  await flush();
  assert.equal(afterStopFinished, false);
  speech("tuner_stopped", { tunerId: "closing" });
  await afterStop;
  vm.runInContext("if (inactivityTimer) clearTimeout(inactivityTimer)", context);
  process.stdout.write("offline handoff and metronome: OK\n");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
