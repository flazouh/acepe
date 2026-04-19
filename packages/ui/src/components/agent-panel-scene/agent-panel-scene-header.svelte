<script lang="ts">
	import type { Snippet } from "svelte";
	import type {
		AgentPanelActionCallbacks,
		AgentPanelActionDescriptor,
		AgentPanelHeaderModel,
	} from "../agent-panel/types.js";

	import { Button } from "../button/index.js";
	import AgentPanelHeader from "../agent-panel/agent-panel-header.svelte";
	import AgentPanelStatusIcon from "../agent-panel/agent-panel-status-icon.svelte";

	interface Props {
		header: AgentPanelHeaderModel;
		actionCallbacks?: AgentPanelActionCallbacks;
		isFullscreen?: boolean;
		controls?: Snippet;
		dropdownMenu?: Snippet;
		onClose?: () => void;
		onToggleFullscreen?: () => void;
		onScrollToTop?: () => void;
	}

	let {
		header,
		actionCallbacks = {},
		isFullscreen = false,
		controls,
		dropdownMenu,
		onClose,
		onToggleFullscreen,
		onScrollToTop,
	}: Props = $props();

	const visibleActions = $derived((header.actions ?? []).filter((action) => action.state !== "hidden"));

	function actionDisabled(action: AgentPanelActionDescriptor): boolean {
		return action.state === "disabled" || action.state === "busy";
	}

	function resolveActionLabel(action: AgentPanelActionDescriptor): string {
		return action.label ?? action.id;
	}

	function runAction(action: AgentPanelActionDescriptor): void {
		const callback = actionCallbacks[action.id];
		callback?.();
	}
</script>

<div class="shrink-0">
	<AgentPanelHeader
		displayTitle={header.title}
		agentIconSrc={header.agentIconSrc ?? undefined}
		sessionStatus={header.status}
		isFullscreen={isFullscreen}
		isConnecting={header.isConnecting ?? false}
		pendingProjectSelection={header.pendingProjectSelection ?? false}
		projectName={header.projectLabel ?? undefined}
		projectColor={header.projectColor ?? undefined}
		projectIconSrc={header.projectIconSrc ?? undefined}
		sequenceId={header.sequenceId ?? undefined}
		subtitle={header.subtitle ?? undefined}
		agentLabel={header.agentLabel ?? undefined}
		branchLabel={header.branchLabel ?? undefined}
		badges={header.badges}
		showTrailingBorder={header.showTrailingBorder ?? false}
		onClose={onClose}
		onToggleFullscreen={onToggleFullscreen}
		onScrollToTop={onScrollToTop}
		{controls}
		{dropdownMenu}
	>
		{#snippet statusIndicator()}
			{#if !controls}
				<AgentPanelStatusIcon status={header.status} />
			{/if}
		{/snippet}

		{#snippet trailingActions()}
			<div class="flex items-center gap-1">
				{#each visibleActions as action (action.id)}
					<Button
						variant={action.destructive ? "destructive" : "headerAction"}
						size="headerAction"
						disabled={actionDisabled(action)}
						title={action.description ?? undefined}
						onclick={() => runAction(action)}
					>
						{resolveActionLabel(action)}
					</Button>
				{/each}
			</div>
		{/snippet}
	</AgentPanelHeader>
</div>
