"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Block, PartialBlock } from "@blocknote/core";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  filterSuggestionItems,
  insertOrUpdateBlock,
  locales,
} from "@blocknote/core";
import {
  type DefaultReactSuggestionItem,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { flip, offset, shift, size } from "@floating-ui/react";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiChat3Line,
  RiDeleteBinLine,
  RiLayoutColumnLine,
  RiMagicLine,
  RiMicLine,
  RiSendPlane2Line,
  RiStopCircleLine,
  RiStickyNoteLine,
} from "react-icons/ri";
import {
  getMultiColumnSlashMenuItems,
  locales as multiColumnLocales,
  multiColumnDropCursor,
  withMultiColumn,
} from "@blocknote/xl-multi-column";
import { supabase } from "@/lib/supabase";
import { useAdminStatus } from "@/hooks/useAdminStatus";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/components/ThemeContext";

interface BlockEditorProps {
  initialBlocks?: Block[];
  currentBlocks?: Block[];
  onChange: (blocks: Block[]) => void;
  pageId?: string;
  workspaceId?: string;
  theme: "light" | "dark";
  onStatus: (message: string) => void;
}

const emptyDocument: PartialBlock[] = [
  {
    type: "paragraph",
    content: "",
  },
];

function parseTextBoxBlocks(blocksJson: unknown, fallbackText: string): PartialBlock<any, any, any>[] {
  if (typeof blocksJson === "string" && blocksJson) {
    try {
      const parsed = JSON.parse(blocksJson);
      if (Array.isArray(parsed) && parsed.length) return removeTextBoxBlocks(parsed);
    } catch {
      // Fall through to text migration.
    }
  }

  return textToSingleParagraphBlocks(fallbackText);
}

function textToBlocks(text: string): PartialBlock<any, any, any>[] {
  if (!text.trim()) return emptyDocument;

  return text.split("\n").map((line) => ({
    type: "paragraph",
    content: line,
  }));
}

function textToSingleParagraphBlocks(text: string): PartialBlock<any, any, any>[] {
  if (!text.trim()) return emptyDocument;

  return [{
    type: "paragraph",
    content: text,
  }];
}

function removeTextBoxBlocks(
  blocks?: Array<Block<any, any, any> | PartialBlock<any, any, any>>,
  useEmptyFallback = true
): PartialBlock<any, any, any>[] {
  if (!blocks?.length) return useEmptyFallback ? emptyDocument : [];

  return blocks.flatMap((block: any) => {
    if (block?.type !== "textBox") {
      const children = Array.isArray(block?.children) ? removeTextBoxBlocks(block.children, false) : block?.children;

      return [{
        ...block,
        children: isOnlyEmptyParagraphChild(children) ? [] : children,
      }];
    }

    const textFromProps = typeof block.props?.text === "string" ? block.props.text : "";
    const textFromContent = inlineContentToText(block.content);
    const existingBlocks = typeof block.props?.blocks === "string" ? block.props.blocks : "";
    const text = textFromProps || textFromContent;

    return parseTextBoxBlocks(existingBlocks, text);
  });
}

function isOnlyEmptyParagraphChild(children: unknown): boolean {
  if (!Array.isArray(children) || children.length !== 1) return false;

  const child: any = children[0];
  return child?.type === "paragraph" && !inlineContentToText(child.content).trim() && !child.children?.length;
}

function inlineContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item: any) => {
      if (typeof item === "string") return item;
      if (item?.type === "hardBreak") return "\n";
      if (typeof item?.text === "string") return item.text;
      if (typeof item?.content === "string") return item.content;
      if (Array.isArray(item?.content)) return inlineContentToText(item.content);
      return "";
    })
    .join("");
}

const editorSchema = withMultiColumn(
  BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
    },
  })
);

type DateTimePickerState = {
  type: "date" | "time";
  left: number;
  top: number;
} | null;

type FormatProgressState = {
  message: string;
  left: number;
  top: number;
} | null;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatThread = {
  id: string;
  title: string;
  updated_at?: string;
  updatedAt?: string;
};

type ChatModelIndicator = {
  id?: string;
  label: string;
  model: string;
} | null;

const DICTATION_CONSENT_KEY = "studyyy-lecture-dictation-consent";

