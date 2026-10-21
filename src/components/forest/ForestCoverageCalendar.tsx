"use client";

import { calendarModel, stackLabel, MIN_OBSERVATIONS, type CoverageStack } from "@/lib/forest-coverage";

/**
 * One row per compatible stack. Dots are real catalog-listed acquisitions on a true time axis; gaps are labelled where two
 * real acquisitions are far apart; nothing is drawn between them. These are CATALOG RECORDS only.
 */
export default function ForestCoverageCalendar({ stacks, windowStart, windowEnd, usedId, onUse }: {
  stacks: CoverageStack[];
  windowStart: string;
  windowEnd: string;
  usedId?: string;
  onUse?: (stack: CoverageStack) => void;
}) {
  if (!stacks.length) return null;
  return (
    <div className="forest-calendar" role="list" aria-label="Compatible NISAR acquisition stacks listed in NASA's catalog">
      <p className="forest-calendar__legend"><span className="forest-calendar__dot" aria-hidden="true" /> Acquisition listed in NASA&apos;s catalog. Not downloaded, not yet checked, not analysed. A dashed span is a real gap with no acquisition.</p>
      {stacks.map((stack) => {
        const model = calendarModel(stack.dates, windowStart, windowEnd);
        const missing = Math.max(0, MIN_OBSERVATIONS - stack.count);
        return (
          <div role="listitem" key={stack.id} className={`forest-calendar__row${stack.sufficient ? " is-enough" : ""}${usedId === stack.id ? " is-used" : ""}`}>
            <div className="forest-calendar__meta">
              <strong>{stackLabel(stack)}</strong>
              <span className="forest-micro">{stack.bandwidth} · {stack.polarizationMode}/{stack.pairedPolarizationMode ?? "—"} · release {stack.release}</span>
              <span className={`forest-calendar__count ${stack.sufficient ? "is-enough" : "is-short"}`}>{stack.count} date{stack.count === 1 ? "" : "s"} · {stack.sufficient ? "enough for analysis" : `needs ${missing} more`}{usedId === stack.id ? " · used by the search above" : ""}</span>
            </div>
            <div className="forest-calendar__axis" aria-label={`${stack.count} listed acquisitions: ${stack.dates.join(", ")}`}>
              {model.ticks.map((tick) => <span key={tick.label + tick.position} className="forest-calendar__tick" style={{ left: `${tick.position * 100}%` }}>{tick.label}</span>)}
              {model.gaps.map((gap) => <span key={gap.from} className="forest-calendar__gap" style={{ left: `${gap.start * 100}%`, width: `${(gap.end - gap.start) * 100}%` }} title={`${gap.days}-day gap between ${gap.from} and ${gap.to}`}><em>{gap.days}-day gap</em></span>)}
              {model.marks.map((mark) => <span key={mark.date} className="forest-calendar__mark" style={{ left: `${mark.position * 100}%` }} title={mark.date} />)}
            </div>
            {onUse && stack.bbox && <button type="button" className="forest-button-secondary" onClick={() => onUse(stack)}>Use this area</button>}
          </div>
        );
      })}
    </div>
  );
}
