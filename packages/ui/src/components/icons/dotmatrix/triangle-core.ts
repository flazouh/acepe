export const TRIANGLE_MATRIX_SIZE = 7;

export const TRIANGLE_CELLS = new Set([
	"1,3",
	"2,2",
	"2,4",
	"3,1",
	"3,3",
	"3,5",
	"4,0",
	"4,2",
	"4,4",
	"4,6",
]);

export const TRIANGLE_CENTER_ROW = 3;
export const TRIANGLE_CENTER_COL = 3;

export interface TriangleLoaderConfig {
	id: string;
	cycleMsBase: number;
	defaultSpeed: number;
	idlePhase: number;
	stepCount?: number;
	opacityForCell: (row: number, col: number, phase: number) => number;
}

export function isWithinTriangleMask(row: number, col: number): boolean {
	if (row < 0 || row >= TRIANGLE_MATRIX_SIZE || col < 0 || col >= TRIANGLE_MATRIX_SIZE) {
		return false;
	}
	return TRIANGLE_CELLS.has(`${row},${col}`);
}

export function modF(n: number, m: number): number {
	return ((n % m) + m) % m;
}

export function smoothstep01(edge0: number, edge1: number, x: number): number {
	if (edge1 <= edge0) {
		return x >= edge1 ? 1 : 0;
	}
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

export function styleOpacity(opacity: number): number {
	return Math.round(opacity * 1e6) / 1e6;
}

export function triangleFrameFromPhase(phase: number, stepCount: number): number {
	return Math.floor(phase * stepCount) % stepCount;
}

export function behindAlongPath(s: number, index: number, pathLength: number): number {
	return modF(s - index, pathLength);
}

export function pathIndexForCoords(
	path: ReadonlyArray<readonly [number, number]>,
	row: number,
	col: number,
): number | null {
	for (let index = 0; index < path.length; index += 1) {
		const step = path[index];
		if (step === undefined) {
			continue;
		}
		const [pathRow, pathCol] = step;
		if (pathRow === row && pathCol === col) {
			return index;
		}
	}
	return null;
}