export function BlockEditor({
  initialBlocks,
  currentBlocks,
  onChange,
  pageId,
  workspaceId,
  theme,
  onStatus,
}: BlockEditorProps) {
  const { user } = useAuth();
  const { isAdmin, isRootAdmin } = useAdminStatus(user);
  const { interfaceSettings } = useTheme();
  const [dateTimePicker, setDateTimePicker] = useState<DateTimePickerState>(null);
  const [formatProgress, setFormatProgress] = useState<FormatProgressState>(null);
  const [customTime, setCustomTime] = useState("");
  const [dictating, setDictating] = useState(false);
  const [dictationConsentOpen, setDictationConsentOpen] = useState(false);
  const [dictationText, setDictationText] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [activeChatThreadId, setActiveChatThreadId] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatActivity, setChatActivity] = useState<string[]>([]);
  const [chatModelIndicator, setChatModelIndicator] = useState<ChatModelIndicator>(null);
  const [chatHistoryCollapsed, setChatHistoryCollapsed] = useState(false);
  const recognitionRef = useRef<any>(null);
  const formattingRef = useRef(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const editor = useCreateBlockNote(
    {
      schema: editorSchema,
      dropCursor: multiColumnDropCursor,
      dictionary: {
        ...locales.en,
        multi_column: multiColumnLocales.en,
      },
      tabBehavior: "prefer-indent",
      initialContent: removeTextBoxBlocks(initialBlocks) as any,
    },
    []
  );

  const loadChatThreads = useCallback(async () => {
    try {
      const data = await callChatFunction({ action: "list", workspaceId });
      setChatThreads(data?.threads ?? []);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Could not load chat history.");
    }
  }, [workspaceId, onStatus]);

  useEffect(() => {
    if (!chatOpen || !isAdmin) return;
    loadChatThreads();
  }, [chatOpen, isAdmin, loadChatThreads]);

  useEffect(() => {
    if (!chatOpen || !isRootAdmin) {
      setChatModelIndicator(null);
      return;
    }

    let cancelled = false;

    async function loadChatModel() {
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "list" },
      });

      if (!cancelled) {
        setChatModelIndicator(error ? null : data?.selectedChatModel ?? null);
      }
    }

    loadChatModel();

    return () => {
      cancelled = true;
    };
  }, [chatOpen, isRootAdmin]);

  async function formatDocument() {
    if (formattingRef.current) return;

    formattingRef.current = true;
    onStatus("Formatting with Owl Alpha...");
    const progressPosition = getEditorPopupPosition(editor, 280, 110);
    setFormatProgress({ message: "Collecting notes", ...progressPosition });

    try {
      const liveBlocks = editor.document;
      let markdown = (await editor.blocksToMarkdownLossy(liveBlocks)).trim();

      if (!markdown && currentBlocks?.length) {
        markdown = (await editor.blocksToMarkdownLossy(currentBlocks)).trim();
      }

      const plainText = blocksToPlainText(liveBlocks).trim() || blocksToPlainText(currentBlocks ?? []).trim();
      const input = markdown || plainText;

      if (!input) {
        setFormatProgress(null);
        onStatus("Add notes before formatting.");
        return;
      }

      setFormatProgress({ message: "Connecting to Owl Alpha", ...progressPosition });

      const formatPayload = {
        text: input,
        content: input,
        blocks: liveBlocks,
        workspaceId,
        pageId,
      };

      setFormatProgress({ message: "Sending message", ...progressPosition });
      const { data, error } = await supabase.functions.invoke("format-notes", { body: formatPayload });

      setFormatProgress({ message: "Message received", ...progressPosition });

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.formatted) {
        throw new Error(data?.error ?? "No formatted output returned.");
      }

      let formattedBlocks: PartialBlock<any, any, any>[];

      try {
        setFormatProgress({ message: "Reading response", ...progressPosition });
        formattedBlocks = await editor.tryParseMarkdownToBlocks(data.formatted);
      } catch (parseError) {
        formattedBlocks = textToBlocks(data.formatted);
      }

      setFormatProgress({ message: "Updating page", ...progressPosition });
      editor.replaceBlocks(editor.document, formattedBlocks as any);

      window.requestAnimationFrame(() => {
        onChange(editor.document as any);
      });
      onStatus("Formatted with Owl Alpha.");
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Formatting failed.");
    } finally {
      window.setTimeout(() => {
        formattingRef.current = false;
        setFormatProgress(null);
      }, 450);
    }
  }

  function insertPlainTextBlock(content: string) {
    insertOrUpdateBlock(editor, paragraph(content) as any);
    setDateTimePicker(null);
  }

  function openDateTimePicker(type: "date" | "time") {
    setDateTimePicker({ type, ...getEditorPopupPosition(editor) });
  }

  function requestLectureDictation() {
    if (dictating) {
      stopLectureDictation();
      return;
    }

    if (typeof window !== "undefined" && window.localStorage.getItem(DICTATION_CONSENT_KEY) === "true") {
      startLectureDictation();
      return;
    }

    setDictationConsentOpen(true);
  }

  function confirmLectureDictationConsent() {
    window.localStorage.setItem(DICTATION_CONSENT_KEY, "true");
    setDictationConsentOpen(false);
    startLectureDictation();
  }

  function startLectureDictation() {
    const SpeechRecognitionConstructor =
      typeof window !== "undefined" ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : null;

    if (!SpeechRecognitionConstructor) {
      onStatus("Speech recognition is not supported in this browser.");
      return;
    }

    stopLectureDictation();

    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onstart = () => {
      setDictating(true);
      setDictationText("");
      onStatus("Listening for lecture notes...");
    };

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index]?.[0]?.transcript ?? "";
        if (event.results[index]?.isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      if (finalText.trim()) {
        const text = finalText.trim();
        setDictationText((current) => `${current}${current ? " " : ""}${text}`);
        insertDictatedText(text);
      }

      if (interimText.trim()) {
        onStatus(`Listening... ${interimText.trim()}`);
      }
    };

    recognition.onerror = (event: any) => {
      const message = event?.error === "not-allowed" ? "Microphone access was denied." : "Lecture dictation stopped.";
      onStatus(message);
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
        setDictating(false);
        onStatus("Lecture dictation stopped.");
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopLectureDictation() {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    recognitionRef.current = null;
    recognition.stop();
    setDictating(false);
    onStatus("Lecture dictation stopped.");
  }

  function insertDictatedText(text: string) {
    const blocks = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => paragraph(line));

    if (!blocks.length) return;

    const currentBlock = editor.getTextCursorPosition().block;
    const insertedBlocks = editor.insertBlocks(blocks as any, currentBlock, "after");
    const lastBlock = insertedBlocks.at(-1);

    if (lastBlock) {
      editor.setTextCursorPosition(lastBlock, "end");
    }

    onChange(editor.document as any);
    onStatus("Added dictated notes.");
  }

  async function sendChatMessage() {
    const message = redactChatSecrets(chatInput.trim());
    if (!message || chatLoading) return;

    const nextMessages: ChatMessage[] = [...chatMessages, { role: "user", content: message }];
    setChatMessages(nextMessages);
    setChatInput("");
    setChatLoading(true);
    setChatActivity(["Reading current page and workspace pages"]);
    onStatus("Sending chat message...");

    const controller = new AbortController();
    chatAbortRef.current = controller;

    try {
      const pageContext = (await editor.blocksToMarkdownLossy(editor.document)).trim() || blocksToPlainText(editor.document).trim();
      setChatActivity(["Reading current page and workspace pages", "Writing response"]);
      setChatMessages([...nextMessages, { role: "assistant", content: "" }]);

      const data = await callStreamingChatFunction(
        {
          action: "send",
          stream: true,
          threadId: activeChatThreadId,
          messages: nextMessages.slice(-12),
          pageContext,
          pageId,
          workspaceId,
        },
        controller.signal,
        {
          onActivity: (nextActivity) => setChatActivity(nextActivity),
          onToken: (raw) => {
            const preview = streamingReplyPreview(raw);
            setChatMessages((current) => replaceLastAssistantMessage(current, preview || "Writing response..."));
          },
        }
      );

      if (!data?.reply) {
        throw new Error("No chat response returned.");
      }

      if (data.thread?.id) {
        setActiveChatThreadId(data.thread.id);
      }

      if (data.history?.threads) {
        setChatThreads(data.history.threads);
      }

      if (Array.isArray(data.activity)) {
        setChatActivity(data.activity);
      }

      setChatMessages((current) => replaceLastAssistantMessage(current, data.reply));

      if (typeof data.pageEditMarkdown === "string" && data.pageEditMarkdown.trim()) {
        await applyChatPageEdit(data.pageEditMarkdown);
        onStatus("Chat updated the page.");
      } else {
        onStatus("Chat response received.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setChatMessages((current) => removeEmptyLastAssistantMessage(current));
        onStatus("Chat stopped.");
        return;
      }

      setChatMessages((current) => removeEmptyLastAssistantMessage(current));
      onStatus(error instanceof Error ? error.message : "Chat failed.");
    } finally {
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null;
      }
      setChatLoading(false);
    }
  }

  async function callChatFunction(body: Record<string, unknown>, signal?: AbortSignal) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      throw new Error("Sign in again to use admin chat.");
    }

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/chat-notes`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error ?? "Chat request failed.");
    }

    return data;
  }

  async function callStreamingChatFunction(
    body: Record<string, unknown>,
    signal: AbortSignal,
    handlers: {
      onActivity: (activity: string[]) => void;
      onToken: (raw: string) => void;
    }
  ) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      throw new Error("Sign in again to use admin chat.");
    }

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/chat-notes`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error ?? "Chat request failed.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let raw = "";
    let completeData: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const eventText of events) {
        const event = parseSseEvent(eventText);
        if (!event) continue;

        if (event.name === "activity" && Array.isArray(event.data?.activity)) {
          handlers.onActivity(event.data.activity);
          continue;
        }

        if (event.name === "token" && typeof event.data?.text === "string") {
          raw += event.data.text;
          handlers.onToken(raw);
          continue;
        }

        if (event.name === "complete") {
          completeData = event.data;
          continue;
        }

        if (event.name === "error") {
          throw new Error(event.data?.error ?? "Chat stream failed.");
        }
      }
    }

    if (!completeData) {
      throw new Error("Chat stream ended before completion.");
    }

    return completeData;
  }

  async function createNewChat() {
    try {
      const data = await callChatFunction({ action: "create", workspaceId });
      setActiveChatThreadId(data?.thread?.id ?? null);
      setChatMessages([]);
      setChatActivity([]);
      await loadChatThreads();
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Could not create chat.");
    }
  }

  async function loadChatThread(threadId: string) {
    try {
      const data = await callChatFunction({ action: "load", threadId });
      setActiveChatThreadId(data?.thread?.id ?? threadId);
      setChatMessages((data?.messages ?? []).map((message: any) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      })));
      setChatActivity([]);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Could not load chat.");
    }
  }

  async function deleteChatThread(threadId: string) {
    try {
      const data = await callChatFunction({ action: "delete", threadId, workspaceId });
      setChatThreads(data?.threads ?? []);

      if (threadId === activeChatThreadId) {
        setActiveChatThreadId(null);
        setChatMessages([]);
        setChatActivity([]);
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Could not delete chat.");
    }
  }

  function stopChat() {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setChatLoading(false);
  }

  async function applyChatPageEdit(markdown: string) {
    formattingRef.current = true;

    try {
      let editedBlocks: PartialBlock<any, any, any>[];

      try {
        editedBlocks = await editor.tryParseMarkdownToBlocks(markdown);
      } catch {
        editedBlocks = textToBlocks(markdown);
      }

      editor.replaceBlocks(editor.document, editedBlocks as any);

      window.requestAnimationFrame(() => {
        onChange(editor.document as any);
      });
    } finally {
      window.setTimeout(() => {
        formattingRef.current = false;
      }, 250);
    }
  }

  return (
    <>
      <BlockNoteView
        editor={editor}
        theme={theme}
        onChange={() => {
          if (formattingRef.current) return;
          onChange(editor.document as any);
        }}
        slashMenu={false}
        formattingToolbar
        sideMenu
      >
        <SuggestionMenuController
          triggerCharacter="/"
          floatingOptions={{
            placement: "bottom-start",
            middleware: [
              offset(8),
              flip({
                fallbackPlacements: ["top-start"],
                padding: 10,
              }),
              shift({ padding: 10 }),
              size({
                padding: 10,
                apply({ availableHeight, elements }) {
                  Object.assign(elements.floating.style, {
                    maxHeight: `${Math.max(180, availableHeight)}px`,
                    overflowY: "auto",
                  });
                },
              }),
            ],
          }}
          getItems={async (query) =>
            filterSuggestionItems(
              [
                {
                  title: dictating ? "Stop lecture dictation" : "Lecture dictation",
                  subtext: dictating ? "Stop typing what is heard" : "Use your microphone to type lecture notes",
                  aliases: ["dictation", "speech", "voice", "microphone", "lecture notes", "transcribe"],
                  group: "Capture",
                  icon: <RiMicLine size={18} />,
                  onItemClick: requestLectureDictation,
                },
                {
                  title: "Format notes",
                  subtext: "Clean up this page with OpenRouter Owl Alpha",
                  aliases: ["format", "ai", "clean", "notes"],
                  group: "AI",
                  icon: <RiMagicLine size={18} />,
                  onItemClick: formatDocument,
                },
                ...(isAdmin
                  ? [
                      {
                        title: "Chat",
                        subtext: "Open admin-only AI chat",
                        aliases: ["chat", "ask", "assistant", "ai chat"],
                        group: "AI",
                        icon: <RiChat3Line size={18} />,
                        onItemClick: () => setChatOpen(true),
                      },
                    ]
                  : []),
                ...getStudySlashMenuItems(editor, formatDocument, openDateTimePicker),
                ...getCustomColumnItems(editor),
                ...getDefaultReactSlashMenuItems(editor),
              ],
              query
            )
          }
        />
      </BlockNoteView>

      {dateTimePicker ? (
        <DateTimePickerPopover
          picker={dateTimePicker}
          customTime={customTime}
          setCustomTime={setCustomTime}
          close={() => setDateTimePicker(null)}
          insert={insertPlainTextBlock}
        />
      ) : null}

      {dictationConsentOpen ? (
        <LectureDictationConsent
          close={() => setDictationConsentOpen(false)}
          confirm={confirmLectureDictationConsent}
        />
      ) : null}

      {dictating ? (
        <LectureDictationStatus
          text={dictationText}
          stop={stopLectureDictation}
        />
      ) : null}

      {formatProgress ? <FormatProgressPopover progress={formatProgress} /> : null}

      {chatOpen && isAdmin ? (
        <AdminChatSidebar
          messages={chatMessages}
          threads={chatThreads}
          activeThreadId={activeChatThreadId}
          input={chatInput}
          loading={chatLoading}
          activity={chatActivity}
          showActivity={interfaceSettings.showChatActivity}
          modelIndicator={isRootAdmin ? chatModelIndicator : null}
          setInput={setChatInput}
          newChat={createNewChat}
          selectThread={loadChatThread}
          deleteThread={deleteChatThread}
          historyCollapsed={chatHistoryCollapsed}
          setHistoryCollapsed={setChatHistoryCollapsed}
          close={() => setChatOpen(false)}
          send={sendChatMessage}
          stop={stopChat}
        />
      ) : null}
    </>
  );
}

