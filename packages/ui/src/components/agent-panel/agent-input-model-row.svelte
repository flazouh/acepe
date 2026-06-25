<!--
  AgentInputModelRow - Single model row inside the model selector dropdown.

  Thin wrapper over AgentInputSelectorItemRow for model-specific call sites.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import AgentInputSelectorItemRow from "./agent-input-selector-item-row.svelte";

	interface Props {
		modelId: string;
		modelName: string;
		currentModelId: string | null;
		onSelect: () => void;
		leading?: Snippet;
		actions?: Snippet;
	}

	let { modelId, modelName, currentModelId, onSelect, leading, actions }: Props = $props();
</script>

<AgentInputSelectorItemRow
	label={modelName}
	selected={modelId === currentModelId}
	{onSelect}
	{leading}
	trailing={actions}
/>
