import type { PartialBlock } from "@blocknote/core";

export interface PageTemplate {
  id: string;
  name: string;
  description: string;
  title: string;
  blocks: PartialBlock<any, any, any>[];
  source: "built-in" | "user";
}

const USER_TEMPLATE_KEY = "studyyy-user-page-templates";

export const emptyPageTemplate: PageTemplate = {
  id: "empty",
  name: "Empty page",
  description: "Start with a blank page.",
  title: "Untitled",
  blocks: [],
  source: "built-in",
};

export const builtInPageTemplates: PageTemplate[] = [
  {
    id: "cornell-notes",
    name: "Cornell notes",
    description: "Cues, notes, and summary sections.",
    title: "Cornell Notes",
    blocks: [heading("Cornell Notes", 2), heading("Cues", 3), bullet(""), heading("Notes", 3), paragraph(""), heading("Summary", 3), paragraph("")],
    source: "built-in",
  },
  {
    id: "lecture-notes",
    name: "Lecture notes",
    description: "Topic, key points, details, and questions.",
    title: "Lecture Notes",
    blocks: [heading("Lecture Notes", 2), textBox("Topic: \nDate: "), heading("Key points", 3), bullet(""), heading("Details", 3), paragraph(""), heading("Questions", 3), bullet("")],
    source: "built-in",
  },
  {
    id: "reading-notes",
    name: "Reading notes",
    description: "Source, claim, evidence, and questions.",
    title: "Reading Notes",
    blocks: [heading("Reading Notes", 2), textBox("Source: \nAuthor: "), heading("Main claim", 3), paragraph(""), heading("Evidence", 3), bullet(""), heading("Questions", 3), bullet("")],
    source: "built-in",
  },
  {
    id: "study-guide",
    name: "Study guide",
    description: "Must know, key terms, and practice questions.",
    title: "Study Guide",
    blocks: [heading("Study Guide", 2), heading("Must know", 3), check(""), heading("Key terms", 3), bullet(""), heading("Practice questions", 3), numbered("")],
    source: "built-in",
  },
  {
    id: "exam-review",
    name: "Exam review",
    description: "Exam date, priorities, practice, confusing topics.",
    title: "Exam Review",
    blocks: [heading("Exam Review", 2), textBox("Exam date: \nUnits covered: "), heading("High priority", 3), check(""), heading("Practice", 3), check(""), heading("Still confusing", 3), bullet("")],
    source: "built-in",
  },
  {
    id: "flashcards",
    name: "Flashcards",
    description: "Question and answer cards.",
    title: "Flashcards",
    blocks: [heading("Flashcards", 2), textBox("Q: \nA: "), textBox("Q: \nA: "), textBox("Q: \nA: ")],
    source: "built-in",
  },
  {
    id: "essay-outline",
    name: "Essay outline",
    description: "Thesis, intro, body, conclusion.",
    title: "Essay Outline",
    blocks: [heading("Essay Outline", 2), textBox("Thesis: "), heading("Introduction", 3), bullet("Hook"), bullet("Context"), bullet("Thesis"), heading("Body paragraph 1", 3), bullet("Claim"), bullet("Evidence"), bullet("Analysis"), heading("Conclusion", 3), bullet("")],
    source: "built-in",
  },
  {
    id: "project-plan",
    name: "Project plan",
    description: "Goal, tasks, resources, and risks.",
    title: "Project Plan",
    blocks: [heading("Project Plan", 2), textBox("Goal: \nDeadline: "), heading("Tasks", 3), check(""), heading("Resources", 3), bullet(""), heading("Risks", 3), bullet("")],
    source: "built-in",
  },
  {
    id: "lab-report",
    name: "Lab report",
    description: "Question, hypothesis, procedure, data, conclusion.",
    title: "Lab Report",
    blocks: [heading("Lab Report", 2), heading("Question", 3), paragraph(""), heading("Hypothesis", 3), paragraph(""), heading("Materials", 3), bullet(""), heading("Procedure", 3), numbered(""), heading("Data", 3), paragraph(""), heading("Conclusion", 3), paragraph("")],
    source: "built-in",
  },
  {
    id: "daily-plan",
    name: "Daily plan",
    description: "Priorities, schedule, and done list.",
    title: "Daily Plan",
    blocks: [heading("Daily Plan", 2), heading("Top priorities", 3), check(""), heading("Schedule", 3), bullet(""), heading("Done", 3), check("")],
    source: "built-in",
  },
];

export function getUserPageTemplates(): PageTemplate[] {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(USER_TEMPLATE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((template) => ({ ...template, source: "user" as const }));
  } catch {
    return [];
  }
}

export function saveUserPageTemplate(template: Omit<PageTemplate, "id" | "source">) {
  const templates = getUserPageTemplates();
  const nextTemplate: PageTemplate = {
    ...template,
    id: `user-${Date.now()}`,
    source: "user",
  };

  window.localStorage.setItem(USER_TEMPLATE_KEY, JSON.stringify([nextTemplate, ...templates]));
  return nextTemplate;
}

export function cloneTemplateBlocks(template: PageTemplate) {
  return JSON.parse(JSON.stringify(template.blocks ?? []));
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
