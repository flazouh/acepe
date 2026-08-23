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

	import ReviewModalView from "$lib/components/review/review-modal-view.svelte";
	import { librarySidebarViewModel } from "$lib/library/library-state.ts";
	import { composeLibraryStore } from "$lib/library/library-store.ts";
	import {
		REVIEW_MODAL_COPY,
		selectedProjectWorkspaceRoot,
	} from "$lib/review/review-state.ts";

	let { client }: { client: RpcClient } = $props();

	let snapshot = $state<RpcSessionSnapshot>(emptyRpcSessionSnapshot(0));
	let selectedProjectId = $state<ProjectId | null>(null);
	let reviewOpen = $state(false);

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
	const workspaceRoot = $derived(
		selectedProjectWorkspaceRoot(snapshot, selectedProjectId),
	);

	onMount(() => {
		Effect.runFork(store.openLibrary());
	});
</script>

<LibrarySidebar
	{model}
	reviewButtonLabel={REVIEW_MODAL_COPY.openLabel}
	onSelectProject={(projectId) => {
		const next = ProjectId.make(projectId);
		selectedProjectId = next;
		reviewOpen = false;
		// Loads that project's sessions, not just its id.
		Effect.runFork(store.openProject(next));
	}}
	onOpenReview={() => {
		if (selectedProjectId !== null && workspaceRoot !== null) {
			reviewOpen = true;
		}
	}}
/>

{#if reviewOpen && selectedProjectId !== null && workspaceRoot !== null}
	<ReviewModalView
		{client}
		projectId={selectedProjectId}
		{workspaceRoot}
		onClose={() => {
			reviewOpen = false;
		}}
	/>
{/if}
