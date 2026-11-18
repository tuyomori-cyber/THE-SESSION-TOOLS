/* global browser */

const availability = document.querySelector("[data-availability]");
const status = document.querySelector("[data-status]");
const note = document.querySelector("[data-note]");
const frequency = document.querySelector("[data-frequency]");
const cents = document.querySelector("[data-cents]");
const reference = document.querySelector("[data-reference]");
const meter = document.querySelector("[data-meter]");
const dot = document.querySelector("[data-dot]");
const start = document.querySelector("[data-start]");
const resume = document.querySelector("[data-resume]");
const stop = document.querySelector("[data-stop]");
const bpm = document.querySelector("[data-bpm]");
const bpmInput = document.querySelector("[data-bpm-input]");
const subdivision = document.querySelector("[data-subdivision]");
const sound = document.querySelector("[data-sound]");
const volume = document.querySelector("[data-volume]");
const volumeInput = document.querySelector("[data-volume-input]");
const play = document.querySelector("[data-play]");
const stopAudio = document.querySelector("[data-stop-audio]");

const labels = {
  idle: "待機中",
  starting: "チューナーを開始中",
  active: "チューナーを起動中",
  stopping: "チューナーを終了中",
  paused: "一時停止中",
  busy: "マイク使用中・再開待ち",
  error: "チューナーを開始できません"
};

function render(state) {
  if (state.mode === "online") {
    window.close();
    return;
  }
  const allowed = state.available === true;
  const online = state.mode === "online";
  availability.textContent = allowed
    ? (online ? "The Sessionで使用できます。" : "オフラインで使用できます。")
    : "The Sessionへの接続を試みたタブで開いてください。";
  availability.dataset.error = String(!allowed);
  bpm.textContent = state.bpm;
  bpmInput.value = state.bpm;
  subdivision.value = String(state.subdivision);
  sound.value = state.sound;
  volumeInput.value = Math.round(state.volume * 100);
  volume.textContent = `${volumeInput.value}%`;
  play.disabled = !allowed || state.audioActuallyPlaying;
  stopAudio.disabled = !state.userWantsPlayback;
  for (const control of [bpmInput, subdivision, sound, volumeInput, document.querySelector("[data-bpm-down]"), document.querySelector("[data-bpm-up]"), document.querySelector("[data-reference-down]"), document.querySelector("[data-reference-up]")]) control.disabled = !allowed;
  status.textContent = labels[state.tunerStatus] ?? labels.idle;
  reference.textContent = `${state.tunerReferenceHz || 440} Hz`;
  const active = state.tunerStatus === "active";
  const value = active ? state.tunerFrequencyHz : null;
  if (typeof value === "number" && value > 0) {
    const semitones = 12 * Math.log2(value / (state.tunerReferenceHz || 440));
    const midi = Math.round(semitones) + 69;
    const offset = Math.round((semitones - Math.round(semitones)) * 100);
    const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
    note.textContent = `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
    frequency.textContent = `${value.toFixed(1)} Hz`;
    cents.textContent = `${offset > 0 ? "+" : ""}${offset} cent`;
    const position = Math.max(-50, Math.min(50, offset));
    dot.style.left = `${50 + position}%`;
    dot.style.backgroundColor = `hsl(${Math.max(0, 120 - Math.abs(position) * 2.4)} 53% 43%)`;
    meter.dataset.signal = "true";
  } else {
    note.textContent = "—";
    frequency.textContent = active ? "音を鳴らしてください" : "測定待機中";
    cents.textContent = "— cent";
    meter.dataset.signal = "false";
  }
  start.hidden = state.tunerStatus !== "idle" && state.tunerStatus !== "error";
  start.disabled = !allowed;
  resume.hidden = state.tunerStatus !== "busy";
  resume.disabled = !allowed;
  stop.hidden = !["starting", "active", "paused", "busy", "stopping"].includes(state.tunerStatus);
}

async function refresh() {
  try {
    render(await browser.runtime.sendMessage({ type: "getOfflineTunerState" }));
  } catch (_) {
    availability.textContent = "拡張の状態を取得できません。";
    availability.dataset.error = "true";
  }
}

start.addEventListener("click", async () => { render(await browser.runtime.sendMessage({ type: "openOfflineTuner" })); });
resume.addEventListener("click", async () => { render(await browser.runtime.sendMessage({ type: "resumeOfflineTuner" })); });
stop.addEventListener("click", () => sendControl({ type: "closeTuner" }));
async function sendControl(message) {
  await browser.runtime.sendMessage(message);
  await refresh();
}
play.addEventListener("click", () => sendControl({ type: "offlinePlay" }));
stopAudio.addEventListener("click", () => sendControl({ type: "stop" }));
document.querySelector("[data-bpm-down]").addEventListener("click", () => sendControl({ type: "adjustBpm", delta: -1 }));
document.querySelector("[data-bpm-up]").addEventListener("click", () => sendControl({ type: "adjustBpm", delta: 1 }));
bpmInput.addEventListener("input", () => sendControl({ type: "setBpm", bpm: Number(bpmInput.value) }));
subdivision.addEventListener("change", () => sendControl({ type: "setSubdivision", subdivision: Number(subdivision.value) }));
sound.addEventListener("change", () => sendControl({ type: "setSound", sound: sound.value }));
volumeInput.addEventListener("input", () => sendControl({ type: "setVolume", volume: Number(volumeInput.value) / 100 }));
document.querySelector("[data-reference-down]").addEventListener("click", () => sendControl({ type: "adjustTunerReference", delta: -1 }));
document.querySelector("[data-reference-up]").addEventListener("click", () => sendControl({ type: "adjustTunerReference", delta: 1 }));

refresh();
window.setInterval(refresh, 250);
