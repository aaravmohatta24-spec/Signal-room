import { useState, type CSSProperties, type ComponentProps, type FormEvent } from "react";
import { Apple, AtSign, CheckCircle2, ChevronLeft, CircleAlert, Lock, User } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { ActionButton } from "./action-button";
import { Input } from "./input";
import { ScrollReveal } from "./scroll-reveal";
import { useAuth } from "@/lib/auth";
import { useGoogleLogin } from "@react-oauth/google";

type Mode = "signup" | "signin";

export function AuthPage() {
  const { signUp, signIn, googleSignIn } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === "signup";

  const loginWithGoogle = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
        });
        const userInfo = await res.json();
        
        const result = await googleSignIn(userInfo.name || "Google User", userInfo.email);
        setBusy(false);
        if (result.ok) {
          setSucceeded(true);
          setTimeout(() => navigate("/"), 850);
        } else {
          setError(result.error);
        }
      } catch (err) {
        setBusy(false);
        setError("Failed to fetch Google profile.");
      }
    },
    onError: () => setError("Google sign-in failed."),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (isSignUp && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setBusy(true);
    const result = isSignUp ? await signUp(name, email, password) : await signIn(email, password);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSucceeded(true);
    setTimeout(() => navigate("/"), 850);
  };

  return (
    <main className="relative lg:grid lg:min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden h-full flex-col border-r border-border bg-muted/60 p-10 lg:flex">
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-background to-transparent" />

        <Link to="/" className="z-10 flex items-center gap-2">
          <span className="grid h-5 w-5 rotate-45 grid-cols-2 gap-[3px]">
            <i className="rounded-[2px] bg-foreground" />
            <i className="rounded-[2px] bg-signal" />
            <i className="rounded-[2px] bg-foreground" />
            <i className="rounded-[2px] bg-foreground" />
          </span>
          <p className="text-xl font-semibold tracking-[-.04em]">signalroom</p>
        </Link>

        <ScrollReveal variant="drift" className="z-10 mt-auto">
          <blockquote className="space-y-3">
            <p className="font-display text-2xl leading-snug tracking-[-.02em]">
              &ldquo;A strategy version is a claim. Record what changed, what you expected, and what the outcome
              taught you.&rdquo;
            </p>
            <footer className="font-mono text-sm text-muted-foreground">~ The Signalroom journal</footer>
          </blockquote>
        </ScrollReveal>

        <div className="absolute inset-0">
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </div>
      </div>

      {/* Form panel */}
      {/*
        `my-auto` on the form below centres it when there is spare room, rather
        than `justify-center` here — a centred flex child taller than its
        container overflows past the top edge, where it cannot be scrolled to.
      */}
      <div className="relative flex min-h-screen flex-col px-4 pb-10 pt-20">
        <div aria-hidden className="absolute inset-0 -z-10 isolate opacity-60 [contain:strict]">
          <div className="absolute right-0 top-0 h-[80rem] w-[35rem] -translate-y-[21.875rem] rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,rgb(var(--color-foreground)/0.06)_0,rgba(140,140,140,0.02)_50%,rgb(var(--color-foreground)/0.01)_80%)]" />
          <div className="absolute right-0 top-0 h-[80rem] w-[15rem] translate-x-[5%] -translate-y-1/2 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,rgb(var(--color-foreground)/0.04)_0,rgb(var(--color-foreground)/0.01)_80%,transparent_100%)]" />
        </div>

        <ActionButton variant="ghost" size="sm" onClick={() => navigate("/")} className="absolute left-5 top-7">
          <ChevronLeft className="me-2 size-4" />
          Home
        </ActionButton>

        <ScrollReveal key={mode} variant="rise" className="mx-auto my-auto w-full space-y-4 sm:w-96">
          <Link to="/" className="flex items-center gap-2 lg:hidden">
            <span className="grid h-5 w-5 rotate-45 grid-cols-2 gap-[3px]">
              <i className="rounded-[2px] bg-foreground" />
              <i className="rounded-[2px] bg-signal" />
              <i className="rounded-[2px] bg-foreground" />
              <i className="rounded-[2px] bg-foreground" />
            </span>
            <p className="text-xl font-semibold tracking-[-.04em]">signalroom</p>
          </Link>

          <div className="flex flex-col space-y-1">
            <h1 className="font-display text-4xl font-semibold tracking-[-.018em]">
              {isSignUp ? "Join Signalroom." : "Welcome back."}
            </h1>
            <p className="text-base text-muted-foreground">
              {isSignUp
                ? "Create an account to open the research rooms."
                : "Sign in with the account you created on this device."}
            </p>
          </div>

          {succeeded ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-900/60 bg-emerald-950/30 p-4 text-sm text-emerald-300">
              <CheckCircle2 size={18} />
              {isSignUp ? "Account created. Taking you home…" : "Signed in. Taking you home…"}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <ActionButton 
                  type="button" 
                  variant="secondary" 
                  className="w-full" 
                  onClick={() => loginWithGoogle()}
                >
                  <GoogleIcon className="me-2 size-4" />
                  Continue with Google
                </ActionButton>
              </div>

              <AuthSeparator />

              <form className="space-y-2" onSubmit={submit}>
                <p className="text-start text-xs text-muted-foreground">
                  {isSignUp
                    ? "Your account is hashed and stored in this browser only."
                    : "Enter the email and password you signed up with."}
                </p>

                {isSignUp && (
                  <FieldWithIcon icon={<User className="size-4" aria-hidden />}>
                    <Input
                      placeholder="Your name"
                      className="peer ps-9"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                    />
                  </FieldWithIcon>
                )}

                <FieldWithIcon icon={<AtSign className="size-4" aria-hidden />}>
                  <Input
                    placeholder="your.email@example.com"
                    className="peer ps-9"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </FieldWithIcon>

                <FieldWithIcon icon={<Lock className="size-4" aria-hidden />}>
                  <Input
                    placeholder={isSignUp ? "At least 8 characters" : "Password"}
                    className="peer ps-9"
                    type="password"
                    autoComplete={isSignUp ? "new-password" : "current-password"}
                    minLength={isSignUp ? 8 : undefined}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </FieldWithIcon>

                {isSignUp && (
                  <FieldWithIcon icon={<Lock className="size-4" aria-hidden />}>
                    <Input
                      placeholder="Confirm password"
                      className="peer ps-9"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      value={confirm}
                      onChange={(event) => setConfirm(event.target.value)}
                      required
                    />
                  </FieldWithIcon>
                )}

                {error && (
                  <p className="flex items-start gap-2 text-xs leading-5 text-destructive">
                    <CircleAlert className="mt-0.5 shrink-0" size={14} />
                    {error}
                  </p>
                )}

                <ActionButton type="submit" className="w-full justify-center" disabled={busy}>
                  <span>{busy ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}</span>
                </ActionButton>
              </form>

              <ActionButton
                type="button"
                variant="ghost"
                onClick={() => {
                  setMode(isSignUp ? "signin" : "signup");
                  setError(null);
                }}
                className="w-full justify-center"
              >
                {isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}
              </ActionButton>
            </>
          )}

          <p className="mt-8 text-sm text-muted-foreground">
            Signalroom is educational only and never places live trades. Nothing you enter leaves this browser.
          </p>
        </ScrollReveal>
      </div>
    </main>
  );
}

