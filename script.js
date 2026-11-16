// Potatohead: Spud performs real AI-made songs and lip-syncs to them.

const GENRES = [
  ["pop", "🎶 Pop"],
  ["rnb", "💜 R&B"],
  ["rock", "🎸 Rock"],
  ["hiphop", "🎤 Hip-hop"],
  ["afrobeats", "🥁 Afrobeats"],
  ["country", "🤠 Country"],
  ["reggae", "🌴 Reggae"],
  ["gospel", "🙌 Gospel"],
  ["edm", "⚡ EDM"],
  ["lullaby", "🌙 Lullaby"],
];
const GENRE_NAME = Object.fromEntries(GENRES);

const $ = (id) => document.getElementById(id);
const audio = $("audio");
const stage = $("stage");
const mouth = $("mouthOpen");
const tongue = $("tongue");
const statusEl = $("status");
const playBtn = $("play");

let genre = "rnb";
let mode = "topic";
let song = null;

// ---------- face ----------
// Spud's face and body are driven by spud.js (window.Spud).

function spawnNote() {
  const el = document.createElement("span");
  el.className = "note";
  el.textContent = ["♪", "♫", "♬"][Math.floor(Math.random() * 3)];
  el.style.left = 35 + Math.random() * 30 + "%";
  el.style.top = "45%";
  el.style.setProperty("--dx", (Math.random() * 180 - 90).toFixed(0) + "px");
  el.style.setProperty("--rot", (Math.random() * 60 - 30).toFixed(0) + "deg");
  $("notes").appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

// ---------- lip-sync ----------
// The song's loudness in the voice range drives the mouth; spikes in the
// low end (the beat) make notes fly. If the browser blocks reading the audio,
// Spud mouths along to a steady rhythm instead.
let ctx = null;
let analyser = null;
let freqData = null;
let raf = 0;
let lastNote = 0;
let silentFrames = 0;
let fakeSync = false;

function setupAnalyser() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
  } catch {
    fakeSync = true;
  }
}

function bandEnergy(lowHz, highHz) {
  const binHz = ctx.sampleRate / analyser.fftSize;
  const a = Math.floor(lowHz / binHz);
  const b = Math.min(freqData.length - 1, Math.ceil(highHz / binHz));
  let sum = 0;
  for (let i = a; i <= b; i++) sum += freqData[i];
  return sum / ((b - a + 1) * 255);
}

function frame(t) {
  raf = requestAnimationFrame(frame);
  if (audio.paused) return;
  let voice;
  let bass;
  if (!fakeSync && analyser) {
    analyser.getByteFrequencyData(freqData);
    voice = bandEnergy(300, 3000);
    bass = bandEnergy(40, 160);
    // All zeros while playing = the browser won't let us read this audio.
    silentFrames = voice + bass === 0 ? silentFrames + 1 : 0;
    if (silentFrames > 90) fakeSync = true;
  } else {
    // Can't hear the audio: perform to the style's tempo with a made-up energy curve.
    const beats = audio.currentTime / (60 / Spud.mood.bpm);
    const swell = 0.55 + 0.35 * Math.sin(audio.currentTime / 4);
    voice = (0.2 + 0.35 * Math.abs(Math.sin(beats * Math.PI * 1.5))) * swell;
    bass = beats % 1 < 0.12 ? 0.8 * swell + 0.1 : 0.15;
  }
  const { onBeat } = Spud.perform(t, voice, bass, audio.currentTime);
  if (onBeat && t - lastNote > 350) {
    lastNote = t;
    spawnNote();
  }
  $("bar").style.width = audio.duration ? (audio.currentTime / audio.duration) * 100 + "%" : "0";
}

// ---------- playback ----------
async function play() {
  if (!song) return;
  setupAnalyser();
  if (ctx && ctx.state === "suspended") await ctx.resume();
  try {
    await audio.play();
  } catch {
    statusEl.textContent = "Tap play again. Your browser blocked the sound.";
  }
}

