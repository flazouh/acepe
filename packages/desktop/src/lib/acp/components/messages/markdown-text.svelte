<script lang="ts">
import { openUrl } from "@tauri-apps/plugin-opener";
import { getContext, untrack } from "svelte";
import * as m from "$lib/paraglide/messages.js";
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
import { createStreamingReveal } from "./logic/create-streaming-reveal.svelte.js";
import {
	parseStreamingTailIncremental,
	type StreamingTailParseResult,
} from "./logic/parse-streaming-tail.js";

const logger = createLogger({ id: "markdown-text", name: "Markdown Text" });
const STREAMING_SYNC_RESULT = {
	html: null,
	fromCache: false,
	needsAsync: false,
} satisfies SyncRenderResult;

const EMPTY_STREAMING_TAIL = { sections: [] } satisfies StreamingTailParseResult;
const seededRevealKeys = new Set<string>();

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
	revealKey?: string;
	/**
	 * Project path for opening files in panels.
	 * If not provided, will use projectPath from session context.
	 */
	projectPath?: string;
}

let { text, isStreaming = false, revealKey, projectPath: propProjectPath }: Props = $props();

// Use context projectPath if no prop provided, otherwise use prop (backward compatibility)
const projectPath = $derived(propProjectPath ?? contextProjectPath);

const panelStore = getPanelStore();

// Link preview dialog state

// DOM reference for markdown container
let markdownContainerRef: HTMLDivElement | null = $state(null);

let gitStatusByPath = $state<ReadonlyMap<string, FileGitStatus> | null>(null);
let lastGitStatusRequestKey = "";
const reveal = createStreamingReveal();
let hasStreamingSession = $state(false);
let hasObservedRevealSource = $state(false);
let streamingTail = $state<StreamingTailParseResult>(EMPTY_STREAMING_TAIL);
let lastStreamingTailText = "";
let lastStreamingTailResult: StreamingTailParseResult = EMPTY_STREAMING_TAIL;

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

function htmlNeedsBadgeMount(html: string | null): boolean {
	if (html === null) {
		return false;
	}

	return (
		html.includes("file-path-badge-placeholder") || html.includes("github-badge-placeholder")
	);
}

$effect(() => {
	if (isStreaming) {
		const seedFromSource =
			!hasObservedRevealSource &&
			text.length > 0 &&
			revealKey !== undefined &&
			seededRevealKeys.has(revealKey);
		hasStreamingSession = true;
		reveal.setState(text, true, { seedFromSource });
		hasObservedRevealSource = true;
		if (revealKey !== undefined) {
			seededRevealKeys.add(revealKey);
		}
		return;
	}

	if (!hasStreamingSession) {
		reveal.reset();
		hasObservedRevealSource = text.length > 0;
		if (revealKey !== undefined) {
			seededRevealKeys.delete(revealKey);
		}
		return;
	}

	reveal.setState(text, false);
	hasObservedRevealSource = true;
	if (!reveal.isRevealActive) {
		hasStreamingSession = false;
	}
});

const isRenderingReveal = $derived(isStreaming || reveal.isRevealActive);
const showStreamingCursor = $derived(reveal.cursorVisible);

$effect(() => {
	return () => {
		reveal.destroy();
	};
});

$effect(() => {
	if (!projectPath || repoContext || isRenderingReveal || !textNeedsRepoContext(text)) {
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
	if (isRenderingReveal) {
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
	if (isRenderingReveal) {
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
	if (isRenderingReveal) return null;
	return syncResult.html ?? asyncHtml ?? null;
});
const error = $derived(asyncError);
const isLoading = $derived(syncResult.needsAsync && asyncPending);
let streamingSettledHtmlByKey = $state<ReadonlyMap<string, string>>(new Map());
const hasLiveStreamingSection = $derived(
	streamingTail.sections.some((section) => section.kind !== "settled")
);

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

	if (!container || !visibleHtml) return;

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
	if (!isRenderingReveal) {
		streamingTail = EMPTY_STREAMING_TAIL;
		lastStreamingTailText = "";
		lastStreamingTailResult = EMPTY_STREAMING_TAIL;
		return;
	}

	const nextStreamingText = reveal.displayedText;
	const nextStreamingTail = parseStreamingTailIncremental(
		lastStreamingTailText,
		lastStreamingTailResult,
		nextStreamingText
	);
	streamingTail = nextStreamingTail;
	lastStreamingTailText = nextStreamingText;
	lastStreamingTailResult = nextStreamingTail;
});

$effect(() => {
	if (!isRenderingReveal) {
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
		if (result.html !== null && !htmlNeedsBadgeMount(result.html)) {
			nextSettledHtmlByKey.set(section.key, result.html);
		}
	}

	streamingSettledHtmlByKey = nextSettledHtmlByKey;
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
{:else if isRenderingReveal}
	<!-- Streaming markdown: keep settled blocks stable and only update the live tail in place -->
	<div
		class="markdown-content text-sm text-foreground leading-relaxed"
		role="button"
		tabindex="0"
		onclick={handleClick}
		onkeydown={handleKeydown}
	>
		{#each streamingTail.sections as section, index (section.key)}
			{@const isLastSection = index === streamingTail.sections.length - 1}
			<div class="streaming-section" data-streaming-section-key={section.key}>
				{#if section.kind === "settled"}
					{@const settledHtml = streamingSettledHtmlByKey.get(section.key)}
					{#if settledHtml}
						{@html settledHtml}
					{:else}
						<div class="streaming-live-text whitespace-pre-wrap">{section.markdown}</div>
					{/if}
				{:else if section.kind === "live-code"}
					<pre class="streaming-live-code"><code>{section.code}{#if showStreamingCursor && isLastSection}<span class="streaming-live-cursor" aria-hidden="true"></span>{/if}</code></pre>
				{:else}
					<div class="streaming-live-text whitespace-pre-wrap">{section.text}{#if showStreamingCursor && isLastSection}<span class="streaming-live-cursor" aria-hidden="true"></span>{/if}</div>
				{/if}
			</div>
		{/each}
		{#if showStreamingCursor && !hasLiveStreamingSection}
			<div class="streaming-live-text whitespace-pre-wrap">
				<span class="streaming-live-cursor" aria-hidden="true"></span>
			</div>
		{/if}
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

	.streaming-live-cursor {
		display: inline-block;
		width: 0.55ch;
		height: 1em;
		margin-left: 0.1ch;
		vertical-align: -0.1em;
		background: currentColor;
		opacity: 0.45;
		animation: streaming-live-cursor 1s steps(1, end) infinite;
	}

	@keyframes streaming-live-cursor {
		0%,
		49% {
			opacity: 0.45;
		}

		50%,
		100% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.streaming-live-cursor {
			animation: none;
		}
	}
</style>
