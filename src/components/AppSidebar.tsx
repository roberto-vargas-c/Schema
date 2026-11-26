"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  Home, Star, FolderOpen, Folder, Search, ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen,
  Users, UserCog, Settings, ScrollText, LogOut, LayoutDashboard, Menu,
} from "lucide-react";
import { Logo, LogoMark } from "@/components/Logo";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { Avatar } from "@/components/Avatar";
import { InstallButton } from "@/components/InstallButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { logout } from "@/app/actions/auth";
import { toggleStar, toggleFolderStar } from "@/app/actions/workspace";
import type { SidebarData } from "@/lib/sidebar";
import { SIDEBAR_COOKIE } from "@/lib/sidebarCookie";

/** Remembers whether the docked sidebar is open, so the server renders it the same way next time. */
export function rememberSidebar(open: boolean) {
  document.cookie = `${SIDEBAR_COOKIE}=${open ? "open" : "closed"}; path=/; max-age=31536000; samesite=lax`;
}

/** Ctrl/⌘ + \ toggles the sidebar, unless the user is typing. */
export function useSidebarShortcut(toggle: () => void) {
  const ref = useRef(toggle);
  ref.current = toggle;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "\\" || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
}

function StarButton({ starred, onToggle, label }: { starred: boolean; onToggle: () => Promise<void>; label: string }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useState(starred);
  useEffect(() => setOn(starred), [starred]);
  return (
    <button type="button" disabled={pending} title={on ? `Unstar ${label}` : `Star ${label}`} aria-label={on ? `Unstar ${label}` : `Star ${label}`}
      className={`shrink-0 rounded p-1 transition hover:bg-slate-200/70 ${on ? "text-amber-500" : "text-slate-400 opacity-0 focus:opacity-100 group-hover:opacity-100"}`}
      onClick={() => { setOn(!on); start(async () => { await onToggle(); }); }}>
      <Star size={14} fill={on ? "currentColor" : "none"} />
    </button>
  );
}

/** The app's left sidebar: Home, Starred, Projects, Search, your starred boards and projects, and workspace pages. */
export function AppSidebar({ data, currentBoardId, onCollapse, onNavigate }: {
  data: SidebarData;
  currentBoardId?: string;
  /** Shown as the collapse button in the header. */
  onCollapse?: () => void;
  /** Called after a link is followed (closes the drawer on phones and boards). */
  onNavigate?: () => void;
}) {
  const wid = data.workspace.id;
  const pathname = usePathname();
  const params = useSearchParams();
  const onBoards = pathname === `/w/${wid}`;
  const [projectsOpen, setProjectsOpen] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const starredFolders = data.folders.filter((f) => f.starred);
  const hasStarred = starredFolders.length + data.starredBoards.length > 0;

  const row = (active: boolean) =>
    `group flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition ${active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700 hover:bg-slate-100"}`;
  const navLink = (href: string, label: string, Icon: typeof Home, active: boolean) => (
    <Link href={href} className={row(active)} onClick={onNavigate}><Icon size={17} className="shrink-0" /> <span className="truncate">{label}</span></Link>
  );
  const section = (label: string) => (
    <div className="px-2.5 pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-1">
        <Link href={`/w/${wid}`} className="min-w-0 flex-1" onClick={onNavigate}><Logo /></Link>
        {onCollapse && (
          <button type="button" className="btn-ghost p-1.5" onClick={onCollapse} title="Hide sidebar (Ctrl+\)" aria-label="Hide sidebar">
            <PanelLeftClose size={18} />
          </button>
        )}
      </div>
      <div className="mt-4"><WorkspaceSwitcher current={data.workspace} all={data.workspaces} /></div>

      <nav className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="space-y-0.5">
          {navLink(`/w/${wid}`, "Home", Home, onBoards && !params.get("starred") && !params.get("folder") && !params.get("team") && !params.get("q"))}
          {navLink(`/w/${wid}?starred=1`, "Starred", Star, onBoards && !!params.get("starred"))}
          <div className={row(false)} role="button" tabIndex={0} aria-expanded={projectsOpen}
            onClick={() => setProjectsOpen((o) => !o)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setProjectsOpen((o) => !o); } }}>
            <FolderOpen size={17} className="shrink-0" /> <span className="flex-1">Projects</span>
            {projectsOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
          </div>
          {projectsOpen && (
            <div className="ml-4 space-y-0.5 border-l border-slate-200 pl-2">
              {data.folders.length === 0 && (
                <Link href={`/w/${wid}`} onClick={onNavigate} className="block px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700">
                  No projects yet. Use “New folder” on Home to group boards.
                </Link>
              )}
              {data.folders.map((f) => (
                <div key={f.id} className={`${row(onBoards && params.get("folder") === f.id)} py-1 pr-1`}>
                  <Link href={`/w/${wid}?folder=${f.id}`} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2.5">
                    <Folder size={15} className="shrink-0" /> <span className="truncate">{f.name}</span>
                  </Link>
                  <StarButton starred={f.starred} label={f.name} onToggle={() => toggleFolderStar(f.id)} />
                </div>
              ))}
            </div>
          )}
          <form action={`/w/${wid}`} className="relative" onSubmit={() => onNavigate?.()}>
            <Search size={17} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-700" />
            <input ref={searchRef} name="q" defaultValue={onBoards ? params.get("q") ?? "" : ""} placeholder="Search boards"
              className="w-full rounded-lg border border-transparent bg-transparent py-1.5 pl-9 pr-2 text-sm text-slate-700 placeholder:text-current hover:bg-slate-100 focus:border-brand-300 focus:bg-slate-50 focus:outline-none focus:placeholder:text-slate-400" />
          </form>
        </div>

        {section("Starred")}
        {!hasStarred ? (
          <p className="px-2.5 text-xs leading-relaxed text-slate-500">Star boards and projects to keep them here.</p>
        ) : (
          <div className="space-y-0.5">
            {starredFolders.map((f) => (
              <div key={`f-${f.id}`} className={`${row(onBoards && params.get("folder") === f.id)} pr-1`}>
                <Link href={`/w/${wid}?folder=${f.id}`} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2.5">
                  <Folder size={15} className="shrink-0 text-brand-600" /> <span className="truncate">{f.name}</span>
                </Link>
                <StarButton starred label={f.name} onToggle={() => toggleFolderStar(f.id)} />
              </div>
            ))}
            {data.starredBoards.map((b) => (
              <div key={`b-${b.id}`} className={`${row(b.id === currentBoardId)} pr-1`}>
                <Link href={`/board/${b.id}`} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2.5">
                  <LayoutDashboard size={15} className="shrink-0 text-slate-500" /> <span className="truncate">{b.title}</span>
                </Link>
                <StarButton starred label={b.title} onToggle={() => toggleStar(b.id)} />
              </div>
            ))}
          </div>
        )}

        {section("Workspace")}
        <div className="space-y-0.5">
          {navLink(`/w/${wid}/teams`, "Teams", Users, pathname === `/w/${wid}/teams`)}
          {navLink(`/w/${wid}/members`, "Members", UserCog, pathname === `/w/${wid}/members`)}
          {navLink(`/w/${wid}/settings`, "Settings", Settings, pathname === `/w/${wid}/settings`)}
          {data.isAdmin && navLink(`/w/${wid}/audit`, "Audit log", ScrollText, pathname === `/w/${wid}/audit`)}
          <InstallButton className="w-full" />
          <ThemeToggle />
        </div>
      </nav>

      <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3">
        <Link href={`/w/${wid}/profile`} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 hover:bg-slate-50" title="Your profile">
          <Avatar name={data.user.name} color={data.user.color} src={data.user.avatar} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{data.user.name}</div>
            <div className="text-xs text-slate-500">{data.user.role}</div>
          </div>
        </Link>
        <form action={logout}>
          <button className="btn-ghost p-2" title="Log out" aria-label="Log out"><LogOut size={16} /></button>
        </form>
      </div>
    </div>
  );
}

