<script lang="ts">
	import { makeResumingRpcClient, type RpcClient } from "@acepe/contracts";
	import * as Effect from "effect/Effect";
	import { onMount } from "svelte";
	import MainAppView from "$lib/components/main-app-view.svelte";
	import TracerBulletView from "$lib/components/tracer-bullet/tracer-bullet-view.svelte";
	import { makeElectrobunRpcTransport } from "$lib/rpc/client.ts";
	import { installElectrobunWebviewRpc } from "$lib/rpc/electrobun-bridge.ts";

	let tracerClient = $state<RpcClient | null>(null);

	onMount(() => {
		const isTracer =
			window.location.protocol === "views:" || window.location.search.includes("slice=tracer");
		if (isTracer === false) {
			return;
		}
		Effect.runFork(
			installElectrobunWebviewRpc().pipe(
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
