"use client";

import { MantineProvider } from "@mantine/core";
import { ThemeProvider, useTheme } from "@/components/ThemeContext";

function ThemedMantineProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();

  return (
    <MantineProvider forceColorScheme={theme}>
      {children}
    </MantineProvider>
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ThemedMantineProvider>{children}</ThemedMantineProvider>
    </ThemeProvider>
  );
}
