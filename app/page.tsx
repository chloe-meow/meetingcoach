"use client";
import React, { useRef, useState } from "react";

export default function Page() {
  const [mode, setMode] = useState<"audio" | "transcript">("audio");
  const [audio, setAudio] = useState<File | null>(null);
  const [agenda, setAgenda] = useState<string>(
    "Roadmap Q3 (10m)\nHiring plan – 5m\nOpen Q&A 10m"
  );
  const [transcriptText, setTranscriptText] = useState<string>("");
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReportUrl(null);

    const form = new FormData();
    form.set("mode", mode);
    form.set("agenda", agenda);

    if (mode === "audio") {
      if (!audio) {
        setError("Please select an audio file");
        return;
      }
      form.set("audio", audio);
    } else {
      if (!transcriptFile && !transcriptText.trim()) {
        setError("Upload a transcript file or paste transcript text");
        return;
      }
      if (transcriptFile) form.set("transcript", transcriptFile);
      if (transcriptText.trim())
        form.set("transcriptText", transcriptText.trim());
    }

    setRunning(true);
    try {
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setReportUrl(data.reportUrl as string);
    } catch (err: any) {
      setError(err.message || "Failed");
    } finally {
      setRunning(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) setAudio(f);
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Analyze a meeting</div>
        <p className="card-desc">
          This app turns a meeting recording or transcript plus an agenda into a
          report with tangents, agenda coverage, summary, action items, and a
          score. Keep first tests short for speed.
        </p>
      </div>
      <div className="card-body">
        <form onSubmit={onSubmit} className="grid">
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => setMode("audio")}
              style={{
                background:
                  mode === "audio" ? "rgba(99,102,241,0.2)" : "#0b1224",
                border: "1px solid #1f2937",
              }}
            >
              Audio mode
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setMode("transcript")}
              style={{
                background:
                  mode === "transcript" ? "rgba(99,102,241,0.2)" : "#0b1224",
                border: "1px solid #1f2937",
              }}
            >
              Transcript mode
            </button>
          </div>

          <div className="label">Instructions</div>
          <div className="alert">
            <div>
              <strong>Agenda</strong>: One item per line; optional durations
              like "Topic (10m)".
            </div>
            <div>
              <strong>Audio</strong>: .mp3/.wav, 1–5 minutes recommended for
              your first run.
            </div>
            <div>
              <strong>Transcript</strong>: Paste plain text or upload
              .vtt/.srt/.txt. If no timestamps, the timeline is omitted and
              coverage uses counts-based estimates.
            </div>
          </div>

          {mode === "audio" ? (
            <div>
              <div className="label">Audio file</div>
              <div
                className="dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="drop-left">
                  <div className="drop-title">
                    {audio ? audio.name : "Drop file or click to browse"}
                  </div>
                  <div className="drop-sub">
                    Short files recommended for faster processing
                  </div>
                </div>
                <div className="badge">MP3/WAV</div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={(e) => setAudio(e.target.files?.[0] ?? null)}
              />
            </div>
          ) : (
            <div className="grid">
              <div>
                <div className="label">Transcript file (optional)</div>
                <input
                  type="file"
                  accept=".vtt,.srt,.txt,text/plain"
                  className="input"
                  onChange={(e) =>
                    setTranscriptFile(e.target.files?.[0] ?? null)
                  }
                />
              </div>
              <div>
                <div className="label">Or paste transcript text</div>
                <textarea
                  className="textarea"
                  placeholder="Paste transcript here..."
                  value={transcriptText}
                  onChange={(e) => setTranscriptText(e.target.value)}
                  rows={10}
                />
              </div>
            </div>
          )}

          <div>
            <div className="label">Agenda</div>
            <textarea
              className="textarea"
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              rows={8}
            />
          </div>

          <div className="row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={running}
            >
              {running ? "Analyzing…" : "Analyze"}
            </button>
            {reportUrl && (
              <a
                className="badge"
                href={reportUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open report
              </a>
            )}
          </div>

          {error && <div className="alert alert-danger">{error}</div>}
        </form>
      </div>
    </div>
  );
}
