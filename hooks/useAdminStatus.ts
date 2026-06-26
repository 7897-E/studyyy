"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export const ROOT_ADMIN_EMAIL = "reyeemia1@gmail.com";

export function useAdminStatus(user?: User | null) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isRootAdmin, setIsRootAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const email = user?.email?.toLowerCase() ?? "";

    async function loadAdminStatus() {
      if (!email) {
        setIsAdmin(false);
        setIsRootAdmin(false);
        setLoading(false);
        return;
      }

      if (email === ROOT_ADMIN_EMAIL) {
        setIsAdmin(true);
        setIsRootAdmin(true);
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "status" },
      });

      if (!cancelled) {
        setIsAdmin(!error && data?.admin === true);
        setIsRootAdmin(false);
        setLoading(false);
      }
    }

    loadAdminStatus();

    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  return { isAdmin, isRootAdmin, loading };
}
