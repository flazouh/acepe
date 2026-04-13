/**
 * Changelog data for the app.
 *
 * When completing a feature, fix, or improvement, add an entry to the TOP
 * of the CHANGELOG array. The version must match tauri.conf.json.
 *
 * Single source of truth: packages/changelog/changelog-data.ts
 * @see repo root CLAUDE.md for the full changelog workflow documentation.
 */

/**
 * Type of change for categorization and icon display.
 */
export type ChangeType = "feature" | "fix" | "improvement" | "breaking";

/**
 * A single change item in a changelog entry.
 */
export interface ChangeItem {
	/** Type of change for icon and color coding */
	type: ChangeType;
	/** Description of the change */
	description: string;
}

/**
 * A changelog entry for a specific version.
 */
export interface ChangelogEntry {
	/** Version number (CalVer format: YYYY.MM.N) - must match tauri.conf.json */
	version: string;
	/** Release date in ISO format (YYYY-MM-DD) */
	date: string;
	/** Optional one-line highlight/summary of the release */
	highlights?: string;
	/** List of changes in this version */
	changes: ChangeItem[];
}

/**
 * Changelog entries, newest first.
 *
 * When adding a new version:
 * 1. Add the entry at the TOP of this array
 * 2. Ensure version matches tauri.conf.json
 * 3. Use the correct change type (feature, fix, improvement, breaking)
 */
