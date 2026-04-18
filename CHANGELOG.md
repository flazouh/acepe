# Changelog

All notable changes to Acepe will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2026.4.16] - 2026-04-16

### Changed
- Claude Sonnet sessions now request Claude's 1M context variant via the runtime model ID where supported, while Opus and Haiku continue using their standard context windows
- Acepe now resolves Claude exclusively through its managed Claude install, and outdated managed installs trigger the existing repair flow instead of falling back to `claude` or `claude-code` on PATH

### Fixed
- Changing the Claude model before the first prompt now rebuilds deferred cc-sdk launch options so the first live turn uses the newly selected model

### Infrastructure
- Release workflow now fails fast if any analytics secret (Sentry DSN, PostHog key/host) is missing, preventing silent no-op analytics in published builds

## [2026.4.14] - 2026-04-14

### Added
- Codex native client now routes `session/update` JSON-RPC notifications through the session update parser, enabling Codex-originated tool calls to appear in the UI
- New sessions can start with Autonomous enabled before the first message, including Codex build sessions mapped to a full-access execution profile
- Config option selector shows a reasoning-effort icon indicator when reasoning level changes
- Streaming animation settings now offer smooth and instant reveal modes with a live preview in the desktop app
- Markdown streaming sections split and reveal progressively during agent responses instead of updating the entire block
- Project badges can append per-project sequence numbers in agent panel and kanban cards
- Streaming log calls added to Codex native client for debugging event flow
- Contract tests for permission bar, agent-tool-edit, config selector reasoning icon, and resolve-tool-call-edit-diffs
- Markdown streaming now keeps settled sections stable while only the live tail refreshes, including open fenced code blocks
- Kanban board gains a Needs Review column (pink, eye icon) for unseen completions before they move to Done
- Views can override Cmd+T to show a custom new-session flow such as the kanban new-agent dialog
- Worktree session setup now supports prepared launches before opening a new session
- Users can choose a default agent, and browser tool cards plus queued-message previews now surface richer context
- Cargo profiles for faster Tauri dev builds (opt-level 2 for dependencies) and leaner releases (thin LTO, strip, single codegen unit)
- Biome lint checks added to desktop and website pre-push validation hooks
- ACP file write path handling now canonicalizes and scope-checks write paths for security

### Changed
- ACP frontend interaction handling now routes permissions, questions, and plan approvals through shared builders and reply strategies, and feature-specific agent behavior now reads from capability metadata instead of scattered agent-ID checks
- ACP backend now delegates Cursor-specific notification suppression and session-update enrichment through provider hooks, extracts cc-sdk permission bridging into a dedicated module, and threads explicit agent context through session-update, cc-sdk bridge, and streaming parser seams instead of relying on task-local globals
- ACP runtime plumbing now routes through the canonical operation model, a unified Tauri command surface, and cleaner provider-owned session seams
- Tool call edit and permission bar components redesigned with a dedicated diff resolution layer
- Session title formatting extracted to shared `formatSessionTitleForDisplay`, replacing duplicated capitalize-and-fallback logic across agent panel and kanban view
- Project sidebar metadata and icons now persist across the app, with hardened icon handling and refreshed shell and chrome surfaces
- Website branding now routes through a shared `Logo` component sourced from `favicon.svg`
- App chrome refined with accent border and rounded corners on the main window
- Icon generation now emits website favicon and OG assets from the shared logo source and patches the Android launcher background
- Workspace dependency versions aligned across desktop, website, and ui packages (Vite 7, SvelteKit 2.49, Svelte 5.45, TypeScript 5.9)
- Remaining `once_cell::Lazy` statics replaced with `std::sync::LazyLock` and the direct `once_cell` dependency removed
- Stale `lucide-svelte` and `phosphor-icons-svelte` dependencies removed from manifests and lockfile
- Backend CI serializes Cargo steps and drops redundant `cargo check`
- Website test script uses Bun instead of npm
- Agent setup and kanban activity UI refreshed
- Design system showcase ownership moved into the desktop package
- Kanban inline composer removed in favor of thread dialog interaction
- Main app production chrome now suppresses the native context menu, and kanban-launched session panels open at a wider default width
- GitHub Releases now publish the matching changelog entry directly instead of linking back to `CHANGELOG.md`

