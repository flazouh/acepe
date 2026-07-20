import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import cursorDarkThemeJson from "../../../../desktop/static/themes/cursor.theme.json";
import cursorLightThemeJson from "../../../../desktop/static/themes/cursor-light.theme.json";
import NativeMarkdown from "./native-markdown.svelte";

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

beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn((input: RequestInfo | URL) => {
			const href =
				typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (href.endsWith("/themes/cursor.theme.json")) {
				return Promise.resolve(
					new Response(JSON.stringify(cursorDarkThemeJson), {
						headers: { "Content-Type": "application/json" },
						status: 200,
					})
				);
			}
			if (href.endsWith("/themes/cursor-light.theme.json")) {
				return Promise.resolve(
					new Response(JSON.stringify(cursorLightThemeJson), {
						headers: { "Content-Type": "application/json" },
						status: 200,
					})
				);
			}
			return Promise.resolve(new Response("", { status: 404 }));
		})
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("NativeMarkdown", () => {
	it("renders markdown natively", async () => {
		const { container } = render(NativeMarkdown, {
			markdown: "# Hello\n\n- one",
		});

		await waitFor(() => {
			expect(container.querySelector("h1")?.textContent).toBe("Hello");
		});
		expect(container.querySelector("li")?.textContent).toContain("one");
	});

	it("updates rendered content without leaving stale content", async () => {
		const result = render(NativeMarkdown, {
			markdown: "first",
		});

		await waitFor(() => {
			expect(result.container.textContent).toContain("first");
		});

		await result.rerender({
			markdown: "second",
		});

		await waitFor(() => {
			expect(result.container.textContent).toContain("second");
		});
		expect(result.container.textContent).not.toContain("first");
	});

	it("unmounts rendered content with the Svelte component", async () => {
		const { container, unmount } = render(NativeMarkdown, {
			markdown: "temporary",
		});

		await waitFor(() => {
			expect(container.textContent).toContain("temporary");
		});

		unmount();
		expect(container.textContent).toBe("");
	});

	it("renders stable partial markdown in streaming mode", async () => {
		const { container } = render(NativeMarkdown, {
			markdown: "```ts\nconst value = 1",
			mode: "streaming",
			parseIncompleteMarkdown: true,
		});

		await waitFor(() => {
			expect(container.textContent).toContain("const value = 1");
		});
	});

	it("renders code blocks with native hooks for Acepe parity styling", async () => {
		const { container } = render(NativeMarkdown, {
			markdown: "```ts\nconst value = 1;\n```",
		});

		await waitFor(() => {
			expect(container.querySelector('[data-native-markdown="code-block"]')).not.toBeNull();
		});

		expect(container.querySelector('[data-native-markdown="code-block-header"]')).not.toBeNull();
		await waitFor(() => {
			expect(container.querySelector('[data-native-markdown="code-block-body"]')?.textContent).toContain(
				"const value = 1;"
			);
		});
	});

	it("renders highlighted code blocks with a polished language header", async () => {
		const { container } = render(NativeMarkdown, {
			markdown: "```go\npackage main\nfunc main() {}\n```",
		});

		await waitFor(() => {
			expect(container.querySelector("[data-acepe-code-language='go']")).not.toBeNull();
		});

		expect(container.querySelector("[data-acepe-code-language='go']")?.textContent).toContain("Go");
		expect(
			container.querySelector("[data-acepe-code-language='go'] img")?.getAttribute("src")
		).toBe("/svgs/icons/go.svg");

		await waitFor(() => {
			expect(container.querySelector("[data-acepe-code-highlighted='true']")).not.toBeNull();
		});

		expect(container.querySelector(".shiki span[style]")).not.toBeNull();
	});

	it("renders Acepe's code copy button", async () => {
		const writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});

		const { container } = render(NativeMarkdown, {
			markdown: "```ts\nconst value = 1;\n```",
		});

		await waitFor(() => {
			expect(container.querySelector("[data-acepe-code-copy-button]")).not.toBeNull();
		});

		const icon = container.querySelector("[data-testid='native-markdown-code-copy-hugeicons-icon']");
		expect(icon?.tagName.toLowerCase()).toBe("svg");
		expect(icon?.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(icon?.innerHTML).not.toBe("");

		container
			.querySelector("[data-acepe-code-copy-button]")
			?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledWith("const value = 1;\n");
		});
		await waitFor(() => {
			expect(
				container.querySelector("[data-acepe-code-copy-button]")?.getAttribute("data-copy-state")
			).toBe("copied");
		});
	});

	it("preserves code fence metadata when rendering Acepe copy controls", async () => {
		const { container } = render(NativeMarkdown, {
			markdown: "```ts startLine=12 noLineNumbers\nconst value = 1;\n```",
		});

		await waitFor(() => {
			expect(container.querySelector("[data-acepe-code-copy-button]")).not.toBeNull();
		});

		const code = container.querySelector('[data-native-markdown="code-block-body"] code') as HTMLElement | null;
		expect(code?.getAttribute("style") ?? "").not.toContain("counter-reset");
	});

	it("renders lists with native hooks for compact Acepe spacing", async () => {
		const { container } = render(NativeMarkdown, {
			markdown: "- first\n- second\n- third",
		});

		await waitFor(() => {
			expect(container.querySelectorAll('[data-native-markdown="list-item"]')).toHaveLength(3);
		});

		expect(container.querySelector('[data-native-markdown="unordered-list"]')).not.toBeNull();
	});

	it("renders GFM pipe tables", async () => {
		const { container } = render(NativeMarkdown, {
			markdown: "| Name | Status |\n| --- | --- |\n| Tables | Working |",
		});

		await waitFor(() => {
			expect(container.querySelector("table")).not.toBeNull();
		});

		expect(container.querySelector(".acepe-table-wrapper table")).not.toBeNull();
		expect(container.querySelector("th")?.textContent).toBe("Name");
		expect(container.querySelector("td")?.textContent).toBe("Tables");
	});

	it("preserves existing word DOM nodes when streaming appends a new tail word", async () => {
		const result = render(NativeMarkdown, {
			markdown: "alpha beta gamma",
			mode: "streaming",
			parseIncompleteMarkdown: true,
		});

		await waitFor(() => {
			expect(
				Array.from(result.container.querySelectorAll("[data-markdown-token-word]")).map(
					(element) => element.textContent
				)
			).toEqual(["alpha", "beta", "gamma"]);
		});

		const originalAlpha = result.container.querySelector(
			'[data-markdown-token-word="alpha"]'
		);
		expect(originalAlpha).not.toBeNull();

		await result.rerender({
			markdown: "alpha beta gamma delta",
			mode: "streaming",
			parseIncompleteMarkdown: true,
		});

		await waitFor(() => {
			expect(
				Array.from(result.container.querySelectorAll("[data-markdown-token-word]")).map(
					(element) => element.textContent
				)
			).toEqual(["alpha", "beta", "gamma", "delta"]);
		});

		expect(result.container.querySelector('[data-markdown-token-word="alpha"]')).toBe(
			originalAlpha
		);
	});

	it("routes external link clicks through the host callback", async () => {
		const onExternalLinkClick = vi.fn();
		const { container } = render(NativeMarkdown, {
			markdown: "[Acepe](https://acepe.dev)",
			onExternalLinkClick,
		});

		await waitFor(() => {
			expect(container.querySelector("a")?.getAttribute("href")).toBe("https://acepe.dev/");
		});

		const anchor = container.querySelector("a");
		anchor?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(onExternalLinkClick).toHaveBeenCalledWith("https://acepe.dev/");
	});

	it("renders inline file references as host-routable file chips", async () => {
		const onFilePathClick = vi.fn();
		const { container } = render(NativeMarkdown, {
			markdown: "Open `src/app.ts` next.",
			onFilePathClick,
		});

		await waitFor(() => {
			expect(container.querySelector(".file-path-badge")?.textContent?.trim()).toBe("app.ts");
		});

		const chip = container.querySelector(".file-path-badge");
		chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(onFilePathClick).toHaveBeenCalledWith("src/app.ts");
	});

	it("renders plain text file paths as shared file chips", async () => {
		const onFilePathClick = vi.fn();
		const { container } = render(NativeMarkdown, {
			markdown: "Open packages/ui/src/index.ts next.",
			onFilePathClick,
		});

		await waitFor(() => {
			expect(container.querySelector(".file-path-badge")?.textContent).toContain("index.ts");
		});

		const chip = container.querySelector(".file-path-badge");
		expect(chip?.className).toContain("rounded-md");
		expect(chip?.querySelector("img")?.getAttribute("src")).toBe(
			"/svgs/icons/typescript.svg"
		);
		chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(onFilePathClick).toHaveBeenCalledWith("packages/ui/src/index.ts");
	});

	it("routes local markdown links with line fragments as file chips", async () => {
		const onFilePathClick = vi.fn();
		const { container } = render(NativeMarkdown, {
			markdown: "[open source](src/app.ts#L12)",
			onFilePathClick,
		});

		await waitFor(() => {
			expect(container.querySelector(".file-path-badge")?.textContent).toContain("app.ts:12");
		});

		container
			.querySelector(".file-path-badge")
			?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(onFilePathClick).toHaveBeenCalledWith("src/app.ts:12");
	});

	it("renders GitHub shorthand references as external chips", async () => {
		const onExternalLinkClick = vi.fn();
		const { container } = render(NativeMarkdown, {
			markdown: "Review flazouh/acepe#184 before merging.",
			onExternalLinkClick,
		});

		await waitFor(() => {
			expect(container.querySelector(".github-badge")?.textContent?.trim()).toBe(
				"flazouh/acepe#184"
			);
		});

		const chip = container.querySelector(".github-badge");
		expect(chip?.getAttribute("href")).toBe("https://github.com/flazouh/acepe/pull/184");
		expect(chip?.className).toContain("rounded-md");
		chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(onExternalLinkClick).toHaveBeenCalledWith("https://github.com/flazouh/acepe/pull/184");
	});

	it("keeps GitHub PR chips inside streaming list items", async () => {
		const onExternalLinkClick = vi.fn();
		const { container } = render(NativeMarkdown, {
			markdown: "- Review flazouh/acepe#184\n- Then open packages/ui/src/index.ts",
			mode: "streaming",
			parseIncompleteMarkdown: true,
			onExternalLinkClick,
			onFilePathClick: vi.fn(),
		});

		await waitFor(() => {
			expect(container.querySelectorAll('[data-native-markdown="list-item"]')).toHaveLength(2);
			expect(container.querySelector(".github-badge")?.textContent).toContain(
				"flazouh/acepe#184"
			);
		});

		expect(container.querySelector(".file-path-badge")?.textContent).toContain("index.ts");
		expect(container.querySelector(".github-badge")?.getAttribute("href")).toBe(
			"https://github.com/flazouh/acepe/pull/184"
		);
	});

	it("keeps every markdown chip route wired while streaming lists", async () => {
		const onExternalLinkClick = vi.fn();
		const onFilePathClick = vi.fn();
		const { container } = render(NativeMarkdown, {
			markdown: [
				"- shorthand PR flazouh/acepe#184",
				"- PR URL https://github.com/flazouh/acepe/pull/185",
				"- issue URL https://github.com/flazouh/acepe/issues/186",
				"- inline file `src/app.ts`",
				"- linked file [open source](src/app.ts#L12)",
				"- plain file packages/ui/src/index.ts",
			].join("\n"),
			mode: "streaming",
			parseIncompleteMarkdown: true,
			onExternalLinkClick,
			onFilePathClick,
		});

		await waitFor(() => {
			expect(container.querySelectorAll('[data-native-markdown="list-item"]')).toHaveLength(6);
			expect(container.querySelectorAll(".github-badge")).toHaveLength(3);
			expect(container.querySelectorAll(".file-path-badge")).toHaveLength(3);
		});

		expect(
			Array.from(container.querySelectorAll(".github-badge")).map((chip) =>
				chip.getAttribute("href")
			)
		).toEqual([
			"https://github.com/flazouh/acepe/pull/184",
			"https://github.com/flazouh/acepe/pull/185",
			"https://github.com/flazouh/acepe/issues/186",
		]);
		expect(
			Array.from(container.querySelectorAll(".file-path-badge")).map((chip) =>
				chip.getAttribute("data-file-path")
			)
		).toEqual(["src/app.ts", "src/app.ts:12", "packages/ui/src/index.ts"]);
	});
});
