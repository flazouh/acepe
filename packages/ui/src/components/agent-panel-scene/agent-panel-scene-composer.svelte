<script lang="ts">
	import {
		AGENT_PANEL_ACTION_IDS,
		type AgentPanelActionCallbacks,
		type AgentPanelActionDescriptor,
		type AgentPanelComposerModel,
	} from "@acepe/agent-panel-contract";

	import { Button } from "../button/index.js";
	import { InputContainer } from "../input-container/index.js";

	interface Props {
		composer: AgentPanelComposerModel;
		actionCallbacks?: AgentPanelActionCallbacks;
		onDraftTextChange?: (value: string) => void;
	}

	let { composer, actionCallbacks = {}, onDraftTextChange }: Props = $props();

	const visibleActions = $derived((composer.actions ?? []).filter((action) => action.state !== "hidden"));

	function actionDisabled(action: AgentPanelActionDescriptor): boolean {
		return action.state === "disabled" || action.state === "busy";
	}

	function resolveActionLabel(action: AgentPanelActionDescriptor): string {
		if (action.label) {
			return action.label;
		}

		if (action.id === AGENT_PANEL_ACTION_IDS.composer.submit) {
			return composer.submitLabel;
		}

		return action.id;
	}

	function runAction(action: AgentPanelActionDescriptor): void {
		const callback = actionCallbacks[action.id];
		callback?.();
	}

	function handleDraftInput(event: Event): void {
		if (!(event.currentTarget instanceof HTMLTextAreaElement)) {
			return;
		}

		onDraftTextChange?.(event.currentTarget.value);
	}
</script>

<div class="shrink-0 border-t border-border/50 p-3">
	<InputContainer class="border border-border/50 bg-background/70" contentClass="px-3 py-2.5">
		{#snippet children()}
			<textarea
				class="min-h-24 w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
				value={composer.draftText}
				placeholder={composer.placeholder}
				readonly={onDraftTextChange === undefined}
				oninput={handleDraftInput}
			></textarea>
		{/snippet}

		{#snippet footer()}
			<div class="flex min-w-0 flex-1 items-center gap-2 px-2">
				{#if composer.selectedModel}
					<span class="truncate text-[11px] text-muted-foreground">
						{composer.selectedModel.label}
					</span>
				{/if}
				{#each composer.attachments ?? [] as attachment (attachment.id)}
					<span class="truncate rounded-full border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground">
						{attachment.label}
					</span>
				{/each}
			</div>
			<div class="flex items-center gap-1 px-2">
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
	</InputContainer>

	{#if composer.disabledReason}
		<p class="mt-2 text-[11px] text-muted-foreground">{composer.disabledReason}</p>
	{/if}
</div>
