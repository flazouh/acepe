<script lang="ts">
import type { Snippet } from "svelte";
import type { Action } from "svelte/action";
import {
	shouldRestartRevealTargetAction,
	type RevealTargetActionParams,
} from "./logic/reveal-target-action-params.js";
import { createRevealResizeScheduler } from "./logic/reveal-resize-scheduler.js";

interface Props {
	entryIndex: number;
	entryKey: string;
	messageId?: string;
	isFullscreen?: boolean;
	observeRevealResize?: boolean;
	onRevealResize?: () => void;
	children: Snippet;
}

let {
	entryIndex,
	entryKey,
	messageId,
	isFullscreen = false,
	observeRevealResize = false,
	onRevealResize,
	children,
}: Props = $props();

const revealTargetAction: Action<HTMLDivElement, RevealTargetActionParams> = (node, params) => {
	let observer: ResizeObserver | null = null;
	let currentParams = params;
	const resizeScheduler = createRevealResizeScheduler(() => {
		currentParams.onRevealResize?.();
	});

	function stop(): void {
		observer?.disconnect();
		observer = null;
		resizeScheduler.cancel();
	}

	function start(nextParams: RevealTargetActionParams): void {
		stop();
		currentParams = nextParams;
		if (!nextParams.observeRevealResize) {
			return;
		}

		observer = new ResizeObserver(() => {
			resizeScheduler.request();
		});
		observer.observe(node);
	}

	start(params);

	return {
		update(nextParams) {
			const shouldRestart = shouldRestartRevealTargetAction(currentParams, nextParams);
			currentParams = nextParams;
			if (shouldRestart) {
				start(nextParams);
			}
		},
		destroy() {
			stop();
		},
	};
};
</script>

<div
	use:revealTargetAction={{
		entryIndex,
		entryKey,
		observeRevealResize,
		onRevealResize,
	}}
	class="py-1.5 px-3 min-w-0 max-w-full {isFullscreen ? 'flex justify-center' : ''}"
	data-entry-index={entryIndex}
	data-entry-key={entryKey}
	data-message-id={messageId}
>
	<div class={isFullscreen ? "w-full max-w-4xl min-w-0" : "min-w-0 max-w-full"}>
		{@render children()}
	</div>
</div>
