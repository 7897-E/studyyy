import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROOT_ADMIN_EMAIL = "reyeemia1@gmail.com";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/owl-alpha";
const NVIDIA_API_KEY = Deno.env.get("NVIDIA_API_KEY");
const NVIDIA_MODEL = "deepseek-ai/deepseek-v4-pro";
const APP_URL = Deno.env.get("APP_URL") ?? "https://studyyy.local";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const SYSTEM_PROMPT = `You are a helpful AI assistant inside studyyy, a Notion-like study workspace.

Help the admin think through notes, summarize ideas, make study plans, explain concepts, and answer questions.
Be concise, accurate, and practical. If page notes are provided, use them as context without inventing facts.

You can read the current page and a compact list of other pages in the workspace.
If the user explicitly asks you to edit, rewrite, add to, remove from, organize, or otherwise change the current page, return a complete replacement for the current page as Markdown.

Always respond as JSON with this exact shape:
{
  "reply": "short message to show in chat",
  "pageEditMarkdown": "complete replacement Markdown for the current page, only when an edit was requested"
}

If no page edit was requested, omit pageEditMarkdown. Do not wrap the JSON in a code fence.
When code is included, preserve it exactly inside fenced code blocks. Do not convert URLs into angle-bracket links. Do not convert dotted identifiers like client.chat into markdown links. Do not repeat API keys or secrets; use placeholders such as "<NVIDIA_API_KEY>".`;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const CHAT_ACTIVITY = {
  reading: "Reading current page and workspace pages",
  writing: "Writing response",
  editing: "Preparing page edit",
  saving: "Saving chat history",
};

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

  const userEmail = normalizeEmail(userData.user?.email);
  const userIsAdmin = await isAdmin(admin, userEmail);

  if (userError || !userIsAdmin) {
    return json({ error: "Admin access required." }, 403);
  }

  try {
    const body = await readJson(req);
    const action = clean(body?.action) || "send";
    const workspaceId = clean(body?.workspaceId);
    const pageId = clean(body?.pageId);

    if (action === "list") {
      return json(await getChatThreads(admin, workspaceId));
    }

    if (action === "create") {
      const thread = await createChatThread(admin, workspaceId, userData.user?.id, "New chat");
      return json({ thread, messages: [] });
    }

    if (action === "load") {
      const threadId = clean(body?.threadId);
      if (!threadId) return json({ error: "Thread id is required." }, 400);
      return json(await getChatThread(admin, threadId));
    }

    if (action === "delete") {
      const threadId = clean(body?.threadId);
      if (!threadId) return json({ error: "Thread id is required." }, 400);
      await deleteChatThread(admin, threadId);
      return json(await getChatThreads(admin, workspaceId));
    }

    const messages = normalizeMessages(body?.messages);
    const safeMessages = messages.map((message) => ({ ...message, content: redactSecrets(message.content) }));
    const pageContext = redactSecrets(clean(body?.pageContext));
    const requestedThreadId = clean(body?.threadId);

    if (!messages.length) {
      return json({ error: "No chat message provided." }, 400);
    }

    const latestUserMessage = [...safeMessages].reverse().find((message) => message.role === "user");
    if (!latestUserMessage) {
      return json({ error: "No user message provided." }, 400);
    }

    const thread =
      requestedThreadId
        ? (await getChatThread(admin, requestedThreadId)).thread
        : await createChatThread(admin, workspaceId, userData.user?.id, titleFromMessage(latestUserMessage.content));

    await insertChatMessage(admin, thread.id, "user", latestUserMessage.content);

    const workspaceContext = workspaceId ? redactSecrets(await getWorkspacePageContext(admin, workspaceId, pageId)) : "";
    const selectedModel = await getSelectedChatModel(admin, userEmail);
    const providerMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(pageContext
        ? [{ role: "system", content: `Current page notes for context:\n\n${pageContext.slice(0, 12000)}` }]
        : []),
      ...(workspaceContext
        ? [{ role: "system", content: `Other workspace pages for context:\n\n${workspaceContext}` }]
        : []),
      ...safeMessages,
    ];

    if (body?.stream === true) {
      return streamChatResponse(admin, selectedModel, providerMessages, thread, workspaceId);
    }

    const response = await callSelectedProvider(selectedModel, providerMessages);

    const data = await readProviderResponse(response);

    if (!response.ok) {
      return json({ error: data?.error?.message ?? data?.error ?? "AI request failed." }, response.status);
    }

    const parsedReply = parseAssistantResponse(extractReply(data));
    const reply = redactSecrets(parsedReply.reply);
    const pageEditMarkdown = parsedReply.pageEditMarkdown ? redactSecrets(parsedReply.pageEditMarkdown) : undefined;

    if (!reply) {
      return json({ error: "No chat response returned from the selected model." }, 502);
    }

    await insertChatMessage(admin, thread.id, "assistant", reply, {
      model: data?.model ?? selectedModel.model,
      pageEditMarkdown,
    });

    return json({
      reply,
      pageEditMarkdown,
      model: data?.model ?? selectedModel.model,
      thread,
      history: await getChatThreads(admin, workspaceId),
      activity: pageEditMarkdown
        ? [CHAT_ACTIVITY.reading, CHAT_ACTIVITY.writing, CHAT_ACTIVITY.editing, CHAT_ACTIVITY.saving]
        : [CHAT_ACTIVITY.reading, CHAT_ACTIVITY.writing, CHAT_ACTIVITY.saving],
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown chat-notes error." }, 500);
  }
});

