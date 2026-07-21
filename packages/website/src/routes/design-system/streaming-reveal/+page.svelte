<script lang="ts">
/**
 * Showcase: four streaming-text reveal strategies fed the same simulated
 * assistant reply, side by side, so a reviewer can feel the difference and
 * pick one. `createRevealController` (from `@acepe/ui/streaming-reveal`) is
 * imperative — it calls `onUpdate` on its own frame loop — so this page
 * bridges each controller into a Svelte `$state` slot. Controller/timer
 * lifecycle (create on mount or Replay, always `destroy()` the previous
 * run) is exactly the kind of side effect with required cleanup that
 * `$derived` cannot express, so a single `$effect` owns it.
 */
import { reducedMotion } from "@acepe/ui";
import {
	createRevealController,
	type RevealMode,
	type RevealState,
} from "@acepe/ui/streaming-reveal";
import RevealPanel from "./components/reveal-panel.svelte";
import { createBurstSource, DEMO_CONTENT } from "./reveal-demo-source";

interface ModeDescriptor {
	mode: RevealMode;
	label: string;
	description: string;
}

const MODES: readonly ModeDescriptor[] = [
	{
		mode: "instant",
		label: "Instant",
		description: "No animation. Each burst paints on arrival. (Cursor's assistant text)",
	},
	{ mode: "buffer", label: "Buffer", description: "Rate-adaptive character drip. No fade. (Zed)" },
	{
		mode: "buffer-fade",
		label: "Buffer + fade",
		description: "Drip + a soft per-word fade. (Claude app)",
	},
	{
		mode: "block-fade",
		label: "Block fade",
		description: "Whole blocks fade in as they complete, not token by token.",
	},
];

const DRAIN_MS_MIN = 100;
const DRAIN_MS_MAX = 900;
const DRAIN_MS_DEFAULT = 450;
const CADENCE_MS_MIN = 200;
const CADENCE_MS_MAX = 800;
const CADENCE_MS_DEFAULT = 470;

function createInitialRevealState(): RevealState {
	return { targetText: "", visibleText: "", justRevealed: null, done: false };
}

function createInitialPanelStates(): Record<RevealMode, RevealState> {
	return {
		instant: createInitialRevealState(),
		buffer: createInitialRevealState(),
		"buffer-fade": createInitialRevealState(),
		"block-fade": createInitialRevealState(),
	};
}

// Sliders/toggle the reviewer is currently dragging. Applied to the demo on
// the next Replay, not live — so dragging a slider mid-stream can't yank
// every panel out from under a running comparison.
let pendingDrainMs = $state(DRAIN_MS_DEFAULT);
let pendingCadenceMs = $state(CADENCE_MS_DEFAULT);
let pendingReducedMotion = $state(reducedMotion.current);

interface RunConfig {
	drainMs: number;
	cadenceMs: number;
	reducedMotion: boolean;
	runId: number;
}

// Deliberately NOT seeded from pendingDrainMs/pendingCadenceMs (which would
// only capture their value once, at declaration time, and produce a
// misleading "referenced locally" warning) — these are the actual DEMO_
// defaults, kept as a separate source of truth from the slider defaults.
let activeConfig: RunConfig = $state({
	drainMs: DRAIN_MS_DEFAULT,
	cadenceMs: CADENCE_MS_DEFAULT,
	reducedMotion: reducedMotion.current,
	runId: 0,
});

let panelStates: Record<RevealMode, RevealState> = $state(createInitialPanelStates());

function replay(): void {
	activeConfig = {
		drainMs: pendingDrainMs,
		cadenceMs: pendingCadenceMs,
		reducedMotion: pendingReducedMotion,
		runId: activeConfig.runId + 1,
	};
}

