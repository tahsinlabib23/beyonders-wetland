"use client";

import React, { useState, useRef, useEffect } from "react";

interface SplitViewProps {
  leftLayer: React.ReactNode;
  rightLayer: React.ReactNode;
  leftTitle?: string;
  rightTitle?: string;
}

export default function SplitView({ leftLayer, rightLayer, leftTitle = "Before", rightTitle = "After" }: SplitViewProps) {
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const rect = containerRef.current.getBoundingClientRect();
      let pos = ((clientX - rect.left) / rect.width) * 100;
      pos = Math.max(0, Math.min(100, pos));
      setSliderPos(pos);
    };

    const handleUp = () => {
      isDragging.current = false;
      document.body.style.cursor = 'default';
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('touchmove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchend', handleUp);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchend', handleUp);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      {/* Left Layer (Underneath) */}
      <div style={{ position: "absolute", inset: 0 }}>
        {leftLayer}
        <div style={{ position: "absolute", top: "16px", left: "16px", background: "rgba(0,0,0,0.6)", padding: "4px 12px", borderRadius: "4px", color: "white", zIndex: 1000, fontWeight: "bold", backdropFilter: "blur(4px)", pointerEvents: "none" }}>
          {leftTitle}
        </div>
      </div>
      
      {/* Right Layer (Clipped) */}
      <div style={{ position: "absolute", inset: 0, clipPath: `polygon(${sliderPos}% 0, 100% 0, 100% 100%, ${sliderPos}% 100%)` }}>
        {rightLayer}
        <div style={{ position: "absolute", top: "16px", right: "16px", background: "rgba(0,0,0,0.6)", padding: "4px 12px", borderRadius: "4px", color: "white", zIndex: 1000, fontWeight: "bold", backdropFilter: "blur(4px)", pointerEvents: "none" }}>
          {rightTitle}
        </div>
      </div>
      
      {/* Draggable Divider */}
      <div 
        onMouseDown={() => { isDragging.current = true; document.body.style.cursor = 'ew-resize'; }}
        onTouchStart={() => { isDragging.current = true; }}
        style={{ position: "absolute", top: 0, bottom: 0, left: `${sliderPos}%`, width: "4px", background: "var(--accent-primary)", zIndex: 1000, cursor: "ew-resize", transform: "translateX(-50%)", boxShadow: "0 0 10px rgba(0, 212, 255, 0.8)", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <div style={{ width: "24px", height: "40px", background: "var(--bg-tertiary)", border: "2px solid var(--accent-primary)", borderRadius: "4px", display: "flex", gap: "2px", alignItems: "center", justifyContent: "center", cursor: "ew-resize", pointerEvents: "none" }}>
          <div style={{ width: "2px", height: "20px", background: "var(--text-muted)" }} />
          <div style={{ width: "2px", height: "20px", background: "var(--text-muted)" }} />
        </div>
      </div>
    </div>
  );
}
