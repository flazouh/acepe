<script lang="ts">
import { ResultAsync } from "neverthrow";
import { onMount } from "svelte";
import { initializeHighlighter } from "$lib/acp/services/highlighter-pool.svelte.js";
import { preInitializeMarkdown } from "$lib/acp/utils/markdown-renderer.js";
import { registerCursorThemeForPierreDiffs } from "$lib/acp/utils/pierre-diffs-theme.js";
import ErrorBoundary from "$lib/components/error-boundary.svelte";
import { Toaster } from "$lib/components/ui/sonner/index.js";
import { TooltipProvider } from "$lib/components/ui/tooltip/index.js";

onMount(async () => {
	// Register Cursor theme with pierre/diffs BEFORE initializing highlighter
	// This must complete before the highlighter tries to use the theme
	const themeResult = await ResultAsync.fromPromise(
		registerCursorThemeForPierreDiffs(),
		(error) =>
			new Error(
				`Failed to register Cursor theme: ${error instanceof Error ? error.message : String(error)}`
			)
	);

	if (themeResult.isErr()) {
		console.error("Failed to register Cursor theme for pierre/diffs:", themeResult.error);
	}

	// Initialize singleton worker pool for syntax highlighting
	// This pool is shared by all diff components (edit tool, review panel, etc.)
	// Note: Intentionally not awaited - the pool can be used immediately and
	// FileDiff gracefully falls back to main thread rendering until workers are ready
	initializeHighlighter();

	// Preload markdown renderer for faster first message rendering
	preInitializeMarkdown();
	// Note: Initial sync is triggered in +page.svelte AFTER the event listener
	// is registered to avoid race conditions
});
</script>

<TooltipProvider delayDuration={0} skipDelayDuration={0} disableHoverableContent>
	<ErrorBoundary>
		<slot />
	</ErrorBoundary>
	<Toaster />
</TooltipProvider>
