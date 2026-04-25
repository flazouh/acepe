<script lang="ts">
import { openUrl } from "@tauri-apps/plugin-opener";
import { getContext, untrack } from "svelte";
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
import {
	createStreamingRevealController,
	type StreamingRevealController,
} from "./logic/create-streaming-reveal-controller.svelte.js";
import {
	DEFAULT_STREAMING_ANIMATION_MODE,
	type StreamingAnimationMode,
} from "../../types/streaming-animation-mode.js";

const logger = createLogger({ id: "markdown-text", name: "Markdown Text" });
const STREAMING_SYNC_RESULT = {
	html: null,
	fromCache: false,
	needsAsync: false,
} satisfies SyncRenderResult;

const revealedMessageTexts = new Map<string, string>();

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
	streamingAnimationMode?: StreamingAnimationMode;
	onRevealActivityChange?: (active: boolean) => void;
}

type StreamingWordFadeParams = {
	active: boolean;
	marker: string;
	resetKey: string;
};

type TextSegment = {
	text: string;
	isWordLike: boolean;
};

let {
	text,
	isStreaming = false,
	revealKey: _revealKey,
	projectPath: propProjectPath,
	streamingAnimationMode = DEFAULT_STREAMING_ANIMATION_MODE,
	onRevealActivityChange,
}: Props = $props();

// Use context projectPath if no prop provided, otherwise use prop (backward compatibility)
const projectPath = $derived(propProjectPath ?? contextProjectPath);

const panelStore = getPanelStore();

// Link preview dialog state

// DOM reference for markdown container
let markdownContainerRef: HTMLDivElement | null = $state(null);

let gitStatusByPath = $state<ReadonlyMap<string, FileGitStatus> | null>(null);
let lastGitStatusRequestKey = "";
const reveal: StreamingRevealController = createStreamingRevealController(
	untrack(() => streamingAnimationMode)
);
let hasStreamingSession = $state(false);
let wasStreaming = false;
let seedRevealFromSource = $state(false);
let lastRevealKey = $state("");

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

	return html.includes("file-path-badge-placeholder") || html.includes("github-badge-placeholder");
}

$effect(() => {
	const revealKey = _revealKey?.trim() ?? "";
	if (revealKey === lastRevealKey) {
		return;
	}

	lastRevealKey = revealKey;
	if (!revealKey) {
		seedRevealFromSource = false;
		return;
	}

	const priorText = revealedMessageTexts.get(revealKey);
	seedRevealFromSource =
		priorText !== undefined &&
		(text === priorText || text.startsWith(priorText) || priorText.startsWith(text));
	revealedMessageTexts.set(revealKey, text);
});

$effect(() => {
	if (isStreaming) {
		hasStreamingSession = true;
		wasStreaming = true;
		reveal.setState(text, true, { seedFromSource: seedRevealFromSource });
		seedRevealFromSource = false;
		return;
	}

	if (!hasStreamingSession) {
		reveal.reset();
		return;
	}

	if (wasStreaming) {
		wasStreaming = false;
		// Once the source has finished streaming, switch straight to the settled
		// markdown pass so the final DOM is exactly what settled messages use.
		hasStreamingSession = false;
		reveal.reset();
		return;
	}

	if (reveal.isRevealActive) {
		if (reveal.displayedText !== text) {
			reveal.setState(text, false);
		}
		return;
	}

	if (!isStreaming) {
		hasStreamingSession = false;
		reveal.reset();
	}
});

const isRenderingReveal = $derived(isStreaming || reveal.isRevealActive);

$effect(() => {
	onRevealActivityChange?.(isRenderingReveal);
});

