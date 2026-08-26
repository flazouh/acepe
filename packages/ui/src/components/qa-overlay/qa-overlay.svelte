<script lang="ts">
	import { cn } from "../../lib/utils.js";
	import type { QaOverlayScenarioOption } from "./types.js";

	interface Props {
		scenarioName: string;
		scenarioDescription: string;
		/** "playing" | "paused", already resolved by the host. */
		playback: string;
		cursor: number;
		total: number;
		/** Type of the event that went out last, or null before the first one. */
		lastEventType: string | null;
		rate: number;
		rateOptions: readonly number[];
		scenarios: readonly QaOverlayScenarioOption[];
		/** Calls the recording has no answer for. Empty is the healthy case. */
		missingCalls: readonly string[];
		collapsed: boolean;
		onToggleCollapsed: () => void;
		onPlay: () => void;
		onPause: () => void;
		onStep: () => void;
		onSeek: (index: number) => void;
		onRate: (rate: number) => void;
		onScenario: (name: string) => void;
		class?: string;
	}

	let {
		scenarioName,
		scenarioDescription,
		playback,
		cursor,
		total,
		lastEventType,
		rate,
		rateOptions,
		scenarios,
		missingCalls,
		collapsed,
		onToggleCollapsed,
		onPlay,
		onPause,
		onStep,
		onSeek,
		onRate,
		onScenario,
		class: className
	}: Props = $props();

	const isPlaying = $derived(playback === "playing");
	const atEnd = $derived(cursor >= total);
	const sliderMax = $derived(total > 0 ? total - 1 : 0);
	const sliderValue = $derived(cursor > 0 ? cursor - 1 : 0);
</script>

<aside
	data-testid="qa-overlay"
	data-qa-scenario={scenarioName}
	data-qa-playback={playback}
	data-qa-cursor={cursor}
	data-qa-total={total}
	class={cn(
		"fixed bottom-3 right-3 z-50 w-80 rounded-xl border border-border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur",
		className
	)}
>
	<header class="flex items-center gap-2 border-b border-border/60 px-3 py-2">
		<span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-wide text-muted-foreground">
			qa
		</span>
		<span data-testid="qa-overlay-name" class="min-w-0 flex-1 truncate text-sm font-medium">
			{scenarioName}
		</span>
		<button
			type="button"
			data-testid="qa-overlay-toggle"
			class="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
			onclick={onToggleCollapsed}
		>
			{collapsed ? "open" : "hide"}
		</button>
	</header>

	{#if !collapsed}
		<div class="space-y-3 px-3 py-3">
			<p class="text-xs leading-snug text-muted-foreground">{scenarioDescription}</p>

			<div class="flex items-center gap-1.5">
				{#if isPlaying}
					<button
						type="button"
						data-testid="qa-overlay-pause"
						class="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
						onclick={onPause}
					>
						pause
					</button>
				{:else}
					<button
						type="button"
						data-testid="qa-overlay-play"
						class="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
						disabled={atEnd}
						onclick={onPlay}
					>
						play
					</button>
				{/if}
				<button
					type="button"
					data-testid="qa-overlay-step"
					class="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
					disabled={atEnd}
					onclick={onStep}
				>
					step
				</button>
				<span
					data-testid="qa-overlay-position"
					class="ml-auto font-mono text-[0.6875rem] text-muted-foreground"
				>
					{cursor}/{total}
				</span>
			</div>

			<label class="block">
				<span class="sr-only">scenario position</span>
				<input
					type="range"
					data-testid="qa-overlay-scrubber"
					class="w-full accent-primary"
					min="0"
					max={sliderMax}
					value={sliderValue}
					oninput={(nativeEvent) => onSeek(Number(nativeEvent.currentTarget.value))}
				/>
			</label>

			<div
				data-testid="qa-overlay-last-event"
				class="truncate font-mono text-[0.6875rem] text-muted-foreground"
			>
				{lastEventType ?? "nothing emitted yet"}
			</div>

			<div class="flex items-center gap-1.5">
				<span class="text-xs text-muted-foreground">rate</span>
				{#each rateOptions as option (option)}
					<button
						type="button"
						data-testid="qa-overlay-rate"
						data-qa-rate={option}
						data-qa-rate-active={option === rate}
						class={cn(
							"rounded border px-1.5 py-0.5 font-mono text-[0.6875rem]",
							option === rate
								? "border-primary bg-primary/10 text-primary"
								: "border-border text-muted-foreground hover:bg-muted"
						)}
						onclick={() => onRate(option)}
					>
						{option === 0 ? "max" : `${option}x`}
					</button>
				{/each}
			</div>

			<div class="space-y-1">
				<span class="text-xs text-muted-foreground">scenario</span>
				{#each scenarios as option (option.name)}
					<button
						type="button"
						data-testid="qa-overlay-scenario"
						data-qa-scenario-name={option.name}
						data-qa-scenario-active={option.active}
						class={cn(
							"block w-full truncate rounded px-1.5 py-1 text-left text-xs",
							option.active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
						)}
						onclick={() => onScenario(option.name)}
					>
						{option.name}
					</button>
				{/each}
			</div>

			{#if missingCalls.length > 0}
				<div data-testid="qa-overlay-missing" class="rounded border border-destructive/40 bg-destructive/5 p-2">
					<span class="text-xs font-medium text-destructive">not in this recording</span>
					<ul class="mt-1 space-y-0.5">
						{#each missingCalls as call (call)}
							<li class="truncate font-mono text-[0.625rem] text-destructive/90">{call}</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</aside>
