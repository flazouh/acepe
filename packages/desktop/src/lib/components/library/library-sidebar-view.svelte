<script lang="ts">
	import {
		emptyRpcSessionSnapshot,
		ProjectId,
		type RpcClient,
		type RpcSessionSnapshot,
	} from "@acepe/contracts";
	import { LibrarySidebar } from "@acepe/ui/library-sidebar";
	import * as Effect from "effect/Effect";
	import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
	import { onMount } from "svelte";

	import { librarySidebarViewModel } from "$lib/library/library-state.ts";
	import { composeLibraryStore } from "$lib/library/library-store.ts";

	let { client }: { client: RpcClient } = $props();

	let snapshot = $state<RpcSessionSnapshot>(emptyRpcSessionSnapshot(0));
	let selectedProjectId = $state<ProjectId | null>(null);

	const registry = AtomRegistry.make();
	const store = composeLibraryStore({
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
	const model = $derived(
		librarySidebarViewModel({
			snapshot,
			selectedProjectId,
		}),
	);

	onMount(() => {
		Effect.runFork(store.openLibrary());
	});
</script>

<LibrarySidebar
	{model}
	onSelectProject={(projectId) => {
		const next = ProjectId.make(projectId);
		store.selectProject(next);
		selectedProjectId = next;
	}}
/>
