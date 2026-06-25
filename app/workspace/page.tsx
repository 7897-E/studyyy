"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RiMoreLine } from "react-icons/ri";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { supabase } from "@/lib/supabase";
import {
  builtInPageTemplates,
  cloneTemplateBlocks,
  emptyPageTemplate,
  getUserPageTemplates,
  type PageTemplate,
} from "@/lib/pageTemplates";
import { useClasses } from "@/hooks/useClasses";
import { useWorkspace } from "@/hooks/useWorkspace";

interface PageRow {
  id: string;
  title: string;
  class_name: string;
  updated_at: string;
}

type ViewMode = "by-class" | "recent";

const GROUP_COLORS = [
  "#78716c",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

function HomeContent() {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingClass, setCreatingClass] = useState<string | null>(null);
  const [newGroupDraft, setNewGroupDraft] = useState("");
  const [renamePageDraft, setRenamePageDraft] = useState("");
  const [renameGroupDraft, setRenameGroupDraft] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("by-class");
  const [openPageMenu, setOpenPageMenu] = useState<string | null>(null);
  const [openClassMenu, setOpenClassMenu] = useState<string | null>(null);
  const [showNewGroupMenu, setShowNewGroupMenu] = useState(false);
  const [newPageMenuClass, setNewPageMenuClass] = useState<string | null>(null);
  const [userTemplates, setUserTemplates] = useState<PageTemplate[]>([]);
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [dragOverClass, setDragOverClass] = useState<string | null>(null);
  const {
    classes,
    names: classNames,
    addClass,
    deleteClass,
    renameClass,
    updateClassColor,
    tableAvailable,
  } = useClasses(workspace?.id);

  useEffect(() => {
    if (!openPageMenu && !openClassMenu && !showNewGroupMenu && !newPageMenuClass) return;

    function closeMenusOnOutsideClick(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Element && target.closest("[data-menu-root]")) {
        return;
      }

      setOpenPageMenu(null);
      setOpenClassMenu(null);
      setShowNewGroupMenu(false);
      setNewPageMenuClass(null);
    }

    document.addEventListener("pointerdown", closeMenusOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeMenusOnOutsideClick);
  }, [newPageMenuClass, openPageMenu, openClassMenu, showNewGroupMenu]);

  useEffect(() => {
    setUserTemplates(getUserPageTemplates());
  }, []);

  useEffect(() => {
    if (!workspace) return;
    const currentWorkspace = workspace;
    let cancelled = false;

    async function loadPages() {
      setLoading(true);
      let result: any = await supabase
        .from("pages")
        .select("id, title, class_name, updated_at")
        .eq("workspace_id", currentWorkspace.id)
        .order("updated_at", { ascending: false });

      if (result.error && result.error.message.includes("class_name")) {
        const fallback = await supabase
          .from("pages")
          .select("id, title, updated_at")
          .eq("workspace_id", currentWorkspace.id)
          .order("updated_at", { ascending: false });

        result = {
          ...fallback,
          data: fallback.data?.map((page) => ({ ...page, class_name: "Unsorted" })) ?? null,
        };
      }

      if (result.error) console.error(result.error);
      if (!cancelled) {
        setPages(result.data ?? []);
        setLoading(false);
      }
    }

    loadPages();

    const channel = supabase
      .channel(`workspace-home:${workspace.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pages", filter: `workspace_id=eq.${currentWorkspace.id}` },
        loadPages
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [workspace]);

  const groupedPages = useMemo(() => {
    const groups = classNames.reduce<Record<string, PageRow[]>>((acc, className) => {
      acc[className] = [];
      return acc;
    }, {});

    for (const page of pages) {
      const className = page.class_name?.trim() || "Unsorted";
      groups[className] = groups[className] ?? [];
      groups[className].push(page);
    }

    return groups;
  }, [classNames, pages]);

  const recentPages = useMemo(
    () => [...pages].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [pages]
  );

  const classColors = useMemo(() => {
    const colors = new Map<string, string>([["Unsorted", GROUP_COLORS[0]]]);
    for (const classRecord of classes) {
      colors.set(classRecord.name, classRecord.color || GROUP_COLORS[0]);
    }
    return colors;
  }, [classes]);

  async function createPage(className = "Unsorted", template: PageTemplate = emptyPageTemplate) {
    if (!workspace) return;

    setCreatingClass(className);
    setNewPageMenuClass(null);
    const templateBlocks = cloneTemplateBlocks(template);
    const pageTitle = template.title || "Untitled";
    let result = await supabase
      .from("pages")
      .insert({
        workspace_id: workspace.id,
        title: pageTitle,
        class_name: className,
        icon: "Aa",
        content: { blocks: templateBlocks },
      })
      .select("id")
      .single();

    if (result.error && result.error.message.includes("class_name")) {
      result = await supabase
        .from("pages")
        .insert({
            workspace_id: workspace.id,
            title: pageTitle,
            icon: "Aa",
            content: { blocks: templateBlocks },
          })
        .select("id")
        .single();
    }

    if (result.error) console.error(result.error);
    setCreatingClass(null);
    if (result.data?.id) router.push(`/pages/${result.data.id}`);
  }

  async function updateClass(pageId: string, className: string) {
    setPages((current) =>
      current.map((page) => (page.id === pageId ? { ...page, class_name: className || "Unsorted" } : page))
    );

    const { error } = await supabase
      .from("pages")
      .update({ class_name: className.trim() || "Unsorted" })
      .eq("id", pageId);

    if (error) console.error(error);
  }

  async function movePageToClass(pageId: string, className: string) {
    const nextClassName = className.trim() || "Unsorted";
    const previousPage = pages.find((page) => page.id === pageId);

    if (!previousPage || (previousPage.class_name || "Unsorted") === nextClassName) {
      return;
    }

    setPages((current) =>
      current.map((page) => (page.id === pageId ? { ...page, class_name: nextClassName } : page))
    );

    const { error } = await supabase.from("pages").update({ class_name: nextClassName }).eq("id", pageId);

    if (error) {
      console.error(error);
      setPages((current) =>
        current.map((page) => (page.id === pageId ? { ...page, class_name: previousPage.class_name } : page))
      );
    }
  }

  async function renamePage(page: PageRow, nextTitle: string) {
    if (!nextTitle.trim()) return;
    setOpenPageMenu(null);
    setPages((current) => current.map((item) => (item.id === page.id ? { ...item, title: nextTitle.trim() } : item)));
    const { error } = await supabase.from("pages").update({ title: nextTitle.trim() }).eq("id", page.id);
    if (error) console.error(error);
  }

  async function deletePage(page: PageRow) {
    setOpenPageMenu(null);
    setPages((current) => current.filter((item) => item.id !== page.id));
    const { error } = await supabase.from("pages").delete().eq("id", page.id);
    if (error) {
      console.error(error);
      setPages((current) => [page, ...current]);
    }
  }

  async function addGroup(name: string) {
    if (!name.trim()) return;
    await addClass(name.trim());
    setNewGroupDraft("");
    setShowNewGroupMenu(false);
  }

  async function renameGroup(className: string, nextName: string) {
    if (!nextName.trim()) return;
    setOpenClassMenu(null);
    await renameClass(className, nextName.trim());
  }

  async function deleteGroup(className: string) {
    setOpenClassMenu(null);
    await deleteClass(className);
  }

  async function updateGroupColor(className: string, color: string) {
    await updateClassColor(className, color);
  }

  return (
    <section className="mx-auto w-full max-w-[1500px] px-8 py-10">
      <div className="mb-6">
        <div>
          <h1 className="text-4xl font-bold tracking-normal text-[var(--text)]">{workspace?.name}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Study Hub</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-2">
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode("by-class")}
            className={`rounded px-3 py-1.5 text-sm ${viewMode === "by-class" ? "bg-[var(--selected)] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}
          >
            By class
          </button>
          <button
            onClick={() => setViewMode("recent")}
            className={`rounded px-3 py-1.5 text-sm ${viewMode === "recent" ? "bg-[var(--selected)] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}
          >
            Recent
          </button>
        </div>

        {!tableAvailable ? (
          <span className="text-xs text-[var(--muted)]">Run the classes SQL to save class presets.</span>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading pages...</p>
      ) : viewMode === "recent" ? (
        <RecentView
          pages={recentPages}
          classNames={classNames}
          openPageMenu={openPageMenu}
          renamePageDraft={renamePageDraft}
          setOpenPageMenu={setOpenPageMenu}
          setRenamePageDraft={setRenamePageDraft}
          updateClass={updateClass}
          renamePage={renamePage}
          deletePage={deletePage}
        />
      ) : (
        <div className="notion-scrollbar flex gap-4 overflow-x-auto overflow-y-visible pb-80">
          {Object.entries(groupedPages).map(([className, classPages]) => (
            <ClassColumn
              key={className}
              classNameValue={className}
              color={classColors.get(className) ?? GROUP_COLORS[0]}
              pages={classPages}
              creating={creatingClass === className}
              draggingPageId={draggingPageId}
              dragOverClass={dragOverClass}
              openPageMenu={openPageMenu}
              openClassMenu={openClassMenu}
              renamePageDraft={renamePageDraft}
              renameGroupDraft={renameGroupDraft}
              setDraggingPageId={setDraggingPageId}
              setDragOverClass={setDragOverClass}
              setOpenPageMenu={setOpenPageMenu}
              setOpenClassMenu={setOpenClassMenu}
              setShowNewGroupMenu={setShowNewGroupMenu}
              setRenamePageDraft={setRenamePageDraft}
              setRenameGroupDraft={setRenameGroupDraft}
              createPage={createPage}
              newPageMenuClass={newPageMenuClass}
              setNewPageMenuClass={setNewPageMenuClass}
              templates={[emptyPageTemplate, ...builtInPageTemplates, ...userTemplates]}
              movePageToClass={movePageToClass}
              renamePage={renamePage}
              deletePage={deletePage}
              renameGroup={renameGroup}
              deleteGroup={deleteGroup}
              updateGroupColor={updateGroupColor}
            />
          ))}

          <div className="relative min-w-64">
            <button
              data-menu-root
              onClick={() => {
                setOpenPageMenu(null);
                setOpenClassMenu(null);
                setShowNewGroupMenu((open) => !open);
              }}
              className="h-10 w-full rounded border border-dashed border-[var(--line)] px-3 text-left text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            >
              + New group
            </button>
            {showNewGroupMenu ? (
              <InlinePopover>
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addGroup(newGroupDraft);
                  }}
                >
                  <label className="block text-xs font-medium text-[var(--muted)]">Class name</label>
                  <input
                    autoFocus
                    value={newGroupDraft}
                    onChange={(event) => setNewGroupDraft(event.target.value)}
                    className="h-8 w-full rounded border border-[var(--line)] bg-[var(--page-bg)] px-2 text-sm text-[var(--text)] outline-none"
                    placeholder="Chemistry"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewGroupMenu(false)}
                      className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)]"
                    >
                      Cancel
                    </button>
                    <button className="rounded bg-[var(--text)] px-2 py-1 text-xs font-medium text-[var(--page-bg)]">
                      Create
                    </button>
                  </div>
                </form>
              </InlinePopover>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function ClassColumn({
  classNameValue,
  color,
  pages,
  creating,
  draggingPageId,
  dragOverClass,
  openPageMenu,
  openClassMenu,
  renamePageDraft,
  renameGroupDraft,
  setDraggingPageId,
  setDragOverClass,
  setOpenPageMenu,
  setOpenClassMenu,
  setShowNewGroupMenu,
  setRenamePageDraft,
  setRenameGroupDraft,
  createPage,
  newPageMenuClass,
  setNewPageMenuClass,
  templates,
  movePageToClass,
  renamePage,
  deletePage,
  renameGroup,
  deleteGroup,
  updateGroupColor,
}: {
  classNameValue: string;
  color: string;
  pages: PageRow[];
  creating: boolean;
  draggingPageId: string | null;
  dragOverClass: string | null;
  openPageMenu: string | null;
  openClassMenu: string | null;
  renamePageDraft: string;
  renameGroupDraft: string;
  setDraggingPageId: (id: string | null) => void;
  setDragOverClass: (name: string | null) => void;
  setOpenPageMenu: (id: string | null) => void;
  setOpenClassMenu: (name: string | null) => void;
  setShowNewGroupMenu: (open: boolean) => void;
  setRenamePageDraft: (title: string) => void;
  setRenameGroupDraft: (title: string) => void;
  createPage: (className: string, template?: PageTemplate) => void;
  newPageMenuClass: string | null;
  setNewPageMenuClass: (className: string | null) => void;
  templates: PageTemplate[];
  movePageToClass: (pageId: string, className: string) => void;
  renamePage: (page: PageRow, nextTitle: string) => void;
  deletePage: (page: PageRow) => void;
  renameGroup: (className: string, nextName: string) => void;
  deleteGroup: (className: string) => void;
  updateGroupColor: (className: string, color: string) => void;
}) {
  const isDropTarget = dragOverClass === classNameValue && draggingPageId;

  return (
    <section
      onDragOver={(event) => {
        event.preventDefault();
        if (draggingPageId) setDragOverClass(classNameValue);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragOverClass(null);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        const pageId = event.dataTransfer.getData("text/plain") || draggingPageId;
        setDragOverClass(null);
        setDraggingPageId(null);
        if (pageId) movePageToClass(pageId, classNameValue);
      }}
      className={`min-w-72 max-w-72 overflow-visible rounded border bg-[var(--page-chip)] transition-all duration-150 ${
        isDropTarget
          ? "border-[var(--faint)] bg-[var(--selected)] shadow-[inset_0_0_0_1px_var(--faint)]"
          : "border-[var(--line)]"
      }`}
    >
      <div className="h-1 w-full rounded-t" style={{ backgroundColor: color }} />
      <div className="relative flex min-h-10 items-center justify-between border-b border-[var(--line)] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <h2 className="truncate text-sm font-semibold text-[var(--text)]">{classNameValue}</h2>
          <span className="rounded bg-[var(--page-bg)] px-1.5 py-0.5 text-xs text-[var(--muted)]">{pages.length}</span>
        </div>
        <button
          data-menu-root
          onClick={() => {
            setRenameGroupDraft(classNameValue);
            setOpenPageMenu(null);
            setShowNewGroupMenu(false);
            setOpenClassMenu(openClassMenu === classNameValue ? null : classNameValue);
          }}
          className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          title="Class options"
        >
          <RiMoreLine size={16} />
        </button>

        {openClassMenu === classNameValue ? (
          <ActionMenu>
            <form
              className="p-1"
              onSubmit={(event) => {
                event.preventDefault();
                renameGroup(classNameValue, renameGroupDraft || classNameValue);
              }}
            >
              <label className="mb-1 block text-xs text-[var(--muted)]">Rename group</label>
              <input
                value={renameGroupDraft}
                onChange={(event) => setRenameGroupDraft(event.target.value)}
                className="mb-2 h-8 w-full rounded border border-[var(--line)] bg-[var(--page-bg)] px-2 text-xs text-[var(--text)] outline-none"
                placeholder={classNameValue}
              />
              <button className="action-menu-item">Save</button>
            </form>
            {classNameValue !== "Unsorted" ? (
              <>
                <div className="border-t border-[var(--line)] p-1">
                  <p className="mb-1 px-1 text-xs text-[var(--muted)]">Color</p>
                  <div className="grid grid-cols-5 gap-1.5">
                    {GROUP_COLORS.map((groupColor) => (
                      <button
                        key={groupColor}
                        type="button"
                        onClick={() => updateGroupColor(classNameValue, groupColor)}
                        className={`grid h-6 w-6 place-items-center rounded border transition hover:scale-105 ${
                          color === groupColor ? "border-[var(--text)]" : "border-[var(--line)]"
                        }`}
                        title={`Set group color ${groupColor}`}
                      >
                        <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: groupColor }} />
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={() => deleteGroup(classNameValue)} className="action-menu-item text-red-500">
                  Delete group
                </button>
              </>
            ) : null}
          </ActionMenu>
        ) : null}
      </div>

      <div className="min-h-24 space-y-2 overflow-visible p-2">
        {isDropTarget ? (
          <div className="rounded border border-dashed border-[var(--faint)] bg-[var(--page-bg-translucent)] px-3 py-2 text-xs font-medium text-[var(--muted)]">
            Drop here to move into {classNameValue}
          </div>
        ) : null}

        {pages.map((page) => (
          <PageCard
            key={page.id}
            page={page}
            dragging={draggingPageId === page.id}
            openPageMenu={openPageMenu}
            setDraggingPageId={setDraggingPageId}
            setOpenPageMenu={setOpenPageMenu}
            setOpenClassMenu={setOpenClassMenu}
            setShowNewGroupMenu={setShowNewGroupMenu}
            renamePageDraft={renamePageDraft}
            setRenamePageDraft={setRenamePageDraft}
            renamePage={renamePage}
            deletePage={deletePage}
          />
        ))}

        <div className="relative" data-menu-root>
          <button
            onClick={() => setNewPageMenuClass(newPageMenuClass === classNameValue ? null : classNameValue)}
            disabled={creating}
            className="w-full rounded border border-dashed border-[var(--line)] px-2 py-2 text-left text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-50"
          >
            {creating ? "Creating..." : "+ New page"}
          </button>
          {newPageMenuClass === classNameValue ? (
            <TemplateMenu
              templates={templates}
              onSelect={(template) => createPage(classNameValue, template)}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PageCard({
  page,
  dragging,
  openPageMenu,
  renamePageDraft,
  setDraggingPageId,
  setOpenPageMenu,
  setOpenClassMenu,
  setShowNewGroupMenu,
  setRenamePageDraft,
  renamePage,
  deletePage,
}: {
  page: PageRow;
  dragging: boolean;
  openPageMenu: string | null;
  renamePageDraft: string;
  setDraggingPageId: (id: string | null) => void;
  setOpenPageMenu: (id: string | null) => void;
  setOpenClassMenu: (name: string | null) => void;
  setShowNewGroupMenu: (open: boolean) => void;
  setRenamePageDraft: (title: string) => void;
  renamePage: (page: PageRow, nextTitle: string) => void;
  deletePage: (page: PageRow) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", page.id);
        setDragPreview(event, page.title || "Untitled");
        setDraggingPageId(page.id);
      }}
      onDragEnd={() => setDraggingPageId(null)}
      className={`group relative cursor-grab rounded border border-[var(--line)] bg-[var(--page-bg)] p-2 shadow-sm transition-all duration-150 hover:-translate-y-px hover:border-[var(--faint)] hover:shadow-md active:cursor-grabbing ${
        dragging ? "scale-[0.98] border-[var(--faint)] opacity-40 shadow-none" : ""
      } ${openPageMenu === page.id ? "z-50" : "z-0"}`}
    >
      <div className="flex items-start gap-2">
        <div
          aria-hidden="true"
          className="mt-0.5 grid h-5 w-4 shrink-0 grid-cols-2 gap-0.5 rounded px-0.5 py-1 opacity-35 transition-opacity group-hover:opacity-70"
        >
          <span className="h-1 w-1 rounded-full bg-[var(--muted)]" />
          <span className="h-1 w-1 rounded-full bg-[var(--muted)]" />
          <span className="h-1 w-1 rounded-full bg-[var(--muted)]" />
          <span className="h-1 w-1 rounded-full bg-[var(--muted)]" />
        </div>
        <Link href={`/pages/${page.id}`} className="min-w-0 flex-1 text-sm font-medium text-[var(--text)] hover:underline">
          <span className="block truncate">{page.title || "Untitled"}</span>
        </Link>
        <button
          data-menu-root
          onClick={() => {
            setRenamePageDraft(page.title || "Untitled");
            setOpenClassMenu(null);
            setShowNewGroupMenu(false);
            setOpenPageMenu(openPageMenu === page.id ? null : page.id);
          }}
          className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          title="Page options"
        >
          <RiMoreLine size={16} />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-1.5 pl-6 text-xs text-[var(--muted)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--faint)]" />
        <span>Drag between groups</span>
      </div>

      {openPageMenu === page.id ? (
        <ActionMenu>
          <form
            className="p-1"
            onSubmit={(event) => {
              event.preventDefault();
              renamePage(page, renamePageDraft);
            }}
          >
            <label className="mb-1 block text-xs text-[var(--muted)]">Rename</label>
            <input
              value={renamePageDraft}
              onChange={(event) => setRenamePageDraft(event.target.value)}
              className="mb-2 h-8 w-full rounded border border-[var(--line)] bg-[var(--page-bg)] px-2 text-xs text-[var(--text)] outline-none"
            />
            <button className="action-menu-item">Save</button>
          </form>
          <button onClick={() => deletePage(page)} className="action-menu-item text-red-500">
            Delete
          </button>
        </ActionMenu>
      ) : null}
    </div>
  );
}

function setDragPreview(event: React.DragEvent<HTMLElement>, title: string) {
  const preview = document.createElement("div");
  preview.textContent = title;
  preview.className = "drag-preview";
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 18, 18);
  window.setTimeout(() => preview.remove(), 0);
}

function TemplateMenu({
  templates,
  onSelect,
}: {
  templates: PageTemplate[];
  onSelect: (template: PageTemplate) => void;
}) {
  const builtInTemplates = templates.filter((template) => template.source === "built-in");
  const userTemplates = templates.filter((template) => template.source === "user");

  return (
    <div className="absolute left-0 top-11 z-[200] w-72 rounded border border-[var(--line)] bg-[var(--page-bg)] p-2 shadow-xl">
      <p className="mb-2 px-1 text-xs font-semibold text-[var(--text)]">Create from template</p>
      <div className="notion-scrollbar max-h-80 overflow-y-auto pr-1">
        <TemplateSection title="Start" templates={builtInTemplates.filter((template) => template.id === "empty")} onSelect={onSelect} />
        <TemplateSection title="Built-in" templates={builtInTemplates.filter((template) => template.id !== "empty")} onSelect={onSelect} />
        <TemplateSection title="Your templates" templates={userTemplates} onSelect={onSelect} emptyText="Save a page as a template to see it here." />
      </div>
    </div>
  );
}

function TemplateSection({
  title,
  templates,
  onSelect,
  emptyText,
}: {
  title: string;
  templates: PageTemplate[];
  onSelect: (template: PageTemplate) => void;
  emptyText?: string;
}) {
  return (
    <div className="mb-2">
      <p className="mb-1 px-1 text-[11px] font-medium uppercase text-[var(--faint)]">{title}</p>
      {templates.length ? (
        templates.map((template) => (
          <button
            key={template.id}
            onClick={() => onSelect(template)}
            className="mb-1 w-full rounded px-2 py-1.5 text-left hover:bg-[var(--hover)]"
          >
            <span className="block text-xs font-medium text-[var(--text)]">{template.name}</span>
            <span className="block text-[11px] text-[var(--muted)]">{template.description}</span>
          </button>
        ))
      ) : emptyText ? (
        <p className="rounded px-2 py-1.5 text-[11px] text-[var(--muted)]">{emptyText}</p>
      ) : null}
    </div>
  );
}

function RecentView({
  pages,
  classNames,
  openPageMenu,
  renamePageDraft,
  setOpenPageMenu,
  setRenamePageDraft,
  updateClass,
  renamePage,
  deletePage,
}: {
  pages: PageRow[];
  classNames: string[];
  openPageMenu: string | null;
  renamePageDraft: string;
  setOpenPageMenu: (id: string | null) => void;
  setRenamePageDraft: (title: string) => void;
  updateClass: (pageId: string, className: string) => void;
  renamePage: (page: PageRow, nextTitle: string) => void;
  deletePage: (page: PageRow) => void;
}) {
  if (pages.length === 0) {
    return (
      <div className="rounded border border-[var(--line)] bg-[var(--page-chip)] p-6 text-sm text-[var(--muted)]">
        No pages yet. Create one from a class column.
      </div>
    );
  }

  return (
    <div className="overflow-visible rounded border border-[var(--line)]">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-[var(--page-chip)] text-xs uppercase tracking-wide text-[var(--muted)]">
          <tr>
            <th className="border-b border-[var(--line)] px-4 py-3 font-semibold">Page</th>
            <th className="border-b border-[var(--line)] px-4 py-3 font-semibold">Class</th>
            <th className="border-b border-[var(--line)] px-4 py-3 font-semibold">Updated</th>
            <th className="border-b border-[var(--line)] px-4 py-3 font-semibold"></th>
          </tr>
        </thead>
        <tbody>
          {pages.map((page) => (
            <tr key={page.id} className="hover:bg-[var(--hover)]">
              <td className="border-b border-[var(--line)] px-4 py-3">
                <Link href={`/pages/${page.id}`} className="font-medium text-[var(--text)] hover:underline">
                  {page.title || "Untitled"}
                </Link>
              </td>
              <td className="border-b border-[var(--line)] px-4 py-3">
                <select
                  value={page.class_name || "Unsorted"}
                  onChange={(event) => updateClass(page.id, event.target.value)}
                  className="h-8 w-full max-w-xs rounded border border-[var(--line)] bg-[var(--page-bg)] px-2 text-sm text-[var(--text)] outline-none focus:border-[var(--faint)]"
                >
                  {classNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="border-b border-[var(--line)] px-4 py-3 text-[var(--muted)]">
                {new Date(page.updated_at).toLocaleString()}
              </td>
              <td className="relative border-b border-[var(--line)] px-4 py-3 text-right">
                <button
                  data-menu-root
                  onClick={() => {
                    setRenamePageDraft(page.title || "Untitled");
                    setOpenPageMenu(openPageMenu === page.id ? null : page.id);
                  }}
                  className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                  title="Page options"
                >
                  <RiMoreLine size={16} />
                </button>
                {openPageMenu === page.id ? (
                  <ActionMenu>
                    <form
                      className="p-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        renamePage(page, renamePageDraft);
                      }}
                    >
                      <label className="mb-1 block text-xs text-[var(--muted)]">Rename</label>
                      <input
                        value={renamePageDraft}
                        onChange={(event) => setRenamePageDraft(event.target.value)}
                        className="mb-2 h-8 w-full rounded border border-[var(--line)] bg-[var(--page-bg)] px-2 text-xs text-[var(--text)] outline-none"
                      />
                      <button className="action-menu-item">Save</button>
                    </form>
                    <button onClick={() => deletePage(page)} className="action-menu-item text-red-500">
                      Delete
                    </button>
                  </ActionMenu>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActionMenu({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-menu-root
      className="absolute right-2 top-9 z-[100] min-w-44 rounded border border-[var(--line)] bg-[var(--page-bg)] p-1 text-left shadow-lg"
    >
      {children}
    </div>
  );
}

function InlinePopover({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-menu-root
      className="absolute left-0 top-12 z-[100] w-64 rounded border border-[var(--line)] bg-[var(--page-bg)] p-3 shadow-lg"
    >
      {children}
    </div>
  );
}

export default function HomePage() {
  return (
    <WorkspaceShell>
      <HomeContent />
    </WorkspaceShell>
  );
}
