<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { browserWebview } from "$lib/utils/tauri-client/browser-webview.js";
import { createLogger } from "../../utils/logger.js";
import BrowserPanelHeader from "./browser-panel-header.svelte";

const logger = createLogger({ id: "browser-panel", name: "BrowserPanel" });

interface Props {
	panelId: string;
	url: string;
	title: string;
	width: number;
	isFullscreenEmbedded?: boolean;
	isFillContainer?: boolean;
	onClose: () => void;
	onResize: (panelId: string, delta: number) => void;
}

let {
	panelId,
	url,
	title: _title,
	width,
	isFullscreenEmbedded = false,
	isFillContainer = false,
	onClose,
	onResize,
}: Props = $props();

let webviewAreaRef: HTMLDivElement | undefined = $state(undefined);
let webviewCreated = $state(false);
/** True while browserWebview.open() is in-flight (not yet resolved). */
let openPending = false;
let isDestroyed = false;
let resizeObserver: ResizeObserver | null = null;

let isDragging = $state(false);
let startX = $state(0);

const widthStyle = $derived(
	isFullscreenEmbedded || isFillContainer ? "width: 100%; height: 100%;" : `width: ${width}px;`
);

const webviewLabel = $derived(`browser-${panelId}`);

function openInSystemBrowser() {
	window.open(url, "_blank", "noopener,noreferrer");
}

function createWebview() {
	if (!webviewAreaRef || webviewCreated || openPending || isDestroyed) {
		logger.info("[browser-debug] createWebview skipped", {
			panelId,
			hasRef: !!webviewAreaRef,
			webviewCreated,
			openPending,
			isDestroyed,
		});
		return;
	}

	const label = webviewLabel;
	const rect = webviewAreaRef.getBoundingClientRect();
	logger.info("[browser-debug] createWebview calling open", {
		label,
		url,
		x: rect.x,
		y: rect.y,
		w: rect.width,
		h: rect.height,
	});
	openPending = true;
	browserWebview.open(label, url, rect.x, rect.y, rect.width, rect.height).match(
		() => {
			openPending = false;
			if (isDestroyed) {
				logger.info("[browser-debug] createWebview: already destroyed, closing", { label });
				browserWebview.close(label);
				return;
			}
			webviewCreated = true;
			logger.info("[browser-debug] createWebview success, scheduling re-sync", { label, url });
			// Re-sync bounds after creation in case a ResizeObserver event
			// fired while webviewCreated was still false (race with async open).
			// Use two frames: first lets flex layout settle, second reads final rect.
			requestAnimationFrame(() => {
				requestAnimationFrame(() => syncWebviewBounds());
			});
		},
		(error) => {
			openPending = false;
			logger.error("[browser-debug] createWebview FAILED", { label, error });
		}
	);
}

function syncWebviewBounds() {
	if (!webviewAreaRef || !webviewCreated) {
		return;
	}

	const rect = webviewAreaRef.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) {
		return;
	}

	logger.info("[browser-debug] syncWebviewBounds resizing", {
		panelId,
		label: webviewLabel,
		x: rect.x,
		y: rect.y,
		w: rect.width,
		h: rect.height,
	});
	browserWebview.resize(webviewLabel, rect.x, rect.y, rect.width, rect.height);
}

function destroyWebview() {
	logger.info("[browser-debug] destroyWebview called", {
		panelId,
		webviewCreated,
		openPending,
		label: webviewLabel,
	});

	const label = webviewLabel;

	if (webviewCreated) {
		// Webview is confirmed open — close it immediately.
		browserWebview.close(label).match(
			() => logger.info("[browser-debug] destroyWebview: close success", { label }),
			(error) => logger.error("[browser-debug] destroyWebview: close FAILED", { label, error })
		);
		webviewCreated = false;
	} else if (openPending) {
		// open() is still in-flight.  isDestroyed=true will cause the
		// .match() success handler above to close it once it resolves.
		// As an extra safety net, schedule a deferred close so the
		// native webview is removed even if a subtle timing issue occurs.
		logger.info("[browser-debug] destroyWebview: open pending, scheduling deferred close", {
			label,
		});
		setTimeout(() => {
			browserWebview.close(label).match(
				() => logger.info("[browser-debug] destroyWebview: deferred close success", { label }),
				(error) =>
					logger.info(
						"[browser-debug] destroyWebview: deferred close (expected if already closed)",
						{ label, error: String(error) }
					)
			);
		}, 500);
	}
	// If neither webviewCreated nor openPending, nothing was ever opened.
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
	onResize(panelId, delta);
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
	}
});

onDestroy(() => {
	isDestroyed = true;
	resizeObserver?.disconnect();
	destroyWebview();
});

$effect(() => {
	// Track width and layout mode changes to sync webview bounds.
	// Use double-rAF so the layout settles after prop-driven CSS changes.
	width;
	isFillContainer;
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			syncWebviewBounds();
		});
	});
});
</script>

<div
	class="flex flex-col h-full min-h-0 bg-background border border-border rounded-lg overflow-hidden relative {isDragging
		? 'select-none'
		: ''} {isFillContainer ? 'flex-1 min-w-0' : 'shrink-0 grow-0'}"
	style={widthStyle}
>
	<BrowserPanelHeader
		{url}
		onBack={goBack}
		onForward={goForward}
		onReload={reload}
		onOpenExternal={openInSystemBrowser}
		{onClose}
	/>

	<div bind:this={webviewAreaRef} class="flex-1 min-h-0 bg-white"></div>

	{#if !isFullscreenEmbedded}
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
	{/if}
</div>
