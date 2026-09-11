import type { Config } from "tailwindcss";

/**
 * Design tokens live in src/index.css as CSS variables so that the whole app
 * can be re-themed (light/dark) without a rebuild.
 */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--bg) / <alpha-value>)",
        surface: "hsl(var(--surface) / <alpha-value>)",
        raised: "hsl(var(--raised) / <alpha-value>)",
        line: "hsl(var(--line) / <alpha-value>)",
        ink: "hsl(var(--ink) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        brand: "hsl(var(--brand) / <alpha-value>)",
        "brand-soft": "hsl(var(--brand-soft) / <alpha-value>)",
        "brand-ink": "hsl(var(--brand-ink) / <alpha-value>)",
        accent: "hsl(var(--accent) / <alpha-value>)",
        "accent-ink": "hsl(var(--accent-ink) / <alpha-value>)",
        info: "hsl(var(--info) / <alpha-value>)",
        good: "hsl(var(--good) / <alpha-value>)",
        warn: "hsl(var(--warn) / <alpha-value>)",
        danger: "hsl(var(--danger) / <alpha-value>)",
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      fontFamily: {
        sans: ["Inter var", "Inter", "system-ui", "-apple-system", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px hsl(var(--shadow) / 0.28), 0 8px 24px -12px hsl(var(--shadow) / 0.45)",
        lift: "0 8px 20px -6px hsl(var(--shadow) / 0.5)",
      },
      keyframes: {
        "slide-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": {
          "0%": { transform: "scale(.94)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        "slide-up": "slide-up .28s cubic-bezier(.2,.9,.3,1)",
        "fade-in": "fade-in .2s ease-out",
        "pop-in": "pop-in .22s cubic-bezier(.2,.9,.3,1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
