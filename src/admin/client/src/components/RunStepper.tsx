import { useEffect, useState } from 'react';
import './RunStepper.css';

interface RunStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * A joined −/number/+ stepper that also accepts a typed value (bounded to
 * [min, max]). Styled after mockups/runs-1-stepper.html.
 */
export default function RunStepper({
  value, onChange, min = 1, max = 999, disabled = false, ariaLabel,
}: RunStepperProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  // Keep the field editable while typing; only emit a valid clamped number.
  const handleInput = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, String(max).length);
    setText(digits);
    if (digits !== '') onChange(clamp(parseInt(digits, 10)));
  };

  const handleBlur = () => {
    const n = text === '' ? min : clamp(parseInt(text, 10));
    setText(String(n));
    onChange(n);
  };

  return (
    <div className="m365-stepper" role="group" aria-label={ariaLabel}>
      <button type="button" className="m365-stepper__btn" aria-label="decrease"
        disabled={disabled || value <= min} onClick={() => onChange(clamp(value - 1))}>−</button>
      <input className="m365-stepper__input" type="text" inputMode="numeric"
        value={text} disabled={disabled} aria-label={ariaLabel}
        onChange={e => handleInput(e.target.value)} onBlur={handleBlur} />
      <button type="button" className="m365-stepper__btn" aria-label="increase"
        disabled={disabled || value >= max} onClick={() => onChange(clamp(value + 1))}>+</button>
    </div>
  );
}
