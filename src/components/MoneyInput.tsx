import { useState } from "react";
import { Input } from "./ui/Input";
import { Field } from "./ui/Field";
import { MoneyError, parseOptionalOMR, toOMRString } from "@/lib/money";

/**
 * Money input for OMR amounts. Keeps the user's raw text while editing and
 * validates/normalizes to 3 decimals on change. The caller receives an exact
 * integer milli-OMR value (or null when invalid). The visible text is seeded
 * from `value` on mount; it does not clobber the user's typing afterwards.
 */
export function MoneyInput({
  id,
  label,
  value, // integer milli-OMR
  onChange, // called with integer milli-OMR or null when invalid
  required,
  error,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (millis: number | null) => void;
  required?: boolean;
  error?: string | null;
  hint?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState<string>(() =>
    value === 0 ? "" : toOMRString(value),
  );

  const handleChange = (raw: string) => {
    setText(raw);
    if (raw.trim() === "") {
      onChange(null);
      return;
    }
    try {
      onChange(parseOptionalOMR(raw));
    } catch (e) {
      if (e instanceof MoneyError) onChange(null);
    }
  };

  return (
    <Field label={label} htmlFor={id} required={required} error={error} hint={hint}>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          dir="ltr"
          placeholder="0.000"
          value={text}
          disabled={disabled}
          onChange={(e) => handleChange(e.target.value)}
          className="pl-14 text-left font-semibold"
          aria-invalid={error ? true : undefined}
        />
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
          ر.ع.
        </span>
      </div>
    </Field>
  );
}
