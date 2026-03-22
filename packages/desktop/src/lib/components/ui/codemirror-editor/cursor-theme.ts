/**
 * Cursor Dark theme for CodeMirror 6.
 * Based on the VS Code theme at /themes/cursor.theme.json.
 */

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * Editor chrome styling - backgrounds, gutters, cursors, selections.
 */
export const cursorDarkTheme = EditorView.theme(
	{
		// Main editor
		"&": {
			backgroundColor: "rgba(35, 35, 35, 0.5)",
			color: "#D8DEE9",
		},

		// Content area
		".cm-content": {
			caretColor: "#FFFFFF",
			fontFamily:
				"ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace",
			fontSize: "12px",
			padding: "12px 0",
		},

		// Cursor
		".cm-cursor, .cm-dropCursor": {
			borderLeftColor: "#FFFFFF",
			borderLeftWidth: "2px",
		},

		// Gutters (line numbers)
		".cm-gutters": {
			backgroundColor: "rgba(35, 35, 35, 0.5)",
			color: "#505050",
			border: "none",
			paddingLeft: "8px",
		},

		// Active line gutter
		".cm-activeLineGutter": {
			backgroundColor: "#292929",
			color: "#FFFFFF",
		},

		// Active line
		".cm-activeLine": {
			backgroundColor: "#292929",
		},

		// Selection
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
			backgroundColor: "#40404099",
		},

		// Matching brackets
		"&.cm-focused .cm-matchingBracket": {
			backgroundColor: "transparent",
			outline: "1px solid #FFFFFF55",
		},

		// Non-matching bracket
		"&.cm-focused .cm-nonmatchingBracket": {
			backgroundColor: "#BF616A44",
		},

		// Search match
		".cm-searchMatch": {
			backgroundColor: "#88C0D066",
		},

		// Selected search match
		".cm-searchMatch.cm-searchMatch-selected": {
			backgroundColor: "#88C0D099",
		},

		// Selection match highlight
		".cm-selectionMatch": {
			backgroundColor: "#404040CC",
		},

		// Scrollbar
		".cm-scroller": {
			overflow: "auto",
		},

		// Line wrapping
		".cm-line": {
			padding: "0 12px",
		},

		// Fold placeholder
		".cm-foldPlaceholder": {
			backgroundColor: "#2A2A2A",
			border: "none",
			color: "#6d6d6d",
		},

		// Tooltip
		".cm-tooltip": {
			backgroundColor: "#141414",
			border: "1px solid #2A2A2A",
			color: "#FFFFFF",
		},

		// Autocomplete
		".cm-tooltip.cm-tooltip-autocomplete": {
			"& > ul > li[aria-selected]": {
				backgroundColor: "#404040",
				color: "#FFFFFF",
			},
		},

		// Panels (search, etc)
		".cm-panels": {
			backgroundColor: "#141414",
			color: "#FFFFFF",
		},

		".cm-panels.cm-panels-top": {
			borderBottom: "1px solid #2A2A2A",
		},

		".cm-panels.cm-panels-bottom": {
			borderTop: "1px solid #2A2A2A",
		},

		// Text input in panels
		".cm-textfield": {
			backgroundColor: "#2A2A2A55",
			border: "1px solid #2A2A2A",
			color: "#FFFFFF",
		},

		// Button in panels
		".cm-button": {
			backgroundColor: "#565656",
			color: "#FFFFFF",
			border: "none",
		},

		".cm-button:hover": {
			backgroundColor: "#767676",
		},
	},
	{ dark: true }
);

/**
 * Syntax highlighting styles.
 * Maps Lezer highlight tags to colors from the Cursor Dark theme.
 */
