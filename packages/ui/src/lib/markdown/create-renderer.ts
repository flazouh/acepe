import type { ThemeRegistration } from "shiki";

import { ResultAsync, okAsync } from "neverthrow";
import Shiki from "@shikijs/markdown-it";
import { LRUCache } from "lru-cache";
import MarkdownIt from "markdown-it";

import {
	POST_SHIKI_PLUGINS,
	PRE_SHIKI_PLUGINS,
	applyPlugins,
} from "./plugins/registry.js";
import { SUPPORTED_LANGUAGES } from "./constants.js";
import type { MarkdownPlugin } from "./plugins/types.js";

export type { MarkdownPlugin };

const CACHE_CONFIG = { max: 500, ttl: 1000 * 60 * 5 } as const;

export type CreateMarkdownRendererConfig = {
	loadDarkTheme: () => Promise<ThemeRegistration>;
	loadLightTheme: () => Promise<ThemeRegistration>;
	languages?: readonly string[];
	plugins?: { pre?: MarkdownPlugin[]; post?: MarkdownPlugin[] };
	setRepoContext?: (renderer: MarkdownIt, ctx: { owner: string; repo: string }) => void;
	clearRepoContext?: (renderer: MarkdownIt) => void;
};

let renderCache: LRUCache<string, string> | null = null;
let markdownRenderer: MarkdownIt | null = null;
let initResultAsync: ResultAsync<MarkdownIt, Error> | null = null;
let isInitialized = false;
let config: CreateMarkdownRendererConfig | null = null;

function getCache(): LRUCache<string, string> {
	if (!renderCache) {
		renderCache = new LRUCache<string, string>(CACHE_CONFIG);
	}
	return renderCache;
}

export const LARGE_MESSAGE_THRESHOLD = 10 * 1024;

export type SyncRenderResult = {
	html: string | null;
	fromCache: boolean;
	needsAsync: boolean;
};

export function createMarkdownRenderer(
	cfg: CreateMarkdownRendererConfig
): {
	renderMarkdown: (
		text: string,
		repoContext?: { owner: string; repo: string }
	) => ResultAsync<string, Error>;
	renderMarkdownSync: (
		text: string,
		repoContext?: { owner: string; repo: string }
	) => SyncRenderResult;
	getMarkdownRenderer: () => ResultAsync<MarkdownIt, Error>;
	preInitializeMarkdown: () => void;
	isMarkdownInitialized: () => boolean;
	clearRenderCache: () => void;
	getCacheStats: () => { size: number; max: number };
} {
	config = cfg;
	markdownRenderer = null;
	initResultAsync = null;
	isInitialized = false;

	const langList = (cfg.languages ?? SUPPORTED_LANGUAGES).filter((l) => l !== "text");

	function initializeRenderer(): ResultAsync<MarkdownIt, Error> {
		return ResultAsync.fromPromise(
			Promise.all([cfg.loadDarkTheme(), cfg.loadLightTheme()]),
			(e) => (e instanceof Error ? e : new Error(String(e)))
		)
			.andThen(([darkTheme, lightTheme]) =>
				ResultAsync.fromPromise(
					Shiki({
						themes: { dark: darkTheme, light: lightTheme },
						defaultColor: false,
						langs: langList as any,
						defaultLanguage: "typescript",
					}),
					(e) => (e instanceof Error ? e : new Error(String(e)))
				)
			)
			.map((shikiPlugin) => {
				const md = MarkdownIt({
					html: false,
					linkify: true,
					typographer: false,
				});

				const prePlugins = cfg.plugins?.pre ?? PRE_SHIKI_PLUGINS;
				const postPlugins = [...POST_SHIKI_PLUGINS, ...(cfg.plugins?.post ?? [])];
				applyPlugins(md, prePlugins);
				md.use(shikiPlugin);
				applyPlugins(md, postPlugins);

				isInitialized = true;
				markdownRenderer = md;
				return md;
			});
	}

	function getRenderer(): ResultAsync<MarkdownIt, Error> {
		if (markdownRenderer) return okAsync(markdownRenderer);
		if (!initResultAsync) {
			initResultAsync = initializeRenderer();
		}
		return initResultAsync;
	}

	function renderMarkdown(
		text: string,
		repoContext?: { owner: string; repo: string }
	): ResultAsync<string, Error> {
		const cache = getCache();
		const cached = cache.get(text);
		if (cached !== undefined) return okAsync(cached);

		return getRenderer().map((renderer) => {
			if (repoContext && config?.setRepoContext) {
				config.setRepoContext(renderer, repoContext);
			}

			const html = renderer.render(text);

			if (repoContext && config?.clearRepoContext) {
				config.clearRepoContext(renderer);
			} else if (!repoContext) {
				cache.set(text, html);
			}

			return html;
		});
	}

	function renderMarkdownSync(
		text: string,
		repoContext?: { owner: string; repo: string }
	): SyncRenderResult {
		const cache = getCache();
		const cached = cache.get(text);
		if (cached !== undefined) return { html: cached, fromCache: true, needsAsync: false };

		if (text.length > LARGE_MESSAGE_THRESHOLD) {
			return { html: null, fromCache: false, needsAsync: true };
		}

		if (markdownRenderer) {
			if (repoContext && config?.setRepoContext) {
				config.setRepoContext(markdownRenderer, repoContext);
			}

			const html = markdownRenderer.render(text);

			if (repoContext && config?.clearRepoContext) {
				config.clearRepoContext(markdownRenderer);
			} else {
				cache.set(text, html);
			}

			return { html, fromCache: false, needsAsync: false };
		}

		return { html: null, fromCache: false, needsAsync: true };
	}

	function preInitializeMarkdown(): void {
		if (!(isInitialized || initResultAsync)) {
			getRenderer().mapErr((err) => {
				console.error("Failed to pre-initialize markdown renderer:", err);
			});
		}
	}

	function clearRenderCache(): void {
		getCache().clear();
	}

	function getCacheStats(): { size: number; max: number } {
		const c = getCache();
		return { size: c.size, max: CACHE_CONFIG.max };
	}

	const api = {
		renderMarkdown,
		renderMarkdownSync,
		getMarkdownRenderer: getRenderer,
		preInitializeMarkdown,
		isMarkdownInitialized: () => isInitialized,
		clearRenderCache,
		getCacheStats,
	};

	storedApi = api;
	return api;
}

export type MarkdownRenderApi = {
	renderMarkdown: (
		text: string,
		repoContext?: { owner: string; repo: string }
	) => ResultAsync<string, Error>;
	renderMarkdownSync: (
		text: string,
		repoContext?: { owner: string; repo: string }
	) => SyncRenderResult;
};

let storedApi: MarkdownRenderApi | null = null;

/**
 * Returns the markdown renderer API after createMarkdownRenderer has been called.
 * Used by MarkdownDisplay. Returns null if not yet initialized.
 */
export function getMarkdownRenderApi(): MarkdownRenderApi | null {
	return storedApi;
}