### Removed
- Analytics and Sentry infrastructure removed across desktop, website, and backend — `@acepe/analytics` package deleted, Sentry SDK dependencies dropped, error capture calls stripped, source map uploads disabled
- Copilot removed from hero section agent grid on the website

### Fixed
- Duplicate ACP approval surfaces no longer appear for the same operation when tool-call cards, permission requests, and hook permissions arrive through overlapping event paths
- Text delta whitespace preserved in Codex native streaming — leading spaces in LLM tokens (e.g. `" world"`) are no longer trimmed, fixing broken inter-word spacing
- Reconnecting a thread with an already-bound ACP session no longer issues a duplicate resume
- Codex turn interrupts now include the active turn id
- Session title overrides now survive transcript refreshes and reveal the latest derived title when cleared
- OpenCode runtime root resolved from the repository or worktree root instead of the raw working directory, preventing duplicate processes and leaked LSP servers
- Open PR button stays visible with its loading spinner during PR creation instead of vanishing instantly
- Website logo dark/light theme assets now display correctly in their respective modes
- Merge split button moved from PrStatusCard to ModifiedFilesHeader for consistent action placement
- PR badges now fetch PR details as soon as they render instead of waiting for hover
- Streaming markdown reuse now preserves settled sections incrementally, avoids refresh reflow churn, and shows elapsed seconds in active thinking headers
- Codex native thread start/resume requests now keep extended-history flags and surface sanitized runtime diagnostics in connection issue drafts
- First-send composer clearing now stays visually immediate while sound/logging work is deferred off the critical path
- Copilot replay titles and history hygiene are restored after reconnects and transcript reloads
- Panel launch behavior, kanban motion overlays, and active-agent filtering are more stable during live session updates

## [2026.4.4] - 2026-04-03

### Added
- Shared PR preference key in the desktop user-setting contract, typed against `UserSettingKey` instead of raw string literals

### Changed
- Refreshed Acepe logo and regenerated desktop and website icon sets from the latest document source

### Fixed
- Kanban cards now show only live activity (active tool, subagent, thinking, error) instead of conversation preview markdown
- Voice runtime models unloaded and recording sessions released during shutdown to prevent stale worker state

## [2026.4.3] - 2026-04-03

### Added
- Kanban cards embed a compact voice composer with mode toggling and session usage tally in the card footer
- Live session threads can be opened directly from kanban board cards, backed by background panels for real-time sync
- Shared chip shell component with icon defaults exported from `@acepe/ui`
- Compact inline task and permission summaries in the agent panel
- Website comparison pages published with verified Conductor comparison and expanded discoverability

### Changed
- Logo asset consolidated from the shared document source with regenerated desktop and website icon sets
- Tauri and Vite watch ignore files aligned so frontend-only changes stay on Vite HMR

### Fixed
- Kanban tool kinds normalized to the shared AgentToolKind subset before building card data
- Updater no longer allows startup updates to proceed through the install flow
- Floating surfaces now route through layer tokens for correct stacking
- Derived session titles preserved over generated session labels

## [2026.4.2] - 2026-04-02

### Added
- Shared kanban board and card primitives are now exported from `@acepe/ui`, and the desktop design system overlay includes dedicated button and kanban specimens
- Press Cmd+. to cycle composer modes, with a Cmd+Shift+. fallback for keyboard layouts where period requires Shift

### Changed
- Kanban view now uses an inline New Agent dialog, keeps the board visible after session creation, and always renders the answer needed, planning, working, and finished columns
- Composer, permission prompts, and toolbar controls now use compact shared header and toolbar button styles, and the model selector trigger is simplified
- The website header surfaces GitHub star counts more consistently, and Railway builds now target the website package only

## [2026.4.1] - 2026-03-31

### Added
- GitHub Copilot CLI can now be installed and launched as a built-in Acepe agent, with ACP-backed session listing and replay in history
- Supported live sessions now expose an Autonomous toolbar toggle that switches execution profiles for hands-off runs
- Modified files review now supports keep-all progress, richer PR instruction editing, and PR prompt preview generation
- Attention queue task entries now render subagent activity as dedicated cards, and the shared UserMessageContainer is exported from @acepe/ui

