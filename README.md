# FocusFlow: The Meeting Coach — Minimal Offline MVP (One‑Shot)

This README describes the absolute most basic version of FocusFlow you can produce in a single pass, locally, with no integrations and no real‑time behavior. It is a one‑shot analyzer that takes an audio file plus a plain‑text agenda and produces a self‑contained report (HTML + JSON) with tangents, agenda coverage, actions, and a meeting effectiveness score.

This document is descriptive only (no code included). It is intended to be your implementation guide for a quick weekend build.

## What this MVP does (offline)

- Transcribes a recorded meeting audio file (e.g., `meeting.mp3`).
- Parses a plain‑text agenda (lines; optional durations).
- Detects topic drift/tangents using embeddings and cosine similarity.
- Estimates agenda coverage and simple timing per item.
- Generates a concise summary, decisions, and action items via a single LLM call.
- Computes a transparent 0–100 meeting effectiveness score.
- Writes a single‑file HTML report and a machine‑readable JSON payload.

## What it does NOT do

- No calendar, Slack, Zoom/Meet, or task manager integrations.
- No real‑time nudges or timers during the call.
- No database, dashboard, or search index.
- No server/hosting; runs as a local one‑off script or notebook.

## Inputs

- `agenda.txt` — plain text with one item per line; optional durations.
  - Example lines:
    Roadmap Q3 (10m)
    Hiring plan – 5m
    Open Q&A 10m
- `meeting.mp3` (or `.wav`) — a single audio file of the meeting.
- Optional: attendee names/emails (used for owner extraction heuristics).

## Outputs

- `report.json` — structured analytics and extracted actions.
- `report.html` — single‑file visual report; open directly in a browser.

## Pipeline overview (single script or notebook)

1. Transcribe
   - Use a single provider for simplicity (e.g., OpenAI Whisper API; alternatives: AssemblyAI, Deepgram).
   - Keep segment timestamps for drift and coverage.
2. Parse agenda
   - Each line → `{ title, plannedMinutes }`; default duration = 10 minutes if omitted.
   - Clean titles by stripping durations/emoji; preserve input order.
3. Chunk transcript
   - Use STT segments directly or merge into ~20–30s windows for stable comparisons.
4. Embeddings + drift detection
   - Create embeddings for agenda titles and each transcript chunk (e.g., `text-embedding-3-small`).
   - Compute cosine similarity of each chunk to all agenda items; use the maximum similarity.
   - Flag chunk as off‑topic if similarity < 0.72 (adjustable).
   - Merge consecutive off‑topic chunks into tangent spans with start/end timestamps.
5. Agenda coverage and timing
   - Assign each on‑topic chunk to the agenda item with the highest similarity.
   - Actual minutes per agenda item = sum of assigned chunk durations.
   - Compute overrun/underrun vs planned minutes.
6. Summary, decisions, action items
   - Single LLM call (e.g., `gpt‑4o‑mini`) over the transcript (concatenated or batched) with explicit JSON output instructions.
   - Owner extraction heuristic: map names/mentions in transcript to provided attendees by email; else set owner to null.
7. Scoring rubric (transparent)
   - Focus (0–40): `1 − (tangent_minutes / total_minutes)`
   - Agenda adherence (0–30): `(items_with_any_coverage / planned_items)`
   - Participation balance (0–15): approximate via diarization; if unavailable, use constant 10
   - Action clarity (0–15): `min(1, actions_count / (duration_minutes / 15))`
   - Final score: weighted sum, rounded to integer in 0–100
8. Report generation
   - `report.json`: persist full results.
   - `report.html`: embed the JSON and render:
     - Score gauge
     - Agenda vs actual bar chart
     - Tangent timeline (highlight spans)
     - Summary, decisions, actions lists
   - Use a tiny client‑side charting lib (e.g., Chart.js) for visuals.

## Suggested providers and tooling

- One provider for both STT and LLM reduces setup (OpenAI is fine).
  - STT: Whisper (file transcription)
  - Embeddings: `text-embedding-3-small`
  - LLM: `gpt‑4o‑mini` (JSON output)
- Language: pick one to keep scope minimal
  - Python (notebook or script) or Node.js (single script)

## Minimal file layout

meeting-coach/
agenda.txt
meeting.mp3
README.md
(later, your single script or notebook)
outputs/
report.json
report.html

## Environment configuration (small surface area)

- One API key for your chosen provider (e.g., `OPENAI_API_KEY`).
- No other services required.

## Implementation checklist (step‑by‑step)

- [ ] Read `agenda.txt`; parse into items with optional durations.
- [ ] Transcribe `meeting.mp3` into segments with timestamps.
- [ ] Build chunks (~20–30s) from segments (or use segments directly).
- [ ] Create embeddings for agenda items and chunks.
- [ ] For each chunk, compute max similarity to agenda; label on/off topic.
- [ ] Merge off‑topic runs into tangent spans with start/end timestamps.
- [ ] Assign on‑topic chunks to best‑matching agenda item; sum durations.
- [ ] Generate summary, decisions, and actions (single LLM call with JSON output).
- [ ] Compute score using the rubric above; round to 0–100.
- [ ] Write `report.json` with all metrics and extracted data.
- [ ] Render `report.html` from the JSON (single‑file HTML with embedded data).

## Expected build time

- 60–90 minutes end‑to‑end if you keep to a single provider and one script.

## Example output schema (`report.json`)

{
"meetingDurationMin": 42,
"summary": ["..."],
"decisions": ["..."],
"actions": [
{ "owner": "alice@example.com", "text": "Prepare Q3 headcount plan", "due": null }
],
"score": 78,
"agenda": [
{ "title": "Roadmap Q3", "plannedMin": 10, "actualMin": 12.5, "coverage": 0.9 },
{ "title": "Hiring plan", "plannedMin": 5, "actualMin": 3.2, "coverage": 0.6 }
],
"tangents": [
{ "startSec": 755, "endSec": 840, "similarity": 0.58, "snippet": "…" }
]
}

## Limitations (conscious trade‑offs)

- Embedding‑only drift detection may misclassify brief context shifts.
- Owner extraction is heuristic without identity integrations.
- Participation balance requires diarization; if absent, it’s approximated.
- Long audio may require chunked LLM summarization; keep prompts lean.

## Next steps (beyond this MVP)

- Swap file‑based STT for realtime streaming and add Slack nudges.
- Persist results and enable a simple meetings dashboard.
- Add search via a vector DB for transcript chunks.
- Integrate task creation (Jira/Asana/Notion) for action items.

## License

You choose. For hackathon use, MIT is common.
