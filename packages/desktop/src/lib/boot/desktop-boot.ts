/**
 * Everything `+page.svelte` needs at boot, behind one HMR boundary.
 *
 * Svelte components are the only hot-update boundaries: a changed `.ts`
 * module propagates up every import path to the nearest component. The root
 * page used to import these modules directly, so the nearest component WAS
 * the root -- editing any transport or QA file remounted the entire app
 * (every store re-initialised, the event stream re-subscribed, the QA eval
 * context torn down) and looked exactly like a restart.
 *
 * This module self-accepts. A change beneath it is absorbed here and never
 * reaches `+page.svelte`. The page keeps the references it captured at mount,
 * which is correct for boot-only code: it has already run, and the new code
 * loads on the next reload rather than by remounting a live app.
 */

export { startQaScenario } from "$lib/qa/qa-boot.ts";
export { readQaMode } from "$lib/qa/qa-mode.ts";
export { installQaScenarioHook } from "$lib/qa/qa-scenario-hook.ts";
export { listScenarios } from "$lib/qa/scenario-library.ts";
export { provideAppRpcClient } from "$lib/rpc/app-client.ts";
export { makeElectrobunRpcTransport } from "$lib/rpc/client.ts";
export { installElectrobunWebviewRpc } from "$lib/rpc/electrobun-bridge.ts";
export { type DesktopShellKind, desktopShellKind } from "$lib/rpc/electrobun-shell-window.ts";
export { installQaDispatchHook } from "$lib/rpc/qa-dispatch-hook.ts";

if (import.meta.hot) {
	import.meta.hot.accept();
}
