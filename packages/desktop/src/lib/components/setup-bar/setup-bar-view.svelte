<script lang="ts">
	import { emptyRpcSessionSnapshot, type RpcClient, type RpcSessionSnapshot } from "@acepe/contracts";
	import { ComposerSetupBar } from "@acepe/ui/agent-panel";
	import * as Effect from "effect/Effect";
	import * as Fiber from "effect/Fiber";
	import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
	import { onMount } from "svelte";

	import {
		SETUP_BAR_COPY,
		mapMcpServersToSetupBarRows,
		mapPreconnectionOptionsToAgentInput,
		mapSkillsToSetupBarRows,
	} from "$lib/setup-bar/setup-bar-state.ts";
	import { composeSetupBarStore } from "$lib/setup-bar/setup-bar-store.ts";

	let { client }: { client: RpcClient } = $props();

	let snapshot = $state.raw<RpcSessionSnapshot>(emptyRpcSessionSnapshot(0));

	const registry = AtomRegistry.make();
	const store = composeSetupBarStore({
		get client() {
			return client;
		},
		registry,
		onSnapshot: (next) => {
			setTimeout(() => {
				snapshot = next;
			}, 0);
		},
	});

	const skills = $derived(mapSkillsToSetupBarRows(snapshot.skillsCatalog));
	const servers = $derived(mapMcpServersToSetupBarRows(snapshot));
	const configOptions = $derived(mapPreconnectionOptionsToAgentInput(snapshot));

	onMount(() => {
		const fiber = Effect.runFork(
			Effect.gen(function* () {
				yield* store.openSetupBar();
				setTimeout(() => {
					snapshot = store.readSnapshot();
				}, 0);
				yield* store.watchSetupBar();
			}),
		);
		return () => {
			Effect.runFork(Fiber.interrupt(fiber));
		};
	});
</script>

<ComposerSetupBar
	skillsHeading={SETUP_BAR_COPY.skillsHeading}
	mcpHeading={SETUP_BAR_COPY.mcpHeading}
	optionsHeading={SETUP_BAR_COPY.optionsHeading}
	{skills}
	{servers}
	{configOptions}
	onOptionValueChange={() => {}}
/>
