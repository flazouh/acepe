import { describe, expect, it, vi } from "vitest";

import { createTypewriterRevealBinding } from "../typewriter-reveal-controller.js";

describe("createTypewriterRevealBinding", () => {
	it("reuses one reveal controller while streaming toggles", () => {
		const setStreaming = vi.fn();
		const destroy = vi.fn();
		const createReveal = vi.fn(() => ({ setStreaming, destroy }));
		const binding = createTypewriterRevealBinding(createReveal);
		const container = document.createElement("div");

		binding.bindContainer(container);
		binding.setStreaming(true);
		binding.setStreaming(false);

		expect(createReveal).toHaveBeenCalledTimes(1);
		expect(setStreaming).toHaveBeenNthCalledWith(1, false);
		expect(setStreaming).toHaveBeenNthCalledWith(2, true);
		expect(setStreaming).toHaveBeenNthCalledWith(3, false);
		expect(destroy).not.toHaveBeenCalled();

		binding.destroy();

		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it("replaces the controller when the container node changes", () => {
		const first = {
			setStreaming: vi.fn(),
			destroy: vi.fn(),
		};
		const second = {
			setStreaming: vi.fn(),
			destroy: vi.fn(),
		};
		const createReveal = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
		const binding = createTypewriterRevealBinding(createReveal);
		const firstContainer = document.createElement("div");
		const secondContainer = document.createElement("div");

		binding.setStreaming(true);
		binding.bindContainer(firstContainer);
		binding.bindContainer(secondContainer);

		expect(createReveal).toHaveBeenCalledTimes(2);
		expect(first.setStreaming).toHaveBeenCalledWith(true);
		expect(first.destroy).toHaveBeenCalledTimes(1);
		expect(second.setStreaming).toHaveBeenCalledWith(true);

		binding.destroy();

		expect(second.destroy).toHaveBeenCalledTimes(1);
	});
});
