import type { Metadata } from "next";
import { AppProviders } from "@/components/AppProviders";
import "@mantine/core/styles.css";
import "@blocknote/mantine/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "studyyy",
  description: "A Notion-like study workspace powered by Next.js and Supabase",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  var mode = localStorage.getItem("studyyy-theme");
  var custom = JSON.parse(localStorage.getItem("studyyy-custom-theme") || "null");
  var settings = JSON.parse(localStorage.getItem("studyyy-interface-settings") || "null");
  if (!mode) mode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = mode;
  if (settings) {
    document.documentElement.dataset.fontScale = settings.fontScale || "normal";
    document.documentElement.dataset.sidebarDensity = settings.sidebarDensity || "comfortable";
    document.documentElement.dataset.reduceMotion = settings.reduceMotion ? "true" : "false";
    document.documentElement.dataset.showChatActivity = settings.showChatActivity ? "true" : "false";
  }
  if (mode === "custom" && custom) {
    var map = {
      pageBg: "--page-bg",
      sidebarBg: "--sidebar-bg",
      text: "--text",
      muted: "--muted",
      faint: "--faint",
      line: "--line",
      hover: "--hover",
      selected: "--selected",
      pageChip: "--page-chip",
      scrollThumb: "--scroll-thumb",
      scrollTrack: "--scroll-track"
    };
    Object.keys(map).forEach(function(key) {
      if (custom[key]) document.documentElement.style.setProperty(map[key], custom[key]);
    });
    if (custom.pageBg) document.documentElement.style.setProperty("--page-bg-translucent", custom.pageBg + "dd");
  }
} catch {}
            `,
          }}
        />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
