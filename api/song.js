// Spud's real singing.
//   POST /api/song  { topic?, lyrics?, title?, genre }  -> song
//   GET  /api/song?id=<id>                              -> song (for share links)
// A song is { id, title, genre, lyrics, audioUrl, createdAt }.
//
// Pipeline: lyrics (yours, or Claude's if ANTHROPIC_API_KEY is set, or Lyria's own)
//   -> Google Lyria makes the track with vocals -> saved to Vercel Blob.
import { put, head, list } from "@vercel/blob";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { randomBytes } from "node:crypto";

// lyria-3-clip-preview: 30 s, $0.04/song. lyria-3.5: full song, $0.08/song.
const MUSIC_MODEL = process.env.SONG_MODEL || "lyria-3-clip-preview";
const PER_VISITOR = Number(process.env.DAILY_SONGS_PER_VISITOR || 3);
const PER_DAY = Number(process.env.DAILY_SONGS_TOTAL || 25);

export const GENRES = {
  pop: "Upbeat modern pop, catchy hook, bright synths, punchy drums, about 118 BPM",
  rnb: "Smooth contemporary R&B slow jam, silky electric piano, deep 808 bass, finger snaps, lush harmonies, about 72 BPM",
  rock: "High-energy arena rock, distorted electric guitars, driving bass, big live drums, shout-along chorus, about 140 BPM",
  hiphop: "Bouncy hip-hop beat, hard-hitting boom-bap drums, rhythmic rap verses with a sung hook, about 92 BPM",
  afrobeats: "Feel-good Afrobeats, log drum and shakers, syncopated percussion, warm guitar riffs, sing-along chorus, about 105 BPM",
  country: "Warm country song, acoustic guitar, pedal steel, fiddle, storytelling vocal, about 100 BPM",
  reggae: "Laid-back roots reggae, offbeat guitar skank, deep bass, one-drop drums, about 75 BPM",
  gospel: "Joyful gospel, Hammond organ, piano, handclaps, choir backing vocals answering the lead, about 110 BPM",
  edm: "Euphoric EDM festival track, big synth build-up and drop, four-on-the-floor kick, vocal hook, about 128 BPM",
  lullaby: "Gentle lullaby, soft music box and acoustic guitar, soothing hushed vocal, about 70 BPM",
};

const SPUD_VOICE =
  "Lead vocal: Spud, a cheerful cartoon potato. A playful, warm male tenor with a bright, slightly goofy charm, clearly enunciated so every word is understood.";

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function clean(text, max) {
  return String(text || "").replace(/\r/g, "").trim().slice(0, max);
}

const today = () => new Date().toISOString().slice(0, 10);
const idToPath = (id) => `songs/${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}/${id}`;
const ID_RE = /^\d{8}-[a-z0-9]{10}$/;

// ---------- limits ----------
// Per visitor: in-memory, best effort (instances don't share memory).
// Per day: counts today's saved songs in Blob, so it holds across instances.
const hits = new Map();
function visitorAllowed(ip) {
  const key = ip + "|" + today();
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 5000) hits.clear();
  return n <= PER_VISITOR;
}

async function songsToday() {
  let count = 0;
  let cursor;
  do {
    const page = await list({ prefix: `songs/${today()}/`, cursor, limit: 1000 });
    count += page.blobs.filter((b) => b.pathname.endsWith(".mp3")).length;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && count < PER_DAY);
  return count;
}

// ---------- lyrics with Claude (optional) ----------
const Written = z.object({ title: z.string(), lyrics: z.string() });

