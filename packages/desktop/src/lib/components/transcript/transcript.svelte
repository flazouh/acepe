<script lang="ts">
	import type { RpcProjectedMessage } from "@acepe/contracts";
	import {
		createTranscriptViewportController,
		hostFromElement,
		type TranscriptViewportController,
	} from "@acepe/transcript-viewport";

	import { createDomViewportScheduler } from "../../viewport/dom-scheduler.ts";
	import { transcriptViewFromMessages } from "./transcript-view.ts";

	let {
		messages,
		ariaLabel,
		nowMs = () => performance.now(),
		requestFrame = (run: () => void) => requestAnimationFrame(run),
		cancelFrame = (id: number) => cancelAnimationFrame(id),
		requestTimeout = (run: () => void, delayMs: number) => setTimeout(run, delayMs),
		cancelTimeout = (id: number) => clearTimeout(id),
		onReady,
	}: {
		messages: ReadonlyArray<RpcProjectedMessage>;
		ariaLabel: string;
		nowMs?: () => number;
		requestFrame?: (run: () => void) => number;
		cancelFrame?: (id: number) => void;
		requestTimeout?: (run: () => void, delayMs: number) => number;
		cancelTimeout?: (id: number) => void;
		onReady?: (controller: TranscriptViewportController) => void;
	} = $props();

	const view = $derived(transcriptViewFromMessages({ messages, ariaLabel }));

	const attachViewport = (node: HTMLElement) => {
		const firstChild = node.firstElementChild;
		const contentElement = firstChild instanceof HTMLElement ? firstChild : undefined;
		const params: {
			nowMs: () => number;
			scheduler: ReturnType<typeof createDomViewportScheduler>;
			contentElement?: HTMLElement;
		} = {
			nowMs,
			scheduler: createDomViewportScheduler({
				requestFrame,
				cancelFrame,
				requestTimeout,
				cancelTimeout,
			}),
		};
		if (contentElement !== undefined) {
			params.contentElement = contentElement;
		}
		const controller = createTranscriptViewportController(hostFromElement(node), params);
		if (onReady !== undefined) {
			onReady(controller);
		}
		return () => {
			controller.destroy();
		};
	};
</script>

<div class="transcript">
	<div
		class="transcript__viewport"
		data-testid="transcript-viewport"
		tabindex="0"
		role="log"
		aria-live="polite"
		aria-label={view.ariaLabel}
		style:overflow-anchor={view.overflowAnchor}
		{@attach attachViewport}
	>
		<div class="transcript__content">
			{#each view.rows as row (row.rowId)}
				<div
					class="transcript__row"
					data-row-id={row.rowId}
					data-row-type={row.rowType}
					data-anchor={row.anchorEligible === true ? "" : undefined}
					style:content-visibility={view.contentVisibility}
					style:contain-intrinsic-size={`auto ${row.estimatePx}px`}
					style:overflow-anchor={view.overflowAnchor}
				>
					{row.text === null ? "" : row.text}
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.transcript {
		position: relative;
		display: flex;
		min-height: 0;
		min-width: 0;
		flex: 1 1 auto;
		width: 100%;
		max-width: 100%;
	}

	.transcript__viewport {
		flex: 1 1 auto;
		min-height: 0;
		min-width: 0;
		width: 100%;
		max-width: 100%;
		overflow-y: scroll;
		overflow-x: hidden;
		overflow-anchor: none;
		outline: none;
	}

	.transcript__content,
	.transcript__row {
		overflow-anchor: none;
	}

	.transcript__row {
		min-width: 0;
		width: 100%;
		content-visibility: auto;
	}
</style>
