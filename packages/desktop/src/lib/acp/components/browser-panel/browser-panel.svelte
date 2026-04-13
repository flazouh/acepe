<script lang="ts">
import {
	AgentPanelBrowserHeader as SharedAgentPanelBrowserHeader,
	AgentPanelBrowserPanel as SharedAgentPanelBrowserPanel,
} from "@acepe/ui/agent-panel";
import { ResultAsync } from "neverthrow";
import { onDestroy, onMount } from "svelte";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as m from "$lib/messages.js";
import { browserWebview } from "$lib/utils/tauri-client/browser-webview.js";
import { getZoomService } from "$lib/services/zoom.svelte.js";
import { resolveBrowserPanelBounds } from "./logic/browser-panel-bounds.js";
import { createLogger } from "../../utils/logger.js";
import { observeScrollParents } from "./logic/scroll-sync.js";

const logger = createLogger({ id: "browser-panel", name: "BrowserPanel" });

interface Props {
	panelId: string;
	url: string;
	title: string;
	width: number;
	isFullscreenEmbedded?: boolean;
	isFillContainer?: boolean;
	zoomLevel?: number;
	onClose: () => void;
	onResize: (panelId: string, delta: number) => void;
}

const props: Props = $props();

let webviewAreaRef: HTMLDivElement | undefined = $state(undefined);
let webviewCreated = $state(false);
/** True while browserWebview.open() is in-flight (not yet resolved). */
let openPending = false;
let isDestroyed = false;
let closeRequested = false;
let resizeObserver: ResizeObserver | null = null;
let scrollCleanup: (() => void) | null = null;
let currentUrl = $state(props.url);
let lastSyncedUrl = $state(props.url);

let isDragging = $state(false);
let startX = $state(0);

const widthStyle = $derived(
	props.isFullscreenEmbedded || props.isFillContainer
		? "width: 100%; height: 100%;"
		: `width: ${props.width}px;`
);

const webviewLabel = $derived(`browser-${props.panelId}`);
const zoomFallback = getZoomService();
const effectiveZoomLevel = $derived(props.zoomLevel ?? zoomFallback.zoomLevel);

function openInSystemBrowser() {
	openUrl(currentUrl).catch((error) => {
		logger.error("open external failed", { panelId: props.panelId, error });
	});
}

/**
 * Sync the child webview zoom is intentionally NOT done here.
 * The child webview renders external content at its natural zoom (1.0).
 * Alignment with the app zoom is handled entirely through bounds correction
 * in resolveBrowserPanelBounds (CSS pixels × zoom → logical window pixels).
 */

function handleClose() {
	closeRequested = true;
	browserWebview.close(webviewLabel).match(
		() => {
			webviewCreated = false;
		},
		(error) => logger.error("close failed", { panelId: props.panelId, error })
	);
	props.onClose();
}

function resolveNativeBounds() {
	if (!webviewAreaRef) {
		return ResultAsync.fromPromise(
			Promise.reject(new Error("Browser panel area is unavailable")),
			(error) => new Error(`Failed to resolve browser panel bounds: ${String(error)}`)
		);
	}

	const rect = webviewAreaRef.getBoundingClientRect();

	return ResultAsync.fromPromise(
		resolveBrowserPanelBounds(rect, {
			getWindowInnerPosition: async () => ({ x: 0, y: 0 }),
			getWebviewPosition: async () => ({ x: 0, y: 0 }),
			getScaleFactor: async () => 1,
			getZoomLevel: () => effectiveZoomLevel,
		}),
		(error) => new Error(`Failed to resolve browser panel bounds: ${String(error)}`)
	);
}

function navigateToUrl(nextUrl: string) {
	currentUrl = nextUrl;
	closeRequested = false;
	if (webviewCreated) {
		browserWebview.navigate(webviewLabel, nextUrl).match(
			() => undefined,
			(error) => logger.error("navigate failed", { panelId: props.panelId, nextUrl, error })
		);
	}
}

function createWebview() {
	if (!webviewAreaRef || webviewCreated || openPending || isDestroyed) {
		return;
	}

	const label = webviewLabel;
	const requestedUrl = currentUrl;
	openPending = true;
	resolveNativeBounds()
		.andThen((bounds) => {
			return browserWebview.open(
				label,
				requestedUrl,
				bounds.x,
				bounds.y,
				bounds.width,
				bounds.height
			);
		})
		.match(
			() => {
				openPending = false;
				if (isDestroyed || closeRequested) {
					browserWebview.close(label);
					webviewCreated = false;
					return;
				}
				webviewCreated = true;
				// Re-sync bounds after creation in case a ResizeObserver event
				// fired while webviewCreated was still false (race with async open).
				requestAnimationFrame(() => {
					requestAnimationFrame(() => syncWebviewBounds());
				});
				if (currentUrl !== requestedUrl) {
					browserWebview.navigate(label, currentUrl).match(
						() => undefined,
						(error) =>
							logger.error("post-open navigate failed", {
								panelId: props.panelId,
								error,
							})
					);
				}
			},
			(error) => {
				openPending = false;
				logger.error("createWebview failed", { label, error });
			}
		);
}

