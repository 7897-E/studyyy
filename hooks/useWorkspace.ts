"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export interface Workspace {
  id: string;
  name: string;
}

export function useWorkspace() {
  const { user, loading: authLoading } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setWorkspace(null);
      setLoading(false);
      return;
    }
    const currentUser = user;

    let cancelled = false;

    async function ensureWorkspace() {
      setLoading(true);

      const { data: existing, error: fetchError } = await supabase
        .from("workspaces")
        .select("id, name")
        .eq("owner_id", currentUser.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        console.error(fetchError);
        setLoading(false);
        return;
      }

      if (existing) {
        if (!cancelled) setWorkspace(existing);
        setLoading(false);
        return;
      }

      const workspaceName =
        typeof currentUser.user_metadata?.workspace_name === "string" && currentUser.user_metadata.workspace_name.trim()
          ? currentUser.user_metadata.workspace_name.trim()
          : "My Workspace";

      const { data: created, error: createError } = await supabase
        .from("workspaces")
        .insert({ name: workspaceName, owner_id: currentUser.id })
        .select("id, name")
        .single();

      if (createError) console.error(createError);
      if (!cancelled) setWorkspace(created ?? null);
      setLoading(false);
    }

    ensureWorkspace();

    const channel = supabase
      .channel(`workspace:${currentUser.id}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "workspaces", filter: `owner_id=eq.${currentUser.id}` }, (payload) => {
        const nextWorkspace = payload.new as Workspace | null;
        if (nextWorkspace?.id && !cancelled) {
          setWorkspace({ id: nextWorkspace.id, name: nextWorkspace.name });
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [authLoading, user]);

  return { workspace, loading, user };
}
