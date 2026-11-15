// Potatohead: Spud the singing potato.
// A song is { title, lines: [string] }. A melody is composed from the words,
// then Spud either sings the words (browser speech at musical pitches, with a
// soft synth note under each word) or hums the tune.

const DEFAULT_SONG = {
  title: "Spud's Theme",
  lines: [
    "I'm a little potato round and brown",
    "I sing all day under the ground",
    "Mash me fry me bake me too",
    "I will still sing a song for you",
  ],
};

const MAX_LINES = 24;
const MAX_CHARS = 1500;
const BPM = 132;
const BEAT = 60 / BPM;

// ---------- elements ----------
const $ = (id) => document.getElementById(id);
const singBtn = $("sing");
const shareBtn = $("share");
const stage = document.querySelector(".stage");
const mouth = $("mouthOpen");
const tongue = $("tongue");
const lyricEl = $("lyric");
const titleEl = $("songTitle");
const notesLayer = $("notes");
const statusEl = $("status");

let song = DEFAULT_SONG;
let melody = [];
let audio = null;
let playing = false;
let timers = [];
let runId = 0;

// ---------- melody ----------
// C major pentatonic, C4..E5, as MIDI numbers.
const SCALE = [60, 62, 64, 67, 69, 72, 74, 76];

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 1;
  const groups = w.replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

// Same lyrics always give the same tune, so shared links sound the same.
function compose(lines) {
  const rand = rng(hashString(lines.join("\n")));
  const events = [];
  let deg = 2; // start on E
  lines.forEach((line, li) => {
    const words = line.split(/\s+/).filter(Boolean);
    const lastLine = li === lines.length - 1;
    words.forEach((word, wi) => {
      const lastWord = wi === words.length - 1;
      if (lastWord) {
        // Resolve phrases: G at the end of odd lines, C at the end of even lines / the song.
        deg = lastLine || li % 2 === 1 ? (deg > 4 ? 5 : 0) : 3;
      } else if (wi > 0 || li > 0) {
        const step = [-2, -1, -1, 0, 1, 1, 2][Math.floor(rand() * 7)];
        deg = Math.min(SCALE.length - 1, Math.max(0, deg + step));
      }
      const syl = syllables(word);
      let beats = syl >= 3 ? 1.5 : 1;
      if (word.replace(/[^a-z]/gi, "").length <= 2 && !lastWord && rand() < 0.5) beats = 0.5;
      if (lastWord) beats = lastLine ? 3 : 2;
      events.push({ word, line: li, index: wi, midi: SCALE[deg], beats });
    });
  });
  return events;
}

const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// ---------- face + effects ----------
function setMouth(open) {
  mouth.setAttribute("ry", 4 + open * 26);
  mouth.setAttribute("rx", 22 - open * 4);
  tongue.setAttribute("ry", open * 9);
  tongue.setAttribute("cy", 3 + open * 14);
}

function spawnNote() {
  const el = document.createElement("span");
  el.className = "note";
  el.textContent = Math.random() < 0.5 ? "♪" : "♫";
  el.style.left = 40 + Math.random() * 25 + "%";
  el.style.top = "50%";
  el.style.setProperty("--dx", (Math.random() * 160 - 80).toFixed(0) + "px");
  el.style.setProperty("--rot", (Math.random() * 60 - 30).toFixed(0) + "deg");
  notesLayer.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

let shownLine = -1;
function showWord(ev) {
  if (ev.line !== shownLine) {
    shownLine = ev.line;
    lyricEl.innerHTML = "";
    song.lines[ev.line].split(/\s+/).filter(Boolean).forEach((w, i) => {
      const span = document.createElement("span");
      span.className = "w";
      span.textContent = (i ? " " : "") + w;
      lyricEl.appendChild(span);
    });
  }
  lyricEl.querySelectorAll(".w").forEach((s, i) => s.classList.toggle("on", i === ev.index));
}

function onWord(ev) {
  showWord(ev);
  setMouth(Math.min(1, 0.4 + (ev.midi - 60) / 20));
  spawnNote();
}

// ---------- sound ----------
function synthNote(time, f, dur, level) {
  const out = audio.createGain();
  out.gain.setValueAtTime(0, time);
  out.gain.linearRampToValueAtTime(level, time + 0.04);
  out.gain.setValueAtTime(level, time + dur * 0.75);
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

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => /en[-_]US/i.test(v.lang) && /google|samantha|alex/i.test(v.name)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    voices[0] ||
    null
  );
}

function canSpeak() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function hum(id, from = 0) {
  const start = audio.currentTime + 0.1;
  let t = 0;
  melody.slice(from).forEach((ev) => {
    const dur = ev.beats * BEAT;
    synthNote(start + t, freq(ev.midi), dur, 0.22);
    const ms = (t + 0.1) * 1000;
    timers.push(setTimeout(() => id === runId && onWord(ev), ms));
    timers.push(setTimeout(() => id === runId && setMouth(0.1), ms + dur * 850));
    t += dur;
  });
  timers.push(setTimeout(() => id === runId && stop(), (t + 0.6) * 1000));
}

