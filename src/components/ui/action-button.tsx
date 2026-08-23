import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * The standard button for everything except the hero call to action.
 *
 * FlowButton's sliding-arrow treatment is deliberately NOT used here. Its
 * arrows are positioned in percentages and its fill is a fixed 220px circle, so
 * on a wide or full-width button the arrows start far outside the frame and the
 * circle never covers it — the animation visibly breaks. It works at its
 * natural width, which is the hero, and that is where it stays.
 */
export function ActionButton({
  className,
  variant = "primary",
  size = "default",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "default" | "sm";
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-9 px-3 text-xs" : "h-11 px-5 text-sm",
        variant === "primary" && "bg-gradient-to-r from-signal-blue to-signal-violet text-white hover:brightness-110 disabled:bg-none disabled:bg-muted disabled:text-muted-foreground",
        variant === "secondary" && "border border-border bg-muted text-foreground hover:border-slate-600 hover:bg-accent",
        variant === "ghost" && "text-muted-foreground hover:bg-accent hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}
