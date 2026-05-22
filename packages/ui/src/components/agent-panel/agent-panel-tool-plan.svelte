<script lang="ts">
	import type { AgentPanelPlanActionEvent, AgentPanelPlanViewEvent } from "./types.js";
	import {
		createPlanActionEvent,
		createPlanViewEvent,
		resolvePlanActionsDisabled,
		resolvePlanCardStatus,
		type AgentToolEntry,
	} from "./agent-panel-conversation-entry-model.js";
	import { PlanCard } from "../plan-card/index.js";

	interface Props {
		entry: AgentToolEntry;
		onBuild?: (event: AgentPanelPlanActionEvent) => void;
		onCancel?: (event: AgentPanelPlanActionEvent) => void;
		onViewFull?: (event: AgentPanelPlanViewEvent) => void;
		isActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
	}

	let { entry, onBuild, onCancel, onViewFull, isActionAvailable }: Props = $props();
</script>

<PlanCard
	content={entry.planContent ?? ""}
	title={entry.planTitle ?? entry.title}
	status={resolvePlanCardStatus({ status: entry.status, planStatus: entry.planStatus })}
	onBuild={onBuild ? () => onBuild(createPlanActionEvent(entry)) : undefined}
	onCancel={onCancel ? () => onCancel(createPlanActionEvent(entry)) : undefined}
	onViewFull={onViewFull ? () => onViewFull(createPlanViewEvent(entry)) : undefined}
	actionsDisabled={resolvePlanActionsDisabled({
		toolEntry: entry,
		isPlanActionAvailable: isActionAvailable,
	})}
/>
