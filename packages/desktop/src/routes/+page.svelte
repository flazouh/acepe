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

let rpcClient = $state<RpcClient | null>(null);
let shell = $state<DesktopShellKind>("pending");
let bootError = $state<string | null>(null);
let selectedSessionId = $state<SessionId | null>(null);

onMount(() => {
	const next = desktopShellKind({
		protocol: window.location.protocol,
		search: window.location.search,
		hasElectrobunGlobal: "__electrobun" in window,
	});
	shell = next;
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

{#if shell === "electrobun" && rpcClient !== null}
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
{:else if shell === "tauri"}
	<MainAppView />
{:else}
	<div
		data-testid="library-shell-pending"
		data-shell={shell}
		data-boot-error={bootError ?? ""}
		class="flex h-screen bg-background text-foreground"
	></div>
{/if}
