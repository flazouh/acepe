<!--
  AgentInputModelReasoningFusedControls - Model selector + reasoning effort in one fused chip group.
  Mirrors AgentInputVoiceFusedControls (mic + overflow menu).
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import AgentInputConfigOptionSelector from "./agent-input-config-option-selector.svelte";
	import { FusedPrimaryOverflowGroup } from "../panel-header/index.js";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";

	interface Props {
		modelSelector: Snippet;
		reasoningConfigOption: AgentInputConfigOption;
		disabled?: boolean;
		onConfigOptionChange: (configId: string, value: string) => void;
	}

	let {
		modelSelector,
		reasoningConfigOption,
		disabled = false,
		onConfigOptionChange,
	}: Props = $props();
</script>

<div class="model-reasoning-controls flex shrink-0 items-end">
	{#snippet modelPrimary()}
		{@render modelSelector()}
	{/snippet}
	{#snippet reasoningOverflow()}
		<AgentInputConfigOptionSelector
			configOption={reasoningConfigOption}
			embeddedInGroup
			{disabled}
			onValueChange={(configId, value) => {
				onConfigOptionChange(configId, value);
			}}
		/>
	{/snippet}
	<FusedPrimaryOverflowGroup
		class="min-h-[23px] [&_[data-slot=button]]:min-h-[23px]"
		primary={modelPrimary}
		overflow={reasoningOverflow}
	/>
</div>