export const CHANGELOG: ChangelogEntry[] = [
	{
		version: "2026.4.9",
		date: "2026-04-06",
		highlights:
			"Native image drops now stay scoped to the composer even when the app view is zoomed.",
		changes: [
			{
				type: "fix",
				description:
					"Native file drag hit-testing now uses zoom-aware composer bounds so image drops no longer activate outside the composer.",
			},
		],
	},
	{
		version: "2026.3.33",
		date: "2026-03-29",
		highlights:
			"Claude Code worktree sessions now recover provider-backed history correctly, agent task cards surface the latest tool call inline, and worktree toggle lock states read more clearly.",
		changes: [
			{
				type: "fix",
				description:
					"Claude Code session metadata now persists provider-backed session ID aliases so worktree sessions reload the correct history after restart.",
			},
			{
				type: "fix",
				description:
					"History loading, plan lookup, batch upserts, and cleanup now respect provider session IDs instead of treating provider transcripts as separate sessions.",
			},
			{
				type: "improvement",
				description:
					"Agent task cards now surface the latest tool call inline above the tally strip for faster scanning.",
			},
			{
				type: "improvement",
				description:
					"Worktree toggles now keep the primary control visibly disabled when a global auto-worktree default locks it on.",
			},
			{
				type: "improvement",
				description:
					"Project sidebar metadata now persists custom ordering and icon art, and project names keep their original path casing across cards, selectors, and badges.",
			},
			{
				type: "feature",
				description:
					"Kanban and session lists now expose worktree state more clearly, add faster new-agent entry points, and keep long project groups scrollable without hiding older sessions behind a separate history toggle.",
			},
			{
				type: "improvement",
				description:
					"Question and todo operations now preserve their canonical semantics through ACP projection, shared tool rendering, and provider parsing so agent timelines and permission UI stay aligned.",
			},
			{
				type: "improvement",
				description:
					"Desktop chrome now consolidates release and community links into the sidebar and website header while removing unused kanban footers and stale desktop helper surfaces.",
			},
		],
	},
	{
		version: "2026.3.32",
		date: "2026-03-29",
		highlights:
			"Permission prompts render in a dedicated header, Claude worktree restore is more reliable, and GitHub Releases now drive the macOS download flow.",
		changes: [
			{
				type: "feature",
				description: "Wispr Flow sound effects for voice input and notifications.",
			},
			{
				type: "feature",
				description: "Inline error cards can now open GitHub issue drafts directly.",
			},
			{
				type: "feature",
				description: "Preconnect slash commands now preload agent skills.",
			},
			{
				type: "improvement",
				description: "Permission prompts now render above the agent input in a dedicated header.",
			},
			{
				type: "improvement",
				description: "GitHub star count now appears in website navigation.",
			},
			{
				type: "improvement",
				description: "Landing, pricing, and download pages polished.",
			},
			{
				type: "improvement",
				description: "Social preview image updated to the Acepe working view screenshot.",
			},
			{
				type: "improvement",
				description: "Unused website waitlist and Resend flow removed.",
			},
			{
				type: "fix",
				description: "ACP permission request identity stabilized for more reliable permission targeting.",
			},
			{
				type: "fix",
				description: "Claude worktree sessions and session context restore more reliably after restart.",
			},
			{
				type: "fix",
				description: "Async HTML is preserved during markdown streaming.",
			},
			{
				type: "fix",
				description: "Voice input lifecycle and quiet-input live meter behavior hardened.",
			},
			{
				type: "fix",
				description: "Agent input stream controls and voice start state aligned correctly.",
			},
			{
				type: "fix",
				description: "Claude Code subagent task nesting and session ID mapping restored.",
			},
			{
				type: "fix",
				description: "macOS downloads now bypass the old website proxy for GitHub Releases.",
			},
			{
				type: "fix",
				description: "Footer buttons no longer disappear when branch names are long.",
			},
		],
	},
	{
		version: "2026.3.31",
		date: "2026-03-27",
		changes: [
			{
				type: "fix",
				description: "Mic button tooltip now shows the correct keyboard shortcut.",
			},
		],
	},
	{
		version: "2026.3.30",
		date: "2026-03-27",
		changes: [
			{
				type: "fix",
				description: "Website CI and fixture setup restored for release builds.",
			},
		],
	},
	{
		version: "2026.3.29",
		date: "2026-03-26",
		changes: [
			{
				type: "fix",
				description: "Pierre diff workers now build as ES modules.",
			},
		],
	},
	{
		version: "2026.3.28",
		date: "2026-03-26",
		changes: [
			{
				type: "fix",
				description: "Desktop CI and release pipeline unblocked.",
			},
		],
	},
	{
		version: "2026.3.27",
		date: "2026-03-26",
		changes: [
			{
				type: "fix",
				description:
					"Rust cache invalidation now picks up updated mcp-bridge permissions metadata.",
			},
		],
	},
	{
		version: "2026.3.26",
		date: "2026-03-26",
		highlights:
			"Claude Code sessions now stream richer live tool details, permission prompts map correctly to tool calls, and debug streaming logs open reliably.",
		changes: [
			{
				type: "fix",
				description:
					"Claude Code permission prompts now target the correct live tool call row instead of synthetic IDs, preventing invisible inline approvals for cc-sdk sessions.",
			},
			{
				type: "improvement",
				description:
					"Claude Code Bash tool calls now stream their actual command arguments live instead of showing a generic Bash placeholder while input JSON arrives.",
			},
			{
				type: "fix",
				description:
					"Streaming debug logs are now written for Claude Code sessions and the Open Streaming Log action opens them reliably from session menus and the agent panel.",
			},
			{
				type: "improvement",
				description:
					"Voice press-and-hold now uses the dedicated keyboard hold flow and warms the audio context earlier so start sounds play with less delay.",
			},
			{
				type: "improvement",
				description:
					"The shared input container is now exported from @acepe/ui and reused by desktop input surfaces for a cleaner shared component path.",
			},
			{
				type: "fix",
				description:
					"Worktree toggle state and empty-state worktree flows now log and reflect active worktrees more consistently, including the auto-worktree switch state.",
			},
		],
	},
	{
		version: "2026.3.14",
		date: "2026-03-20",
		highlights: "Rich Cursor tool call details in live sessions and history, settings shortcut in agent panel, and skills page redesign",
		changes: [
			{
				type: "improvement",
				description:
					"Cursor tool calls now show rich arguments (file paths, edit diffs, and more) both in live sessions and when browsing session history — data is enriched from the persisted JSONL store",
			},
			{
				type: "feature",
				description:
					"Quick-access settings button (gear icon) added to the agent panel footer for fast navigation to project settings",
			},
			{
				type: "improvement",
				description:
					"Skills library redesigned with a cleaner panel header toolbar and tighter list typography; split/editor/preview view toggles removed for a simpler layout",
			},
			{
				type: "improvement",
				description:
					"Pasted text chips now show a decoded preview and character count instead of a generic label, with fuller tooltip content when hovering",
			},
			{
				type: "improvement",
				description:
					"Settings page UI polish: tighter spacing, refined surface colors, colored sidebar icons (purple for Agents, green for Worktrees), and smaller section headers",
			},
			{
				type: "fix",
				description:
					"Git panel no longer re-runs initialization logic reactively when opening a PR — initialTarget is now read once via untrack",
			},
		],
	},
	{
		version: "2026.3.12",
		date: "2026-03-19",
		highlights: "PR status card with AI-generated commit messages, setup scripts dialog, in-app notification overlay, and terminal drawer improvements",
		changes: [
			{
				type: "feature",
				description:
					"PR status card in the Git panel shows AI-generated commit messages and PR descriptions with real-time staging and pushing progress",
			},
			{
				type: "feature",
				description:
					"Setup scripts dialog and footer widget for agent initialization with clearer setup states",
			},
			{
				type: "feature",
				description:
					"Terminal drawer now closes automatically when the last tab is closed",
			},
			{
				type: "feature",
				description:
					"Pasted text overlay in agent input provides visual feedback when pasting large content",
			},
			{
				type: "fix",
				description:
					"TurnError is now properly dispatched when a subprocess dies mid-stream, with improved error recovery",
			},
			{
				type: "fix",
				description:
					"Worktree default setting no longer has a race condition on the first message sent",
			},
			{
				type: "fix",
				description:
					"Model selector favorites no longer overlap with the selector dropdown",
			},
			{
				type: "improvement",
				description:
					"ACP client lifecycle and error handling more robust with better subprocess management",
			},
			{
				type: "improvement",
				description:
					"Session scanner and text parsing improved for more reliable history loading",
			},
			{
				type: "improvement",
				description:
					"Notifications now appear as overlay cards inside the main window instead of a separate window, with hover pause and auto-dismiss",
			},
			{
				type: "improvement",
				description:
					"Misc UI polish and cleanup across the app",
			},
		],
	},
	{
		version: "2026.3.11",
		date: "2026-03-15",
		highlights: "Worktree default in Settings, shell env fix for agents and terminal, and clearer PR progress",
		changes: [
			{
				type: "feature",
				description:
					"Settings → Worktrees: new \"Use worktrees by default\" option so new sessions automatically use git worktrees for branch isolation, with setup states (running/failed/complete)",
			},
			{
				type: "improvement",
				description:
					"One-shot PR flow now shows \"Staging…\" and \"Pushing…\" progress during commit and push",
			},
			{
				type: "fix",
				description:
					"Shell environment (PATH, etc.) is now correctly passed to agent and terminal processes when the app is launched from the Dock or Finder",
			},
		],
	},
	{
		version: "2026.3.8",
		date: "2026-03-14",
		highlights: "One-shot PR, session PR badges, archived sessions, and delete tool in the agent panel",
		changes: [
			{
				type: "feature",
				description:
					"One-shot PR: commit, push, and create or open PR in one action from the Git panel (Commit & push and Commit, push & create PR buttons with toasts and Open PR link)",
			},
			{
				type: "feature",
				description:
					"Session list: PR badge on sessions with an open PR — tap to open the Git panel at that PR",
			},
			{
				type: "feature",
				description:
					"Archived sessions: new Settings → Archived sessions section; archive or unarchive from the sidebar session menu",
			},
			{
				type: "feature",
				description:
					"Agent panel: delete-file tool calls now show a dedicated card with Deleting/Deleted state",
			},
			{
				type: "improvement",
				description:
					"Inline plan card: full preview and skill links in the redesigned layout",
			},
			{
				type: "improvement",
				description:
					"Agent panel: worktree and branch moved into a dedicated footer bar",
			},
			{
				type: "improvement",
				description:
					"Execute tool: command details shown when a run is blocked by permissions",
			},
			{
				type: "improvement",
				description:
					"Notifications: window resizes to content; toasts use translucent styling",
			},
			{
				type: "improvement",
				description:
					"Project delete: inline dropdown confirmation instead of a separate dialog",
			},
		],
	},
	{
		version: "2026.3.7",
		date: "2026-03-13",
		highlights:
			"GitHub badges now jump into the Git panel, new chat preferences, and clearer tool activity labels",
		changes: [
			{
				type: "feature",
				description:
					"GitHub PR and commit badges now open the Git panel directly to that pull request or commit",
			},
			{
				type: "feature",
				description:
					"New Chat settings section with toggles for collapsed thinking blocks and inline plan display",
			},
			{
				type: "improvement",
				description:
					"Git panel now opens as an overlay modal with improved panel behavior",
			},
			{
				type: "improvement",
				description:
					"Tool call rows use clearer active and completed labels across the app",
			},
			{
				type: "improvement",
				description:
					"Sessions connect eagerly across the app for faster, more reliable loading",
			},
			{
				type: "fix",
				description:
					"Terminal fullscreen mode now behaves correctly with aligned panel surfaces",
			},
			{
				type: "fix",
				description:
					"Agent visibility toggles in settings no longer double-toggle or drift out of sync",
			},
			{
				type: "fix",
				description:
					"Question prompts stay synced with their matching tool call state in the main app view",
			},
		],
	},
	{
		version: "2026.3.6",
		date: "2026-03-09",
		highlights:
			"Layout config dropdown, settings redesign, and Cursor history improvements",
		changes: [
			{
				type: "feature",
				description:
					"Layout config dropdown — toggle sidebar, tab bar, and single-project mode from the top bar",
			},
			{
				type: "feature",
				description:
					"Focused tab gains scale emphasis and clicking a tab switches to that project",
			},
			{
				type: "feature",
				description:
					"Cursor plan approval — plans now route to an approval prompt before executing",
			},
			{
				type: "improvement",
				description:
					"Settings modal redesigned with cleaner tab layout",
			},
			{
				type: "improvement",
				description:
					"Dropdown menu components consolidated into shared UI package",
			},
			{
				type: "improvement",
				description:
					"Agent panel header simplified with less nesting",
			},
			{
				type: "improvement",
				description:
					"Replaced Mixpanel with Sentry for error tracking and analytics",
			},
			{
				type: "fix",
				description:
					"Cursor: question now links to streaming tool call with plan loading state",
			},
			{
				type: "fix",
				description:
					"Image attachments sent as proper image content blocks instead of base64 text",
			},
			{
				type: "fix",
				description:
					"UI freeze on first message in agent panel reduced",
			},
			{
				type: "fix",
				description:
					"UI freeze on Cursor session reload prevented",
			},
		],
	},
	{
		version: "2026.3.5",
		date: "2026-03-07",
		highlights:
			"Unified input toolbar, refreshed light theme, and panel header redesign",
		changes: [
			{
				type: "feature",
				description:
					"Unified input toolbar — mode, model, checkpoint, worktree, and send button now live inside the input area",
			},
			{
				type: "feature",
				description:
					"Scroll-to-top button in agent panel for quick navigation",
			},
			{
				type: "improvement",
				description:
					"Refreshed light theme with updated brand palette",
			},
			{
				type: "improvement",
				description:
					"Panel headers redesigned with reusable cell-based components and monospace titles",
			},
			{
				type: "improvement",
				description:
					"Changelog modal supports dark and light theme palettes",
			},
			{
				type: "improvement",
				description:
					"Reviewed file count moved next to the review button in modified files header",
			},
			{
				type: "improvement",
				description:
					"Cursor agent migrated to native ACP — faster startup and smaller bundle",
			},
			{
				type: "fix",
				description:
					"Worktree creation now works even with uncommitted changes",
			},
			{
				type: "fix",
				description:
					"OpenCode sessions handle turn errors gracefully instead of crashing",
			},
			{
				type: "fix",
				description:
					"Update shimmer text and download progress normalized correctly",
			},
		],
	},
	{
		version: "2026.3.4",
		date: "2026-03-05",
		highlights:
			"Notion-style settings, git init, and smarter tool call display",
		changes: [
			{
				type: "feature",
				description:
					"Settings redesigned as a Notion-style modal overlay",
			},
			{
				type: "feature",
				description:
					"Click the chat header to scroll the conversation to the top",
			},
			{
				type: "feature",
				description:
					"Git init support — initialize a repo from the branch selector or session list",
			},
			{
				type: "feature",
				description:
					"Tool call spinner appears immediately when the agent invokes a tool",
			},
			{
				type: "improvement",
				description:
					"Review progress persists per file revision across panel toggles",
			},
			{
				type: "improvement",
				description:
					"Review panel uses Phosphor status icons and monospace labels",
			},
			{
				type: "improvement",
				description:
					"Analytics migrated from PostHog to Mixpanel",
			},
			{
				type: "fix",
				description:
					"Metrics chip always shows token count with consistent mono font",
			},
			{
				type: "fix",
				description:
					"Text streaming no longer caps speed on large content jumps",
			},
			{
				type: "fix",
				description:
					"Tool output scrolls to bottom when collapsed to show the summary line",
			},
			{
				type: "fix",
				description:
					"Thinking shimmer no longer persists during tool execution",
			},
			{
				type: "fix",
				description:
					"Browsed project is pre-focused and only relevant agent choices are shown during onboarding",
			},
		],
	},
	{
		version: "2026.3.3",
		date: "2026-03-04",
		highlights: "Git branch watcher, multi-agent UI, and smarter metrics display",
		changes: [
			{
				type: "feature",
				description:
					"Git panel, worktree toggle, and session list auto-refresh when you switch branches externally",
			},
			{
				type: "feature",
				description:
					"Multi-agent support with task queue, tooltips, and session management across panels",
			},
			{
				type: "feature",
				description:
					"Subtask permissions are auto-accepted so child sessions run without interruption",
			},
			{
				type: "improvement",
				description:
					"Metrics chip shows token usage (e.g. 45k/200k) instead of dollar spend for Claude Code sessions",
			},
			{
				type: "improvement",
				description: "Sidebar card expand/collapse states persist across sessions",
			},
			{
				type: "improvement",
				description: "Queue-selected sessions move to the leftmost panel for quick access",
			},
			{
				type: "improvement",
				description: "Modified files header has an expand/collapse chevron",
			},
			{
				type: "fix",
				description: "Project groups now sort by creation date in the tab bar and session list",
			},
			{
				type: "fix",
				description: "Agent input clears correctly when switching session tabs in fullscreen",
			},
		],
	},
	{
		version: "2026.3.2",
		date: "2026-03-02",
		highlights: "Focused view, in-app browser, branch picker, and git status indicators",
		changes: [
			{
				type: "feature",
				description:
					"Focused view mode lets you concentrate on a single project — persists across restarts",
			},
			{
				type: "feature",
				description:
					"In-app browser panel for viewing web content directly alongside your agent sessions",
			},
			{
				type: "feature",
				description:
					"Sidebar branch picker with git overview and view mode toggle",
			},
			{
				type: "feature",
				description: "Git status indicators show modified/added/deleted files in the file tree",
			},
			{
				type: "feature",
				description: "Context window usage displayed from agent telemetry data",
			},
			{
				type: "feature",
				description: "Worktree section in branch picker dropdown for quick worktree access",
			},
			{
				type: "improvement",
				description: "Web search results redesigned with structured link display",
			},
			{
				type: "improvement",
				description: "Worktree toggle improved with branch creation UX and green tree icon",
			},
			{
				type: "improvement",
				description:
					"Tab bar gains tooltips, close buttons, status icons, and scroll-on-hover",
			},
			{
				type: "improvement",
				description: "Command palette redesigned with search highlighting and Phosphor icons",
			},
			{
				type: "improvement",
				description: "Project header redesigned with centralized color resolution",
			},
			{
				type: "improvement",
				description: "Smooth character-by-character text streaming for more natural output",
			},
			{
				type: "fix",
				description: "Session titles no longer show raw attachment tokens or system metadata",
			},
			{
				type: "fix",
				description: "Tab shimmer only appears when a session is actively streaming",
			},
			{
				type: "fix",
				description: "Eager sessions no longer appear unexpectedly in the sidebar",
			},
			{
				type: "fix",
				description: "Review panel preserves hunk accept/reject decisions across toggles",
			},
		],
	},
	{
		version: "2026.3.1",
		date: "2026-03-01",
		highlights: "Smoother scrolling, polished selectors, and faster session loading",
		changes: [
			{
				type: "improvement",
				description:
					"Agent panel scrolling reverted to Virtua for smoother performance and more reliable follow behavior",
			},
			{
				type: "improvement",
				description:
					"Redesigned model, agent, and project selectors with a shared Selector component for consistent look and feel",
			},
			{
				type: "improvement",
				description:
					"Mode and model picker icons are now consistently sized with hover color feedback",
			},
			{
				type: "improvement",
				description:
					"Favorite star icon matches mode icon style and fills with project yellow on hover",
			},
			{
				type: "improvement",
				description: "Sessions appear instantly when opening the app — no more skeleton loading delay",
			},
			{
				type: "improvement",
				description: "Archive icon shows inline on session hover, replacing the time-ago label",
			},
			{
				type: "improvement",
				description: "Worktree toggle redesigned with clearer branch display",
			},
			{
				type: "fix",
				description: "Mode selector rounded corners now clip correctly on the selected button",
			},
			{
				type: "fix",
				description:
					"History scanning is faster and more robust with improved Rust caching and parser resilience",
			},
		],
	},
	{
		version: "2026.2.47",
		date: "2026-02-27",
		highlights: "TanStack Virtual scrolling, file panels in agent conversations, S3 browser, and model defaults",
		changes: [
			{
				type: "feature",
				description: "File panels now attach to agent panels — open files side-by-side within a conversation",
			},
			{
				type: "feature",
				description: "S3 bucket browsing and file explorer in SQL Studio — connect with AWS credentials, browse objects, and preview files",
			},
			{
				type: "feature",
				description: "New model default picker in settings — set default models per agent with favorites support",
			},
			{
				type: "improvement",
				description: "Agent panel scrolling powered by TanStack Virtual for smoother performance on long conversations",
			},
			{
				type: "fix",
				description: "CodeMirror editor correctly syncs readonly/editable state when switching contexts",
			},
		],
	},
	{
		version: "2026.2.46",
		date: "2026-02-27",
		highlights: "Token usage metrics chip",
		changes: [
			{
				type: "feature",
				description: "Model metrics chip — see token spend and context usage in the model selector",
			},
		],
	},
	{
		version: "2026.2.45",
		date: "2026-02-26",
		highlights: "Tool call timing and panel visibility improvements",
		changes: [
			{
				type: "feature",
				description: "Tool call elapsed time displayed in tool headers",
			},
			{
				type: "improvement",
				description: "Terminal and git panels now included in workspace visibility checks",
			},
		],
	},
	{
		version: "2026.2.44",
		date: "2026-02-26",
		highlights: "macOS permission prompt fixes",
		changes: [
			{
				type: "fix",
				description: "Further reduction of macOS TCC permission prompt storms at startup",
			},
		],
	},
	{
		version: "2026.2.43",
		date: "2026-02-26",
		highlights: "Eliminated macOS permission prompts",
		changes: [
			{
				type: "fix",
				description: "Eliminated macOS TCC permission prompts by removing Node.js subprocess spawns and preventing orphaned processes",
			},
		],
	},
	{
		version: "2026.2.42",
		date: "2026-02-26",
		highlights: "Git panel, redesigned tab bar and plan sidebar, and ACP stability",
		changes: [
			{
				type: "feature",
				description: "Git panel — stage, commit, push, pull, stash, and manage branches without leaving the app",
			},
			{
				type: "feature",
				description: "Redesigned plan sidebar with cleaner layout and plan toggle",
			},
			{
				type: "improvement",
				description: "Tab bar redesign with better truncation and hover behavior",
			},
			{
				type: "improvement",
				description: "Attention queue card-per-section layout with bell icon",
			},
			{
				type: "fix",
				description: "Commit SHA badges now render correctly in all markdown contexts (async, backtick-wrapped, @-prefixed)",
			},
			{
				type: "fix",
				description: "ACP binary no longer hangs on stdin — rebuilt from TypeScript source with native Bun compilation",
			},
			{
				type: "fix",
				description: "Cursor themes and Shiki dual-theme syntax highlighting restored",
			},
		],
	},
	{
		version: "2026.2.41",
		date: "2026-02-24",
		highlights: "Markdown PR number fix, GitHub badge polish, and tab tooltip tweaks",
		changes: [
			{
				type: "fix",
				description: "PR and issue numbers (e.g. #604) in markdown no longer rendered as hex color badges; they display as normal text",
			},
			{
				type: "improvement",
				description: "GitHub badge — semantic button, inline Tailwind styles, and clearer focus/accessibility",
			},
			{
				type: "improvement",
				description: "Tab bar session tooltip — simplified preview and immediate show (no delay)",
			},
		],
	},
	{
		version: "2026.2.40",
		date: "2026-02-24",
		highlights: "GitHub badges polish, clearer permission UI, and session list improvements",
		changes: [
			{
				type: "improvement",
				description: "GitHub PR and commit badges in markdown — clearer styling and behavior",
			},
			{
				type: "improvement",
				description: "Permission prompts — cleaner labels and Allow Always styling",
			},
			{
				type: "improvement",
				description: "Model selector and session list layout and behavior updates",
			},
		],
	},
	{
		version: "2026.2.39",
		date: "2026-02-24",
		highlights: "Build button in plan exit, mode picker fix, and per-agent modes",
		changes: [
			{
				type: "feature",
				description: "Build button in the exit-plan header for quick access",
			},
			{
				type: "fix",
				description: "Mode picker now shows the correct mode and behaves consistently",
			},
			{
				type: "improvement",
				description: "Per-agent mode mapping — each agent can have its own mode options",
			},
		],
	},
	{
		version: "2026.2.38",
		date: "2026-02-24",
		highlights: "Clearer permission buttons and fewer macOS permission popups",
		changes: [
			{
				type: "improvement",
				description: "Permission action bar — clearer \"Allow Once\", \"Reject Once\", and \"Allow Always\" labels with short descriptions",
			},
			{
				type: "fix",
				description: "Fewer macOS permission prompts at startup — grants are pre-warmed so you see less dialogs",
			},
			{
				type: "fix",
				description: "Paste in the editor no longer triggers unwanted default behavior before content is ready",
			},
		],
	},
	{
		version: "2026.2.37",
		date: "2026-02-24",
		highlights: "Consistent loading spinners across the app",
		changes: [
			{
				type: "improvement",
				description: "All loading indicators now use the same Spinner component for a consistent look",
			},
		],
	},
	{
		version: "2026.2.36",
		date: "2026-02-24",
		highlights: "Stability and PATH reliability",
		changes: [
			{
				type: "fix",
				description: "Process-wide PATH fix — bun and shell tools work when the app is launched from the dock or Finder",
			},
			{
				type: "improvement",
				description: "File path badges show a pointer cursor where appropriate for clearer clickability",
			},
			{
				type: "improvement",
				description: "Unified spinner icon (SpinnerGap) for loading states",
			},
		],
	},
	{
		version: "2026.2.35",
		date: "2026-02-23",
		highlights: "Simplified Grep tool, fewer macOS permission prompts, and PATH reliability",
		changes: [
			{
				type: "feature",
				description: "Simplified Grep tool UI — shows \"Grepping X in Y\" format with inline result count",
			},
			{
				type: "fix",
				description: "Cache path validation to prevent macOS TCC permission prompt spam when opening projects",
			},
			{
				type: "fix",
				description: "Process-wide PATH fix using fix-path-env — bun and shell tools now visible when launched as app bundle",
			},
			{
				type: "improvement",
				description: "Consolidated spinner usage to Spinner component with SpinnerGap icon",
			},
			{
				type: "fix",
				description: "Cursor pointer on non-interactive file path badge for better click affordance",
			},
		],
	},
	{
		version: "2026.2.34",
		date: "2026-02-23",
		highlights: "Stability improvements",
		changes: [
			{
				type: "improvement",
				description: "Stability and release updates",
			},
		],
	},
	{
		version: "2026.2.33",
		date: "2026-02-23",
		highlights: "Unified message queue, faster panel loading, and website fixes",
		changes: [
			{
				type: "feature",
				description: "Unified message queue — stack messages while the agent is busy",
			},
			{
				type: "improvement",
				description: "Faster panel loading with preloaded sessions and reduced initialization latency",
			},
			{
				type: "fix",
				description: "Normalized OpenCode icon size to match other agent icons",
			},
			{
				type: "feature",
				description: "Agent icons above hero title on website",
			},
			{
				type: "fix",
				description: "Website hero icons correct in light theme on first paint",
			},
			{
				type: "fix",
				description: "Website theme mismatch on load and OpenCode icon display",
			},
		],
	},
	{
		version: "2026.2.32",
		date: "2026-02-21",
		highlights: "Inline composer, file panel read view, and model selector improvements",
		changes: [
			{
				type: "feature",
				description: "Inline artefact tokens in agent input (file, image, pasted text, command, skill)",
			},
			{
				type: "feature",
				description: "File panel read view for viewing file contents without editing",
			},
			{
				type: "improvement",
				description: "Model selector with improved grouping and display",
			},
			{
				type: "improvement",
				description: "File picker and file list UI updates",
			},
			{
				type: "improvement",
				description: "Session list project headers with view mode toggle and terminal shortcut",
			},
			{
				type: "improvement",
				description:
					"Refactored inbound request handler: replaced type assertions with Zod schema validation",
			},
		],
	},
	{
		version: "2026.2.31",
		date: "2026-02-20",
		highlights: "Checkpoint UI extraction, tool calls refactor, and agent panel updates",
		changes: [
			{
				type: "improvement",
				description: "Checkpoint components extracted for cleaner UI structure",
			},
			{
				type: "improvement",
				description: "Tool calls display and agent panel refinements",
			},
		],
	},
	{
		version: "2026.2.30",
		date: "2026-02-20",
		highlights: "Agent dropdown, review refinements, and queue improvements",
		changes: [
			{
				type: "feature",
				description: "Agent dropdown in sidebar for creating sessions with a specific agent",
			},
			{
				type: "feature",
				description: "Dynamic model version display for future-proof agent names",
			},
			{
				type: "improvement",
				description: "Agent panel and attention queue layout updates",
			},
			{
				type: "fix",
				description: "Per-hunk accept/reject in review panel; simplified nav when single file",
			},
			{
				type: "fix",
				description: "Fixed duplicate permission and question handlers",
			},
		],
	},
	{
		version: "2026.2.29",
		date: "2026-02-19",
		changes: [
			{
				type: "fix",
				description: "Improved compatibility and type safety",
			},
		],
	},
	{
		version: "2026.2.28",
		date: "2026-02-19",
		highlights: "Pill button and streaming fixes",
		changes: [
			{
				type: "improvement",
				description: "Pill button trailing icon support and consolidated button styling",
			},
			{
				type: "fix",
				description: "Assistant message fragmentation when a turn completes",
			},
		],
	},
	{
		version: "2026.2.27",
		date: "2026-02-19",
		changes: [
			{
				type: "fix",
				description: "macOS app signing for smoother installation",
			},
		],
	},
	{
		version: "2026.2.26",
		date: "2026-02-19",
		highlights: "Queue display and streaming fixes",
		changes: [
			{
				type: "fix",
				description: "Queue items now show Task description instead of child tool details",
			},
			{
				type: "fix",
				description: "Interleaved content corruption in streaming messages",
			},
		],
	},
	{
		version: "2026.2.25",
		date: "2026-02-19",
		highlights: "Features catalog, website revamp, streaming overhaul",
		changes: [
			{
				type: "feature",
				description: "Features catalog page with accordion layout on website",
			},
			{
				type: "feature",
				description: "Revamped features page with login gating",
			},
			{
				type: "improvement",
				description: "Hover effects on website header navigation",
			},
			{
				type: "improvement",
				description: "Streaming and event handling improvements",
			},
		],
	},
	{
		version: "2026.2.24",
		date: "2026-02-18",
		changes: [
			{
				type: "improvement",
				description: "Stability improvements",
			},
		],
	},
	{
		version: "2026.2.23",
		date: "2026-02-18",
		changes: [
			{
				type: "fix",
				description: "Website deployment reliability",
			},
		],
	},
	{
		version: "2026.2.22",
		date: "2026-02-18",
		changes: [
			{
				type: "fix",
				description: "Website build and availability",
			},
		],
	},
	{
		version: "2026.2.21",
		date: "2026-02-18",
		highlights: "Chunk aggregation and todo progress fixes",
		changes: [
			{
				type: "fix",
				description: "Todo progress display in queue for edge cases",
			},
			{
				type: "fix",
				description: "Chunk aggregation for all-done scenarios",
			},
		],
	},
	{
		version: "2026.2.20",
		date: "2026-02-18",
		highlights: "Interactive GitHub PR and commit references in markdown",
		changes: [
			{
				type: "feature",
				description: "GitHub PR/commit badges with interactive diff viewer in markdown content",
			},
			{
				type: "feature",
				description: "Full-screen diff viewer showing commits, PRs, and file-by-file changes",
			},
			{
				type: "feature",
				description:
					"Support for 4 GitHub reference patterns: shorthand (owner/repo#123), URLs, commit SHAs, and git refs (@abc1234)",
			},
			{
				type: "feature",
				description: "Changelog page on the website",
			},
			{
				type: "improvement",
				description: "Graceful fallback to GitHub links when git/gh CLI unavailable",
			},
			{
				type: "improvement",
				description: "Queue item dual-status display: todo progress and agent state shown simultaneously",
			},
			{
				type: "fix",
				description: "Mermaid toolbar and pan-zoom behavior",
			},
		],
	},
	{
		version: "2026.2.19",
		date: "2026-02-16",
		highlights: "Agent-aware project import in onboarding",
		changes: [
			{
				type: "feature",
				description: "Onboarding now filters projects by selected agents for focused imports",
			},
			{
				type: "improvement",
				description: "Project import step shows only session counts from selected agents",
			},
		],
	},
	{
		version: "2026.2.18",
		date: "2026-02-14",
		highlights: "Redesigned onboarding, live tool display, and streaming animations",
		changes: [
			{
				type: "feature",
				description: "Redesigned onboarding with project table, agent cards, and shader background",
			},
			{
				type: "feature",
				description: "Live tool display in the queue with file chips and task shimmer",
			},
			{
				type: "feature",
				description: "Tab bar shows mode, state, and live tool indicators",
			},
			{
				type: "feature",
				description: "Full-screen review overlay with persisted review mode",
			},
			{
				type: "feature",
				description: "Plan sidebar with download and pill-style plan toggle",
			},
			{
				type: "feature",
				description: "Card-style UIs for WebSearch and Fetch tools",
			},
			{
				type: "feature",
				description: "Bidirectional agent communication with inbound request routing",
			},
			{
				type: "improvement",
				description: "Perplexity-style word-chunk streaming animation replaces typewriter",
			},
			{
				type: "improvement",
				description: "Scroll system rewritten with auto-scroll",
			},
			{
				type: "improvement",
				description: "Queue enhancements with new sections",
			},
			{
				type: "fix",
				description: "Prevented orphaned sessions from crashing on app restart",
			},
			{
				type: "fix",
				description: "Fixed UI getting stuck in 'Planning next moves' after agent turn",
			},
			{
				type: "fix",
				description: "EnterPlanMode and ExitPlanMode now display as separate tool types",
			},
		],
	},
	{
		version: "2026.2.4",
		date: "2026-02-08",
		highlights: "More reliable sessions and smoother reconnections",
		changes: [
			{
				type: "fix",
				description: "Fixed sessions getting stuck on a connecting spinner when resuming",
			},
			{
				type: "improvement",
				description: "Sessions now reconnect and load history more reliably",
			},
		],
	},
	{
		version: "2026.2.3",
		date: "2026-02-08",
		highlights: "Stability and performance improvements",
		changes: [
			{
				type: "improvement",
				description: "General stability and performance improvements across the app",
			},
		],
	},
	{
		version: "2026.2.2",
		date: "2026-02-07",
		highlights: "Settings overlay, changelog, and Codex tools",
		changes: [
			{
				type: "feature",
				description:
					"Settings now opens as an overlay — your sessions stay right where you left them",
			},
			{
				type: "feature",
				description: 'New "What\'s New" changelog shown after updates',
			},
			{
				type: "feature",
				description: "Codex tool calls are now displayed in conversations",
			},
			{
				type: "fix",
				description: "Faster and more accurate file change stats in the Activity queue",
			},
			{
				type: "improvement",
				description: "Better session title updates and UI responsiveness",
			},
		],
	},
	{
		version: "2026.2.1",
		date: "2026-02-06",
		highlights: "Revamped attention queue and improved stability",
		changes: [
			{
				type: "feature",
				description: "Revamped attention queue to focus on user action items",
			},
			{
				type: "fix",
				description: "Fixed Activity panel crashes with context pattern guard",
			},
			{
				type: "fix",
				description: "Fixed Codex sessions disappearing when clicked",
			},
		],
	},
];

