<script lang="ts">
	import {
		emptyRpcSessionSnapshot,
		type ProjectId,
		type RpcClient,
		type RpcSessionSnapshot,
	} from "@acepe/contracts";
	import { ReviewModal } from "@acepe/ui/review-modal";
	import * as Effect from "effect/Effect";
	import * as Fiber from "effect/Fiber";
	import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
	import { onMount } from "svelte";

	import { reviewModalViewModel, gitReviewSnapshotIsNewer } from "$lib/review/review-state.ts";
	import { composeReviewStore } from "$lib/review/review-store.ts";

	let {
		client,
		projectId,
		workspaceRoot,
		onClose,
	}: {
		client: RpcClient;
		projectId: ProjectId;
		workspaceRoot: string;
		onClose: () => void;
	} = $props();

	let snapshot = $state.raw<RpcSessionSnapshot>(emptyRpcSessionSnapshot(0));
	let selectedPath = $state<string | null>(null);
	let appliedSequence = 0;

	const registry = AtomRegistry.make();
	const store = composeReviewStore({
		get client() {
			return client;
		},
		registry,
		onSnapshot: (next) => {
			setTimeout(() => {
				if (gitReviewSnapshotIsNewer(appliedSequence, next.snapshotSequence) === false) {
					return;
				}
				appliedSequence = next.snapshotSequence;
				snapshot = next;
				const fromStore = store.readSelectedPath();
				if (fromStore !== null) {
					selectedPath = fromStore;
				}
			}, 0);
		},
	});

	const model = $derived(
		reviewModalViewModel({
			gitReview: snapshot.gitReview,
			selectedPath,
		}),
	);

	onMount(() => {
		const fiber = Effect.runFork(
			Effect.gen(function* () {
				yield* store.openReview({ projectId, workspaceRoot });
				setTimeout(() => {
					const current = store.readSnapshot();
					if (gitReviewSnapshotIsNewer(appliedSequence, current.snapshotSequence)) {
						appliedSequence = current.snapshotSequence;
						snapshot = current;
					}
					selectedPath = store.readSelectedPath();
				}, 0);
				yield* store.watchReview(projectId);
			}),
		);
		return () => {
			Effect.runFork(Fiber.interrupt(fiber));
		};
	});
</script>

<ReviewModal
	{model}
	{onClose}
	onSelectFile={(path) => {
		selectedPath = path;
		Effect.runFork(
			store.loadFile({
				projectId,
				workspaceRoot,
				filePath: path,
			}),
		);
	}}
	onAcceptHunk={(path, hunkIndex) => {
		Effect.runFork(
			store.acceptHunk({
				projectId,
				workspaceRoot,
				filePath: path,
				hunkIndex,
			}),
		);
	}}
	onRejectHunk={(path, hunkIndex) => {
		Effect.runFork(
			store.rejectHunk({
				projectId,
				workspaceRoot,
				filePath: path,
				hunkIndex,
			}),
		);
	}}
/>
