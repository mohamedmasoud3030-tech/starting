import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "md" | "lg" | "sm" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-brand-700 text-white hover:bg-brand-800 shadow-cta hover:shadow-card-lg focus-visible:outline-brand-800",
  secondary: "bg-brand-100 text-brand-900 hover:bg-brand-200",
  outline:
    "border border-slate-300 bg-white text-slate-800 hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-900",
  ghost: "text-slate-700 hover:bg-slate-100",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-700",
};

const sizeClasses: Record<Size, string> = {
  md: "h-11 px-4 text-sm sm:text-base",
  lg: "h-12 px-6 text-base",
  sm: "h-10 px-3.5 text-sm",
  icon: "h-11 w-11",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "primary", size = "md", type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-[background-color,box-shadow,color,border-color,transform] duration-150",
          "active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
