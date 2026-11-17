import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: { colors: { ink: "#20242d", muted: "#858b98", line: "#e9ebef", canvas: "#f8f9fb", accent: "#6254dc" }, fontSize: {
          caption: ["10px", { lineHeight: "1.4" }],
          meta: ["11px", { lineHeight: "1.45" }],
          body: ["12px", { lineHeight: "1.5" }],
          prose: ["13px", { lineHeight: "1.6" }],
        },
        fontFamily: { sans: ["DM Sans", "ui-sans-serif", "system-ui", "sans-serif"], display: ["Manrope", "DM Sans", "sans-serif"] }, boxShadow: { soft: "0 8px 30px rgba(26, 31, 44, .06)" } } },
  plugins: [],
} satisfies Config;