$effect(() => {
	const config = activeConfig; // Only dependency: a fresh object each Replay.

	panelStates = createInitialPanelStates();

	const controllers = MODES.map(({ mode }) =>
		createRevealController({
			mode,
			drainMs: config.drainMs,
			reducedMotion: config.reducedMotion,
			onUpdate: (state) => {
				panelStates[mode] = state;
			},
		})
	);

	const source = createBurstSource({
		content: DEMO_CONTENT,
		cadenceMs: config.cadenceMs,
		onBurst: (delta) => {
			for (const controller of controllers) controller.push(delta);
		},
		onEnd: () => {
			for (const controller of controllers) controller.end();
		},
	});
	source.start();

	return () => {
		source.stop();
		for (const controller of controllers) controller.destroy();
	};
});
</script>

<svelte:head>
	<title>Streaming reveal | Acepe Design System</title>
	<meta name="description" content="Compare four streaming-text reveal strategies on the same simulated assistant reply." />
</svelte:head>

<div class="min-h-screen bg-background text-foreground" data-testid="design-system-streaming-reveal-page">
	<header class="border-b border-border/60 bg-background/90 backdrop-blur-xl">
		<div class="mx-auto flex max-w-[92rem] flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
			<a href="/design-system/gradients" class="group inline-flex items-center gap-3">
				<span class="grid size-8 place-items-center rounded-md border border-border bg-card text-xs font-semibold text-foreground">A</span>
				<span>
					<span class="block text-sm font-medium text-foreground">Acepe design system</span>
					<span class="block text-xs text-muted-foreground">Working visual language</span>
				</span>
			</a>
			<p class="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Streaming reveal</p>
		</div>
	</header>

	<main class="mx-auto max-w-[92rem] px-6 py-10 sm:px-8 sm:py-14">
		<section class="max-w-3xl border-b border-border/60 pb-8">
			<p class="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Presentation-buffer engine</p>
			<h1 class="text-4xl font-medium tracking-[-0.04em] text-foreground sm:text-5xl">Four ways to reveal a streamed reply.</h1>
			<p class="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
				The same simulated assistant reply streams into all four panels at once, in identical ~15-word bursts, so you feel the
				difference in real time instead of comparing screenshots. Pick the one that feels right, then wire that mode in.
			</p>
		</section>

		<section class="flex flex-col gap-4 border-b border-border/60 py-6 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between" aria-label="Demo controls">
			<div class="flex flex-wrap items-end gap-6">
				<label class="flex flex-col gap-1.5 text-xs text-muted-foreground">
					Smoothing (drain ms)
					<span class="flex items-center gap-2">
						<input type="range" min={DRAIN_MS_MIN} max={DRAIN_MS_MAX} step="10" bind:value={pendingDrainMs} class="accent-foreground" />
						<span class="w-10 text-right font-mono text-[11px] text-foreground">{pendingDrainMs}</span>
					</span>
				</label>

				<label class="flex flex-col gap-1.5 text-xs text-muted-foreground">
					Burst interval
					<span class="flex items-center gap-2">
						<input type="range" min={CADENCE_MS_MIN} max={CADENCE_MS_MAX} step="10" bind:value={pendingCadenceMs} class="accent-foreground" />
						<span class="w-10 text-right font-mono text-[11px] text-foreground">{pendingCadenceMs}</span>
					</span>
				</label>

				<label class="flex items-center gap-2 text-xs text-muted-foreground">
					<input type="checkbox" bind:checked={pendingReducedMotion} class="accent-foreground" />
					Reduced motion
				</label>
			</div>

			<div class="flex flex-col items-start gap-1.5 sm:items-end">
				<button
					type="button"
					onclick={replay}
					class="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
					data-testid="reveal-replay-button"
				>
					Replay
				</button>
				<p class="text-[11px] text-muted-foreground">Smoothing / burst interval / reduced motion apply on the next Replay.</p>
			</div>
		</section>

		<section class="grid gap-4 py-8 lg:grid-cols-2 xl:grid-cols-4" aria-label="Reveal mode panels" data-testid="reveal-panel-grid">
			{#each MODES as descriptor (descriptor.mode)}
				<RevealPanel mode={descriptor.mode} label={descriptor.label} description={descriptor.description} state={panelStates[descriptor.mode]} />
			{/each}
		</section>
	</main>
</div>
