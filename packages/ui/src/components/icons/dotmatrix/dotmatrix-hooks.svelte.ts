import { onDestroy } from "svelte";

import type { DotMatrixPhase } from "./dotmatrix-core.js";

export function prefersReducedMotion(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return false;
	}
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function resolveDotMatrixPhase(
	animated: boolean,
	hoverAnimated: boolean,
	hoverPhase: DotMatrixPhase,
	reducedMotion: boolean
): DotMatrixPhase {
	if (!animated || reducedMotion) {
		return "idle";
	}
	if (hoverAnimated) {
		return hoverPhase;
	}
	return "loadingRipple";
}

export function createHoverPhaseHandlers(
	hoverAnimated: boolean,
	autoRun: boolean,
	safeSpeed: number,
	setHoverPhase: (phase: DotMatrixPhase) => void,
	getHoverGen: () => number,
	setHoverGen: (next: number) => void,
	clearTimers: () => void,
	addTimer: (id: number) => void
): { readonly onMouseEnter: () => void; readonly onMouseLeave: () => void } {
	const bumpHoverGen = (): number => {
		const next = getHoverGen() + 1;
		setHoverGen(next);
		return next;
	};

	return {
		onMouseEnter: () => {
			if (!hoverAnimated || autoRun) {
				return;
			}
			clearTimers();
			const gen = bumpHoverGen();
			setHoverPhase("collapse");
			const collapseMs = Math.max(1, Math.round(300 / (safeSpeed > 0 ? safeSpeed : 1)));
			const id = window.setTimeout(() => {
				if (getHoverGen() !== gen) {
					return;
				}
				setHoverPhase("hoverRipple");
			}, collapseMs);
			addTimer(id);
		},
		onMouseLeave: () => {
			if (!hoverAnimated || autoRun) {
				return;
			}
			bumpHoverGen();
			clearTimers();
			setHoverPhase("idle");
		},
	};
}

export function createSteppedCycleTicker(
	readOptions: () => UseSteppedCycleOptions,
	setStep: (step: number) => void
): () => void {
	let rafId: number | null = null;
	let startMs = 0;
	let currentStep = -1;
	let stopped = false;

	const syncStep = (nextStep: number): void => {
		if (nextStep === currentStep) {
			return;
		}
		currentStep = nextStep;
		setStep(nextStep);
	};

	const tick = (now: number): void => {
		if (stopped) {
			return;
		}

		const options = readOptions();
		const idleStep = options.idleStep ?? 0;
		if (!options.active) {
			startMs = 0;
			syncStep(idleStep);
			rafId = window.requestAnimationFrame(tick);
			return;
		}

		const safeSteps = Math.max(1, Math.floor(options.steps));
		const safeSpeed = options.speed !== undefined && options.speed > 0 ? options.speed : 1;
		const rawCycleMs = options.cycleMsBase / safeSpeed;
		const rawStepMs = rawCycleMs / safeSteps;
		const stepMs = rawStepMs > 0 && Number.isFinite(rawStepMs) ? rawStepMs : 1;
		const cycleMs = stepMs * safeSteps;

		if (startMs === 0) {
			startMs = now;
		}

		const elapsed = Math.max(0, now - startMs);
		syncStep(Math.floor((elapsed % cycleMs) / stepMs) % safeSteps);
		rafId = window.requestAnimationFrame(tick);
	};

	rafId = window.requestAnimationFrame(tick);

	return () => {
		stopped = true;
		if (rafId !== null) {
			window.cancelAnimationFrame(rafId);
			rafId = null;
		}
	};
}

export function usePrefersReducedMotion(): { readonly current: boolean } {
	let prefersReducedMotion = $state(false);

	if (typeof window !== "undefined") {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");

		const update = () => {
			prefersReducedMotion = query.matches;
		};

		update();
		query.addEventListener("change", update);
		onDestroy(() => {
			query.removeEventListener("change", update);
		});
	}

	return {
		get current(): boolean {
			return prefersReducedMotion;
		},
	};
}

export interface UseCyclePhaseOptions {
	active: boolean;
	cycleMsBase: number;
	speed?: number;
}

export function useCyclePhase(options: UseCyclePhaseOptions): { readonly current: number } {
	let phase = $state(0);
	let rafId: number | null = null;

	const stop = () => {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		phase = 0;
	};

	$effect(() => {
		const active = options.active;
		const cycleMsBase = options.cycleMsBase;
		const speed = options.speed ?? 1;

		if (!active) {
			stop();
			return;
		}

		const safeSpeed = speed > 0 ? speed : 1;
		const raw = cycleMsBase / safeSpeed;
		const cycleMs = raw > 0 && Number.isFinite(raw) ? raw : 1000;
		const startMs = performance.now();

		const tick = (now: number) => {
			const elapsed = ((now - startMs) % cycleMs + cycleMs) % cycleMs;
			phase = elapsed / cycleMs;
			rafId = requestAnimationFrame(tick);
		};

		rafId = requestAnimationFrame(tick);
		return stop;
	});

	onDestroy(stop);

	return {
		get current(): number {
			return phase;
		},
	};
}

