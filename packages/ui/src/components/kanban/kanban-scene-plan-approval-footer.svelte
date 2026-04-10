<script lang="ts">
	import { XCircle } from "phosphor-svelte";

	import { BuildIcon, PlanIcon } from "../icons/index.js";
	import { EmbeddedPanelHeader, HeaderActionCell, HeaderTitleCell } from "../panel-header/index.js";

	interface Props {
		prompt: string;
		approveLabel: string;
		rejectLabel: string;
		onApprove: () => void;
		onReject: () => void;
	}

	let { prompt, approveLabel, rejectLabel, onApprove, onReject }: Props = $props();
</script>

<div class="flex flex-col overflow-hidden rounded-md border border-border/50 bg-accent/20">
	<EmbeddedPanelHeader class="bg-accent/30">
		<HeaderTitleCell compactPadding>
			<PlanIcon size="sm" class="shrink-0 mr-1" />
			<span class="truncate text-[10px] font-mono leading-none text-muted-foreground select-none">{prompt}</span>
		</HeaderTitleCell>
		<HeaderActionCell withDivider={false}>
			<button type="button" class="plan-action-btn" onclick={onReject}>
				<XCircle weight="fill" class="size-3 shrink-0 text-red-500" />
				{rejectLabel}
			</button>
		</HeaderActionCell>
		<HeaderActionCell>
			<button type="button" class="plan-action-btn" onclick={onApprove}>
				<BuildIcon size="sm" />
				{approveLabel}
			</button>
		</HeaderActionCell>
	</EmbeddedPanelHeader>
</div>

<style>
	.plan-action-btn {
		display: inline-flex;
		height: 100%;
		align-items: center;
		gap: 4px;
		padding: 0 8px;
		border: none;
		background: transparent;
		font: inherit;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.625rem;
		font-weight: 500;
		color: var(--muted-foreground);
		cursor: pointer;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}

	.plan-action-btn:hover {
		color: var(--foreground);
		background: color-mix(in srgb, var(--accent) 50%, transparent);
	}
</style>