export const cursorDarkHighlightStyle = HighlightStyle.define([
	// Comments - #6d6d6d italic
	{ tag: tags.comment, color: "#6d6d6d", fontStyle: "italic" },
	{ tag: tags.lineComment, color: "#6d6d6d", fontStyle: "italic" },
	{ tag: tags.blockComment, color: "#6d6d6d", fontStyle: "italic" },
	{ tag: tags.docComment, color: "#6d6d6d", fontStyle: "italic" },

	// Keywords - #83d6c5
	{ tag: tags.keyword, color: "#83d6c5" },
	{ tag: tags.controlKeyword, color: "#83d6c5" },
	{ tag: tags.operatorKeyword, color: "#83d6c5" },
	{ tag: tags.definitionKeyword, color: "#83d6c5" },
	{ tag: tags.moduleKeyword, color: "#83d6c5" },

	// Storage/modifiers - #82d2ce
	{ tag: tags.modifier, color: "#82d2ce" },
	{ tag: tags.self, color: "#C1808A" },

	// Strings - #e394dc
	{ tag: tags.string, color: "#e394dc" },
	{ tag: tags.special(tags.string), color: "#e394dc" },
	{ tag: tags.docString, color: "#e394dc" },

	// Numbers - #ebc88d
	{ tag: tags.number, color: "#ebc88d" },
	{ tag: tags.integer, color: "#ebc88d" },
	{ tag: tags.float, color: "#ebc88d" },

	// Boolean/null - #82d2ce
	{ tag: tags.bool, color: "#82d2ce" },
	{ tag: tags.null, color: "#82d2ce" },

	// Functions - #efb080
	{ tag: tags.function(tags.variableName), color: "#efb080" },
	{ tag: tags.function(tags.definition(tags.variableName)), color: "#efb080", fontStyle: "bold" },

	// Methods - #ebc88d
	{ tag: tags.function(tags.propertyName), color: "#ebc88d" },
	{ tag: tags.definition(tags.function(tags.propertyName)), color: "#efb080", fontStyle: "bold" },

	// Variables - #d6d6dd
	{ tag: tags.variableName, color: "#d6d6dd" },
	{ tag: tags.local(tags.variableName), color: "#d6d6dd" },

	// Properties - #AA9BF5
	{ tag: tags.propertyName, color: "#AA9BF5" },
	{ tag: tags.definition(tags.propertyName), color: "#AA9BF5" },

	// Constants - #83d6c5
	{ tag: tags.constant(tags.variableName), color: "#83d6c5" },

	// Types/Classes - #87c3ff
	{ tag: tags.typeName, color: "#87c3ff" },
	{ tag: tags.className, color: "#87c3ff" },
	{ tag: tags.namespace, color: "#87c3ff" },

	// Type parameters - #efb080
	{ tag: tags.definition(tags.typeName), color: "#efb080" },

	// Attributes - #aaa0fa italic
	{ tag: tags.attributeName, color: "#aaa0fa", fontStyle: "italic" },
	{ tag: tags.attributeValue, color: "#e394dc" },

	// HTML tags - #87c3ff
	{ tag: tags.tagName, color: "#87c3ff" },
	{ tag: tags.angleBracket, color: "#898989" },

	// Operators - #d6d6dd
	{ tag: tags.operator, color: "#d6d6dd" },
	{ tag: tags.compareOperator, color: "#d6d6dd" },
	{ tag: tags.arithmeticOperator, color: "#d6d6dd" },
	{ tag: tags.logicOperator, color: "#d6d6dd" },
	{ tag: tags.bitwiseOperator, color: "#d6d6dd" },
	{ tag: tags.definitionOperator, color: "#d6d6dd" },

	// Punctuation - #d6d6dd
	{ tag: tags.punctuation, color: "#d6d6dd" },
	{ tag: tags.separator, color: "#d6d6dd" },
	{ tag: tags.bracket, color: "#d6d6dd" },
	{ tag: tags.squareBracket, color: "#d6d6dd" },
	{ tag: tags.paren, color: "#d6d6dd" },
	{ tag: tags.brace, color: "#d6d6dd" },

	// Regular expressions - #d6d6dd
	{ tag: tags.regexp, color: "#d6d6dd" },
	{ tag: tags.special(tags.regexp), color: "#f8c762" },

	// Escape characters - #d6d6dd
	{ tag: tags.escape, color: "#d6d6dd" },

	// Links - #83d6c5
	{ tag: tags.link, color: "#83d6c5" },
	{ tag: tags.url, color: "#83d6c5" },

	// Markdown
	{ tag: tags.heading, color: "#d6d6dd" },
	{ tag: tags.heading1, color: "#d6d6dd" },
	{ tag: tags.heading2, color: "#d6d6dd" },
	{ tag: tags.heading3, color: "#d6d6dd" },
	{ tag: tags.heading4, color: "#d6d6dd" },
	{ tag: tags.heading5, color: "#d6d6dd" },
	{ tag: tags.heading6, color: "#d6d6dd" },
	{ tag: tags.emphasis, color: "#83d6c5", fontStyle: "italic" },
	{ tag: tags.strong, color: "#f8c762", fontStyle: "bold" },
	{ tag: tags.strikethrough, textDecoration: "line-through" },
	{ tag: tags.quote, color: "#6d6d6d" },
	{ tag: tags.monospace, color: "#e394dc" },
	{ tag: tags.processingInstruction, color: "#d6d6dd" },

	// Meta/labels - #aaa0fa
	{ tag: tags.meta, color: "#aaa0fa" },
	{ tag: tags.labelName, color: "#d6d6dd" },

	// Annotations/decorators - #a8cc7c
	{ tag: tags.annotation, color: "#a8cc7c" },

	// Invalid - #f44747
	{ tag: tags.invalid, color: "#f44747" },

	// JSON property names - #82d2ce
	{ tag: tags.special(tags.propertyName), color: "#82d2ce" },

	// CSS
	{ tag: tags.color, color: "#ebc88d" },
	{ tag: tags.unit, color: "#ebc88d" },

	// Changed content (diff)
	{ tag: tags.changed, color: "#efb080" },
	{ tag: tags.inserted, color: "#e394dc" },
	{ tag: tags.deleted, color: "#d6d6dd" },
]);

