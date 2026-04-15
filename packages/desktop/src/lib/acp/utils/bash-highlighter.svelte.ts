import { createHighlighter } from "shiki";
import { ResultAsync } from "neverthrow";

import {
	loadCursorTheme,
	loadCursorLightTheme,
	getCursorThemeName,
} from "./shiki-theme.js";

type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighter>>;

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
				langs: ["bash"],
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

		// Strip <pre class="shiki ..."><code>...</code></pre> wrapper
		return html
			.replace(/^<pre[^>]*><code>/, "")
			.replace(/<\/code><\/pre>$/, "");
	},
};
