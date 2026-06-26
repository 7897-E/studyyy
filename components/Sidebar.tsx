"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { RiMoonLine, RiShieldUserLine, RiSettings3Line, RiSunLine } from "react-icons/ri";
import { supabase } from "@/lib/supabase";
import {
  builtInPageTemplates,
  cloneTemplateBlocks,
  emptyPageTemplate,
  getUserPageTemplates,
  type PageTemplate,
} from "@/lib/pageTemplates";
import { useTheme } from "@/components/ThemeContext";
import type { Workspace } from "@/hooks/useWorkspace";
import { useAdminStatus } from "@/hooks/useAdminStatus";

interface PageRecord {
  id: string;
  title: string;
  icon: string | null;
}

interface AdminPanelUser {
  id: string;
  email: string;
  createdAt?: string;
  lastSignInAt?: string;
  isAdmin: boolean;
  isRootAdmin: boolean;
}

interface ChatModelOption {
  id: string;
  label: string;
  provider: string;
  model: string;
}

export function Sidebar({ workspace, user }: { workspace: Workspace; user: User }) {
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleteMenuPageId, setDeleteMenuPageId] = useState<string | null>(null);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminPanelUser[]>([]);
  const [chatModelOptions, setChatModelOptions] = useState<ChatModelOption[]>([]);
  const [selectedChatModel, setSelectedChatModel] = useState<ChatModelOption | null>(null);
  const [adminStatus, setAdminStatus] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newPageMenuOpen, setNewPageMenuOpen] = useState(false);
  const [userTemplates, setUserTemplates] = useState<PageTemplate[]>([]);
  const [displayName, setDisplayName] = useState(getUserDisplayName(user));
  const [workspaceName, setWorkspaceName] = useState(workspace.name);
  const [accountStatus, setAccountStatus] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountText, setDeleteAccountText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const {
    theme,
    mode,
    customTheme,
    interfaceSettings,
    setTheme,
    updateCustomTheme,
    resetCustomTheme,
    updateInterfaceSetting,
    resetInterfaceSettings,
  } = useTheme();
  const { isAdmin, isRootAdmin } = useAdminStatus(user);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setDisplayName(getUserDisplayName(user));
  }, [user]);

  useEffect(() => {
    setWorkspaceName(workspace.name);
  }, [workspace.name]);

  useEffect(() => {
    if (!settingsOpen && !adminPanelOpen && !deleteMenuPageId && !newPageMenuOpen) return;

    function closePopupsOnOutsideClick(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Element && target.closest("[data-sidebar-popup]")) {
        return;
      }

      setSettingsOpen(false);
      setAdminPanelOpen(false);
      setDeleteMenuPageId(null);
      setNewPageMenuOpen(false);
    }

    document.addEventListener("pointerdown", closePopupsOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closePopupsOnOutsideClick);
  }, [adminPanelOpen, deleteMenuPageId, newPageMenuOpen, settingsOpen]);

  useEffect(() => {
    setUserTemplates(getUserPageTemplates());
  }, [newPageMenuOpen]);

  useEffect(() => {
    let cancelled = false;

    async function loadPages() {
      const { data, error } = await supabase
        .from("pages")
        .select("id, title, icon")
        .eq("workspace_id", workspace.id)
        .order("updated_at", { ascending: false });

      if (error) console.error(error);
      if (!cancelled) setPages(data ?? []);
    }

    loadPages();

    const channel = supabase
      .channel(`pages:${workspace.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pages", filter: `workspace_id=eq.${workspace.id}` },
        loadPages
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [workspace.id]);

  async function createPage(template: PageTemplate = emptyPageTemplate) {
    setCreating(true);
    setNewPageMenuOpen(false);
    const templateBlocks = cloneTemplateBlocks(template);
    let result = await supabase
      .from("pages")
      .insert({
        workspace_id: workspace.id,
        title: template.title || "Untitled",
        class_name: "Unsorted",
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
            title: template.title || "Untitled",
            icon: "Aa",
            content: { blocks: templateBlocks },
          })
        .select("id")
        .single();
    }

    setCreating(false);

    if (result.error) {
      console.error(result.error);
      return;
    }

    router.push(`/pages/${result.data.id}`);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/auth");
  }

  async function saveAccountSettings() {
    const nextName = displayName.trim();
    const nextWorkspaceName = workspaceName.trim();

    if (!nextName || !nextWorkspaceName) {
      setAccountStatus("Name and workspace name are required.");
      return;
    }

    setSavingAccount(true);
    setAccountStatus("");

    const updateUser = await supabase.auth.updateUser({
      data: {
        full_name: nextName,
        workspace_name: nextWorkspaceName,
      },
    });

    if (updateUser.error) {
      setSavingAccount(false);
      setAccountStatus(updateUser.error.message);
      return;
    }

    const updateWorkspace = await supabase.from("workspaces").update({ name: nextWorkspaceName }).eq("id", workspace.id);

    setSavingAccount(false);
    if (updateWorkspace.error) {
      setAccountStatus(updateWorkspace.error.message);
      return;
    }

    setAccountStatus("Account settings saved.");
  }

  async function deleteAccount() {
    if (deleteAccountText !== "DELETE") {
      setAccountStatus("Type DELETE to confirm account deletion.");
      return;
    }

    setDeletingAccount(true);
    setAccountStatus("");

    const deleteAuthUser = await supabase.functions.invoke("delete-account");

    if (deleteAuthUser.error) {
      const deleteWorkspace = await supabase.from("workspaces").delete().eq("id", workspace.id);

      if (deleteWorkspace.error) {
        setDeletingAccount(false);
        setAccountStatus(deleteWorkspace.error.message);
        return;
      }
    }

    await supabase.auth.signOut();
    router.push("/auth");
  }

  async function deletePage(pageId: string) {
    setDeleteMenuPageId(null);
    setPages((current) => current.filter((page) => page.id !== pageId));
    const { error } = await supabase.from("pages").delete().eq("id", pageId);
    if (error) {
      console.error(error);
      return;
    }

    if (pathname === `/pages/${pageId}`) {
      router.push("/");
    }
  }

  async function openAdminPanel() {
    const nextOpen = !adminPanelOpen;
    setAdminPanelOpen(nextOpen);
    setSettingsOpen(false);

    if (nextOpen) {
      loadAdminPanel();
    }
  }

  async function loadAdminPanel() {
    setAdminLoading(true);
    setAdminStatus("");

    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: { action: "list" },
    });

    setAdminLoading(false);

    if (error) {
      setAdminStatus(error.message);
      return;
    }

    setAdminUsers(data?.users ?? []);
    setChatModelOptions(data?.chatModelOptions ?? []);
    setSelectedChatModel(data?.selectedChatModel ?? null);
  }

  async function updateAdminUser(email: string, action: "grant" | "revoke") {
    setAdminLoading(true);
    setAdminStatus("");

    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: { action, email },
    });

    setAdminLoading(false);

    if (error) {
      setAdminStatus(error.message);
      return;
    }

    setAdminUsers(data?.users ?? []);
    setChatModelOptions(data?.chatModelOptions ?? []);
    setSelectedChatModel(data?.selectedChatModel ?? null);
    setAdminStatus(action === "grant" ? "Admin status granted." : "Admin status revoked.");
  }

  async function updateChatModel(modelId: string) {
    setAdminLoading(true);
    setAdminStatus("");

    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: { action: "set-chat-model", modelId },
    });

    setAdminLoading(false);

    if (error) {
      setAdminStatus(error.message);
      return;
    }

    setAdminUsers(data?.users ?? []);
    setChatModelOptions(data?.chatModelOptions ?? []);
    setSelectedChatModel(data?.selectedChatModel ?? null);
    setAdminStatus("Secret model updated.");
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-[var(--sidebar-width)] flex-col border-r border-[var(--line)] bg-[var(--sidebar-bg)] p-2 text-sm text-[var(--muted)]">
      <Link href="/workspace" className="mb-4 flex h-9 items-center gap-2 rounded px-2 font-semibold text-[var(--text)] hover:bg-[var(--hover)]">
        <span className="grid h-6 w-6 place-items-center rounded bg-[var(--page-chip)] text-xs">S</span>
        <span className="truncate">{workspaceName}</span>
      </Link>

      <div data-sidebar-popup className="relative mb-2">
        <button
          onClick={() => setNewPageMenuOpen((open) => !open)}
          disabled={creating}
          className="min-h-8 w-full rounded px-3 text-left transition hover:bg-[var(--hover)] disabled:opacity-50"
        >
          {creating ? "Creating..." : "+ New page"}
        </button>
        {newPageMenuOpen ? (
          <SidebarTemplateMenu
            templates={[emptyPageTemplate, ...builtInPageTemplates, ...userTemplates]}
            onSelect={createPage}
          />
        ) : null}
      </div>

      <nav className="notion-scrollbar flex-1 overflow-y-auto">
        {pages.map((page) => {
          const href = `/pages/${page.id}`;
          const active = pathname === href;
          return (
            <div
              key={page.id}
              className={`group relative mb-0.5 flex min-h-8 items-center gap-1 rounded px-2 transition hover:bg-[var(--hover)] ${
                active ? "bg-[var(--selected)] text-[var(--text)]" : ""
              }`}
            >
              <Link href={href} className="flex min-w-0 flex-1 items-center gap-2 py-1">
                <span className="text-xs text-[var(--faint)]">{page.icon || "Aa"}</span>
                <span className="truncate">{page.title || "Untitled"}</span>
              </Link>
              <button
                data-sidebar-popup
                onClick={() => setDeleteMenuPageId(deleteMenuPageId === page.id ? null : page.id)}
                className="ml-auto hidden rounded px-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] group-hover:block"
                title="Delete page"
              >
                x
              </button>
              {deleteMenuPageId === page.id ? (
                <div data-sidebar-popup className="absolute right-1 top-8 z-40 w-44 rounded border border-[var(--line)] bg-[var(--page-bg)] p-2 shadow-lg">
                  <p className="mb-2 truncate text-xs text-[var(--muted)]">Delete {page.title || "Untitled"}?</p>
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => setDeleteMenuPageId(null)}
                      className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)]"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deletePage(page.id)}
                      className="rounded px-2 py-1 text-xs font-medium text-red-500 hover:bg-[var(--hover)]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-[var(--line)] pt-3">
        <p className="mb-2 truncate px-2 text-xs">{user.email}</p>
        {isAdmin ? (
          <div data-sidebar-popup className="relative mb-2">
            <button
              onClick={openAdminPanel}
              className="flex min-h-9 w-full items-center justify-center gap-2 rounded border border-[var(--line)] bg-[var(--page-bg)] px-2 font-medium text-[var(--text)] shadow-sm transition hover:bg-[var(--hover)]"
              title="Admin panel"
            >
              <RiShieldUserLine size={16} />
              Admin
            </button>
            {adminPanelOpen ? (
              <AdminPanel
                users={adminUsers}
                loading={adminLoading}
                status={adminStatus}
                isRootAdmin={isRootAdmin}
                chatModelOptions={chatModelOptions}
                selectedChatModel={selectedChatModel}
                refresh={loadAdminPanel}
                updateAdminUser={updateAdminUser}
                updateChatModel={updateChatModel}
              />
            ) : null}
          </div>
        ) : null}
        <div data-sidebar-popup className="relative mb-2">
          <button
            onClick={() => {
              setSettingsOpen((open) => !open);
              setAdminPanelOpen(false);
            }}
            className="flex min-h-9 w-full items-center justify-center gap-2 rounded border border-[var(--line)] bg-[var(--page-bg)] px-2 font-medium text-[var(--text)] shadow-sm transition hover:bg-[var(--hover)]"
            title="Settings"
          >
            <RiSettings3Line size={16} />
            Settings
          </button>
          {settingsOpen ? (
            <div className="notion-scrollbar absolute bottom-11 left-0 z-50 max-h-[calc(100vh-5rem)] w-72 overflow-y-auto rounded border border-[var(--line)] bg-[var(--page-bg)] p-3 text-[var(--text)] shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Theme</p>
                <span className="text-xs text-[var(--muted)]">{mode === "custom" ? "Custom" : theme}</span>
              </div>

              <div className="mb-3 grid grid-cols-3 gap-1 rounded border border-[var(--line)] bg-[var(--page-chip)] p-1">
                <button
                  onClick={() => setTheme("light")}
                  className={`flex h-8 items-center justify-center gap-1 rounded text-xs font-medium ${
                    mode === "light" ? "bg-[var(--page-bg)] text-[var(--text)] shadow-sm" : "text-[var(--muted)] hover:bg-[var(--hover)]"
                  }`}
                >
                  <RiSunLine size={14} />
                  Light
                </button>
                <button
                  onClick={() => setTheme("dark")}
                  className={`flex h-8 items-center justify-center gap-1 rounded text-xs font-medium ${
                    mode === "dark" ? "bg-[var(--page-bg)] text-[var(--text)] shadow-sm" : "text-[var(--muted)] hover:bg-[var(--hover)]"
                  }`}
                >
                  <RiMoonLine size={14} />
                  Dark
                </button>
                <button
                  onClick={() => setTheme("custom")}
                  className={`h-8 rounded text-xs font-medium ${
                    mode === "custom" ? "bg-[var(--page-bg)] text-[var(--text)] shadow-sm" : "text-[var(--muted)] hover:bg-[var(--hover)]"
                  }`}
                >
                  Custom
                </button>
              </div>

              <div className="notion-scrollbar max-h-72 space-y-2 overflow-y-auto pr-1">
                <ThemeColorInput label="Page" value={customTheme.pageBg} onChange={(value) => updateCustomTheme("pageBg", value)} />
                <ThemeColorInput label="Sidebar" value={customTheme.sidebarBg} onChange={(value) => updateCustomTheme("sidebarBg", value)} />
                <ThemeColorInput label="Text" value={customTheme.text} onChange={(value) => updateCustomTheme("text", value)} />
                <ThemeColorInput label="Muted" value={customTheme.muted} onChange={(value) => updateCustomTheme("muted", value)} />
                <ThemeColorInput label="Line" value={customTheme.line} onChange={(value) => updateCustomTheme("line", value)} />
                <ThemeColorInput label="Hover" value={customTheme.hover} onChange={(value) => updateCustomTheme("hover", value)} />
                <ThemeColorInput label="Selected" value={customTheme.selected} onChange={(value) => updateCustomTheme("selected", value)} />
                <ThemeColorInput label="Cards" value={customTheme.pageChip} onChange={(value) => updateCustomTheme("pageChip", value)} />
              </div>

              <button
                onClick={resetCustomTheme}
                className="mt-3 h-8 w-full rounded border border-[var(--line)] text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)]"
              >
                Reset custom colors
              </button>

              <div className="my-3 border-t border-[var(--line)]" />

              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">Interface</p>
                <button
                  onClick={resetInterfaceSettings}
                  className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                >
                  Reset
                </button>
              </div>

              <SettingsSegmentedControl
                label="Text size"
                value={interfaceSettings.fontScale}
                options={[
                  ["small", "Small"],
                  ["normal", "Normal"],
                  ["large", "Large"],
                ]}
                onChange={(value) => updateInterfaceSetting("fontScale", value as "small" | "normal" | "large")}
              />

              <SettingsSegmentedControl
                label="Sidebar"
                value={interfaceSettings.sidebarDensity}
                options={[
                  ["compact", "Compact"],
                  ["comfortable", "Roomy"],
                ]}
                onChange={(value) => updateInterfaceSetting("sidebarDensity", value as "compact" | "comfortable")}
              />

              <label className="mt-2 flex min-h-8 items-center justify-between rounded px-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)]">
                <span>Reduce motion</span>
                <input
                  type="checkbox"
                  checked={interfaceSettings.reduceMotion}
                  onChange={(event) => updateInterfaceSetting("reduceMotion", event.target.checked)}
                  className="h-4 w-4 accent-[var(--text)]"
                />
              </label>

              <label className="mt-2 flex min-h-8 items-center justify-between rounded px-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)]">
                <span>Show AI activity</span>
                <input
                  type="checkbox"
                  checked={interfaceSettings.showChatActivity}
                  onChange={(event) => updateInterfaceSetting("showChatActivity", event.target.checked)}
                  className="h-4 w-4 accent-[var(--text)]"
                />
              </label>

              <div className="my-3 border-t border-[var(--line)]" />

              <div className="mb-2">
                <p className="text-sm font-semibold">Account</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{user.email}</p>
              </div>

              <SettingsTextInput label="Name" value={displayName} onChange={setDisplayName} />
              <SettingsTextInput label="Workspace" value={workspaceName} onChange={setWorkspaceName} />

              <button
                onClick={saveAccountSettings}
                disabled={savingAccount}
                className="mt-2 h-8 w-full rounded bg-[var(--text)] text-xs font-medium text-[var(--page-bg)] hover:opacity-90 disabled:opacity-50"
              >
                {savingAccount ? "Saving..." : "Save account settings"}
              </button>

              {accountStatus ? (
                <p className="mt-2 rounded border border-[var(--line)] bg-[var(--page-chip)] px-2 py-1.5 text-xs text-[var(--muted)]">
                  {accountStatus}
                </p>
              ) : null}

              <div className="mt-3 rounded border border-red-500/30 bg-red-500/5 p-2">
                <button
                  onClick={() => setDeleteAccountOpen((open) => !open)}
                  className="h-8 w-full rounded text-left text-xs font-medium text-red-500 hover:bg-red-500/10"
                >
                  Delete account
                </button>

                {deleteAccountOpen ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-[var(--muted)]">Deletes your workspace data and signs you out.</p>
                    <input
                      value={deleteAccountText}
                      onChange={(event) => setDeleteAccountText(event.target.value)}
                      className="h-8 w-full rounded border border-[var(--line)] bg-[var(--page-bg)] px-2 text-xs text-[var(--text)] outline-none"
                      placeholder="Type DELETE"
                    />
                    <button
                      onClick={deleteAccount}
                      disabled={deletingAccount || deleteAccountText !== "DELETE"}
                      className="h-8 w-full rounded bg-red-500 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
                    >
                      {deletingAccount ? "Deleting..." : "Permanently delete"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <button onClick={signOut} className="min-h-8 w-full rounded px-2 text-left hover:bg-[var(--hover)]">
          Sign out
        </button>
      </div>
    </aside>
  );
}

function getUserDisplayName(user: User) {
  return typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
    ? user.user_metadata.full_name.trim()
    : user.email?.split("@")[0] ?? "";
}

function AdminPanel({
  users,
  loading,
  status,
  isRootAdmin,
  chatModelOptions,
  selectedChatModel,
  refresh,
  updateAdminUser,
  updateChatModel,
}: {
  users: AdminPanelUser[];
  loading: boolean;
  status: string;
  isRootAdmin: boolean;
  chatModelOptions: ChatModelOption[];
  selectedChatModel: ChatModelOption | null;
  refresh: () => void;
  updateAdminUser: (email: string, action: "grant" | "revoke") => void;
  updateChatModel: (modelId: string) => void;
}) {
  return (
    <div className="notion-scrollbar absolute bottom-11 left-0 z-50 max-h-[calc(100vh-5rem)] w-80 overflow-y-auto rounded border border-[var(--line)] bg-[var(--page-bg)] p-3 text-[var(--text)] shadow-xl">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Admin panel</p>
          <p className="text-xs text-[var(--muted)]">Manage admin access</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="h-7 rounded border border-[var(--line)] px-2 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-50"
        >
          {loading ? "Loading" : "Refresh"}
        </button>
      </div>

      {status ? (
        <p className="mb-2 rounded border border-[var(--line)] bg-[var(--page-chip)] px-2 py-1.5 text-xs text-[var(--muted)]">
          {status}
        </p>
      ) : null}

      {isRootAdmin ? (
        <div className="mb-3 rounded border border-[var(--line)] bg-[var(--page-chip)] p-2">
          <p className="text-xs font-semibold text-[var(--text)]">Secret model</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">Root admin only</p>
          <div className="mt-2 space-y-1">
            {chatModelOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => updateChatModel(option.id)}
                disabled={loading || selectedChatModel?.id === option.id}
                className={`w-full rounded border px-2 py-1.5 text-left text-xs transition ${
                  selectedChatModel?.id === option.id
                    ? "border-[var(--text)] bg-[var(--page-bg)] text-[var(--text)]"
                    : "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                } disabled:opacity-70`}
              >
                <span className="block font-medium">{option.label}</span>
                <span className="block truncate text-[11px] opacity-75">{option.model}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        {users.length ? (
          users.map((panelUser) => (
            <div
              key={panelUser.id}
              className="flex items-center gap-2 rounded border border-[var(--line)] bg-[var(--page-chip)] px-2 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-[var(--text)]">{panelUser.email || "No email"}</p>
                <p className="text-[11px] text-[var(--muted)]">
                  {panelUser.isRootAdmin ? "Root admin" : panelUser.isAdmin ? "Admin" : "User"}
                </p>
              </div>
              {panelUser.isRootAdmin ? (
                <span className="rounded border border-[var(--line)] bg-[var(--page-bg)] px-2 py-1 text-[11px] text-[var(--muted)]">
                  Locked
                </span>
              ) : panelUser.isAdmin ? (
                <button
                  type="button"
                  onClick={() => updateAdminUser(panelUser.email, "revoke")}
                  disabled={loading}
                  className="rounded px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                >
                  Revoke
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => updateAdminUser(panelUser.email, "grant")}
                  disabled={loading || !panelUser.email}
                  className="rounded bg-[var(--text)] px-2 py-1 text-xs font-medium text-[var(--page-bg)] hover:opacity-90 disabled:opacity-50"
                >
                  Make admin
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="rounded border border-[var(--line)] bg-[var(--page-chip)] px-2 py-3 text-center text-xs text-[var(--muted)]">
            {loading ? "Loading users..." : "No users found."}
          </p>
        )}
      </div>
    </div>
  );
}

function SettingsSegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mb-2">
      <p className="mb-1 px-1 text-xs text-[var(--muted)]">{label}</p>
      <div className="grid gap-1 rounded border border-[var(--line)] bg-[var(--page-chip)] p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            className={`h-7 rounded text-xs font-medium ${
              value === optionValue
                ? "bg-[var(--page-bg)] text-[var(--text)] shadow-sm"
                : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            }`}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function SidebarTemplateMenu({
  templates,
  onSelect,
}: {
  templates: PageTemplate[];
  onSelect: (template: PageTemplate) => void;
}) {
  const builtInTemplates = templates.filter((template) => template.source === "built-in");
  const userTemplates = templates.filter((template) => template.source === "user");

  return (
    <div className="absolute left-0 top-9 z-50 w-72 rounded border border-[var(--line)] bg-[var(--page-bg)] p-2 text-[var(--text)] shadow-xl">
      <p className="mb-2 px-1 text-xs font-semibold">Create from template</p>
      <div className="notion-scrollbar max-h-80 overflow-y-auto pr-1">
        <SidebarTemplateSection title="Start" templates={builtInTemplates.filter((template) => template.id === "empty")} onSelect={onSelect} />
        <SidebarTemplateSection title="Built-in" templates={builtInTemplates.filter((template) => template.id !== "empty")} onSelect={onSelect} />
        <SidebarTemplateSection title="Your templates" templates={userTemplates} onSelect={onSelect} emptyText="Save a page as a template to see it here." />
      </div>
    </div>
  );
}

function SidebarTemplateSection({
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

function SettingsTextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block px-1 text-xs text-[var(--muted)]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded border border-[var(--line)] bg-[var(--page-chip)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--faint)] focus:bg-[var(--page-bg)]"
      />
    </label>
  );
}

function ThemeColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-8 items-center gap-2 rounded px-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)]">
      <span className="min-w-16 flex-1">{label}</span>
      <span className="font-mono text-[10px] text-[var(--faint)]">{value}</span>
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-6 w-8 cursor-pointer rounded border border-[var(--line)] bg-transparent p-0"
      />
    </label>
  );
}
