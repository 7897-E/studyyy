import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/owl-alpha";
const OPENROUTER_FALLBACK_MODEL = Deno.env.get("OPENROUTER_FALLBACK_MODEL") ?? "";

const SYSTEM_PROMPT = `You are a highly precise note-formatting assistant inside a personal knowledge manager. Convert raw, messy notes into clean, readable, Notion-compatible Markdown.

Rules:
1. Do not add facts, names, dates, claims, summaries, or opinions that are not present in the input.
2. Output only Markdown. No preamble, explanation, or surrounding code fence.
3. Preserve all actionable items, dates, names, links, file names, commands, and technical terms.
4. Use headings, bullets, numbered lists, checkboxes, tables, dividers, and blockquotes where they improve readability.
5. Use ## for main sections and ### for subsections. Use # only when the input clearly has a single title.
6. Keep the result immediately usable as a Notion page.`;

interface FormatRequest {
  text?: string;
  content?: string;
  blocks?: unknown;
  workspaceId?: string;
  pageId?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!OPENROUTER_API_KEY) {
    return json({ error: "Missing OPENROUTER_API_KEY Supabase secret" }, 500);
  }

  try {
    const { text, content, workspaceId, pageId } = (await req.json()) as FormatRequest;
    const input = text?.trim() || content?.trim() || "";

    if (!input) {
      return json({ error: "No text provided" }, 400);
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://studyyy.local",
        "X-Title": "studyyy",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input },
        ],
        temperature: 0.2,
        max_completion_tokens: 4096,
        provider: {
          allow_fallbacks: true,
        },
        reasoning: {
          exclude: true,
        },
        ...(OPENROUTER_FALLBACK_MODEL
          ? { models: [OPENROUTER_MODEL, OPENROUTER_FALLBACK_MODEL] }
          : {}),
        stream: false,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return json({ error: data.error?.message ?? "OpenRouter request failed", details: data }, response.status);
    }

    const choiceError = data?.choices?.[0]?.error;
    if (choiceError) {
      return json(
        {
          error: choiceError.message ?? "OpenRouter provider returned an embedded error",
          model: OPENROUTER_MODEL,
          details: choiceError,
        },
        choiceError.code ?? 502
      );
    }

    const formatted = extractFormattedText(data);

    if (!formatted) {
      console.error("OpenRouter returned no content:", JSON.stringify(data).slice(0, 2000));
      return json(
        {
          error: "No formatted output returned from OpenRouter",
          model: OPENROUTER_MODEL,
          details: summarizeOpenRouterResponse(data),
        },
        502
      );
    }

    console.log(JSON.stringify({
      workspaceId,
      pageId,
      model: OPENROUTER_MODEL,
      inputLength: input.length,
      outputLength: formatted.length,
    }));

    return json({ formatted });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractFormattedText(data: any): string {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;

  if (typeof content === "string") return content.trim();
  if (typeof choice?.text === "string") return choice.text.trim();

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text ?? part?.content ?? "";
      })
      .join("")
      .trim();
  }

  if (typeof data?.output === "string") return data.output.trim();
  if (typeof data?.text === "string") return data.text.trim();
  if (typeof message?.text === "string") return message.text.trim();

  return "";
}

function summarizeOpenRouterResponse(data: any) {
  return {
    id: data?.id,
    choicesLength: Array.isArray(data?.choices) ? data.choices.length : 0,
    finishReason: data?.choices?.[0]?.finish_reason,
    error: data?.error,
    usage: data?.usage,
  };
}
