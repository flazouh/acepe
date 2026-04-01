<script lang="ts">
import type { Snippet } from "svelte";
import { getContext } from "svelte";
import type { Action } from "svelte/action";
import {
	THREAD_FOLLOW_CONTROLLER_CONTEXT,
	type ThreadFollowController,
} from "../agent-panel/logic/thread-follow-controller.svelte.js";

interface Props {
	entryIndex: number;
	entryKey: string;
	messageId?: string;
	isFullscreen?: boolean;
	observeRevealResize?: boolean;
	revealEntryIndex?: (index: number, force?: boolean) => boolean;
	children: Snippet;
}

let {
	entryIndex,
	entryKey,
	messageId,
	isFullscreen = false,
	observeRevealResize = false,
	revealEntryIndex,
	children,
}: Props = $props();

const followController = getContext<ThreadFollowController | undefined>(
	THREAD_FOLLOW_CONTROLLER_CONTEXT
);

type RevealTargetActionParams = {
	controller: ThreadFollowController | undefined;
	entryIndex: number;
	entryKey: string;
	observeRevealResize: boolean;
	revealEntryIndex?: (index: number, force?: boolean) => boolean;
};

const revealTargetAction: Action<HTMLDivElement, RevealTargetActionParams> = (node, params) => {
	let unregister = () => {};
	let observer: ResizeObserver | null = null;

	function stop(): void {
		unregister();
		unregister = () => {};
		observer?.disconnect();
		observer = null;
	}

	function start(nextParams: RevealTargetActionParams): void {
		stop();
		if (!nextParams.controller || !nextParams.revealEntryIndex) return;

		unregister = nextParams.controller.registerTarget(nextParams.entryKey, {
			reveal(force?: boolean): boolean {
				return nextParams.revealEntryIndex?.(nextParams.entryIndex, force) ?? false;
			},
			isMounted(): boolean {
				return node.isConnected;
			},
		});

		if (!nextParams.observeRevealResize) {
			return;
		}

		observer = new ResizeObserver(() => {
			nextParams.controller?.requestReveal(nextParams.entryKey);
		});
		observer.observe(node);
	}

	start(params);

	return {
		update(nextParams) {
			start(nextParams);
		},
		destroy() {
			stop();
		},
	};
};
</script>

<div
	use:revealTargetAction={{
		controller: followController,
		entryIndex,
		entryKey,
		observeRevealResize,
		revealEntryIndex,
	}}
	class="py-1.5 px-3 {isFullscreen ? 'flex justify-center' : ''}"
	data-entry-index={entryIndex}
	data-entry-key={entryKey}
	data-message-id={messageId}
>
	<div class={isFullscreen ? "w-full max-w-4xl" : ""}>
		{@render children()}
	</div>
</div>
