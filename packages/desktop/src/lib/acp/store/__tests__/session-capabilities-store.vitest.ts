import { beforeEach, describe, expect, it } from "vitest";

import {
	DEFAULT_CAPABILITIES,
	SessionCapabilitiesStore,
} from "../session-capabilities-store.svelte.js";

describe("SessionCapabilitiesStore", () => {
	let store: SessionCapabilitiesStore;

	beforeEach(() => {
		store = new SessionCapabilitiesStore();
	});

	describe("getCapabilities", () => {
		it("should return default capabilities for unknown session", () => {
			const caps = store.getCapabilities("unknown");
			expect(caps).toEqual(DEFAULT_CAPABILITIES);
		});

		it("should return set capabilities", () => {
			store.setCapabilities("session1", {
				availableModels: [{ id: "model1", name: "Model 1" }],
				availableModes: [{ id: "mode1", name: "Mode 1" }],
			});

			const caps = store.getCapabilities("session1");
			expect(caps.availableModels).toHaveLength(1);
			expect(caps.availableModes).toHaveLength(1);
		});
	});

	describe("hasCapabilities", () => {
		it("should return false for unknown session", () => {
			expect(store.hasCapabilities("unknown")).toBe(false);
		});

		it("should return true after setting capabilities", () => {
			store.setCapabilities("session1", {
				availableModels: [],
				availableModes: [],
			});

			expect(store.hasCapabilities("session1")).toBe(true);
		});
	});

	describe("setCapabilities (immediate)", () => {
		it("should set full capabilities immediately", () => {
			store.setCapabilities("session1", {
				availableModels: [{ id: "m1", name: "M1" }],
				availableModes: [{ id: "mode1", name: "Mode 1" }],
				availableCommands: [{ name: "cmd1", description: "Cmd 1" }],
			});

			const caps = store.getCapabilities("session1");
			expect(caps.availableModels).toHaveLength(1);
			expect(caps.availableModes).toHaveLength(1);
			expect(caps.availableCommands).toHaveLength(1);
		});

		it("should default availableCommands to empty array", () => {
			store.setCapabilities("session1", {
				availableModels: [],
				availableModes: [],
			});

			const caps = store.getCapabilities("session1");
			expect(caps.availableCommands).toEqual([]);
		});
	});

	describe("updateCapabilities", () => {
		it("should merge multiple updates", () => {
			store.setCapabilities("session1", {
				availableModels: [],
				availableModes: [],
			});

			store.updateCapabilities("session1", {
				availableModels: [{ id: "m1", name: "M1" }],
			});
			store.updateCapabilities("session1", {
				availableModes: [{ id: "mode1", name: "Mode 1" }],
			});

			const caps = store.getCapabilities("session1");
			expect(caps.availableModels).toHaveLength(1);
			expect(caps.availableModes).toHaveLength(1);
		});

		it("should merge updates within same session (last update wins)", () => {
			store.setCapabilities("session1", {
				availableModels: [],
				availableModes: [],
			});

			store.updateCapabilities("session1", {
				availableModels: [{ id: "m1", name: "M1" }],
			});
			store.updateCapabilities("session1", {
				availableModels: [{ id: "m2", name: "M2" }], // Override
			});

			const caps = store.getCapabilities("session1");
			// Last update wins
			expect(caps.availableModels).toHaveLength(1);
			expect(caps.availableModels[0].id).toBe("m2");
		});

		it("should update capabilities across multiple sessions", () => {
			store.setCapabilities("session1", {
				availableModels: [],
				availableModes: [],
			});
			store.setCapabilities("session2", {
				availableModels: [],
				availableModes: [],
			});

			store.updateCapabilities("session1", {
				availableModels: [{ id: "m1", name: "M1" }],
			});
			store.updateCapabilities("session2", {
				availableModes: [{ id: "mode1", name: "Mode 1" }],
			});

			expect(store.getCapabilities("session1").availableModels).toHaveLength(1);
			expect(store.getCapabilities("session2").availableModes).toHaveLength(1);
		});
	});

	describe("removeCapabilities", () => {
		it("should remove capabilities", () => {
			store.setCapabilities("session1", {
				availableModels: [{ id: "m1", name: "M1" }],
				availableModes: [],
			});

			expect(store.hasCapabilities("session1")).toBe(true);

			store.removeCapabilities("session1");

			expect(store.hasCapabilities("session1")).toBe(false);
			expect(store.getCapabilities("session1")).toEqual(DEFAULT_CAPABILITIES);
		});

		it("should handle removing non-existent session gracefully", () => {
			// Should not throw
			store.removeCapabilities("non-existent");
			expect(store.hasCapabilities("non-existent")).toBe(false);
		});
	});
});