### Changed
- Fullscreen and workspace restoration now treat agent, terminal, review, and Git panels as top-level single-view panels with more reliable focus restoration
- Codex now uses the native app-server runtime, and built-in agent launcher resolution is aligned around provider-managed cached binaries
- PR generation keeps the XML response contract hidden from the editable prompt, and toolbar config controls avoid duplicating mode and model selectors

### Fixed
- Pending permissions are restored if a reply fails, and resumed sessions reset autonomous execution profiles back to safe defaults
- Worktree creation now branches from the mainline ref instead of the current checkout when possible
- Drag-and-drop listener cleanup, PR header expansion order, dropdown icon color states, and queue task rendering are more reliable

## [2026.3.37] - 2026-03-30

### Changed
- Desktop updates now predownload in the background for already-open apps and only install plus relaunch after you click Update

### Fixed
- Dev update previews now route through the simulation flow instead of the production installer path

## [2026.3.36] - 2026-03-30

### Changed
- Startup restoration now hydrates only the saved sessions first, then refreshes the wider sidebar history in the background
- Preconnection skills are now loaded directly from parsed on-disk agent skill directories grouped by agent
- The global file explorer and inline file picker now prefer the active worktree path and refresh stale indexes when reopened
- Queued messages now render newest-first with inline editing actions and a persistent compact strip above the composer

### Fixed
- Claude Code permission prompts now offer an Always allow path when the SDK suggests persistent rules, and session cancellation now resolves matching pending questions cleanly
- Claude Code sessions now include user, project, and local setting sources when booting the SDK client
- Restored panels now validate missing sessions before reconnecting so startup does not block on a full history scan
- Slash command suggestions now fall back to preconnection skills when a connected session has no live commands yet
- First-send mode and model choices now survive session creation, and busy composer states keep queue and steer actions enabled correctly
- Tool call UI now preserves exit-plan approvals, task child status mapping, markdown reveal placeholders, and fullscreen attached-pane layout behavior more reliably
- Single-session fullscreen now stays scoped to single view mode, keeps terminal fullscreen separate, and restores saved agent fullscreen targets consistently on workspace reload
- Pierre diffs and markdown tables now keep bottom spacing so the last visible content clears overlay scrollbars
- Duplicate permission UI events no longer fire when multiple SDK requests share the same tool call
- Markdown content now shows plain text while streaming instead of flickering partially rendered HTML
- Question and attention queue entries render approve/deny flows more reliably with consistent UI state tracking

## [2026.3.35] - 2026-03-30

### Changed
- Empty state heading replaced with a direct build prompt and dedicated sans, serif, and mono font tokens applied for branded Acepe typography

### Fixed
- Composer state recovers when the initial session handoff fails, keeping panels retryable and preloading slash commands before a session exists
- Attached file-panel panes now scroll to the bottom without being clipped by the surrounding layout
- Single-session fullscreen stays scoped to agent fullscreen, terminal fullscreen remains a separate target, and saved agent fullscreen selections restore consistently during workspace hydration
- Worktree-aware file picker and global explorer prefer the active worktree path, first-send mode and model selections survive session creation, and queue and steer actions stay enabled while a turn can be cancelled
- Restored panels now hydrate saved sessions first during startup so reconnection does not block on a full history scan
- Claude Code permission prompts offer persistent allow rules when the SDK suggests them, and cancelled sessions resolve pending questions cleanly
- OpenCode preserves streaming events and rich edit payloads during active sessions
- Pierre diffs and markdown tables keep bottom clearance so content clears overlay scrollbars

## [2026.3.34] - 2026-03-29

### Changed
- Claude Code permission prompts now queue one at a time above the composer and show batch progress with a compact tally bar

### Fixed
- Direct Claude Code sessions now launch the stdio permission prompt hook reliably so Bash and edit approvals reach Acepe instead of falling back to chat text
- Permission cards now wrap long command previews without overflowing the composer area

## [2026.3.33] - 2026-03-29

### Changed
- Agent task cards now show the latest tool call inline above the tally strip for faster scanning
- Worktree toggles now keep the primary control visibly disabled when a global auto-worktree default locks it on

