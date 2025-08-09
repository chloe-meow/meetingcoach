"use client";
import React, { useState } from "react";

export default function Page() {
  const [audio, setAudio] = useState<File | null>(null);
  const [agenda, setAgenda] = useState<string>(
    "Roadmap Q3 (10m)\nHiring plan – 5m\nOpen Q&A 10m"
  );
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReportUrl(null);
    if (!audio) {
      setError("Please select an audio file");
      return;
    }
    setRunning(true);
    try {
      const form = new FormData();
      form.set("agenda", agenda);
      form.set("audio", audio);
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

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 16 }}>
      <label>
        <div style={{ fontWeight: 600 }}>Audio file (mp3/wav)</div>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => setAudio(e.target.files?.[0] ?? null)}
        />
      </label>
      <label>
        <div style={{ fontWeight: 600 }}>Agenda</div>
        <textarea
          value={agenda}
          onChange={(e) => setAgenda(e.target.value)}
          rows={6}
          style={{ width: "100%" }}
        />
      </label>
      <button type="submit" disabled={running} style={{ padding: "8px 12px" }}>
        {running ? "Analyzing…" : "Analyze"}
      </button>
      {error && <div style={{ color: "crimson" }}>{error}</div>}
      {reportUrl && (
        <a href={reportUrl} target="_blank" rel="noreferrer">
          Open report
        </a>
      )}
    </form>
  );
}
