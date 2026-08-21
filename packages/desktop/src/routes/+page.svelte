<script lang="ts">
	import { makeResumingRpcClient, type RpcClient } from "@acepe/contracts";
	import { RPC_ROUNDTRIP_MESSAGE } from "@acepe/electrobun-shell";
	import * as Effect from "effect/Effect";
	import { onMount } from "svelte";
	import MainAppView from "$lib/components/main-app-view.svelte";
	import TracerBulletView from "$lib/components/tracer-bullet/tracer-bullet-view.svelte";
	import { makeElectrobunRpcTransport } from "$lib/rpc/client.ts";
	import { installElectrobunWebviewRpc } from "$lib/rpc/electrobun-bridge.ts";
	import { isElectrobunShellWindow } from "$lib/rpc/electrobun-shell-window.ts";

	let tracerClient = $state<RpcClient | null>(null);

	onMount(() => {
		if (
			isElectrobunShellWindow({
				protocol: window.location.protocol,
				search: window.location.search,
				hasElectrobunGlobal: "__electrobun" in window,
			}) === false
		) {
			return;
		}
		Effect.runFork(
			installElectrobunWebviewRpc().pipe(
				Effect.flatMap((bridge) =>
					Effect.tryPromise({
						try: () => bridge.request.ping({ message: RPC_ROUNDTRIP_MESSAGE }),
						catch: () => new Error("acepe ping failed"),
					}).pipe(Effect.as(bridge)),
				),
				Effect.map((bridge) => makeResumingRpcClient(makeElectrobunRpcTransport(bridge))),
				Effect.tap((client) =>
					Effect.sync(() => {
						tracerClient = client;
					}),
				),
				Effect.ignore,
			),
		);
	});
</script>

{#if tracerClient !== null}
	<TracerBulletView client={tracerClient} />
{:else}
	<MainAppView />
{/if}