### Fixed
- Claude Code session metadata now persists provider-backed session ID aliases so worktree sessions reload the correct history after restart
- History loading, plan lookup, batch upserts, and cleanup now respect provider session IDs instead of treating provider transcripts as separate sessions
- Disabled worktree toggle buttons now dim correctly when interaction is locked

## [2026.3.32] - 2026-03-29

### Added
- Wispr Flow sound effects for voice input and notifications
- Inline error cards can now open GitHub issue drafts directly
- Preconnect slash commands now preload agent skills
- Permission prompts now render above the agent input in a dedicated header
- GitHub star count now appears in website navigation

### Changed
- Landing, pricing, and download pages polished
- Social preview image updated to the Acepe working view screenshot
- Unused website waitlist and Resend flow removed

### Fixed
- ACP permission request identity stabilized for more reliable permission targeting
- Claude worktree sessions and session context restore more reliably after restart
- Async HTML is preserved during markdown streaming
- Voice input lifecycle and quiet-input live meter behavior hardened
- Agent input stream controls and voice start state aligned correctly
- Claude Code subagent task nesting and session ID mapping restored
- macOS downloads now bypass the old website proxy for GitHub Releases
- Footer buttons no longer disappear when branch names are long

## [2026.3.31] - 2026-03-27

### Fixed
- Mic button tooltip now shows the correct keyboard shortcut

## [2026.3.30] - 2026-03-27

### Fixed
- Website CI and fixture setup restored for release builds

## [2026.3.29] - 2026-03-26

### Fixed
- Pierre diff workers now build as ES modules

## [2026.3.28] - 2026-03-26

### Fixed
- Desktop CI and release pipeline unblocked

## [2026.3.27] - 2026-03-26

### Fixed
- Rust cache invalidation now picks up updated `mcp-bridge` permissions metadata

## [2026.3.26] - 2026-03-26

### Changed
- Claude Code Bash tool calls now stream their actual command arguments live instead of showing a generic Bash placeholder while input JSON arrives.
- Voice press-and-hold now uses the dedicated keyboard hold flow and warms the audio context earlier so start sounds play with less delay.
- The shared input container is now exported from @acepe/ui and reused by desktop input surfaces for a cleaner shared component path.

### Fixed
- Claude Code permission prompts now target the correct live tool call row instead of synthetic IDs, preventing invisible inline approvals for cc-sdk sessions.
- Streaming debug logs are now written for Claude Code sessions and the Open Streaming Log action opens them reliably from session menus and the agent panel.
- Worktree toggle state and empty-state worktree flows now log and reflect active worktrees more consistently, including the auto-worktree switch state.

## [2026.3.14] - 2026-03-20

### Added
- Quick-access settings button (gear icon) added to the agent panel footer for fast navigation to project settings

### Changed
- Cursor tool calls now show rich arguments (file paths, edit diffs, and more) both in live sessions and when browsing session history — data is enriched from the persisted JSONL store
- Skills library redesigned with a cleaner panel header toolbar and tighter list typography; split/editor/preview view toggles removed for a simpler layout
- Pasted text chips now show a decoded preview and character count instead of a generic label, with fuller tooltip content when hovering
- Settings page UI polish: tighter spacing, refined surface colors, colored sidebar icons (purple for Agents, green for Worktrees), and smaller section headers

### Fixed
- Git panel no longer re-runs initialization logic reactively when opening a PR — initialTarget is now read once via untrack

## [2026.3.12] - 2026-03-19

### Added
- PR status card in the Git panel shows AI-generated commit messages and PR descriptions with real-time staging and pushing progress
- Setup scripts dialog and footer widget for agent initialization with clearer setup states
- Terminal drawer now closes automatically when the last tab is closed
- Pasted text overlay in agent input provides visual feedback when pasting large content

### Changed
- ACP client lifecycle and error handling more robust with better subprocess management
- Session scanner and text parsing improved for more reliable history loading
- Notifications now appear as overlay cards inside the main window instead of a separate window, with hover pause and auto-dismiss
- Misc UI polish and cleanup across the app

