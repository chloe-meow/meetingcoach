import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const agendaText = String(form.get("agenda") || "").trim();
    const audioFile = form.get("audio") as File | null;
    if (!agendaText || !audioFile) {
      return NextResponse.json(
        { error: "Missing agenda or audio" },
        { status: 400 }
      );
    }

    const agenda = parseAgenda(agendaText);
    if (!agenda.length) {
      return NextResponse.json(
        { error: "Agenda parsing produced no items" },
        { status: 400 }
      );
    }

    // Save uploaded audio to tmp
    const arrayBuffer = await audioFile.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const tmpDir = path.join(process.cwd(), ".next", "cache", "uploads");
    await fs.mkdir(tmpDir, { recursive: true });
    const id = crypto.randomUUID();
    const audioPath = path.join(tmpDir, `${id}-${audioFile.name}`);
    await fs.writeFile(audioPath, bytes);

    // Transcription using a readable stream
    const transcription = await openai.audio.transcriptions.create({
      file: createReadStream(audioPath) as any,
      model: "whisper-1",
      response_format: "verbose_json",
      temperature: 0,
    } as any);

    const segments: { start: number; end: number; text: string }[] =
      (transcription as any).segments?.map((s: any) => ({
        start: s.start,
        end: s.end,
        text: s.text,
      })) || [];
    const fullText: string =
      (transcription as any).text || segments.map((s) => s.text).join(" ");

    // Chunks (aggregate segments ~30s)
    const chunks: { start: number; end: number; text: string }[] = [];
    let curStart = segments[0]?.start ?? 0;
    let curEnd = segments[0]?.end ?? 0;
    let parts: string[] = [];
    for (const s of segments) {
      if (!parts.length) {
        curStart = s.start;
        curEnd = s.end;
      }
      const proposedEnd = s.end;
      if (proposedEnd - curStart <= 30) {
        parts.push(s.text);
        curEnd = proposedEnd;
      } else {
        const text = parts.join(" ").trim();
        if (text) chunks.push({ start: curStart, end: curEnd, text });
        parts = [s.text];
        curStart = s.start;
        curEnd = s.end;
      }
    }
    if (parts.length) {
      const text = parts.join(" ").trim();
      if (text) chunks.push({ start: curStart, end: curEnd, text });
    }
    if (!chunks.length) {
      chunks.push({ start: 0, end: 0, text: fullText });
    }

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

    // Tangents spans
    const tangents: { startSec: number; endSec: number }[] = [];
    let i = 0;
    while (i < chunks.length) {
      if (!isOffTopic[i]) {
        i++;
        continue;
      }
      let s = chunks[i].start;
      let e = chunks[i].end;
      let j = i + 1;
      while (j < chunks.length && isOffTopic[j]) {
        e = Math.max(e, chunks[j].end);
        j++;
      }
      tangents.push({ startSec: s, endSec: e });
      i = j;
    }

    // Coverage
    const minutesPerItem = new Array(agenda.length).fill(0);
    let totalMin = 0;
    let tangentMin = 0;
    for (let k = 0; k < chunks.length; k++) {
      const durMin = Math.max(0, chunks[k].end - chunks[k].start) / 60;
      totalMin += durMin;
      if (isOffTopic[k]) {
        tangentMin += durMin;
        continue;
      }
      const idx = bestIdx[k];
      if (idx >= 0 && idx < minutesPerItem.length)
        minutesPerItem[idx] += durMin;
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
    const balanceScore = 10; // placeholder
    const actionsPer15 = totalMin > 0 ? actionsCount / (totalMin / 15) : 0;
    const actionClarityScore = 15 * Math.min(1, actionsPer15);
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
      meetingDurationMin: Number(totalMin.toFixed(2)),
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
    };

    // Write report files to public dir for easy linking
    const publicDir = path.join(process.cwd(), "public", "reports");
    await fs.mkdir(publicDir, { recursive: true });
    const base = `${id}.json`;
    const jsonPath = path.join(publicDir, base);
    const htmlPath = path.join(publicDir, `${id}.html`);
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

    const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>FocusFlow Report</title></head><body><pre id="data"></pre><script>document.getElementById('data').textContent = ${JSON.stringify(
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
