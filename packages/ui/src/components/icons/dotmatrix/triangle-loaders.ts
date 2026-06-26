import {
	TRIANGLE_CENTER_COL,
	TRIANGLE_CENTER_ROW,
	behindAlongPath,
	isWithinTriangleMask,
	modF,
	pathIndexForCoords,
	smoothstep01,
	triangleFrameFromPhase,
	type TriangleLoaderConfig,
} from "./triangle-core.js";

export type TriangleLoaderId =
	| "dotm-triangle-1"
	| "dotm-triangle-2"
	| "dotm-triangle-3"
	| "dotm-triangle-4"
	| "dotm-triangle-5"
	| "dotm-triangle-6"
	| "dotm-triangle-7"
	| "dotm-triangle-8"
	| "dotm-triangle-9"
	| "dotm-triangle-10"
	| "dotm-triangle-11"
	| "dotm-triangle-12"
	| "dotm-triangle-13"
	| "dotm-triangle-14"
	| "dotm-triangle-15"
	| "dotm-triangle-16"
	| "dotm-triangle-18"
	| "dotm-triangle-19";

const PERIMETER_PATH: ReadonlyArray<readonly [number, number]> = [
	[1, 3],
	[2, 2],
	[3, 1],
	[4, 0],
	[4, 2],
	[4, 4],
	[4, 6],
	[3, 5],
	[2, 4],
];

const COLUMN_RAKE_PATH: ReadonlyArray<readonly [number, number]> = [
	[4, 0],
	[3, 1],
	[4, 2],
	[2, 2],
	[3, 3],
	[1, 3],
	[4, 4],
	[2, 4],
	[4, 6],
	[3, 5],
];

const SERPENT_PATH: ReadonlyArray<readonly [number, number]> = [
	[4, 0],
	[4, 2],
	[4, 4],
	[4, 6],
	[3, 5],
	[3, 3],
	[3, 1],
	[2, 2],
	[2, 4],
	[1, 3],
];

const LEFT_WING = new Set(["2,2", "3,1", "4,0", "4,2"]);
const RIGHT_WING = new Set(["2,4", "3,5", "4,4", "4,6"]);

const HUBS: ReadonlyArray<readonly [number, number]> = [
	[1, 3],
	[4, 0],
	[4, 6],
];

const DELTAS_8: ReadonlyArray<readonly [number, number]> = [
	[-1, -1],
	[-1, 0],
	[-1, 1],
	[0, -1],
	[0, 1],
	[1, -1],
	[1, 0],
	[1, 1],
];

function buildBfsRingFromCenter(): Map<string, number> {
	const dist = new Map<string, number>();
	const start = "3,3";
	if (!isWithinTriangleMask(3, 3)) {
		return dist;
	}
	const queue: Array<[number, number]> = [[3, 3]];
	dist.set(start, 0);
	let head = 0;
	while (head < queue.length) {
		const current = queue[head];
		head += 1;
		if (current === undefined) {
			continue;
		}
		const [r, c] = current;
		const d = dist.get(`${r},${c}`) ?? 0;
		for (const delta of DELTAS_8) {
			const nr = r + delta[0];
			const nc = c + delta[1];
			const key = `${nr},${nc}`;
			if (isWithinTriangleMask(nr, nc) && !dist.has(key)) {
				dist.set(key, d + 1);
				queue.push([nr, nc]);
			}
		}
	}
	return dist;
}

const BFS_RING = buildBfsRingFromCenter();
const MAX_RING = Math.max(0, ...BFS_RING.values());

const D1 = 0x01;
const D2 = 0x02;
const D3 = 0x04;
const D4 = 0x08;
const D5 = 0x10;
const D6 = 0x20;

const BIT_TO_FILL_INDEX: Record<number, number> = {
	[D1]: 0,
	[D2]: 1,
	[D3]: 2,
	[D4]: 3,
	[D5]: 4,
	[D6]: 5,
};

function brailleBitForTriangle(row: number, col: number): number | null {
	if (row === 2 && col === 2) return D1;
	if (row === 3 && col === 1) return D2;
	if (row === 4 && col === 0) return D3;
	if (row === 2 && col === 4) return D4;
	if (row === 3 && col === 5) return D5;
	if (row === 4 && col === 6) return D6;
	return null;
}

