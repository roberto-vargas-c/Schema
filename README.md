# Schema

A collaborative online whiteboard for architecture teams, with workspaces and teams. The product name lives in
`src/lib/brand.ts`.

## Features (MVP)

**Canvas**
- Infinite canvas with pan (two-finger scroll, space+drag, hand tool, middle mouse) and zoom (mouse wheel, pinch on trackpads and iPad, zoom controls, fit to content). The wheel button next to the zoom controls switches the scroll wheel between auto, always zoom and always pan
- Sticky notes, rectangles, ellipses, diamonds, free text, frames
- Freehand pen and highlighter with 8 / 4 thicknesses, color swatches, a color wheel and an eyedropper (picks from anywhere on screen in Chrome and Edge, from the board elsewhere). Hold Shift for a straight line
- Drop, paste or upload many files at once: images, animated GIFs (they play on the board), PDFs (one image per page), videos (MP4, WebM, MOV; play in place or full screen) and any other file (a card that downloads it), up to 25 MB each
- Image quality (Original, High 2560 px, Medium 1600 px, Low 1024 px): pick it on selected pictures or PDF pages to make them lighter; new uploads and PDF imports use the same setting
- Images and PDF pages: mirror horizontally or vertically, crop (free or 1:1, 4:3, 16:9, 3:4)
- Transparency for shapes, images, stickers and strokes
- Stickers and emojis: a picker with original sticker packs (Feedback, Status, Celebrate, Studio), emojis, the board's GIFs and a Recent row; click one to get a see-through preview that follows the pointer, then click where it goes (Esc cancels), or drag it onto the board. Sticky notes, text, cards, documents and symbols show the same preview before you place them
- Connectors/arrows that attach to shapes and follow them when moved: straight, curved or angled; solid, dashed or dotted. With the connector tool, hovering a shape shows its connection points
- Select, multi-select (shift-click, marquee), move, resize, rotate (hold Shift for 45° steps), lock, bring to front / send to back
- Align several items (left, center, right, top, middle, bottom) and distribute them evenly
- Colors, fonts (sans, serif, mono, rounded, handwritten, condensed), font sizes, text alignment, inline text editing (double-click)
- Show authors: a board menu option that writes who added each sticky note on it
- The background dot grid stays the same size on screen at any zoom
- Undo/redo, copy/paste, duplicate, delete, arrow-key nudge, keyboard shortcuts for every tool
- Moving a frame moves everything inside it
- Export the board as PNG

**Content blocks**
- Documents: a page on the board that opens in a side editor with a title, headings, bold/italic/underline/strike, links, bulleted, numbered and check lists, quotes, code blocks, dividers and images. Everyone on the board edits it together live; it's saved and versioned with the board, and its card shows the title and a preview
- Task cards with status, assignee (any workspace member) and due date, with an overdue warning
- Tables: double-click a cell to edit, Tab moves to the next cell, add or remove rows and columns, optional header row
- Mind maps (G): Tab adds a branch, Enter adds a sibling; branches are colored and connected automatically
- Diagram shapes: triangle, hexagon, pentagon, parallelogram, trapezoid, database, star, block arrow, chevron, speech bubble, document, cross
- Embeds: paste or add any link to get a preview card; YouTube, Vimeo, Loom, Figma and Keystone 3D models open inline

**Export, import & history**
- Export the board or the selection as PNG (standard or high resolution) or PDF
- Export frames as PDF pages, one per frame, sized 1 board unit = 1 pt, so plans imported from a PDF print at their original paper size and scale
- Paste text from Miro or any other app: each copied sticky note, line or paragraph becomes its own sticky note
- Paste pictures, PDFs, videos and other files copied in Miro: Miro's clipboard only names them, so Schema downloads them through Miro's API after you click **Connect Miro** once (or with an access token you paste). Pictures in HTML copied from web pages and docs come over too
- Import a whole Miro board (board menu → Import from Miro): sticky notes, shapes, text, frames, cards, images, links and connectors keep their positions and colors. It uses Miro's REST API with your connected Miro account, or an access token pasted by hand (used for that import only, not stored)
- Import a CSV (or TSV) as sticky notes, task cards (reads title, status, assignee and due date columns) or a table
- Version history: an automatic snapshot every 10 minutes of editing, named versions, preview any version, restore it (the current board is saved first, and the restore can be undone)

