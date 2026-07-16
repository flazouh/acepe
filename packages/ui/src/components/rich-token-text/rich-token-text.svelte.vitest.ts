import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const { default: RichTokenText } = await import("./rich-token-text.svelte");

afterEach(() => {
	cleanup();
});

describe("RichTokenText", () => {
	it("renders file tokens with the shared extension-aware file chip", async () => {
		const onTokenClick = vi.fn();
		const { container } = render(RichTokenText, {
			text: "Open @[file:src/app.ts]",
			onTokenClick,
		});

		await waitFor(() => {
			expect(container.querySelector(".file-path-badge")?.textContent?.trim()).toBe("app.ts");
		});

		const chip = container.querySelector(".file-path-badge") as HTMLElement | null;
		const icon = chip?.querySelector(".file-icon") as HTMLImageElement | null;
		expect(chip?.getAttribute("data-file-path")).toBe("src/app.ts");
		expect(icon?.getAttribute("src")).toBe("/svgs/icons/typescript.svg");

		chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(onTokenClick).toHaveBeenCalledWith("file", "src/app.ts");
	});
});