function meanFills(indices: readonly number[], fills: readonly number[]): number {
	let sum = 0;
	for (const index of indices) {
		sum += fills[index] ?? 0;
	}
	return sum / indices.length;
}

function waveFills(introT: number): number[] {
	const waveHalf = 0.82;
	const waveCenter = -waveHalf + introT * (5 + 2 * waveHalf);
	const fills: number[] = [];
	for (let index = 0; index < 6; index += 1) {
		fills.push(smoothstep01(index - waveHalf, index + waveHalf, waveCenter));
	}
	return fills;
}

function cycleParamsTriangle6(phase: number): {
	fills: number[];
	blinkMul: number;
	resetMul: number;
} {
	const introPhase = 0.52;
	const blinkPhase = 0.36;
	const resetPhase = 0.12;
	if (phase < introPhase) {
		const introT = phase / introPhase;
		return { fills: waveFills(introT), blinkMul: 1, resetMul: 1 };
	}
	if (phase < introPhase + blinkPhase) {
		const bt = (phase - introPhase) / blinkPhase;
		const on = Math.floor(bt * 4) % 2 === 0;
		return { fills: [1, 1, 1, 1, 1, 1], blinkMul: on ? 1 : 0.08, resetMul: 1 };
	}
	const rt = (phase - introPhase - blinkPhase) / resetPhase;
	const resetMul = 1 - smoothstep01(0, 1, rt);
	return { fills: [1, 1, 1, 1, 1, 1], blinkMul: 1, resetMul };
}

function opacityTriangle6(
	row: number,
	col: number,
	fills: readonly number[],
	blinkMul: number,
	resetMul: number,
): number {
	const lowOpacity = 0.07;
	const midOpacity = 0.36;
	const highOpacity = 0.96;
	const lift = (base: number): number => lowOpacity + (base - lowOpacity) * blinkMul * resetMul;
	const bit = brailleBitForTriangle(row, col);
	if (bit !== null) {
		const idx = BIT_TO_FILL_INDEX[bit] ?? 0;
		const raw = lowOpacity + (highOpacity - lowOpacity) * (fills[idx] ?? 0);
		return lift(raw);
	}
	if (row === 1 && col === 3) {
		const m = meanFills([0, 3], fills);
		const raw =
			lowOpacity + (highOpacity - lowOpacity) * m * 0.92 + (midOpacity - lowOpacity) * (1 - m) * 0.35;
		return lift(Math.min(highOpacity, raw));
	}
	if (row === 3 && col === 3) {
		const m = meanFills([0, 1, 2, 3, 4, 5], fills);
		const raw =
			lowOpacity +
			(highOpacity - lowOpacity) * m * 0.88 +
			(midOpacity - lowOpacity) * (1 - m) * 0.4;
		return lift(Math.min(highOpacity, raw));
	}
	if (row === 4 && col === 2) {
		const m = meanFills([1, 2], fills);
		const raw = lowOpacity + (midOpacity + 0.28 - lowOpacity) * m;
		return lift(raw);
	}
	if (row === 4 && col === 4) {
		const m = meanFills([4, 5], fills);
		const raw = lowOpacity + (midOpacity + 0.28 - lowOpacity) * m;
		return lift(raw);
	}
	return lowOpacity;
}

type WingSector = "left" | "right" | "spine" | "none";

function sectorForCell(row: number, col: number): WingSector {
	const key = `${row},${col}`;
	if (row === 1 && col === 3) return "spine";
	if (row === 3 && col === 3) return "spine";
	if (LEFT_WING.has(key)) return "left";
	if (RIGHT_WING.has(key)) return "right";
	return "none";
}

function manhattan(aRow: number, aCol: number, bRow: number, bCol: number): number {
	return Math.abs(aRow - bRow) + Math.abs(aCol - bCol);
}

function falloffFromHub(row: number, col: number, hub: readonly [number, number]): number {
	const d = manhattan(row, col, hub[0], hub[1]);
	return 1 - smoothstep01(0, 5.4, d);
}

function angleDiff(a: number, b: number): number {
	let d = a - b;
	while (d > Math.PI) {
		d -= Math.PI * 2;
	}
	while (d < -Math.PI) {
		d += Math.PI * 2;
	}
	return d;
}

