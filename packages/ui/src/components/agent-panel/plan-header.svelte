<script lang="ts">
	import { PlanIcon, RoundedIcon } from "../icons/index.js";
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
			variant="ghost"
			size="icon-2xs"
			data-header-control
			title={toggleLabel}
			aria-label={toggleLabel}
			onclick={onToggleSidebar}
		>
			{#snippet children()}
				<RoundedIcon name={isExpanded ? "collapse" : "expand"} />
			{/snippet}
		</Button>
	</HeaderActionCell>
</EmbeddedPanelHeader>