async function streamChatResponse(
  admin: any,
  selectedModel: { provider: string; model: string },
  messages: Array<{ role: string; content: string }>,
  thread: any,
  workspaceId: string
) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (event: string, payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        };

        let raw = "";

        try {
          send("activity", { activity: [CHAT_ACTIVITY.reading, CHAT_ACTIVITY.writing], thread });

          const response = await callSelectedProvider(selectedModel, messages, true);

          if (!response.ok || !response.body) {
            const data = await readProviderResponse(response);
            send("error", { error: data?.error?.message ?? data?.error ?? "AI request failed." });
            controller.close();
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";

            for (const event of events) {
              const delta = streamEventToText(event);
              if (!delta) continue;

              raw += delta;
              send("token", { text: delta });
            }
          }

          const parsedReply = parseAssistantResponse(raw);
          const reply = redactSecrets(parsedReply.reply);
          const pageEditMarkdown = parsedReply.pageEditMarkdown ? redactSecrets(parsedReply.pageEditMarkdown) : undefined;

          if (!reply) {
            send("error", { error: "No chat response returned from the selected model." });
            controller.close();
            return;
          }

          await insertChatMessage(admin, thread.id, "assistant", reply, {
            model: selectedModel.model,
            pageEditMarkdown,
          });

          const activity = pageEditMarkdown
            ? [CHAT_ACTIVITY.reading, CHAT_ACTIVITY.writing, CHAT_ACTIVITY.editing, CHAT_ACTIVITY.saving]
            : [CHAT_ACTIVITY.reading, CHAT_ACTIVITY.writing, CHAT_ACTIVITY.saving];

          send("complete", {
            reply,
            pageEditMarkdown,
            model: selectedModel.model,
            thread,
            history: await getChatThreads(admin, workspaceId),
            activity,
          });
        } catch (error) {
          send("error", { error: error instanceof Error ? error.message : "Unknown chat stream error." });
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    }
  );
}

async function callSelectedProvider(
  selectedModel: { provider: string; model: string },
  messages: Array<{ role: string; content: string }>,
  stream = false
) {
  if (selectedModel.provider === "nvidia") {
    if (!NVIDIA_API_KEY) {
      return json({ error: "Missing NVIDIA_API_KEY Supabase secret." }, 500);
    }

    return fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages,
        temperature: 1,
        top_p: 0.95,
        max_tokens: 16384,
        chat_template_kwargs: {
          thinking: false,
        },
        stream,
      }),
    });
  }

  if (!OPENROUTER_API_KEY) {
    return json({ error: "Missing OPENROUTER_API_KEY Supabase secret." }, 500);
  }

  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": APP_URL,
      "X-Title": "studyyy",
    },
    body: JSON.stringify({
      model: selectedModel.model || OPENROUTER_MODEL,
      messages,
      temperature: 0.35,
      max_tokens: 2048,
      reasoning: {
        exclude: true,
      },
      provider: {
        allow_fallbacks: true,
      },
      stream,
    }),
  });
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

