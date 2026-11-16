# potatohead

Spud, the singing potato. Pick a style (R&B, rock, Afrobeats…), give Spud a topic or your own lyrics, and get a real song with vocals and a beat. Spud lip-syncs to it, and every song gets a share link and a download.

## How it works
- `index.html`, `style.css`, `script.js`: the site. The page plays the song and moves Spud's mouth to the vocal's loudness.
- `api/song.js` (Vercel function):
  - `POST` makes a song. Lyrics come from you, from Claude Haiku 5.5 if `ANTHROPIC_API_KEY` is set, or from Lyria itself. Google Lyria makes the track and it's saved to Vercel Blob.
  - `GET ?id=` loads a saved song for share links.

## Switching it on
Add these in Vercel → potatohead → Settings → Environment Variables, then redeploy:

| Variable | Needed | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | Lyria music generation |
| `ANTHROPIC_API_KEY` | no | Claude writes the lyrics |
| `SONG_MODEL` | no | `lyria-3-clip-preview` (30 s, $0.04, default) or `lyria-3.5` (full song, $0.08) |
| `DAILY_SONGS_PER_VISITOR` | no | default 3 |
| `DAILY_SONGS_TOTAL` | no | default 25 a day for the whole site (max about $1/day on clips) |

`BLOB_READ_WRITE_TOKEN` is set automatically by the connected Blob store.
