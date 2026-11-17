/* global browser */

const DEFAULT_BPM = 110;
const MIN_BPM = 30;
const MAX_BPM = 300;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const SCHEDULER_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.2;
const DEFAULT_VOLUME = 0.7;
const MAX_VOLUME = 1.5;
const MIN_GAIN = 0.0001;
const DEFAULT_SUBDIVISION = 1;
const SUBDIVISIONS = [1, 2, 3, 4];
const SOUND_PRESETS = {
  // `level` is deliberately capped so a 150% accented click remains below 1.0.
  // The short hold makes the peak easier to hear than an immediate full decay.
  wood: { type: "triangle", frequency: 720, duration: 0.075, hold: 0.013, level: 0.32 },
  sharp: { type: "square", frequency: 1800, duration: 0.045, hold: 0.008, level: 0.20 },
  crisp: { type: "square", frequency: 1200, duration: 0.06, hold: 0.014, level: 0.24 }
};

const state = {
  bpm: DEFAULT_BPM,
  userWantsPlayback: false,
  audioActuallyPlaying: false,
  autoResume: true,
  volume: DEFAULT_VOLUME,
  sound: "crisp",
  subdivision: DEFAULT_SUBDIVISION,
  voiceStatus: "unavailable"
};

let speechPort;
let voiceRecordingId;
let voiceStopTimer;

function connectSpeech() {
  if (speechPort) return;
  try {
    speechPort = browser.runtime.connectNative("foxbook_speech");
    speechPort.onMessage.addListener((message) => {
      if (message?.version !== 1 || typeof message.event !== "string") return;
      if (message.event === "status") {
        speechPort.postMessage({ version: 1, action: "prepare_microphone" });
      } else if (message.event === "microphone_prepared") {
        speechPort.postMessage({ version: 1, action: "prepare_engine", engine: "reazonspeech_k2" });
      } else if (message.event === "engine_prepared") {
        speechPort.postMessage({ version: 1, action: "start_wakeword" });
      } else if (message.event === "wakeword_waiting") {
        state.voiceStatus = "waiting";
        broadcastState().catch(console.error);
      } else if (message.event === "wakeword_detected") {
        state.voiceStatus = "listening";
        broadcastState().catch(console.error);
        speechPort.postMessage({ version: 1, action: "start_recording" });
      } else if (message.event === "started") {
        voiceRecordingId = message.recordingId;
        voiceStopTimer = setTimeout(() => {
          if (voiceRecordingId) speechPort?.postMessage({ version: 1, action: "stop_recording", recordingId: voiceRecordingId });
        }, 3000);
      } else if (message.event === "result") {
        if (voiceStopTimer) clearTimeout(voiceStopTimer);
        voiceRecordingId = undefined;
        const command = String(message.text ?? "").replaceAll(/\s/g, "");
        if (command === "再生") {
          state.userWantsPlayback = true;
          startAudio().catch(console.error);
        } else if (command === "停止") {
          stopAudio({ clearIntent: true }).catch(console.error);
        } else if (command === "テンポ少し上げて") {
          adjustBpm(5).catch(console.error);
        } else if (command === "テンポ少し下げて") {
          adjustBpm(-5).catch(console.error);
        } else if (command === "音量少し上げて") {
          setVolume(state.volume + 0.1).catch(console.error);
        } else if (command === "音量少し下げて") {
          setVolume(state.volume - 0.1).catch(console.error);
        } else {
          const divisions = {
            "分割ビート": 1,
            "分割八分": 2,
            "分割三連符": 3,
            "分割三連単": 3,
            "分割十六分": 4,
            "分割十六部": 4
          };
          const bpm = parseVoiceBpm(command);
          const volume = parseVoiceVolume(command);
          if (Object.hasOwn(divisions, command)) setSubdivision(divisions[command]).catch(console.error);
          else if (bpm !== undefined) setBpm(bpm).catch(console.error);
          else if (volume !== undefined) setVolume(volume / 100).catch(console.error);
        }
        speechPort.postMessage({ version: 1, action: "start_wakeword" });
      } else if (message.event === "error") {
        state.voiceStatus = "error";
        broadcastState().catch(console.error);
      }
    });
    speechPort.onDisconnect.addListener(() => {
      speechPort = undefined;
      state.voiceStatus = "error";
      broadcastState().catch(console.error);
    });
    speechPort.postMessage({ version: 1, action: "get_status" });
  } catch (_) {
    state.voiceStatus = "error";
    broadcastState().catch(console.error);
  }
}

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
    initializePromise = browser.storage.local.get({ bpm: DEFAULT_BPM, autoResume: true, volume: DEFAULT_VOLUME, sound: "crisp", subdivision: DEFAULT_SUBDIVISION })
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
  return Object.hasOwn(SOUND_PRESETS, value) ? value : "crisp";
}

