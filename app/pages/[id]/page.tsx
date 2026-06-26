"use client";

import { useEffect, useRef, useState } from "react";
import type { Block } from "@blocknote/core";
import { useParams, useRouter } from "next/navigation";
import { BlockEditor } from "@/components/BlockEditor";
import { useTheme } from "@/components/ThemeContext";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { supabase } from "@/lib/supabase";
import { saveUserPageTemplate } from "@/lib/pageTemplates";

interface PageRecord {
  id: string;
  workspace_id: string;
  title: string;
  class_name: string;
  icon: string | null;
  content: { blocks?: Block[]; markdown?: string } | null;
}

function PageEditor() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const [page, setPage] = useState<PageRecord | null>(null);
  const [title, setTitle] = useState("");
  const [className, setClassName] = useState("Unsorted");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const loadedSnapshotRef = useRef("");

  function saveAsTemplate() {
    saveUserPageTemplate({
      name: title.trim() || "Untitled template",
      description: "User-made template",
      title: title.trim() || "Untitled",
      blocks,
    });
    setStatus("Saved as template");
  }

  useEffect(() => {
    if (!params.id) return;

    let cancelled = false;

    async function loadPage() {
      setLoading(true);
      let result: any = await supabase
        .from("pages")
        .select("id, workspace_id, title, class_name, icon, content")
        .eq("id", params.id)
        .single();

      if (result.error && result.error.message.includes("class_name")) {
        const fallback = await supabase
          .from("pages")
          .select("id, workspace_id, title, icon, content")
          .eq("id", params.id)
          .single();

        result = {
          ...fallback,
          data: fallback.data ? { ...fallback.data, class_name: "Unsorted" } : null,
        };
      }

      if (result.error) {
        console.error(result.error);
        router.replace("/");
        return;
      }

      if (!cancelled) {
        const nextBlocks = result.data.content?.blocks ?? [];
        setPage(result.data);
        setTitle(result.data.title ?? "Untitled");
        setClassName(result.data.class_name ?? "Unsorted");
        setBlocks(nextBlocks);
        loadedSnapshotRef.current = pageSnapshot(result.data.title ?? "Untitled", result.data.class_name ?? "Unsorted", nextBlocks);
        setStatus("Saved");
        setLoading(false);
      }
    }

    loadPage();

    return () => {
      cancelled = true;
    };
  }, [params.id, router]);

  useEffect(() => {
    if (!page || loading) return;

    const nextSnapshot = pageSnapshot(title.trim() || "Untitled", className.trim() || "Unsorted", blocks);
    if (nextSnapshot === loadedSnapshotRef.current) return;

    const timer = window.setTimeout(async () => {
      setSaving(true);
      let result = await supabase
        .from("pages")
        .update({
          title: title.trim() || "Untitled",
          class_name: className.trim() || "Unsorted",
          content: { blocks },
        })
        .eq("id", page.id);

      if (result.error && result.error.message.includes("class_name")) {
        result = await supabase
          .from("pages")
          .update({
            title: title.trim() || "Untitled",
            content: { blocks },
          })
          .eq("id", page.id);
      }

      if (result.error) {
        console.error(result.error);
        setStatus(result.error.message);
      } else {
        setStatus("Saved");
        loadedSnapshotRef.current = nextSnapshot;
      }

      setSaving(false);
    }, 700);

    return () => window.clearTimeout(timer);
  }, [blocks, className, loading, page, title]);

  if (loading && !page) {
    return <PageEditorSkeleton />;
  }

  return (
    <article className="mx-auto w-full max-w-4xl px-10 py-16">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="mb-3 w-full border-none bg-transparent text-5xl font-bold tracking-normal text-[var(--text)] outline-none placeholder:text-[var(--faint)]"
        placeholder="Untitled"
      />

      <div className="sticky top-0 z-10 -mx-10 mb-8 flex items-center justify-between border-b border-transparent bg-[var(--page-bg-translucent)] px-10 py-2 backdrop-blur">
        <p className="text-sm text-[var(--muted)]">{saving ? "Saving..." : status || "Saved to Supabase"}</p>
        <button
          onClick={saveAsTemplate}
          className="rounded border border-[var(--line)] bg-[var(--page-bg)] px-2 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)]"
        >
          Save as template
        </button>
      </div>

      <BlockEditor
        key={page?.id}
        initialBlocks={blocks}
        currentBlocks={blocks}
        onChange={setBlocks}
        pageId={page?.id}
        workspaceId={page?.workspace_id}
        theme={theme}
        onStatus={setStatus}
      />
    </article>
  );
}

function pageSnapshot(title: string, className: string, blocks: Block[]) {
  return JSON.stringify({ title, className, blocks });
}

function PageEditorSkeleton() {
  return (
    <article className="mx-auto w-full max-w-4xl px-10 py-16">
      <div className="h-14 w-2/3 rounded bg-[var(--page-chip)]" />
      <div className="sticky top-0 z-10 -mx-10 mb-8 mt-3 flex items-center justify-between border-b border-transparent bg-[var(--page-bg-translucent)] px-10 py-2 backdrop-blur">
        <div className="h-5 w-24 rounded bg-[var(--page-chip)]" />
        <div className="h-7 w-28 rounded border border-[var(--line)] bg-[var(--page-bg)]" />
      </div>
      <div className="space-y-2">
        <div className="h-6 w-full rounded bg-[var(--page-chip)]" />
        <div className="h-6 w-5/6 rounded bg-[var(--page-chip)]" />
        <div className="h-6 w-3/4 rounded bg-[var(--page-chip)]" />
      </div>
    </article>
  );
}

export default function StudyPage() {
  return (
    <WorkspaceShell>
      <PageEditor />
    </WorkspaceShell>
  );
}
