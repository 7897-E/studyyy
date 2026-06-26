  import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  const ROOT_ADMIN_EMAIL = "reyeemia1@gmail.com";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return json({ error: "Use POST for this function." }, 405);
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY secret." }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header." }, 401);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const caller = userData.user;

    if (userError || !caller?.email) {
      return json({ error: "Invalid user session." }, 401);
    }

    const callerEmail = normalizeEmail(caller.email);
    const callerIsAdmin = await isAdmin(admin, callerEmail);

    if (!callerIsAdmin) {
      return json({ error: "Admin access required." }, 403);
    }

    try {
      const body = await readJson(req);
      const action = typeof body?.action === "string" ? body.action : "list";

      if (action === "status") {
        return json({ admin: true, rootAdmin: callerEmail === ROOT_ADMIN_EMAIL });
      }

    if (action === "grant") {
      const email = normalizeEmail(body?.email);
      if (!email) return json({ error: "Email is required." }, 400);

      const existingUser = await findUserByEmail(admin, email);
      if (!existingUser) {
        return json({ error: "That email does not belong to an existing user." }, 400);
      }

      const { error } = await admin.from("admin_users").upsert(
        {
          email,
            created_by: caller.id,
          },
          { onConflict: "email" }
        );

        if (error) return json({ error: error.message }, 500);
        return json(await getAdminPanelData(admin));
      }

      if (action === "revoke") {
        const email = normalizeEmail(body?.email);
        if (!email) return json({ error: "Email is required." }, 400);
        if (email === ROOT_ADMIN_EMAIL) {
          return json({ error: "The root admin cannot be revoked." }, 400);
        }

        const { error } = await admin.from("admin_users").delete().eq("email", email);
        if (error) return json({ error: error.message }, 500);
        return json(await getAdminPanelData(admin));
      }

      return json(await getAdminPanelData(admin));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown admin-users error." }, 500);
    }
  });

  async function isAdmin(admin: any, email: string): Promise<boolean> {
    if (email === ROOT_ADMIN_EMAIL) return true;

    const { data, error } = await admin.from("admin_users").select("email").eq("email", email).maybeSingle();
    return !error && Boolean(data);
  }

  async function getAdminPanelData(admin: any) {
    const adminEmails = await getAdminEmails(admin);
    const users = await listUsers(admin);

    return {
      rootAdminEmail: ROOT_ADMIN_EMAIL,
      users: users.map((user) => {
        const email = normalizeEmail(user.email);
        return {
          id: user.id,
          email,
          createdAt: user.created_at,
          lastSignInAt: user.last_sign_in_at,
          isAdmin: email === ROOT_ADMIN_EMAIL || adminEmails.has(email),
          isRootAdmin: email === ROOT_ADMIN_EMAIL,
        };
      }),
    };
  }

  async function getAdminEmails(admin: any): Promise<Set<string>> {
    const { data, error } = await admin.from("admin_users").select("email");
    if (error) throw new Error(error.message);

    return new Set([ROOT_ADMIN_EMAIL, ...((data ?? []).map((record: any) => normalizeEmail(record.email)))]);
  }

  async function listUsers(admin: any) {
    const users = [];
    let page = 1;

    while (page <= 10) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw new Error(error.message);

      users.push(...(data.users ?? []));

      if (!data.users || data.users.length < 100) break;
      page += 1;
    }

  return users.sort((a: any, b: any) => normalizeEmail(a.email).localeCompare(normalizeEmail(b.email)));
}

async function findUserByEmail(admin: any, email: string) {
  const users = await listUsers(admin);
  return users.find((user: any) => normalizeEmail(user.email) === email) ?? null;
}

async function readJson(req: Request): Promise<any> {
    const text = await req.text();
    if (!text.trim()) return {};

    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Request body must be valid JSON.");
    }
  }

  function normalizeEmail(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function json(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
