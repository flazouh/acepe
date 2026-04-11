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
	}

	let { header, actionCallbacks = {}, isFullscreen = false, controls }: Props = $props();

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

<div class="shrink-0 border-b border-border/50">
	<AgentPanelHeader
		displayTitle={header.title}
		agentIconSrc={header.agentIconSrc ?? undefined}
		sessionStatus={header.status}
		isFullscreen={isFullscreen}
		projectName={header.projectLabel ?? undefined}
		projectColor={header.projectColor ?? undefined}
		sequenceId={header.sequenceId ?? undefined}
		{controls}
	>
		{#snippet statusIndicator()}
			<AgentPanelStatusIcon status={header.status} />
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

	{#if header.subtitle || header.agentLabel || header.branchLabel || (header.badges?.length ?? 0) > 0}
		<div class="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-[11px] text-muted-foreground">
			{#if header.subtitle}
				<span class="font-medium text-foreground/80">{header.subtitle}</span>
			{/if}
			{#if header.agentLabel}
				<span>Agent: {header.agentLabel}</span>
			{/if}
			{#if header.branchLabel}
				<span>Branch: {header.branchLabel}</span>
			{/if}
			{#each header.badges ?? [] as badge (badge.id)}
				<span class="rounded-full border border-border/50 bg-background/70 px-2 py-0.5 text-[10px]">
					{badge.label}
				</span>
			{/each}
		</div>
	{/if}
</div>
