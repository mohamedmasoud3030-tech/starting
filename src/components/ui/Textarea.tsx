import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-24 w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-base leading-6 text-slate-900",
        "placeholder:text-slate-400",
        "focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100",
        "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500",
        className,
      )}
      {...props}
    />
  );
});