### Fixed
- TurnError is now properly dispatched when a subprocess dies mid-stream, with improved error recovery
- Worktree default setting no longer has a race condition on the first message sent
- Model selector favorites no longer overlap with the selector dropdown

## [2026.3.11] - 2026-03-15

### Added
- Settings → Worktrees: new "Use worktrees by default" option so new sessions automatically use git worktrees for branch isolation, with setup states (running/failed/complete)

### Changed
- One-shot PR flow now shows "Staging…" and "Pushing…" progress during commit and push

### Fixed
- Shell environment (PATH, etc.) is now correctly passed to agent and terminal processes when the app is launched from the Dock or Finder

## [2026.3.8] - 2026-03-14

### Added
- One-shot PR: commit, push, and create or open PR in one action from the Git panel (Commit & push and Commit, push & create PR buttons with toasts and Open PR link)
- Session list: PR badge on sessions with an open PR — tap to open the Git panel at that PR
- Archived sessions: new Settings → Archived sessions section; archive or unarchive from the sidebar session menu
- Agent panel: delete-file tool calls now show a dedicated card with Deleting/Deleted state

### Changed
- Inline plan card: full preview and skill links in the redesigned layout
- Agent panel: worktree and branch moved into a dedicated footer bar
- Execute tool: command details shown when a run is blocked by permissions
- Notifications: window resizes to content; toasts use translucent styling
- Project delete: inline dropdown confirmation instead of a separate dialog

## [2026.3.7] - 2026-03-13

### Added
- GitHub PR and commit badges now open the Git panel directly to that pull request or commit
- New Chat settings section with toggles for collapsed thinking blocks and inline plan display

### Changed
- Git panel now opens as an overlay modal with improved panel behavior
- Tool call rows use clearer active and completed labels across the app
- Sessions connect eagerly across the app for faster, more reliable loading

### Fixed
- Terminal fullscreen mode now behaves correctly with aligned panel surfaces
- Agent visibility toggles in settings no longer double-toggle or drift out of sync
- Question prompts stay synced with their matching tool call state in the main app view

## [2026.3.6] - 2026-03-09

### Added
- Layout config dropdown — toggle sidebar, tab bar, and single-project mode from the top bar
- Focused tab gains scale emphasis and clicking a tab switches to that project
- Cursor plan approval — plans now route to an approval prompt before executing

### Changed
- Settings modal redesigned with cleaner tab layout
- Dropdown menu components consolidated into shared UI package
- Agent panel header simplified with less nesting
- Replaced Mixpanel with Sentry for error tracking and analytics

### Fixed
- Cursor: question now links to streaming tool call with plan loading state
- Image attachments sent as proper image content blocks instead of base64 text
- UI freeze on first message in agent panel reduced
- UI freeze on Cursor session reload prevented

## [2026.3.5] - 2026-03-07

### Added
- Unified input toolbar — mode, model, checkpoint, worktree, and send button now live inside the input area
- Scroll-to-top button in agent panel for quick navigation

### Changed
- Refreshed light theme with updated brand palette
- Panel headers redesigned with reusable cell-based components and monospace titles
- Changelog modal supports dark and light theme palettes
- Reviewed file count moved next to the review button in modified files header
- Cursor agent migrated to native ACP — faster startup and smaller bundle

### Fixed
- Worktree creation now works even with uncommitted changes
- OpenCode sessions handle turn errors gracefully instead of crashing
- Update shimmer text and download progress normalized correctly

## [2026.3.4] - 2026-03-05

### Added
- Settings redesigned as a Notion-style modal overlay
- Click the chat header to scroll the conversation to the top
- Git init support — initialize a repo from the branch selector or session list
- Tool call spinner appears immediately when the agent invokes a tool

### Changed
- Review progress persists per file revision across panel toggles
- Review panel uses Phosphor status icons and monospace labels
- Analytics migrated from PostHog to Mixpanel

### Fixed
- Metrics chip always shows token count with consistent mono font
- Text streaming no longer caps speed on large content jumps
- Tool output scrolls to bottom when collapsed to show the summary line
- Thinking shimmer no longer persists during tool execution
- Browsed project is pre-focused and only relevant agent choices are shown during onboarding

