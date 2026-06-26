"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";
type ThemeMode = "light" | "dark" | "custom";
type FontScale = "small" | "normal" | "large";
type SidebarDensity = "compact" | "comfortable";

type CustomTheme = {
  pageBg: string;
  sidebarBg: string;
  text: string;
  muted: string;
  faint: string;
  line: string;
  hover: string;
  selected: string;
  pageChip: string;
  scrollThumb: string;
  scrollTrack: string;
};

type InterfaceSettings = {
  fontScale: FontScale;
  sidebarDensity: SidebarDensity;
  reduceMotion: boolean;
  showChatActivity: boolean;
};

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  customTheme: CustomTheme;
  interfaceSettings: InterfaceSettings;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
  updateCustomTheme: (key: keyof CustomTheme, value: string) => void;
  resetCustomTheme: () => void;
  updateInterfaceSetting: <K extends keyof InterfaceSettings>(key: K, value: InterfaceSettings[K]) => void;
  resetInterfaceSettings: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const defaultCustomTheme: CustomTheme = {
  pageBg: "#ffffff",
  sidebarBg: "#f7f6f3",
  text: "#37352f",
  muted: "#6f6b63",
  faint: "#9b958b",
  line: "#ddd8cf",
  hover: "#f0eee8",
  selected: "#e8e4dc",
  pageChip: "#f1f1ef",
  scrollThumb: "#cfc8bc",
  scrollTrack: "#ffffff",
};

const defaultInterfaceSettings: InterfaceSettings = {
  fontScale: "normal",
  sidebarDensity: "comfortable",
  reduceMotion: false,
  showChatActivity: true,
};

const cssVariableByColor: Record<keyof CustomTheme, string> = {
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
  scrollTrack: "--scroll-track",
};

function readInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";

  const savedTheme = window.localStorage.getItem("studyyy-theme");
  if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "custom") return savedTheme;

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readInitialCustomTheme(): CustomTheme {
  if (typeof window === "undefined") return defaultCustomTheme;

  try {
    return { ...defaultCustomTheme, ...JSON.parse(window.localStorage.getItem("studyyy-custom-theme") || "{}") };
  } catch {
    return defaultCustomTheme;
  }
}

function readInitialInterfaceSettings(): InterfaceSettings {
  if (typeof window === "undefined") return defaultInterfaceSettings;

  try {
    return {
      ...defaultInterfaceSettings,
      ...JSON.parse(window.localStorage.getItem("studyyy-interface-settings") || "{}"),
    };
  } catch {
    return defaultInterfaceSettings;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => readInitialThemeMode());
  const [customTheme, setCustomTheme] = useState<CustomTheme>(() => readInitialCustomTheme());
  const [interfaceSettings, setInterfaceSettings] = useState<InterfaceSettings>(() => readInitialInterfaceSettings());

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("studyyy-theme");
    const savedCustomTheme = window.localStorage.getItem("studyyy-custom-theme");
    const savedInterfaceSettings = window.localStorage.getItem("studyyy-interface-settings");

    if (savedCustomTheme) {
      try {
        setCustomTheme({ ...defaultCustomTheme, ...JSON.parse(savedCustomTheme) });
      } catch {
        setCustomTheme(defaultCustomTheme);
      }
    }

    if (savedInterfaceSettings) {
      try {
        setInterfaceSettings({ ...defaultInterfaceSettings, ...JSON.parse(savedInterfaceSettings) });
      } catch {
        setInterfaceSettings(defaultInterfaceSettings);
      }
    }

    if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "custom") {
      setMode(savedTheme);
      return;
    }

    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setMode("dark");
    }
  }, []);

  const theme: Theme = mode === "dark" ? "dark" : "light";

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = mode;
    window.localStorage.setItem("studyyy-theme", mode);

    if (mode === "custom") {
      for (const [key, variable] of Object.entries(cssVariableByColor) as Array<[keyof CustomTheme, string]>) {
        root.style.setProperty(variable, customTheme[key]);
      }
      root.style.setProperty("--page-bg-translucent", `${customTheme.pageBg}dd`);
    } else {
      for (const variable of Object.values(cssVariableByColor)) {
        root.style.removeProperty(variable);
      }
      root.style.removeProperty("--page-bg-translucent");
    }
  }, [customTheme, mode]);

  useEffect(() => {
    window.localStorage.setItem("studyyy-custom-theme", JSON.stringify(customTheme));
  }, [customTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.fontScale = interfaceSettings.fontScale;
    root.dataset.sidebarDensity = interfaceSettings.sidebarDensity;
    root.dataset.reduceMotion = interfaceSettings.reduceMotion ? "true" : "false";
    root.dataset.showChatActivity = interfaceSettings.showChatActivity ? "true" : "false";
    window.localStorage.setItem("studyyy-interface-settings", JSON.stringify(interfaceSettings));
  }, [interfaceSettings]);

  const value = useMemo(
    () => ({
      theme,
      mode,
      customTheme,
      interfaceSettings,
      setTheme: setMode,
      updateCustomTheme: (key: keyof CustomTheme, value: string) => {
        setCustomTheme((current) => ({ ...current, [key]: value }));
        setMode("custom");
      },
      resetCustomTheme: () => setCustomTheme(defaultCustomTheme),
      updateInterfaceSetting: <K extends keyof InterfaceSettings>(key: K, value: InterfaceSettings[K]) => {
        setInterfaceSettings((current) => ({ ...current, [key]: value }));
      },
      resetInterfaceSettings: () => setInterfaceSettings(defaultInterfaceSettings),
      toggleTheme: () => setMode((current) => (current === "dark" ? "light" : "dark")),
    }),
    [customTheme, interfaceSettings, mode, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return value;
}
