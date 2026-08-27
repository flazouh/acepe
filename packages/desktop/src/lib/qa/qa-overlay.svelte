<script lang="ts">
import { QaOverlay } from "@acepe/ui";
import type { QaScenario, ScenarioSession } from "@acepe/qa-scenario";
import * as Effect from "effect/Effect";
import { onDestroy, onMount } from "svelte";
import { qaOverlayProps, scenarioSwitchUrl } from "./qa-overlay-state.ts";

interface Props {
	session: ScenarioSession;
	known: readonly QaScenario[];
}

let { session, known }: Props = $props();

// The player pushes nothing, so the overlay reads it on a timer. A rune
// effect is not the tool here: this is a poll of state the app does not own,
// not a reaction to app state.
const POLL_MS = 100;

let playback = $state(Effect.runSync(session.controls.state));
let missingCalls = $state<readonly string[]>([]);
let collapsed = $state(false);
let timer: ReturnType<typeof setInterval> | null = null;

const refresh = (): void => {
	playback = Effect.runSync(session.controls.state);
	missingCalls = Effect.runSync(session.record).missingCalls;
};

onMount(() => {
	timer = setInterval(refresh, POLL_MS);
});

onDestroy(() => {
	if (timer !== null) {
		clearInterval(timer);
		timer = null;
	}
});

const overlay = $derived(
	qaOverlayProps({
		scenario: session.scenario,
		playback,
		known,
		missingCalls,
	})
);

const run = (program: Effect.Effect<void>): void => {
	void Effect.runPromise(program).then(refresh);
};
</script>

<QaOverlay
	scenarioName={overlay.scenarioName}
	scenarioDescription={overlay.scenarioDescription}
	playback={overlay.playback}
	cursor={overlay.cursor}
	total={overlay.total}
	lastEventType={overlay.lastEventType}
	rate={overlay.rate}
	rateOptions={overlay.rateOptions}
	scenarios={overlay.scenarios}
	missingCalls={overlay.missingCalls}
	{collapsed}
	onToggleCollapsed={() => {
		collapsed = !collapsed;
	}}
	onPlay={() => run(session.controls.play)}
	onPause={() => run(session.controls.pause)}
	onStep={() => run(session.controls.stepOnce)}
	onSeek={(index) => run(session.controls.seekTo(index))}
	onRate={(rate) => run(session.controls.setRate(rate))}
	onScenario={(name) => {
		window.location.search = scenarioSwitchUrl(window.location.search, name);
	}}
/>
