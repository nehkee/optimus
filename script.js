// Spud's song: an original little tune.
// Each entry: [lyric syllable, note name, beats]
const SONG = [
  ["I'm", "C4", 1], ["a", "E4", 1], ["lit", "G4", 1], ["-tle", "G4", 1],
  ["po", "A4", 1], ["-ta", "G4", 1], ["-to", "E4", 2],
  ["round", "F4", 1], ["and", "F4", 1], ["brown", "A4", 2],
  ["I", "G4", 1], ["sing", "E4", 1], ["all", "D4", 1], ["day", "C4", 1],
  ["un", "D4", 1], ["-der", "E4", 1], ["-ground", "C4", 2],
  ["Mash", "G4", 1], ["me", "G4", 1], ["fry", "A4", 1], ["me", "A4", 1],
  ["bake", "C5", 1], ["me", "A4", 1], ["too", "G4", 2],
  ["I'll", "E4", 1], ["still", "F4", 1], ["sing", "G4", 1], ["a", "E4", 1],
  ["song", "D4", 1], ["for", "E4", 1], ["you!", "C4", 3],
];

const BPM = 150;
const BEAT = 60 / BPM;

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function freq(name) {
  const n = NOTE_INDEX[name[0]];
  const octave = Number(name.slice(1));
  const midi = 12 * (octave + 1) + n;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const button = document.getElementById("sing");
const stage = document.querySelector(".stage");
const mouth = document.getElementById("mouthOpen");
const tongue = document.getElementById("tongue");
const lyric = document.getElementById("lyric");
const notesLayer = document.getElementById("notes");

let audio = null;
let playing = false;
let timers = [];

function setMouth(open) {
  // open: 0 (closed) .. 1 (wide)
  mouth.setAttribute("ry", 4 + open * 26);
  mouth.setAttribute("rx", 22 - open * 4);
  tongue.setAttribute("ry", open * 9);
  tongue.setAttribute("cy", 3 + open * 14);
}

function spawnNote() {
  const el = document.createElement("span");
  el.className = "note";
  el.textContent = Math.random() < 0.5 ? "♪" : "♫";
  el.style.left = 45 + Math.random() * 20 + "%";
  el.style.top = "55%";
  el.style.setProperty("--dx", (Math.random() * 160 - 80).toFixed(0) + "px");
  el.style.setProperty("--rot", (Math.random() * 60 - 30).toFixed(0) + "deg");
  notesLayer.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function playNote(time, f, dur) {
  // A soft "voice": two detuned oscillators through a vowel-ish filter, with vibrato.
  const out = audio.createGain();
  out.gain.setValueAtTime(0, time);
  out.gain.linearRampToValueAtTime(0.22, time + 0.04);
  out.gain.setValueAtTime(0.22, time + dur * 0.75);
  out.gain.linearRampToValueAtTime(0, time + dur * 0.97);

  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900;
  filter.Q.value = 1.2;

  const vib = audio.createOscillator();
  const vibGain = audio.createGain();
  vib.frequency.value = 5.5;
  vibGain.gain.value = f * 0.012;
  vib.connect(vibGain);

  [0, 6].forEach((detune) => {
    const osc = audio.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = f;
    osc.detune.value = detune;
    vibGain.connect(osc.frequency);
    osc.connect(filter);
    osc.start(time);
    osc.stop(time + dur);
  });

  filter.connect(out);
  out.connect(audio.destination);
  vib.start(time);
  vib.stop(time + dur);
}

function stop() {
  timers.forEach(clearTimeout);
  timers = [];
  playing = false;
  stage.classList.remove("singing");
  button.textContent = "▶ Make Spud sing";
  setMouth(0);
  lyric.innerHTML = "&nbsp;";
  if (audio) {
    audio.close();
    audio = null;
  }
}

function sing() {
  if (playing) return stop();

  audio = new (window.AudioContext || window.webkitAudioContext)();
  playing = true;
  stage.classList.add("singing");
  button.textContent = "■ Stop";

  const start = audio.currentTime + 0.1;
  let t = 0;
  let line = [];

  SONG.forEach(([word, note, beats], i) => {
    const dur = beats * BEAT;
    const at = start + t;
    playNote(at, freq(note), dur);

    const ms = (t + 0.1) * 1000;
    // Higher notes → wider mouth.
    const open = Math.min(1, 0.45 + (freq(note) - 260) / 500);
    const startsLine = i === 0 || /^[A-Z]/.test(word);
    timers.push(setTimeout(() => {
      if (startsLine) line = [];
      line.push(word.startsWith("-") ? word.slice(1) : (line.length ? " " : "") + word);
      lyric.textContent = line.join("");
      setMouth(open);
      spawnNote();
    }, ms));
    timers.push(setTimeout(() => setMouth(0.1), ms + dur * 850));

    t += dur;
  });

  timers.push(setTimeout(stop, (t + 0.6) * 1000));
}

button.addEventListener("click", sing);
setMouth(0);
