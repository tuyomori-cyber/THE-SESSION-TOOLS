/* global browser */

const root = document.createElement("section");
root.id = "the-session-tools-metronome";
root.innerHTML = `
  <div class="tst-title">
    <span class="tst-drag-handle"><span aria-hidden="true">♩</span> <span data-panel-title>Metronome</span></span>
    <button type="button" class="tst-title-arrow" aria-expanded="true" aria-label="Metronomeを最小化"><svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false"><path d="M4 24 L16 0 L28 24 Z" fill="currentColor"/></svg></button>
  </div>
  <div class="tst-voice-status" data-voice-status="unavailable" role="status" aria-live="polite">
    <span class="tst-voice-led" aria-hidden="true"></span>
    <span data-voice-status-text>音声操作：未接続</span>
  </div>
  <div class="tst-views">
  <div class="tst-metronome-view">
  <div class="tst-tempo">
    <button type="button" data-action="decrease" aria-label="BPMを減らす">−</button>
    <output aria-live="polite"><strong data-bpm>110</strong> BPM</output>
    <button type="button" data-action="increase" aria-label="BPMを増やす">＋</button>
  </div>
  <label class="tst-setting tst-bpm-slider">Tempo
    <input data-bpm-input type="range" min="30" max="300" step="1" value="110" aria-label="BPM">
  </label>
  <label class="tst-setting">Division
    <select data-subdivision aria-label="拍の分割">
      <option value="1">Beat</option>
      <option value="2">8th notes</option>
      <option value="4">16th notes</option>
      <option value="3">Triplets</option>
    </select>
  </label>
  <label class="tst-setting">Sound
    <select data-sound aria-label="クリック音">
      <option value="crisp">Crisp</option>
      <option value="sharp">Sharp</option>
      <option value="wood">Wood</option>
    </select>
  </label>
  <label class="tst-setting tst-volume">Volume <output data-volume>70%</output>
    <input data-volume-input type="range" min="0" max="150" step="1" value="70" aria-label="音量">
  </label>
  <div class="tst-controls">
    <button type="button" data-action="play">▶ Play</button>
    <button type="button" data-action="stop">■ Stop</button>
  </div>
  <button type="button" class="tst-tuner-launch" data-action="open-tuner">Tuner を開く</button>
  </div>
  <div class="tst-tuner-view" hidden>
    <div class="tst-tuner-reading" aria-label="チューナーの測定結果">
      <div class="tst-tuner-note" data-tuner-note>—</div>
      <div class="tst-tuner-frequency" data-tuner-frequency>音を鳴らしてください</div>
      <div class="tst-pitch-meter" data-pitch-meter aria-hidden="true"><div class="tst-pitch-track"><span class="tst-pitch-center"></span><span class="tst-pitch-dot" data-pitch-dot></span></div></div>
      <div class="tst-tuner-cents" data-tuner-cents>— cent</div>
      <div class="tst-tuner-directions"><span>低い</span><span>高い</span></div>
    </div>
    <div class="tst-tuner-reference"><span>基準 A4</span><button type="button" data-action="reference-down" aria-label="基準ピッチを1ヘルツ下げる">−</button><output data-tuner-reference>440 Hz</output><button type="button" data-action="reference-up" aria-label="基準ピッチを1ヘルツ上げる">＋</button></div>
    <p class="tst-tuner-status" data-tuner-status role="status" aria-live="polite">待機中</p>
    <button type="button" class="tst-tuner-resume" data-action="resume-tuner" hidden>再開</button>
    <button type="button" class="tst-tuner-back" data-action="close-tuner">Metronomeへ戻る</button>
  </div>
  </div>
`;

// A content script can be injected again into an existing page after an add-on
// reload. Remove its previous panel before installing the new one.
document.querySelectorAll('[id="the-session-tools-metronome"]').forEach((panel) => panel.remove());
document.documentElement.append(root);

const bpmOutput = root.querySelector("[data-bpm]");
const playButton = root.querySelector("[data-action=\"play\"]");
const stopButton = root.querySelector("[data-action=\"stop\"]");
const bpmControl = root.querySelector("[data-bpm-input]");
const subdivisionControl = root.querySelector("[data-subdivision]");
const soundControl = root.querySelector("[data-sound]");
const volumeControl = root.querySelector("[data-volume-input]");
const volumeOutput = root.querySelector("[data-volume]");
const panelTitle = root.querySelector("[data-panel-title]");
const metronomeView = root.querySelector(".tst-metronome-view");
const tunerView = root.querySelector(".tst-tuner-view");
const tunerStatus = root.querySelector("[data-tuner-status]");
const tunerResumeButton = root.querySelector('[data-action="resume-tuner"]');
const tunerNote = root.querySelector("[data-tuner-note]");
const tunerFrequency = root.querySelector("[data-tuner-frequency]");
const tunerCents = root.querySelector("[data-tuner-cents]");
const tunerReference = root.querySelector("[data-tuner-reference]");
const pitchMeter = root.querySelector("[data-pitch-meter]");
const pitchDot = root.querySelector("[data-pitch-dot]");
const voiceStatus = root.querySelector(".tst-voice-status");
const voiceStatusText = root.querySelector("[data-voice-status-text]");
const dragHandle = root.querySelector(".tst-drag-handle");
const collapseButton = root.querySelector(".tst-title-arrow");
let tempoRepeatId;
let dragState;
let savedPosition;
let positionTouched = false;
let collapsedTouched = false;

