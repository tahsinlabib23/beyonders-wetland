"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthReport } from "@/lib/forest-job";

type AuthResponse = {
  auth: AuthReport;
  python: { source: string; version: string } | null;
  missing?: string[];
  commands: { login: { primary: string; shell: string; where: string }; repair: string[] };
  catalogAvailable: boolean;
};
type ViewState = "unchecked" | "checking" | AuthReport["state"];

const STATE_COPY: Record<ViewState, { label: string; mark: string; tone: "idle" | "ok" | "warn" | "bad" }> = {
  unchecked: { label: "Not checked yet", mark: "○", tone: "idle" },
  checking: { label: "Checking…", mark: "◌", tone: "idle" },
  connected: { label: "Connected", mark: "✓", tone: "ok" },
  not_connected: { label: "Not connected", mark: "!", tone: "warn" },
  check_failed: { label: "Check failed", mark: "?", tone: "bad" },
  dependency_missing: { label: "Python setup needed", mark: "!", tone: "warn" },
  environment_missing: { label: "Python setup needed", mark: "!", tone: "warn" },
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure origins or blocked clipboard access.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    document.body.removeChild(area);
    return ok;
  }
}

function CommandBlock({ label, command, id }: { label: string; command: string; id: string }) {
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    setCopied((await copyText(command)) ? "ok" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied("idle"), 2200);
  };
  return (
    <div className="forest-command">
      <div className="forest-command__head"><span id={`${id}-label`}>{label}</span>
        <button type="button" onClick={() => void copy()} aria-describedby={`${id}-label`} data-copy-state={copied}>
          {copied === "ok" ? "Copied ✓" : copied === "failed" ? "Select and copy manually" : "Copy command"}
        </button>
      </div>
      <pre tabIndex={0} aria-labelledby={`${id}-label`}><code>{command}</code></pre>
      <span className="forest-sr-only" role="status" aria-live="polite">{copied === "ok" ? "Command copied to the clipboard" : ""}</span>
    </div>
  );
}

export default function ForestEarthdataConnection({ onStateChange }: { onStateChange?: (state: ViewState) => void }) {
  const [view, setView] = useState<ViewState>("unchecked");
  const [data, setData] = useState<AuthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const test = useCallback(async () => {
    const mine = ++requestId.current;
    setView("checking"); setError(null);
    try {
      const response = await fetch("/api/forest/auth", { cache: "no-store" });
      const body = await response.json() as AuthResponse;
      if (mine !== requestId.current) return; // a newer check superseded this one
      if (!response.ok || !body?.auth) throw new Error("The app could not run the connection check.");
      setData(body); setView(body.auth.state);
    } catch (caught) {
      if (mine !== requestId.current) return;
      setView("check_failed"); setError(caught instanceof Error ? caught.message : "The connection check failed.");
    }
  }, []);

  useEffect(() => { onStateChange?.(view); }, [view, onStateChange]);
  useEffect(() => {
    const first = window.setTimeout(() => void test(), 0); // check once when the panel appears; never claim a state without asking
    return () => window.clearTimeout(first);
  }, [test]);

  const copy = STATE_COPY[view];
  const login = data?.commands.login;
  const needsSetup = view === "environment_missing" || view === "dependency_missing";
  return (
    <section className="forest-earthdata" aria-labelledby="forest-earthdata-title" data-auth-state={view}>
      <div className="forest-earthdata__head">
        <div><p className="forest-kicker">Earthdata connection</p><h3 id="forest-earthdata-title">NASA Earthdata login</h3></div>
        <span className={`forest-auth-pill forest-auth-pill--${copy.tone}`} role="status" aria-live="polite"><span aria-hidden="true">{copy.mark}</span> {copy.label}</span>
      </div>
      <ul className="forest-earthdata__scope">
        <li><strong>Searching NASA&apos;s catalog</strong> is public. No login needed.</li>
        <li><strong>Downloading NISAR and HLS data</strong> needs a free Earthdata login. Your password is never typed into this website.</li>
      </ul>

      {view === "connected" && <p className="forest-earthdata__message">{data?.auth.message} {data?.auth.guidance}{data?.auth.tokenExpires ? ` Login token expires ${data.auth.tokenExpires}.` : ""}</p>}
      {(view === "not_connected" || view === "check_failed") && <p className="forest-earthdata__message">{data?.auth.message || error} {data?.auth.guidance}</p>}
      {view === "check_failed" && error && !data?.auth && <p className="forest-earthdata__message">{error}</p>}

      {!needsSetup && login && view !== "connected" && (
        <>
          <p className="forest-earthdata__how">Run this once in {login.shell}. {login.where} It asks for your Earthdata username and password in the terminal and saves a login for later runs.</p>
          <CommandBlock id="earthdata-login" label="Earthdata login command" command={login.primary} />
        </>
      )}
      {needsSetup && data && (
        <>
          <p className="forest-earthdata__message">{data.auth.message} {data.auth.guidance}</p>
          <p className="forest-earthdata__how">Run these two commands from the repository root, then press Test connection:</p>
          {data.commands.repair.map((command, index) => <CommandBlock key={command} id={`repair-${index}`} label={index === 0 ? "1. Create the Python environment" : "2. Install the requirements"} command={command} />)}
        </>
      )}
      {needsSetup && !data && <p className="forest-earthdata__message">The Python environment could not be inspected. Press Test connection to try again.</p>}

      <div className="forest-earthdata__actions">
        <button type="button" className="forest-button-secondary" onClick={() => void test()} disabled={view === "checking"}>{view === "checking" ? "Checking with Earthdata…" : "Test connection"}</button>
        {data?.auth.checkedAt && view !== "checking" && <span className="forest-micro">Last checked {new Date(data.auth.checkedAt).toLocaleTimeString()}</span>}
      </div>
    </section>
  );
}