function syncWebviewBounds() {
	if (!webviewAreaRef || !webviewCreated) {
		return;
	}

	resolveNativeBounds()
		.andThen((bounds) => {
			if (bounds.width <= 0 || bounds.height <= 0) {
				return ResultAsync.fromPromise(
					Promise.resolve(undefined),
					() => new Error("Skipped zero-sized browser panel bounds")
				);
			}

			return browserWebview.resize(webviewLabel, bounds.x, bounds.y, bounds.width, bounds.height);
		})
		.match(
			() => undefined,
			(error) => logger.error("syncWebviewBounds failed", { panelId: props.panelId, error })
		);
}

function destroyWebview() {
	const label = webviewLabel;
	closeRequested = true;

	if (webviewCreated) {
		browserWebview.close(label).match(
			() => undefined,
			(error) => logger.error("destroyWebview close failed", { label, error })
		);
		webviewCreated = false;
	} else if (openPending) {
		// open() is still in-flight. isDestroyed=true will cause the
		// success handler to close it once it resolves. Schedule a
		// deferred close as a safety net.
		setTimeout(() => {
			browserWebview.close(label).match(
				() => undefined,
				() => undefined
			);
		}, 500);
	} else if (closeRequested) {
		browserWebview.close(label).match(
			() => undefined,
			() => undefined
		);
	}
}

function goBack() {
	if (webviewCreated) browserWebview.back(webviewLabel);
}

function goForward() {
	if (webviewCreated) browserWebview.forward(webviewLabel);
}

function reload() {
	if (webviewCreated) browserWebview.reload(webviewLabel);
}

function handlePointerDown(e: PointerEvent) {
	isDragging = true;
	startX = e.clientX;
	(e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function handlePointerMove(e: PointerEvent) {
	if (!isDragging) return;
	const delta = e.clientX - startX;
	startX = e.clientX;
	props.onResize(props.panelId, delta);
}

function handlePointerUp() {
	isDragging = false;
}

onMount(() => {
	// Wait two frames so flex layout settles before reading initial bounds.
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			createWebview();
		});
	});

	if (webviewAreaRef) {
		resizeObserver = new ResizeObserver(() => {
			syncWebviewBounds();
		});
		resizeObserver.observe(webviewAreaRef);
		scrollCleanup = observeScrollParents(webviewAreaRef, () => {
			syncWebviewBounds();
		});
		window.addEventListener("resize", syncWebviewBounds, { passive: true });
	}
});

onDestroy(() => {
	isDestroyed = true;
	resizeObserver?.disconnect();
	scrollCleanup?.();
	window.removeEventListener("resize", syncWebviewBounds);
	destroyWebview();
});

$effect(() => {
	// Track width and layout mode changes to sync webview bounds.
	// Use double-rAF so the layout settles after prop-driven CSS changes.
	props.width;
	props.isFillContainer;
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			syncWebviewBounds();
		});
	});
});

$effect(() => {
	if (props.url !== lastSyncedUrl) {
		lastSyncedUrl = props.url;
		currentUrl = props.url;
	}
});

$effect(() => {
	// When app zoom changes, re-sync bounds because the CSS-to-logical
	// coordinate mapping changes (resolveBrowserPanelBounds scales by zoom).
	effectiveZoomLevel;
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			syncWebviewBounds();
		});
	});
});
</script>

<SharedAgentPanelBrowserPanel
	{widthStyle}
	{isDragging}
	isFillContainer={Boolean(props.isFillContainer)}
>
	{#snippet header()}
		<SharedAgentPanelBrowserHeader
			url={currentUrl}
			backLabel={m.link_preview_back()}
			forwardLabel={m.link_preview_forward()}
			reloadLabel={m.link_preview_refresh()}
			openExternalLabel={m.link_preview_open_browser()}
			closeLabel={m.common_close()}
			onBack={goBack}
			onForward={goForward}
			onReload={reload}
			onNavigate={navigateToUrl}
			onOpenExternal={openInSystemBrowser}
			onClose={handleClose}
		/>
	{/snippet}

	{#snippet body()}
		<div bind:this={webviewAreaRef} class="flex-1 min-h-0 bg-white"></div>
	{/snippet}

	{#if !props.isFullscreenEmbedded}
		{#snippet resizeEdge()}
			<div
				class="absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-primary/20 active:bg-primary/40 transition-colors"
				role="separator"
				aria-orientation="vertical"
				tabindex="-1"
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerup={handlePointerUp}
				onpointercancel={handlePointerUp}
			></div>
		{/snippet}
	{/if}
</SharedAgentPanelBrowserPanel>
