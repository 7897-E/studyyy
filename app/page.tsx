"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/useWorkspace";

function HomeContent() {
  const { workspace } = useWorkspace();
  const router = useRouter();

  useEffect(() => {
    if (!workspace) return;
    const currentWorkspace = workspace;

    async function openLatestPage() {
      const { data: latest, error } = await supabase
        .from("pages")
        .select("id")
        .eq("workspace_id", currentWorkspace.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error(error);
      }

      if (latest) {
        router.replace(`/pages/${latest.id}`);
        return;
      }

      router.replace("/workspace");
    }

    openLatestPage();
  }, [router, workspace]);

  return <div className="grid min-h-screen place-items-center text-sm text-[var(--muted)]">Opening workspace...</div>;
}

export default function HomePage() {
  return (
    <WorkspaceShell>
      <HomeContent />
    </WorkspaceShell>
  );
}
