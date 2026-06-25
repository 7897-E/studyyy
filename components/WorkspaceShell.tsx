"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { useWorkspace } from "@/hooks/useWorkspace";

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { workspace, loading, user } = useWorkspace();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push("/auth");
  }, [loading, router, user]);

  if (loading) {
    return <main className="grid min-h-screen place-items-center text-sm text-[rgba(55,53,47,0.65)]">Loading...</main>;
  }

  if (!workspace || !user) return null;

  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-[var(--text)]">
      <Sidebar workspace={workspace} user={user} />
      <main className="ml-[var(--sidebar-width)] min-h-screen">{children}</main>
    </div>
  );
}
