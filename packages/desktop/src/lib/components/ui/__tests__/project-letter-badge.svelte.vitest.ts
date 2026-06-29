import { ProjectLetterBadge } from "@acepe/ui";
import { cleanup, render } from "@testing-library/svelte";
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

afterEach(() => {
	cleanup();
});

describe("ProjectLetterBadge", () => {
	it("renders letter badge when iconSrc is null", () => {
		const { container } = render(ProjectLetterBadge, {
			name: "Acepe",
			color: "#ff0000",
			iconSrc: null,
		});

		expect(container.querySelector("img")).toBeNull();
		expect(container.textContent).toContain("A");
	});

	it("renders img tag when iconSrc is provided", () => {
		const { container } = render(ProjectLetterBadge, {
			name: "Acepe",
			color: "#ff0000",
			iconSrc: "/icons/acepe.png",
		});

		const img = container.querySelector("img");
		expect(img).not.toBeNull();
		expect(img?.getAttribute("src")).toBe("/icons/acepe.png");
		expect(img?.getAttribute("alt")).toBe("Acepe icon");
	});

	it("renders letter badge when iconSrc is undefined", () => {
		const { container } = render(ProjectLetterBadge, {
			name: "Beta",
			color: "#00ff00",
		});

		expect(container.querySelector("img")).toBeNull();
		expect(container.textContent).toContain("B");
	});

	it("renders an explicit multi-character label over the first letter", () => {
		const { container } = render(ProjectLetterBadge, {
			name: "Acepe",
			label: "Ac",
			color: "#ff0000",
			iconSrc: null,
		});

		expect(container.textContent).toContain("Ac");
	});

	it("falls back to the first letter when label is null", () => {
		const { container } = render(ProjectLetterBadge, {
			name: "Acepe",
			label: null,
			color: "#ff0000",
			iconSrc: null,
		});

		expect(container.textContent?.trim()).toBe("A");
	});

	// Note: Testing onerror fallback behavior requires a real browser environment
	// where image loading actually occurs. The onerror handler (which sets hasError
	// state to gracefully fall back to the letter badge when an icon path is broken)
	// is verified via manual testing and integration tests. JSDOM/happy-dom does not
	// fire img onerror events on broken src paths.
});