function FieldWithIcon({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative h-max">
      {children}
      <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground peer-disabled:opacity-50">
        {icon}
      </div>
    </div>
  );
}

/**
 * Strokes per set. Two sets are rendered, so this is half the total.
 *
 * Every stroke repaints on every frame — see `.signal-path` in index.css for
 * why that is unavoidable — so this number is the paint budget for the whole
 * screen. Eight reads as a full fan while keeping the total at sixteen.
 */
const PATH_COUNT = 8;

function FloatingPaths({ position }: { position: number }) {
  const paths = Array.from({ length: PATH_COUNT }, (_, i) => {
    // Spread the original 36-stroke spacing across fewer strokes so the fan
    // still spans the panel.
    const step = i * 3;
    return {
      id: i,
      d: `M-${380 - step * 5 * position} -${189 + step * 6}C-${380 - step * 5 * position} -${189 + step * 6} -${
        312 - step * 5 * position
      } ${216 - step * 6} ${152 - step * 5 * position} ${343 - step * 6}C${616 - step * 5 * position} ${
        470 - step * 6
      } ${684 - step * 5 * position} ${875 - step * 6} ${684 - step * 5 * position} ${875 - step * 6}`,
      width: 0.5 + step * 0.03,
      duration: `${22 + (i % 5) * 3}s`,
      delay: `${i * -1.7}s`,
      // Depth without animating opacity: nearer strokes sit brighter.
      opacity: (0.14 + (i / PATH_COUNT) * 0.26).toFixed(3)
    };
  });

  return (
    <div className="pointer-events-none absolute inset-0">
      <svg className="h-full w-full text-signal" viewBox="0 0 696 316" fill="none">
        <title>Background paths</title>
        {paths.map((path) => (
          <path
            key={path.id}
            className="signal-path"
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.width}
            style={
              {
                "--signal-path-duration": path.duration,
                "--signal-path-delay": path.delay,
                "--signal-path-opacity": path.opacity
              } as CSSProperties
            }
          />
        ))}
      </svg>
    </div>
  );
}

const GoogleIcon = (props: ComponentProps<"svg">) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12.479,14.265v-3.279h11.049c0.108,0.571,0.164,1.247,0.164,1.979c0,2.46-0.672,5.502-2.84,7.669   C18.744,22.829,16.051,24,12.483,24C5.869,24,0.308,18.613,0.308,12S5.869,0,12.483,0c3.659,0,6.265,1.436,8.223,3.307L18.392,5.62   c-1.404-1.317-3.307-2.341-5.913-2.341C7.65,3.279,3.873,7.171,3.873,12s3.777,8.721,8.606,8.721c3.132,0,4.916-1.258,6.059-2.401   c0.927-0.927,1.537-2.251,1.777-4.059L12.479,14.265z" />
  </svg>
);

/** lucide-react no longer ships brand marks, so GitHub is inlined. */
const GithubMark = (props: ComponentProps<"svg">) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
  </svg>
);

const AuthSeparator = () => (
  <div className="flex w-full items-center justify-center">
    <div className="h-px w-full bg-border" />
    <span className="px-2 text-xs text-muted-foreground">OR</span>
    <div className="h-px w-full bg-border" />
  </div>
);
