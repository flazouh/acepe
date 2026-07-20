<script lang="ts">
	import { untrack } from "svelte";

	interface Props {
		char: string;
		direction: number;
		duration: number;
		blur: number;
	}

	let { char, direction, duration, blur }: Props = $props();

	let cur = $state(untrack(() => char));
	let out = $state<string | null>(null);
	let gen = $state(0);

	let prevChar = untrack(() => char);

	$effect(() => {
		const next = char;
		if (next === prevChar) {
			return;
		}
		out = prevChar;
		cur = next;
		gen += 1;
		prevChar = next;
	});

	const animating = $derived(out !== null && out !== cur);

	function handleOutEnd() {
		out = null;
	}
</script>

<span class="an-slot" aria-hidden="true">
	<span
		class="an-layer {animating ? 'an-in' : ''}"
		style="--an-dur:{duration}ms; --an-blur:{blur}px; --an-dir:{direction}"
	>{cur === "" ? "\u200B" : cur}</span>
	{#if animating}
		<span
			class="an-layer an-out"
			style="--an-dur:{duration}ms; --an-blur:{blur}px; --an-dir:{direction}"
			onanimationend={handleOutEnd}
		>{out === "" ? "\u200B" : out}</span>
	{/if}
</span>
