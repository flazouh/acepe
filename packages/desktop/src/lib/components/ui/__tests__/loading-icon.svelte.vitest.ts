import { LoadingIcon } from "@acepe/ui/icons";
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

describe("LoadingIcon", () => {
	it("applies caller-provided dimensions to the rendered spinner", () => {
		const { container } = render(LoadingIcon, {
			size: 14,
		});

		const spinner = container.querySelector("svg");
		const spinnerClass = spinner?.getAttribute("class");

		expect(spinner).not.toBeNull();
		expect(spinner?.getAttribute("width")).toBe("14");
		expect(spinner?.getAttribute("height")).toBe("14");
		expect(spinnerClass).not.toContain("size-4");
	});

	it("renders the Hugeicons SVG spinner", () => {
		const { container } = render(LoadingIcon, {
			size: 16,
		});

		expect(container.querySelector(".acepe-dotm-root")).toBeNull();
		expect(container.querySelector("svg")).not.toBeNull();
	});
});
