import type { ButtonHTMLAttributes } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { ProductsMenu } from "@/components/products-menu";
import { cn } from "@/lib/utils";

/**
 * Quiet header action. The animated FlowButton now belongs to the hero call to
 * action, so this stays a plain control — two competing animated buttons on one
 * screen pulled attention away from the primary one.
 */
function HeaderButton({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2 text-lg font-medium tracking-[-.05em] text-foreground">
      <span className="grid h-5 w-5 rotate-45 grid-cols-2 gap-[3px]">
        <i className="rounded-[2px] bg-foreground" />
        <i className="rounded-[2px] bg-signal" />
        <i className="rounded-[2px] bg-foreground" />
        <i className="rounded-[2px] bg-foreground" />
      </span>
      signalroom
    </Link>
  );
}

export default function Header() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-900">
      <Wordmark />

      {/*
        Always visible. This was `hidden md:flex`, which removed the only
        navigation in the app on any window narrower than 768px with nothing to
        replace it.
      */}
      <nav className="flex items-center text-sm">
        <ProductsMenu />
      </nav>

      {user ? (
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Signed in as <span className="text-slate-300">{user.name}</span>
          </span>
          <HeaderButton
            onClick={() => {
              signOut();
              navigate("/");
            }}
          >
            Sign out
          </HeaderButton>
        </div>
      ) : (
        <HeaderButton onClick={() => navigate("/signup")}>Sign up</HeaderButton>
      )}
    </header>
  );
}