const dotmTriangle1: TriangleLoaderConfig = {
	id: "dotm-triangle-1",
	cycleMsBase: 1650,
	defaultSpeed: 5,
	idlePhase: 0,
	stepCount: 30,
	opacityForCell(row, col, phase) {
		const stepCount = 30;
		const baseOpacity = 0.08;
		const centerOpacity = 0.24;
		const tailLevels = [0.96, 0.72, 0.52, 0.34, 0.2] as const;
		const frame = triangleFrameFromPhase(phase, stepCount);
		let opacity = baseOpacity;
		if (row === TRIANGLE_CENTER_ROW && col === TRIANGLE_CENTER_COL) {
			opacity = centerOpacity;
		}
		const head = Math.floor((frame / stepCount) * PERIMETER_PATH.length) % PERIMETER_PATH.length;
		for (let trail = 0; trail < tailLevels.length; trail += 1) {
			const idx = (head - trail + PERIMETER_PATH.length) % PERIMETER_PATH.length;
			const step = PERIMETER_PATH[idx];
			if (step === undefined) continue;
			const [pathRow, pathCol] = step;
			if (row === pathRow && col === pathCol) {
				opacity = Math.max(opacity, tailLevels[trail] ?? baseOpacity);
				break;
			}
		}
		return opacity;
	},
};

const dotmTriangle2: TriangleLoaderConfig = {
	id: "dotm-triangle-2",
	cycleMsBase: 1550,
	defaultSpeed: 1.5,
	idlePhase: 0,
	stepCount: 36,
	opacityForCell(row, col, phase) {
		const stepCount = 36;
		const baseOpacity = 0.08;
		const midOpacity = 0.34;
		const highOpacity = 0.94;
		const frame = triangleFrameFromPhase(phase, stepCount);
		const progress = frame / stepCount;
		const rowPhase = (4 - row) * 0.13;
		const pulse = 0.5 - 0.5 * Math.cos((progress + rowPhase) * Math.PI * 2);
		const crest = pulse * pulse;
		const altitudeWeight = 0.58 + (4 - row) * 0.16;
		const centerWeight = col === 3 ? 0.16 : 0;
		const opacity =
			baseOpacity +
			pulse * (midOpacity - baseOpacity) +
			crest * (altitudeWeight + centerWeight) * (highOpacity - midOpacity);
		return Math.min(highOpacity, opacity);
	},
};

const dotmTriangle3: TriangleLoaderConfig = {
	id: "dotm-triangle-3",
	cycleMsBase: 1650,
	defaultSpeed: 1.45,
	idlePhase: 0,
	stepCount: 36,
	opacityForCell(row, col, phase) {
		const stepCount = 36;
		const baseOpacity = 0.03;
		const midOpacity = 0.07;
		const highOpacity = 0.94;
		const farOpacity = 0.15;
		const frame = triangleFrameFromPhase(phase, stepCount);
		const theta = (frame / stepCount) * Math.PI * 2;
		const sweepX = Math.cos(theta);
		const sweepY = Math.sin(theta);
		const ambientPulse = 0.5 - 0.5 * Math.cos(theta);
		const centerRow = row - 3;
		const centerCol = col - 3;
		const radius = Math.hypot(centerRow, centerCol);
		const projection = centerCol * sweepX + centerRow * sweepY;
		const perpendicular = Math.abs(centerCol * sweepY - centerRow * sweepX);
		const ahead = Math.max(0, projection);
		const beamCore = Math.max(0, 1 - perpendicular / 0.45);
		const beamHalo = Math.max(0, 1 - perpendicular / 1.15);
		const rangeFade = Math.max(0.25, 1 - radius / 3.6);
		const trail = beamHalo * Math.max(0, 1 - ahead / 3.6);
		let opacity = baseOpacity + ambientPulse * (midOpacity - baseOpacity) * rangeFade;
		opacity = Math.max(opacity, midOpacity + beamCore * (highOpacity - midOpacity));
		opacity = Math.max(opacity, farOpacity + trail * (midOpacity - farOpacity));
		if (row === 3 && col === 3) {
			opacity = Math.max(opacity, 0.56);
		}
		return Math.min(highOpacity, opacity);
	},
};

