/**
 * Git diff gutter markers for CodeMirror 6.
 *
 * Shows VS Code-style colored bars in the gutter:
 * - Green: added lines
 * - Blue: modified lines (replaced content)
 * - Red triangle: deleted lines
 */

import { Colors } from "@acepe/ui/colors";
import type { Extension } from "@codemirror/state";
import { type RangeSet, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	EditorView,
	GutterMarker,
	gutter,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import * as Diff from "diff";

import { createLogger } from "../../../acp/utils/logger.js";

const logger = createLogger({ id: "git-gutter", name: "GitGutter" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LineDiffKind = "added" | "modified" | "deleted";

export type GitGutterInput = { kind: "new-file" } | { kind: "modified"; oldContent: string } | null;

export interface LineDiff {
	line: number;
	kind: LineDiffKind;
}

// ---------------------------------------------------------------------------
// GutterMarker singletons
// ---------------------------------------------------------------------------

class GitGutterMarker extends GutterMarker {
	override elementClass: string;
	private readonly markerClass: string;

	constructor(elementClass: string, markerClass: string) {
		super();
		this.elementClass = elementClass;
		this.markerClass = markerClass;
	}

	override eq(other: GutterMarker): boolean {
		return other instanceof GitGutterMarker && other.elementClass === this.elementClass;
	}

	override toDOM(): HTMLElement {
		const marker = document.createElement("span");
		marker.className = `cm-git-gutter-marker ${this.markerClass}`;
		return marker;
	}
}

const ADDED = new GitGutterMarker("cm-git-gutter-added", "cm-git-gutter-marker-added");
const MODIFIED = new GitGutterMarker("cm-git-gutter-modified", "cm-git-gutter-marker-modified");
const DELETED = new GitGutterMarker("cm-git-gutter-deleted", "cm-git-gutter-marker-deleted");

const MARKER_MAP: Record<LineDiffKind, GitGutterMarker> = {
	added: ADDED,
	modified: MODIFIED,
	deleted: DELETED,
};

const LINE_CLASS_BY_KIND: Record<LineDiffKind, string> = {
	added: "cm-git-line-added",
	modified: "cm-git-line-modified",
	deleted: "cm-git-line-deleted",
};

// ---------------------------------------------------------------------------
// Pure diff logic (no CodeMirror dependency — easy to test)
// ---------------------------------------------------------------------------

/**
 * Compute line-level diff annotations from old/new content.
 *
 * @param oldContent - Content at HEAD (null for new files)
 * @param newContent - Current working directory content
 * @returns Array of {line, kind} sorted by line number (1-indexed)
 */
export function computeLineDiffs(oldContent: string | null, newContent: string): LineDiff[] {
	if (oldContent === null) {
		const lineCount = newContent === "" ? 1 : newContent.split("\n").length;
		return Array.from({ length: lineCount }, (_, i) => ({
			line: i + 1,
			kind: "added" as const,
		}));
	}

	if (oldContent === newContent) {
		return [];
	}

	const changes = Diff.diffLines(oldContent, newContent);
	const result: LineDiff[] = [];
	let newLine = 1;

	for (let i = 0; i < changes.length; i++) {
		const change = changes[i]!;
		const lines = splitChangeLines(change.value);

		if (change.removed) {
			// Check if the next change is added (removed+added = modified)
			const next = changes[i + 1];
			if (next?.added) {
				// This is a modification: skip the removed block, mark added lines as modified
				const addedLines = splitChangeLines(next.value);
				for (const _ of addedLines) {
					result.push({ line: newLine, kind: "modified" });
					newLine++;
				}
				// Skip the next change since we already processed it
				i++;
			} else {
				// Pure deletion — place marker on the next line, or the last line if at EOF
				const totalNewLines = countNewContentLines(newContent);
				const markerLine = Math.min(newLine, totalNewLines);
				if (markerLine >= 1) {
					result.push({ line: markerLine, kind: "deleted" });
				}
			}
		} else if (change.added) {
			for (const _ of lines) {
				result.push({ line: newLine, kind: "added" });
				newLine++;
			}
		} else {
			// Unchanged lines — just advance the line counter
			newLine += lines.length;
		}
	}

	return result;
}

/** Split a change value into lines, removing trailing empty string from split. */
function splitChangeLines(value: string): string[] {
	const lines = value.split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
}

/** Count lines in the new content. */
function countNewContentLines(content: string): number {
	if (content === "") return 1;
	const lines = content.split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") {
		return lines.length - 1;
	}
	return lines.length;
}

// ---------------------------------------------------------------------------
// Base theme (extension owns its styles)
// ---------------------------------------------------------------------------

const gitGutterBaseTheme = EditorView.baseTheme({
	".cm-git-gutter": {
		width: "3px",
		minWidth: "3px",
		marginRight: "3px",
	},
	".cm-git-gutter .cm-gutterElement": {
		padding: "0 !important",
		width: "3px",
		minWidth: "3px",
	},
	".cm-git-gutter .cm-git-gutter-marker": {
		display: "block",
		width: "3px",
		height: "100%",
		minHeight: "1em",
	},
	".cm-git-gutter .cm-git-gutter-marker-deleted": {
		position: "relative",
	},
	".cm-git-gutter .cm-git-gutter-marker-deleted::before": {
		content: '""',
		position: "absolute",
		left: "0",
		top: "0",
		width: "0",
		height: "0",
		borderTop: "4px solid transparent",
		borderBottom: "4px solid transparent",
		borderLeft: "3px solid currentColor",
	},

	// Added — green bar (class applied to .cm-gutterElement)
	"&dark .cm-gutterElement.cm-git-gutter-added": {
		backgroundColor: withAlpha(Colors.green, 0.45),
	},
	"&light .cm-gutterElement.cm-git-gutter-added": {
		backgroundColor: withAlpha(Colors.green, 0.68),
	},

	// Modified — blue bar
	"&dark .cm-gutterElement.cm-git-gutter-modified": {
		backgroundColor: withAlpha(Colors.cyan, 0.45),
	},
	"&light .cm-gutterElement.cm-git-gutter-modified": {
		backgroundColor: withAlpha(Colors.cyan, 0.68),
	},

	// Deleted — red bar (thin)
	"&dark .cm-gutterElement.cm-git-gutter-deleted": {
		backgroundColor: withAlpha(Colors.red, 0.5),
		color: withAlpha(Colors.red, 0.8),
	},
	"&light .cm-gutterElement.cm-git-gutter-deleted": {
		backgroundColor: withAlpha(Colors.red, 0.75),
		color: withAlpha(Colors.red, 0.95),
	},

	// Fallback marker coloring in case gutter element classes are not applied by runtime.
	"&dark .cm-git-gutter .cm-git-gutter-marker-added": {
		backgroundColor: withAlpha(Colors.green, 0.45),
	},
	"&light .cm-git-gutter .cm-git-gutter-marker-added": {
		backgroundColor: withAlpha(Colors.green, 0.68),
	},
	"&dark .cm-git-gutter .cm-git-gutter-marker-modified": {
		backgroundColor: withAlpha(Colors.cyan, 0.45),
	},
	"&light .cm-git-gutter .cm-git-gutter-marker-modified": {
		backgroundColor: withAlpha(Colors.cyan, 0.68),
	},
	"&dark .cm-git-gutter .cm-git-gutter-marker-deleted": {
		backgroundColor: withAlpha(Colors.red, 0.5),
		color: withAlpha(Colors.red, 0.8),
	},
	"&light .cm-git-gutter .cm-git-gutter-marker-deleted": {
		backgroundColor: withAlpha(Colors.red, 0.75),
		color: withAlpha(Colors.red, 0.95),
	},

	// Inline line highlights for "write" mode editing.
	"&dark .cm-line.cm-git-line-added": {
		backgroundColor: withAlpha(Colors.green, 0.16),
	},
	"&light .cm-line.cm-git-line-added": {
		backgroundColor: withAlpha(Colors.green, 0.22),
	},
	"&dark .cm-line.cm-git-line-modified": {
		backgroundColor: withAlpha(Colors.cyan, 0.16),
	},
	"&light .cm-line.cm-git-line-modified": {
		backgroundColor: withAlpha(Colors.cyan, 0.22),
	},
	"&dark .cm-line.cm-git-line-deleted": {
		backgroundColor: withAlpha(Colors.red, 0.18),
	},
	"&light .cm-line.cm-git-line-deleted": {
		backgroundColor: withAlpha(Colors.red, 0.24),
	},
});

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

/**
 * Create a CodeMirror extension that shows git diff gutter markers.
 *
 * Returns an empty array when input is null (no gutter shown).
 * Uses a static RangeSet — reconfigure via Compartment when data changes.
 */
export function gitGutterExtension(input: GitGutterInput): Extension {
	if (input === null) return [];

	const oldContent = input.kind === "new-file" ? null : input.oldContent;
	logger.info("Git gutter extension configured", {
		kind: input.kind,
		hasOldContent: oldContent !== null,
		oldLength: oldContent?.length ?? 0,
	});

	return [
		gutter({
			class: "cm-git-gutter",
			markers(view) {
				const newContent = view.state.doc.toString();
				const diffs = computeLineDiffs(oldContent, newContent);
				const builder = new RangeSetBuilder<GutterMarker>();
				let appliedMarkers = 0;

				for (const diff of diffs) {
					if (diff.line >= 1 && diff.line <= view.state.doc.lines) {
						const pos = view.state.doc.line(diff.line).from;
						builder.add(pos, pos, MARKER_MAP[diff.kind]);
						appliedMarkers++;
					}
				}

				logger.info("Git gutter markers computed", {
					docLines: view.state.doc.lines,
					newLength: newContent.length,
					diffCount: diffs.length,
					appliedMarkers,
					diffPreview: diffs.slice(0, 8),
				});

				return builder.finish();
			},
		}),
		createLineHighlightPlugin(oldContent),
		gitGutterBaseTheme,
	];
}

function createLineHighlightPlugin(oldContent: string | null): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: RangeSet<Decoration>;

			constructor(view: EditorView) {
				this.decorations = buildLineDecorations(view, oldContent);
			}

			update(update: ViewUpdate): void {
				if (update.docChanged) {
					this.decorations = buildLineDecorations(update.view, oldContent);
				}
			}
		},
		{
			decorations: (plugin) => plugin.decorations,
		}
	);
}

function buildLineDecorations(view: EditorView, oldContent: string | null): RangeSet<Decoration> {
	const diffs = computeLineDiffs(oldContent, view.state.doc.toString());
	const builder = new RangeSetBuilder<Decoration>();

	for (const diff of diffs) {
		if (diff.line >= 1 && diff.line <= view.state.doc.lines) {
			const line = view.state.doc.line(diff.line);
			builder.add(line.from, line.from, Decoration.line({ class: LINE_CLASS_BY_KIND[diff.kind] }));
		}
	}

	return builder.finish();
}

function withAlpha(hex: string, alpha: number): string {
	const normalized = hex.trim();
	if (!normalized.startsWith("#") || normalized.length !== 7) {
		return hex;
	}
	const r = Number.parseInt(normalized.slice(1, 3), 16);
	const g = Number.parseInt(normalized.slice(3, 5), 16);
	const b = Number.parseInt(normalized.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
