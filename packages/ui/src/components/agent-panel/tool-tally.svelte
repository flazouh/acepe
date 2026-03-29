<script lang="ts">
	import type { AgentToolEntry } from "./types.js";

	const BAR_COLOR = "#f9c396";
	const MUTED_BAR_COLOR = "color-mix(in srgb, var(--muted-foreground) 24%, transparent)";

	type ToolCallTallyProps = {
		mode?: "tools";
		toolCalls: AgentToolEntry[];
		inline?: boolean;
		filledColor?: string;
		mutedColor?: string;
	};

	type ProgressTallyProps = {
		mode: "progress";
		totalCount: number;
		filledCount: number;
		ariaLabel: string;
		inline?: boolean;
		filledColor?: string;
		mutedColor?: string;
	};

	type Props = ToolCallTallyProps | ProgressTallyProps;

	const props: Props = $props();

	const isProgressMode = $derived(props.mode === "progress");
	const isInline = $derived(props.inline !== undefined ? props.inline : isProgressMode);
	const filledColor = $derived(props.filledColor !== undefined ? props.filledColor : BAR_COLOR);
	const mutedColor = $derived(props.mutedColor !== undefined ? props.mutedColor : MUTED_BAR_COLOR);

	const bars = $derived.by(() => {
		if (props.mode === "progress") {
			const totalCount = Math.max(props.totalCount, 0);
			const filledCount = Math.max(0, Math.min(props.filledCount, totalCount));
			return Array.from({ length: totalCount }, (_, index) => {
				return {
					key: `progress-${index + 1}`,
					label: `Permission ${index + 1} of ${totalCount}`,
					filled: index < filledCount,
				};
			});
		}

		return props.toolCalls.map((toolCall) => {
			return {
				key: toolCall.id,
				label: `${toolCall.title}: ${toolCall.status}`,
				filled: true,
			};
		});
	});

	const footerLabel = $derived.by(() => {
		if (props.mode === "progress") {
			return props.ariaLabel;
		}

		return `${props.toolCalls.length} tool ${props.toolCalls.length === 1 ? "call" : "calls"}`;
	});
</script>

{#if bars.length > 0}
	<div
		class="flex items-center gap-[2px] {isInline ? '' : 'border-t border-border px-2 py-1.5'}"
		role="img"
		aria-label={footerLabel}
		title={footerLabel}
	>
		{#each bars as bar (bar.key)}
			<div
				class="rounded-full {isInline ? 'h-1.5 w-[5px]' : 'h-2 w-[3px]'}"
				style="background-color: {bar.filled ? filledColor : mutedColor}"
				title={bar.label}
			></div>
		{/each}
	</div>
{/if}
