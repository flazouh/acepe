<script lang="ts">
import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { onMount } from "svelte";
// One self-accepting HMR boundary for the layout's boot-only modules, so an
// edit to any of them cannot remount the whole app (see $lib/boot/layout-boot.ts).
import {
	ensureWorkerPoolInitialized,
	initAnalytics,
	registerCursorThemeForPierreDiffs,
} from "$lib/boot/layout-boot.ts";
import ErrorBoundary from "$lib/components/error-boundary.svelte";
import { Toaster } from "$lib/components/ui/sonner/index.js";
import { TooltipProvider } from "@acepe/ui/tooltip";

onMount(async () => {
	// Fire-and-forget — nothing downstream depends on analytics being ready
	void initAnalytics();

	// Register Cursor theme with pierre/diffs BEFORE initializing highlighter
	// This must complete before the highlighter tries to use the theme
	const themeResult = await Effect.runPromise(
		Effect.result(
			fromPromise(
				() => registerCursorThemeForPierreDiffs(),
				(error) =>
					new Error(
						`Failed to register Cursor theme: ${error instanceof Error ? error.message : String(error)}`
					)
			)
		)
	);

	if (Result.isFailure(themeResult)) {
		console.error("Failed to register Cursor theme for pierre/diffs:", themeResult.failure);
	}

	// Initialize singleton worker pool for syntax highlighting
	// This pool is shared by all diff components (edit tool, review panel, etc.)
	// Note: Intentionally not awaited - the pool can be used immediately and
	// FileDiff gracefully falls back to main thread rendering until workers are ready
	void ensureWorkerPoolInitialized();

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
