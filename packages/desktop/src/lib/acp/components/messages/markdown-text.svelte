<script lang="ts">
import { openUrl } from "@tauri-apps/plugin-opener";
import { getContext, untrack } from "svelte";
import * as m from "$lib/messages.js";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";
import {
	GITHUB_COMMIT_SHA_PATTERN,
	GITHUB_GIT_REF_PATTERN,
} from "../../constants/github-badge-html.js";
import type { RepoContext } from "../../types/github-integration.js";
import type { ModifiedFilesState } from "../../types/modified-files-state.js";
import "@acepe/ui/markdown-prose.css";

import { useSessionContext } from "../../hooks/use-session-context.js";
import { gitStatusCache } from "../../services/git-status-cache.svelte.js";
import { getRepoContext } from "../../services/github-service.js";
import { getPanelStore } from "../../store/index.js";
import { createLogger } from "../../utils/logger.js";
import {
	renderMarkdown,
	renderMarkdownSync,
	type SyncRenderResult,
} from "../../utils/markdown-renderer.js";
import ContentBlockRenderer from "./content-block-renderer.svelte";
import {
	normalizeToProjectRelativePath,
	resolveDiffStatsForFilePath,
} from "./logic/file-chip-diff-enhancer.js";
import { mountFileBadges } from "./logic/mount-file-badges.js";
import { mountGitHubBadges } from "./logic/mount-github-badges.js";
import { parseContentBlocks } from "./logic/parse-content-blocks.js";
import { parseStreamingTail } from "./logic/parse-streaming-tail.js";
import { streamingTailRefresh } from "./logic/streaming-tail-refresh.js";

const logger = createLogger({ id: "markdown-text", name: "Markdown Text" });
const STREAMING_SYNC_RESULT = {
	html: null,
	fromCache: false,
	needsAsync: false,
} satisfies SyncRenderResult;

const EMPTY_STREAMING_TAIL = { sections: [] };

type StreamingLiveTextRender = {
	fullText: string;
	preservedPrefix: string;
	freshSuffix: string;
};

function buildStreamingLiveTextRender(
	previousText: string | undefined,
	nextText: string
): StreamingLiveTextRender {
	const preservedPrefix = previousText && nextText.startsWith(previousText) ? previousText : "";

	return {
		fullText: nextText,
		preservedPrefix,
		freshSuffix: nextText.slice(preservedPrefix.length),
	};
}

// Get session context (set by VirtualizedEntryList)
const sessionContext = useSessionContext();
const contextProjectPath = $derived(sessionContext?.projectPath);
const ownerPanelId = $derived(sessionContext?.panelId);
const modifiedFilesState = $derived(sessionContext?.modifiedFilesState ?? null);

// Also maintain support for legacy modifiedFilesState context for backward compatibility
const legacyModifiedFilesContext = getContext<
	{ readonly current: ModifiedFilesState | null } | undefined
>("modifiedFilesState");
const legacyModifiedFilesState = $derived(legacyModifiedFilesContext?.current ?? null);
const mergedModifiedFilesState = $derived(modifiedFilesState ?? legacyModifiedFilesState);

interface Props {
	text: string;
	/** Whether content is currently streaming */
	isStreaming?: boolean;
	/**
	 * Project path for opening files in panels.
	 * If not provided, will use projectPath from session context.
	 */
	projectPath?: string;
}

let { text, isStreaming = false, projectPath: propProjectPath }: Props = $props();

// Use context projectPath if no prop provided, otherwise use prop (backward compatibility)
const projectPath = $derived(propProjectPath ?? contextProjectPath);

const panelStore = getPanelStore();

// Link preview dialog state

// DOM reference for markdown container
let markdownContainerRef: HTMLDivElement | null = $state(null);

let gitStatusByPath = $state<ReadonlyMap<string, FileGitStatus> | null>(null);
let lastGitStatusRequestKey = "";

// Fetch and cache repo context for enhancing commit badges
let repoContext = $state<RepoContext | null>(null);

function textNeedsRepoContext(textValue: string): boolean {
	GITHUB_COMMIT_SHA_PATTERN.lastIndex = 0;
	if (GITHUB_COMMIT_SHA_PATTERN.test(textValue)) {
		return true;
	}

	GITHUB_GIT_REF_PATTERN.lastIndex = 0;
	return GITHUB_GIT_REF_PATTERN.test(textValue);
}