const dotmTriangle4: TriangleLoaderConfig = {
	id: "dotm-triangle-4",
	cycleMsBase: 1450,
	defaultSpeed: 1.5,
	idlePhase: 0,
	stepCount: 28,
	opacityForCell(row, col, phase) {
		const stepCount = 28;
		const baseOpacity = 0;
		const midOpacity = 0;
		const trailLevels = [0.96, 0.52, 0.3] as const;
		const frame = triangleFrameFromPhase(phase, stepCount);
		const segmentLength = Math.max(1, Math.floor(stepCount / 3));
		let opacity = row === 3 && col === 3 ? midOpacity : baseOpacity;
		for (let headOffset = 0; headOffset < 3; headOffset += 1) {
			const spokeFrame = (frame + headOffset * segmentLength) % stepCount;
			const head = Math.floor((spokeFrame / stepCount) * PERIMETER_PATH.length);
			for (let trail = 0; trail < trailLevels.length; trail += 1) {
				const idx = (head - trail + PERIMETER_PATH.length) % PERIMETER_PATH.length;
				const step = PERIMETER_PATH[idx];
				if (step === undefined) continue;
				const [pathRow, pathCol] = step;
				if (row === pathRow && col === pathCol) {
					opacity = Math.max(opacity, trailLevels[trail] ?? baseOpacity);
					break;
				}
			}
		}
		return opacity;
	},
};

const dotmTriangle5: TriangleLoaderConfig = {
	id: "dotm-triangle-5",
	cycleMsBase: 1700,
	defaultSpeed: 1.8,
	idlePhase: 0,
	stepCount: 42,
	opacityForCell(row, col, phase) {
		const stepCount = 42;
		const baseOpacity = 0.06;
		const midOpacity = 0.3;
		const highOpacity = 0.92;
		const frame = triangleFrameFromPhase(phase, stepCount);
		const progress = frame / stepCount;
		const pingPong = 0.5 - 0.5 * Math.cos(progress * Math.PI * 2);
		const scanRow = 1 + pingPong * 3;
		const distance = Math.abs(row - scanRow);
		const beam = Math.max(0, 1 - distance / 2.2);
		const easedBeam = beam * beam;
		let opacity = baseOpacity + easedBeam * (highOpacity - baseOpacity);
		if (distance > 1.3) {
			opacity = Math.max(opacity, midOpacity - Math.min(0.18, (distance - 1.3) * 0.12));
		}
		if (row === 3 && col === 3) {
			opacity = Math.max(opacity, 0.42);
		}
		return opacity;
	},
};

const dotmTriangle6: TriangleLoaderConfig = {
	id: "dotm-triangle-6",
	cycleMsBase: 3000,
	defaultSpeed: 2.2,
	idlePhase: 0.55,
	opacityForCell(row, col, phase) {
		const params = cycleParamsTriangle6(phase);
		return opacityTriangle6(row, col, params.fills, params.blinkMul, params.resetMul);
	},
};

const dotmTriangle7: TriangleLoaderConfig = {
	id: "dotm-triangle-7",
	cycleMsBase: 2200,
	defaultSpeed: 1.65,
	idlePhase: 0.22,
	opacityForCell(row, col, phase) {
		const baseOpacity = 0.06;
		const midOpacity = 0.38;
		const highOpacity = 0.96;
		const diag = row + col;
		const t = phase * Math.PI * 2;
		const u = diag * 0.55 - t * 1.35;
		const primary = 0.5 + 0.5 * Math.cos(u);
		const harmonic = 0.5 + 0.5 * Math.cos(u * 2 + 0.4);
		const crest = primary * primary * 0.92 + Math.max(0, harmonic - 0.35) * 0.28;
		let opacity = baseOpacity + crest * (highOpacity - baseOpacity);
		if (row === 3 && col === 3) {
			opacity = Math.max(opacity, midOpacity + (crest - 0.25) * 0.35);
		}
		return Math.min(highOpacity, opacity);
	},
};

