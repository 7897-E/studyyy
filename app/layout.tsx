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
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