function htmlNeedsGitStatus(html: string | null): boolean {
	if (html === null) {
		return false;
	}

	return html.includes("file-path-badge-placeholder");
}

$effect(() => {
	if (!projectPath || repoContext || isStreaming || !textNeedsRepoContext(text)) {
		return;
	}
	// Fetch repo context once on mount
	(async () => {
		const result = await getRepoContext(projectPath);
		result.match(
			(ctx: RepoContext) => {
				repoContext = ctx;
			},
			() => {
				// Silently fail - badges will just be non-interactive
			}
		);
	})();
});

// Try sync rendering first (eliminates flicker for most messages)
const syncResult = $derived.by(() => {
	if (isStreaming) {
		return STREAMING_SYNC_RESULT;
	}

	return renderMarkdownSync(text, repoContext ?? undefined);
});

// Track async state only when needed (large messages or renderer not ready)
let asyncHtml = $state<string | null>(null);
let asyncError = $state<string | null>(null);
let asyncPending = $state(false);

// Track the latest async render request so stale completions cannot overwrite newer content.
let lastAsyncRequestKey = "";

function getAsyncRequestKey(textValue: string, currentRepoContext: RepoContext | null): string {
	if (!currentRepoContext) return `${textValue}::none`;
	return `${textValue}::${currentRepoContext.owner}/${currentRepoContext.repo}`;
}

// Trigger async rendering when sync can't handle it - uses $effect
$effect(() => {
	if (isStreaming) {
		asyncHtml = null;
		asyncError = null;
		asyncPending = false;
		lastAsyncRequestKey = "";
		return;
	}

	const result = syncResult;
	const currentText = text;
	const currentRepoContext = repoContext;
	const requestKey = getAsyncRequestKey(currentText, currentRepoContext);

	if (result.needsAsync && !result.html && requestKey !== lastAsyncRequestKey) {
		lastAsyncRequestKey = requestKey;
		asyncPending = true;
		asyncError = null;

		renderMarkdown(currentText, currentRepoContext ?? undefined).match(
			(html) => {
				if (lastAsyncRequestKey !== requestKey) {
					return;
				}
				asyncHtml = html;
				asyncPending = false;
			},
			(err) => {
				if (lastAsyncRequestKey !== requestKey) {
					return;
				}
				logger.error("Markdown rendering failed:", err);
				asyncError = String(err);
				asyncPending = false;
			}
		);
	}
});

// Fetch git status when projectPath changes.
// Decoupled from modifiedFilesState.totalEditCount — edit count changes don't
// affect git status, and the gitStatusCache handles its own TTL-based refresh.
$effect(() => {
	const currentProjectPath = projectPath;
	const currentVisibleHtml = visibleHtml;

	if (!currentProjectPath || !htmlNeedsGitStatus(currentVisibleHtml)) {
		gitStatusByPath = null;
		lastGitStatusRequestKey = "";
		return;
	}

	if (currentProjectPath === lastGitStatusRequestKey) {
		return;
	}

	lastGitStatusRequestKey = currentProjectPath;

	gitStatusCache.getProjectGitStatusMap(currentProjectPath).match(
		(statusMap) => {
			if (projectPath === currentProjectPath) {
				gitStatusByPath = statusMap;
			}
		},
		(error) => {
			if (projectPath === currentProjectPath) {
				gitStatusByPath = null;
			}
			logger.debug("Failed to load git status for markdown chips", {
				projectPath: currentProjectPath,
				error: String(error),
			});
		}
	);
});

// Determine what to render
const visibleHtml = $derived.by(() => {
	if (isStreaming) return null;
	return syncResult.html ?? asyncHtml ?? null;
});
const streamingTail = $derived.by(() => {
	if (!isStreaming) {
		return EMPTY_STREAMING_TAIL;
	}

	return parseStreamingTail(text);
});
const error = $derived(asyncError);
const isLoading = $derived(syncResult.needsAsync && asyncPending);
let streamingSettledHtmlByKey = $state<ReadonlyMap<string, string>>(new Map());
let streamingLiveTextRenderByKey = $state<ReadonlyMap<string, StreamingLiveTextRender>>(new Map());

// Parse content blocks from HTML (extracts mermaid, github badges, etc.)
// File badge placeholders stay as inline <span>s — mounted as Svelte components below.
const contentBlocks = $derived(visibleHtml ? parseContentBlocks(visibleHtml) : []);
const hasSpecialBlocks = $derived(contentBlocks.some((block) => block.type !== "html"));

