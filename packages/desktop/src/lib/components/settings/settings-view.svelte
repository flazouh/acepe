<script lang="ts">
	import {
		emptyRpcSessionSnapshot,
		type RpcClient,
		type RpcSessionSnapshot,
	} from "@acepe/contracts";
	import { SettingsModal } from "@acepe/ui/settings-modal";
	import * as Effect from "effect/Effect";
	import { onMount } from "svelte";

	import {
		applyFontSizeToRoot,
		codeFontSizeFromSettings,
		uiFontSizeFromSettings,
	} from "$lib/settings/settings-font.ts";
	import { settingsModalViewModel } from "$lib/settings/settings-state.ts";
	import { composeSettingsStore } from "$lib/settings/settings-store.ts";

	let { client }: { client: RpcClient } = $props();

	let snapshot = $state<RpcSessionSnapshot>(emptyRpcSessionSnapshot(0));
	let open = $state(false);

	const applyProjectedFonts = (next: RpcSessionSnapshot) => {
		if (typeof document === "undefined") {
			return;
		}
		applyFontSizeToRoot({
			root: document.documentElement,
			uiFontSize: uiFontSizeFromSettings(next.settings),
			codeFontSize: codeFontSizeFromSettings(next.settings),
		});
	};

	const store = composeSettingsStore({
		get client() {
			return client;
		},
		onSnapshot: (next) => {
			snapshot = next;
			applyProjectedFonts(next);
		},
	});
	const model = $derived(
		settingsModalViewModel({
			snapshot,
			open,
		}),
	);

	onMount(() => {
		Effect.runFork(store.openSettings());
	});
</script>

<SettingsModal
	{model}
	onOpen={() => {
		open = true;
	}}
	onClose={() => {
		open = false;
	}}
	onDecreaseUiFont={() => {
		Effect.runFork(store.bumpUiFontSize(-1));
	}}
	onIncreaseUiFont={() => {
		Effect.runFork(store.bumpUiFontSize(1));
	}}
	onDecreaseCodeFont={() => {
		Effect.runFork(store.bumpCodeFontSize(-1));
	}}
	onIncreaseCodeFont={() => {
		Effect.runFork(store.bumpCodeFontSize(1));
	}}
/>
