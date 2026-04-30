<script lang="ts">
	import type {
		AgentPanelActionCallbacks,
		AgentPanelActionDescriptor,
		AgentPanelCardModel,
	} from "./types.js";

	import { Button } from "../button/index.js";

	interface Props {
		card: AgentPanelCardModel;
		actionCallbacks?: AgentPanelActionCallbacks;
	}

	let { card, actionCallbacks = {} }: Props = $props();

	function actionDisabled(action: AgentPanelActionDescriptor): boolean {
		return action.state === "disabled" || action.state === "busy";
	}

	function runAction(action: AgentPanelActionDescriptor): void {
		const callback = actionCallbacks[action.id];
		callback?.();
	}
</script>

<div class="rounded-xl border border-border/50 bg-background/80 p-3">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="text-sm font-medium text-foreground">{card.title}</p>
			{#if card.description}
				<p class="mt-1 text-sm text-muted-foreground">{card.description}</p>
			{/if}
			{#if card.meta && card.meta.length > 0}
				<div class="mt-3 grid gap-2">
					{#each card.meta as item (item.id)}
						<div class="flex items-center justify-between gap-3 text-sm">
							<span class="text-muted-foreground">{item.label}</span>
							<span class="text-foreground">{item.value ?? "—"}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
		<div class="flex flex-wrap justify-end gap-1">
			{#each card.actions as action (action.id)}
				<Button
					variant={action.destructive ? "destructive" : "headerAction"}
					size="headerAction"
					disabled={actionDisabled(action)}
					onclick={() => runAction(action)}
				>
					{action.label ?? action.id}
				</Button>
			{/each}
		</div>
	</div>
</div>
