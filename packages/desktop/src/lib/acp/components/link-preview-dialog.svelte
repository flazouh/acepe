<script lang="ts">
import { ArrowLeft } from "phosphor-svelte";
import { ArrowRight } from "phosphor-svelte";
import { ArrowSquareOut } from "phosphor-svelte";
import { ArrowsClockwise } from "phosphor-svelte";
import { WarningCircle } from "phosphor-svelte";
import { untrack } from "svelte";
import * as Dialog from "@acepe/ui/dialog";
import { Spinner } from "$lib/components/ui/spinner/index.js";
interface Props {
	url: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

let { url, open = $bindable(), onOpenChange }: Props = $props();

let iframeRef: HTMLIFrameElement | null = $state(null);
let isLoading = $state(true);
let loadError = $state(false);
// Use untrack to read initial value without warning - the $effect below handles reactive updates
let currentUrl = $state(untrack(() => url));

// Reset state when URL changes
$effect(() => {
	if (url) {
		currentUrl = url;
		isLoading = true;
		loadError = false;
	}
});

// Reset state when dialog opens
$effect(() => {
	if (open) {
		isLoading = true;
		loadError = false;
	}
});

function handleIframeLoad() {
	isLoading = false;
}

function handleIframeError() {
	isLoading = false;
	loadError = true;
}

function refresh() {
	if (iframeRef) {
		isLoading = true;
		loadError = false;
		iframeRef.src = currentUrl;
	}
}

function goBack() {
	if (iframeRef?.contentWindow) {
		iframeRef.contentWindow.history.back();
	}
}

function goForward() {
	if (iframeRef?.contentWindow) {
		iframeRef.contentWindow.history.forward();
	}
}

function openInBrowser() {
	window.open(currentUrl, "_blank", "noopener,noreferrer");
}

/**
 * Extract domain from URL for display
 */
function getDomain(urlString: string): string {
	try {
		const urlObj = new URL(urlString);
		return urlObj.hostname;
	} catch {
		return urlString;
	}
}
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Content
		class="max-w-[95vw] sm:max-w-6xl h-[90vh] flex flex-col gap-0 p-0 overflow-hidden"
		showCloseButton={false}
	>
		<!-- Browser-like toolbar -->
		<div class="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/30 shrink-0">
			<!-- Navigation buttons -->
			<div class="flex items-center gap-1">
				<button
					type="button"
					onclick={goBack}
					class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
					title={"Go back"}
				>
					<ArrowLeft class="h-4 w-4" weight="regular" />
				</button>
				<button
					type="button"
					onclick={goForward}
					class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
					title={"Go forward"}
				>
					<ArrowRight class="h-4 w-4" weight="regular" />
				</button>
				<button
					type="button"
					onclick={refresh}
					class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
					title={"Refresh"}
				>
					<ArrowsClockwise class="h-4 w-4" weight="regular" />
				</button>
			</div>

			<!-- URL bar -->
			<div
				class="flex-1 flex items-center gap-2 px-3 py-1.5 bg-background/50 rounded-md border border-border/50 min-w-0"
			>
				{#if isLoading}
					<Spinner class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
				{:else if loadError}
					<WarningCircle class="h-3.5 w-3.5 text-destructive shrink-0" weight="fill" />
				{/if}
				<span class="text-xs text-muted-foreground truncate" title={currentUrl}>
					{getDomain(currentUrl)}
				</span>
			</div>

			<!-- Actions -->
			<div class="flex items-center gap-1">
				<button
					type="button"
					onclick={openInBrowser}
					class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md
						text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
					title={"Open in browser"}
				>
					<ArrowSquareOut class="h-3.5 w-3.5" weight="regular" />
					<span class="hidden sm:inline">{"Open in browser"}</span>
				</button>
				<Dialog.Close
					class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				>
					<span class="sr-only">{"Close"}</span>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</Dialog.Close>
			</div>
		</div>

		<!-- Content area -->
		<div class="flex-1 relative overflow-hidden bg-white">
			{#if loadError}
				<!-- Error state -->
				<div
					class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-muted/10 text-center p-8"
				>
					<div class="p-4 rounded-full bg-destructive/10 text-destructive">
						<WarningCircle class="h-8 w-8" weight="fill" />
					</div>
					<div class="space-y-2">
						<h3 class="text-lg font-medium text-foreground">
							{"Unable to load page"}
						</h3>
						<p class="text-sm text-muted-foreground max-w-md">
							{"This page cannot be displayed in the preview. Some websites block being embedded in other applications."}
						</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={refresh}
							class="px-4 py-2 text-sm font-medium rounded-md bg-muted hover:bg-muted/80 transition-colors"
						>
							{"Try again"}
						</button>
						<button
							type="button"
							onclick={openInBrowser}
							class="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
						>
							{"Open in browser"}
						</button>
					</div>
				</div>
			{:else}
				<!-- Loading overlay -->
				{#if isLoading}
					<div class="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
						<div class="flex flex-col items-center gap-3">
							<Spinner class="h-8 w-8 text-primary" />
							<span class="text-sm text-muted-foreground">{"Loading..."}</span>
						</div>
					</div>
				{/if}

				<!-- Iframe -->
				<iframe
					bind:this={iframeRef}
					src={currentUrl}
					title={"Link Preview"}
					class="w-full h-full border-0"
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
					referrerpolicy="no-referrer"
					onload={handleIframeLoad}
					onerror={handleIframeError}
				></iframe>
			{/if}
		</div>

		<!-- Footer with URL -->
		<div class="px-3 py-2 border-t border-border/50 bg-muted/20 shrink-0">
			<a
				href={currentUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="text-xs text-muted-foreground hover:text-primary truncate block"
				title={currentUrl}
			>
				{currentUrl}
			</a>
		</div>
	</Dialog.Content>
</Dialog.Root>
