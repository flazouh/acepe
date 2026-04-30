<script lang="ts">
	import type { Snippet } from "svelte";

	import {
		AGENT_PANEL_ACTION_IDS,
		type AgentPanelActionCallbacks,
		type AgentPanelActionDescriptor,
		type AgentPanelComposerModel,
	} from "./types.js";

	import { cn } from "../../lib/utils.js";
	import { Button } from "../button/index.js";
	import { InputContainer } from "../input-container/index.js";

	interface Props {
		composer?: AgentPanelComposerModel | null;
		actionCallbacks?: AgentPanelActionCallbacks;
		onDraftTextChange?: (value: string) => void;
		content?: Snippet;
		footer?: Snippet;
		class?: string;
		inputClass?: string;
		contentClass?: string;
		disabledReason?: string | null;
		children?: Snippet;
	}

	let {
		composer = null,
		actionCallbacks = {},
		onDraftTextChange,
		content: contentSnippet,
		footer: footerSnippet,
		class: className = "",
		inputClass = "border border-border/50 bg-background/70",
		contentClass = "px-3 py-1.5",
		disabledReason = null,
		children,
	}: Props = $props();

	const visibleActions = $derived((composer?.actions ?? []).filter((action) => action.state !== "hidden"));
	const resolvedDisabledReason = $derived(disabledReason ?? composer?.disabledReason ?? null);

	function actionDisabled(action: AgentPanelActionDescriptor): boolean {
		return action.state === "disabled" || action.state === "busy";
	}

	function resolveActionLabel(action: AgentPanelActionDescriptor): string {
		if (action.label) {
			return action.label;
		}

		if (action.id === AGENT_PANEL_ACTION_IDS.composer.submit && composer) {
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

<div class={cn("shrink-0 border-t border-border/50 p-3", className)}>
	<InputContainer class={inputClass} {contentClass}>
		{#snippet content()}
			{#if contentSnippet}
				{@render contentSnippet()}
			{:else if composer}
				<textarea
					class="min-h-[67px] w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
					value={composer.draftText}
					placeholder={composer.placeholder}
					readonly={onDraftTextChange === undefined}
					oninput={handleDraftInput}
				></textarea>
			{:else if children}
				{@render children()}
			{/if}
		{/snippet}
		{#snippet footer()}
			{#if footerSnippet}
				{@render footerSnippet()}
			{:else if composer}
				<div class="flex min-w-0 flex-1 items-center gap-2 px-2">
					{#if composer.selectedModel}
						<span class="truncate text-sm text-muted-foreground">
							{composer.selectedModel.label}
						</span>
					{/if}
					{#each composer.attachments ?? [] as attachment (attachment.id)}
						<span class="truncate rounded-full border border-border/50 px-2 py-0.5 text-sm text-muted-foreground">
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
			{/if}
		{/snippet}
	</InputContainer>

	{#if resolvedDisabledReason}
		<p class="mt-2 text-sm text-muted-foreground">{resolvedDisabledReason}</p>
	{/if}
</div>
