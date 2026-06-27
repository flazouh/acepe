<script lang="ts">
	import { ArrowsInSimple, ArrowsOutSimple } from "../icons/index.js";

	import { PlanIcon } from "../icons/index.js";
	import {
		EmbeddedIconButton,
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
		<EmbeddedIconButton title={toggleLabel} ariaLabel={toggleLabel} onclick={onToggleSidebar}>
			{#if isExpanded}
				<ArrowsInSimple size={14} weight="bold" />
			{:else}
				<ArrowsOutSimple size={14} weight="bold" />
			{/if}
		</EmbeddedIconButton>
	</HeaderActionCell>
</EmbeddedPanelHeader>
