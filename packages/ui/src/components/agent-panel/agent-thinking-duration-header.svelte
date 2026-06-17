<!--
  AgentThinkingDurationHeader - Thinking / thought label with animated seconds.
-->
<script lang="ts">
	import AnimateNumber from "../animate-number/animate-number.svelte";
	import {
		getThinkingDurationSeconds,
		getThinkingHeaderPrefix,
	} from "./agent-assistant-message-state.js";

	interface Props {
		isStreaming: boolean;
		thinkingDurationMs?: number | null;
	}

	let { isStreaming, thinkingDurationMs = null }: Props = $props();

	const prefix = $derived(
		getThinkingHeaderPrefix({
			isStreaming,
			thinkingDurationMs: thinkingDurationMs ?? undefined,
		})
	);
	const seconds = $derived(
		thinkingDurationMs !== null &&
			thinkingDurationMs !== undefined &&
			thinkingDurationMs >= 0
			? getThinkingDurationSeconds(thinkingDurationMs)
			: null
	);
</script>

{#if prefix && seconds !== null}
	<span class="inline-flex items-baseline gap-1">
		<span>{prefix}</span>
		<AnimateNumber
			value={seconds}
			format={{ maximumFractionDigits: 0 }}
			duration={450}
			blur={14}
			class="font-medium"
		/>
	</span>
{:else}
	{prefix}
{/if}
