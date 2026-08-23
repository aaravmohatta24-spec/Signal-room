import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * The standard button for everything except the hero call to action.
 *
 * Styled as a terminal key rather than a rounded pill: a 3px radius, a
 * monospace label in small caps with wide tracking, and a hairline highlight
 * along the top edge so the surface reads as lit from above. The gradient fill
 * it used to carry was doing the opposite job — a soft blue-to-violet wash on a
 * fully rounded pill is the default look of every generated interface, and it
 * made a research tool look like a landing page.
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
        "group relative inline-flex items-center justify-center gap-2 rounded-[3px]",
        "font-mono text-[11px] uppercase tracking-[.11em]",
        "transition-[background-color,border-color,color,box-shadow] duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-8 px-3" : "h-10 px-4",

        variant === "primary" && [
          "border border-signal/70 bg-signal text-white",
          // Hairline along the top edge: the surface reads as lit from above
          // without resorting to a gradient across the whole face.
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.22)]",
          "hover:border-signal-violet hover:bg-signal-violet",
          "active:translate-y-px active:shadow-none",
          "disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
        ],

        variant === "secondary" && [
          "border border-border bg-muted/60 text-foreground",
          "hover:border-signal/50 hover:bg-muted",
          "active:translate-y-px"
        ],

        variant === "ghost" && "text-muted-foreground hover:bg-accent hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}