**Collaboration**
- Real-time multi-user editing (Yjs CRDT over WebSockets), saved to Postgres
- Live cursors with names, presence avatars, and highlights of what others have selected
- Comments pinned to the canvas, with replies and resolve
- Board templates: Kanban, Retrospective, Brainstorm, Flowchart

**Architecture tools** (bottom toolbar)
- Import plans: PDFs (every page becomes a locked sheet, rendered in the browser with pdf.js) or images
- Set the scale per plan, either by drawing over a known dimension or, for PDFs, by entering the drawing scale (1:100…); or set one scale for the whole board
- Measure lengths (dimension lines) and areas with perimeter, in m, cm, mm or ft-in; Shift snaps angles to 15°
- Walls drawn as a polyline at 20 cm thickness at plan scale: click each corner, double-click or Enter to finish, click the first corner to close a room. Shift snaps each segment to 15° steps
- Redlining: revision clouds, highlighter, red line and text colors
- Plan symbol library sized to real dimensions: doors, windows, stairs, columns, bathroom and kitchen fixtures, furniture, trees, cars, north arrow, section and level markers

**Plug-ins** (the Plug-ins button in the bottom toolbar; each opens its own panel)
- Tracing paper: select two or more plans and overlay them on the lowest one, at the same real scale when both are scaled. Each layer is drawn as lines in its own color on see-through paper, with an opacity slider, a hide button and a color picker per layer; *Side by side* lays them out again. *Add a tracing sheet* puts a sheet of yellow trace over the selection to sketch on
- Site analysis: find an address (OpenStreetMap's Nominatim) or type `lat, lon`, pick how wide the map is (250 m to 2 km), and one click adds a frame with a north-up site map at its real scale (measure on it straight away), a north arrow, the sun path diagram for the site's latitude (solstices and equinoxes, solar hours) and a table of daylight, noon sun height and sunrise / sunset bearings. The map is stitched in the browser from at most 25 OpenStreetMap tiles and credited on the board
- Bubble diagram: paste a room program (`Name; area`, `Name; count; m² each`, or Keystone's own program file; a line without numbers starts a group) and the rooms become bubbles sized to their area at the board's scale, colored by group. Select bubbles to link them as *must be next to*, *nice to be near* or *keep apart*. *Download program and adjacency* saves the two CSV files Keystone reads (semicolons, `++` / `+` / `-`) to lay out its massing
- Room schedule: select a measured area or a closed wall, name it, and its tag shows the room's area at the plan's scale. *Update tags and schedule* keeps a table of the tagged rooms with their area, the brief from the bubble diagram (same name) and the difference, marking rooms more than 10% over or under
- Material board: swatches (a color or a photo of the sample) with material, finish, supplier and cost per m², from a small library or typed in, coded M01, M02…; tags that place a material on selected parts of a plan or render; and a finishes schedule table with how often each material is tagged
- Crit wall: pin the selected sheets up as a wall in a frame of their own, stamp sheets *Approved*, *Revise* or *Question* with a note, and keep a decision log table (date, sheet, verdict, note, who). A new stamp replaces the sheet's last one; the log keeps them all
- Precedents: clip reference pictures with project, architect, year, source link, photo credit and tags as their caption; list them by tag and arrange them in columns by tag
- A plug-in is a panel in `src/components/board/plugins/`, listed in `registry.ts`; what a plug-in knows about an element is in its `meta` (`src/lib/board/types.ts`), and the shared logic is in `src/lib/board/plugins.ts`

**Facilitation & presenting**
- Shared timer with pause, +1 minute and an alarm
- Voting sessions: set votes per person, optionally hide results until the end, ranked results
- Private mode: new notes stay face-down for everyone else until the facilitator reveals them
- Follow a collaborator's view (click their avatar), or bring everyone to your view
- Emoji reactions that float up on everyone's screen
- Presentation mode: frames become slides in reading order; "present to everyone" makes others follow along

**Accounts & security**
- Email and password, with email confirmation and password reset (a reset signs you out everywhere else)
- Continue with Google
- Single sign-on per workspace with OpenID Connect (Okta, Microsoft Entra ID, Google Workspace, Auth0, OneLogin…), optionally required for everyone at the company's domains
- Company domains verified by DNS TXT record; people who sign up with a verified company email can join the workspace automatically
- Audit log for admins: invites, role changes, teams, boards, sharing, folders, templates, domains and SSO, with filters and CSV export
- Invite emails (through SMTP; printed to the server log when SMTP isn't configured)

**AI assist** (needs an Anthropic API key)
- Group the selected sticky notes by theme: each theme gets its own frame
- Summarize the selection into key points and next steps
- Add idea notes on a topic, without repeating what's already on the board
- Turn a description into a flowchart (start/end, steps, decisions with Yes/No, documents) or a mind map
- Results land on empty space next to your work, and Undo removes them
- Only the text of the items you use is sent to Anthropic. Requests use `claude-opus-5-5` (change with `AI_MODEL`) with server-side fallbacks on, so if a request is declined by a model's safety filters, the API retries it on a fallback model. Each person can make `AI_REQUESTS_PER_HOUR` requests an hour (default 60)

**Workspaces & teams**
- Multiple workspaces per user, with a workspace switcher
- Profile page: change your name and color, add or remove a profile picture (shown in the sidebar, member lists and on boards)
- Install it as an app on phones and tablets (Install app in the sidebar; on iPhone and iPad it shows the Add to Home Screen steps)
- Workspace roles: Owner, Admin, Member, Viewer
- Invite links with a role, pending invite list, revoke
- Teams inside a workspace, with leads and members
- Board visibility: whole workspace, a team only, or private; plus "anyone with the link can view / edit" share links
- Folders to group a workspace's boards by project
- Custom templates: save any board as a template for the whole workspace
- Starred boards, filter by team, search

**Keystone** ([the 3D design companion](https://github.com/roberto-vargas-c/keystone))
- Live 3D models on the board: paste a Keystone embed link (`https://keystone.<subdomain>.workers.dev/embed/<token>`), or pick a project under *3D model from Keystone* in the embed dialog after **Connect Keystone** once. The model opens inline, to turn and zoom, and shows the building as the team changes it
- Send to Schema: in Keystone, the boards' sheets and the project's views go onto a new or existing board, in a frame of their own next to what is there, with a link to the live model. Keystone asks once to connect your Schema account (*Allow* on Schema's `/connect/keystone` page); it can then see the boards you can edit, make boards and add pictures, nothing else
- Profile → Connected apps lists both connections, each with Disconnect
- Set `KEYSTONE_URL` to Keystone's address (on Cloudflare it is in `wrangler.jsonc`), and on Keystone `KEYSTONE_SCHEMA_URL` to Schema's

For apps: `GET /api/apps/boards` (workspaces and the boards one can edit), `POST /api/apps/boards` `{ workspaceId, title }` and
`POST /api/apps/boards/<id>/items` (a form with `title`, `file`… as PNG, JPEG or WebP, and optionally `link` and `linkTitle`) take
`Authorization: Bearer sch_…`, the token an app gets from the code flow in `src/lib/apps.ts`. What an app adds goes through the
board's live room (`server/room.ts` `drop`), so everyone with the board open sees it arrive.

## Stack

| Part | Choice |
| --- | --- |
| Web app | Next.js 16 (App Router, server actions), React 19, TypeScript, Tailwind CSS 4 |
| Canvas | Konva / react-konva |
| Real-time | Yjs + y-protocols; room logic in `server/room.ts`, served by a Durable Object on Cloudflare or a small Node WebSocket server (`server/realtime.ts`) |
| Database | Postgres via Prisma (`pg` driver; Hyperdrive on Cloudflare) |
| Auth | Own session cookie (JWT signed with `AUTH_SECRET`, bcrypt passwords) |

## Run it locally

Requires Node 20+ and Postgres 16 (or Docker).

```bash
docker compose up -d          # or point DATABASE_URL at your own Postgres
cp .env.example .env          # then set AUTH_SECRET: openssl rand -hex 32
npm install                   # also copies the pdf.js worker into public/
npx prisma db push            # create the tables
npm run dev                   # web on :3000, realtime server on :1234
```

Open http://localhost:3000, sign up, and you land in your own workspace.

## How it fits together

```
Browser ──HTTP──▶ Next.js (pages, server actions, /api/*) ──▶ Postgres
   │                         │ mints a short-lived realtime token
   └──WebSocket (y-websocket protocol)──▶ server/realtime.ts ──▶ Postgres (Board.content)
```

- Each board's canvas is one Yjs document (`Board.content`). Elements are JSON objects in the `elements` map; see `src/lib/board/types.ts`.
- The browser asks `/api/boards/:id/realtime-token` for a token that says who it is and whether it may edit. The realtime server verifies it and drops document changes from read-only clients.
- Workspaces, teams, invites, comments and image assets are ordinary Postgres tables (`prisma/schema.prisma`).
- Permission rules are in `src/lib/permissions.ts`.

## Deploying to Cloudflare

Schema runs on Cloudflare Workers: the Next.js app through [OpenNext](https://opennext.js.org/cloudflare), live collaboration in a Durable Object per board (`cloudflare/boardRoom.ts`), and Postgres through Hyperdrive. The GitHub Actions workflow `.github/workflows/deploy-cloudflare.yml` deploys every push to `main` and can also be run by hand from the Actions tab.

**One-time setup**

1. **Cloudflare account on the Workers Paid plan** ($5/month). The app is about 3.5 MB compressed, over the free plan's 3 MB limit.
2. **A Postgres database.** Cloudflare doesn't host Postgres; [Neon](https://neon.tech)'s free tier works. Copy its connection string.
3. **Hyperdrive** (Cloudflare dashboard → Storage & databases → Hyperdrive → Connect database), using that connection string with Neon's connection pooling switched off and caching off. Put its ID in `wrangler.jsonc` under `hyperdrive` (or set a `HYPERDRIVE_ID` secret).
4. **API token** (My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template).
5. **In GitHub** (repository Settings → Secrets and variables → Actions), add:

   | Name | Kind | Value |
   |---|---|---|
   | `CLOUDFLARE_API_TOKEN` | secret | the token from step 4 |
   | `DATABASE_URL` | secret | the Neon connection string (used to update the schema on each deploy) |
   | `ANTHROPIC_API_KEY` | secret, optional | turns on AI assist |
   | `AUTH_SECRET` | secret, optional | signs sessions; without it, the first deploy generates one on the Worker and keeps it |
   | `APP_URL` | variable, optional | the public URL, if not the one in `wrangler.jsonc` (e.g. your own domain) |
   | `CLOUDFLARE_ACCOUNT_ID` | secret, optional | only if the token can reach more than one account |
   | `RESEND_API_KEY` | secret, optional | not needed on Cloudflare: email goes through Cloudflare Email Sending (see below) |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secrets, optional | "Continue with Google" (redirect URI `<APP_URL>/api/auth/oidc/callback`) |
   | `MIRO_CLIENT_ID`, `MIRO_CLIENT_SECRET` | secrets, optional | "Connect Miro" for pasting from and importing Miro boards. Create an app in Miro (profile → Settings → Your apps), tick `boards:read`, and add the redirect URI `<APP_URL>/api/miro/callback`. Without these, people paste a Miro access token by hand |

6. Run **Actions → Deploy to Cloudflare → Run workflow**. A custom domain can be added afterwards under the Worker's Settings → Domains & Routes; set `APP_URL` to match.

**Videos** are stored in an R2 bucket named `schema-media`, which the workflow creates and binds as `MEDIA` (R2 has to be enabled once on the account: dashboard → R2 → enable; free up to 10 GB). Without R2, uploads stay in Postgres and are limited to 25 MB; with it, up to 100 MB.

**Email** goes through Cloudflare Email Sending (included in Workers Paid: 3,000 emails a month, then $0.35 per 1,000). Onboard the sending domain under Email Service → Email Sending, then set `EMAIL_FROM` in `wrangler.jsonc` to an address on it. This deployment sends from `no-reply@schema.robertovargas.dev`.

**Try the Worker locally**: put `AUTH_SECRET` and `APP_URL="http://localhost:8787"` in `.dev.vars`, then `npm run cf:preview`. It uses the local Postgres from `wrangler.jsonc`.

## Deploying on Node hosts

- **Web app**: any Node host (Vercel, Railway, Fly.io, Render). Set `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `NEXT_PUBLIC_REALTIME_URL`.
- **Realtime server**: a long-running Node process (`npm run start:realtime`) on Railway, Fly.io or Render, with the same `DATABASE_URL` and `AUTH_SECRET`. Use `wss://` in `NEXT_PUBLIC_REALTIME_URL`.
- **Database**: managed Postgres (Neon, Supabase, Railway, RDS).
- **AI assist**: set `ANTHROPIC_API_KEY` on the web app. Without it, the AI panel says it isn't set up and everything else works.

## Not yet built

- Board thumbnails
- SAML single sign-on and SCIM user provisioning (SSO uses OpenID Connect, which every major identity provider supports)
- Templates keep image links to the board they came from; deleting that board removes those images
- Automated tests and CI
- Images in object storage: on Cloudflare only videos go to R2 so far; images and everything on Node hosts stay in Postgres