audio.addEventListener("play", () => {
  stage.classList.add("singing");
  playBtn.textContent = "⏸ Pause";
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
});
audio.addEventListener("pause", () => {
  stage.classList.remove("singing");
  playBtn.textContent = "▶ Play";
  if (!audio.ended) Spud.relax();
});
audio.addEventListener("ended", () => {
  Spud.takeABow();
  playBtn.textContent = "↻ Play again";
  statusEl.textContent = "🥔👏 Encore? Share it, or make another one.";
});
audio.addEventListener("error", () => {
  if (song) statusEl.textContent = "Spud couldn't load that song. Try again later.";
});

playBtn.addEventListener("click", () => (audio.paused ? play() : audio.pause()));

function showSong(s, { autoplay }) {
  song = s;
  audio.pause();
  audio.src = s.audioUrl;
  $("now").hidden = false;
  $("songTitle").textContent = "“" + s.title + "”";
  $("songGenre").textContent = GENRE_NAME[s.genre] || "";
  $("lyrics").textContent = (s.lyrics || "").trim() || "Spud made these up on the spot.";
  $("download").href = s.audioUrl;
  $("download").setAttribute("download", s.title.replace(/[^\w\s-]/g, "").trim() + ".mp3");
  playBtn.textContent = "▶ Play";
  Spud.setGenre(s.genre);
  if (autoplay) play();
}

// ---------- share ----------
$("share").addEventListener("click", async () => {
  if (!song) return;
  const url = location.origin + "/?s=" + song.id;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Spud sings “" + song.title + "” 🥔🎤", url });
    } else {
      await navigator.clipboard.writeText(url);
      statusEl.textContent = "Link copied! Send it to someone.";
    }
  } catch {
    statusEl.textContent = "Share this link: " + url;
  }
});

// ---------- form ----------
const chips = $("genres");
GENRES.forEach(([key, label]) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.textContent = label;
  b.setAttribute("aria-pressed", String(key === genre));
  b.addEventListener("click", () => {
    genre = key;
    chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
  });
  chips.appendChild(b);
});

function setMode(m) {
  mode = m;
  $("tabTopic").setAttribute("aria-selected", String(m === "topic"));
  $("tabLyrics").setAttribute("aria-selected", String(m === "lyrics"));
  $("paneTopic").hidden = m !== "topic";
  $("paneLyrics").hidden = m !== "lyrics";
}
$("tabTopic").addEventListener("click", () => setMode("topic"));
$("tabLyrics").addEventListener("click", () => setMode("lyrics"));

const WAITING = [
  "Spud is warming up its vocal cords…",
  "The band is tuning up…",
  "Laying down the beat…",
  "Spud is in the recording booth…",
  "Adding a little potato magic…",
  "Mixing and mastering…",
];

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { genre };
  if (mode === "topic") {
    body.topic = $("topic").value.trim();
    if (!body.topic) return $("topic").focus();
  } else {
    body.lyrics = $("myLyrics").value.trim();
    body.title = $("title").value.trim();
    if (!body.lyrics) return $("myLyrics").focus();
  }

  const go = $("go");
  go.disabled = true;
  go.textContent = "🎙️ Recording…";
  stage.classList.add("working");
  audio.pause();
  let w = 0;
  statusEl.textContent = WAITING[0];
  const ticker = setInterval(() => (statusEl.textContent = WAITING[++w % WAITING.length]), 6000);
  window.scrollTo({ top: 0, behavior: "smooth" });

  try {
    const res = await fetch("/api/song", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.audioUrl) throw new Error(data.error || "Spud lost its voice. Try again in a moment.");
    statusEl.textContent = "🔥 Spud's new track is ready!";
    history.replaceState(null, "", "/?s=" + data.id);
    showSong(data, { autoplay: true });
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    clearInterval(ticker);
    stage.classList.remove("working");
    go.disabled = false;
    go.textContent = "🎤 Make Spud sing";
  }
});

// ---------- shared links ----------
(async () => {
  const id = new URLSearchParams(location.search).get("s");
  if (!id) return;
  statusEl.textContent = "Loading a song someone sent you…";
  try {
    const res = await fetch("/api/song?id=" + encodeURIComponent(id));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showSong(data, { autoplay: false });
    statusEl.textContent = "🎁 Someone sent you a Spud song! Press play.";
  } catch (err) {
    statusEl.textContent = (err && err.message) || "That song link looks broken.";
  }
})();

Spud.relax();
