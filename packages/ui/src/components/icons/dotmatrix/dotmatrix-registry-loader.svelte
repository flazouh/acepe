<script lang="ts">
	import { onMount } from "svelte";
	import DotmatrixBase from "./dotmatrix-base.svelte";
	import {
		createHoverPhaseHandlers,
		createSteppedCycleTicker,
		prefersReducedMotion,
		resolveDotMatrixPhase,
	} from "./dotmatrix-hooks.svelte.js";
	import { getDotmatrixLoaderConfig } from "./loaders/index.js";
	import type { DotMatrixPhase } from "./dotmatrix-core.js";
	import type { DotmatrixLoaderRuntime } from "./loader-types.js";

	interface Props {
		loaderId: string;
		size?: number;
		dotSize?: number;
		color?: string;
		speed?: number;
		animated?: boolean;
		hoverAnimated?: boolean;
		class?: string;
		ariaLabel?: string;
	}

	let {
		loaderId,
		size = undefined,
		dotSize = undefined,
		color = "currentColor",
		speed = undefined,
		animated = true,
		hoverAnimated = false,
		class: className = "",
		ariaLabel = "Loading",
	}: Props = $props();

	const config = $derived(getDotmatrixLoaderConfig(loaderId));

	const resolvedSize = $derived(size ?? config?.defaultSize ?? 36);
	const resolvedDotSize = $derived(dotSize ?? config?.defaultDotSize ?? 5);
	const configuredSpeed = $derived(speed ?? config?.defaultSpeed ?? 1);
	const resolvedSpeed = $derived(configuredSpeed > 0 ? configuredSpeed : 1);
	const resolvedPattern = $derived(config?.defaultPattern ?? "full");

	let reducedMotion = $state(false);
	let hoverPhase = $state<DotMatrixPhase>("idle");
	let hoverGen = $state(0);
	let hoverTimers: number[] = [];
	let cyclePhase = $state(0);
	let cycleStep = $state(0);
	let matrixPhase = $state<DotMatrixPhase>("idle");

	const safeSpeed = $derived(resolvedSpeed > 0 ? resolvedSpeed : 1);
	const autoRun = $derived(Boolean(animated && !hoverAnimated && !reducedMotion));

	const runtime = $derived({
		reducedMotion,
		matrixPhase,
		cyclePhase,
		cycleStep,
	} satisfies DotmatrixLoaderRuntime);

	const animationResolver = $derived(
		config ? config.createAnimationResolver(runtime) : () => ({})
	);

	function clearHoverTimers() {
		for (let i = 0; i < hoverTimers.length; i += 1) {
			window.clearTimeout(hoverTimers[i]!);
		}
		hoverTimers = [];
	}

	const hoverHandlers = $derived(
		createHoverPhaseHandlers(
			hoverAnimated,
			autoRun,
			safeSpeed,
			(next) => {
				hoverPhase = next;
			},
			() => hoverGen,
			(next) => {
				hoverGen = next;
			},
			clearHoverTimers,
			(id) => {
				hoverTimers = hoverTimers.concat([id]);
			}
		)
	);

	function syncMatrixPhase() {
		matrixPhase = resolveDotMatrixPhase(animated, hoverAnimated, hoverPhase, reducedMotion);
	}

	onMount(() => {
		reducedMotion = prefersReducedMotion();
		syncMatrixPhase();

		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const onMediaChange = () => {
			reducedMotion = media.matches;
			syncMatrixPhase();
		};
		media.addEventListener("change", onMediaChange);

		let cycleRafId = 0;
		let cycleStart = 0;
		let stopStepped: (() => void) | null = null;

		const runCyclePhaseLoop = () => {
			const hook = config?.cycleHook;
			if (!hook || hook.type !== "cyclePhase") {
				cyclePhase = 0;
				return;
			}

			if (reducedMotion || matrixPhase === "idle") {
				cyclePhase = 0;
				cycleRafId = requestAnimationFrame(runCyclePhaseLoop);
				return;
			}

			if (cycleStart === 0) {
				cycleStart = performance.now();
			}
			const raw = hook.cycleMsBase / safeSpeed;
			const cycleMs = raw > 0 && Number.isFinite(raw) ? raw : 1000;
			const elapsed = ((performance.now() - cycleStart) % cycleMs + cycleMs) % cycleMs;
			cyclePhase = elapsed / cycleMs;
			cycleRafId = requestAnimationFrame(runCyclePhaseLoop);
		};

		const hook = config?.cycleHook;
		if (hook?.type === "cyclePhase") {
			cycleRafId = requestAnimationFrame(runCyclePhaseLoop);
		}

		if (hook?.type === "steppedCycle") {
			const steps = typeof hook.steps === "number" ? hook.steps : 24;
			stopStepped = createSteppedCycleTicker(
				() => ({
					active: !reducedMotion && matrixPhase !== "idle",
					cycleMsBase: hook.cycleMsBase,
					steps,
					speed: safeSpeed,
					idleStep: 0,
				}),
				(step) => {
					cycleStep = step;
				}
			);
		}

		const phaseSyncInterval = window.setInterval(syncMatrixPhase, 50);

		return () => {
			media.removeEventListener("change", onMediaChange);
			clearHoverTimers();
			cancelAnimationFrame(cycleRafId);
			if (stopStepped) {
				stopStepped();
			}
			window.clearInterval(phaseSyncInterval);
		};
	});
</script>

{#if config}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class={className}
		onmouseenter={hoverHandlers.onMouseEnter}
		onmouseleave={hoverHandlers.onMouseLeave}
	>
		<DotmatrixBase
			size={resolvedSize}
			dotSize={resolvedDotSize}
			{color}
			speed={resolvedSpeed}
			pattern={resolvedPattern}
			aria-label={ariaLabel}
			phase={matrixPhase}
			{reducedMotion}
			{animationResolver}
		/>
	</div>
{:else}
	<span class={className} role="status" aria-label={ariaLabel}>Unknown loader: {loaderId}</span>
{/if}
