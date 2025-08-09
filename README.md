# FocusFlow: The Meeting Coach — Minimal Offline MVP (Web, TypeScript/Next.js)

This project provides the absolute most basic, one‑shot Meeting Coach as a local web app. Upload an audio file and paste an agenda; it produces a report (HTML + JSON) with tangents, agenda coverage, actions, and an effectiveness score.

## What this MVP does (offline)

- Transcribes an uploaded audio file (MP3/WAV) using OpenAI Whisper.
- Parses a pasted text agenda (one item per line; optional durations).
- Detects topic drift using embeddings + cosine similarity.
- Estimates agenda coverage and simple timing.
- Generates summary, decisions, and action items via one LLM call.
- Computes a simple 0–100 effectiveness score.
- Writes a self‑contained HTML report to `public/reports` and returns a link.

## Quick start

1. Prerequisites
   - Node.js 18+
   - An OpenAI API key with access to Whisper + embeddings + a small chat model
2. Setup
   - `cd meeting-coach`
   - `corepack enable && pnpm i`
   - Create `.env.local` with:
     ```
     OPENAI_API_KEY=sk-...
     ```
3. Run
   - Dev: `pnpm dev`
   - Open `http://localhost:3000`
   - Upload an audio file and paste your agenda; click Analyze and open the report link.

Reports are saved under `public/reports/` as `{id}.html` and `{id}.json`.

## Inputs

- Agenda: plain text lines, optional durations, e.g.:
  - `Roadmap Q3 (10m)`
  - `Hiring plan – 5m`
  - `Open Q&A 10m`
- Audio: `.mp3` or `.wav` (short file recommended for first run)

## Outputs

- `public/reports/{id}.json` — structured analytics and extracted actions
- `public/reports/{id}.html` — self‑contained HTML

## Pipeline overview

1. Transcribe (Whisper `whisper-1`), capturing segments and timestamps.
2. Parse agenda into `{ title, plannedMinutes, order }` with defaults.
3. Chunk transcript (~30s windows) from segments.
4. Embeddings + drift:
   - `text-embedding-3-small` for agenda titles and chunks
   - Off‑topic flag if max similarity < 0.72
   - Merge consecutive off‑topic chunks into tangent spans
5. Coverage & timing: assign on‑topic chunks to best agenda item; sum durations.
6. Summary/decisions/actions: one chat call (`gpt‑4o‑mini`) returning JSON.
7. Score: focus (40), adherence (30), balance (10 placeholder), action clarity (15); 0–100.

## Example output schema (`public/reports/{id}.json`)

```json
{
  "meetingDurationMin": 42,
  "summary": ["..."],
  "decisions": ["..."],
  "actions": [
    {
      "owner": "alice@example.com",
      "text": "Prepare Q3 headcount plan",
      "due": null
    }
  ],
  "score": 78,
  "agenda": [
    {
      "title": "Roadmap Q3",
      "plannedMin": 10,
      "actualMin": 12.5,
      "coverage": 0.9
    },
    {
      "title": "Hiring plan",
      "plannedMin": 5,
      "actualMin": 3.2,
      "coverage": 0.6
    }
  ],
  "tangents": [
    { "startSec": 755, "endSec": 840, "similarity": null, "snippet": "" }
  ]
}
```

## Notes & limits

- Keep files short to control latency/cost.
- If Whisper returns no segments, the app falls back to a single chunk.
- Balance score is a placeholder until diarization is added.

## Next steps

- Improve UI: render the full HTML report (timeline, charts) server‑side.
- Add diarization and speaking‑time balance.
- Persist reports to a database and list them in a dashboard.
- Add Slack notifications and move toward realtime analysis.
