import { lazy, Suspense, useState, type ReactNode } from "react";

const Dithering = lazy(() =>
  import("@paper-design/shaders-react").then((mod) => ({ default: mod.Dithering }))
);

/**
 * The animated hero panel. It renders whatever headline and call to action the
 * page passes in, so it stays unaware of auth state.
 */
export function HeroPanel({
  badge,
  title,
  subtitle,
  action
}: {
  badge: string;
  title: ReactNode;
  subtitle: string;
  action: ReactNode;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <section className="w-full px-0 py-2 md:py-3">
      <div
        className="relative w-full"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-[32px] border border-white/10 bg-card shadow-2xl shadow-black/30 md:min-h-[470px]">
          <Suspense fallback={<div className="absolute inset-0 bg-[#d95a24]/10" />}>
            <div className="pointer-events-none absolute inset-0 z-0 opacity-45 mix-blend-screen">
              <Dithering
                colorBack="#00000000"
                colorFront="#4F46E5"
                shape="warp"
                type="4x4"
                speed={isHovered ? 0.6 : 0.2}
                className="size-full"
                minPixelRatio={1}
              />
            </div>
          </Suspense>

          <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-6 text-center">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-4 py-1.5 font-mono text-xs text-signal-soft backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
              </span>
              {badge}
            </div>

            <h1 className="mb-5 font-display text-5xl font-semibold leading-[1.02] tracking-[-0.018em] text-foreground md:text-7xl lg:text-[5.5rem]">
              {title}
            </h1>

            <p className="mb-7 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">{subtitle}</p>

            {action}
          </div>
        </div>
      </div>
    </section>
  );
}
