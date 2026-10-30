"use client";

import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

export type CurtainLayer = {
  label: string;
  date: string;
  src: string;
  alt: string;
};

export default function SensorCurtain({
  title,
  description,
  left,
  right,
  rightOverlaySrc,
  rightOverlayAlt = "",
  alignment = "registered",
  aspectRatio = "16 / 10",
  imageFit = "contain",
  note,
  sourceHref,
  sourceLabel,
  tone = "dark",
}: {
  title: string;
  description: string;
  left: CurtainLayer;
  right: CurtainLayer;
  rightOverlaySrc?: string;
  rightOverlayAlt?: string;
  alignment?: "registered" | "context";
  aspectRatio?: string;
  imageFit?: "fill" | "contain";
  note: string;
  sourceHref?: string;
  sourceLabel?: string;
  tone?: "dark" | "earth";
}) {
  const [position, setPosition] = useState(50);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const fit = imageFit === "fill" ? "fill" : "contain";

  function updateFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    setPosition(Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)));
  }

  function startPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  }

  function movePointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
  }

  const imageStyle = { objectFit: fit } as const;

  return (
    <section className={`sensor-curtain sensor-curtain--${tone}`} aria-label={title}>
      <header className="sensor-curtain__heading">
        <div><h3>{title}</h3><p>{description}</p></div>
        <span className={`sensor-curtain__alignment sensor-curtain__alignment--${alignment}`}>
          {alignment === "registered" ? "Shared map extent" : "Context view · not registered"}
        </span>
      </header>
      <figure className="sensor-curtain__figure">
        <div
          className="sensor-curtain__stage"
          style={{ aspectRatio, "--curtain-position": `${position}%` } as CSSProperties}
          onPointerDown={startPointer}
          onPointerMove={movePointer}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          role="group"
          aria-label="Drag the divider to compare the two satellite views"
        >
          {failedImage ? <p className="sensor-curtain__error" role="status">This published image could not load. Check the connection or open the source image again.</p> : <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="sensor-curtain__image" src={left.src} alt={left.alt} style={imageStyle} draggable={false} onError={() => setFailedImage(left.src)} />
            <div className="sensor-curtain__reveal" style={{ clipPath: `inset(0 0 0 ${position}%)` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="sensor-curtain__image" src={right.src} alt={right.alt} style={imageStyle} draggable={false} onError={() => setFailedImage(right.src)} />
              {rightOverlaySrc && <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="sensor-curtain__image sensor-curtain__image--annotation" src={rightOverlaySrc} alt={rightOverlayAlt} style={imageStyle} draggable={false} onError={() => setFailedImage(rightOverlaySrc)} />
              </>}
            </div>
            <span className="sensor-curtain__side-label sensor-curtain__side-label--left"><strong>{left.label}</strong><small>{left.date}</small></span>
            <span className="sensor-curtain__side-label sensor-curtain__side-label--right"><strong>{right.label}</strong><small>{right.date}</small></span>
            <span className="sensor-curtain__divider" aria-hidden="true"><i>↔</i></span>
          </>}
        </div>
        <figcaption className="sensor-curtain__controls">
          <label htmlFor={`sensor-curtain-range-${left.src.replace(/[^a-z0-9]/gi, "-")}`}>
            Reveal the right-hand image <output>{Math.round(100 - position)}%</output>
          </label>
          <input
            id={`sensor-curtain-range-${left.src.replace(/[^a-z0-9]/gi, "-")}`}
            type="range"
            min="0"
            max="100"
            step="1"
            value={100 - position}
            onChange={(event) => setPosition(100 - Number(event.target.value))}
            aria-label={`Reveal ${right.label} from the right`}
          />
        </figcaption>
      </figure>
      <p className="sensor-curtain__note">{note}</p>
      {sourceHref && sourceLabel && <a className="sensor-curtain__source" href={sourceHref} target="_blank" rel="noreferrer">{sourceLabel}</a>}
    </section>
  );
}
