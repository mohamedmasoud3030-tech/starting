import type { ReactNode } from "react";
import { Label } from "./Label";
import { FieldErrorContext } from "./fieldContext";
import { cn } from "@/lib/utils";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const errorId = error ? `${htmlFor ?? ""}-error` : undefined;

  return (
    <FieldErrorContext.Provider value={errorId}>
      <div className={cn("space-y-1", className)}>
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="text-red-600"> *</span>}
        </Label>
        {children}
        {hint && !error && <p className="text-sm text-slate-500">{hint}</p>}
        {error && (
          <p id={errorId} className="text-sm font-semibold text-red-600">
            {error}
          </p>
        )}
      </div>
    </FieldErrorContext.Provider>
  );
}