function placePanel(left, top) {
  const maxLeft = Math.max(0, window.innerWidth - root.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - root.offsetHeight);
  const position = {
    left: Math.min(Math.max(0, left), maxLeft),
    top: Math.min(Math.max(0, top), maxTop),
  };
  root.style.right = "auto";
  root.style.bottom = "auto";
  root.style.left = `${position.left}px`;
  root.style.top = `${position.top}px`;
  return position;
}

function setCollapsed(collapsed) {
  root.dataset.collapsed = String(collapsed);
  collapseButton.setAttribute("aria-expanded", String(!collapsed));
  collapseButton.setAttribute("aria-label", collapsed ? "Metronomeを展開" : "Metronomeを最小化");
  if (savedPosition) placePanel(savedPosition.left, savedPosition.top);
}

function toggleCollapsed() {
  collapsedTouched = true;
  const collapsed = root.dataset.collapsed !== "true";
  setCollapsed(collapsed);
  browser.storage.local.set({ metronomeCollapsed: collapsed }).catch(console.error);
}

dragHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  const rect = root.getBoundingClientRect();
  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    moved: false,
  };
  dragHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
});

dragHandle.addEventListener("pointermove", (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  if (!dragState.moved && Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) < 6) return;
  dragState.moved = true;
  positionTouched = true;
  savedPosition = placePanel(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
});

dragHandle.addEventListener("pointerup", (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  if (dragState.moved) {
    browser.storage.local.set({ metronomePosition: savedPosition }).catch(console.error);
  }
  dragState = undefined;
  dragHandle.releasePointerCapture(event.pointerId);
});

dragHandle.addEventListener("pointercancel", () => { dragState = undefined; });
dragHandle.addEventListener("lostpointercapture", () => { dragState = undefined; });
collapseButton.addEventListener("click", toggleCollapsed);

window.addEventListener("resize", () => {
  if (savedPosition) placePanel(savedPosition.left, savedPosition.top);
});

browser.storage.local.get(["metronomePosition", "metronomeCollapsed"]).then((settings) => {
  if (!collapsedTouched) setCollapsed(settings.metronomeCollapsed === true);
  const position = settings.metronomePosition;
  if (!positionTouched && Number.isFinite(position?.left) && Number.isFinite(position?.top)) {
    savedPosition = position;
    placePanel(position.left, position.top);
  }
}).catch(console.error);

function render(state) {
  bpmOutput.textContent = state.bpm;
  bpmControl.value = state.bpm;
  playButton.disabled = state.audioActuallyPlaying;
  stopButton.disabled = !state.userWantsPlayback;
  subdivisionControl.value = String(state.subdivision);
  soundControl.value = state.sound;
  const volumePercent = Math.round(state.volume * 100);
  volumeControl.value = volumePercent;
  volumeOutput.textContent = `${volumePercent}%`;
  root.dataset.playing = String(state.audioActuallyPlaying);
  renderVoiceStatus(state.voiceStatus);
  renderPanelMode(state);
}

