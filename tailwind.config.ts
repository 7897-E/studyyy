import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        notion: {
          bg: "#ffffff",
          sidebar: "#f7f6f3",
          text: "#37352f",
          muted: "rgba(55, 53, 47, 0.65)",
          line: "rgba(55, 53, 47, 0.16)",
          hover: "rgba(55, 53, 47, 0.08)"
        }
      }
    }
  },
  plugins: []
};

export default config;
