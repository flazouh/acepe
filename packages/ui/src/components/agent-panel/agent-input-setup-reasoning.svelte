<!--
  AgentInputSetupReasoning - Reasoning effort control for the new-thread setup row.

  Brain icon with dropdown menu. Host wraps in setup chip shell alongside model selector.
-->
<script lang="ts">
	import AgentInputConfigOptionSelector from "./agent-input-config-option-selector.svelte";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";

	interface Props {
		configOption: AgentInputConfigOption;
		disabled?: boolean;
		onValueChange: (configId: string, value: string) => void;
	}

	let { configOption, disabled = false, onValueChange }: Props = $props();
</script>

<div data-testid="setup-reasoning">
	<AgentInputConfigOptionSelector
		{configOption}
		{disabled}
		triggerSize="setupChip"
		{onValueChange}
	/>
</div>
