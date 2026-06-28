/** Literal class maps so Tailwind v4 static scanner emits surface utilities. */

export const SURFACE_BG: Record<number, string> = {
	1: "bg-surface-1",
	2: "bg-surface-2",
	3: "bg-surface-3",
	4: "bg-surface-4",
	5: "bg-surface-5",
	6: "bg-surface-6",
	7: "bg-surface-7",
	8: "bg-surface-8",
};

export const SURFACE_SHADOW: Record<number, string> = {
	1: "shadow-surface-1",
	2: "shadow-surface-2",
	3: "shadow-surface-3",
	4: "shadow-surface-4",
	5: "shadow-surface-5",
	6: "shadow-surface-6",
	7: "shadow-surface-7",
	8: "shadow-surface-8",
};

export function clampSurfaceLevel(level: number): number {
	return Math.max(1, Math.min(8, level));
}

export function surfaceClasses(bgLevel: number, shadowLevel: number = bgLevel): string {
	const bg = clampSurfaceLevel(bgLevel);
	const shadow = clampSurfaceLevel(shadowLevel);
	return `${SURFACE_BG[bg]} ${SURFACE_SHADOW[shadow]}`;
}

/** Dropdown / popover convention: +2 bg from substrate, fixed shadow-3. */
export const DROPDOWN_SURFACE_OFFSET = 2;
export const DROPDOWN_SURFACE_SHADOW_LEVEL = 3;

export function dropdownSurfaceClasses(substrateLevel: number): string {
	const bgLevel = clampSurfaceLevel(substrateLevel + DROPDOWN_SURFACE_OFFSET);
	return surfaceClasses(bgLevel, DROPDOWN_SURFACE_SHADOW_LEVEL);
}
