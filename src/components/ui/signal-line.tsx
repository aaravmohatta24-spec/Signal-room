import { useEffect, useRef } from "react";
import { animate, svg } from "animejs";

import { cn } from "@/lib/utils";

/**
 * Signalroom's signature scroll element: an equity-curve-shaped line that draws
 * itself when the section reaches the viewport, with a marker riding the
 * leading edge.
 *
 * The stroke is drawn via anime.js `createDrawable`, triggered on entry by an
 * IntersectionObserver — same reasoning as ScrollReveal.
 */
const CURVE =
  "M0,74 C40,70 62,52 96,58 C130,64 148,30 186,36 C224,42 240,20 278,28 C316,36 332,12 372,16 C412,20 430,44 468,38 C506,32 528,10 560,6";

export function SignalLine({ className }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const markerRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const path = pathRef.current;
    const marker = markerRef.current;
    if (!root || !path || !marker) return;

    const drawInstantly = () => {
      path.style.strokeDasharray = "none";
      path.style.strokeDashoffset = "0";
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") {
      drawInstantly();
      return;
    }

    const animations: ReturnType<typeof animate>[] = [];

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.disconnect();

          animations.push(
            animate(svg.createDrawable(path), { draw: ["0 0", "0 1"], duration: 1400, ease: "inOut(2)" }),
            animate(marker, {
              ...svg.createMotionPath(path),
              opacity: [{ to: 1, duration: 200 }, { to: 0, delay: 1000, duration: 260 }],
              duration: 1400,
              ease: "inOut(2)"
            })
          );
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(root);

    return () => {
      observer.disconnect();
      animations.forEach((animation) => animation.revert());
    };
  }, []);

  return (
    <div ref={rootRef} className={cn("w-full", className)} aria-hidden>
      <svg viewBox="0 0 560 80" preserveAspectRatio="none" className="h-12 w-full overflow-visible">
        <path
          d="M0,79H560"
          stroke="var(--color-border)"
          strokeWidth="1"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <path
          ref={pathRef}
          d={CURVE}
          stroke="rgb(var(--color-signal))"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <circle ref={markerRef} r="4" fill="rgb(var(--color-signal-soft))" opacity="0" />
      </svg>
    </div>
  );
}
