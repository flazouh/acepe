<script lang="ts">
	import type {
		AgentPanelActionCallbacks,
		AgentPanelActionDescriptor,
		AgentPanelStripModel,
	} from "./types.js";

	import { Button } from "../button/index.js";

	interface Props {
		strip: AgentPanelStripModel;
		actionCallbacks?: AgentPanelActionCallbacks;
	}

	let { strip, actionCallbacks = {} }: Props = $props();

	function actionDisabled(action: AgentPanelActionDescriptor): boolean {
		return action.state === "disabled" || action.state === "busy";
	}

	function runAction(action: AgentPanelActionDescriptor): void {
		const callback = actionCallbacks[action.id];
		callback?.();
	}
</script>

<div class="rounded-lg border border-border/50 bg-background/70 px-3 py-2">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="text-sm font-medium text-foreground">{strip.title}</p>
			{#if strip.description}
				<p class="mt-1 text-sm text-muted-foreground">{strip.description}</p>
			{/if}
			{#if strip.items && strip.items.length > 0}
				<div class="mt-2 flex flex-wrap gap-1">
					{#each strip.items as item (item.id)}
						<span class="rounded-full border border-border/50 px-2 py-0.5 text-sm text-muted-foreground">
							{item.label}{#if item.value}: {item.value}{/if}
						</span>
					{/each}
				</div>
			{/if}
		</div>
		<div class="flex flex-wrap justify-end gap-1">
			{#each strip.actions as action (action.id)}
				<Button
					variant="headerAction"
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
