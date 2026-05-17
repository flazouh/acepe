<script lang="ts">
	import type { AgentInputConfigOption } from "../../agent-input-config-option-types.js";

	interface Props {
		configOption: AgentInputConfigOption;
		disabled?: boolean;
		onValueChange: (configId: string, value: string) => void;
	}

	let { configOption, disabled = false, onValueChange }: Props = $props();

	const currentValueLabel = $derived(
		configOption.currentValue != null ? String(configOption.currentValue) : configOption.name
	);
</script>

<button
	type="button"
	title={`${configOption.name}: ${currentValueLabel}`}
	{disabled}
	onclick={() => onValueChange(configOption.id, currentValueLabel)}
>
	{configOption.name}
</button>
