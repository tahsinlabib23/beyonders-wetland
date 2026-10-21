"use client";

import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import { useWetlandStore } from "@/lib/store";

export default function WetlandPulse() {
  const { selectedDateIndex, setSelectedDateIndex, setIsPlaying, pulseData, demoMode } = useWetlandStore();

  if (!pulseData) {
    return <div className="panel-section"><div style={{ padding: 20 }}>Loading pulse...</div></div>;
  }

  const data = pulseData.dates;

  const chartData = data.map((d, i) => ({
    ...d,
    timestamp: new Date(`${d.date}T00:00:00Z`).getTime(),
    index: i,
  }));

  const acquisitionGaps = demoMode ? [] : data.slice(1).flatMap((observation, i) => {
    const days = Math.round((Date.parse(`${observation.date}T00:00:00Z`) - Date.parse(`${data[i].date}T00:00:00Z`)) / 86_400_000);
    return days > 14 ? [{ from: data[i].date, to: observation.date, days }] : [];
  });

  const peakIndex = data.findIndex((d) => d.date === pulseData.peak.date);
  const onsetIndex = data.findIndex((d) => d.date === pulseData.onset);
  const recessionIndex = data.findIndex((d) => d.date === pulseData.recession_start);

  const handleClick = (activeTooltipIndex: number | string | null | undefined) => {
    if (activeTooltipIndex === null || activeTooltipIndex === undefined || activeTooltipIndex === "") return;
    const index = Number(activeTooltipIndex);
    if (Number.isInteger(index) && index >= 0 && index < data.length) {
      setIsPlaying(false);
      setSelectedDateIndex(index);
    }
  };

  return (
    <div className="panel-section">
      <div className="section-header">
        <h3 className="section-title section-title--accent">Wetland Pulse</h3>
        <span className="data-label data-label--derived">
          {pulseData.data_source === "SIMULATED_DEMO"
            ? demoMode ? "BROWSER SIMULATION" : "RASTER SIMULATION"
            : pulseData.data_source === "NISAR"
              ? "NISAR · PROVISIONAL"
              : "SOURCE UNVERIFIED"}
        </span>
      </div>

      <div className="pulse-chart" style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} onClick={(state) => handleClick(state.activeTooltipIndex)}>
            <defs>
              <linearGradient id="pulseGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(value) => new Date(Number(value)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              tick={{ fill: "#64748b", fontSize: 10, fontFamily: "JetBrains Mono" }}
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 10, fontFamily: "JetBrains Mono" }}
              tickLine={false}
              axisLine={false}
              label={{
                value: "km²",
                angle: -90,
                position: "insideLeft",
                style: { fill: "#64748b", fontSize: 10 },
              }}
            />
            <Tooltip
              contentStyle={{
                background: "#151d2e",
                border: "1px solid rgba(0,212,255,0.25)",
                borderRadius: 8,
                fontSize: 12,
                fontFamily: "JetBrains Mono",
                color: "#f1f5f9",
              }}
              formatter={(value) =>
                typeof value === "number" ? `${value.toFixed(1)} km²` : String(value ?? "")
              }
              labelFormatter={(label) => `Date: ${new Date(Number(label)).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}`}
            />
            <Area
              isAnimationActive={false}
              type="monotone"
              dataKey="area_km2"
              stroke="#00d4ff"
              strokeWidth={2}
              fill="url(#pulseGradient)"
              dot={(props: Record<string, unknown>) => {
                const { cx, cy, index } = props as { cx: number; cy: number; index: number };
                const isSelected = index === selectedDateIndex;
                return (
                  <circle
                    key={index}
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 6 : 3}
                    fill={isSelected ? "#00d4ff" : "#0d1220"}
                    stroke="#00d4ff"
                    strokeWidth={isSelected ? 2 : 1}
                    style={{ cursor: "pointer", transition: "r 0.2s ease" }}
                  />
                );
              }}
              activeDot={{ r: 6, fill: "#00d4ff", stroke: "#0d1220", strokeWidth: 2 }}
            />

            {/* Peak marker */}
            {peakIndex >= 0 && (
              <ReferenceDot
                x={chartData[peakIndex].timestamp}
                y={chartData[peakIndex].area_km2}
                r={0}
                label={{
                  value: "▲ PEAK",
                  position: "top",
                  style: { fill: "#ef4444", fontSize: 9, fontWeight: 700, fontFamily: "Space Grotesk" },
                }}
              />
            )}

            {/* Onset line */}
            {onsetIndex >= 0 && (
              <ReferenceLine
                x={chartData[onsetIndex].timestamp}
                stroke="#10b981"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
              />
            )}

            {/* Recession line */}
            {recessionIndex >= 0 && (
              <ReferenceLine
                x={chartData[recessionIndex].timestamp}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="pulse-annotations">
        <div className="pulse-annotation">
          <span className="pulse-annotation__dot" style={{ background: "#10b981" }} />
          Onset
        </div>
        <div className="pulse-annotation">
          <span className="pulse-annotation__dot" style={{ background: "#ef4444" }} />
          Peak: {pulseData.peak.area_km2.toFixed(2)} km²
        </div>
        <div className="pulse-annotation">
          <span className="pulse-annotation__dot" style={{ background: "#f59e0b" }} />
          Recession
        </div>
      </div>
      {acquisitionGaps.map((gap) => <p className="evidence-notice" key={`${gap.from}-${gap.to}`}>
        No observation from {gap.from} to {gap.to} ({gap.days} days); no pulse values are interpolated.
      </p>)}
    </div>
  );
}