// Mount FilePathBadge and GitHubBadge Svelte components into inline placeholder <span>s after DOM render.
// Placeholders stay inside their parent elements (li, p, etc.) so structure is preserved.
$effect(() => {
	const container = markdownContainerRef;
	// Track these so the effect re-runs when html or diff stats change
	void visibleHtml;
	const currentGitStatus = gitStatusByPath;
	const currentModifiedFiles = mergedModifiedFilesState;
	const currentRepoContext = repoContext;

	if (!container || isStreaming || !visibleHtml) return;

	const cleanupFile = mountFileBadges(container, (filePath) =>
		resolveDiffStatsForFilePath(filePath, {
			projectPath,
			gitStatusByPath: currentGitStatus ?? undefined,
			sessionState: currentModifiedFiles,
		})
	);
	const cleanupGitHub = mountGitHubBadges(container, {
		repoContext: currentRepoContext ?? undefined,
		projectPath,
	});

	return () => {
		cleanupFile();
		cleanupGitHub();
	};
});

$effect(() => {
	if (!isStreaming) {
		streamingSettledHtmlByKey = new Map();
		return;
	}

	const previousSettledHtmlByKey = untrack(() => streamingSettledHtmlByKey);
	const nextSettledHtmlByKey = new Map<string, string>();
	for (const section of streamingTail.sections) {
		if (section.kind !== "settled") {
			continue;
		}

		const cachedHtml = previousSettledHtmlByKey.get(section.key);
		if (cachedHtml !== undefined) {
			nextSettledHtmlByKey.set(section.key, cachedHtml);
			continue;
		}

		const result = renderMarkdownSync(section.markdown);
		if (result.html !== null) {
			nextSettledHtmlByKey.set(section.key, result.html);
		}
	}

	streamingSettledHtmlByKey = nextSettledHtmlByKey;
});

$effect(() => {
	if (!isStreaming) {
		streamingLiveTextRenderByKey = new Map();
		return;
	}

	const previousLiveTextRenderByKey = untrack(() => streamingLiveTextRenderByKey);
	const nextLiveTextRenderByKey = new Map<string, StreamingLiveTextRender>();
	for (const section of streamingTail.sections) {
		if (section.kind !== "live-text") {
			continue;
		}

		nextLiveTextRenderByKey.set(
			section.key,
			buildStreamingLiveTextRender(
				previousLiveTextRenderByKey.get(section.key)?.fullText,
				section.text
			)
		);
	}

	streamingLiveTextRenderByKey = nextLiveTextRenderByKey;
});

/**
 * Check if a URL is an external link (http/https).
 */
function isExternalUrl(href: string): boolean {
	return href.startsWith("http://") || href.startsWith("https://");
}

/**
 * Open a link in the system browser.
 */
function openExternalLink(url: string) {
	openUrl(url);
}

/**
 * Handle click events on interactive elements within rendered markdown.
 * - External links: opens in system browser
 * - Color copy buttons: copies color and shows checkmark
 * - File path badges: opens the file in default editor
 */
function handleClick(event: Event) {
	const target = event.target as HTMLElement;

	// Handle anchor tag clicks - open external links in system browser
	const anchor = target.closest("a");
	if (anchor instanceof HTMLAnchorElement) {
		const href = anchor.getAttribute("href");
		if (href && isExternalUrl(href)) {
			event.preventDefault();
			event.stopPropagation();
			openExternalLink(href);
			return;
		}
	}

	// Handle code block copy button clicks
	const codeCopyBtn = target.closest(".code-block-copy");
	if (codeCopyBtn instanceof HTMLElement) {
		const wrapper = codeCopyBtn.closest(".code-block-wrapper");
		const encodedCode = wrapper?.getAttribute("data-code");
		if (encodedCode) {
			navigator.clipboard.writeText(decodeURIComponent(encodedCode));
			codeCopyBtn.classList.add("copied");
			setTimeout(() => {
				codeCopyBtn.classList.remove("copied");
			}, 1500);
		}
		return;
	}

	// Handle color copy button clicks
	const copyBtn = target.closest(".color-copy-btn");
	if (copyBtn instanceof HTMLElement) {
		const color = copyBtn.dataset.color;
		if (color) {
			navigator.clipboard.writeText(color);
			// Show checkmark
			copyBtn.classList.add("copied");
			// Reset after 1.5 seconds
			setTimeout(() => {
				copyBtn.classList.remove("copied");
			}, 1500);
		}
		return;
	}

	// Handle file path badge clicks - open file in panel
	const filePathBadge = target.closest(".file-path-badge");
	if (filePathBadge instanceof HTMLElement) {
		const filePath = filePathBadge.dataset.filePath;
		if (filePath && projectPath) {
			// Convert file path to a path relative to the project
			const relativePath = normalizeToProjectRelativePath(filePath, projectPath);
			panelStore.openFilePanel(relativePath, projectPath, { ownerPanelId });
		} else if (filePath) {
			logger.warn("Cannot open file: no project path available", { filePath });
		}
		return;
	}

	// Handle GitHub badge clicks - open diff viewer modal
	// GitHub badges are rendered as Svelte components that handle their own clicks internally
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		handleClick(event);
	}
}
</script>

