<script lang="ts">
import { makeResumingRpcClient, type RpcClient } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import { onMount } from "svelte";
import MainAppView from "$lib/components/main-app-view.svelte";
import { makeElectrobunRpcTransport } from "$lib/rpc/client.ts";
import { provideAppRpcClient } from "$lib/rpc/app-client.ts";
import { installElectrobunWebviewRpc } from "$lib/rpc/electrobun-bridge.ts";
import { desktopShellKind, type DesktopShellKind } from "$lib/rpc/electrobun-shell-window.ts";
import { installQaDispatchHook } from "$lib/rpc/qa-dispatch-hook.ts";
import type { QaScenario, ScenarioSession } from "@acepe/qa-scenario";
import QaOverlayPanel from "$lib/qa/qa-overlay.svelte";
import { startQaScenario } from "$lib/qa/qa-boot.ts";
import { listScenarios } from "$lib/qa/scenario-library.ts";
import { readQaMode } from "$lib/qa/qa-mode.ts";
import { installQaScenarioHook } from "$lib/qa/qa-scenario-hook.ts";

let rpcClient = $state<RpcClient | null>(null);
let shell = $state<DesktopShellKind>("pending");
let bootError = $state<string | null>(null);
let qaSession = $state<ScenarioSession | null>(null);
let qaKnownScenarios = $state<readonly QaScenario[]>([]);

onMount(() => {
	const next = desktopShellKind({
		protocol: window.location.protocol,
		search: window.location.search,
		hasElectrobunGlobal: "__electrobun" in window,
	});
	shell = next;

	// ?qa=<scenario> boots the same shell against a replayed recording instead
	// of the live server. It works under Electrobun and in a plain browser,
	// because a scenario needs no bridge and no agent.
	const qaMode = readQaMode(window.location.search);
	if (qaMode !== null) {
		Effect.runFork(
			startQaScenario(qaMode).pipe(
				Effect.matchEffect({
					onFailure: (error) =>
						Effect.sync(() => {
							setTimeout(() => {
								bootError = error.message;
							}, 0);
						}),
					onSuccess: (session) =>
						listScenarios().pipe(
							Effect.map((known) => {
								setTimeout(() => {
									installQaScenarioHook(session);
									installQaDispatchHook();
									qaKnownScenarios = known;
									qaSession = session;
									rpcClient = session.client;
								}, 0);
							})
						),
				})
			)
		);
		return;
	}

	if (next !== "electrobun") {
		return;
	}
	Effect.runFork(
		installElectrobunWebviewRpc().pipe(
			Effect.map((bridge) => makeResumingRpcClient(makeElectrobunRpcTransport(bridge))),
			Effect.matchEffect({
				onFailure: (error) =>
					Effect.sync(() => {
						const message = "message" in error ? String(error.message) : "electrobun rpc failed";
						setTimeout(() => {
							bootError = message;
						}, 0);
					}),
				onSuccess: (client) =>
					Effect.sync(() => {
						setTimeout(() => {
							provideAppRpcClient(client);
							rpcClient = client;
						}, 0);
					}),
			})
		)
	);
});
</script>

{#if (shell === "electrobun" && rpcClient !== null) || shell === "web"}
	<MainAppView />
	{#if qaSession !== null}
		<QaOverlayPanel session={qaSession} known={qaKnownScenarios} />
	{/if}
{:else}
	<div
		data-testid="library-shell-pending"
		data-shell={shell}
		data-boot-error={bootError ?? ""}
		class="flex h-screen bg-background text-foreground"
	></div>
{/if}