/** A sidebar that slides in over the page (phones, and inside a board). */
export function SidebarDrawer({ data, open, onClose, currentBoardId }: { data: SidebarData; open: boolean; onClose: () => void; currentBoardId?: string }) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);
  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-slate-900/30 transition-opacity ${open ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <aside className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white p-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-2xl transition-[transform,visibility] duration-200 ${open ? "visible translate-x-0" : "invisible -translate-x-full"}`}
        // Keep the board's canvas shortcuts from firing while typing in the sidebar.
        onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        {open && <AppSidebar data={data} currentBoardId={currentBoardId} onCollapse={onClose} onNavigate={onClose} />}
      </aside>
    </div>
  );
}

/** Workspace pages: a sidebar docked on the left on wider screens, and a drawer on phones. */
export function WorkspaceShell({ data, initialOpen, children }: { data: SidebarData; initialOpen: boolean; children: React.ReactNode }) {
  const [docked, setDocked] = useState(initialOpen);
  const [drawer, setDrawer] = useState(false);
  const setDockedAndRemember = (v: boolean) => { setDocked(v); rememberSidebar(v); };
  useSidebarShortcut(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setDockedAndRemember(!docked);
    else setDrawer((o) => !o);
  });
  const openButton = (onClick: () => void, className = "") => (
    <button type="button" className={`btn-ghost p-1.5 ${className}`} onClick={onClick} title="Show sidebar (Ctrl+\)" aria-label="Show sidebar">
      <PanelLeftOpen size={18} />
    </button>
  );
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {/* Phones: a slim top bar with a menu button */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 md:hidden">
        <button type="button" className="btn-ghost p-1.5" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={20} /></button>
        <Link href={`/w/${data.workspace.id}`} className="flex min-w-0 items-center gap-2">
          <LogoMark size={24} /><span className="truncate text-sm font-semibold">{data.workspace.name}</span>
        </Link>
        <Link href={`/w/${data.workspace.id}/profile`} className="ml-auto shrink-0" title="Your profile">
          <Avatar name={data.user.name} color={data.user.color} src={data.user.avatar} size={28} />
        </Link>
      </div>
      <SidebarDrawer data={data} open={drawer} onClose={() => setDrawer(false)} />

      {docked && (
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
          <AppSidebar data={data} onCollapse={() => setDockedAndRemember(false)} />
        </aside>
      )}
      <main className="relative min-w-0 flex-1 p-4 md:p-8">
        {!docked && (
          <div className="mb-4 hidden items-center gap-2 md:flex">
            {openButton(() => setDockedAndRemember(true), "border border-slate-200 bg-white shadow-sm")}
            <LogoMark size={22} />
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

/** The button inside a board that opens the sidebar. */
export function SidebarToggleButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn-ghost p-1.5" onClick={onClick} title="Show sidebar (Ctrl+\)" aria-label="Show sidebar">
      <PanelLeftOpen size={18} />
    </button>
  );
}
