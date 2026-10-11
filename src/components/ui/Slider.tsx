import React from "react";

interface SliderProps {
  ariaLabel?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  labels?: React.ReactNode[];
  className?: string;
  disabled?: boolean;
}

export function Slider({ min, max, step = 1, value, onChange, labels, className = "", ariaLabel = "Value", disabled = false }: SliderProps) {
  const fillPercentage = max === min
    ? 0
    : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    onChange(val);
  };

  return (
    <div className={`slider-container ${className}`}>
      <div className="slider-track">
        <div className="slider-fill" style={{ width: `${fillPercentage}%` }} />
        <input
          type="range"
          aria-label={ariaLabel}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className="slider-input"
        />
      </div>
      {labels && (
        <div className="slider-labels">
          {labels.map((label, idx) => (
            <span key={idx} className="slider-label">{label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
