import React from "react";
import { STATUS_ICONS, STATUS_COLORS } from "@/lib/constants";

export type BadgeVariant = "pass" | "partial" | "fail" | "info";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  icon?: boolean;
}

export function Badge({ children, className = "", variant = "info", icon = false, ...props }: BadgeProps) {
  const statusStr = typeof children === "string" ? children.toUpperCase() : "";
  const iconStr = icon ? (STATUS_ICONS[statusStr] || "") + " " : "";
  
  let variantCls = "status-badge--info";
  if (variant === "pass" || statusStr === "PASS" || statusStr === "SUPPORTED" || statusStr === "STABLE") {
    variantCls = "status-badge--pass";
  } else if (variant === "partial" || statusStr === "PARTIAL" || statusStr === "MODERATE") {
    variantCls = "status-badge--partial";
  } else if (variant === "fail" || statusStr === "FAIL" || statusStr === "REJECTED" || statusStr === "SENSITIVE") {
    variantCls = "status-badge--fail";
  }

  const color = STATUS_COLORS[statusStr] || STATUS_COLORS[variant.toUpperCase()] || undefined;

  return (
    <span 
      className={`status-badge ${variantCls} ${className}`} 
      style={color ? { color } : undefined}
      {...props}
    >
      {iconStr}{children}
    </span>
  );
}