function singWords(id) {
  const voice = pickVoice();
  let i = 0;
  const next = () => {
    if (id !== runId) return;
    if (i >= melody.length) return stop();
    const ev = melody[i++];
    const u = new SpeechSynthesisUtterance(ev.word);
    if (voice) u.voice = voice;
    // Map the note to speech pitch (0..2) so the words rise and fall with the tune.
    u.pitch = Math.max(0.1, Math.min(2, 0.6 + ((ev.midi - 60) / 16) * 1.3));
    u.rate = ev.beats >= 2 ? 0.7 : ev.beats <= 0.5 ? 1.15 : 0.95;
    u.volume = 1;
    let done = false;
    let started = false;
    const finish = () => {
      if (done) return;
      done = true;
      setMouth(0.1);
      timers.push(setTimeout(next, ev.beats >= 2 ? 180 : 20));
    };
    u.onstart = () => {
      started = true;
      if (id !== runId) return;
      onWord(ev);
      synthNote(audio.currentTime, freq(ev.midi), Math.min(ev.beats * BEAT, 0.9), 0.07);
    };
    u.onend = () => (started ? finish() : fallback());
    u.onerror = () => (started ? finish() : fallback());
    // If this browser has no working speech voice, fall back to humming.
    const fallback = () => {
      if (started || done || id !== runId) return;
      done = true;
      speechSynthesis.cancel();
      statusEl.textContent = "This browser can't sing words, so Spud is humming.";
      hum(id, i - 1);
    };
    timers.push(setTimeout(fallback, 1500));
    // Safety net in case a browser never fires onend.
    timers.push(setTimeout(finish, 5000));
    speechSynthesis.speak(u);
  };
  speechSynthesis.cancel();
  next();
}

function stop() {
  runId++;
  timers.forEach(clearTimeout);
  timers = [];
  playing = false;
  if (canSpeak()) speechSynthesis.cancel();
  stage.classList.remove("singing");
  singBtn.textContent = "▶ Make Spud sing";
  setMouth(0);
  shownLine = -1;
  lyricEl.innerHTML = "&nbsp;";
  if (audio) {
    audio.close();
    audio = null;
  }
}

function sing() {
  if (playing) return stop();
  const id = ++runId;
  audio = new (window.AudioContext || window.webkitAudioContext)();
  playing = true;
  stage.classList.add("singing");
  singBtn.textContent = "■ Stop";
  const mode = document.querySelector('input[name="voice"]:checked').value;
  if (mode === "words" && canSpeak()) singWords(id);
  else hum(id);
}

// ---------- loading songs ----------
function cleanLines(text) {
  return text
    .slice(0, MAX_CHARS)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, MAX_LINES);
}

function loadSong(s, { autoplay = false, shareable = true } = {}) {
  stop();
  song = { title: (s.title || "Untitled").slice(0, 60), lines: s.lines };
  melody = compose(song.lines);
  titleEl.textContent = "“" + song.title + "”";
  shareBtn.hidden = !shareable;
  if (autoplay) sing();
}

// Share links carry the whole song in the URL, so no database is needed.
function encodeSong(s) {
  const bytes = new TextEncoder().encode(JSON.stringify({ t: s.title, l: s.lines }));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeSong(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  const lines = cleanLines((obj.l || []).join("\n"));
  if (!lines.length) throw new Error("empty");
  return { title: String(obj.t || "A song for you"), lines };
}

shareBtn.addEventListener("click", async () => {
  const url = location.origin + location.pathname + "#song=" + encodeSong(song);
  history.replaceState(null, "", url);
  try {
    if (navigator.share) {
      await navigator.share({ title: "Spud sings “" + song.title + "”", url });
    } else {
      await navigator.clipboard.writeText(url);
      statusEl.textContent = "Link copied! Send it to someone.";
    }
  } catch {
    statusEl.textContent = "Copy this link from the address bar to share.";
  }
});

// ---------- tabs ----------
const tabs = [
  [$("tabAi"), $("paneAi")],
  [$("tabMine"), $("paneMine")],
];
tabs.forEach(([tab, pane]) =>
  tab.addEventListener("click", () => {
    tabs.forEach(([t, p]) => {
      t.setAttribute("aria-selected", String(t === tab));
      p.hidden = p !== pane;
    });
  })
);

// ---------- "I write it" ----------
$("paneMine").addEventListener("submit", (e) => {
  e.preventDefault();
  const lines = cleanLines($("myLyrics").value);
  if (!lines.length) return;
  statusEl.textContent = "Spud learned your song!";
  loadSong({ title: $("myTitle").value.trim() || "My Song", lines }, { autoplay: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------- "Spud writes it" (AI) ----------
$("paneAi").addEventListener("submit", async (e) => {
  e.preventDefault();
  const topic = $("topic").value.trim();
  if (!topic) return;
  const btn = $("writeBtn");
  btn.disabled = true;
  btn.textContent = "Writing…";
  statusEl.textContent = "Spud is writing a song about " + topic + "…";
  try {
    const res = await fetch("/api/song", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Spud lost its voice. Try again later.");
    const lines = cleanLines((data.lines || []).join("\n"));
    if (!lines.length) throw new Error("Spud couldn't think of anything. Try another topic.");
    statusEl.textContent = "Here's Spud's new song!";
    loadSong({ title: data.title, lines }, { autoplay: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Write it";
  }
});

// ---------- start ----------
singBtn.addEventListener("click", sing);
if (canSpeak()) speechSynthesis.getVoices(); // warm up the voice list
else document.querySelector('input[value="hum"]').checked = true;

const m = location.hash.match(/song=([A-Za-z0-9_-]+)/);
let loaded = false;
if (m) {
  try {
    loadSong(decodeSong(m[1]));
    statusEl.textContent = "Someone sent you a song! Press play.";
    loaded = true;
  } catch {
    statusEl.textContent = "That song link looks broken, so here's Spud's theme.";
  }
}
if (!loaded) loadSong(DEFAULT_SONG, { shareable: false });
setMouth(0);
