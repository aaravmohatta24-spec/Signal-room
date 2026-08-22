import { useLayoutEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type RevealVariant = "rise" | "drift" | "drift-right" | "settle";

/** Longest a reveal may stay hidden before it is shown regardless. */
const SAFETY_MS = 2500;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Reveals its children as they scroll into view.
 *
 * Content renders *visible*, and the hidden starting state is applied by this
 * effect — before paint, so there is no flash. That ordering is deliberate:
 * anything that starts hidden in markup stays hidden forever if the code meant
 * to reveal it never runs, and this component has already caused that once.
 * Hiding only after the observer is successfully attached means the failure
 * mode is "no animation" rather than "no content", and a safety timer covers
 * the case where the observer attaches but never fires.
 *
 * The motion itself is a CSS transition (`.reveal` in index.css) rather than a
 * JS animation loop, which cannot stall in a throttled tab.
 */
export function ScrollReveal({
  children,
  className,
  variant = "rise",
  index = 0,
  as: Tag = "div"
}: {
  children: ReactNode;
  className?: string;
  variant?: RevealVariant;
  /** Position within a group, used to stagger the entrance. */
  index?: number;
  as?: ElementType;
}) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Leave the content alone if it cannot be animated safely.
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;

    const hiddenClasses = ["reveal", `reveal--${variant}`];
    element.classList.add(...hiddenClasses);

    const show = () => element.classList.add("is-revealed");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.disconnect();
          show();
        }
      },
      // Hold the reveal until the element is properly on screen rather than a
      // pixel past the edge.
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 }
    );

    observer.observe(element);
    const safety = window.setTimeout(show, SAFETY_MS);

    return () => {
      observer.disconnect();
      window.clearTimeout(safety);
      element.classList.remove(...hiddenClasses, "is-revealed");
    };
  }, [variant]);

  return (
    <Tag
      ref={ref}
      className={cn(className)}
      style={{ "--reveal-delay": `${Math.min(index, 4) * 85}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
