<script lang="ts">
import { getPlanningPlaceholderLabel } from "./planning-label.js";
import PlanningPlaceholderRow from "./planning-placeholder-row.svelte";
import {
	resolveThinkingDurationMs,
	shouldRunThinkingTimer,
} from "./thinking-duration.js";
import type { ToolDurationTiming } from "./tool-duration.js";
import {
	composeWorkingLineDetails,
	composeWorkingLineText,
	formatWorkingLineTokens,
	selectWorkingLineVerb,
} from "./working-line.js";

interface Props {
	durationMs?: number | null;
	startedAtMs?: number | null;
	label?: string | null;
	agentIconSrc?: string | null;
	showWorkingSpark?: boolean;
	/** AC-269: see AgentThinkingEntry's doc in types.ts for the full contract. */
	workingLineVerbs?: readonly string[] | null;
	workingLineSeed?: string | number | null;
	workingLineTokens?: number | null;
}

let {
	durationMs = null,
	startedAtMs = null,
	label = null,
	agentIconSrc = null,
	showWorkingSpark = false,
	workingLineVerbs = null,
	workingLineSeed = null,
	workingLineTokens = null,
}: Props = $props();
let nowMs = $state(Date.now());

const currentDurationMs = $derived(
	resolveThinkingDurationMs({
		startedAtMs,
		durationMs,
		nowMs,
	}),
);

// The working line only ever replaces the Claude working-spark's own
// label -- a generic connection/planning placeholder (showWorkingSpark
// false) keeps its existing plain label untouched.
const hasWorkingLine = $derived(
	showWorkingSpark && workingLineVerbs !== null && workingLineVerbs.length > 0,
);

const workingLineVerbText = $derived(
	hasWorkingLine
		? selectWorkingLineVerb({
				seed: workingLineSeed,
				elapsedMs: currentDurationMs ?? 0,
				verbs: workingLineVerbs ?? [],
			})
		: null,
);

const workingLineDetailsText = $derived(
	composeWorkingLineDetails({
		tokens: formatWorkingLineTokens(workingLineTokens),
	}),
);

const workingLineText = $derived(
	hasWorkingLine
		? composeWorkingLineText({
				verb: workingLineVerbText,
				details: workingLineDetailsText,
			})
		: null,
);

const displayLabel = $derived(
	workingLineText ?? label ?? getPlanningPlaceholderLabel(currentDurationMs),
);

// The elapsed time renders as its own animated counter beside the line,
// for the working line and the plain placeholder alike, so it is no longer
// baked into the working-line text.
const durationTiming = $derived<ToolDurationTiming | null>(
	startedAtMs !== null && startedAtMs !== undefined
		? {
				startedAtMs,
				completedAtMs: null,
				status: "running",
			}
		: null,
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
	showWorkingLineLabel={workingLineText !== null}
	class="py-1 pr-1.5"
/>
