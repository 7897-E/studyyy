"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface ClassRecord {
  id: string;
  name: string;
  color: string;
}

const DEFAULT_CLASS_COLOR = "#78716c";

export function useClasses(workspaceId?: string) {
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableAvailable, setTableAvailable] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    async function loadClasses() {
      setLoading(true);
      let result: any = await supabase
        .from("classes")
        .select("id, name, color")
        .eq("workspace_id", workspaceId)
        .order("name", { ascending: true });

      if (result.error && result.error.message.includes("color")) {
        const fallback = await supabase
          .from("classes")
          .select("id, name")
          .eq("workspace_id", workspaceId)
          .order("name", { ascending: true });

        result = {
          ...fallback,
          data: fallback.data?.map((classRecord) => ({ ...classRecord, color: DEFAULT_CLASS_COLOR })) ?? null,
        };
      }

      const { data, error } = result;

      if (error) {
        console.warn(error);
        if (!cancelled) {
          setClasses([]);
          setTableAvailable(false);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setClasses(data ?? []);
        setTableAvailable(true);
        setLoading(false);
      }
    }

    loadClasses();

    const channel = supabase
      .channel(`classes:${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "classes", filter: `workspace_id=eq.${workspaceId}` },
        loadClasses
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  const names = useMemo(() => {
    const set = new Set(["Unsorted", ...classes.map((classRecord) => classRecord.name)]);
    return Array.from(set).sort((a, b) => (a === "Unsorted" ? -1 : b === "Unsorted" ? 1 : a.localeCompare(b)));
  }, [classes]);

  async function addClass(name: string) {
    const trimmed = name.trim();
    if (!workspaceId || !trimmed || trimmed === "Unsorted") return;

    let result: any = await supabase.from("classes").upsert(
      {
        workspace_id: workspaceId,
        name: trimmed,
        color: DEFAULT_CLASS_COLOR,
      },
      { onConflict: "workspace_id,name" }
    ).select("id, name, color").single();

    if (result.error && result.error.message.includes("color")) {
      const fallback = await supabase.from("classes").upsert(
        {
          workspace_id: workspaceId,
          name: trimmed,
        },
        { onConflict: "workspace_id,name" }
      ).select("id, name").single();

      result = {
        ...fallback,
        data: fallback.data ? { ...fallback.data, color: DEFAULT_CLASS_COLOR } : null,
      };
    }

    const { data, error } = result;

    if (error) console.error(error);
    if (!error && data) {
      setClasses((current) => {
        if (current.some((classRecord) => classRecord.name === data.name)) return current;
        return [...current, data].sort((a, b) => a.name.localeCompare(b.name));
      });
    }
  }

  async function deleteClass(name: string) {
    if (!workspaceId || !name || name === "Unsorted") return;

    const updatePages = await supabase
      .from("pages")
      .update({ class_name: "Unsorted" })
      .eq("workspace_id", workspaceId)
      .eq("class_name", name);

    if (updatePages.error) console.error(updatePages.error);

    const { error } = await supabase.from("classes").delete().eq("workspace_id", workspaceId).eq("name", name);
    if (error) console.error(error);
    if (!error) {
      setClasses((current) => current.filter((classRecord) => classRecord.name !== name));
    }
  }

  async function renameClass(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!workspaceId || !oldName || oldName === "Unsorted" || !trimmed || trimmed === "Unsorted") return;

    const updateClass = await supabase
      .from("classes")
      .update({ name: trimmed })
      .eq("workspace_id", workspaceId)
      .eq("name", oldName);

    if (updateClass.error) {
      console.error(updateClass.error);
      return;
    }

    const updatePages = await supabase
      .from("pages")
      .update({ class_name: trimmed })
      .eq("workspace_id", workspaceId)
      .eq("class_name", oldName);

    if (updatePages.error) console.error(updatePages.error);
    if (!updatePages.error) {
      setClasses((current) =>
        current
          .map((classRecord) => (classRecord.name === oldName ? { ...classRecord, name: trimmed } : classRecord))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    }
  }

  async function updateClassColor(name: string, color: string) {
    if (!workspaceId || !name || name === "Unsorted" || !color.trim()) return;

    setClasses((current) =>
      current.map((classRecord) => (classRecord.name === name ? { ...classRecord, color } : classRecord))
    );

    const { error } = await supabase
      .from("classes")
      .update({ color })
      .eq("workspace_id", workspaceId)
      .eq("name", name);

    if (error) console.error(error);
  }

  return { classes, names, loading, tableAvailable, addClass, deleteClass, renameClass, updateClassColor };
}
