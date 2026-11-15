# potatohead

Spud, the singing potato. Give Spud a topic and it writes an original song with AI, or paste your own lyrics and Spud learns them. Every song gets a share link.

## How it works
- `index.html`, `style.css`, `script.js`: the whole site. The tune is composed in the browser from the words. Spud sings the words with the browser's speech voice and a synth note under each word, or hums the tune.
- `api/song.js`: a Vercel serverless function. It asks Claude Haiku 5.5 for short, original, family-friendly lyrics (roughly $0.001 per song).
- Share links carry the song inside the URL (`#song=...`), so there is no database.

## Setup on Vercel
1. Add the environment variable `ANTHROPIC_API_KEY` (Project → Settings → Environment Variables), then redeploy.
2. Set a monthly spend limit in the Anthropic Console so the bill can't run away.
3. Optional: `DAILY_SONGS_PER_VISITOR` (default 10).

Without the API key, the "I write it" mode and share links still work, and the AI mode shows a friendly message.
