/* global browser */

const root = document.createElement("section");
root.id = "the-session-tools-metronome";
root.innerHTML = `
  <div class="tst-title"><span aria-hidden="true">♩</span> Metronome</div>
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
      <option value="beep">Beep</option>
      <option value="wood">Wood</option>
      <option value="sharp">Sharp</option>
    </select>
  </label>
  <label class="tst-setting tst-volume">Volume <output data-volume>70%</output>
    <input data-volume-input type="range" min="0" max="150" step="1" value="70" aria-label="音量">
  </label>
  <div class="tst-controls">
    <button type="button" data-action="play">▶ Play</button>
    <button type="button" data-action="stop">■ Stop</button>
  </div>
`;

document.documentElement.append(root);

const bpmOutput = root.querySelector("[data-bpm]");
const playButton = root.querySelector("[data-action=\"play\"]");
const stopButton = root.querySelector("[data-action=\"stop\"]");
const bpmControl = root.querySelector("[data-bpm-input]");
const subdivisionControl = root.querySelector("[data-subdivision]");
const soundControl = root.querySelector("[data-sound]");
const volumeControl = root.querySelector("[data-volume-input]");
const volumeOutput = root.querySelector("[data-volume]");
let tempoRepeatId;

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
  browser.runtime.sendMessage({ type: "sessionPageGone" }).catch(() => undefined);
}, { once: true });
