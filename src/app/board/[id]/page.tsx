import type { Viewport } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { boardAndAccess } from "@/lib/boardAccess";
import { BoardApp } from "@/components/board/BoardApp";
import { aiEnabled } from "@/lib/ai";
import { boardAccessForUser } from "@/lib/permissions";
import { loadSidebar } from "@/lib/sidebar";

// The board zooms itself, so keep the phone from zooming the page: otherwise iOS zooms in when a text field
// (like the board title) gets focus and stays zoomed, cropping the top bar.
export const viewport: Viewport = {
  themeColor: "#0d6b5e", viewportFit: "cover",
  width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false,
};

export default async function BoardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ share?: string }> }) {
  const { id } = await params;
  const { share } = await searchParams;
  const r = await boardAndAccess(id, share ?? null);
  if (!r) notFound();
  const { board, user, access } = r;
  if (!access.canView) {
    if (!user) redirect(`/login?next=${encodeURIComponent(`/board/${id}${share ? `?share=${share}` : ""}`)}`);
    notFound();
  }
  const isMember = !!access.role;
  const teams = isMember ? await db.team.findMany({ where: { workspaceId: board.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const members = isMember
    ? (await db.workspaceMember.findMany({ where: { workspaceId: board.workspaceId }, select: { user: { select: { id: true, name: true, color: true } } } }))
        .map((m) => m.user).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const sidebar = user && access.role ? await loadSidebar(board.workspaceId, user, access.role) : null;
  // Starring needs workspace access to the board, not only a share link.
  const canStar = !!user && !!access.role && (await boardAccessForUser(user.id, board)).canView;
  const starred = canStar && !!(await db.boardStar.findUnique({ where: { userId_boardId: { userId: user!.id, boardId: board.id } } }));
  const [folders, creator] = await Promise.all([
    isMember ? db.folder.findMany({ where: { workspaceId: board.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    isMember ? db.user.findUnique({ where: { id: board.createdById }, select: { name: true } }) : null,
  ]);
  return (
    <BoardApp
      boardId={board.id}
      title={board.title}
      workspaceId={isMember ? board.workspaceId : null}
      user={user ? { id: user.id, name: user.name, color: user.color } : null}
      canEdit={access.canEdit}
      canManage={access.canManage}
      shareToken={share ?? null}
      sharing={isMember ? { linkAccess: board.linkAccess, visibility: board.visibility, teamId: board.teamId, shareToken: board.shareToken } : null}
      teams={teams}
      members={members}
      realtimeUrl={process.env.NEXT_PUBLIC_REALTIME_URL || "ws://localhost:1234"}
      ai={aiEnabled()}
      sidebar={sidebar}
      starred={canStar ? starred : null}
      folders={folders}
      details={isMember ? {
        folderId: board.folderId, createdBy: creator?.name ?? null,
        createdAt: board.createdAt.toISOString(), updatedAt: board.updatedAt.toISOString(),
      } : null}
    />
  );
}