function getStudySlashMenuItems(
  editor: any,
  formatDocument: () => void,
  openDateTimePicker: (type: "date" | "time") => void
): DefaultReactSuggestionItem[] {
  const insertBlock = (block: PartialBlock<any, any, any>) => insertOrUpdateBlock(editor, block as any);
  const insertBlocks = (blocks: PartialBlock<any, any, any>[]) => replaceCurrentBlock(editor, blocks);

  return [
    {
      title: "Format notes",
      subtext: "Same as the AI format command",
      aliases: ["ai format", "owl", "clean up"],
      group: "AI",
      icon: <RiMagicLine size={18} />,
      onItemClick: formatDocument,
    },
    {
      title: "Summary",
      subtext: "Add a summary section",
      aliases: ["summarize", "overview", "recap"],
      group: "Study",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Summary", 2),
          paragraph(""),
        ]),
    },
    {
      title: "Key idea",
      subtext: "Bordered box for the main takeaway",
      aliases: ["main idea", "takeaway", "important"],
      group: "Study",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () => insertBlock(textBox("Key idea: ")),
    },
    {
      title: "Definition",
      subtext: "Bordered term and definition block",
      aliases: ["term", "vocab", "vocabulary"],
      group: "Study",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () => insertBlock(textBox("Term: \nDefinition: ")),
    },
    {
      title: "Example",
      subtext: "Bordered example block",
      aliases: ["sample", "instance"],
      group: "Study",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () => insertBlock(textBox("Example: ")),
    },
    {
      title: "Question",
      subtext: "Bordered question block",
      aliases: ["ask", "prompt", "confusing"],
      group: "Study",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () => insertBlock(textBox("Question: ")),
    },
    {
      title: "Formula",
      subtext: "Bordered formula block",
      aliases: ["equation", "math"],
      group: "Study",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () => insertBlock(textBox("Formula: ")),
    },
    {
      title: "Warning",
      subtext: "Bordered warning or exception block",
      aliases: ["caution", "exception", "mistake"],
      group: "Study",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () => insertBlock(textBox("Watch out: ")),
    },
    {
      title: "Cornell notes",
      subtext: "Cue, notes, and summary sections",
      aliases: ["cornell", "lecture format"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Cornell Notes", 2),
          heading("Cues", 3),
          bullet(""),
          heading("Notes", 3),
          paragraph(""),
          heading("Summary", 3),
          paragraph(""),
        ]),
    },
    {
      title: "Lecture notes",
      subtext: "Topic, key points, details, and questions",
      aliases: ["class notes", "lecture"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Lecture Notes", 2),
          textBox("Topic: \nDate: "),
          heading("Key points", 3),
          bullet(""),
          heading("Details", 3),
          paragraph(""),
          heading("Questions", 3),
          bullet(""),
        ]),
    },
    {
      title: "Reading notes",
      subtext: "Source, thesis, evidence, and questions",
      aliases: ["book notes", "article notes", "reading"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Reading Notes", 2),
          textBox("Source: \nAuthor: "),
          heading("Main claim", 3),
          paragraph(""),
          heading("Evidence", 3),
          bullet(""),
          heading("Questions", 3),
          bullet(""),
        ]),
    },
    {
      title: "Study guide",
      subtext: "Exam-ready guide structure",
      aliases: ["guide", "review sheet"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Study Guide", 2),
          heading("Must know", 3),
          check(""),
          heading("Key terms", 3),
          bullet(""),
          heading("Practice questions", 3),
          numbered(""),
        ]),
    },
    {
      title: "Exam review",
      subtext: "Review plan for a test",
      aliases: ["test review", "exam prep"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Exam Review", 2),
          textBox("Exam date: \nUnits covered: "),
          heading("High priority", 3),
          check(""),
          heading("Practice", 3),
          check(""),
          heading("Still confusing", 3),
          bullet(""),
        ]),
    },
    {
      title: "Flashcards",
      subtext: "Question and answer card set",
      aliases: ["cards", "quizlet", "qa"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Flashcards", 2),
          textBox("Q: \nA: "),
          textBox("Q: \nA: "),
          textBox("Q: \nA: "),
        ]),
    },
    {
      title: "Quiz",
      subtext: "Practice quiz section",
      aliases: ["practice test", "questions"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Practice Quiz", 2),
          numbered("Question 1"),
          numbered("Question 2"),
          numbered("Question 3"),
          heading("Answer key", 3),
          bullet(""),
        ]),
    },
    {
      title: "Lab report",
      subtext: "Science lab report outline",
      aliases: ["lab", "experiment"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Lab Report", 2),
          heading("Question", 3),
          paragraph(""),
          heading("Hypothesis", 3),
          paragraph(""),
          heading("Materials", 3),
          bullet(""),
          heading("Procedure", 3),
          numbered(""),
          heading("Data", 3),
          paragraph(""),
          heading("Conclusion", 3),
          paragraph(""),
        ]),
    },
    {
      title: "Essay outline",
      subtext: "Intro, body paragraphs, conclusion",
      aliases: ["essay", "outline", "paper"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Essay Outline", 2),
          textBox("Thesis: "),
          heading("Introduction", 3),
          bullet("Hook"),
          bullet("Context"),
          bullet("Thesis"),
          heading("Body paragraph 1", 3),
          bullet("Claim"),
          bullet("Evidence"),
          bullet("Analysis"),
          heading("Conclusion", 3),
          bullet(""),
        ]),
    },
    {
      title: "Project plan",
      subtext: "Goal, tasks, resources, deadlines",
      aliases: ["project", "plan"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Project Plan", 2),
          textBox("Goal: \nDeadline: "),
          heading("Tasks", 3),
          check(""),
          heading("Resources", 3),
          bullet(""),
          heading("Risks", 3),
          bullet(""),
        ]),
    },
    {
      title: "Homework checklist",
      subtext: "Checklist for assignments",
      aliases: ["homework", "todo", "tasks"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Homework", 2),
          check(""),
          check(""),
          check(""),
        ]),
    },
    {
      title: "Daily plan",
      subtext: "Today, priorities, schedule, done",
      aliases: ["day", "agenda", "today"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Daily Plan", 2),
          heading("Top priorities", 3),
          check(""),
          heading("Schedule", 3),
          bullet(""),
          heading("Done", 3),
          check(""),
        ]),
    },
    {
      title: "Weekly review",
      subtext: "Review wins, misses, and next week",
      aliases: ["week", "weekly"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Weekly Review", 2),
          heading("Wins", 3),
          bullet(""),
          heading("Needs work", 3),
          bullet(""),
          heading("Next week", 3),
          check(""),
        ]),
    },
    {
      title: "Meeting notes",
      subtext: "Agenda, notes, action items",
      aliases: ["meeting", "discussion"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Meeting Notes", 2),
          textBox("Date: \nAttendees: "),
          heading("Agenda", 3),
          bullet(""),
          heading("Notes", 3),
          paragraph(""),
          heading("Action items", 3),
          check(""),
        ]),
    },
    {
      title: "Decision log",
      subtext: "Track a decision and why",
      aliases: ["decision", "choice"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Decision Log", 2),
          textBox("Decision: \nDate: "),
          heading("Options", 3),
          bullet(""),
          heading("Reasoning", 3),
          paragraph(""),
          heading("Next step", 3),
          check(""),
        ]),
    },
    {
      title: "Timeline",
      subtext: "Chronological event list",
      aliases: ["history", "dates", "sequence"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Timeline", 2),
          bullet("Date - Event"),
          bullet("Date - Event"),
          bullet("Date - Event"),
        ]),
    },
    {
      title: "Compare and contrast",
      subtext: "Two-side comparison structure",
      aliases: ["compare", "versus", "vs"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Compare and Contrast", 2),
          heading("Item A", 3),
          bullet(""),
          heading("Item B", 3),
          bullet(""),
          heading("Similarities", 3),
          bullet(""),
          heading("Differences", 3),
          bullet(""),
        ]),
    },
    {
      title: "Pros and cons",
      subtext: "Pros, cons, and conclusion",
      aliases: ["pros cons", "tradeoffs"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Pros and Cons", 2),
          heading("Pros", 3),
          bullet(""),
          heading("Cons", 3),
          bullet(""),
          heading("Conclusion", 3),
          paragraph(""),
        ]),
    },
    {
      title: "SWOT analysis",
      subtext: "Strengths, weaknesses, opportunities, threats",
      aliases: ["swot", "analysis"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("SWOT Analysis", 2),
          heading("Strengths", 3),
          bullet(""),
          heading("Weaknesses", 3),
          bullet(""),
          heading("Opportunities", 3),
          bullet(""),
          heading("Threats", 3),
          bullet(""),
        ]),
    },
    {
      title: "Research notes",
      subtext: "Source, quote, paraphrase, citation",
      aliases: ["research", "citation", "source"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Research Notes", 2),
          textBox("Source: \nCitation: "),
          heading("Useful quotes", 3),
          bullet(""),
          heading("Paraphrase", 3),
          paragraph(""),
          heading("How I might use this", 3),
          bullet(""),
        ]),
    },
    {
      title: "Vocabulary list",
      subtext: "Terms and definitions",
      aliases: ["vocab", "terms", "glossary"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Vocabulary", 2),
          textBox("Term: \nDefinition: "),
          textBox("Term: \nDefinition: "),
          textBox("Term: \nDefinition: "),
        ]),
    },
    {
      title: "Mistake log",
      subtext: "Track mistakes and fixes",
      aliases: ["mistakes", "errors", "corrections"],
      group: "Templates",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () =>
        insertBlocks([
          heading("Mistake Log", 2),
          textBox("Mistake: \nWhy it happened: \nFix: "),
          textBox("Mistake: \nWhy it happened: \nFix: "),
        ]),
    },
    {
      title: "Blank page reset",
      subtext: "Replace current page contents with a blank paragraph",
      aliases: ["clear", "blank", "reset page"],
      group: "Utility",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () => editor.replaceBlocks(editor.document, [paragraph("")]),
    },
    {
      title: "Insert divider",
      subtext: "Add a simple visual divider line",
      aliases: ["line", "rule", "separator"],
      group: "Utility",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () => insertBlock(paragraph("---")),
    },
    {
      title: "Timestamp",
      subtext: "Choose a time/date format to insert",
      aliases: ["time", "now", "date time"],
      group: "Utility",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () => openDateTimePicker("time"),
    },
    {
      title: "Date picker",
      subtext: "Pick a date from a calendar and insert it",
      aliases: ["calendar", "pick day", "day"],
      group: "Utility",
      icon: <RiStickyNoteLine size={18} />,
      onItemClick: () => openDateTimePicker("date"),
    },
  ].filter((item) => ["Cornell notes", "Insert divider", "Timestamp", "Date picker"].includes(item.title));
}

