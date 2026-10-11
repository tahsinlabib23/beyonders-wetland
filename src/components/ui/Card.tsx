import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  active?: boolean;
}

export function Card({ children, className = "", active = false, ...props }: CardProps) {
  return (
    <div
      className={`glass-card ${active ? "glass-card--active" : ""} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`section-header ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className = "", accent = false, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { accent?: boolean }) {
  return (
    <h3 className={`section-title ${accent ? "section-title--accent" : ""} ${className}`} {...props}>
      {children}
    </h3>
  );
}

export function CardContent({ children, className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`panel-section ${className}`} {...props}>
      {children}
    </div>
  );
}
