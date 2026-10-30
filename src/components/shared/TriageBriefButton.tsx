"use client";

export default function TriageBriefButton({ filename, title, brief }: {
  filename: string;
  title: string;
  brief: Record<string, unknown>;
}) {
  function download() {
    const blob = new Blob([JSON.stringify({ title, generated_at: new Date().toISOString(), ...brief }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <button type="button" className="radar-brief-button" onClick={download}>Download evidence triage brief (.json)</button>;
}
