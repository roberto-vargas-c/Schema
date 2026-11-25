import "server-only";
import { NextResponse } from "next/server";
import { db } from "./db";
import { APP_URL } from "./mail";
import { currentUser } from "./session";
import { boardAccessForUser } from "./permissions";
import { KeystoneError } from "./keystoneAuth";

// What a board sends into a Keystone project (Keystone's Apps/SchemaInbox.cs): the caller, the project id and the board it comes
// from, checked here so that Keystone is told only a board the person can see, by its real name and link.

export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function sendContext(pid: string, boardId: string) {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "Sign in" }, { status: 401 }) };
  if (!PROJECT_ID.test(pid)) return { error: NextResponse.json({ error: "Unknown project" }, { status: 404 }) };
  const board = boardId ? await db.board.findUnique({ where: { id: boardId }, select: { id: true, title: true, workspaceId: true, teamId: true, visibility: true, createdById: true } }) : null;
  if (!board || !(await boardAccessForUser(user.id, board)).canView) return { error: NextResponse.json({ error: "Unknown board" }, { status: 404 }) };
  return { user, board, boardUrl: `${APP_URL()}/board/${board.id}` };
}

export function keystoneFailure(x: unknown) {
  if (x instanceof KeystoneError) {
    // an older Keystone lets an app list projects and embed links only
    const msg = x.status === 403 && /may only/i.test(x.message) ? "This Keystone can't take room programs or markup yet. Update Keystone and try again" : x.message;
    return NextResponse.json({ error: msg, needsConnect: x.needsConnect || undefined }, { status: x.status });
  }
  return NextResponse.json({ error: "Couldn't reach Keystone. Try again" }, { status: 502 });
}

/** A page of the project in Keystone: Keystone opens the project from ?project= when the person's account has it. */
export const keystonePage = (pid: string, view: string) => `${(process.env.KEYSTONE_URL ?? "").replace(/\/$/, "")}/app?project=${pid}#/${view}`;
