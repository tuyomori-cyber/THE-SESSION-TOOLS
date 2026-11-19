const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function event() {
  const listeners = [];
  return { addListener(fn) { listeners.push(fn); }, emit(...args) { return listeners.map((fn) => fn(...args)); } };
}
async function flush() { for (let i = 0; i < 8; i++) await new Promise(setImmediate); }

async function run() {
  const tab = { id: 1, windowId: 2, active: true, url: "https://thesession.org/tunes" };
  const window = { id: 2, focused: true, state: "normal", tabs: [tab] };
  const saved = {};
  const port = { onMessage: event(), onDisconnect: event(), postMessage() {} };
  const browser = {
    storage: { local: { async get(defaults) { return { ...defaults, ...saved }; }, async set(value) { Object.assign(saved, value); } } },
    runtime: { onMessage: event(), onMessageExternal: event(), connectNative() { return port; }, getURL(name) { return `moz-extension://test/${name}`; } },
    tabs: { onActivated: event(), onUpdated: event(), onRemoved: event(), async query() { return [tab]; }, async sendMessage() {} },
    windows: { onRemoved: event(), onFocusChanged: event(), async getAll() { return [window]; } },
    webRequest: { onBeforeRequest: event() }
  };
  const definition = JSON.parse(fs.readFileSync("extension/voice-commands.json", "utf8"));
  const fetch = async (url) => ({ ok: url === "moz-extension://test/voice-commands.json", async json() { return definition; } });
  const context = vm.createContext({ browser, fetch, console, URL, Date, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(fs.readFileSync("extension/background.js", "utf8"), context);
  await flush();
  const manager = { id: "foxbook-exchange-manager@foxbook.example" };
  const other = { id: "other@example.invalid" };
  const request = (message, sender = manager) => browser.runtime.onMessageExternal.emit(message, sender)[0];
  assert.equal((await request({ version: 1, type: "getCommands" }, other)).error, "UNAUTHORIZED");
  const commands = await request({ version: 1, type: "getCommands" });
  assert.equal(commands.definition.appId, "the_session_tools");
  assert.equal(commands.definition.commands[0].id, "tempo.increase.small");
  const execute = { version: 1, type: "execute", commandId: "tempo.increase.small" };
  assert.equal((await request(execute, other)).error, "UNAUTHORIZED");
  assert.equal((await request({ ...execute, delta: 999 })).error, "INVALID_REQUEST");
  assert.equal((await request({ ...execute, commandId: "play" })).error, "INVALID_REQUEST");
  assert.equal(saved.bpm, undefined);
  const result = await request(execute);
  assert.equal(result.ok, true);
  assert.equal(result.result.bpm, 115);
  assert.equal(result.result.changed, true);
  assert.equal(saved.bpm, 115);
  window.focused = false;
  assert.equal((await request(execute)).error, "TARGET_INACTIVE");
  assert.equal(saved.bpm, 115);
  window.focused = true;
  await browser.runtime.onMessage.emit({ type: "setBpm", bpm: 300 }, { tab })[0];
  const atLimit = await request(execute);
  assert.equal(atLimit.result.bpm, 300);
  assert.equal(atLimit.result.changed, false);
  vm.runInContext("if (inactivityTimer) clearTimeout(inactivityTimer)", context);
  process.stdout.write("external voice API: OK\n");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