## [2026.3.3] - 2026-03-04

### Added
- Git panel, worktree toggle, and session list auto-refresh when you switch branches externally
- Multi-agent support with task queue, tooltips, and session management across panels
- Subtask permissions are auto-accepted so child sessions run without interruption

### Changed
- Metrics chip shows token usage (e.g. 45k/200k) instead of dollar spend for Claude Code sessions
- Sidebar card expand/collapse states persist across sessions
- Queue-selected sessions move to the leftmost panel for quick access
- Modified files header has an expand/collapse chevron

### Fixed
- Project groups now sort by creation date in the tab bar and session list
- Agent input clears correctly when switching session tabs in fullscreen

## [2026.3.2] - 2026-03-02

### Added
- Focused view mode lets you concentrate on a single project — persists across restarts
- In-app browser panel for viewing web content directly alongside your agent sessions
- Sidebar branch picker with git overview and view mode toggle
- Git status indicators show modified/added/deleted files in the file tree
- Context window usage displayed from agent telemetry data
- Worktree section in branch picker dropdown for quick worktree access

### Changed
- Web search results redesigned with structured link display
- Worktree toggle improved with branch creation UX and green tree icon
- Tab bar gains tooltips, close buttons, status icons, and scroll-on-hover
- Command palette redesigned with search highlighting and Phosphor icons
- Project header redesigned with centralized color resolution
- Smooth character-by-character text streaming for more natural output

### Fixed
- Session titles no longer show raw attachment tokens or system metadata
- Tab shimmer only appears when a session is actively streaming
- Eager sessions no longer appear unexpectedly in the sidebar
- Review panel preserves hunk accept/reject decisions across toggles

## [2026.3.1] - 2026-03-01

### Changed
- Agent panel scrolling reverted to Virtua for smoother performance and more reliable follow behavior
- Redesigned model, agent, and project selectors with a shared Selector component for consistent look and feel
- Mode and model picker icons are now consistently sized with hover color feedback
- Favorite star icon matches mode icon style and fills with project yellow on hover
- Sessions appear instantly when opening the app — no more skeleton loading delay
- Archive icon shows inline on session hover, replacing the time-ago label
- Worktree toggle redesigned with clearer branch display

### Fixed
- Mode selector rounded corners now clip correctly on the selected button
- History scanning is faster and more robust with improved Rust caching and parser resilience

## [2026.2.41] - 2026-02-24

