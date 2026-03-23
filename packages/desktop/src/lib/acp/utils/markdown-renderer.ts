import { createMarkdownRenderer } from "@acepe/ui/markdown";

import { SUPPORTED_LANGUAGES } from "../components/tool-calls/tool-call-edit/constants/index.js";
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

export function renderMarkdown(text: string, repoContext?: { owner: string; repo: string }) {
	return api.renderMarkdown(text, repoContext);
}

export function renderMarkdownSync(text: string, repoContext?: { owner: string; repo: string }) {
	return api.renderMarkdownSync(text, repoContext);
}

export function clearRenderCache(): void {
	api.clearRenderCache();
}

export function getCacheStats(): { size: number; max: number } {
	return api.getCacheStats();
}
