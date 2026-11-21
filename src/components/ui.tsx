import { useEffect, useRef, useState } from "react";

export function RotaryKnob({
  label,
  value,
  min,
  max,
  step = 1,
  displayValue,
  color = "#93b4f5",
  size = 54,
  hideValue = false,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  displayValue: string;
  color?: string;
  size?: number;
  hideValue?: boolean;
  onChange: (val: number) => void;
  onReset?: () => void;
}) {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const startAngle = -135;
  const endAngle = 135;
  const angle = startAngle + norm * (endAngle - startAngle);
  const r = 20;
  const cx = 26;
  const cy = 26;

  const polar = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const arcPath = (fromDeg: number, toDeg: number) => {
    const p1 = polar(fromDeg);
    const p2 = polar(toDeg);
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`;
  };

  const ptrInner = {
    x: cx + 7 * Math.cos(((angle - 90) * Math.PI) / 180),
    y: cy + 7 * Math.sin(((angle - 90) * Math.PI) / 180),
  };
  const ptrOuter = {
    x: cx + 14 * Math.cos(((angle - 90) * Math.PI) / 180),
    y: cy + 14 * Math.sin(((angle - 90) * Math.PI) / 180),
  };

  return (
    <div className="sk-knob-wrap">
      {label && <span className="sk-knob-label">{label}</span>}
      <div
        className="sk-knob-dial"
        style={{ width: size, height: size }}
        role="slider"
        tabIndex={0}
        aria-label={label || displayValue}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { startY: e.clientY, startVal: value };
        }}
        onPointerMove={(e) => {
          if (!dragRef.current || e.buttons !== 1) return;
          const dy = dragRef.current.startY - e.clientY;
          const raw = dragRef.current.startVal + (dy / 130) * (max - min);
          const stepped = Math.round(raw / step) * step;
          onChange(Math.max(min, Math.min(max, Number(stepped.toFixed(4)))));
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onDoubleClick={onReset}
      >
        <svg viewBox="0 0 52 52" width={size} height={size}>
          <path
            d={arcPath(startAngle, endAngle)}
            fill="none"
            stroke="#0e1017"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          {norm > 0.005 && (
            <path
              d={arcPath(startAngle, angle)}
              fill="none"
              stroke={color}
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          )}
          <circle
            cx={cx}
            cy={cy}
            r="15.5"
            fill="#2e3340"
            stroke="#474e61"
            strokeWidth="1"
          />
          <line
            x1={ptrInner.x}
            y1={ptrInner.y}
            x2={ptrOuter.x}
            y2={ptrOuter.y}
            stroke={color}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {!hideValue && <span className="sk-knob-val">{displayValue}</span>}
    </div>
  );
}

export interface CustomSelectOption {
  value: string;
  label: string;
}

export function CustomSelect({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  className = "",
  menuUp = false,
}: {
  id?: string;
  ariaLabel?: string;
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  menuUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const currentLabel = options.find((o) => o.value === value)?.label ?? value;

  return (
    <div
      ref={wrapRef}
      className={`custom-select ${open ? "open" : ""} ${menuUp ? "menu-up" : ""} ${className}`}
    >
      <button
        id={id}
        type="button"
        className="custom-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="custom-select-value">{currentLabel}</span>
        <svg
          className="custom-select-chevron"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="custom-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                className={`custom-select-option ${active ? "active" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="custom-select-check" aria-hidden="true">
                  {active ? "✓" : ""}
                </span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CompactFader({
  ariaLabel,
  pct,
  resetPct,
  onChangePct,
}: {
  ariaLabel: string;
  pct: number;
  resetPct: number;
  onChangePct: (nextPct: number) => void;
}) {
  return (
    <div className="sidebar-fader-col">
      <div
        className="sk-fader compact"
        style={{ "--layer-color": "#89a8f0" } as React.CSSProperties}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={125}
        aria-valuenow={pct}
        onPointerDown={(e) => {
          if (e.detail >= 2) {
            onChangePct(resetPct);
            return;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = 1 - (e.clientY - rect.top) / rect.height;
          onChangePct(Math.round(Math.max(0, Math.min(1, ratio)) * 125));
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 1) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = 1 - (e.clientY - rect.top) / rect.height;
          onChangePct(Math.round(Math.max(0, Math.min(1, ratio)) * 125));
        }}
        onDoubleClick={() => onChangePct(resetPct)}
      >
        <div className="sk-fader-groove" aria-hidden="true">
          <div className="sk-fader-glow" style={{ height: `${(pct / 125) * 100}%` }} />
        </div>
        <div
          className="sk-fader-thumb"
          style={{ bottom: `calc(${(pct / 125) * 100}% - 10px)` }}
          aria-hidden="true"
        >
          <span className="sk-fader-led" />
        </div>
      </div>
      <span className="sidebar-fader-val">{pct}%</span>
    </div>
  );
}

export function PowerSvg() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 3v9" />
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    </svg>
  );
}

export function SlidersSvg() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="9" cy="6" r="2" fill="currentColor" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="10" cy="18" r="2" fill="currentColor" />
    </svg>
  );
}

