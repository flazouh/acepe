<script lang="ts">
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	keymap,
	lineNumbers,
} from "@codemirror/view";
import { onDestroy, onMount } from "svelte";
import { createLogger } from "../../../acp/utils/logger.js";
import { getCursorThemeExtension } from "./cursor-theme.js";
import { type GitGutterInput, gitGutterExtension } from "./git-gutter.js";
import { loadLanguageByName } from "./language-loader.js";
import { type EditorThemeMode, observeEditorThemeMode } from "./theme-mode.js";

interface Props {
	value?: string;
	language?: string;
	readonly?: boolean;
	class?: string;
	gitGutterInput?: GitGutterInput;
	onChange?: (value: string) => void;
}

let {
	value = "",
	language = "markdown",
	readonly = false,
	class: className = "",
	gitGutterInput = null,
	onChange,
}: Props = $props();

let containerRef: HTMLDivElement | null = $state(null);
let view: EditorView | null = $state(null);
let themeObserver: MutationObserver | null = null;
let currentThemeMode: EditorThemeMode = $state("dark");
const logger = createLogger({ id: "codemirror-editor", name: "CodeMirrorEditor" });

// Compartments for dynamic reconfiguration
const themeCompartment = new Compartment();
const languageCompartment = new Compartment();
const readonlyCompartment = new Compartment();
const editableCompartment = new Compartment();
const gitGutterCompartment = new Compartment();

// Track programmatic updates to avoid feedback loops
let isProgrammaticUpdate = false;

onMount(() => {
	if (!containerRef) return;
	logger.info("CodeMirror mounted", {
		language,
		readonly,
		hasGitGutterInput: gitGutterInput !== null,
		gitGutterKind: gitGutterInput?.kind ?? null,
	});

	const rootElement = document.documentElement;
	themeObserver = observeEditorThemeMode(rootElement, (mode) => {
		currentThemeMode = mode;
	});

	// Load initial language and create editor
	loadLanguageByName(language).match(
		(langSupport) => {
			createEditor(langSupport ? [langSupport] : []);
		},
		(error) => {
			console.error("Failed to load initial language:", error.message);
			createEditor([]);
		}
	);
});

function createEditor(languageExtension: Extension[]) {
	if (!containerRef) return;

	const updateListener = EditorView.updateListener.of((update) => {
		if (!isProgrammaticUpdate && update.docChanged && onChange) {
			onChange(update.state.doc.toString());
		}
	});

	view = new EditorView({
		parent: containerRef,
		state: EditorState.create({
			doc: value,
			extensions: [
				// Line numbers
				lineNumbers(),
				// Git diff gutter (dynamic)
				gitGutterCompartment.of(gitGutterExtension(gitGutterInput)),
				// Highlight active line
				highlightActiveLine(),
				// Draw selection
				drawSelection(),
				// History (undo/redo)
				history(),
				// Bracket matching
				bracketMatching(),
				// Auto-close brackets
				closeBrackets(),
				// Auto-indent
				indentOnInput(),
				// Custom theme
				themeCompartment.of(getCursorThemeExtension(currentThemeMode)),
				// Language (dynamic)
				languageCompartment.of(languageExtension),
				// Readonly state (dynamic)
				readonlyCompartment.of(EditorState.readOnly.of(readonly)),
				// Editable state (dynamic) to ensure UI/input mode truly switches
				editableCompartment.of(EditorView.editable.of(!readonly)),
				// Update listener for onChange
				updateListener,
				// Keymaps
				keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
			],
		}),
	});
	logger.info("CodeMirror editor created", {
		language,
		hasGitGutterInput: gitGutterInput !== null,
		gitGutterKind: gitGutterInput?.kind ?? null,
		docLength: view.state.doc.length,
		docLines: view.state.doc.lines,
	});
}

onDestroy(() => {
	view?.destroy();
	view = null;
	themeObserver?.disconnect();
	themeObserver = null;
});

// Update theme when app mode changes
$effect(() => {
	if (!view) return;

	view.dispatch({
		effects: themeCompartment.reconfigure(getCursorThemeExtension(currentThemeMode)),
	});
});

// Update value when prop changes
$effect(() => {
	if (view && value !== view.state.doc.toString()) {
		isProgrammaticUpdate = true;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: value },
		});
		isProgrammaticUpdate = false;
	}
});

// Update language when prop changes
$effect(() => {
	if (!view) return;

	loadLanguageByName(language).match(
		(langSupport) => {
			view?.dispatch({
				effects: languageCompartment.reconfigure(langSupport ? [langSupport] : []),
			});
		},
		(error) => {
			console.error("Failed to load language:", error.message);
		}
	);
});

// Update readonly when prop changes
$effect(() => {
	if (view) {
		view.dispatch({
			effects: [
				readonlyCompartment.reconfigure(EditorState.readOnly.of(readonly)),
				editableCompartment.reconfigure(EditorView.editable.of(!readonly)),
			],
		});
	}
});

// Update git gutter when diff data changes
$effect(() => {
	if (!view) return;
	const currentInput = gitGutterInput;
	logger.info("Reconfiguring git gutter", {
		hasInput: currentInput !== null,
		kind: currentInput?.kind ?? null,
		oldLength: currentInput?.kind === "modified" ? currentInput.oldContent.length : 0,
		docLength: view.state.doc.length,
		docLines: view.state.doc.lines,
	});

	view.dispatch({
		effects: gitGutterCompartment.reconfigure(gitGutterExtension(currentInput)),
	});
});
</script>

<div bind:this={containerRef} class="h-full w-full {className}"></div>

<style>
	/* Ensure the editor fills its container */
	div :global(.cm-editor) {
		height: 100%;
	}

	div :global(.cm-scroller) {
		overflow: auto;
	}
</style>
