"use client";

import { useEffect, useState } from "react";

type Check = {
  available: boolean; date?: string; status?: string; reason?: string | null;
  comparison?: { baseline?: { hls_date?: string }; event?: { hls_date?: string } } | null;
  coverage?: { common_clear_fraction?: number; common_clear_area_km2?: number } | null;
  optical_support?: { common_clear_fraction?: number; common_clear_area_km2?: number;
    true_positive_area_km2?: number; false_positive_area_km2?: number; false_negative_area_km2?: number;
    precision?: number | null; recall?: number | null; f1?: number | null } | null;
  radar_only_categories?: Record<string, number> | null;
  images?: Record<string, string> | null;
};

const percent = (value?: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;

export default function SavedDateCheck({ runId, date, refreshKey }: { runId: string; date: string; refreshKey: number }) {
  const [check, setCheck] = useState<Check | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/wetland/date-check?run=${runId}&date=${date}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Saved reference check could not be loaded.");
        return response.json() as Promise<Check>;
      })
      .then(setCheck)
      .catch(() => { if (!controller.signal.aborted) setCheck(null); });
    return () => controller.abort();
  }, [runId, date, refreshKey]);
  if (!check?.available || check.date !== date) return null;
  const usable = check.status === "CROSS_SENSOR_CHECK";
  const coverage = check.optical_support?.common_clear_fraction ?? check.coverage?.common_clear_fraction;
  const categories = check.radar_only_categories;
  const radarOnly = categories ? Object.values(categories).reduce((sum, value) => sum + value, 0) : 0;
  const alreadyWater = categories?.water_on_both_optical_dates ?? 0;
  const image = (name: string) => `/api/wetland/date-check?run=${runId}&date=${date}&file=${encodeURIComponent(name)}`;
  const panels = [
    { key: "before_rgb", title: "Optical before", date: check.comparison?.baseline?.hls_date },
    { key: "after_rgb", title: "Optical after", date: check.comparison?.event?.hls_date },
    { key: "agreement", title: "Change agreement", date: "Same study extent" },
  ];
  return <section className="nisar-tools-section nisar-reference-evidence" aria-labelledby="saved-date-check-title">
    <div className="nisar-tools-heading"><div><p className="global-eyebrow">SELECTED OBSERVATION · {date}</p><h2 id="saved-date-check-title">Independent check for this date</h2><p>This saved check uses the selected observation’s radar median baseline. The featured case below may describe a different date.</p></div></div>
    <div className="nisar-evidence-finding"><strong>{usable ? "Limited cross-sensor agreement" : "Reference check inconclusive"}</strong>
      {usable ? <p>{percent(coverage)} of the study mask was comparable in cloud-screened HLS. Native 30 m area overlap was {check.optical_support?.true_positive_area_km2?.toFixed(4) ?? "—"} km²; radar-only area was {check.optical_support?.false_positive_area_km2?.toFixed(4) ?? "—"} km² and optical-only new water was {check.optical_support?.false_negative_area_km2?.toFixed(4) ?? "—"} km². Agreement F1: {percent(check.optical_support?.f1)}. This is satellite agreement, not confirmed flood accuracy.</p>
        : <p>{check.reason || "The optical comparison did not have enough usable observations."} Only {check.optical_support?.common_clear_area_km2?.toFixed(4) ?? check.coverage?.common_clear_area_km2?.toFixed(4) ?? "—"} km² was comparable. No meaningful precision, recall or F1 can be reported.</p>}
      {radarOnly > 0 && <p>Among {radarOnly.toLocaleString()} assessed radar-only cells, {alreadyWater.toLocaleString()} were water on both HLS dates. HH darkening over existing water is not evidence of newly flooded land.</p>}
      <p>Optical dates: {check.comparison?.baseline?.hls_date ?? "—"} → {check.comparison?.event?.hls_date ?? "—"}. The median of several radar dates is represented by one optical baseline image; acquisition timing and 30 m mixed pixels limit interpretation.</p>
    </div>
    {check.images && panels.every((panel) => check.images?.[panel.key]) && <>
      <div className="nisar-radar-grid">{panels.map((panel) => <figure key={panel.key}><figcaption><strong>{panel.title}</strong><span>{panel.date}</span></figcaption><a href={image(check.images![panel.key])} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image(check.images![panel.key])} alt={panel.key === "agreement" ? "Turquoise shows matching new-water support, amber radar-only candidates, violet optical-only new water, and grey unassessed area." : `HLS true-colour image for ${panel.date}; visible clouds are excluded from the comparison.`} /></a></figure>)}</div>
      <ul className="nisar-evidence-legend" aria-label="Agreement image legend"><li><span style={{ backgroundColor: "#48dec6" }} />Both show new water</li><li><span style={{ backgroundColor: "#ffb54c" }} />Radar only</li><li><span style={{ backgroundColor: "#d397ff" }} />Optical only</li><li><span style={{ backgroundColor: "#7c8b9e" }} />Unassessed</li></ul>
    </>}
  </section>;
}
