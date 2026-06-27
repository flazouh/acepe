<script lang="ts">
	import { ArrowsInSimple, ArrowsOutSimple } from "phosphor-svelte";

	import { PlanIcon } from "../icons/index.js";
	import { Button } from "../button/index.js";
	import {
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderTitleCell,
	} from "../panel-header/index.js";

	interface Props {
		title: string;
		isExpanded: boolean;
		expandLabel: string;
		collapseLabel: string;
		onToggleSidebar: () => void;
	}

	let { title, isExpanded, expandLabel, collapseLabel, onToggleSidebar }: Props = $props();

	const toggleLabel = $derived(isExpanded ? collapseLabel : expandLabel);
</script>

<EmbeddedPanelHeader>
	<HeaderTitleCell>
		<PlanIcon size="sm" class="shrink-0 mr-1" />
		<span class="text-[11px] text-foreground select-none truncate leading-none">
			{title}
		</span>
	</HeaderTitleCell>

	<HeaderActionCell withDivider={false}>
		<Button
			variant="chromeIcon"
			size="chromeIcon"
			data-header-control
			title={toggleLabel}
			aria-label={toggleLabel}
			onclick={onToggleSidebar}
		>
			{#snippet children()}
				{#if isExpanded}
					<ArrowsInSimple size={14} weight="bold" />
				{:else}
					<ArrowsOutSimple size={14} weight="bold" />
				{/if}
			{/snippet}
		</Button>
	</HeaderActionCell>
</EmbeddedPanelHeader>
