import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        audiator: {
          black: "#0a0a0a",
          "black-soft": "#141414",
          accent: "#7dd3fc",
          "accent-hover": "#38bdf8",
          grey: "#9ca3af",
          "grey-muted": "#6b7280",
          success: "#22c55e",
          warning: "#f59e0b",
          danger: "#ef4444",
        },
      },
    },
  },
  plugins: [],
};
export default config;
