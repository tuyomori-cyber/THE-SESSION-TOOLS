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
const OFFLINE_TUNER_ACCESS_MS = 10 * 60 * 1000;
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
  voiceStatus: "unavailable",
  tunerStatus: "idle",
  panelMode: "metronome",
  tunerReferenceHz: 440,
  tunerFrequencyHz: null
};

let speechPort;
let voiceRecordingId;
let voiceStopTimer;
let voiceCancelRequested = false;
let tunerId;
let tunerStartRequested = false;
let tunerStopSent = false;
let tunerWanted = false;
let tunerOwner;
let tunerOwnerActive = false;
let activityRevision = 0;
let returnToMetronomeAfterTunerStop = false;
let offlinePlaybackOwner;
let offlineTunerReleaseTabId;
const onlineHandoffs = new Map();
const tunerReleaseWaiters = new Set();

function resolveTunerRelease() {
  if (tunerId || tunerStartRequested || tunerStopSent) return;
  if (!tunerWanted) offlineTunerReleaseTabId = undefined;
  for (const resolve of tunerReleaseWaiters) resolve();
  tunerReleaseWaiters.clear();
}

async function waitForTunerRelease() {
  if (!tunerId && !tunerStartRequested && !tunerStopSent) return;
  await new Promise((resolve) => tunerReleaseWaiters.add(resolve));
}

async function startTuner(tab, { offline = false } = {}) {
  if (tab?.id !== undefined && tab.windowId !== undefined && isTunerEligibleTab(tab)) {
    tunerOwner = { tabId: tab.id, windowId: tab.windowId, offline: offline || !isSessionUrl(tab.url) };
    if (tunerOwner.offline) offlineTunerReleaseTabId = tab.id;
  }
  if (!tunerOwner) {
    const windows = await browser.windows.getAll({ populate: true, windowTypes: ["normal"] });
    const focused = windows.find((window) => window.focused && window.state !== "minimized");
    const activeTab = focused?.tabs.find((candidate) => candidate.active && isSessionUrl(candidate.url));
    if (!activeTab) return;
    tunerOwner = { tabId: activeTab.id, windowId: focused.id };
  }
  tunerWanted = true;
  state.panelMode = "tuner";
  await refreshSessionActivity();
  await reconcileTuner();
}

async function requestTunerStart() {
  if (tunerStartRequested || tunerId || tunerStopSent || !tunerWanted || !tunerOwnerActive) return;
  tunerStartRequested = true;
  state.tunerStatus = "starting";
  await broadcastState();
  if (!speechPort) {
    connectSpeech();
    return;
  }
  speechPort.postMessage({ version: 1, action: "stop_wakeword" });
}

async function stopTuner({ returnToMetronome = false } = {}) {
  tunerWanted = false;
  tunerOwner = undefined;
  tunerOwnerActive = false;
  returnToMetronomeAfterTunerStop ||= returnToMetronome;
  if (returnToMetronome) state.panelMode = "metronome";
  await reconcileTuner();
  resolveTunerRelease();
}

async function reconcileTuner() {
  if (tunerWanted && tunerOwnerActive) {
    if (!tunerId && !tunerStartRequested && !tunerStopSent && state.tunerStatus !== "busy") await requestTunerStart();
    return;
  }
  state.tunerFrequencyHz = null;
  if (tunerId && speechPort && !tunerStopSent) {
    tunerStopSent = true;
    state.tunerStatus = "stopping";
    speechPort.postMessage({ version: 1, action: "stop_tuner", tunerId });
  } else if (!tunerId && !tunerStartRequested && !tunerStopSent) {
    state.tunerStatus = tunerWanted ? "paused" : "idle";
    if (tunerWanted) state.voiceStatus = "paused";
    if (!tunerWanted && returnToMetronomeAfterTunerStop) returnToMetronomeAfterTunerStop = false;
  }
  await broadcastState();
}

