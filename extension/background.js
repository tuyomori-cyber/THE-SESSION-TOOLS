/* global browser */

const DEFAULT_BPM = 110;
const MIN_BPM = 30;
const MAX_BPM = 300;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const SCHEDULER_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.2;
const DEFAULT_VOLUME = 0.7;
const MAX_VOLUME = 1.5;
const DEFAULT_SUBDIVISION = 1;
const SUBDIVISIONS = [1, 2, 3, 4];
const SOUND_PRESETS = {
  beep: { type: "sine", frequency: 1000, duration: 0.05, level: 0.4 },
  wood: { type: "triangle", frequency: 360, duration: 0.085, level: 0.55 },
  sharp: { type: "square", frequency: 1600, duration: 0.035, level: 0.24 }
};

const state = {
  bpm: DEFAULT_BPM,
  userWantsPlayback: false,
  audioActuallyPlaying: false,
  autoResume: true,
  volume: DEFAULT_VOLUME,
  sound: "beep",
  subdivision: DEFAULT_SUBDIVISION
};

let initialized = false;
let initializePromise;
let audioContext;
let schedulerId;
let nextTickAt = 0;
let nextSubdivisionIndex = 0;
let inactivityGeneration = 0;
let inactivityTimer;
let sessionIsActive = false;
const visibilityByTabId = new Map();

function publicState() {
  return { ...state };
}

async function initialize() {
  if (initialized) return;
  if (!initializePromise) {
    initializePromise = browser.storage.local.get({ bpm: DEFAULT_BPM, autoResume: true, volume: DEFAULT_VOLUME, sound: "beep", subdivision: DEFAULT_SUBDIVISION })
      .then((saved) => {
        state.bpm = clampBpm(saved.bpm);
        state.autoResume = Boolean(saved.autoResume);
        state.volume = clampVolume(saved.volume);
        state.sound = sanitizeSound(saved.sound);
        state.subdivision = sanitizeSubdivision(saved.subdivision);
        initialized = true;
      });
  }
  await initializePromise;
}

function clampBpm(value) {
  const bpm = Number(value);
  if (!Number.isFinite(bpm)) return DEFAULT_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

function clampVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return DEFAULT_VOLUME;
  return Math.min(MAX_VOLUME, Math.max(0, volume));
}

function sanitizeSound(value) {
  return Object.hasOwn(SOUND_PRESETS, value) ? value : "beep";
}

function sanitizeSubdivision(value) {
  const subdivision = Number(value);
  return SUBDIVISIONS.includes(subdivision) ? subdivision : DEFAULT_SUBDIVISION;
}

function ensureAudioContext() {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function scheduleClick(when, accent) {
  const preset = SOUND_PRESETS[state.sound];
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = preset.type;
  oscillator.frequency.setValueAtTime(preset.frequency * (accent ? 1.2 : 1), when);
  const peak = Math.max(0.0001, preset.level * state.volume * (accent ? 1.25 : 1));
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + preset.duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(when);
  oscillator.stop(when + preset.duration + 0.01);
}

function schedule() {
  while (nextTickAt < audioContext.currentTime + SCHEDULE_AHEAD_SECONDS) {
    scheduleClick(nextTickAt, nextSubdivisionIndex === 0);
    nextSubdivisionIndex = (nextSubdivisionIndex + 1) % state.subdivision;
    nextTickAt += (60 / state.bpm) / state.subdivision;
  }
}

async function startAudio() {
  await initialize();
  if (state.audioActuallyPlaying) return;
  const sessionTabs = await getSessionTabs();
  if (sessionTabs.length === 0) {
    state.userWantsPlayback = false;
    await broadcastState();
    return;
  }
  const context = ensureAudioContext();
  if (context.state !== "running") await context.resume();
  if (schedulerId) return;
  nextTickAt = context.currentTime + 0.05;
  nextSubdivisionIndex = 0;
  schedulerId = setInterval(schedule, SCHEDULER_INTERVAL_MS);
  schedule();
  state.audioActuallyPlaying = true;
  await broadcastState();
}

async function stopAudio({ clearIntent = false } = {}) {
  if (clearIntent) state.userWantsPlayback = false;
  if (schedulerId) clearInterval(schedulerId);
  schedulerId = undefined;
  state.audioActuallyPlaying = false;
  await broadcastState();
}

async function broadcastState() {
  const tabs = await getSessionTabs();
  await Promise.all(tabs.map((tab) => browser.tabs.sendMessage(tab.id, {
    type: "stateChanged",
    state: publicState()
  }).catch(() => undefined)));
}

async function setBpm(value) {
  await initialize();
  state.bpm = clampBpm(value);
  await browser.storage.local.set({ bpm: state.bpm });
  await broadcastState();
  return publicState();
}

async function adjustBpm(delta) {
  await initialize();
  return setBpm(state.bpm + Number(delta));
}

async function setVolume(value) {
  await initialize();
  state.volume = clampVolume(value);
  await browser.storage.local.set({ volume: state.volume });
  await broadcastState();
  return publicState();
}

async function setSound(value) {
  await initialize();
  state.sound = sanitizeSound(value);
  await browser.storage.local.set({ sound: state.sound });
  await broadcastState();
  return publicState();
}

async function setSubdivision(value) {
  await initialize();
  state.subdivision = sanitizeSubdivision(value);
  nextSubdivisionIndex = 0;
  await browser.storage.local.set({ subdivision: state.subdivision });
  await broadcastState();
  return publicState();
}

async function setAutoResume(value) {
  await initialize();
  state.autoResume = Boolean(value);
  await browser.storage.local.set({ autoResume: state.autoResume });
  await broadcastState();
  return publicState();
}

function setInactivityTimer() {
  inactivityGeneration += 1;
  const generation = inactivityGeneration;
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    if (generation !== inactivityGeneration || sessionIsActive || !state.userWantsPlayback) return;
    stopAudio().catch(console.error);
  }, INACTIVITY_TIMEOUT_MS);
}