const dotmTriangle8: TriangleLoaderConfig = {
	id: "dotm-triangle-8",
	cycleMsBase: 1500,
	defaultSpeed: 1.55,
	idlePhase: 0.25,
	opacityForCell(row, col, phase) {
		const baseOpacity = 0.05;
		const midOpacity = 0.42;
		const highOpacity = 0.96;
		const p = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
		const leftLift = p * p;
		const rightLift = (1 - p) * (1 - p);
		const crossover = Math.max(0, 1 - 4 * (p - 0.5) * (p - 0.5));
		const sector = sectorForCell(row, col);
		if (sector === "none") return 0;
		if (sector === "spine") {
			if (row === 1 && col === 3) {
				const apex = midOpacity + crossover * (highOpacity - midOpacity) * 0.95;
				return Math.min(highOpacity, apex);
			}
			const hub =
				baseOpacity +
				crossover * 0.55 * (highOpacity - baseOpacity) +
				leftLift * 0.08 +
				rightLift * 0.08;
			return Math.min(highOpacity, hub);
		}
		if (sector === "left") {
			return Math.min(highOpacity, baseOpacity + leftLift * (highOpacity - baseOpacity));
		}
		return Math.min(highOpacity, baseOpacity + rightLift * (highOpacity - baseOpacity));
	},
};

const dotmTriangle9: TriangleLoaderConfig = {
	id: "dotm-triangle-9",
	cycleMsBase: 1800,
	defaultSpeed: 1.5,
	idlePhase: 0.18,
	opacityForCell(row, col, phase) {
		const baseOpacity = 0.14;
		const highOpacity = 0.96;
		const ring = BFS_RING.get(`${row},${col}`) ?? 0;
		const span = Math.max(1, MAX_RING);
		const t = phase * Math.PI * 2;
		const u = (ring / span) * Math.PI * 2 - t;
		const wave = 0.5 + 0.5 * Math.cos(u);
		const crest = smoothstep01(0.35, 1, wave);
		return Math.min(highOpacity, baseOpacity + crest * (highOpacity - baseOpacity));
	},
};

const dotmTriangle10: TriangleLoaderConfig = {
	id: "dotm-triangle-10",
	cycleMsBase: 1750,
	defaultSpeed: 1.8,
	idlePhase: 0,
	stepCount: 36,
	opacityForCell(row, col, phase) {
		const stepCount = 36;
		const baseOpacity = 0.07;
		const tailLevels = [0.94, 0.68, 0.42, 0.24] as const;
		const pathLen = COLUMN_RAKE_PATH.length;
		const frame = triangleFrameFromPhase(phase, stepCount);
		const head = Math.floor((frame / stepCount) * pathLen) % pathLen;
		let opacity = baseOpacity;
		for (let trail = 0; trail < tailLevels.length; trail += 1) {
			const idx = (head - trail + pathLen) % pathLen;
			const step = COLUMN_RAKE_PATH[idx];
			if (step === undefined) continue;
			const [pathRow, pathCol] = step;
			if (row === pathRow && col === pathCol) {
				opacity = Math.max(opacity, tailLevels[trail] ?? baseOpacity);
				break;
			}
		}
		return opacity;
	},
};

const dotmTriangle11: TriangleLoaderConfig = {
	id: "dotm-triangle-11",
	cycleMsBase: 1400,
	defaultSpeed: 1.75,
	idlePhase: 0.18,
	opacityForCell(row, col, phase) {
		const baseOpacity = 0.13;
		const midOpacity = 0.36;
		const highOpacity = 0.96;
		const tier = Math.abs(row - 1) + Math.abs(col - 3);
		const maxTier = 6;
		const t = phase * Math.PI * 2;
		const u = (tier / maxTier) * Math.PI * 2 - t;
		const wave = 0.5 + 0.5 * Math.cos(u);
		const crest = smoothstep01(0.28, 0.98, wave);
		let opacity = baseOpacity + crest * (highOpacity - baseOpacity);
		if (row === 3 && col === 3) {
			opacity = Math.max(opacity, midOpacity + crest * 0.35);
		}
		return Math.min(highOpacity, opacity);
	},
};