function getCustomColumnItems(editor: any): DefaultReactSuggestionItem[] {
  return getMultiColumnSlashMenuItems(editor).map((item, index) => ({
    ...item,
    group: "Layout",
    icon: item.icon ?? <RiLayoutColumnLine size={18} />,
    key: (item as any).key ?? `column-${index}`,
  })) as DefaultReactSuggestionItem[];
}

function parseSseEvent(eventText: string): { name: string; data: any } | null {
  const lines = eventText.split("\n");
  const name = lines.find((line) => line.startsWith("event:"))?.replace(/^event:\s?/, "").trim() || "message";
  const dataText = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s?/, ""))
    .join("\n");

  if (!dataText) return null;

  try {
    return { name, data: JSON.parse(dataText) };
  } catch {
    return null;
  }
}

function replaceLastAssistantMessage(messages: ChatMessage[], content: string): ChatMessage[] {
  if (!messages.length || messages[messages.length - 1].role !== "assistant") {
    return [...messages, { role: "assistant", content }];
  }

  return messages.map((message, index) => (index === messages.length - 1 ? { ...message, content } : message));
}

function removeEmptyLastAssistantMessage(messages: ChatMessage[]): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role === "assistant" && !last.content.trim()) {
    return messages.slice(0, -1);
  }

  return messages;
}