async function refreshSessionActivity() {
  const windows = await browser.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const isActive = windows.some((window) => window.focused && window.state !== "minimized" &&
    window.tabs.some((tab) => tab.active && isSessionUrl(tab.url) && visibilityByTabId.get(tab.id) !== false));
  if (isActive === sessionIsActive) return;
  sessionIsActive = isActive;
  inactivityGeneration += 1;
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = undefined;
  if (sessionIsActive) {
    if (state.userWantsPlayback && !state.audioActuallyPlaying && state.autoResume) await startAudio();
  } else {
    setInactivityTimer();
  }
}

function isSessionUrl(url = "") {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "thesession.org" || hostname === "www.thesession.org";
  } catch (_) {
    return false;
  }
}

async function getSessionTabs() {
  const tabs = await browser.tabs.query({});
  return tabs.filter((tab) => isSessionUrl(tab.url));
}

browser.runtime.onMessage.addListener(async (message, sender) => {
  await initialize();
  switch (message?.type) {
    case "getState":
      return publicState();
    case "setBpm":
      return setBpm(message.bpm);
    case "adjustBpm":
      return adjustBpm(message.delta);
    case "setAutoResume":
      return setAutoResume(message.autoResume);
    case "setVolume":
      return setVolume(message.volume);
    case "setSound":
      return setSound(message.sound);
    case "setSubdivision":
      return setSubdivision(message.subdivision);
    case "play":
      state.userWantsPlayback = true;
      await startAudio();
      return publicState();
    case "stop":
      await stopAudio({ clearIntent: true });
      return publicState();
    case "visibility":
      if (sender.tab?.id !== undefined) visibilityByTabId.set(sender.tab.id, Boolean(message.visible));
      await refreshSessionActivity();
      return publicState();
    case "heartbeat":
      // Content-script heartbeats keep this Firefox MV3 event page alive.
      return undefined;
    case "sessionPageGone":
      // pagehide fires before the closing tab disappears from tabs.query().
      setTimeout(() => {
        getSessionTabs().then(async (tabs) => {
          if (tabs.length === 0) await stopAudio({ clearIntent: true });
          else await refreshSessionActivity();
        }).catch(console.error);
      }, 100);
      return undefined;
    default:
      return undefined;
  }
});

browser.tabs.onActivated.addListener(() => { refreshSessionActivity().catch(console.error); });
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") visibilityByTabId.delete(tabId);
  refreshSessionActivity().catch(console.error);
});
browser.tabs.onRemoved.addListener((tabId) => {
  visibilityByTabId.delete(tabId);
  getSessionTabs().then(async (tabs) => {
    if (tabs.length === 0) await stopAudio({ clearIntent: true });
    else await refreshSessionActivity();
  }).catch(console.error);
});
browser.windows.onFocusChanged.addListener(() => { refreshSessionActivity().catch(console.error); });
if (browser.windows.onBoundsChanged) {
  browser.windows.onBoundsChanged.addListener(() => { refreshSessionActivity().catch(console.error); });
}

initialize().then(() => refreshSessionActivity()).catch(console.error);