function sanitizeSubdivision(value) {
  const subdivision = Number(value);
  return SUBDIVISIONS.includes(subdivision) ? subdivision : DEFAULT_SUBDIVISION;
}

function parseVoiceBpm(text) {
  const digits = { "〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  const match = String(text ?? "").toLowerCase().replaceAll(/\s/g, "").match(/(?:bpm|テンポ)([0-9〇零一二三四五六七八九十百]+)/u);
  if (!match) return undefined;
  const value = match[1];
  let bpm;
  if (/^[0-9]+$/.test(value)) bpm = Number(value);
  else if (![...value].some((character) => character === "十" || character === "百")) bpm = Number([...value].map((character) => digits[character]).join(""));
  else {
    let total = 0;
    let digit;
    for (const character of value) {
      if (Object.hasOwn(digits, character)) digit = digits[character];
      else { total += (digit ?? 1) * (character === "十" ? 10 : 100); digit = undefined; }
    }
    bpm = total + (digit ?? 0);
  }
  return Number.isInteger(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : undefined;
}

function parseVoiceVolume(text) {
  const match = String(text ?? "").replaceAll(/\s/g, "").match(/^音量([0-9〇零一二三四五六七八九十百]+)(?:％|%)?$/u);
  if (!match) return undefined;
  const digits = { "〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  const value = match[1];
  let number = /^[0-9]+$/.test(value) ? Number(value) : 0;
  if (!/^[0-9]+$/.test(value)) {
    let digit;
    for (const character of value) {
      if (Object.hasOwn(digits, character)) digit = digits[character];
      else { number += (digit ?? 1) * (character === "十" ? 10 : 100); digit = undefined; }
    }
    number += digit ?? 0;
  }
  return Number.isInteger(number) && number >= 0 && number <= 150 ? number : undefined;
}

function ensureAudioContext() {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function scheduleClick(when, accent) {
  const preset = SOUND_PRESETS[state.sound];
  const gain = audioContext.createGain();
  const oscillator = audioContext.createOscillator();
  const attack = preset.attack ?? 0.002;
  oscillator.type = preset.type;
  oscillator.frequency.setValueAtTime(preset.frequency * (accent ? 1.2 : 1), when);
  const peak = Math.max(MIN_GAIN, preset.level * state.volume * (accent ? 1.25 : 1));
  const holdUntil = when + attack + preset.hold;
  gain.gain.setValueAtTime(MIN_GAIN, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + attack);
  gain.gain.setValueAtTime(peak, holdUntil);
  gain.gain.exponentialRampToValueAtTime(MIN_GAIN, when + preset.duration);
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

async function getSessionTabs({ excludingTabId } = {}) {
  const tabs = await browser.tabs.query({});
  return tabs.filter((tab) => tab.id !== excludingTabId && isSessionUrl(tab.url));
}

async function refreshOrStopForSessionTabs(closingTabId) {
  const tabs = await getSessionTabs({ excludingTabId: closingTabId });
  if (tabs.length === 0) {
    await stopAudio({ clearIntent: true });
  } else {
    await refreshSessionActivity();
  }
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
    default:
      return undefined;
  }
});

browser.tabs.onActivated.addListener(() => { refreshSessionActivity().catch(console.error); });
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") visibilityByTabId.delete(tabId);
  refreshOrStopForSessionTabs().catch(console.error);
});
browser.tabs.onRemoved.addListener((tabId) => {
  visibilityByTabId.delete(tabId);
  // Exclude the closing ID even if tabs.query() briefly still returns it.
  refreshOrStopForSessionTabs(tabId).catch(console.error);
});
browser.windows.onRemoved.addListener(() => {
  // Covers the last tab disappearing as part of closing an entire window.
  refreshOrStopForSessionTabs().catch(console.error);
});
browser.windows.onFocusChanged.addListener(() => { refreshSessionActivity().catch(console.error); });

initialize().then(async () => {
  await refreshSessionActivity();
  connectSpeech();
}).catch(console.error);
