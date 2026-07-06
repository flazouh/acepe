import { Button, EmbeddedPanelHeader } from "@acepe/ui";
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

	it("renders chrome icon button with the shared chrome sizing", () => {
		const { container } = render(Button, {
			variant: "ghost",
			size: "icon",
			title: "Action",
			"aria-label": "Action",
		});
		const button = container.querySelector("button");
		expect(button).not.toBeNull();
		const classTokens = button?.className.split(/\s+/) ?? [];
		expect(button?.className).toContain("size-6");
		expect(classTokens).toContain("hover:bg-accent");
		expect(classTokens).not.toContain("hover:bg-accent/50");
	});
});