### Fixed
- PR and issue numbers (e.g. #604) in markdown no longer rendered as hex color badges; they display as normal text

### Changed
- GitHub badge — semantic button, inline Tailwind styles, and clearer focus/accessibility
- Tab bar session tooltip — simplified preview and immediate show (no delay)

## [2026.2.40] - 2026-02-24

### Changed
- GitHub PR and commit badges in markdown — clearer styling and behavior
- Permission prompts — cleaner labels and "Allow Always" styling
- Model selector and session list layout and behavior updates

## [2026.2.39] - 2026-02-24

### Added
- Build button in the exit-plan header for quick access

### Changed
- Per-agent mode mapping — each agent can have its own mode options

### Fixed
- Mode picker now shows the correct mode and behaves consistently

## [2026.2.38] - 2026-02-24

### Changed
- Permission action bar — clearer "Allow Once", "Reject Once", and "Allow Always" labels with short descriptions

### Fixed
- Fewer macOS permission prompts at startup (pre-warmed grants)
- Paste in the editor no longer triggers unwanted default behavior before content is ready

## [2026.2.37] - 2026-02-24

### Changed
- All loading indicators now use the same Spinner component for a consistent look

## [2026.2.36] - 2026-02-24

### Changed
- File path badges show a pointer cursor where appropriate for clearer clickability
- Unified spinner icon (SpinnerGap) for loading states

### Fixed
- Process-wide PATH fix — bun and shell tools work when the app is launched from the dock or Finder

## [2026.2.12] - 2026-02-10

### Changed
- Code cleanup and formatting improvements

## [2026.2.11] - 2026-02-10

### Added
- Enhanced queue functionality with new features and utilities
- Download icon with hover effect in website header

### Fixed
- Session lifecycle hardening with defense-in-depth cleanup
- Orphaned session crash on app restart
- Replaced phosphor icon with Lucide Download icon in header

## [2026.2.10] - 2026-02-10

### Added
- UI plans and solutions for planning state issues
- Mode, state, and live tool indicators in tab bar
- Wrench icon for build mode in tab bar

### Fixed
- UI getting stuck in "Planning next moves" after agent turn
- Download mechanism reverted to redirect-based to prevent corrupted DMGs
- Tab bar now shows accurate mode and question state

### Removed
- Intel build support from release process
- Intel download button from website

[Unreleased]: https://github.com/flazouh/acepe/compare/v2026.4.14...HEAD
[2026.4.14]: https://github.com/flazouh/acepe/releases/tag/v2026.4.14
[2026.4.4]: https://github.com/flazouh/acepe/releases/tag/v2026.4.4
[2026.4.3]: https://github.com/flazouh/acepe/releases/tag/v2026.4.3
[2026.4.2]: https://github.com/flazouh/acepe/releases/tag/v2026.4.2
[2026.4.1]: https://github.com/flazouh/acepe/releases/tag/v2026.4.1
[2026.3.37]: https://github.com/flazouh/acepe/releases/tag/v2026.3.37
[2026.3.36]: https://github.com/flazouh/acepe/releases/tag/v2026.3.36
[2026.3.35]: https://github.com/flazouh/acepe/releases/tag/v2026.3.35
[2026.3.34]: https://github.com/flazouh/acepe/releases/tag/v2026.3.34
[2026.3.33]: https://github.com/flazouh/acepe/releases/tag/v2026.3.33
[2026.3.32]: https://github.com/flazouh/acepe/releases/tag/v2026.3.32
[2026.3.31]: https://github.com/flazouh/acepe/releases/tag/v2026.3.31
[2026.3.30]: https://github.com/flazouh/acepe/releases/tag/v2026.3.30
[2026.3.29]: https://github.com/flazouh/acepe/releases/tag/v2026.3.29
[2026.3.28]: https://github.com/flazouh/acepe/releases/tag/v2026.3.28
[2026.3.27]: https://github.com/flazouh/acepe/releases/tag/v2026.3.27
[2026.3.26]: https://github.com/flazouh/acepe/releases/tag/v2026.3.26
[2026.3.14]: https://github.com/flazouh/acepe/releases/tag/v2026.3.14
[2026.3.12]: https://github.com/flazouh/acepe/releases/tag/v2026.3.12
[2026.3.11]: https://github.com/flazouh/acepe/releases/tag/v2026.3.11
[2026.3.8]: https://github.com/flazouh/acepe/releases/tag/v2026.3.8
[2026.3.7]: https://github.com/flazouh/acepe/releases/tag/v2026.3.7
[2026.3.6]: https://github.com/flazouh/acepe/releases/tag/v2026.3.6
[2026.3.5]: https://github.com/flazouh/acepe/releases/tag/v2026.3.5
[2026.3.4]: https://github.com/flazouh/acepe/releases/tag/v2026.3.4
[2026.3.3]: https://github.com/flazouh/acepe/releases/tag/v2026.3.3
[2026.3.2]: https://github.com/flazouh/acepe/releases/tag/v2026.3.2
[2026.3.1]: https://github.com/flazouh/acepe/releases/tag/v2026.3.1
[2026.2.41]: https://github.com/flazouh/acepe/releases/tag/v2026.2.41
[2026.2.40]: https://github.com/acepe/acepe/releases/tag/v2026.2.40
[2026.2.39]: https://github.com/acepe/acepe/releases/tag/v2026.2.39
[2026.2.38]: https://github.com/acepe/acepe/releases/tag/v2026.2.38
[2026.2.37]: https://github.com/acepe/acepe/releases/tag/v2026.2.37
[2026.2.36]: https://github.com/acepe/acepe/releases/tag/v2026.2.36
[2026.2.12]: https://github.com/acepe/acepe/releases/tag/v2026.2.12
[2026.2.11]: https://github.com/acepe/acepe/releases/tag/v2026.2.11
[2026.2.10]: https://github.com/acepe/acepe/releases/tag/v2026.2.10
