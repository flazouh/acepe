<script lang="ts">
import { PlanIcon } from "@acepe/ui";

import {
	EmbeddedIconButton,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
} from "@acepe/ui/panel-header";
import ArrowsInSimple from "phosphor-svelte/lib/ArrowsInSimple";
import ArrowsOutSimple from "phosphor-svelte/lib/ArrowsOutSimple";
import * as m from "$lib/paraglide/messages.js";
import type { SessionPlanResponse } from "$lib/services/converted-session-types.js";

interface Props {
	plan: SessionPlanResponse;
	isExpanded: boolean;
	onToggleSidebar: () => void;
}

let { plan, isExpanded, onToggleSidebar }: Props = $props();
</script>

<EmbeddedPanelHeader>
	<HeaderTitleCell>
		<PlanIcon size="md" class="shrink-0 mr-1.5" />
		<span
			class="text-[11px] font-semibold font-mono text-foreground select-none truncate leading-none"
		>
			{plan.title}
		</span>
	</HeaderTitleCell>

	<HeaderActionCell withDivider={false}>
		<EmbeddedIconButton
			title={isExpanded ? m.plan_sidebar_collapse() : m.plan_sidebar_expand()}
			ariaLabel={isExpanded ? m.plan_sidebar_collapse() : m.plan_sidebar_expand()}
			onclick={onToggleSidebar}
		>
			{#if isExpanded}
				<ArrowsInSimple size={14} weight="bold" />
			{:else}
				<ArrowsOutSimple size={14} weight="bold" />
			{/if}
		</EmbeddedIconButton>
	</HeaderActionCell>
</EmbeddedPanelHeader>
