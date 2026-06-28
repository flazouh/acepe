import { getContext, setContext } from "svelte";

import { clampSurfaceLevel } from "./surface-classes.js";

const SURFACE_CONTEXT_KEY = Symbol("surface-level");

export function getSurfaceLevel(): number {
	return getContext<number>(SURFACE_CONTEXT_KEY) ?? 1;
}

export function setSurfaceContext(level: number): void {
	setContext(SURFACE_CONTEXT_KEY, clampSurfaceLevel(level));
}
