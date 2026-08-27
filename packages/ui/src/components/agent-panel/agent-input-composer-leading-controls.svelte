<!--
  AgentInputComposerLeadingControls - Mode, model and reasoning at the composer's leading edge.

  The three controls a person changes while writing a prompt sit together where
  the eye starts the row: the mode, then the model with its reasoning effort
  fused to it. Voice, metrics and the submit button keep the trailing edge, so
  the row reads as "what I am about to send" on the left and "send it" on the
  right.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import { AGENT_INPUT_CONTROL_GAP_CLASS } from "./agent-input-composer-spacing.js";
	import AgentInputModelReasoningFusedControls from "./agent-input-model-reasoning-fused-controls.svelte";
	import { partitionToolbarConfigOptions } from "./agent-input-config-option-selector-state.js";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";

	let {
		modeSelector,
		modelSelector,
		toolbarConfigOptions = [],
		onConfigOptionChange,
		selectorsLoading = false,
		selectorsDisabledByComposer = false,
	}: {
		/**
		 * The session's mode. Optional because a provider may expose none, and
		 * the model still has to render in that case.
		 */
		modeSelector?: Snippet;
		modelSelector: Snippet;
		toolbarConfigOptions?: readonly AgentInputConfigOption[];
		onConfigOptionChange?: (configId: string, value: string) => void | Promise<void>;
		selectorsLoading?: boolean;
		selectorsDisabledByComposer?: boolean;
	} = $props();

	const reasoningToolbarOption = $derived(
		partitionToolbarConfigOptions(toolbarConfigOptions).reasoning
	);

	const fuseModelWithReasoning = $derived(
		reasoningToolbarOption !== null && onConfigOptionChange !== undefined
	);
</script>

<div
	class="flex min-w-0 items-end {AGENT_INPUT_CONTROL_GAP_CLASS}"
	data-qa="agent-input-leading-controls"
>
	{#if modeSelector}
		<!-- empty:hidden so a provider with no modes adds no stray flex gap. -->
		<div class="shrink-0 empty:hidden" data-qa="agent-input-mode-control">
			{@render modeSelector()}
		</div>
	{/if}
	<div
		class="w-fit min-w-0 max-w-[min(18rem,100%)] shrink overflow-hidden
			[&_[role=group]]:!min-w-0 [&_[role=group]]:!max-w-full
			[&_[data-slot=button]]:!min-w-0 [&_[data-slot=button]]:!max-w-full"
		data-qa="agent-input-model-control"
	>
		{#if fuseModelWithReasoning && reasoningToolbarOption && onConfigOptionChange}
			<AgentInputModelReasoningFusedControls
				{modelSelector}
				reasoningConfigOption={reasoningToolbarOption}
				disabled={selectorsLoading || selectorsDisabledByComposer}
				onConfigOptionChange={(configId, value) => {
					void onConfigOptionChange(configId, value);
				}}
			/>
		{:else}
			{@render modelSelector()}
		{/if}
	</div>
</div>