export interface UseSteppedCycleOptions {
	active: boolean;
	cycleMsBase: number;
	steps: number;
	speed?: number;
	idleStep?: number;
}

type FrameListener = (now: number) => void;

const frameListeners = new Set<FrameListener>();
let sharedRafId: number | null = null;

function emitFrame(now: number): void {
	for (const listener of frameListeners) {
		listener(now);
	}
}

function frameTick(now: number): void {
	emitFrame(now);
	if (frameListeners.size > 0) {
		sharedRafId = window.requestAnimationFrame(frameTick);
	} else {
		sharedRafId = null;
	}
}

function subscribeFrame(listener: FrameListener): () => void {
	frameListeners.add(listener);
	if (sharedRafId === null) {
		sharedRafId = window.requestAnimationFrame(frameTick);
	}
	return () => {
		frameListeners.delete(listener);
		if (frameListeners.size === 0 && sharedRafId !== null) {
			window.cancelAnimationFrame(sharedRafId);
			sharedRafId = null;
		}
	};
}

export function useSteppedCycle(options: UseSteppedCycleOptions): { readonly current: number } {
	let step = $state(options.active ? 0 : (options.idleStep ?? 0));
	let startMs = 0;
	let isRunning = false;
	let currentStep = options.idleStep ?? 0;
	let unsubscribe: (() => void) | null = null;

	const stop = () => {
		if (unsubscribe !== null) {
			unsubscribe();
			unsubscribe = null;
		}
		isRunning = false;
		const idleStep = options.idleStep ?? 0;
		currentStep = idleStep;
		step = idleStep;
	};

	$effect(() => {
		const active = options.active;
		const cycleMsBase = options.cycleMsBase;
		const steps = options.steps;
		const speed = options.speed ?? 1;
		const idleStep = options.idleStep ?? 0;

		if (!active) {
			stop();
			return;
		}

		const safeSteps = Math.max(1, Math.floor(steps));
		const safeSpeed = speed > 0 ? speed : 1;
		const rawCycleMs = cycleMsBase / safeSpeed;
		const rawStepMs = rawCycleMs / safeSteps;
		const stepMs = rawStepMs > 0 && Number.isFinite(rawStepMs) ? rawStepMs : 1;
		const cycleMs = stepMs * safeSteps;

		const updateStep = (now: number) => {
			if (!isRunning) {
				startMs = now;
				isRunning = true;
			}

			const elapsed = Math.max(0, now - startMs);
			const nextStep = Math.floor((elapsed % cycleMs) / stepMs) % safeSteps;
			if (nextStep !== currentStep) {
				currentStep = nextStep;
				step = nextStep;
			}
		};

		updateStep(performance.now());
		unsubscribe = subscribeFrame(updateStep);
		return stop;
	});

	onDestroy(stop);

	return {
		get current(): number {
			return options.active ? step : (options.idleStep ?? 0);
		},
	};
}

export interface UseDotMatrixPhasesOptions {
	animated?: boolean;
	hoverAnimated?: boolean;
	speed?: number;
}

export interface DotMatrixPhasesResult {
	readonly phase: DotMatrixPhase;
	onMouseEnter: () => void;
	onMouseLeave: () => void;
}

export function useDotMatrixPhases(options: UseDotMatrixPhasesOptions): DotMatrixPhasesResult {
	let hoverPhase = $state<DotMatrixPhase>("idle");
	let hoverGen = 0;
	const timeouts: number[] = [];

	const clearTimers = () => {
		for (let index = 0; index < timeouts.length; index += 1) {
			window.clearTimeout(timeouts[index]!);
		}
		timeouts.length = 0;
	};

	const autoRun = $derived(Boolean(options.animated && !options.hoverAnimated));
	const safeSpeed = $derived(options.speed !== undefined && options.speed > 0 ? options.speed : 1);

	$effect(() => {
		void options.animated;
		void options.hoverAnimated;
		hoverGen += 1;
		clearTimers();
		return clearTimers;
	});

	onDestroy(() => {
		hoverGen += 1;
		clearTimers();
	});

	const onMouseEnter = () => {
		if (!options.hoverAnimated || autoRun) {
			return;
		}
		clearTimers();
		const gen = (hoverGen += 1);
		hoverPhase = "collapse";
		const collapseMs = Math.max(1, Math.round(300 / safeSpeed));
		const id = window.setTimeout(() => {
			if (hoverGen !== gen) {
				return;
			}
			hoverPhase = "hoverRipple";
		}, collapseMs);
		timeouts.push(id);
	};

	const onMouseLeave = () => {
		if (!options.hoverAnimated || autoRun) {
			return;
		}
		hoverGen += 1;
		clearTimers();
		hoverPhase = "idle";
	};

	const phase = $derived<DotMatrixPhase>(
		autoRun ? "loadingRipple" : options.hoverAnimated ? hoverPhase : "idle",
	);

	return {
		get phase(): DotMatrixPhase {
			return phase;
		},
		onMouseEnter,
		onMouseLeave,
	};
}