const dotmTriangle12: TriangleLoaderConfig = {
	id: "dotm-triangle-12",
	cycleMsBase: 2300,
	defaultSpeed: 1.5,
	idlePhase: 0.2,
	opacityForCell(row, col, phase) {
		const baseOpacity = 0.06;
		const midOpacity = 0.34;
		const highOpacity = 0.96;
		const skew = row - col;
		const t = phase * Math.PI * 2;
		const u = skew * 0.62 - t * 1.45;
		const primary = 0.5 + 0.5 * Math.cos(u);
		const harmonic = 0.5 + 0.5 * Math.cos(u * 2 - 0.55);
		const pSoft = smoothstep01(0.12, 0.95, primary);
		const hSoft = smoothstep01(0.38, 0.92, harmonic);
		const crest = pSoft * pSoft * 0.88 + Math.max(0, hSoft - 0.42) * 0.32;
		let opacity = baseOpacity + crest * (highOpacity - baseOpacity);
		if (row === 3 && col === 3) {
			opacity = Math.max(opacity, midOpacity + (crest - 0.22) * 0.4);
		}
		return Math.min(highOpacity, opacity);
	},
};

const dotmTriangle13: TriangleLoaderConfig = {
	id: "dotm-triangle-13",
	cycleMsBase: 1400,
	defaultSpeed: 1.65,
	idlePhase: 0.14,
	opacityForCell(row, col, phase) {
		const baseOpacity = 0.13;
		const highOpacity = 0.95;
		const trailSpan = 4.25;
		const pathLen = SERPENT_PATH.length;
		const idx = pathIndexForCoords(SERPENT_PATH, row, col);
		if (idx === null) return 0;
		const s = phase * pathLen;
		const d = behindAlongPath(s, idx, pathLen);
		const g = 1 - smoothstep01(0, trailSpan, d);
		return baseOpacity + g * (highOpacity - baseOpacity);
	},
};

const dotmTriangle14: TriangleLoaderConfig = {
	id: "dotm-triangle-14",
	cycleMsBase: 1500,
	defaultSpeed: 1.45,
	idlePhase: 0.12,
	opacityForCell(row, col, phase) {
		const baseOpacity = 0.07;
		const midOpacity = 0.32;
		const highOpacity = 0.96;
		const beamCenter = phase * 7.2 - 0.35;
		const dist = Math.abs(col - beamCenter);
		const core = 1 - smoothstep01(0, 0.62, dist);
		const halo = 1 - smoothstep01(0.35, 1.42, dist);
		const eased = core * 0.92 + halo * 0.22;
		let opacity = baseOpacity + eased * (highOpacity - baseOpacity);
		if (row === 3 && col === 3) {
			opacity = Math.max(opacity, midOpacity + eased * 0.28);
		}
		return Math.min(highOpacity, opacity);
	},
};

const dotmTriangle15: TriangleLoaderConfig = {
	id: "dotm-triangle-15",
	cycleMsBase: 1100,
	defaultSpeed: 1.8,
	idlePhase: 0.15,
	opacityForCell(row, col, phase) {
		const baseOpacity = 0.08;
		const midOpacity = 0.38;
		const highOpacity = 0.96;
		const t = phase * Math.PI * 2;
		const sharp = 4;
		const u0 = Math.max(0, Math.cos(t)) ** sharp;
		const u1 = Math.max(0, Math.cos(t - (Math.PI * 2) / 3)) ** sharp;
		const u2 = Math.max(0, Math.cos(t - (Math.PI * 4) / 3)) ** sharp;
		const sum = u0 + u1 + u2 + 1e-4;
		const hub0 = HUBS[0];
		const hub1 = HUBS[1];
		const hub2 = HUBS[2];
		if (hub0 === undefined || hub1 === undefined || hub2 === undefined) {
			return baseOpacity;
		}
		const glowA = falloffFromHub(row, col, hub0);
		const glowB = falloffFromHub(row, col, hub1);
		const glowC = falloffFromHub(row, col, hub2);
		const glow = (glowA * u0 + glowB * u1 + glowC * u2) / sum;
		let opacity = baseOpacity + glow * (highOpacity - baseOpacity);
		if (row === 3 && col === 3) {
			opacity = Math.max(opacity, midOpacity + glow * 0.32);
		}
		return Math.min(highOpacity, opacity);
	},
};

