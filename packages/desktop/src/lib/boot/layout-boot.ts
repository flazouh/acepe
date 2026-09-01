/**
 * Everything `+layout.svelte` needs at boot, behind one HMR boundary.
 *
 * Same reason as desktop-boot.ts: the layout is the outermost component, so
 * a `.ts` module it imports directly makes the whole app remount on edit.
 * These three run once in onMount and are never re-run on a live app, so
 * absorbing their updates here (and loading new code on the next reload) is
 * the correct behaviour, not a compromise.
 */
export { registerCursorThemeForPierreDiffs } from "$lib/acp/utils/pierre-diffs-theme.js";
export { ensureWorkerPoolInitialized } from "$lib/acp/utils/worker-pool-singleton.js";
export { initAnalytics } from "$lib/analytics.js";

if (import.meta.hot) {
	import.meta.hot.accept();
}
