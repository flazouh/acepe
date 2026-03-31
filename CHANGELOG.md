# Changelog

All notable changes to Acepe will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/flazouh/acepe/compare/v2026.3.33...HEAD
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