const dotmTriangle16: TriangleLoaderConfig = {
	id: "dotm-triangle-16",
	cycleMsBase: 2400,
	defaultSpeed: 1.55,
	idlePhase: 0.12,
	opacityForCell(row, col, phase) {
		const baseOpacity = 0.1;
		const midOpacity = 0.36;
		const highOpacity = 0.96;
		const wing = 0.52;
		const frontSigma = 0.88;
		const t = phase * Math.PI * 2;
		const v = row - wing * Math.abs(col - 3);
		const front = 1.85 + 1.4 * Math.sin(t);
		const d = Math.abs(v - front);
		const glowRaw = Math.exp(-(d * d) / (frontSigma * frontSigma));
		const glow = smoothstep01(0.04, 0.98, glowRaw);
		let opacity = baseOpacity + glow * (highOpacity - baseOpacity);
		if (row === 3 && col === 3) {
			opacity = Math.max(opacity, midOpacity * 0.58 + glow * (highOpacity - midOpacity) * 0.48);
		}
		return Math.min(highOpacity, opacity);
	},
};

const dotmTriangle18: TriangleLoaderConfig = {
	id: "dotm-triangle-18",
	cycleMsBase: 1600,
	defaultSpeed: 1.6,
	idlePhase: 0.2,
	opacityForCell(row, col, phase) {
		const coreDim = 0.1;
		const shellLow = 0.22;
		const shellHigh = 0.96;
		if (row === 3 && col === 3) {
			return coreDim;
		}
		const breathe = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
		const crest = smoothstep01(0.2, 0.94, breathe);
		return shellLow + crest * (shellHigh - shellLow);
	},
};

const dotmTriangle19: TriangleLoaderConfig = {
	id: "dotm-triangle-19",
	cycleMsBase: 1400,
	defaultSpeed: 1.5,
	idlePhase: 0.12,
	opacityForCell(row, col, phase) {
		const baseOpacity = 0.08;
		const midOpacity = 0.38;
		const highOpacity = 0.96;
		const beamSigma = 0.58;
		if (row === TRIANGLE_CENTER_ROW && col === TRIANGLE_CENTER_COL) {
			const hub = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
			const hubSoft = smoothstep01(0.12, 0.9, hub);
			return midOpacity + hubSoft * 0.22;
		}
		const t = phase * Math.PI * 2;
		const ang = Math.atan2(row - TRIANGLE_CENTER_ROW, col - TRIANGLE_CENTER_COL);
		const d = angleDiff(ang, t);
		const beamRaw = Math.exp(-(d * d) / (beamSigma * beamSigma));
		const beam = smoothstep01(0.05, 0.98, beamRaw);
		const rim = 0.5 + 0.5 * Math.cos(ang * 2 - t * 1.15);
		const accent = smoothstep01(0.45, 0.92, rim) * 0.18;
		return Math.min(highOpacity, baseOpacity + (beam + accent) * (highOpacity - baseOpacity));
	},
};

export const TRIANGLE_LOADERS: Record<TriangleLoaderId, TriangleLoaderConfig> = {
	"dotm-triangle-1": dotmTriangle1,
	"dotm-triangle-2": dotmTriangle2,
	"dotm-triangle-3": dotmTriangle3,
	"dotm-triangle-4": dotmTriangle4,
	"dotm-triangle-5": dotmTriangle5,
	"dotm-triangle-6": dotmTriangle6,
	"dotm-triangle-7": dotmTriangle7,
	"dotm-triangle-8": dotmTriangle8,
	"dotm-triangle-9": dotmTriangle9,
	"dotm-triangle-10": dotmTriangle10,
	"dotm-triangle-11": dotmTriangle11,
	"dotm-triangle-12": dotmTriangle12,
	"dotm-triangle-13": dotmTriangle13,
	"dotm-triangle-14": dotmTriangle14,
	"dotm-triangle-15": dotmTriangle15,
	"dotm-triangle-16": dotmTriangle16,
	"dotm-triangle-18": dotmTriangle18,
	"dotm-triangle-19": dotmTriangle19,
};

export function isTriangleLoaderId(value: string): value is TriangleLoaderId {
	return value in TRIANGLE_LOADERS;
}

export function resolveTriangleLoaderId(value: string): TriangleLoaderId | null {
	if (isTriangleLoaderId(value)) {
		return value;
	}
	return null;
}

export function triangleLoaderConfig(id: TriangleLoaderId): TriangleLoaderConfig {
	return TRIANGLE_LOADERS[id];
}
