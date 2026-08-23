import type { Config } from "tailwindcss";

/**
 * Colours are declared as CSS custom properties in `src/index.css` holding
 * space-separated RGB channels, so `<alpha-value>` lets Tailwind's opacity
 * modifiers work (`bg-card/70`). A component can re-scope any token locally
 * without affecting the rest of the page — the OriginButton relies on this.
 */
const token = (name: string) => `rgb(var(--color-${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // The vendored navigation menu uses `xs:` variants, which are not part of
      // Tailwind's default scale — without this they are silently dropped.
      screens: {
        xs: "480px"
      },
      /*
       * Family names are quoted explicitly. Tailwind emits this list verbatim,
       * and `Source Serif 4` unquoted parses as three identifiers ending in
       * `4` — which is not a valid CSS identifier, so the browser drops the
       * whole `font-family` declaration and the utility silently does nothing.
       */
      fontFamily: {
        // Headlines: old-style serif, standing in for NYT Cheltenham.
        display: ['"Source Serif 4"', "Georgia", '"Times New Roman"', "serif"],
        // Furniture and UI: grotesque, standing in for Franklin Gothic.
        sans: ['"Libre Franklin"', '"Helvetica Neue"', "Arial", "sans-serif"],
        // Long-form body copy: serif, as NYT sets its articles.
        serif: ['"Source Serif 4"', "Georgia", '"Times New Roman"', "serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"]
      },
      colors: {
        background: token("background"),
        foreground: token("foreground"),
        primary: token("primary"),
        secondary: token("secondary"),
        border: token("border"),
        input: token("input"),
        ring: token("ring"),
        destructive: token("destructive"),
        card: { DEFAULT: token("card"), foreground: token("card-foreground") },
        popover: { DEFAULT: token("popover"), foreground: token("popover-foreground") },
        muted: { DEFAULT: token("muted"), foreground: token("muted-foreground") },
        accent: { DEFAULT: token("accent"), foreground: token("accent-foreground") },
        signal: {
          DEFAULT: token("signal"),
          soft: token("signal-soft"),
          blue: token("signal-blue"),
          violet: token("signal-violet")
        }
      }
    }
  },
  plugins: []
} satisfies Config;
