<script lang="ts">
import { makeResumingRpcClient, type RpcClient, type SessionId } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import { onMount } from "svelte";
import MainAppView from "$lib/components/main-app-view.svelte";
import LibrarySidebarView from "$lib/components/library/library-sidebar-view.svelte";
import AgentPanelSessionView from "$lib/components/agent-panel/agent-panel-session-view.svelte";
import SettingsView from "$lib/components/settings/settings-view.svelte";
import SetupBarView from "$lib/components/setup-bar/setup-bar-view.svelte";
import { makeElectrobunRpcTransport } from "$lib/rpc/client.ts";
import { provideAppRpcClient } from "$lib/rpc/app-client.ts";
import { installElectrobunWebviewRpc } from "$lib/rpc/electrobun-bridge.ts";
import { desktopShellKind, type DesktopShellKind } from "$lib/rpc/electrobun-shell-window.ts";
import { installQaCaptureHook } from "$lib/rpc/qa-capture-hook.ts";
import { installQaDispatchHook } from "$lib/rpc/qa-dispatch-hook.ts";
import type { QaScenario, ScenarioSession } from "@acepe/qa-scenario";
import QaOverlayPanel from "$lib/qa/qa-overlay.svelte";
import { startQaScenario } from "$lib/qa/qa-boot.ts";
import { listScenarios } from "$lib/qa/scenario-library.ts";
import { readQaMode } from "$lib/qa/qa-mode.ts";
import { installQaScenarioHook } from "$lib/qa/qa-scenario-hook.ts";

// Same QA-hooks gate as main-app-view.svelte's QA_HOOKS_ENABLED /
// panel-open-performance-mark.ts: import.meta.env.DEV is false in the
// electrobun production build QA runs against, so VITE_ENABLE_QA_HOOKS=1
// is how a QA build opts back in.
const QA_HOOKS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_QA_HOOKS === "1";

let rpcClient = $state<RpcClient | null>(null);
let shell = $state<DesktopShellKind>("pending");
let bootError = $state<string | null>(null);
let selectedSessionId = $state<SessionId | null>(null);
// #249: MainAppView (the real agent panel) is now what mounts under
// Electrobun. The scaffold (SetupBarView/LibrarySidebarView/
// AgentPanelSessionView/SettingsView driven straight off the raw RpcClient)
// stays reachable behind ?scaffold=1 for QA that wants to exercise the
// contract without the full app shell.
let useScaffold = $state(false);
let qaSession = $state<ScenarioSession | null>(null);
let qaKnownScenarios = $state<readonly QaScenario[]>([]);

onMount(() => {
	useScaffold = new URLSearchParams(window.location.search).get("scaffold") === "1";
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
							// MainAppView installs its own QA dispatch hook in onMount
							// (main-app-view.svelte); only the scaffold path needs it
							// installed here, before it renders.
							if (useScaffold && QA_HOOKS_ENABLED) {
								installQaDispatchHook();
								installQaCaptureHook();
							}
						}, 0);
					}),
			})
		)
	);
});
</script>

{#if shell === "electrobun" && rpcClient !== null && useScaffold}
	<div class="flex h-screen flex-col bg-background text-foreground">
		<SetupBarView client={rpcClient} />
		<div class="flex min-h-0 flex-1">
		<LibrarySidebarView
			client={rpcClient}
			{selectedSessionId}
			onSelectSession={(sessionId) => {
				selectedSessionId = sessionId;
			}}
		/>
		<div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
			{#if selectedSessionId !== null}
				{#key selectedSessionId}
					<AgentPanelSessionView client={rpcClient} sessionId={selectedSessionId} />
				{/key}
			{/if}
			<div class="absolute right-3 top-3 z-10">
				<SettingsView client={rpcClient} />
			</div>
		</div>
		</div>
	</div>
{:else if (shell === "electrobun" && rpcClient !== null) || shell === "tauri"}
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
