import { describe, expect, it } from "bun:test";
import { CanonicalModeId } from "../../types/canonical-mode-id.js";
import { normalizeModeIdForUI } from "../mode-mapping.js";

describe("normalizeModeIdForUI", () => {
	it("returns canonical IDs unchanged", () => {
		expect(normalizeModeIdForUI(CanonicalModeId.BUILD)).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI(CanonicalModeId.PLAN)).toBe(CanonicalModeId.PLAN);
	});

	it("maps non-canonical IDs to build without keeping per-agent aliases in TS", () => {
		expect(normalizeModeIdForUI("default")).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("acceptEdits")).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("ask")).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("agent")).toBe(CanonicalModeId.BUILD);
	});

	it("maps unknown IDs to build (default fallback)", () => {
		expect(normalizeModeIdForUI("unknown")).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("")).toBe(CanonicalModeId.BUILD);
	});
});
