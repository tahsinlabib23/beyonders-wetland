"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { useWetlandStore } from "@/lib/store";
import { ANIMATION } from "@/lib/constants";

export default function DateScrubber() {
  const {
    selectedDateIndex,
    setSelectedDateIndex,
    isPlaying,
    setIsPlaying,
    pulseData,
    demoMode,
  } = useWetlandStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const dates = pulseData?.dates || [];

  const handlePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
    }
  }, [isPlaying, setIsPlaying]);

  useEffect(() => {
    if (isPlaying && dates.length > 0) {
      intervalRef.current = setInterval(() => {
        setSelectedDateIndex(
          useWetlandStore.getState().selectedDateIndex >= dates.length - 1
            ? 0
            : useWetlandStore.getState().selectedDateIndex + 1
        );
      }, ANIMATION.playIntervalMs);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, dates.length, setSelectedDateIndex]);

  if (!pulseData || dates.length === 0) return null;

  const activeDateIndex = Math.min(Math.max(selectedDateIndex, 0), dates.length - 1);

  const formatDate = (d: string) => {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return d;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="date-scrubber" role="group" aria-label="Observation timeline">
      <button
        className="date-scrubber__play-btn"
        onClick={handlePlay}
        title={isPlaying ? "Pause" : "Play"}
        aria-label={isPlaying ? "Pause observation timeline" : "Play observation timeline"}
        aria-pressed={isPlaying}
      >
        {isPlaying ? "⏸" : "▶"}
      </button>

      <div className="date-scrubber__slider">
        <input
          type="range"
          aria-label={demoMode ? "Browser demo observation date" : "Raster observation date"}
          aria-valuetext={dates[activeDateIndex].date}
          className="slider-input"
          min={0}
          max={dates.length - 1}
          step={1}
          value={activeDateIndex}
          onChange={(e) => { setIsPlaying(false); setSelectedDateIndex(parseInt(e.target.value)); }}
        />
        <div className="slider-labels">
          {dates.map((d, i) => (
            <span
              key={d.date}
              className={`slider-label ${i === activeDateIndex ? "slider-label--active" : ""}`}
            >
              {formatDate(d.date)}
            </span>
          ))}
        </div>
      </div>

      <div className="date-scrubber__current">
        {formatDate(dates[activeDateIndex].date)}
      </div>
    </div>
  );
}
