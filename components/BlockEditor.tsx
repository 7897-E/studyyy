"use client";

import { useRef, useState } from "react";
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
  RiLayoutColumnLine,
  RiMagicLine,
  RiMicLine,
  RiStickyNoteLine,
} from "react-icons/ri";
import {
  getMultiColumnSlashMenuItems,
  locales as multiColumnLocales,
  multiColumnDropCursor,
  withMultiColumn,
} from "@blocknote/xl-multi-column";
import { supabase } from "@/lib/supabase";

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

  return textToBlocks(fallbackText);
}

function textToBlocks(text: string): PartialBlock<any, any, any>[] {
  if (!text.trim()) return emptyDocument;

  return text.split("\n").map((line) => ({
    type: "paragraph",
    content: line,
  }));
}

function removeTextBoxBlocks(
  blocks?: Array<Block<any, any, any> | PartialBlock<any, any, any>>
): PartialBlock<any, any, any>[] {
  const sourceBlocks = blocks?.length ? blocks : emptyDocument;

  return sourceBlocks.flatMap((block: any) => {
    if (block?.type !== "textBox") {
      return [{
        ...block,
        children: Array.isArray(block?.children) ? removeTextBoxBlocks(block.children) : block?.children,
      }];
    }

    const textFromProps = typeof block.props?.text === "string" ? block.props.text : "";
    const textFromContent = inlineContentToText(block.content);
    const existingBlocks = typeof block.props?.blocks === "string" ? block.props.blocks : "";
    const text = textFromProps || textFromContent;

    return parseTextBoxBlocks(existingBlocks, text);
  });
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
  const [dateTimePicker, setDateTimePicker] = useState<DateTimePickerState>(null);
  const [customTime, setCustomTime] = useState("");
  const [dictating, setDictating] = useState(false);
  const [dictationConsentOpen, setDictationConsentOpen] = useState(false);
  const [dictationText, setDictationText] = useState("");
  const recognitionRef = useRef<any>(null);
  const editor = useCreateBlockNote(
    {
      schema: editorSchema,
      dropCursor: multiColumnDropCursor,
      dictionary: {
        ...locales.en,
        multi_column: multiColumnLocales.en,
      },
      initialContent: removeTextBoxBlocks(initialBlocks) as any,
    },
    []
  );

  async function formatDocument() {
    onStatus("Formatting with Owl Alpha...");
    console.groupCollapsed("[studyyy format] Ran format command");
    console.log("Ran format command", {
      pageId,
      workspaceId,
      time: new Date().toISOString(),
    });

    try {
      const liveBlocks = editor.document;
      let markdown = (await editor.blocksToMarkdownLossy(liveBlocks)).trim();

      if (!markdown && currentBlocks?.length) {
        markdown = (await editor.blocksToMarkdownLossy(currentBlocks)).trim();
      }

      const plainText = blocksToPlainText(liveBlocks).trim() || blocksToPlainText(currentBlocks ?? []).trim();
      const input = markdown || plainText;

      if (!input) {
        console.warn("No page content found. Nothing was sent to AI.");
        onStatus("Add notes before formatting.");
        return;
      }

      console.log("Connected to AI", {
        functionName: "format-notes",
        provider: "OpenRouter",
        model: "openrouter/owl-alpha",
      });

      const formatPayload = {
        text: input,
        content: input,
        blocks: liveBlocks,
        workspaceId,
        pageId,
      };

      console.log("Sent message to AI", {
        inputLength: input.length,
        input,
        blockCount: liveBlocks.length,
      });

      const { data, error } = await supabase.functions.invoke("format-notes", { body: formatPayload });

      console.log("Message received from AI", {
        data,
        error,
        formattedLength: typeof data?.formatted === "string" ? data.formatted.length : 0,
        formatted: data?.formatted,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.formatted) {
        throw new Error(data?.error ?? "No formatted output returned.");
      }

      let formattedBlocks: PartialBlock<any, any, any>[];

      try {
        formattedBlocks = await editor.tryParseMarkdownToBlocks(data.formatted);
        console.log("Parsed AI Markdown into BlockNote blocks", {
          formattedBlockCount: formattedBlocks.length,
        });
      } catch (parseError) {
        console.warn("Could not parse AI Markdown. Falling back to plain text blocks.", parseError);
        formattedBlocks = textToBlocks(data.formatted);
      }

      const replacement = editor.replaceBlocks(editor.document, formattedBlocks as any);
      const nextBlocks = replacement.insertedBlocks.length ? replacement.insertedBlocks : editor.document;

      console.log("Applied AI response to editor", {
        insertedBlockCount: replacement.insertedBlocks.length,
        removedBlockCount: replacement.removedBlocks.length,
        nextBlockCount: nextBlocks.length,
      });

      onChange(nextBlocks as any);
      onStatus("Formatted with Owl Alpha.");
    } catch (error) {
      console.error("[studyyy format] Format failed", error);
      onStatus(error instanceof Error ? error.message : "Formatting failed.");
    } finally {
      console.groupEnd();
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

  return (
    <>
      <BlockNoteView
        editor={editor}
        theme={theme}
        onChange={() => onChange(editor.document as any)}
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

function getEditorPopupPosition(editor: any) {
  const fallback = editor.domElement?.getBoundingClientRect();
  let rect = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0).getBoundingClientRect() : null;

  if (!rect || (rect.width === 0 && rect.height === 0)) {
    rect = fallback ?? null;
  }

  const left = Math.min(Math.max((rect?.left ?? 120), 12), window.innerWidth - 280);
  const top = Math.min(Math.max((rect?.bottom ?? 120) + 8, 12), window.innerHeight - 280);

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