/**
 * Group changes by type, preserving order of first appearance.
 */
export function groupChangesByType(
	changes: ChangeItem[]
): { type: ChangeType; items: ChangeItem[] }[] {
	const groups: { type: ChangeType; items: ChangeItem[] }[] = [];
	const seen = new Set<ChangeType>();
	for (const change of changes) {
		if (!seen.has(change.type)) {
			seen.add(change.type);
			groups.push({ type: change.type, items: [] });
		}
		groups.find((g) => g.type === change.type)?.items.push(change);
	}
	return groups;
}

/**
 * Get all changelog entries between two versions.
 * Returns entries newer than lastSeenVersion up to and including currentVersion.
 * Array is in reverse chronological order (newest first).
 *
 * @param lastSeenVersion - The last version the user saw
 * @param currentVersion - The current app version
 */
export function getChangelogEntriesSince(
	lastSeenVersion: string,
	currentVersion: string
): ChangelogEntry[] {
	const currentIndex = CHANGELOG.findIndex((e) => e.version === currentVersion);
	if (currentIndex === -1) return [];

	const lastSeenIndex = CHANGELOG.findIndex((e) => e.version === lastSeenVersion);
	if (lastSeenIndex === -1) return CHANGELOG.slice(currentIndex);

	return CHANGELOG.slice(currentIndex, lastSeenIndex);
}

/**
 * Get the most recent changelog entry.
 *
 * @returns The most recent changelog entry, or undefined if none exist
 */
export function getLatestChangelog(): ChangelogEntry | undefined {
	return CHANGELOG[0];
}
