import React, { useState } from "react";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ content, children, position = "top" }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div 
      className="tooltip-container" 
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div 
          className={`tooltip-popup tooltip-popup--${position}`}
          style={{
            position: "absolute",
            zIndex: 1000,
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-accent)",
            padding: "4px 8px",
            borderRadius: "4px",
            fontSize: "0.7rem",
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
            boxShadow: "var(--shadow-md)",
            pointerEvents: "none",
            ...(position === "top" ? { bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: "4px" } : {}),
            ...(position === "bottom" ? { top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: "4px" } : {}),
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
