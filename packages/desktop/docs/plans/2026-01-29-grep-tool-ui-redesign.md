# Grep Tool UI Redesign

## Overview

Redesign the search/grep tool UI to display results more clearly with a two-line header layout featuring an L-shaped arrow connecting the action to its result, and an expandable table showing file matches with line numbers and highlighted content.

## Header Layout

```
┌──────────────────────────────────────────────────────────────┐
│ [▼] Grepped for `pattern`                                    │
│     └─→ Found 45 files                        [CSS L-arrow]  │
└──────────────────────────────────────────────────────────────┘
```

### States

1. **Pending:** "Grepping" with shimmer text effect, pattern in code badge
2. **Completed:** "Grepped" (static), L-arrow, result count below

### Key Elements

- No spinner, no magnifying glass icon
- Chevron for expand/collapse (visible on hover or when expanded)
- Pattern shown in `<code>` badge
- CSS/SVG L-shaped arrow (goes down then right) connecting action to result
- Two-line layout with result indented under the arrow

## Content Mode (Grep with Line Numbers)

When expanded, shows a flat table with file, line number, and content:

```
┌────────────────┬──────┬─────────────────────────────────┐
│ session.rs     │  42  │ fn parse_█pattern█() {          │
│ session.rs     │  58  │ let █pattern█ = input;          │
│ types.ts       │ 123  │ export type █Pattern█ = ...     │
│ utils.ts       │   7  │ // █pattern█ matching           │
└────────────────┴──────┴─────────────────────────────────┘
```

### Columns

1. **File name:** Badge with file icon, clickable to open file panel
2. **Line number:** Right-aligned, monospace, muted color
3. **Content:** Line text with highlighted matches (accent background)

### Behavior

- Initially collapsed (shows first 5 rows)
- Footer with "Show more" / "Show less" toggle
- Max height 300px with scroll for long results
- Click file name to open in panel

## File-Only Mode (Glob/Find)

Simpler single-column list when search returns only file paths:

```
 📄 components/button.svelte
 📄 components/input.svelte
 📄 routes/+page.svelte
```

- File icon + relative path
- Same expand/collapse (5 items initially)
- Click to open file panel

### Mode Detection

- `toolResponse.mode === "content"` → table with line numbers
- `toolResponse.mode === "files_with_matches"` or array of strings → file list

## Data Structure

### Grep Tool Response (from Claude Code)

```typescript
interface GrepToolResponse {
	mode: "content" | "files_with_matches" | "count";
	numFiles: number;
	numLines?: number;
	filenames: string[];
	content?: string; // Raw grep output: "file:line:content" format
}
```

### Parsed Result

```typescript
interface SearchMatch {
	filePath: string;
	fileName: string;
	lineNumber: number;
	content: string;
	isMatch: boolean; // true = match line, false = context line
}

interface SearchResult {
	mode: "content" | "files" | "count";
	numFiles: number;
	numMatches?: number;
	matches: SearchMatch[];
	files: string[];
}
```

### Grep Output Parsing

Raw output format:

```
/path/file.rs-123-context line before
/path/file.rs:124:matching line
/path/file.rs-125-context line after
```

- `:` separator = actual match
- `-` separator = context line (from -A/-B flags)

## Component Structure

```
tool-call-search/
├── components/
│   ├── search-tool-ui.svelte          # Main container (modify)
│   ├── search-tool-header.svelte      # Header with L-arrow (rewrite)
│   ├── search-tool-content.svelte     # Content table (rewrite)
│   ├── search-tool-l-arrow.svelte     # CSS/SVG L-shaped arrow (new)
│   └── search-match-highlight.svelte  # Text with highlighted matches (new)
├── logic/
│   └── parse-grep-output.ts           # Parse grep format (new)
├── types/
│   └── search-result.ts               # Type definitions (new)
└── index.ts
```

## i18n Keys

New message keys needed in `messages/en.json`:

```json
{
	"tool_grep_grepping": "Grepping",
	"tool_grep_grepped": "Grepped",
	"tool_grep_searched": "Searched",
	"tool_grep_searching": "Searching",
	"tool_grep_found_files": "Found {count} {count, plural, one {file} other {files}}",
	"tool_grep_found_matches": "Found {count} {count, plural, one {match} other {matches}}",
	"tool_grep_for": "for"
}
```

## Implementation Notes

1. L-arrow uses CSS borders or SVG path, not Unicode characters
2. Match highlighting uses regex to find pattern in content line
3. File icons reuse existing `FileIconName` component
4. Table uses fixed-width columns for alignment
5. Line numbers are monospace for consistent width
