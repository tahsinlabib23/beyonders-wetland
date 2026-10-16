import React from "react";

/** Small stroke icons (16px). Decorative: the parent control always carries the accessible name. */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const wrap = (d: React.ReactNode) => <svg className="wx-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" {...P}>{d}</svg>;

export const Icon = {
  motion: wrap(<><path d="M2 11c2-5 4-5 6 0s4 5 6 0" /><circle cx="8" cy="8" r="0.6" /></>),
  radar: wrap(<><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="2.5" /><path d="M8 8l4-3.5" /></>),
  detection: wrap(<><rect x="2.5" y="2.5" width="11" height="11" rx="1" /><path d="M5 9l2-2 1.5 1.5L11 6" /></>),
  explain: wrap(<><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></>),
  region: wrap(<><path d="M3 5l5-2.5L13 6l-1.5 6L5 13.5 2.5 9z" /></>),
  probe: wrap(<><path d="M8 2v3M8 11v3M2 8h3M11 8h3" /><circle cx="8" cy="8" r="1.2" /></>),
  survive: wrap(<><path d="M2 13V9M6 13V5M10 13V7M14 13V3" /></>),
  compare: wrap(<><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M8 3v10" /></>),
  optical: wrap(<><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>),
  story: wrap(<><path d="M3 3h10M3 6.5h10M3 10h6" /></>),
  chain: wrap(<><circle cx="3.5" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="12.5" cy="8" r="1.5" /><path d="M5 8h1.5M9.5 8H11" /></>),
  why: wrap(<><circle cx="8" cy="8" r="6" /><path d="M6.3 6.3a1.8 1.8 0 113 1.3c-.7.5-1.3.8-1.3 1.6M8 11.6v.1" /></>),
  provenance: wrap(<><path d="M4 2.5h6l2.5 2.5v8.5H4z" /><path d="M6 8h4M6 10.5h4" /></>),
  play: wrap(<path d="M5 3l8 5-8 5z" fill="currentColor" />),
  pause: wrap(<path d="M5 3v10M11 3v10" strokeWidth={2} />),
  replay: wrap(<><path d="M3 8a5 5 0 105-5H5" /><path d="M5 1l-2.5 2L5 5" /></>),
  prev: wrap(<path d="M10 3L5 8l5 5" />),
  next: wrap(<path d="M6 3l5 5-5 5" />),
  close: wrap(<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />),
  info: wrap(<><circle cx="8" cy="8" r="6" /><path d="M8 7.2V11M8 5v.1" /></>),
  globe: wrap(<><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" /></>),
  layers: wrap(<><path d="M8 2l6 3-6 3-6-3z" /><path d="M2 8l6 3 6-3M2 11l6 3 6-3" /></>),
};
