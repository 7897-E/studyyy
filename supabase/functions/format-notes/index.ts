const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/owl-alpha";
const OPENROUTER_FALLBACK_MODEL = Deno.env.get("OPENROUTER_FALLBACK_MODEL") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://studyyy.local";

const SYSTEM_PROMPT = `You are a precise note-formatting assistant inside a personal knowledge manager.

Convert raw, messy notes into clean, readable, Notion-compatible Markdown.

Rules:
1. Do not add facts, names, dates, claims, summaries, or opinions that are not present in the input.
2. Output only Markdown. No preamble, explanation, or surrounding code fence.
3. Preserve all actionable items, dates, names, links, file names, commands, and technical terms.
4. Use headings, bullets, numbered lists, checkboxes, tables, dividers, and blockquotes where they improve readability.
5. Use ## for main sections and ### for subsections. Use # only when the input clearly has a single title.
6. Keep the result immediately usable as a Notion page.
7. If the notes are short, still return the improved Markdown instead of returning nothing.
8. If the input contains code, keep it inside fenced code blocks and preserve indentation.
9. Do not convert URLs into angle-bracket links, and do not convert dotted identifiers like client.chat into Markdown links.
10. Do not repeat API keys or secrets; replace them with placeholders like <NVIDIA_API_KEY>.`;

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

  try {
    const body = await readJson(req);
    const input = redactSecrets(getInputText(body));

    if (!input) {
      return json({ error: "No text provided. Add notes before formatting." }, 400);
    }

    const payload: Record<string, unknown> = {
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Format these notes as Notion-compatible Markdown:\n\n${input}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 4096,
      reasoning: {
        exclude: true,
      },
      provider: {
        allow_fallbacks: true,
      },
      stream: false,
    };

    if (OPENROUTER_FALLBACK_MODEL) {
      payload.models = [OPENROUTER_MODEL, OPENROUTER_FALLBACK_MODEL];
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": APP_URL,
        "X-Title": "studyyy",
      },
      body: JSON.stringify(payload),
    });

    const data = await readOpenRouterResponse(response);
    const responseSummary = summarizeOpenRouterResponse(data);

    if (!response.ok) {
      return json(
        {
          error: openRouterErrorMessage(data, "OpenRouter request failed."),
          details: responseSummary,
        },
        response.status
      );
    }

    const choiceError = data?.choices?.[0]?.error;
    if (choiceError) {
      return json(
        {
          error: choiceError.message ?? "OpenRouter provider returned an embedded error.",
          details: choiceError,
        },
        502
      );
    }

    const formatted = redactSecrets(extractFormattedText(data));

    if (!formatted) {
      return json(
        {
          error: "No formatted output returned from OpenRouter.",
          details: responseSummary,
        },
        502
      );
    }

    return json({
      formatted,
      model: data?.model ?? OPENROUTER_MODEL,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown format-notes error." }, 500);
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

function getInputText(body: any): string {
  const text = clean(body?.text);
  if (text) return text;

  const content = clean(body?.content);
  if (content) return content;

  const blocks = blocksToText(body?.blocks).trim();
  if (blocks) return blocks;

  return "";
}

function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";

  return blocks
    .map((block: any) => {
      const ownText = inlineContentToText(block?.content);
      const childText = blocksToText(block?.children);
      return [ownText, childText].filter(Boolean).join("\n");
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

function extractFormattedText(data: any): string {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;

  if (typeof content === "string") return stripCodeFence(content.trim());
  if (typeof choice?.text === "string") return stripCodeFence(choice.text.trim());
  if (typeof message?.text === "string") return stripCodeFence(message.text.trim());

  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text ?? part?.content ?? "";
      })
      .join("")
      .trim();

    return stripCodeFence(joined);
  }

  if (content && typeof content === "object") {
    const text = content.text ?? content.content;
    if (typeof text === "string") return stripCodeFence(text.trim());
  }

  if (typeof data?.output === "string") return stripCodeFence(data.output.trim());
  if (typeof data?.text === "string") return stripCodeFence(data.text.trim());

  return "";
}

function stripCodeFence(value: string): string {
  return value
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function openRouterErrorMessage(data: any, fallback: string): string {
  return data?.error?.message ?? data?.message ?? data?.detail ?? fallback;
}

function summarizeOpenRouterResponse(data: any) {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;

  return {
    id: data?.id,
    model: data?.model,
    choicesLength: Array.isArray(data?.choices) ? data.choices.length : 0,
    finishReason: choice?.finish_reason,
    nativeFinishReason: choice?.native_finish_reason,
    messageRole: message?.role,
    messageContentType: Array.isArray(content) ? "array" : typeof content,
    messageContentLength: typeof content === "string" ? content.length : Array.isArray(content) ? content.length : 0,
    messageContentPreview: preview(content),
    hasReasoning: typeof message?.reasoning === "string" && message.reasoning.length > 0,
    reasoningLength: typeof message?.reasoning === "string" ? message.reasoning.length : 0,
    error: data?.error,
    usage: data?.usage,
  };
}

function preview(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) return JSON.stringify(value).slice(0, 500);
  if (value && typeof value === "object") return JSON.stringify(value).slice(0, 500);
  return "";
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
