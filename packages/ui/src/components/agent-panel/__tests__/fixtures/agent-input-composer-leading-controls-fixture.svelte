<script lang="ts">
	import AgentInputComposerLeadingControls from "../../agent-input-composer-leading-controls.svelte";
	import type { AgentInputConfigOption } from "../../agent-input-config-option-types.js";

	interface Props {
		showMode?: boolean;
		withReasoning?: boolean;
	}

	let { showMode = true, withReasoning = false }: Props = $props();

	const reasoningConfigOption: AgentInputConfigOption = {
		id: "reasoning-effort",
		name: "Reasoning effort",
		category: "thought_level",
		type: "select",
		currentValue: "medium",
		options: [
			{ name: "Low", value: "low" },
			{ name: "Medium", value: "medium" },
			{ name: "High", value: "high" },
		],
		presentation: "compactReasoning",
	};

	const toolbarConfigOptions = $derived(withReasoning ? [reasoningConfigOption] : []);
</script>

{#snippet modeSelector()}
	{#if showMode}
		<button type="button" data-testid="fixture-mode-trigger">Plan</button>
	{/if}
{/snippet}

{#snippet modelSelector()}
	<button type="button">Sonnet · github-copilot-claude-sonnet-4-6</button>
{/snippet}

<AgentInputComposerLeadingControls
	{modeSelector}
	{modelSelector}
	{toolbarConfigOptions}
	onConfigOptionChange={() => undefined}
/>
