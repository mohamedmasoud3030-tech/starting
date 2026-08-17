import { forwardRef, type InputHTMLAttributes } from "react";
import { useFieldErrorId } from "./fieldContext";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    const errorId = useFieldErrorId();
    return (
      <input
        ref={ref}
        className={cn(
          "h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900",
          "placeholder:text-slate-400",
          "focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100",
          "disabled:cursor-not-allowed disabled:bg-slate-100",
          className,
        )}
        aria-describedby={props["aria-describedby"] ?? errorId}
        {...props}
      />
    );
  },
);
