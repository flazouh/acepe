# Changelog

All notable changes to Acepe will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Layout config dropdown — toggle sidebar, tab bar, and single-project mode from the top bar
- Focused tab visual emphasis (scale effect) and click-to-switch project
- Unified input toolbar with mode, model, and controls embedded inside the input area
- User Reports — submit and browse reports from the toolbar
- Scroll-to-top button in the agent panel
- Cursor plan approval — CreatePlan tool kind routes to approval prompt
- Worktree creation now allowed with a dirty working tree
- Dark and light theme palettes (Anthropic color scheme)

### Changed
- Top bar redesigned with reusable HeaderCell components
- Panel headers extracted into reusable UI components
- Plan components use embedded design pattern
- Project selector pre-focuses the browsed project and shows only agent choices
- Replaced Mixpanel with Sentry for error tracking and analytics
- Cursor sessions use native agent ACP (removed TypeScript adapter)

### Fixed
- UI freeze on first message in agent panel
- UI freeze on Cursor session reload
- Cursor: question now links to streaming tool call with plan loading state
- Image attachments sent as proper image content blocks (no longer base64 text)
- Branch name shown for repos with no commits
- Shimmer update text and download progress normalized
- File badge detection and link replacement tightened
- Double border on file panel header toggle removed
- Deduplicated "Other" tool title; single-select questions hide extra input
- Optional models handled correctly in session responses

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

[Unreleased]: https://github.com/acepe/acepe/compare/v2026.2.41...HEAD
[2026.2.41]: https://github.com/acepe/acepe/releases/tag/v2026.2.41
[2026.2.40]: https://github.com/acepe/acepe/releases/tag/v2026.2.40
[2026.2.39]: https://github.com/acepe/acepe/releases/tag/v2026.2.39
[2026.2.38]: https://github.com/acepe/acepe/releases/tag/v2026.2.38
[2026.2.37]: https://github.com/acepe/acepe/releases/tag/v2026.2.37
[2026.2.36]: https://github.com/acepe/acepe/releases/tag/v2026.2.36
[2026.2.12]: https://github.com/acepe/acepe/releases/tag/v2026.2.12
[2026.2.11]: https://github.com/acepe/acepe/releases/tag/v2026.2.11
[2026.2.10]: https://github.com/acepe/acepe/releases/tag/v2026.2.10
