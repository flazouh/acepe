import { ResultAsync } from "neverthrow";
import { createHighlighter } from "shiki";

import { getCursorThemeName, loadCursorLightTheme, loadCursorTheme } from "./shiki-theme.js";

type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighter>>;

function stripPreCodeWrapper(html: string): string {
	return html.replace(/^<pre[^>]*><code>/, "").replace(/<\/code><\/pre>$/, "");
}

let ready = $state(false);
let highlighter: ShikiHighlighter | null = null;
let darkThemeName = "";
let lightThemeName = "";

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
 * will re-compute when the highlighter finishes loading.
 */
export const bashHighlighter = {
	get ready() {
		return ready;
	},

	/**
	 * Highlight a bash command string using the Cursor dual-theme.
	 * Returns inner HTML with `--shiki-light` / `--shiki-dark` CSS variables,
	 * or null if the highlighter isn't initialized yet.
	 */
	highlight(code: string): string | null {
		if (!highlighter) return null;

		const html = highlighter.codeToHtml(code.trim(), {
			lang: "bash",
			themes: {
				dark: darkThemeName,
				light: lightThemeName,
			},
			defaultColor: false,
		});

		return stripPreCodeWrapper(html);
	},

	/**
	 * Highlight terminal tool output (stdout/stderr) with the log grammar.
	 * Preserves content as-is (no trim). Same dual-theme CSS variables as commands.
	 */
	highlightOutput(code: string): string | null {
		if (!highlighter) return null;

		const html = highlighter.codeToHtml(code, {
			lang: "log",
			themes: {
				dark: darkThemeName,
				light: lightThemeName,
			},
			defaultColor: false,
		});

		return stripPreCodeWrapper(html);
	},

	/**
	 * Highlight source file content with a language inferred from the file path.
	 * Falls back to TypeScript because most Acepe read tools are TS/Svelte-adjacent.
	 */
	highlightSource(code: string, filePath: string | null | undefined): string | null {
		if (!highlighter) return null;

		const html = highlighter.codeToHtml(code, {
			lang: languageForFilePath(filePath),
			themes: {
				dark: darkThemeName,
				light: lightThemeName,
			},
			defaultColor: false,
		});

		return stripPreCodeWrapper(html);
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
