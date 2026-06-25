"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { RiLockPasswordLine, RiMailSendLine, RiMoonLine, RiSunLine, RiUserAddLine } from "react-icons/ri";
import { useTheme } from "@/components/ThemeContext";
import { supabase } from "@/lib/supabase";

type AuthMode = "magic" | "password" | "signup";

export default function AuthPage() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [mode, setMode] = useState<AuthMode>("magic");
  const [fullName, setFullName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("My Workspace");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus("");

    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
        },
      });

      setLoading(false);
      setStatus(error ? error.message : "Check your email for the login link.");
      return;
    }

    if (mode === "signup") {
      if (!fullName.trim()) {
        setLoading(false);
        setStatus("Add your name before creating an account.");
        return;
      }

      if (password.length < 6) {
        setLoading(false);
        setStatus("Password needs to be at least 6 characters.");
        return;
      }

      if (password !== confirmPassword) {
        setLoading(false);
        setStatus("Passwords do not match.");
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            full_name: fullName.trim(),
            workspace_name: workspaceName.trim() || "My Workspace",
          },
        },
      });

      setLoading(false);
      if (error) {
        setStatus(error.message);
        return;
      }

      if (data.session) {
        router.push("/");
        return;
      }

      setStatus("Account created. Check your email to confirm your signup.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);
    if (error) {
      setStatus(error.message);
      return;
    }

    router.push("/");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--page-bg)] px-6 text-[var(--text)]">
      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <div />
            <button
              type="button"
              onClick={toggleTheme}
              className="grid h-9 w-9 place-items-center rounded border border-[var(--line)] bg-[var(--page-bg)] text-[var(--muted)] shadow-sm transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <RiSunLine size={16} /> : <RiMoonLine size={16} />}
            </button>
          </div>
          <h1 className="text-4xl font-bold tracking-normal text-[var(--text)]">studyyy</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Access your private Notion-like study workspace.</p>
        </div>

        <div className="mb-5 grid grid-cols-3 rounded border border-[var(--line)] bg-[var(--page-chip)] p-1">
          <button
            type="button"
            onClick={() => {
              setMode("magic");
              setStatus("");
            }}
            className={`flex h-9 items-center justify-center gap-2 rounded text-sm font-medium transition ${
              mode === "magic"
                ? "bg-[var(--page-bg)] text-[var(--text)] shadow-sm"
                : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            }`}
          >
            <RiMailSendLine size={16} />
            Magic
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("password");
              setStatus("");
            }}
            className={`flex h-9 items-center justify-center gap-2 rounded text-sm font-medium transition ${
              mode === "password"
                ? "bg-[var(--page-bg)] text-[var(--text)] shadow-sm"
                : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            }`}
          >
            <RiLockPasswordLine size={16} />
            Password
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setStatus("");
            }}
            className={`flex h-9 items-center justify-center gap-2 rounded text-sm font-medium transition ${
              mode === "signup"
                ? "bg-[var(--page-bg)] text-[var(--text)] shadow-sm"
                : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            }`}
          >
            <RiUserAddLine size={16} />
            Sign up
          </button>
        </div>

        {mode === "signup" ? (
          <>
            <label className="mb-2 block text-sm font-medium text-[var(--muted)]" htmlFor="full-name">
              Name
            </label>
            <input
              id="full-name"
              type="text"
              required={mode === "signup"}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="h-10 w-full rounded border border-[var(--line)] bg-[var(--page-chip)] px-3 text-[var(--text)] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--faint)] focus:bg-[var(--page-bg)]"
              placeholder="Your name"
            />

            <label className="mb-2 mt-4 block text-sm font-medium text-[var(--muted)]" htmlFor="workspace-name">
              Workspace name
            </label>
            <input
              id="workspace-name"
              type="text"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              className="h-10 w-full rounded border border-[var(--line)] bg-[var(--page-chip)] px-3 text-[var(--text)] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--faint)] focus:bg-[var(--page-bg)]"
              placeholder="My Workspace"
            />
          </>
        ) : null}

        <label
          className={`mb-2 block text-sm font-medium text-[var(--muted)] ${mode === "signup" ? "mt-4" : ""}`}
          htmlFor="email"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-10 w-full rounded border border-[var(--line)] bg-[var(--page-chip)] px-3 text-[var(--text)] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--faint)] focus:bg-[var(--page-bg)]"
          placeholder="you@example.com"
        />

        {mode !== "magic" ? (
          <>
            <label className="mb-2 mt-4 block text-sm font-medium text-[var(--muted)]" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 w-full rounded border border-[var(--line)] bg-[var(--page-chip)] px-3 text-[var(--text)] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--faint)] focus:bg-[var(--page-bg)]"
              placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
            />
          </>
        ) : null}

        {mode === "signup" ? (
          <>
            <label className="mb-2 mt-4 block text-sm font-medium text-[var(--muted)]" htmlFor="confirm-password">
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              required={mode === "signup"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="h-10 w-full rounded border border-[var(--line)] bg-[var(--page-chip)] px-3 text-[var(--text)] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--faint)] focus:bg-[var(--page-bg)]"
              placeholder="Repeat password"
            />
          </>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="mt-4 h-10 w-full rounded bg-[var(--text)] px-4 text-sm font-medium text-[var(--page-bg)] transition hover:opacity-90 disabled:opacity-50"
        >
          {loading
            ? "Working..."
            : mode === "magic"
              ? "Send magic link"
              : mode === "signup"
                ? "Create account"
                : "Sign in with password"}
        </button>

        {status ? (
          <p className="mt-4 rounded border border-[var(--line)] bg-[var(--page-chip)] px-3 py-2 text-sm text-[var(--muted)]">
            {status}
          </p>
        ) : null}
      </form>
    </main>
  );
}
