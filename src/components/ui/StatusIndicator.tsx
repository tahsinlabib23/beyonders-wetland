import React from "react";
import { STATUS_COLORS } from "@/lib/constants";

interface StatusIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {
  status: string;
  pulse?: boolean;
}

export function StatusIndicator({ status, pulse = false, className = "", ...props }: StatusIndicatorProps) {
  const color = STATUS_COLORS[status.toUpperCase()] || "#64748b";
  
  return (
    <div className={`status-indicator ${className}`} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }} {...props}>
      <span 
        style={{
          width: "8px", 
          height: "8px", 
          borderRadius: "50%", 
          backgroundColor: color,
          boxShadow: pulse ? `0 0 8px ${color}` : "none",
          animation: pulse ? "pulse 2s infinite" : "none"
        }} 
      />
      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {status}
      </span>
    </div>
  );
}
