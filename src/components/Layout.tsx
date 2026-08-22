import { type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

import Header from "@/components/Header";

/**
 * Page shell shared by every route: wordmark + navigation, the content column,
 * and the standing disclaimer. Pages should not re-declare any of it.
 */
export default function Layout({ children, showBackLink = false }: { children: ReactNode; showBackLink?: boolean }) {
  return (
    <div className="mx-auto max-w-[1320px] px-5 md:px-8">
      <Header />

      {showBackLink && (
        <Link
          to="/"
          className="mt-5 inline-flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} /> Back to home
        </Link>
      )}

      <main>{children}</main>

      <footer className="flex flex-col justify-between gap-3 border-t border-zinc-900 py-5 font-mono text-[10px] uppercase tracking-[.12em] text-zinc-600 md:flex-row">
        <span>Signalroom / research before risk</span>
        <span>Educational only · no live trading</span>
      </footer>
    </div>
  );
}
