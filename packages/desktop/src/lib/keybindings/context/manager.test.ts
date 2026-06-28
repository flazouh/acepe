import { describe, expect, it } from "vitest";

import { createKeybindingsService } from "../service.svelte.js";
import { createContextManager } from "./manager.svelte.js";

describe("ContextManager computed providers (pull model)", () => {
	it("get() returns a provider's live value without re-registering", () => {
		const manager = createContextManager();
		let active = false;

		manager.registerProvider("threadActive", () => active);

		expect(manager.get("threadActive")).toBe(false);

		// Pull semantics: changing the underlying source is reflected immediately,
		// with no second registration / no imperative push.
		active = true;
		expect(manager.get("threadActive")).toBe(true);
	});

	it("evaluate() reads provider values inside compound when-expressions", () => {
		const manager = createContextManager();
		let settingsModalOpen = false;
		let fileExplorerVisible = false;

		manager.registerProvider("settingsOpen", () => settingsModalOpen);
		manager.registerProvider(
			"modalOpen",
			() => settingsModalOpen || fileExplorerVisible
		);

		// Mirrors a real binding guard: "threadActive && !modalOpen"
		manager.registerProvider("threadActive", () => true);

		expect(manager.evaluate("threadActive && !modalOpen").unwrapOr(false)).toBe(true);

		fileExplorerVisible = true;
		expect(manager.evaluate("threadActive && !modalOpen").unwrapOr(false)).toBe(false);

		fileExplorerVisible = false;
		settingsModalOpen = true;
		expect(manager.evaluate("!settingsOpen").unwrapOr(true)).toBe(false);
	});

	it("has() reports true for provider-backed keys", () => {
		const manager = createContextManager();
		manager.registerProvider("sqlStudioOpen", () => false);

		expect(manager.has("sqlStudioOpen")).toBe(true);
		expect(manager.has("never-registered")).toBe(false);
	});

	it("unregisterProvider() removes the computed source", () => {
		const manager = createContextManager();
		manager.registerProvider("threadActive", () => true);
		expect(manager.get("threadActive")).toBe(true);

		manager.unregisterProvider("threadActive");
		expect(manager.get("threadActive")).toBeUndefined();
		expect(manager.has("threadActive")).toBe(false);
	});

	it("still supports imperative set() (characterization)", () => {
		const manager = createContextManager();
		manager.set("inputFocused", true);
		expect(manager.get("inputFocused")).toBe(true);
		expect(manager.evaluate("inputFocused").unwrapOr(false)).toBe(true);
	});
});

describe("KeybindingsService.registerContexts", () => {
	it("registers many providers and returns a dispose that unregisters all", () => {
		const service = createKeybindingsService();
		let modal = false;

		const dispose = service.registerContexts({
			threadActive: () => true,
			modalOpen: () => modal,
		});

		expect(service.getContext("threadActive")).toBe(true);
		expect(service.getContext("modalOpen")).toBe(false);

		modal = true;
		expect(service.getContext("modalOpen")).toBe(true);

		dispose();
		expect(service.getContext("threadActive")).toBeUndefined();
		expect(service.getContext("modalOpen")).toBeUndefined();
	});
});
