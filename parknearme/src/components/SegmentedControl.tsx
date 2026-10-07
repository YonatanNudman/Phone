import { useRef, type KeyboardEvent } from 'react';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  options: readonly SegmentOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/** iOS segmented control: a radiogroup with a sliding thumb and arrow-key support. */
export function SegmentedControl<T extends string | number>({ options, value, onChange, label, disabled, className = '' }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = options.findIndex((o) => o.value === value);
  const n = Math.max(1, options.length);

  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (Math.max(0, index) + delta + n) % n;
    const opt = options[next];
    if (opt) {
      onChange(opt.value);
      refs.current[next]?.focus();
    }
  };

  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className={`segmented${disabled ? ' is-disabled' : ''} ${className}`} onKeyDown={onKey}>
      {index >= 0 && (
        <span
          className="segmented-thumb"
          aria-hidden="true"
          style={{ width: `calc((100% - 4px) / ${n})`, transform: `translateX(${index * 100}%)` }}
        />
      )}
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === Math.max(0, index) ? 0 : -1}
          disabled={disabled}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
