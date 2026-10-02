import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem" },
    extend: {
      colors: {
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        "card-foreground": "rgb(var(--card-foreground) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        "muted-foreground": "rgb(var(--muted-foreground) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        input: "rgb(var(--input) / <alpha-value>)",
        primary: "rgb(var(--primary) / <alpha-value>)",
        "primary-foreground": "rgb(var(--primary-foreground) / <alpha-value>)",
        ring: "rgb(var(--ring) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        sidebar: "rgb(var(--sidebar) / <alpha-value>)",
        "sidebar-foreground": "rgb(var(--sidebar-foreground) / <alpha-value>)",
      },
      borderRadius: { lg: "0.5rem", md: "0.375rem", sm: "0.25rem", xl: "0.625rem" },
      fontFamily: { sans: ["var(--font-sans)"], display: ["var(--font-display)"], mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
      boxShadow: { card: "0 1px 0 rgb(0 0 0 / 0.02)", pop: "0 8px 24px -12px rgb(0 0 0 / 0.35)" },
      keyframes: { "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } }, shimmer: { "100%": { transform: "translateX(100%)" } } },
      animation: { "fade-in": "fade-in .2s ease-out", shimmer: "shimmer 1.4s infinite" },
    },
  },
  plugins: [],
};
export default config;