async function claudeLyrics(topic, genreName) {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-haiku-5-5",
    max_tokens: 2000,
    output_config: { effort: "low", format: zodOutputFormat(Written) },
    system: `You write lyrics for Spud, a cheerful singing cartoon potato.
Write ORIGINAL, family-friendly lyrics for a short ${genreName} song (about 30 seconds sung).
Use exactly this shape: "[Verse]" with 4 short lines, then "[Chorus]" with 4 short lines. Catchy, rhythmic, rhyming, fun, with a potato pun if it fits.
Never reproduce or closely paraphrase lyrics from existing songs, and never imitate a named artist. If the visitor names a real song or artist, write a brand-new song with a similar mood instead.
If the topic is hateful, sexual, or meant to hurt someone, write a silly song about potatoes instead.
The title is 1 to 5 words.`,
    messages: [{ role: "user", content: `Topic: ${topic}` }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  return response.parsed_output;
}

// ---------- music with Lyria ----------
class SongError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function lyria(prompt) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Revision": "2026-05-20",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({ model: MUSIC_MODEL, input: prompt }),
    signal: AbortSignal.timeout(110_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = JSON.stringify(data.error || data).toLowerCase();
    console.error("Lyria error", r.status, msg.slice(0, 500));
    if (r.status === 400 && /safety|block|policy|copyright|artist/.test(msg)) {
      throw new SongError(422, "Spud can't sing that one. Try different words. (No famous songs or artist voices.)");
    }
    if (r.status === 429) throw new SongError(429, "Spud's band is busy right now. Try again in a minute.");
    if (r.status === 401 || r.status === 403) throw new SongError(503, "Spud's music key isn't working. The site owner needs to check it.");
    throw new SongError(502, "Spud's band tripped over a cable. Try again in a moment.");
  }
  let audio = null;
  const texts = [];
  for (const step of data.steps || []) {
    if (step.type !== "model_output") continue;
    for (const block of step.content || []) {
      if (block.type === "audio" && block.data) audio = Buffer.from(block.data, "base64");
      else if (block.type === "text" && block.text) texts.push(block.text);
    }
  }
  if (!audio) throw new SongError(422, "Spud couldn't make that song. Try different words.");
  // Text blocks hold lyrics and sometimes a JSON description of the structure; keep the lyrics.
  const lyricsText = texts.filter((t) => !/^\s*[[{]/.test(t) || /\[(verse|chorus|bridge|intro|outro)/i.test(t)).join("\n").trim();
  return { audio, lyrics: lyricsText };
}

// ---------- handlers ----------
async function getSong(req, res) {
  const id = String(req.query.id || "");
  if (!ID_RE.test(id)) return json(res, 400, { error: "That song link looks broken." });
  try {
    const meta = await head(idToPath(id) + ".json");
    const r = await fetch(meta.url);
    if (!r.ok) throw new Error("fetch failed");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).json(await r.json());
  } catch {
    return json(res, 404, { error: "Spud can't find that song." });
  }
}

async function makeSong(req, res) {
  if (!process.env.GEMINI_API_KEY) {
    return json(res, 503, { error: "Spud's real voice isn't switched on yet. The site owner needs to add the music key." });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return json(res, 503, { error: "Spud's song shelf isn't set up yet." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const genre = GENRES[body?.genre] ? body.genre : "pop";
  const style = GENRES[genre];
  const topic = clean(body?.topic, 120).replace(/\s+/g, " ");
  const ownLyrics = clean(body?.lyrics, 1200);
  let title = clean(body?.title, 60).replace(/\s+/g, " ");
  if (!topic && !ownLyrics) return json(res, 400, { error: "Tell Spud what to sing about, or give it lyrics." });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (!visitorAllowed(ip)) {
    return json(res, 429, { error: "Spud needs a nap. You've had today's songs, so come back tomorrow!" });
  }
  if ((await songsToday()) >= PER_DAY) {
    return json(res, 429, { error: "Spud has sung all the songs it can today. Come back tomorrow!" });
  }

  let lyrics = ownLyrics;
  if (!lyrics && process.env.ANTHROPIC_API_KEY) {
    try {
      const written = await claudeLyrics(topic, genre);
      if (written) {
        lyrics = clean(written.lyrics, 1200);
        title = title || clean(written.title, 60);
      }
    } catch (err) {
      console.error("Claude lyrics failed, letting Lyria write them", err?.status, err?.message);
    }
  }

  const prompt = lyrics
    ? `${style}. ${SPUD_VOICE}\n\nSing these lyrics exactly:\n\n${lyrics}`
    : `${style}. ${SPUD_VOICE}\n\nWrite and sing original, family-friendly, catchy lyrics about: ${topic}. Use a short verse and a big chorus.`;

  let song;
  try {
    song = await lyria(prompt);
  } catch (err) {
    if (err instanceof SongError) return json(res, err.status, { error: err.message });
    console.error(err);
    return json(res, 502, { error: "Spud lost its voice. Try again in a moment." });
  }

  const id = today().replace(/-/g, "") + "-" + randomBytes(8).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(10, "0").slice(0, 10);
  const path = idToPath(id);
  const audioBlob = await put(path + ".mp3", song.audio, {
    access: "public",
    contentType: "audio/mpeg",
    addRandomSuffix: false,
  });
  const meta = {
    id,
    title: title || (topic ? `A song about ${topic}` : "Spud's song").slice(0, 60),
    genre,
    lyrics: lyrics || song.lyrics || "",
    audioUrl: audioBlob.url,
    createdAt: new Date().toISOString(),
  };
  await put(path + ".json", JSON.stringify(meta), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return json(res, 200, meta);
}

export default async function handler(req, res) {
  if (req.method === "GET") return getSong(req, res);
  if (req.method === "POST") return makeSong(req, res);
  res.setHeader("Allow", "GET, POST");
  return json(res, 405, { error: "Use GET or POST." });
}