{#if error}
	<!-- Show error state -->
	<div class="text-sm text-destructive">
		<p>{m.markdown_render_error({ error })}</p>
		<p class="whitespace-pre-wrap mt-2">{text}</p>
	</div>
{:else if visibleHtml}
	{#if hasSpecialBlocks}
		<!-- Content with mermaid diagrams - render blocks separately -->
		<div
			bind:this={markdownContainerRef}
			class="markdown-content text-sm text-foreground leading-relaxed"
			role="button"
			tabindex="0"
			onclick={handleClick}
			onkeydown={handleKeydown}
		>
			<ContentBlockRenderer blocks={contentBlocks} repoContext={repoContext ?? undefined} />
		</div>
	{:else}
		<!-- No mermaid - render as single HTML block for performance -->
		<div
			bind:this={markdownContainerRef}
			class="markdown-content text-sm text-foreground leading-relaxed"
			role="button"
			tabindex="0"
			onclick={handleClick}
			onkeydown={handleKeydown}
		>
			{@html visibleHtml}
		</div>
	{/if}
{:else if isStreaming}
	<!-- Streaming markdown: keep settled blocks stable and only update the live tail in place -->
	<div
		class="markdown-content text-sm text-foreground leading-relaxed"
		role="button"
		tabindex="0"
		onclick={handleClick}
		onkeydown={handleKeydown}
	>
		{#each streamingTail.sections as section (section.key)}
			<div
				class="streaming-section"
				data-streaming-section-key={section.key}
				use:streamingTailRefresh={{
					active: section.kind !== "settled",
					value:
						section.kind === "settled"
							? ""
							: section.kind === "live-code"
								? section.code
								: section.text,
				}}
			>
				{#if section.kind === "settled"}
					{@const settledHtml = streamingSettledHtmlByKey.get(section.key)}
					{#if settledHtml}
						{@html settledHtml}
					{:else}
						<div class="streaming-live-text whitespace-pre-wrap">{section.markdown}</div>
					{/if}
				{:else if section.kind === "live-code"}
					<pre class="streaming-live-code"><code>{section.code}</code></pre>
				{:else}
					{@const liveTextRender =
						streamingLiveTextRenderByKey.get(section.key) ??
						buildStreamingLiveTextRender(undefined, section.text)}
					<div class="streaming-live-text whitespace-pre-wrap">{liveTextRender.preservedPrefix}{#if liveTextRender.freshSuffix.length > 0}<span class="streaming-live-suffix">{liveTextRender.freshSuffix}</span>{/if}</div>
				{/if}
			</div>
		{/each}
	</div>
{:else if isLoading}
	<!-- Show plain text with min-height while async rendering (rare: large messages only) -->
	<div class="markdown-loading text-sm text-foreground whitespace-pre-wrap leading-relaxed">
		{text}
	</div>
{:else}
	<!-- Fallback: show plain text -->
	<p class="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
		{text}
	</p>
{/if}

<style>
	.markdown-loading {
		min-height: 1.5em;
		opacity: 0.7;
	}

	.streaming-live-suffix {
		display: inline;
		animation: streaming-live-suffix 180ms ease-out;
	}

	@keyframes streaming-live-suffix {
		from {
			opacity: 0;
		}

		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.streaming-live-suffix {
			animation: none;
		}
	}
</style>
