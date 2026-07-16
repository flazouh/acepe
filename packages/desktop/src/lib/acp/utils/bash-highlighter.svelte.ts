import { ResultAsync } from "neverthrow";
import { createHighlighter } from "shiki";

import { getCursorThemeName, loadCursorLightTheme, loadCursorTheme } from "./shiki-theme.js";
import { exceedsSyntaxHighlightCap } from "./syntax-highlight-cap.js";

type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighter>>;

function stripPreCodeWrapper(html: string): string {
	return html.replace(/^<pre[^>]*><code>/, "").replace(/<\/code><\/pre>$/, "");
}

let ready = $state(false);
let highlighter: ShikiHighlighter | null = null;
let darkThemeName = "";
let lightThemeName = "";

const highlightCache = new Map<string, string>();
const HIGHLIGHT_CACHE_MAX = 64;

function cachedHighlight(cacheKey: string, compute: () => string): string {
	const existing = highlightCache.get(cacheKey);
	if (existing !== undefined) {
		return existing;
	}

	const html = compute();
	if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) {
		const oldestKey = highlightCache.keys().next().value;
		if (oldestKey !== undefined) {
			highlightCache.delete(oldestKey);
		}
	}
	highlightCache.set(cacheKey, html);
	return html;
}

// Start initialization eagerly on module import
loadCursorTheme()
	.andThen((dark) => {
		darkThemeName = getCursorThemeName(dark);
		return loadCursorLightTheme().map((light) => {
			lightThemeName = getCursorThemeName(light);
			return { dark, light };
		});
	})
	.andThen(({ dark, light }) =>
		ResultAsync.fromPromise(
			createHighlighter({
				themes: [dark, light],
				langs: [
					"bash",
					"log",
					"typescript",
					"javascript",
					"tsx",
					"jsx",
					"svelte",
					"json",
					"css",
					"scss",
					"html",
					"markdown",
					"rust",
					"python",
					"yaml",
					"toml",
				],
			}),
			(e) => (e instanceof Error ? e : new Error(String(e)))
		)
	)
	.map((h) => {
		highlighter = h;
		ready = true;
	})
	.mapErr((e) => {
		console.error("[bash-highlighter] init failed:", e);
	});

/**
 * Reactive Shiki bash highlighter singleton.
 *
 * `bashHighlighter.ready` is a `$state` — any `$derived` that reads it
 * (directly or via highlight* methods) will re-compute when the highlighter
 * finishes loading. Highlight methods also enforce {@link exceedsSyntaxHighlightCap}.
 */
export const bashHighlighter = {
	get ready() {
		return ready;
	},

	/**
	 * Highlight a bash command string using the Cursor dual-theme.
	 * Returns inner HTML with `--shiki-light` / `--shiki-dark` CSS variables,
	 * or null if the highlighter isn't initialized yet / content exceeds the cap.
	 */
	highlight(code: string): string | null {
		const active = highlighter;
		if (!ready || !active) return null;
		if (exceedsSyntaxHighlightCap(code)) return null;

		const trimmed = code.trim();
		return cachedHighlight(`bash:${trimmed}`, () => {
			const html = active.codeToHtml(trimmed, {
				lang: "bash",
				themes: {
					dark: darkThemeName,
					light: lightThemeName,
				},
				defaultColor: false,
			});
			return stripPreCodeWrapper(html);
		});
	},

	/**
	 * Highlight terminal tool output (stdout/stderr) with the log grammar.
	 * Preserves content as-is (no trim). Same dual-theme CSS variables as commands.
	 */
	highlightOutput(code: string): string | null {
		const active = highlighter;
		if (!ready || !active) return null;
		if (exceedsSyntaxHighlightCap(code)) return null;

		return cachedHighlight(`log:${code}`, () => {
			const html = active.codeToHtml(code, {
				lang: "log",
				themes: {
					dark: darkThemeName,
					light: lightThemeName,
				},
				defaultColor: false,
			});
			return stripPreCodeWrapper(html);
		});
	},

	/**
	 * Highlight source file content with a language inferred from the file path.
	 * Falls back to TypeScript because most Acepe read tools are TS/Svelte-adjacent.
	 */
	highlightSource(code: string, filePath: string | null | undefined): string | null {
		const active = highlighter;
		if (!ready || !active) return null;
		if (exceedsSyntaxHighlightCap(code)) return null;

		const lang = languageForFilePath(filePath);
		return cachedHighlight(`source:${lang}:${code}`, () => {
			const html = active.codeToHtml(code, {
				lang,
				themes: {
					dark: darkThemeName,
					light: lightThemeName,
				},
				defaultColor: false,
			});
			return stripPreCodeWrapper(html);
		});
	},
};

function languageForFilePath(filePath: string | null | undefined): string {
	const normalized = filePath?.toLowerCase() ?? "";
	const extension = normalized.split(".").pop();

	if (extension === "ts" || extension === "mts" || extension === "cts") return "typescript";
	if (extension === "js" || extension === "mjs" || extension === "cjs") return "javascript";
	if (extension === "tsx") return "tsx";
	if (extension === "jsx") return "jsx";
	if (extension === "svelte") return "svelte";
	if (extension === "json" || extension === "jsonl") return "json";
	if (extension === "css") return "css";
	if (extension === "scss") return "scss";
	if (extension === "html" || extension === "htm") return "html";
	if (extension === "md" || extension === "mdx") return "markdown";
	if (extension === "rs") return "rust";
	if (extension === "py") return "python";
	if (extension === "yml" || extension === "yaml") return "yaml";
	if (extension === "toml") return "toml";

	return "typescript";
}
