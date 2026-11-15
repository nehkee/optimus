// POST /api/song  { topic: string }  ->  { title: string, lines: string[] }
// Asks Claude to write short, original, family-friendly lyrics. The browser composes the tune.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const MODEL = "claude-haiku-5-5"; // cheapest current model: roughly $0.001 per song
const DAILY_LIMIT_PER_IP = Number(process.env.DAILY_SONGS_PER_VISITOR || 10);

const Song = z.object({
  title: z.string(),
  lines: z.array(z.string()),
});

const SYSTEM = `You are Spud, a cheerful singing cartoon potato on a fun website.
Write a short ORIGINAL song about the topic the visitor gives you.

Rules:
- 4 to 8 lines, each 4 to 9 words. Simple words that are easy to sing. No stage directions or labels like "Chorus".
- Family-friendly and kind. Playful potato puns are welcome.
- Never reproduce or closely paraphrase lyrics from existing songs. If the visitor names a real song or artist, write a brand-new song with a similar mood or theme instead.
- If the topic is hateful, sexual, or meant to hurt someone, write a silly song about potatoes instead.
- The title is 1 to 5 words.`;

// Best-effort limiter. Serverless instances don't share memory, so this is a
// speed bump; the real safety net is the monthly spend limit on your Anthropic account.
const hits = new Map();
function allowed(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const key = ip + "|" + day;
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 5000) hits.clear();
  return n <= DAILY_LIMIT_PER_IP;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "Spud's songwriting brain isn't switched on yet. Try the “I write it” tab!",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const topic = String(body?.topic || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!topic) return res.status(400).json({ error: "Tell Spud what to sing about." });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (!allowed(ip)) {
    return res.status(429).json({
      error: "Spud needs a nap. You've had today's songs, so come back tomorrow, or write your own lyrics!",
    });
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(Song) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Topic: ${topic}` }],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return res.status(422).json({ error: "Spud didn't want to sing about that. Try another topic!" });
    }

    const { title, lines } = response.parsed_output;
    const clean = lines
      .map((l) => String(l).replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 10);
    return res.status(200).json({ title: String(title).slice(0, 60), lines: clean });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Spud is very popular right now. Try again in a minute." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error", err.status, err.message);
    } else {
      console.error(err);
    }
    return res.status(502).json({ error: "Spud lost its voice. Try again in a moment." });
  }
}
