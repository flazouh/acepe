import { describe, expect, it } from "vitest";
import {
	DEFAULT_DOT_MATRIX_LOADER_ID,
	DOT_MATRIX_LOADER_OPTIONS,
	LEGACY_LOADER_ID_MAP,
	normalizeDotMatrixLoaderId,
} from "../loading-icon-preferences.svelte.js";
import { DOTMATRIX_REGISTRY_MANIFEST } from "../dotmatrix/dotmatrix-registry.js";

describe("loading-icon-preferences", () => {
	it("exposes 71 loader options (70 registry + arc-spin)", () => {
		expect(DOT_MATRIX_LOADER_OPTIONS.length).toBe(71);
		expect(DOTMATRIX_REGISTRY_MANIFEST.length).toBe(70);
		expect(DOT_MATRIX_LOADER_OPTIONS.at(-1)?.id).toBe("arc-spin");
	});

	it("defaults to arc-spin (Arc Spin)", () => {
		expect(DEFAULT_DOT_MATRIX_LOADER_ID).toBe("arc-spin");
		expect(normalizeDotMatrixLoaderId(undefined)).toBe("arc-spin");
		expect(normalizeDotMatrixLoaderId(null)).toBe("arc-spin");
	});

	it("maps legacy loader ids to canonical dotmatrix ids", () => {
		expect(normalizeDotMatrixLoaderId("prism-bloom")).toBe("dotm-hex-2");
		expect(normalizeDotMatrixLoaderId("honey-gate")).toBe("dotm-hex-3");
		expect(normalizeDotMatrixLoaderId("vertex-relay")).toBe("dotm-hex-4");
		expect(normalizeDotMatrixLoaderId("spiral-lattice")).toBe("dotm-hex-5");
		expect(normalizeDotMatrixLoaderId("chevron-march")).toBe("dotm-hex-6");
		expect(normalizeDotMatrixLoaderId("hourglass-flip")).toBe("dotm-hex-7");
		expect(normalizeDotMatrixLoaderId("glyph-flip")).toBe("dotm-hex-8");
		expect(normalizeDotMatrixLoaderId("petal-shimmer")).toBe("dotm-hex-9");
		expect(normalizeDotMatrixLoaderId("liquid-vortex")).toBe("dotm-hex-10");
	});

	it("preserves canonical ids and rejects unknown values", () => {
		expect(normalizeDotMatrixLoaderId("dotm-square-1")).toBe("dotm-square-1");
		expect(normalizeDotMatrixLoaderId("arc-spin")).toBe("arc-spin");
		expect(normalizeDotMatrixLoaderId("not-a-loader")).toBe("arc-spin");
	});

	it("documents every legacy alias in LEGACY_LOADER_ID_MAP", () => {
		expect(Object.keys(LEGACY_LOADER_ID_MAP).length).toBe(9);
	});
});
