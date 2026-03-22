import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import EmbeddedModalShellHarness from "./embedded-modal-shell.test-harness.svelte";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../node_modules/svelte/src/index-client.js")
);

afterEach(() => {
	cleanup();
});

describe("EmbeddedModalShell", () => {
	it("renders a centered embedded modal surface when open", () => {
		const { container, getByTestId } = render(EmbeddedModalShellHarness, {
			open: true,
		});

		expect(getByTestId("shell-content")).not.toBeNull();

		const overlay = container.querySelector("[aria-label='Harness modal']");
		expect(overlay?.className).toContain("bg-black/55");

		const panel = container.querySelector(".test-panel");
		expect(panel?.className).toContain("rounded-[1.25rem]");
		expect(panel?.className).toContain("shadow-[0_30px_80px_rgba(0,0,0,0.5)]");
	});

	it("keeps content mounted but hidden when requested", async () => {
		const view = render(EmbeddedModalShellHarness, {
			open: true,
			keepMounted: true,
		});

		await view.rerender({
			open: false,
			keepMounted: true,
		});

		expect(view.getByTestId("shell-content")).not.toBeNull();
		const overlay = view.container.querySelector("[aria-label='Harness modal']");
		expect(overlay?.className).toContain("pointer-events-none");
		expect(overlay?.className).toContain("opacity-0");
	});
});