$effect(() => {
	return () => {
		onRevealActivityChange?.(false);
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
	const currentRenderedHtmlForBadges = renderedHtmlForBadges;

	if (!currentProjectPath || !htmlNeedsGitStatus(currentRenderedHtmlForBadges)) {
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

// Parse content blocks from HTML (extracts mermaid, github badges, etc.)
// File badge placeholders stay as inline <span>s — mounted as Svelte components below.
const contentBlocks = $derived(visibleHtml ? parseContentBlocks(visibleHtml) : []);
const hasSpecialBlocks = $derived(contentBlocks.some((block) => block.type !== "html"));
const streamingText = $derived(isRenderingReveal ? reveal.displayedText : "");
const streamingSyncResult = $derived.by(() => {
	if (!isRenderingReveal || streamingText.length === 0) {
		return STREAMING_SYNC_RESULT;
	}

	return renderMarkdownSync(streamingText, repoContext ?? undefined);
});
const streamingHtml = $derived(streamingSyncResult.html);
const streamingContentBlocks = $derived(streamingHtml ? parseContentBlocks(streamingHtml) : []);
const streamingHasSpecialBlocks = $derived(
	streamingContentBlocks.some((block) => block.type !== "html")
);
const renderedHtmlForBadges = $derived(visibleHtml ?? streamingHtml);

// Mount FilePathBadge and GitHubBadge Svelte components into inline placeholder <span>s after DOM render.
// Placeholders stay inside their parent elements (li, p, etc.) so structure is preserved.
$effect(() => {
	const container = markdownContainerRef;
	// Track these so the effect re-runs when html or diff stats change
	void renderedHtmlForBadges;
	const currentGitStatus = gitStatusByPath;
	const currentModifiedFiles = mergedModifiedFilesState;
	const currentRepoContext = repoContext;

	if (!container || !renderedHtmlForBadges) return;

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

function shouldSkipWordFade(textNode: Text): boolean {
	const parent = textNode.parentElement;
	if (!parent) {
		return true;
	}

	return (
		parent.closest(
			"[data-reveal-skip], pre, code, button, .file-path-badge, .file-path-badge-placeholder, .github-badge-placeholder"
		) !== null
	);
}

function segmentTextForFade(textValue: string): TextSegment[] {
	const segments: TextSegment[] = [];
	const parts = textValue.split(/(\s+)/);

	for (const part of parts) {
		if (part.length === 0) {
			continue;
		}

		segments.push({
			text: part,
			isWordLike: /^\s+$/.test(part) === false,
		});
	}

	return segments;
}

function replaceTextNodeWithFadedSuffix(textNode: Text, animateFromOffset: number): void {
	const textValue = textNode.nodeValue ?? "";
	const parent = textNode.parentNode;
	if (!parent || textValue.length === 0 || animateFromOffset >= textValue.length) {
		return;
	}

	const fragment = document.createDocumentFragment();
	const stablePrefix = textValue.slice(0, animateFromOffset);
	if (stablePrefix.length > 0) {
		fragment.append(document.createTextNode(stablePrefix));
	}

	for (const segment of segmentTextForFade(textValue.slice(animateFromOffset))) {
		if (!segment.isWordLike) {
			fragment.append(document.createTextNode(segment.text));
			continue;
		}

		const span = document.createElement("span");
		span.className = "sd-word-fade";
		span.textContent = segment.text;
		fragment.append(span);
	}

	parent.replaceChild(fragment, textNode);
}

function applyStreamingWordFade(node: HTMLElement, animateFromTextOffset: number): void {
	const textNodes: Text[] = [];
	const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
		acceptNode(textNode) {
			return textNode instanceof Text && !shouldSkipWordFade(textNode)
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_REJECT;
		},
	});

	let currentNode = walker.nextNode();
	while (currentNode !== null) {
		if (currentNode instanceof Text) {
			textNodes.push(currentNode);
		}
		currentNode = walker.nextNode();
	}

	let textOffset = 0;
	for (const textNode of textNodes) {
		const textValue = textNode.nodeValue ?? "";
		const nextOffset = textOffset + textValue.length;
		if (nextOffset > animateFromTextOffset) {
			replaceTextNodeWithFadedSuffix(textNode, Math.max(0, animateFromTextOffset - textOffset));
		}
		textOffset = nextOffset;
	}
}

function canonicalStreamingWordFade(node: HTMLElement, initialParams: StreamingWordFadeParams) {
	let params = initialParams;
	let lastTextContent = "";
	let lastResetKey = initialParams.resetKey;
	let scheduledVersion = 0;

	function schedule(): void {
		scheduledVersion += 1;
		const version = scheduledVersion;
		queueMicrotask(() => {
			if (version !== scheduledVersion) {
				return;
			}

			if (params.resetKey !== lastResetKey) {
				lastTextContent = "";
				lastResetKey = params.resetKey;
			}

			if (!params.active || params.marker.length === 0) {
				lastTextContent = "";
				return;
			}

			const currentTextContent = node.textContent ?? "";
			const animateFromTextOffset = currentTextContent.startsWith(lastTextContent)
				? lastTextContent.length
				: 0;
			applyStreamingWordFade(node, animateFromTextOffset);
			lastTextContent = currentTextContent;
		});
	}

	schedule();

	return {
		update(nextParams: StreamingWordFadeParams) {
			params = nextParams;
			schedule();
		},
		destroy() {
			scheduledVersion += 1;
		},
	};
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
		<p>{`Markdown rendering failed: ${error}`}</p>
		<p class="whitespace-pre-wrap mt-2">{text}</p>
	</div>
{:else if visibleHtml}
	{#if hasSpecialBlocks}
		<!-- Content with mermaid diagrams - render blocks separately -->
		<div
			bind:this={markdownContainerRef}
			class="markdown-content text-sm text-foreground"
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
			class="markdown-content text-sm text-foreground"
			role="button"
			tabindex="0"
			onclick={handleClick}
			onkeydown={handleKeydown}
		>
			{@html visibleHtml}
		</div>
	{/if}
{:else if isRenderingReveal}
	<div
		bind:this={markdownContainerRef}
		class="markdown-content text-sm text-foreground"
		role="button"
		tabindex="0"
		onclick={handleClick}
		onkeydown={handleKeydown}
		use:canonicalStreamingWordFade={{
			active: isRenderingReveal && streamingHtml !== null && !streamingHasSpecialBlocks,
			marker: streamingHtml ?? "",
			resetKey: lastRevealKey,
		}}
	>
		{#if streamingHtml}
			{#if streamingHasSpecialBlocks}
				<ContentBlockRenderer
					blocks={streamingContentBlocks}
					repoContext={repoContext ?? undefined}
				/>
			{:else}
				{@html streamingHtml}
			{/if}
		{:else}
			<div class="markdown-loading text-sm text-foreground whitespace-pre-wrap">
				{streamingText}
			</div>
		{/if}
	</div>
{:else if isLoading}
	<!-- Show plain text with min-height while async rendering (rare: large messages only) -->
	<div class="markdown-loading text-sm text-foreground whitespace-pre-wrap">
		{text}
	</div>
{:else}
	<!-- Fallback: show plain text -->
	<p class="text-sm text-foreground whitespace-pre-wrap">
		{text}
	</p>
{/if}

<style>
	.markdown-loading {
		min-height: 1.5em;
		opacity: 0.7;
	}
</style>
