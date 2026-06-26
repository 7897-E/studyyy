import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROOT_ADMIN_EMAIL = "reyeemia1@gmail.com";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/owl-alpha";
const APP_URL = Deno.env.get("APP_URL") ?? "https://studyyy.local";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const SYSTEM_PROMPT = `You are a helpful AI assistant inside studyyy, a Notion-like study workspace.

Help the admin think through notes, summarize ideas, make study plans, explain concepts, and answer questions.
Be concise, accurate, and practical. If page notes are provided, use them as context without inventing facts.`;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Use POST for this function." }, 405);
  }

  if (!OPENROUTER_API_KEY) {
    return json({ error: "Missing OPENROUTER_API_KEY Supabase secret." }, 500);
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

  const userEmail = normalizeEmail(userData.user?.email);
  const userIsAdmin = await isAdmin(admin, userEmail);

  if (userError || !userIsAdmin) {
    return json({ error: "Admin access required." }, 403);
  }

  try {
    const body = await readJson(req);
    const messages = normalizeMessages(body?.messages);
    const pageContext = clean(body?.pageContext);

    if (!messages.length) {
      return json({ error: "No chat message provided." }, 400);
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": APP_URL,
        "X-Title": "studyyy",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...(pageContext
            ? [{ role: "system", content: `Current page notes for context:\n\n${pageContext.slice(0, 12000)}` }]
            : []),
          ...messages,
        ],
        temperature: 0.35,
        max_tokens: 2048,
        reasoning: {
          exclude: true,
        },
        provider: {
          allow_fallbacks: true,
        },
        stream: false,
      }),
    });

    const data = await readOpenRouterResponse(response);

    if (!response.ok) {
      return json({ error: data?.error?.message ?? "OpenRouter request failed." }, response.status);
    }

    const reply = extractReply(data);

    if (!reply) {
      return json({ error: "No chat response returned from OpenRouter." }, 502);
    }

    return json({ reply, model: data?.model ?? OPENROUTER_MODEL });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown chat-notes error." }, 500);
  }
});

async function readJson(req: Request): Promise<any> {
  const text = await req.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function readOpenRouterResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 1000) } };
  }
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((message: any) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: clean(message?.content),
    }))
    .filter((message) => message.content);
}

async function isAdmin(admin: any, email: string): Promise<boolean> {
  if (email === ROOT_ADMIN_EMAIL) return true;

  const { data, error } = await admin.from("admin_users").select("email").eq("email", email).maybeSingle();
  return !error && Boolean(data);
}

function extractReply(data: any): string {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text ?? part?.content ?? "";
      })
      .join("")
      .trim();
  }

  return "";
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
