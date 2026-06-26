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
			variant: "dotm-hex-2",
		});

		const spinner = container.querySelector(".acepe-dotm-root");
		const spinnerStyle = spinner?.getAttribute("style");
		const spinnerClass = spinner?.getAttribute("class");

		expect(spinner).not.toBeNull();
		expect(spinnerStyle).toContain("width: 14px");
		expect(spinnerStyle).toContain("height: 14px");
		expect(spinnerClass).not.toContain("size-4");
	});

	it("renders arc-spin without the dot matrix root class", () => {
		const { container } = render(LoadingIcon, {
			size: 16,
			variant: "arc-spin",
		});

		expect(container.querySelector(".acepe-dotm-root")).toBeNull();
		expect(container.querySelector("svg")).not.toBeNull();
	});
});
