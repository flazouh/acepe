import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHANGELOG } from "$lib/changelog/index.js";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("@paper-design/shaders", () => ({
	grainGradientFragmentShader: "mock-fragment-shader",
	getShaderColorFromString: (value: string) => value,
	getShaderNoiseTexture: () => ({ complete: true }),
	GrainGradientShapes: { corners: "corners" },
	ShaderFitOptions: { cover: "cover" },
	ShaderMount: class {
		dispose(): void {}
	},
}));

import ChangelogModalThemeHarness from "./changelog-modal-theme-harness.svelte";

describe("ChangelogModal theme responsiveness", () => {
	afterEach(() => {
		cleanup();
	});

	it("updates modal theme tokens when the app theme changes", async () => {
		const view = render(ChangelogModalThemeHarness, {
			entries: [CHANGELOG[0]],
			onDismiss: vi.fn(),
			theme: "dark",
		});

		const modalPanel = view.container.querySelector(".rounded-3xl");
		expect(modalPanel).not.toBeNull();
		expect(modalPanel?.getAttribute("style")).toContain("--changelog-surface: #101010");
		expect(modalPanel?.getAttribute("style")).toContain("--changelog-hero-foreground: #f5f0ea");

		await view.rerender({
			entries: [CHANGELOG[0]],
			onDismiss: vi.fn(),
			theme: "light",
		});

		expect(modalPanel?.getAttribute("style")).toContain("--changelog-surface: #fcfbf7");
		expect(modalPanel?.getAttribute("style")).toContain("--changelog-hero-foreground: #2f2419");
	});
});