/**
 * Complete Cursor Dark theme extension.
 * Includes both editor chrome and syntax highlighting.
 */
export const cursorDark: Extension = [
	cursorDarkTheme,
	syntaxHighlighting(cursorDarkHighlightStyle),
];

/**
 * Cursor Light editor chrome styling.
 * Based on /themes/cursor-light.theme.json.
 */
export const cursorLightTheme = EditorView.theme(
	{
		"&": {
			backgroundColor: "#F8F8FA",
			color: "#1a1a1a",
		},

		".cm-content": {
			caretColor: "#1a1a1a",
			fontFamily:
				"ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace",
			fontSize: "12px",
			padding: "12px 0",
		},

		".cm-cursor, .cm-dropCursor": {
			borderLeftColor: "#1a1a1a",
			borderLeftWidth: "2px",
		},

		".cm-gutters": {
			backgroundColor: "#F8F8FA",
			color: "#999999",
			border: "none",
			paddingLeft: "8px",
		},

		".cm-activeLineGutter": {
			backgroundColor: "#F0EFF4",
			color: "#1a1a1a",
		},

		".cm-activeLine": {
			backgroundColor: "#F0EFF4",
		},

		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
			backgroundColor: "#ADD6FF",
		},

		"&.cm-focused .cm-matchingBracket": {
			backgroundColor: "transparent",
			outline: "1px solid #33333355",
		},

		"&.cm-focused .cm-nonmatchingBracket": {
			backgroundColor: "#DC262644",
		},

		".cm-searchMatch": {
			backgroundColor: "#FDE04766",
		},

		".cm-searchMatch.cm-searchMatch-selected": {
			backgroundColor: "#FDE04799",
		},

		".cm-selectionMatch": {
			backgroundColor: "#ADD6FFCC",
		},

		".cm-scroller": {
			overflow: "auto",
		},

		".cm-line": {
			padding: "0 12px",
		},

		".cm-foldPlaceholder": {
			backgroundColor: "#F5F5F5",
			border: "none",
			color: "#666666",
		},

		".cm-tooltip": {
			backgroundColor: "#F5F5F5",
			border: "1px solid #E5E5E5",
			color: "#1a1a1a",
		},

		".cm-tooltip.cm-tooltip-autocomplete": {
			"& > ul > li[aria-selected]": {
				backgroundColor: "#E5E5E5",
				color: "#1a1a1a",
			},
		},

		".cm-panels": {
			backgroundColor: "#F5F5F5",
			color: "#1a1a1a",
		},

		".cm-panels.cm-panels-top": {
			borderBottom: "1px solid #E5E5E5",
		},

		".cm-panels.cm-panels-bottom": {
			borderTop: "1px solid #E5E5E5",
		},

		".cm-textfield": {
			backgroundColor: "#FFFFFF",
			border: "1px solid #E5E5E5",
			color: "#1a1a1a",
		},

		".cm-button": {
			backgroundColor: "#E5E5E5",
			color: "#1a1a1a",
			border: "none",
		},

		".cm-button:hover": {
			backgroundColor: "#D4D4D4",
		},
	},
	{ dark: false }
);

/**
 * Cursor Light syntax highlighting.
 */
