<script lang="ts">
	import { getPlanningPlaceholderLabel } from "./planning-label.js";
	import PlanningPlaceholderRow from "./planning-placeholder-row.svelte";
	import { resolveThinkingDurationMs, shouldRunThinkingTimer } from "./thinking-duration.js";
	import type { ToolDurationTiming } from "./tool-duration.js";

	interface Props {
		durationMs?: number | null;
		startedAtMs?: number | null;
		label?: string | null;
		agentIconSrc?: string | null;
		showWorkingSpark?: boolean;
	}

	let {
		durationMs = null,
		startedAtMs = null,
		label = null,
		agentIconSrc = null,
		showWorkingSpark = false,
	}: Props = $props();
	let nowMs = $state(Date.now());

	const currentDurationMs = $derived(
		resolveThinkingDurationMs({
			startedAtMs,
			durationMs,
			nowMs,
		})
	);
	const displayLabel = $derived(label ?? getPlanningPlaceholderLabel(currentDurationMs));
	const durationTiming = $derived<ToolDurationTiming | null>(
		startedAtMs !== null && startedAtMs !== undefined
			? {
					startedAtMs,
					completedAtMs: null,
					status: "running",
				}
			: null
	);

	$effect(() => {
		if (!shouldRunThinkingTimer(startedAtMs)) {
			return;
		}

		nowMs = Date.now();
		const intervalId = window.setInterval(() => {
			nowMs = Date.now();
		}, 1000);

		return () => {
			window.clearInterval(intervalId);
		};
	});
</script>

<PlanningPlaceholderRow
	timing={durationTiming}
	label={displayLabel}
	{agentIconSrc}
	{showWorkingSpark}
	class="py-1 pr-1.5"
/>
