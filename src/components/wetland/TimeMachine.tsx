"use client";

import React, { useEffect, useMemo } from "react";
import { useWetlandStore } from "@/lib/store";
import { datesWithPatches, nextAvailableIndex } from "@/lib/showcase";
import { Icon } from "./icons";
import { daysBetween, fmtDate, phases } from "@/lib/story";

const BASE_MS = 1700;

/** Real-date timeline. Observations are discrete stems; gaps are labelled, never smoothed over. */
export default function TimeMachine() {
  const { pulseData, selectedDateIndex, setSelectedDateIndex, isPlaying, setIsPlaying, playSpeed, setPlaySpeed, isLoadingData, lock, showcase, dataTier } = useWetlandStore();
  const dates = useMemo(() => pulseData?.dates ?? [], [pulseData]);
  const available = useMemo(() => (dataTier === "SHOWCASE" && showcase ? datesWithPatches(showcase) : null), [dataTier, showcase]);
  const idx = Math.min(Math.max(selectedDateIndex, 0), Math.max(dates.length - 1, 0));

  // Playback: advance only once the current date's data has loaded, so map, chart and metrics stay in sync.
  useEffect(() => {
    if (!isPlaying || !dates.length || isLoadingData) return;
    const timer = window.setTimeout(() => {
      const s = useWetlandStore.getState();
      const next = nextAvailableIndex(dates, available, s.selectedDateIndex, 1);
      if (next < 0) { s.setIsPlaying(false); return; }
      s.setSelectedDateIndex(next);
    }, BASE_MS / playSpeed);
    return () => window.clearTimeout(timer);
  }, [isPlaying, idx, playSpeed, isLoadingData, dates, available]);

  const geometry = useMemo(() => {
    if (!dates.length) return null;
    const t0 = Date.parse(`${dates[0].date}T00:00:00Z`); const t1 = Date.parse(`${dates[dates.length - 1].date}T00:00:00Z`);
    const span = Math.max(t1 - t0, 1);
    const maxArea = Math.max(...dates.map((d) => d.area_km2), 0.0001);
    const marks = dates.map((d, i) => ({ ...d, i, x: 4 + ((Date.parse(`${d.date}T00:00:00Z`) - t0) / span) * 92, h: (d.area_km2 / maxArea) * 100 }));
    const gaps = marks.slice(1).map((m, i) => ({ from: marks[i], to: m, days: daysBetween(marks[i].date, m.date) })).filter((g) => g.days > 14);
    return { marks, gaps };
  }, [dates]);
  if (!pulseData || !geometry) return null;

  const ph = phases(pulseData); const peakIdx = dates.findIndex((d) => d.date === pulseData.peak.date);
  const ok = (date: string) => !available || available.has(date);
  const jump = (date: string | null | undefined) => { const i = dates.findIndex((d) => d.date === date); if (i >= 0 && ok(dates[i].date)) { setIsPlaying(false); setSelectedDateIndex(i); } };
  const usable = dates.filter((d) => ok(d.date)).length;
  const firstUsable = nextAvailableIndex(dates, available, -1, 1);
  const prev = nextAvailableIndex(dates, available, idx, -1); const next = nextAvailableIndex(dates, available, idx, 1);
  const play = () => { if (isPlaying) return setIsPlaying(false); if (next < 0) setSelectedDateIndex(firstUsable); setIsPlaying(true); };
  const atEnd = next < 0 && !isPlaying;
  const cur = dates[idx];

  return (
    <section className="wx-timeline" aria-label="Observation timeline" data-locked={lock ? "true" : "false"}>
      <div className="wx-timeline__controls">
        <button className="wx-play" onClick={play} aria-pressed={isPlaying} disabled={usable < 2} title={usable < 2 ? "Playback needs at least two dates with exported results" : undefined}>{isPlaying ? <>{Icon.pause}<span>Pause</span></> : atEnd ? <>{Icon.replay}<span>Replay</span></> : <>{Icon.play}<span>Play change</span></>}</button>
        <div className="wx-step" role="group" aria-label="Step through observations">
          <button onClick={() => { setIsPlaying(false); setSelectedDateIndex(prev); }} disabled={prev < 0} aria-label="Previous observation">{Icon.prev}</button>
          <button onClick={() => { setIsPlaying(false); setSelectedDateIndex(next); }} disabled={next < 0} aria-label="Next observation">{Icon.next}</button>
        </div>
        <div className="wx-jumps" role="group" aria-label="Jump to phase">
          {pulseData.onset && ok(pulseData.onset) && <button onClick={() => jump(pulseData.onset)}>Onset</button>}
          {ok(pulseData.peak.date) && <button onClick={() => jump(pulseData.peak.date)}>Peak</button>}
          {pulseData.recession_start && ok(pulseData.recession_start) && <button onClick={() => jump(pulseData.recession_start)}>Recession</button>}
        </div>
        <div className="wx-speed" role="group" aria-label="Playback speed">
          {([0.5, 1, 2] as const).map((s) => <button key={s} aria-pressed={playSpeed === s} onClick={() => setPlaySpeed(s)}>{s}×</button>)}
        </div>
        <div className="wx-now" aria-live="polite">
          <strong>{fmtDate(cur.date, { month: "short", day: "numeric", year: "numeric" })}</strong>
          <span className="wx-mono">{cur.area_km2.toFixed(2)} km² flagged · {cur.patches} regions</span>
        </div>
      </div>

      <div className="wx-track" role="group" aria-label="Observations on a real time axis">
        <span className="wx-track__cap">Dots are real NISAR acquisitions. Bar height is flagged area. Nothing is drawn between dates.</span>
        <div className="wx-track__axis" />
        {geometry.gaps.map((g) => (
          <div key={g.from.date} className="wx-gap" style={{ left: `${g.from.x}%`, width: `${g.to.x - g.from.x}%` }}>
            <span>{g.days}-day gap, no observation</span>
          </div>
        ))}
        {geometry.marks.map((m) => {
          const phase = ph.find((p) => p.date === m.date && p.key !== "baseline");
          return (
            <button key={m.date} className={`wx-obs${m.i === idx ? " is-active" : ""}${m.i === peakIdx ? " is-peak" : ""}${ok(m.date) ? "" : " is-off"}`}
              style={{ left: `${m.x}%` }} onClick={() => { setIsPlaying(false); setSelectedDateIndex(m.i); }} disabled={!ok(m.date)}
              title={ok(m.date) ? undefined : "Observed by NISAR, but candidate regions for this date are not in this export"}
              aria-label={ok(m.date) ? `${fmtDate(m.date)}, ${m.area_km2.toFixed(1)} square kilometres, ${m.patches} regions${phase ? `, ${phase.label}` : ""}` : `${fmtDate(m.date)}, acquired; results not exported`} aria-current={m.i === idx}>
              <i className="wx-obs__stem" style={{ height: `${Math.max(6, m.h * 0.5)}px` }} />
              <i className="wx-obs__dot" />
              <span className="wx-obs__date">{fmtDate(m.date)}</span>
              {phase && ok(m.date) && <span className="wx-obs__phase">{phase.label}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
