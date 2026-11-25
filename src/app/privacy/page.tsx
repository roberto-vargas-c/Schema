import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = { title: "Privacy policy · Schema" };

const UPDATED = "25 November 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-full bg-white text-slate-800 dark:bg-slate-950 dark:text-slate-200">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Link href="/"><Logo /></Link>
        <h1 className="mt-8 text-3xl font-semibold">Privacy policy</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated {UPDATED}</p>

        <div className="mt-8 space-y-8 leading-relaxed [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
          <section>
            <p>
              Schema is a collaborative whiteboard for architecture and design studios. This page explains what Schema stores
              about you, why, and who else sees it.
            </p>
          </section>

          <section>
            <h2>What we store</h2>
            <ul>
              <li><strong>Your account:</strong> your name, email address, a color for your cursor, and a profile picture if you add one. If you sign up with a password, only a salted hash of it is kept.</li>
              <li><strong>Your work:</strong> the workspaces, teams, boards and folders you create or join, everything on those boards (notes, shapes, drawings, text, comments, links), and saved board versions.</li>
              <li><strong>Files you upload:</strong> pictures, PDFs and videos you add to boards.</li>
              <li><strong>Invitations:</strong> the email addresses you invite and which workspace or team they are for.</li>
              <li><strong>Workspace activity:</strong> a log of actions such as sign-ins and membership changes, with the IP address they came from, visible to workspace admins.</li>
              <li><strong>Connected apps:</strong> if you connect Miro or Keystone, the access token for that connection, encrypted, so Schema can act for you there. You can disconnect at any time.</li>
            </ul>
          </section>

          <section>
            <h2>Signing in with Google</h2>
            <p>
              If you choose “Continue with Google”, Google shares your basic profile with Schema: your name, email address and
              profile picture, plus an account identifier. Schema uses the name and email to create or find your account, and keeps
              the identifier to recognize you next time. It does not store your Google picture, and it does not get access to your
              Gmail, Drive, contacts or anything else in your Google account.
            </p>
          </section>

          <section>
            <h2>How we use it</h2>
            <p>
              Only to run Schema: to sign you in, show your boards to the people you share them with, show who is on a board,
              and send emails you need, such as invitations, email confirmation and password resets. Schema has no ads and no
              third-party tracking, and does not sell or share your data for marketing.
            </p>
          </section>

          <section>
            <h2>AI assist</h2>
            <p>
              When you use an AI feature on a board, such as summarizing or clustering notes, the content you selected for it, or the
              request you typed, is sent to Anthropic, which runs the Claude model, to produce the result. Nothing is sent to Anthropic unless you use
              one of these features. Anthropic processes it under its{" "}
              <a className="text-brand-600 underline" href="https://www.anthropic.com/legal/commercial-terms" target="_blank" rel="noreferrer">commercial terms</a>.
            </p>
          </section>

          <section>
            <h2>Who else processes it</h2>
            <ul>
              <li><strong>Cloudflare</strong> hosts the app and sends its emails.</li>
              <li><strong>The database host</strong> stores accounts, boards and uploaded files.</li>
              <li><strong>Anthropic</strong>, only for the AI features above.</li>
              <li><strong>Google</strong>, only if you sign in with Google.</li>
            </ul>
          </section>

          <section>
            <h2>Cookies</h2>
            <p>
              Schema sets one cookie to keep you signed in, for up to 30 days, and short-lived ones while you sign in with Google
              or SSO. Your browser also remembers a few preferences, such as dark mode and image quality, on your device only.
            </p>
          </section>

          <section>
            <h2>Keeping and deleting data</h2>
            <p>
              Your data is kept while your account exists. You can delete boards and files at any time.
              Deleting a board removes its content and files. To have your whole account deleted, ask the owner of your workspace, and it will be removed
              along with everything only you own.
            </p>
          </section>

          <section>
            <h2>Changes</h2>
            <p>If this policy changes, the date at the top changes with it.</p>
          </section>
        </div>

        <p className="mt-12 text-sm"><Link href="/login" className="text-brand-600 underline">Back to Schema</Link></p>
      </div>
    </div>
  );
}
