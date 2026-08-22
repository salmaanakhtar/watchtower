import type { ButtonHTMLAttributes } from "react";

// Button hierarchy per DESIGN_LANGUAGE.md §6.11:
// Primary (guardian), Secondary (outline), Ghost, Danger (alert) — reserved
// for destructive/irreversible actions. `success` (save-green) is added by
// usage: positive lifecycle actions like "Mark resolved".
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-(--wt-guardian-600) text-white hover:bg-(--wt-guardian-700) focus-visible:ring-(--wt-guardian-600)/30",
  secondary:
    "border border-(--wt-ink-300) bg-(--wt-paper-0) text-(--wt-ink-700) hover:border-(--wt-guardian-600) hover:text-(--wt-guardian-600) focus-visible:ring-(--wt-guardian-600)/20",
  ghost:
    "text-(--wt-guardian-600) hover:bg-(--wt-guardian-100)/50 focus-visible:ring-(--wt-guardian-600)/20",
  danger:
    "bg-(--wt-alert-600) text-white hover:bg-(--wt-alert-600)/85 focus-visible:ring-(--wt-alert-600)/30",
  success:
    "bg-(--wt-save-600) text-white hover:bg-(--wt-save-600)/85 focus-visible:ring-(--wt-save-600)/30",
};

export function buttonClasses(variant: ButtonVariant = "primary"): string {
  return [
    "inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold",
    "transition-colors duration-(--wt-duration-fast) disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:outline-none focus-visible:ring-2",
    VARIANT_CLASSES[variant],
  ].join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return <button className={`${buttonClasses(variant)}${className ? ` ${className}` : ""}`} {...props} />;
}
