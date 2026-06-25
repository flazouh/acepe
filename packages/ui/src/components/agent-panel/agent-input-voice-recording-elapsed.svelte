<!--
  AgentInputVoiceRecordingElapsed - Animated whole-second timer beside the mic stop button.
-->
<script lang="ts">
	import AnimateNumber from "../animate-number/animate-number.svelte";

	interface Props {
		tenths: number;
		class?: string;
	}

	let {
		tenths,
		class: className = "font-mono text-[11px] leading-none text-muted-foreground tabular-nums",
	}: Props = $props();

	const seconds = $derived(Math.floor(tenths / 10));
</script>

<AnimateNumber
	value={seconds}
	format={{ maximumFractionDigits: 0 }}
	suffix="s"
	duration={300}
	blur={12}
	class={className}
/>
