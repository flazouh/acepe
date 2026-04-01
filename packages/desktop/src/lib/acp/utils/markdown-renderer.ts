import { createMarkdownRenderer } from "@acepe/ui/markdown";

import { SUPPORTED_LANGUAGES } from "../components/tool-calls/tool-call-edit/constants/index.js";
import { recordHotPathDiagnostic } from "./hot-path-diagnostics.js";
import { rendererRepoContext } from "./renderer-repo-context.js";
import { loadCursorLightTheme, loadCursorTheme } from "./shiki-theme.js";

const api = createMarkdownRenderer({
	loadDarkTheme: async () => {
		const r = await loadCursorTheme();
		return r.match(
			(t) => t,
			(e) => {
				throw e;
			}
		);
	},
	loadLightTheme: async () => {
		const r = await loadCursorLightTheme();
		return r.match(
			(t) => t,
			(e) => {
				throw e;
			}
		);
	},
	languages: SUPPORTED_LANGUAGES,
	plugins: {
		post: [],
	},
	setRepoContext: (renderer, ctx) => {
		rendererRepoContext.set(renderer, ctx);
	},
	clearRepoContext: (renderer) => {
		rendererRepoContext.delete(renderer);
	},
});

export const LARGE_MESSAGE_THRESHOLD = 10 * 1024;

export type SyncRenderResult = ReturnType<typeof api.renderMarkdownSync>;

export function getMarkdownRenderer() {
	return api.getMarkdownRenderer();
}

export function preInitializeMarkdown(): void {
	api.preInitializeMarkdown();
}

export function isMarkdownInitialized(): boolean {
	return api.isMarkdownInitialized();
}

function getNowMs(): number {
	if (typeof performance !== "undefined") {
		return performance.now();
	}
	return Date.now();
}

export function renderMarkdown(text: string, repoContext?: { owner: string; repo: string }) {
	const startedAt = getNowMs();
	recordHotPathDiagnostic("markdown-renderer", "async-request");
	recordHotPathDiagnostic("markdown-renderer", "async-input-chars", text.length);
	return api.renderMarkdown(text, repoContext).map((html) => {
		recordHotPathDiagnostic("markdown-renderer", "async-success");
		recordHotPathDiagnostic("markdown-renderer", "async-duration-ms", getNowMs() - startedAt);
		return html;
	}).mapErr((error) => {
		recordHotPathDiagnostic("markdown-renderer", "async-error");
		recordHotPathDiagnostic("markdown-renderer", "async-duration-ms", getNowMs() - startedAt);
		return error;
	});
}

export function renderMarkdownSync(text: string, repoContext?: { owner: string; repo: string }) {
	const startedAt = getNowMs();
	recordHotPathDiagnostic("markdown-renderer", "sync-request");
	recordHotPathDiagnostic("markdown-renderer", "sync-input-chars", text.length);
	const result = api.renderMarkdownSync(text, repoContext);
	const eventName = result.needsAsync
		? "sync-needs-async"
		: result.fromCache
			? "sync-cache-hit"
			: "sync-render";
	recordHotPathDiagnostic("markdown-renderer", eventName);
	recordHotPathDiagnostic("markdown-renderer", "sync-duration-ms", getNowMs() - startedAt);
	return result;
}

export function clearRenderCache(): void {
	api.clearRenderCache();
}

export function getCacheStats(): { size: number; max: number } {
	return api.getCacheStats();
}