function renderPanelMode(state) {
  const isTuner = state.panelMode === "tuner";
  panelTitle.textContent = isTuner ? "Tuner" : "Metronome";
  metronomeView.hidden = isTuner;
  tunerView.hidden = !isTuner;
  const labels = {
    idle: "待機中",
    starting: "チューナーを開始中",
    active: "チューナーを起動中",
    stopping: "チューナーを終了中",
    paused: "一時停止中",
    busy: "マイク使用中・再開待ち",
    error: "チューナーを開始できません"
  };
  const status = Object.hasOwn(labels, state.tunerStatus) ? state.tunerStatus : "idle";
  tunerStatus.textContent = labels[status];
  tunerResumeButton.hidden = status !== "busy";
  const reference = state.tunerReferenceHz || 440;
  tunerReference.textContent = `${reference} Hz`;
  root.querySelector('[data-action="reference-down"]').disabled = reference <= 432;
  root.querySelector('[data-action="reference-up"]').disabled = reference >= 446;
  const frequency = status === "active" ? state.tunerFrequencyHz : null;
  if (typeof frequency === "number" && frequency > 0) {
    const semitones = 12 * Math.log2(frequency / reference);
    const midi = Math.round(semitones) + 69;
    const cents = Math.round((semitones - Math.round(semitones)) * 100);
    const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
    tunerNote.textContent = `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
    tunerFrequency.textContent = `${frequency.toFixed(1)} Hz`;
    tunerCents.textContent = `${cents > 0 ? "+" : ""}${cents} cent`;
    const offset = Math.max(-50, Math.min(50, cents));
    const hue = 120 * (1 - Math.max(0, Math.abs(offset) - 2) / 48);
    pitchDot.style.left = `${50 + offset}%`;
    pitchDot.style.backgroundColor = `hsl(${hue}, 70%, 40%)`;
    pitchMeter.dataset.signal = "true";
  } else {
    tunerNote.textContent = "—";
    tunerFrequency.textContent = status === "active" ? "音を鳴らしてください" : "測定待機中";
    tunerCents.textContent = "— cent";
    pitchMeter.dataset.signal = "false";
  }
}

function renderVoiceStatus(status) {
  const labels = {
    unavailable: "音声操作：未接続",
    connected: "音声操作：接続済み（待機準備中）",
    waiting: "音声操作：呼びかけを待機中",
    detected: "音声操作：呼びかけを検出",
    listening: "音声操作：コマンドを認識中",
    paused: "音声操作：一時停止中",
    error: "音声操作：接続エラー"
  };
  const safeStatus = Object.hasOwn(labels, status) ? status : "unavailable";
  voiceStatus.dataset.voiceStatus = safeStatus;
  voiceStatusText.textContent = labels[safeStatus];
}

async function send(message) {
  try {
    const state = await browser.runtime.sendMessage(message);
    if (state) render(state);
  } catch (error) {
    console.error("THE SESSION TOOLS: backgroundへの接続に失敗しました", error);
  }
}

function changeBpm(delta) {
  send({ type: "adjustBpm", delta });
}

function clearTempoRepeat() {
  if (tempoRepeatId) window.clearTimeout(tempoRepeatId);
  tempoRepeatId = undefined;
}

function beginTempoRepeat(button, event) {
  const action = button.dataset.action;
  if (action !== "increase" && action !== "decrease") return;
  event.preventDefault();
  button.setPointerCapture?.(event.pointerId);
  const delta = action === "increase" ? 1 : -1;
  const startedAt = performance.now();
  changeBpm(delta);
  const repeat = () => {
    changeBpm(delta);
    const elapsed = performance.now() - startedAt;
    const interval = elapsed > 1600 ? 45 : elapsed > 800 ? 70 : 100;
    tempoRepeatId = window.setTimeout(repeat, interval);
  };
  tempoRepeatId = window.setTimeout(repeat, 350);
}

root.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("button");
  if (button) beginTempoRepeat(button, event);
});
root.addEventListener("pointerup", clearTempoRepeat);
root.addEventListener("pointercancel", clearTempoRepeat);
root.addEventListener("lostpointercapture", clearTempoRepeat);

root.addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.action;
  if (action === "play" || action === "stop") return send({ type: action });
  if (action === "open-tuner") return send({ type: "openTuner" });
  if (action === "resume-tuner") return send({ type: "resumeTuner" });
  if (action === "close-tuner") return send({ type: "closeTuner" });
  if (action === "reference-down") return send({ type: "adjustTunerReference", delta: -1 });
  if (action === "reference-up") return send({ type: "adjustTunerReference", delta: 1 });
  // Pointer presses are handled above; detail 0 means keyboard activation.
  if ((action === "increase" || action === "decrease") && event.detail === 0) {
    changeBpm(action === "increase" ? 1 : -1);
  }
});

bpmControl.addEventListener("input", () => send({ type: "setBpm", bpm: Number(bpmControl.value) }));
subdivisionControl.addEventListener("change", () => send({ type: "setSubdivision", subdivision: Number(subdivisionControl.value) }));
soundControl.addEventListener("change", () => send({ type: "setSound", sound: soundControl.value }));
volumeControl.addEventListener("input", () => {
  volumeOutput.textContent = `${volumeControl.value}%`;
  send({ type: "setVolume", volume: Number(volumeControl.value) / 100 });
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "stateChanged") render(message.state);
});

function reportVisibility() {
  send({ type: "visibility", visible: document.visibilityState === "visible" });
}

document.addEventListener("visibilitychange", reportVisibility);
send({ type: "getState" });
reportVisibility();

// Firefox MV3 backgrounds are event pages. The verified content-script timer
// remains active in background tabs and prevents the audio host from idling out.
const heartbeatId = window.setInterval(() => {
  browser.runtime.sendMessage({ type: "heartbeat" }).catch(() => undefined);
}, 1000);

window.addEventListener("pagehide", () => {
  clearTempoRepeat();
  window.clearInterval(heartbeatId);
}, { once: true });