export const cursorLightHighlightStyle = HighlightStyle.define([
	{ tag: tags.comment, color: "#6B7280", fontStyle: "italic" },
	{ tag: tags.lineComment, color: "#6B7280", fontStyle: "italic" },
	{ tag: tags.blockComment, color: "#6B7280", fontStyle: "italic" },
	{ tag: tags.docComment, color: "#6B7280", fontStyle: "italic" },

	{ tag: tags.keyword, color: "#0D9488" },
	{ tag: tags.controlKeyword, color: "#0D9488" },
	{ tag: tags.operatorKeyword, color: "#0D9488" },
	{ tag: tags.definitionKeyword, color: "#0D9488" },
	{ tag: tags.moduleKeyword, color: "#0D9488" },

	{ tag: tags.modifier, color: "#0D9488" },
	{ tag: tags.self, color: "#BE185D" },

	{ tag: tags.string, color: "#DB2777" },
	{ tag: tags.special(tags.string), color: "#DB2777" },
	{ tag: tags.docString, color: "#DB2777" },

	{ tag: tags.number, color: "#B45309" },
	{ tag: tags.integer, color: "#B45309" },
	{ tag: tags.float, color: "#B45309" },

	{ tag: tags.bool, color: "#0D9488" },
	{ tag: tags.null, color: "#0D9488" },

	{ tag: tags.function(tags.variableName), color: "#C2410C" },
	{ tag: tags.function(tags.definition(tags.variableName)), color: "#C2410C", fontStyle: "bold" },

	{ tag: tags.function(tags.propertyName), color: "#C2410C" },
	{ tag: tags.definition(tags.function(tags.propertyName)), color: "#C2410C", fontStyle: "bold" },

	{ tag: tags.variableName, color: "#1a1a1a" },
	{ tag: tags.local(tags.variableName), color: "#1a1a1a" },

	{ tag: tags.propertyName, color: "#7C3AED" },
	{ tag: tags.definition(tags.propertyName), color: "#7C3AED" },

	{ tag: tags.constant(tags.variableName), color: "#0D9488" },

	{ tag: tags.typeName, color: "#2563EB" },
	{ tag: tags.className, color: "#2563EB" },
	{ tag: tags.namespace, color: "#2563EB" },

	{ tag: tags.definition(tags.typeName), color: "#C2410C" },

	{ tag: tags.attributeName, color: "#7C3AED", fontStyle: "italic" },
	{ tag: tags.attributeValue, color: "#DB2777" },

	{ tag: tags.tagName, color: "#2563EB" },
	{ tag: tags.angleBracket, color: "#6B7280" },

	{ tag: tags.operator, color: "#1a1a1a" },
	{ tag: tags.compareOperator, color: "#1a1a1a" },
	{ tag: tags.arithmeticOperator, color: "#1a1a1a" },
	{ tag: tags.logicOperator, color: "#1a1a1a" },
	{ tag: tags.bitwiseOperator, color: "#1a1a1a" },
	{ tag: tags.definitionOperator, color: "#1a1a1a" },

	{ tag: tags.punctuation, color: "#1a1a1a" },
	{ tag: tags.separator, color: "#1a1a1a" },
	{ tag: tags.bracket, color: "#1a1a1a" },
	{ tag: tags.squareBracket, color: "#1a1a1a" },
	{ tag: tags.paren, color: "#1a1a1a" },
	{ tag: tags.brace, color: "#1a1a1a" },

	{ tag: tags.regexp, color: "#1a1a1a" },
	{ tag: tags.special(tags.regexp), color: "#B45309" },

	{ tag: tags.escape, color: "#1a1a1a" },

	{ tag: tags.link, color: "#0D9488" },
	{ tag: tags.url, color: "#0D9488" },

	{ tag: tags.heading, color: "#1a1a1a" },
	{ tag: tags.heading1, color: "#1a1a1a" },
	{ tag: tags.heading2, color: "#1a1a1a" },
	{ tag: tags.heading3, color: "#1a1a1a" },
	{ tag: tags.heading4, color: "#1a1a1a" },
	{ tag: tags.heading5, color: "#1a1a1a" },
	{ tag: tags.heading6, color: "#1a1a1a" },
	{ tag: tags.emphasis, color: "#0D9488", fontStyle: "italic" },
	{ tag: tags.strong, color: "#B45309", fontStyle: "bold" },
	{ tag: tags.strikethrough, textDecoration: "line-through" },
	{ tag: tags.quote, color: "#6B7280" },
	{ tag: tags.monospace, color: "#DB2777" },
	{ tag: tags.processingInstruction, color: "#1a1a1a" },

	{ tag: tags.meta, color: "#7C3AED" },
	{ tag: tags.labelName, color: "#1a1a1a" },

	{ tag: tags.annotation, color: "#16A34A" },

	{ tag: tags.invalid, color: "#DC2626" },

	{ tag: tags.special(tags.propertyName), color: "#0D9488" },

	{ tag: tags.color, color: "#B45309" },
	{ tag: tags.unit, color: "#B45309" },

	{ tag: tags.changed, color: "#C2410C" },
	{ tag: tags.inserted, color: "#DB2777" },
	{ tag: tags.deleted, color: "#1a1a1a" },
]);

/**
 * Complete Cursor Light theme extension.
 */
export const cursorLight: Extension = [
	cursorLightTheme,
	syntaxHighlighting(cursorLightHighlightStyle),
];

/**
 * Returns the Cursor CodeMirror extension for the requested theme mode.
 */
export function getCursorThemeExtension(theme: "dark" | "light"): Extension {
	return theme === "light" ? cursorLight : cursorDark;
}
