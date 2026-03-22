import { describe, expect, it } from "bun:test";
import { AGENT_IDS } from "../../types/agent-id.js";
import { CanonicalModeId } from "../../types/canonical-mode-id.js";
import { normalizeModeIdForUI } from "../mode-mapping.js";

describe("normalizeModeIdForUI", () => {
	it("returns canonical IDs unchanged", () => {
		expect(normalizeModeIdForUI(CanonicalModeId.BUILD)).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI(CanonicalModeId.PLAN)).toBe(CanonicalModeId.PLAN);
	});

	it("maps known Rust agent IDs to build (mirrors client.rs normalize_mode_id)", () => {
		expect(normalizeModeIdForUI("default")).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("acceptEdits")).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("ask")).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("agent")).toBe(CanonicalModeId.BUILD);
	});

	it("maps unknown IDs to build (default fallback)", () => {
		expect(normalizeModeIdForUI("unknown")).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("")).toBe(CanonicalModeId.BUILD);
	});

	it("uses per-agent aliases when agentId provided", () => {
		expect(normalizeModeIdForUI("default", AGENT_IDS.CLAUDE_CODE)).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("acceptEdits", AGENT_IDS.CLAUDE_CODE)).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("ask", AGENT_IDS.CURSOR)).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("agent", AGENT_IDS.CURSOR)).toBe(CanonicalModeId.BUILD);
	});

	it("falls back to shared map when agent has no mapping for mode", () => {
		expect(normalizeModeIdForUI("default", AGENT_IDS.CODEX)).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("ask", AGENT_IDS.CODEX)).toBe(CanonicalModeId.BUILD);
		expect(normalizeModeIdForUI("default", AGENT_IDS.OPENCODE)).toBe(CanonicalModeId.BUILD);
	});
});
