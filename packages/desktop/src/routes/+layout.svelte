<script lang="ts">
import { ResultAsync } from "neverthrow";
import { onMount } from "svelte";
import { registerCursorThemeForPierreDiffs } from "$lib/acp/utils/pierre-diffs-theme.js";
import { initAnalytics } from "$lib/analytics.js";
import ErrorBoundary from "$lib/components/error-boundary.svelte";
import { Toaster } from "$lib/components/ui/sonner/index.js";
import { TooltipProvider } from "$lib/components/ui/tooltip/index.js";

onMount(async () => {
	// Fire-and-forget — nothing downstream depends on analytics being ready
	void initAnalytics();

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