async function readProviderResponse(response: Response): Promise<any> {
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

async function getChatThreads(admin: any, workspaceId: string) {
  let query = admin
    .from("ai_chat_threads")
    .select("id, workspace_id, title, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(30);

  if (workspaceId) query = query.eq("workspace_id", workspaceId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return { threads: data ?? [] };
}

async function getChatThread(admin: any, threadId: string) {
  const { data: thread, error: threadError } = await admin
    .from("ai_chat_threads")
    .select("id, workspace_id, title, created_at, updated_at")
    .eq("id", threadId)
    .single();

  if (threadError) throw new Error(threadError.message);

  const { data: messages, error: messagesError } = await admin
    .from("ai_chat_messages")
    .select("role, content, metadata, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (messagesError) throw new Error(messagesError.message);

  return {
    thread,
    messages: (messages ?? []).map((message: any) => ({
      role: message.role,
      content: message.content,
      metadata: message.metadata,
      createdAt: message.created_at,
    })),
  };
}

async function createChatThread(admin: any, workspaceId: string, userId: string | undefined, title: string) {
  const { data, error } = await admin
    .from("ai_chat_threads")
    .insert({
      workspace_id: workspaceId || null,
      created_by: userId ?? null,
      title,
    })
    .select("id, workspace_id, title, created_at, updated_at")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function deleteChatThread(admin: any, threadId: string) {
  const { error } = await admin.from("ai_chat_threads").delete().eq("id", threadId);
  if (error) throw new Error(error.message);
}

async function insertChatMessage(
  admin: any,
  threadId: string,
  role: "user" | "assistant",
  content: string,
  metadata: Record<string, unknown> = {}
) {
  const { error } = await admin.from("ai_chat_messages").insert({
    thread_id: threadId,
    role,
    content,
    metadata,
  });

  if (error) throw new Error(error.message);

  await admin.from("ai_chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
}

function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return "New chat";
  return compact.length > 44 ? `${compact.slice(0, 44)}...` : compact;
}

async function getWorkspacePageContext(admin: any, workspaceId: string, pageId: string): Promise<string> {
  const { data, error } = await admin
    .from("pages")
    .select("id, title, class_name, content, updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(30);

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((page: any) => {
      const title = clean(page.title) || "Untitled";
      const className = clean(page.class_name) || "Unsorted";
      const marker = page.id === pageId ? "current page" : "other page";
      const text = blocksToText(page.content?.blocks).slice(0, 1600);
      return `- ${title} (${className}, ${marker}, id: ${page.id})\n${text}`;
    })
    .join("\n\n");
}

async function getSelectedChatModel(admin: any, userEmail: string): Promise<{ provider: string; model: string }> {
  if (userEmail !== ROOT_ADMIN_EMAIL) {
    return {
      provider: "openrouter",
      model: OPENROUTER_MODEL,
    };
  }

  const { data, error } = await admin.from("admin_settings").select("value").eq("key", "chat_model").maybeSingle();
  if (error) throw new Error(error.message);

  const provider = clean(data?.value?.provider);
  const model = clean(data?.value?.model);

  if (provider === "nvidia") {
    return { provider: "nvidia", model: NVIDIA_MODEL };
  }

  return {
    provider: "openrouter",
    model: model || OPENROUTER_MODEL,
  };
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

function streamEventToText(event: string): string {
  const payloads = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s?/, "").trim())
    .filter(Boolean);

  let text = "";

  for (const payload of payloads) {
    if (payload === "[DONE]") continue;

    try {
      text += extractStreamDelta(JSON.parse(payload));
    } catch {
      // Ignore malformed keepalive chunks.
    }
  }

  return text;
}

function extractStreamDelta(data: any): string {
  const choice = data?.choices?.[0];
  const delta = choice?.delta;
  const content = delta?.content ?? choice?.message?.content ?? choice?.text ?? data?.text;

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text ?? part?.content ?? "";
      })
      .join("");
  }

  return "";
}

function parseAssistantResponse(raw: string): { reply: string; pageEditMarkdown?: string } {
  const trimmed = stripCodeFence(raw);

  try {
    const parsed = JSON.parse(trimmed);
    return {
      reply: clean(parsed?.reply) || trimmed,
      pageEditMarkdown: clean(parsed?.pageEditMarkdown) || undefined,
    };
  } catch {
    return { reply: trimmed };
  }
}

function stripCodeFence(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";

  return blocks
    .map((block: any) => {
      const content = inlineContentToText(block?.content);
      const children = blocksToText(block?.children);
      return [content, children].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

function inlineContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item: any) => {
      if (typeof item === "string") return item;
      if (typeof item?.text === "string") return item.text;
      if (typeof item?.content === "string") return item.content;
      if (Array.isArray(item?.content)) return inlineContentToText(item.content);
      return "";
    })
    .join("");
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function redactSecrets(value: string): string {
  return value
    .replace(/nvapi-[A-Za-z0-9_-]+/g, "<NVIDIA_API_KEY>")
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "<OPENROUTER_API_KEY>")
    .replace(/sk-proj-[A-Za-z0-9_-]+/g, "<OPENAI_API_KEY>")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "<API_KEY>")
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "<SUPABASE_SECRET_KEY>")
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "<JWT>");
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
