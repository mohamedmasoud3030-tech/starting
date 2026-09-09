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
          "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-900",
          "shadow-[inset_0_1px_2px_rgb(15_23_42/0.04)] transition-[border-color,box-shadow,background-color]",
          "placeholder:text-slate-400/90",
          "hover:border-slate-300",
          "focus:border-brand-600 focus:shadow-[0_0_0_3px_rgb(204_251_241/0.8),inset_0_1px_2px_rgb(15_23_42/0.04)] focus:outline-none",
          "disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:shadow-none",
          className,
        )}
        aria-describedby={props["aria-describedby"] ?? errorId}
        {...props}
      />
    );
  },
);
