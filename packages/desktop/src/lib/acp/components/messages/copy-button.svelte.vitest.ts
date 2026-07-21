import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import CopyButton from "./copy-button.svelte";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

vi.mock("@acepe/ui", async () => {
	const IconStub = (await import("../pr-status-card/test-hugeicons-icon-stub.svelte")).default;

	return {
		HugeiconsIcon: IconStub,
	};
});

vi.mock("$lib/components/ui/sonner/toast-bridge.js", () => ({
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

describe("CopyButton Hugeicons wiring", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders idle copy controls with the Copy icon", () => {
		const view = render(CopyButton, {
			text: "copy me",
			title: "Copy message",
		});

		const icon = view.getByTestId("acp-copy-button-hugeicons-copy-icon");

		expect(icon.getAttribute("data-hugeicons-icon-name")).toBe("copy");
	});

	it("keeps the copy icon hidden when the button variant asks for label only", () => {
		const view = render(CopyButton, {
			text: "copy me",
			label: "Copy",
			hideIcon: true,
			variant: "menu",
		});

		expect(view.queryByTestId("acp-copy-button-hugeicons-copy-icon")).toBeNull();
		expect(view.getByText("Copy")).toBeTruthy();
	});
});
