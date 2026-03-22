import { EmbeddedIconButton, EmbeddedPanelHeader } from "@acepe/ui/panel-header";
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../node_modules/svelte/src/index-client.js")
);

afterEach(() => {
	cleanup();
});

describe("panel header primitives", () => {
	it("renders embedded header row with project-header sizing and no toolbar padding", () => {
		const { container } = render(EmbeddedPanelHeader);
		const root = container.firstElementChild;
		expect(root).not.toBeNull();
		expect(root?.className).toContain("h-7");
		expect(root?.className).toContain("border-b");
		expect(root?.className).not.toContain("px-3");
	});

	it("renders embedded icon button with fixed 28px chrome", () => {
		const { container } = render(EmbeddedIconButton, { title: "Action" });
		const button = container.querySelector("button");
		expect(button).not.toBeNull();
		expect(button?.className).toContain("h-7");
		expect(button?.className).toContain("w-7");
		expect(button?.className).toContain("hover:bg-accent/50");
	});
});
