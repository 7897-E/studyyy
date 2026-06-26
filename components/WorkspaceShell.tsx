"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { type Workspace, useWorkspace } from "@/hooks/useWorkspace";
import type { User } from "@supabase/supabase-js";

type WorkspaceShellContextValue = {
  workspace: Workspace;
  user: User;
};

const WorkspaceShellContext = createContext<WorkspaceShellContextValue | null>(null);

export function useWorkspaceShell() {
  const value = useContext(WorkspaceShellContext);
  if (!value) {
    throw new Error("useWorkspaceShell must be used inside WorkspaceShell");
  }

  return value;
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { workspace, loading, user } = useWorkspace();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push("/auth");
  }, [loading, router, user]);

  if (loading) {
    return <WorkspaceShellSkeleton />;
  }

  if (!workspace || !user) return null;

  return (
    <WorkspaceShellContext.Provider value={{ workspace, user }}>
      <div className="min-h-screen bg-[var(--page-bg)] text-[var(--text)]">
        <Sidebar workspace={workspace} user={user} />
        <main className="ml-[var(--sidebar-width)] min-h-screen">{children}</main>
      </div>
    </WorkspaceShellContext.Provider>
  );
}

function WorkspaceShellSkeleton() {
  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-[var(--text)]">
      <aside className="fixed inset-y-0 left-0 w-[var(--sidebar-width)] border-r border-[var(--line)] bg-[var(--sidebar-bg)] p-3">
        <div className="mb-4 h-9 rounded bg-[var(--page-chip)]" />
        <div className="space-y-2">
          <div className="h-7 rounded bg-[var(--page-chip)]" />
          <div className="h-7 rounded bg-[var(--page-chip)]" />
          <div className="h-7 w-4/5 rounded bg-[var(--page-chip)]" />
        </div>
      </aside>
      <main className="ml-[var(--sidebar-width)] min-h-screen">
        <div className="mx-auto w-full max-w-4xl px-10 py-16">
          <div className="h-14 w-2/3 rounded bg-[var(--page-chip)]" />
          <div className="mt-8 space-y-2">
            <div className="h-6 w-full rounded bg-[var(--page-chip)]" />
            <div className="h-6 w-5/6 rounded bg-[var(--page-chip)]" />
            <div className="h-6 w-3/4 rounded bg-[var(--page-chip)]" />
          </div>
        </div>
      </main>
    </div>
  );
}
