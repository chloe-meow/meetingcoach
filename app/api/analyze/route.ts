import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Segment = { start: number | null; end: number | null; text: string };

function parseAgenda(
  description: string
): { title: string; plannedMinutes: number; order: number }[] {
  return description
    .split(/\r?\n/)
    .map((line, i) => {
      const m = line
        .trim()
        .match(/^(?:[-*]\s*)?(.+?)(?:\s*[\-–(]\s*(\d+)\s*m\s*[)\-])?$/i);
      if (!m) return null;
      const title = m[1].trim();
      const dur = m[2] ? Number(m[2]) : 10;
      if (!title) return null;
      return { title, plannedMinutes: dur, order: i };
    })
    .filter(Boolean) as any[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function parseTimeToSec(s: string): number | null {
  // Accepts 00:00:05.000 or 00:00:05,000
  const m = s.trim().match(/^(\d{2}):(\d{2}):(\d{2})[\.,]?(\d{0,3})?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ms = Number(m[4] || 0);
  return hh * 3600 + mm * 60 + ss + ms / 1000;
}

function parseVTTorSRT(content: string): Segment[] {
  const lines = content.split(/\r?\n/);
  const segs: Segment[] = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i].trim();
    // Skip headers/index numbers
    if (!line || /^\d+$/.test(line) || /^WEBVTT/i.test(line)) {
      i++;
      continue;
    }
    // Timestamp line
    const ts = line.match(
      /(\d{2}:\d{2}:\d{2}[\.,]\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[\.,]\d{1,3})/
    );
    if (ts) {
      const start = parseTimeToSec(ts[1]);
      const end = parseTimeToSec(ts[2]);
      i++;
      const textParts: string[] = [];
      while (i < lines.length && lines[i].trim() !== "") {
        textParts.push(lines[i]);
        i++;
      }
      segs.push({ start, end, text: textParts.join(" ").trim() });
      // consume blank
      i++;
    } else {
      i++;
    }
  }
  return segs.filter((s) => s.text);
}

function chunkSegments(
  segments: Segment[],
  windowSec = 30
): { start: number | null; end: number | null; text: string }[] {
  if (!segments.length) return [];
  const hasTime = segments.some((s) => s.start != null && s.end != null);
  if (!hasTime) {
    // No timestamps: group every ~4 lines/sentences
    const texts = segments.map((s) => s.text);
    const chunks: { start: number | null; end: number | null; text: string }[] =
      [];
    for (let i = 0; i < texts.length; i += 4) {
      chunks.push({
        start: null,
        end: null,
        text: texts
          .slice(i, i + 4)
          .join(" ")
          .trim(),
      });
    }
    return chunks.length
      ? chunks
      : [{ start: null, end: null, text: texts.join(" ") }];
  }

  const chunks: { start: number | null; end: number | null; text: string }[] =
    [];
  let curStart = segments[0].start!;
  let curEnd = segments[0].end!;
  let parts: string[] = [];
  for (const s of segments) {
    if (!parts.length) {
      curStart = s.start!;
      curEnd = s.end!;
    }
    const proposedEnd = s.end!;
    if (proposedEnd - curStart <= windowSec) {
      parts.push(s.text);
      curEnd = proposedEnd;
    } else {
      const text = parts.join(" ").trim();
      if (text) chunks.push({ start: curStart, end: curEnd, text });
      parts = [s.text];
      curStart = s.start!;
      curEnd = s.end!;
    }
  }
  if (parts.length) {
    const text = parts.join(" ").trim();
    if (text) chunks.push({ start: curStart, end: curEnd, text });
  }
  return chunks;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const mode = String(form.get("mode") || "audio");
    const agendaText = String(form.get("agenda") || "").trim();
    if (!agendaText) {
      return NextResponse.json({ error: "Missing agenda" }, { status: 400 });
    }
    const agenda = parseAgenda(agendaText);
    if (!agenda.length) {
      return NextResponse.json(
        { error: "Agenda parsing produced no items" },
        { status: 400 }
      );
    }

    let segments: Segment[] = [];

    if (mode === "transcript") {
      const transcriptFile = form.get("transcript") as File | null;
      let transcriptText = String(form.get("transcriptText") || "").trim();
      if (!transcriptFile && !transcriptText) {
        return NextResponse.json(
          { error: "Provide a transcript file or paste transcript text" },
          { status: 400 }
        );
      }
      if (transcriptFile) {
        const buf = Buffer.from(await transcriptFile.arrayBuffer());
        const name = transcriptFile.name.toLowerCase();
        const text = buf.toString("utf8");
        if (name.endsWith(".vtt") || name.endsWith(".srt")) {
          segments = parseVTTorSRT(text);
        } else {
          transcriptText = text;
        }
      }
      if (!segments.length && transcriptText) {
        // Detect pasted VTT/SRT timestamps
        const hasVtt =
          /\d{2}:\d{2}:\d{2}[\.,]\d{1,3}\s*-->\s*\d{2}:\d{2}:\d{2}[\.,]\d{1,3}/m.test(
            transcriptText
          );
        if (hasVtt) {
          segments = parseVTTorSRT(transcriptText);
        } else {
          const pieces = transcriptText
            .split(/\n\n+/)
            .map((t) => t.trim())
            .filter(Boolean);
          for (const p of pieces)
            segments.push({ start: null, end: null, text: p });
        }
      }
      if (!segments.length) {
        return NextResponse.json(
          { error: "Transcript could not be parsed" },
          { status: 400 }
        );
      }
    } else {
      // Audio mode
      const audioFile = form.get("audio") as File | null;
      if (!audioFile) {
        return NextResponse.json(
          { error: "Missing audio file" },
          { status: 400 }
        );
      }
      // Save uploaded audio to tmp
      const arrayBuffer = await audioFile.arrayBuffer();
      const bytes = Buffer.from(arrayBuffer);
      const tmpDir = path.join(process.cwd(), ".next", "cache", "uploads");
      await fs.mkdir(tmpDir, { recursive: true });
      const idTmp = crypto.randomUUID();
      const audioPath = path.join(tmpDir, `${idTmp}-${audioFile.name}`);
      await fs.writeFile(audioPath, bytes);

      // Transcribe
      const transcription = await openai.audio.transcriptions.create({
        file: createReadStream(audioPath) as any,
        model: "whisper-1",
        response_format: "verbose_json",
        temperature: 0,
      } as any);

      const segs =
        (transcription as any).segments?.map((s: any) => ({
          start: s.start as number,
          end: s.end as number,
          text: String(s.text || "").trim(),
        })) || [];
      const fullText: string =
        (transcription as any).text || segs.map((s: any) => s.text).join(" ");
      segments = segs.length ? segs : [{ start: 0, end: 0, text: fullText }];
    }

    // Build chunks
    const chunks = chunkSegments(segments, 30);

    // Embeddings
    const agendaEmb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: agenda.map((a) => a.title),
    });
    const chunkEmb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: chunks.map((c) => c.text),
    });

    const agendaVecs = agendaEmb.data.map((d) => d.embedding as number[]);
    const chunkVecs = chunkEmb.data.map((d) => d.embedding as number[]);

    const threshold = 0.72;
    const bestIdx: number[] = [];
    const isOffTopic: boolean[] = [];

    for (let i = 0; i < chunks.length; i++) {
      let best = -1;
      let bestSim = -1;
      for (let j = 0; j < agendaVecs.length; j++) {
        const sim = cosine(chunkVecs[i], agendaVecs[j]);
        if (sim > bestSim) {
          bestSim = sim;
          best = j;
        }
      }
      bestIdx.push(best);
      isOffTopic.push(bestSim < threshold);
    }

    // Tangents and coverage
    const hasTiming = chunks.some((c) => c.start != null && c.end != null);

    const tangents: { startSec: number | null; endSec: number | null }[] = [];
    let ii = 0;
    while (ii < chunks.length) {
      if (!isOffTopic[ii]) {
        ii++;
        continue;
      }
      let s = chunks[ii].start ?? null;
      let e = chunks[ii].end ?? null;
      let j = ii + 1;
      while (j < chunks.length && isOffTopic[j]) {
        s = s ?? chunks[j].start;
        e = chunks[j].end ?? e;
        j++;
      }
      tangents.push({
        startSec: hasTiming ? s : null,
        endSec: hasTiming ? e : null,
      });
      ii = j;
    }

    const minutesPerItem = new Array(agenda.length).fill(0);
    let totalMin = 0;
    let tangentMin = 0;

    if (hasTiming) {
      for (let k = 0; k < chunks.length; k++) {
        const durMin = Math.max(0, chunks[k].end! - chunks[k].start!) / 60;
        totalMin += durMin;
        if (isOffTopic[k]) {
          tangentMin += durMin;
          continue;
        }
        const idx = bestIdx[k];
        if (idx >= 0 && idx < minutesPerItem.length)
          minutesPerItem[idx] += durMin;
      }
    } else {
      // Counts-based fallback (no timeline)
      const perChunk = 1; // arbitrary unit
      for (let k = 0; k < chunks.length; k++) {
        totalMin += perChunk;
        if (isOffTopic[k]) {
          tangentMin += perChunk;
          continue;
        }
        const idx = bestIdx[k];
        if (idx >= 0 && idx < minutesPerItem.length)
          minutesPerItem[idx] += perChunk;
      }
    }

    // Summary/actions
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            'You are FocusFlow, a meeting coach. Return JSON: {"summary":[],"decisions":[],"actions":[{"owner":string|null,"text":string,"due":string|null}] }',
        },
        { role: "user", content: chunks.map((c) => c.text).join("\n") },
      ],
    });
    let parsed: any = {};
    try {
      parsed = JSON.parse(completion.choices[0].message.content || "{}");
    } catch {}
    const actionsCount = Array.isArray(parsed.actions)
      ? parsed.actions.length
      : 0;

    // Score
    const focusRatio =
      totalMin > 0 ? Math.max(0, 1 - tangentMin / totalMin) : 0;
    const focusScore = 40 * focusRatio;
    const adherenceRatio =
      minutesPerItem.filter((m) => m > 0).length / Math.max(1, agenda.length);
    const adherenceScore = 30 * adherenceRatio;
    const balanceScore = 10; // placeholder until diarization
    const actionsPerUnit =
      totalMin > 0 ? actionsCount / (totalMin / 15) : actionsCount / 5; // heuristic
    const actionClarityScore = 15 * Math.min(1, actionsPerUnit);
    const score = Math.round(
      Math.max(
        0,
        Math.min(
          100,
          focusScore + adherenceScore + balanceScore + actionClarityScore
        )
      )
    );

    const report = {
      meetingDurationMin: hasTiming ? Number(totalMin.toFixed(2)) : null,
      summary: parsed.summary || [],
      decisions: parsed.decisions || [],
      actions: parsed.actions || [],
      score,
      agenda: agenda.map((a, idx) => ({
        title: a.title,
        plannedMin: Number(a.plannedMinutes.toFixed(2)),
        actualMin: Number((minutesPerItem[idx] || 0).toFixed(2)),
        coverage: Number(
          Math.min(
            1,
            (minutesPerItem[idx] || 0) / Math.max(1e-6, a.plannedMinutes)
          ).toFixed(2)
        ),
      })),
      tangents: tangents.map((t) => ({ ...t, similarity: null, snippet: "" })),
      inputMode: mode,
      hasTimestamps: hasTiming,
    } as const;

    // Write report files
    const publicDir = path.join(process.cwd(), "public", "reports");
    await fs.mkdir(publicDir, { recursive: true });
    const id = crypto.randomUUID();
    const jsonPath = path.join(publicDir, `${id}.json`);
    const htmlPath = path.join(publicDir, `${id}.html`);
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

    const html = `<!doctype html><html><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/><title>FocusFlow Report</title></head><body><pre id=\"data\"></pre><script>document.getElementById('data').textContent = ${JSON.stringify(
      JSON.stringify(report)
    )};</script></body></html>`;
    await fs.writeFile(htmlPath, html, "utf8");

    const reportUrl = `/reports/${id}.html`;
    return NextResponse.json({ reportUrl });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message || "Internal error" },
      { status: 500 }
    );
  }
}