async function resumeWakewordIfActive() {
  const windows = await browser.windows.getAll({ populate: true, windowTypes: ["normal"] });
  if (tunerWanted || tunerId || tunerStartRequested || tunerStopSent || voiceCancelRequested || !speechPort) return;
  const active = windows.some((window) => window.focused && window.state !== "minimized" &&
    window.tabs.some((tab) => tab.active && isSessionUrl(tab.url) && visibilityByTabId.get(tab.id) !== false));
  if (active) {
    state.voiceStatus = "connected";
    speechPort.postMessage({ version: 1, action: "start_wakeword" });
  } else {
    state.voiceStatus = "paused";
  }
  await broadcastState();
}

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
        if (tunerStartRequested && tunerWanted && tunerOwnerActive) {
          speechPort.postMessage({ version: 1, action: "stop_wakeword" });
        } else {
          resumeWakewordIfActive().catch(console.error);
        }
      } else if (message.event === "wakeword_waiting") {
        if (tunerStartRequested) {
          speechPort.postMessage({ version: 1, action: "stop_wakeword" });
          return;
        }
        state.voiceStatus = "waiting";
        broadcastState().catch(console.error);
      } else if (message.event === "wakeword_stopped") {
        if (tunerStartRequested && tunerWanted && tunerOwnerActive) {
          speechPort.postMessage({ version: 1, action: "start_tuner" });
        } else {
          tunerStartRequested = false;
          resolveTunerRelease();
          if (tunerWanted) reconcileTuner().catch(console.error);
          else {
            reconcileTuner().catch(console.error);
            resumeWakewordIfActive().catch(console.error);
          }
        }
      } else if (message.event === "wakeword_detected") {
        if (!sessionIsActive) {
          speechPort.postMessage({ version: 1, action: "stop_wakeword" });
          state.voiceStatus = "paused";
          broadcastState().catch(console.error);
          return;
        }
        state.voiceStatus = "listening";
        broadcastState().catch(console.error);
        speechPort.postMessage({ version: 1, action: "start_recording" });
      } else if (message.event === "started") {
        voiceRecordingId = message.recordingId;
        if (!sessionIsActive) {
          voiceRecordingId = undefined;
          voiceCancelRequested = true;
          speechPort.postMessage({ version: 1, action: "cancel_recording", recordingId: message.recordingId });
          state.voiceStatus = "paused";
          broadcastState().catch(console.error);
          return;
        }
        voiceCancelRequested = false;
        voiceStopTimer = setTimeout(() => {
          if (voiceRecordingId) speechPort?.postMessage({ version: 1, action: "stop_recording", recordingId: voiceRecordingId });
        }, 3000);
      } else if (message.event === "result") {
        if (voiceStopTimer) clearTimeout(voiceStopTimer);
        voiceRecordingId = undefined;
        const command = String(message.text ?? "").replaceAll(/\s/g, "");
        const isTunerCommand = ["チューナー", "チューナー起動して", "チューナーを起動して", "十七"].includes(command);
        if (isTunerCommand) {
          startTuner().catch(console.error);
        } else if (command === "再生") {
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
        if (!isTunerCommand) resumeWakewordIfActive().catch(console.error);
      } else if (message.event === "cancelled") {
        if (voiceStopTimer) clearTimeout(voiceStopTimer);
        voiceStopTimer = undefined;
        voiceRecordingId = undefined;
        voiceCancelRequested = false;
        resumeWakewordIfActive().catch(console.error);
      } else if (message.event === "tuner_started") {
        tunerStartRequested = false;
        tunerId = message.tunerId;
        state.tunerStatus = "active";
        state.voiceStatus = "waiting";
        reconcileTuner().catch(console.error);
        broadcastState().catch(console.error);
      } else if (message.event === "tuner_wakeword_detected") {
        if (state.tunerStatus === "active" && message.tunerId === tunerId) {
          stopTuner({ returnToMetronome: true }).catch(console.error);
        }
      } else if (message.event === "tuner_pitch") {
        if (state.tunerStatus === "active" && message.tunerId === tunerId) {
          const frequency = message.frequencyHz;
          state.tunerFrequencyHz = typeof frequency === "number" && Number.isFinite(frequency) && frequency >= 55 && frequency <= 1200 ? frequency : null;
          broadcastState().catch(console.error);
        }
      } else if (message.event === "tuner_stopped") {
        tunerStartRequested = false;
        tunerStopSent = false;
        tunerId = undefined;
        resolveTunerRelease();
        state.tunerStatus = tunerWanted ? "paused" : "idle";
        state.tunerFrequencyHz = null;
        if (returnToMetronomeAfterTunerStop) {
          state.panelMode = "metronome";
          returnToMetronomeAfterTunerStop = false;
        }
        if (tunerWanted) {
          if (!tunerOwnerActive) state.voiceStatus = "paused";
          reconcileTuner().catch(console.error);
        } else {
          resumeWakewordIfActive().catch(console.error);
        }
        broadcastState().catch(console.error);
      } else if (message.event === "error") {
        const startingTuner = tunerStartRequested;
        tunerStartRequested = false;
        resolveTunerRelease();
        if (message.code === "BUSY" && startingTuner && tunerWanted) {
          state.tunerStatus = "busy";
          state.voiceStatus = "paused";
          broadcastState().catch(console.error);
          return;
        }
        if (message.code === "WAKEWORD_STOPPED" && tunerId) {
          state.tunerFrequencyHz = null;
          state.voiceStatus = "error";
          broadcastState().catch(console.error);
          return;
        }
        if (state.tunerStatus === "starting" || state.tunerStatus === "stopping") {
          state.tunerStatus = "error";
          broadcastState().catch(console.error);
        }
        state.voiceStatus = "error";
        broadcastState().catch(console.error);
      }
    });
    speechPort.onDisconnect.addListener(() => {
      speechPort = undefined;
      if (voiceStopTimer) clearTimeout(voiceStopTimer);
      voiceStopTimer = undefined;
      voiceRecordingId = undefined;
      voiceCancelRequested = false;
      tunerStartRequested = false;
      tunerStopSent = false;
      tunerId = undefined;
      resolveTunerRelease();
      state.tunerFrequencyHz = null;
      if (state.tunerStatus !== "idle") state.tunerStatus = "error";
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
// A network error replaces the requested page with about:neterror, where a
// content script cannot run. Keep the successful navigation attempt briefly
// so the toolbar popup can still offer the tuner for that same tab.
const offlineTunerAccessByTabId = new Map();

function publicState() {
  return { ...state };
}

async function initialize() {
  if (initialized) return;
  if (!initializePromise) {
    initializePromise = browser.storage.local.get({ bpm: DEFAULT_BPM, autoResume: true, volume: DEFAULT_VOLUME, sound: "crisp", subdivision: DEFAULT_SUBDIVISION, tunerReferenceHz: 440 })
      .then((saved) => {
        state.bpm = clampBpm(saved.bpm);
        state.autoResume = Boolean(saved.autoResume);
        state.volume = clampVolume(saved.volume);
        state.sound = sanitizeSound(saved.sound);
        state.subdivision = sanitizeSubdivision(saved.subdivision);
        const reference = Number(saved.tunerReferenceHz);
        state.tunerReferenceHz = Number.isFinite(reference) ? Math.max(432, Math.min(446, Math.round(reference))) : 440;
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
  if (sessionTabs.length === 0 && !offlinePlaybackOwner) {
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
  if (clearIntent) {
    state.userWantsPlayback = false;
    offlinePlaybackOwner = undefined;
  }
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

function hasActiveSessionWindow(windows) {
  return windows.some((window) => window.focused && window.state !== "minimized" &&
    window.tabs.some((tab) => tab.active && (isSessionUrl(tab.url) ||
      (offlinePlaybackOwner?.tabId === tab.id && offlineTunerAccessByTabId.has(tab.id))) && visibilityByTabId.get(tab.id) !== false));
}

async function refreshSessionActivity() {
  const revision = ++activityRevision;
  const windows = await browser.windows.getAll({ populate: true, windowTypes: ["normal"] });
  if (revision !== activityRevision) return;
  if (offlinePlaybackOwner && !windows.some((window) => window.id === offlinePlaybackOwner.windowId &&
    window.tabs.some((tab) => tab.id === offlinePlaybackOwner.tabId))) {
    await stopAudio({ clearIntent: true });
  }
  const ownerWindow = tunerOwner && windows.find((window) => window.id === tunerOwner.windowId);
  const ownerTab = ownerWindow?.tabs.find((tab) => tab.id === tunerOwner.tabId);
  const ownerActive = Boolean(ownerTab && ownerWindow.focused && ownerWindow.state !== "minimized" &&
    ownerTab.active && isTunerOwnerTabEligible(ownerTab) && visibilityByTabId.get(ownerTab.id) !== false);
  if (tunerWanted && !ownerTab) {
    await stopTuner({ returnToMetronome: true });
  } else if (tunerWanted && ownerTab && !isTunerOwnerTabEligible(ownerTab)) {
    await stopTuner({ returnToMetronome: true });
  } else if (tunerWanted && ownerActive !== tunerOwnerActive) {
    tunerOwnerActive = ownerActive;
    if (ownerActive && state.tunerStatus === "busy") state.tunerStatus = "paused";
    await reconcileTuner();
  }
  const isActive = hasActiveSessionWindow(windows);
  if (isActive === sessionIsActive) return;
  sessionIsActive = isActive;
  inactivityGeneration += 1;
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = undefined;
  if (sessionIsActive) {
    if (!tunerWanted && !tunerId && !tunerStartRequested && !tunerStopSent && state.voiceStatus === "paused" && speechPort) {
      await resumeWakewordIfActive();
    }
    if (state.userWantsPlayback && !state.audioActuallyPlaying && state.autoResume) await startAudio();
  } else {
    if (voiceStopTimer) clearTimeout(voiceStopTimer);
    voiceStopTimer = undefined;
    if (voiceRecordingId && speechPort) {
      const recordingId = voiceRecordingId;
      voiceRecordingId = undefined;
      voiceCancelRequested = true;
      speechPort.postMessage({ version: 1, action: "cancel_recording", recordingId });
    }
    if (!tunerWanted && !tunerId && !tunerStartRequested && !tunerStopSent && speechPort) {
      speechPort.postMessage({ version: 1, action: "stop_wakeword" });
    }
    state.voiceStatus = "paused";
    await broadcastState();
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

function isNetworkErrorUrl(url = "") {
  return String(url).startsWith("about:neterror");
}

function hasOfflineTunerAccess(tabId) {
  const expiresAt = offlineTunerAccessByTabId.get(tabId);
  if (expiresAt && (offlinePlaybackOwner?.tabId === tabId || (tunerWanted && tunerOwner?.offline && tunerOwner.tabId === tabId))) return true;
  if (!expiresAt || expiresAt <= Date.now()) {
    offlineTunerAccessByTabId.delete(tabId);
    return false;
  }
  return true;
}

function isTunerEligibleTab(tab) {
  return Boolean(tab && (isSessionUrl(tab.url) || hasOfflineTunerAccess(tab.id)));
}

function isTunerOwnerTabEligible(tab) {
  return Boolean(tab && (isSessionUrl(tab.url) || (tunerOwner?.offline && offlineTunerAccessByTabId.has(tab.id))));
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function offlineTunerAvailability() {
  const tab = await getActiveTab();
  if (onlineHandoffs.has(tab?.id)) return { available: false, mode: "online" };
  if (isSessionUrl(tab?.url) && !hasOfflineTunerAccess(tab.id)) return { available: false, mode: "online" };
  return { available: hasOfflineTunerAccess(tab?.id), mode: "offline" };
}

async function handoffOnlineTab(tab) {
  if (!tab || !isSessionUrl(tab.url)) return;
  if (onlineHandoffs.has(tab.id)) return onlineHandoffs.get(tab.id);
  const handoff = (async () => {
    offlineTunerAccessByTabId.delete(tab.id);
    if (offlinePlaybackOwner?.tabId === tab.id) await stopAudio({ clearIntent: true });
    if ((tunerOwner?.offline && tunerOwner.tabId === tab.id) || offlineTunerReleaseTabId === tab.id) {
      if (tunerOwner?.offline && tunerOwner.tabId === tab.id) await stopTuner({ returnToMetronome: true });
      await waitForTunerRelease();
    }
    if (browser.action) await browser.action.disable(tab.id).catch(console.error);
    await refreshSessionActivity();
  })();
  onlineHandoffs.set(tab.id, handoff);
  try { await handoff; } finally { onlineHandoffs.delete(tab.id); }
}

async function getSessionTabs({ excludingTabId } = {}) {
  const tabs = await browser.tabs.query({});
  return tabs.filter((tab) => tab.id !== excludingTabId && isSessionUrl(tab.url));
}

async function refreshOrStopForSessionTabs(closingTabId) {
  const tabs = await getSessionTabs({ excludingTabId: closingTabId });
  if (tabs.length === 0 && !offlinePlaybackOwner) {
    await stopAudio({ clearIntent: true });
  }
  // Also reconcile an active tuner. This is essential when the final target
  // tab becomes about:neterror or another non-target URL.
  await refreshSessionActivity();
}

// Experimental, limited to the installed exchange-probe manager. This is not
// a general-purpose external API or a voice-command interpreter.
const EXPERIMENTAL_ASSISTANT_ID = "foxbook-exchange-manager@foxbook.example";
const EXTERNAL_TEMPO_COMMAND = "tempo.increase.small";

function hasExactMessageKeys(message, keys) {
  const actual = Object.keys(message).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

browser.runtime.onMessageExternal?.addListener((message, sender) => {
  if (sender?.id !== EXPERIMENTAL_ASSISTANT_ID) return Promise.resolve({ ok: false, error: "UNAUTHORIZED" });
  if (!message || typeof message !== "object" || Array.isArray(message) || message.version !== 1) {
    return Promise.resolve({ ok: false, error: "INVALID_REQUEST" });
  }
  if (message.type === "getCommands" && hasExactMessageKeys(message, ["version", "type"])) {
    return fetch(browser.runtime.getURL("voice-commands.json"))
      .then((response) => { if (!response.ok) throw new Error("definition unavailable"); return response.json(); })
      .then((definition) => ({ ok: true, definition }))
      .catch(() => ({ ok: false, error: "DEFINITION_UNAVAILABLE" }));
  }
  if (message.type === "execute" && hasExactMessageKeys(message, ["version", "type", "commandId"]) &&
      message.commandId === EXTERNAL_TEMPO_COMMAND) {
    return (async () => {
      try {
        await initialize();
        const windows = await browser.windows.getAll({ populate: true, windowTypes: ["normal"] });
        if (!hasActiveSessionWindow(windows)) return { ok: false, error: "TARGET_INACTIVE" };
        const before = state.bpm;
        const updated = await adjustBpm(5);
        return { ok: true, result: { bpm: updated.bpm, changed: updated.bpm !== before } };
      } catch (error) {
        console.error("THE SESSION TOOLS: 外部テンポ操作に失敗しました", error);
        return { ok: false, error: "OPERATION_FAILED" };
      }
    })();
  }
  return Promise.resolve({ ok: false, error: "INVALID_REQUEST" });
});

browser.runtime.onMessage.addListener(async (message, sender) => {
  await initialize();
  switch (message?.type) {
    case "getState":
      return publicState();
    case "getOfflineTunerState":
      return { ...publicState(), ...(await offlineTunerAvailability()) };
    case "onlinePageReady":
      await handoffOnlineTab(sender.tab);
      return publicState();
    case "offlinePlay": {
      const tab = await getActiveTab();
      const availability = await offlineTunerAvailability();
      if (availability.available && availability.mode === "offline" && tab?.id !== undefined) {
        offlinePlaybackOwner = { tabId: tab.id, windowId: tab.windowId };
        state.userWantsPlayback = true;
        await refreshSessionActivity();
        await startAudio();
      }
      return { ...publicState(), ...(await offlineTunerAvailability()) };
    }
    case "openOfflineTuner": {
      const tab = await getActiveTab();
      const availability = await offlineTunerAvailability();
      if (availability.available && availability.mode === "offline" && isTunerEligibleTab(tab)) await startTuner(tab, { offline: true });
      return { ...publicState(), ...(await offlineTunerAvailability()) };
    }
    case "resumeOfflineTuner": {
      const tab = await getActiveTab();
      if (tunerWanted && tab?.id === tunerOwner?.tabId && state.tunerStatus === "busy" && isTunerEligibleTab(tab)) {
        state.tunerStatus = "paused";
        await refreshSessionActivity();
        await reconcileTuner();
      }
      return { ...publicState(), ...(await offlineTunerAvailability()) };
    }
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
    case "openTuner":
      await startTuner(sender.tab);
      return publicState();
    case "resumeTuner":
      if (tunerWanted && sender.tab?.id === tunerOwner?.tabId && state.tunerStatus === "busy") {
        state.tunerStatus = "paused";
        await refreshSessionActivity();
        await reconcileTuner();
      }
      return publicState();
    case "closeTuner":
      await stopTuner({ returnToMetronome: true });
      return publicState();
    case "adjustTunerReference": {
      const delta = Number(message.delta);
      if (delta === -1 || delta === 1) {
        state.tunerReferenceHz = Math.max(432, Math.min(446, state.tunerReferenceHz + delta));
        await browser.storage.local.set({ tunerReferenceHz: state.tunerReferenceHz });
        await broadcastState();
      }
      return publicState();
    }
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
  if (typeof changeInfo.url === "string" && !isSessionUrl(changeInfo.url) && !isNetworkErrorUrl(changeInfo.url)) {
    offlineTunerAccessByTabId.delete(tabId);
    if (offlinePlaybackOwner?.tabId === tabId) stopAudio({ clearIntent: true }).catch(console.error);
  }
  if (changeInfo.status === "loading") visibilityByTabId.delete(tabId);
  refreshOrStopForSessionTabs().catch(console.error);
});
browser.tabs.onRemoved.addListener((tabId) => {
  visibilityByTabId.delete(tabId);
  offlineTunerAccessByTabId.delete(tabId);
  if (offlinePlaybackOwner?.tabId === tabId) stopAudio({ clearIntent: true }).catch(console.error);
  if (tunerOwner?.tabId === tabId) stopTuner({ returnToMetronome: true }).catch(console.error);
  // Exclude the closing ID even if tabs.query() briefly still returns it.
  refreshOrStopForSessionTabs(tabId).catch(console.error);
});
browser.windows.onRemoved.addListener(() => {
  // Covers the last tab disappearing as part of closing an entire window.
  refreshOrStopForSessionTabs().catch(console.error);
});
browser.windows.onFocusChanged.addListener(() => { refreshSessionActivity().catch(console.error); });

browser.webRequest?.onBeforeRequest.addListener((details) => {
  if (details.type === "main_frame" && details.tabId >= 0) {
    offlineTunerAccessByTabId.set(details.tabId, Date.now() + OFFLINE_TUNER_ACCESS_MS);
    browser.action?.enable(details.tabId).catch(console.error);
  }
}, {
  urls: ["https://thesession.org/*", "https://www.thesession.org/*"],
  types: ["main_frame"]
});

initialize().then(async () => {
  await refreshSessionActivity();
  connectSpeech();
}).catch(console.error);