function streamingReplyPreview(raw: string): string {
  const trimmed = stripFence(raw.trim());

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed?.reply === "string") return parsed.reply;
  } catch {
    // Partial JSON is expected while streaming.
  }

  const partialReply = extractPartialJsonString(trimmed, "reply");
  if (partialReply) return partialReply;

  return trimmed.startsWith("{") ? "" : trimmed;
}

function extractPartialJsonString(source: string, key: string): string {
  const keyIndex = source.indexOf(`"${key}"`);
  if (keyIndex === -1) return "";

  const colonIndex = source.indexOf(":", keyIndex);
  if (colonIndex === -1) return "";

  const quoteIndex = source.indexOf('"', colonIndex + 1);
  if (quoteIndex === -1) return "";

  let value = "";
  let escaped = false;

  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      value += `\\${char}`;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') break;
    value += char;
  }

  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
}

function stripFence(value: string): string {
  return value
    .replace(/^```(?:json|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function redactChatSecrets(value: string): string {
  return value
    .replace(/nvapi-[A-Za-z0-9_-]+/g, "<NVIDIA_API_KEY>")
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "<OPENROUTER_API_KEY>")
    .replace(/sk-proj-[A-Za-z0-9_-]+/g, "<OPENAI_API_KEY>")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "<API_KEY>")
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "<SUPABASE_SECRET_KEY>")
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "<JWT>");
}

function replaceCurrentBlock(editor: any, blocks: PartialBlock<any, any, any>[]) {
  const currentBlock = editor.getTextCursorPosition().block;
  editor.replaceBlocks([currentBlock], blocks as any);
}

function heading(content: string, level: 1 | 2 | 3 = 2): PartialBlock<any, any, any> {
  return { type: "heading", props: { level }, content };
}

function paragraph(content: string): PartialBlock<any, any, any> {
  return { type: "paragraph", content };
}

function bullet(content: string): PartialBlock<any, any, any> {
  return { type: "bulletListItem", content };
}

function numbered(content: string): PartialBlock<any, any, any> {
  return { type: "numberedListItem", content };
}

function check(content: string): PartialBlock<any, any, any> {
  return { type: "checkListItem", props: { checked: false }, content };
}

function textBox(content: string): PartialBlock<any, any, any> {
  return paragraph(content.replace(/\n/g, " "));
}

function LectureDictationConsent({
  close,
  confirm,
}: {
  close: () => void;
  confirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[250] grid place-items-center bg-black/20 px-4" onMouseDown={close}>
      <div
        className="w-full max-w-md rounded border border-[var(--line)] bg-[var(--page-bg)] p-4 text-[var(--text)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded bg-[var(--page-chip)] text-[var(--muted)]">
            <RiMicLine size={17} />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Lecture dictation</h2>
            <p className="text-xs text-[var(--muted)]">First-use consent check</p>
          </div>
        </div>

        <p className="text-sm leading-6 text-[var(--text)]">
          This will use your microphone to type what it hears into your notes. Start only if you have permission
          from the people being recorded or transcribed, and if recording is allowed where you are.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded bg-[var(--text)] px-3 py-1.5 text-sm font-medium text-[var(--page-bg)] hover:opacity-90"
          >
            I have consent
          </button>
        </div>
      </div>
    </div>
  );
}

function LectureDictationStatus({
  text,
  stop,
}: {
  text: string;
  stop: () => void;
}) {
  const characterCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="fixed bottom-4 right-4 z-[240] w-72 rounded border border-[var(--line)] bg-[var(--page-bg)] p-3 text-[var(--text)] shadow-xl">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <p className="truncate text-sm font-semibold">Lecture dictation</p>
        </div>
        <button
          type="button"
          onClick={stop}
          className="rounded bg-[var(--text)] px-2 py-1 text-xs font-medium text-[var(--page-bg)] hover:opacity-90"
        >
          Stop
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
        <span>{wordCount} words</span>
        <span>{characterCount} chars</span>
      </div>
    </div>
  );
}

function FormatProgressPopover({ progress }: { progress: Exclude<FormatProgressState, null> }) {
  return (
    <div
      className="fixed z-[260] w-64 rounded border border-[var(--line)] bg-[var(--page-bg)] p-3 text-[var(--text)] shadow-xl"
      style={{ left: progress.left, top: progress.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-3">
        <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded bg-[var(--page-chip)]">
          <RiMagicLine size={16} className="text-[var(--muted)]" />
          <span className="absolute h-8 w-8 animate-ping rounded bg-[var(--selected)]" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{progress.message}</p>
          <div className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)]">
            <span>Formatting</span>
            <span className="format-dot format-dot-one">.</span>
            <span className="format-dot format-dot-two">.</span>
            <span className="format-dot format-dot-three">.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminChatSidebar({
  messages,
  threads,
  activeThreadId,
  input,
  loading,
  activity,
  showActivity,
  modelIndicator,
  setInput,
  newChat,
  selectThread,
  deleteThread,
  historyCollapsed,
  setHistoryCollapsed,
  close,
  send,
  stop,
}: {
  messages: ChatMessage[];
  threads: ChatThread[];
  activeThreadId: string | null;
  input: string;
  loading: boolean;
  activity: string[];
  showActivity: boolean;
  modelIndicator: ChatModelIndicator;
  setInput: (value: string) => void;
  newChat: () => void;
  selectThread: (threadId: string) => void;
  deleteThread: (threadId: string) => void;
  historyCollapsed: boolean;
  setHistoryCollapsed: (collapsed: boolean) => void;
  close: () => void;
  send: () => void;
  stop: () => void;
}) {
  const visibleActivity = showActivity ? activity : [];
  const shouldShowActivityStatus = loading && visibleActivity.length > 0;

  return (
    <aside className="fixed right-0 top-0 z-[280] flex h-screen w-[min(620px,100vw)] border-l border-[var(--line)] bg-[var(--page-bg)] text-[var(--text)] shadow-2xl">
      <div
        className={`hidden shrink-0 flex-col border-r border-[var(--line)] bg-[var(--page-chip)] transition-[width] sm:flex ${
          historyCollapsed ? "w-11" : "w-56"
        }`}
      >
        <div className="border-b border-[var(--line)] px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            {historyCollapsed ? null : <p className="text-xs font-semibold text-[var(--muted)]">Chat history</p>}
            <button
              type="button"
              onClick={() => setHistoryCollapsed(!historyCollapsed)}
              className="grid h-7 w-7 place-items-center rounded border border-[var(--line)] bg-[var(--page-bg)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              title={historyCollapsed ? "Show chat history" : "Collapse chat history"}
            >
              {historyCollapsed ? <RiArrowRightSLine size={16} /> : <RiArrowLeftSLine size={16} />}
            </button>
          </div>
          {historyCollapsed ? null : (
            <button
              type="button"
              onClick={newChat}
              className="w-full rounded border border-[var(--line)] bg-[var(--page-bg)] px-2 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)]"
            >
              New chat
            </button>
          )}
        </div>
        {historyCollapsed ? null : (
          <div className="notion-scrollbar flex-1 space-y-1 overflow-y-auto p-2">
            {threads.length ? (
              threads.map((thread) => (
                <div
                  key={thread.id}
                  className={`group flex items-center gap-1 rounded ${
                    thread.id === activeThreadId
                      ? "bg-[var(--page-bg)] text-[var(--text)] shadow-sm"
                      : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectThread(thread.id)}
                    className="min-w-0 flex-1 truncate px-2 py-2 text-left text-xs"
                    title={thread.title}
                  >
                    {thread.title || "New chat"}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteThread(thread.id);
                    }}
                    className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--faint)] opacity-0 hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 focus:opacity-100"
                    title="Delete chat"
                  >
                    <RiDeleteBinLine size={14} />
                  </button>
                </div>
              ))
            ) : (
              <p className="rounded border border-dashed border-[var(--line)] px-2 py-2 text-xs text-[var(--muted)]">
                No saved chats yet.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">AI chat</p>
            <p className="truncate text-xs text-[var(--muted)]">Admin only</p>
          </div>
          <button
            type="button"
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            title="Close chat"
          >
            <RiCloseLine size={18} />
          </button>
        </div>

        <div className="border-b border-[var(--line)] px-4 py-3 sm:hidden">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[var(--muted)]">Chat history</p>
            <button
              type="button"
              onClick={newChat}
              className="rounded border border-[var(--line)] px-2 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)]"
            >
              New chat
            </button>
          </div>
          <div className="notion-scrollbar flex gap-1 overflow-x-auto">
            {threads.length ? (
              threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => selectThread(thread.id)}
                  className={`max-w-32 shrink-0 truncate rounded px-2 py-1.5 text-left text-xs ${
                    thread.id === activeThreadId
                      ? "bg-[var(--hover)] text-[var(--text)]"
                      : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                  }`}
                  title={thread.title}
                >
                  {thread.title || "New chat"}
                </button>
              ))
            ) : (
              <p className="rounded border border-dashed border-[var(--line)] px-2 py-2 text-xs text-[var(--muted)]">
                No saved chats yet.
              </p>
            )}
          </div>
        </div>

        <div className="notion-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length ? (
            messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`rounded border border-[var(--line)] px-3 py-2 text-sm leading-6 ${
                  message.role === "user" ? "bg-[var(--page-chip)]" : "bg-[var(--page-bg)]"
                }`}
              >
                <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">
                  {message.role === "user" ? "You" : modelIndicator?.label ?? "Owl Alpha"}
                </p>
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
            ))
          ) : (
            <div className="rounded border border-[var(--line)] bg-[var(--page-chip)] px-3 py-2 text-sm text-[var(--muted)]">
              Ask about this page, compare it with other pages, or ask the model to edit the current page.
            </div>
          )}

          {shouldShowActivityStatus ? (
            <div className="flex items-start gap-2 rounded border border-[var(--line)] bg-[var(--page-chip)] px-3 py-2 text-sm text-[var(--muted)]">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text)]" />
              <div className="min-w-0">
                <p className="truncate">
                  {visibleActivity.at(-1)}
                  <span className="format-dot format-dot-one">.</span>
                  <span className="format-dot format-dot-two">.</span>
                  <span className="format-dot format-dot-three">.</span>
                </p>
                <p className="mt-1 truncate text-xs text-[var(--faint)]">{visibleActivity.join(" -> ")}</p>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 rounded border border-[var(--line)] bg-[var(--page-chip)] px-3 py-2 text-sm text-[var(--muted)]">
              <span>Thinking</span>
              <span className="format-dot format-dot-one">.</span>
              <span className="format-dot format-dot-two">.</span>
              <span className="format-dot format-dot-three">.</span>
            </div>
          ) : null}
        </div>

        <div className="border-t border-[var(--line)] p-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="Ask the model..."
            className="min-h-24 w-full resize-none rounded border border-[var(--line)] bg-[var(--page-chip)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--faint)] focus:border-[var(--faint)] focus:bg-[var(--page-bg)]"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              {modelIndicator ? (
                <div className="max-w-44 rounded border border-[var(--line)] bg-[var(--page-chip)] px-2 py-1">
                  <p className="truncate text-[11px] font-medium text-[var(--text)]">{modelIndicator.label}</p>
                  <p className="truncate text-[10px] text-[var(--muted)]">{modelIndicator.model}</p>
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)]">Admin chat</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={stop}
                disabled={!loading}
                className="inline-flex h-8 items-center gap-1 rounded border border-[var(--line)] px-2 text-xs font-medium text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-40"
              >
                <RiStopCircleLine size={15} />
                Stop
              </button>
              <button
                type="button"
                onClick={send}
                disabled={loading || !input.trim()}
                className="inline-flex h-8 items-center gap-1 rounded bg-[var(--text)] px-3 text-xs font-medium text-[var(--page-bg)] hover:opacity-90 disabled:opacity-40"
              >
                <RiSendPlane2Line size={15} />
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function DateTimePickerPopover({
  picker,
  customTime,
  setCustomTime,
  close,
  insert,
}: {
  picker: Exclude<DateTimePickerState, null>;
  customTime: string;
  setCustomTime: (value: string) => void;
  close: () => void;
  insert: (content: string) => void;
}) {
  const now = new Date();
  const timeOptions = [
    ["Short time", now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })],
    ["With seconds", now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })],
    ["Date and time", now.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })],
    ["Long date and time", now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })],
    ["ISO", now.toISOString()],
  ];

  return (
    <div
      className="fixed z-[200] w-64 rounded border border-[var(--line)] bg-[var(--page-bg)] p-3 text-[var(--text)] shadow-xl"
      style={{ left: picker.left, top: picker.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold">{picker.type === "date" ? "Pick date" : "Insert time"}</p>
        <button onClick={close} className="rounded px-1.5 py-0.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)]">
          Close
        </button>
      </div>

      {picker.type === "date" ? (
        <input
          autoFocus
          type="date"
          onChange={(event) => {
            if (!event.target.value) return;
            const date = new Date(`${event.target.value}T00:00:00`);
            insert(date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }));
          }}
          className="h-9 w-full rounded border border-[var(--line)] bg-[var(--page-chip)] px-2 text-sm text-[var(--text)] outline-none"
        />
      ) : (
        <div className="space-y-1">
          {timeOptions.map(([label, value]) => (
            <button
              key={label}
              onClick={() => insert(value)}
              className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--hover)]"
            >
              <span className="block font-medium text-[var(--text)]">{label}</span>
              <span className="block text-[var(--muted)]">{value}</span>
            </button>
          ))}
          <div className="mt-2 flex gap-2 border-t border-[var(--line)] pt-2">
            <input
              type="time"
              value={customTime}
              onChange={(event) => setCustomTime(event.target.value)}
              className="h-8 min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--page-chip)] px-2 text-xs text-[var(--text)] outline-none"
            />
            <button
              onClick={() => customTime && insert(customTime)}
              className="rounded bg-[var(--text)] px-2 text-xs font-medium text-[var(--page-bg)] disabled:opacity-50"
              disabled={!customTime}
            >
              Insert
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function getEditorPopupPosition(editor: any, width = 280, height = 280) {
  const fallback = editor.domElement?.getBoundingClientRect();
  let rect = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0).getBoundingClientRect() : null;

  if (!rect || (rect.width === 0 && rect.height === 0)) {
    rect = fallback ?? null;
  }

  const left = Math.min(Math.max((rect?.left ?? 120), 12), window.innerWidth - width - 12);
  const top = Math.min(Math.max((rect?.bottom ?? 120) + 8, 12), window.innerHeight - height - 12);

  return { left, top };
}

function blocksToPlainText(blocks: Array<Block<any, any, any> | PartialBlock<any, any, any>>): string {
  return blocks
    .map((block) => {
      const content = Array.isArray(block.content)
        ? block.content
            .map((item: any) => {
              if (typeof item === "string") return item;
              if (item?.type === "hardBreak") return "\n";
              return item?.text ?? item?.content ?? "";
            })
            .join("")
        : typeof block.content === "string"
          ? block.content
          : "";

      const children = Array.isArray(block.children) ? blocksToPlainText(block.children as Block[]) : "";
      return [content, children].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n");
}
