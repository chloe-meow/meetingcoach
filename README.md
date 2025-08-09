# FocusFlow: The Meeting Coach — Minimal Offline MVP (Web, TypeScript/Next.js)

A local web app that turns an audio file + agenda text into a meeting report: tangents, agenda coverage, actions, and an effectiveness score.

## What this MVP does (offline)

- Transcribes an uploaded audio file (MP3/WAV) using OpenAI Whisper.
- Parses a pasted text agenda (one item per line; optional durations).
- Detects topic drift using embeddings + cosine similarity.
- Estimates agenda coverage and simple timing.
- Generates summary, decisions, and action items via one LLM call.
- Computes a 0–100 effectiveness score.
- Writes an HTML + JSON report to `public/reports/` and returns a link.

## Prerequisites

- Node.js 18+
- An OpenAI API key (Whisper + `text-embedding-3-small` + `gpt-4o-mini`)

## Setup

1. Install deps
   - `corepack enable && pnpm i`
2. Configure env
   - Create `.env.local` with:
     ```
     OPENAI_API_KEY=sk-...
     ```
3. Start dev server
   - `pnpm dev`
   - Open `http://localhost:3000`

## How to test (step-by-step)

1. Prepare an audio file
   - Format: `.mp3` or `.wav`
   - Length: start with 1–5 minutes to validate end-to-end
   - Content: include both on-topic and off-topic chatter to see tangents flagged
2. Prepare an agenda
   - Paste into the UI, one item per line; durations optional
   - Examples:
     - `Roadmap Q3 (10m)`
     - `Hiring plan – 5m`
     - `Open Q&A 10m`
3. Run an analysis
   - Drag-and-drop the audio file or click to upload
   - Paste the agenda
   - Click "Analyze"
4. View the result
   - A link appears: "Open report"
   - It will open `public/reports/{id}.html`
   - The JSON lives at `public/reports/{id}.json`

## What to expect as output

- Report contains:
  - Score: 0–100 (weighted: focus 40, adherence 30, balance 10, action clarity 15)
  - Agenda coverage table: planned vs. actual minutes and coverage %
  - Tangent timeline: merged spans where off-topic similarity fell below threshold (0.72)
  - Summary: 5–8 bullets
  - Decisions: concise bullet list
  - Action items: `[Owner] Task (Due)` format if parsed

Example `public/reports/{id}.json`:

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

## Tips

- Keep your first test short to minimize cost and latency.
- If Whisper returns no segments, the app falls back to a single chunk.
- Balance score is a placeholder until diarization is added.

## Next steps

- Render full report UI with charts and a timeline instead of minimal HTML.
- Add diarization (speaker labels) and speaking-time balance.
- Persist reports to a database with a meetings list.
- Slack notifications and realtime streaming.
