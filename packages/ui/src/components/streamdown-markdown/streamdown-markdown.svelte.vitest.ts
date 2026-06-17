import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import cursorDarkThemeJson from "../../../../desktop/static/themes/cursor.theme.json";
import cursorLightThemeJson from "../../../../desktop/static/themes/cursor-light.theme.json";
import StreamdownMarkdown from "./streamdown-markdown.svelte";

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

function getAnimatedTexts(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll("[data-sd-animate]"))
		.map((element) => element.textContent?.trim() ?? "")
		.filter((text) => text.length > 0);
}

describe("StreamdownMarkdown", () => {
	it("renders markdown through Streamdown", async () => {
		const { container } = render(StreamdownMarkdown, {
			markdown: "# Hello\n\n- one",
		});

		await waitFor(() => {
			expect(container.querySelector("h1")?.textContent).toBe("Hello");
		});
		expect(container.querySelector("li")?.textContent).toContain("one");
	});

	it("updates rendered content without leaving stale content", async () => {
		const result = render(StreamdownMarkdown, {
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

	it("unmounts the React root with the Svelte component", async () => {
		const { container, unmount } = render(StreamdownMarkdown, {
			markdown: "temporary",
		});

		await waitFor(() => {
			expect(container.textContent).toContain("temporary");
		});

		unmount();
		expect(container.textContent).toBe("");
	});

	it("renders stable partial markdown in streaming mode", async () => {
		const { container } = render(StreamdownMarkdown, {
			markdown: "```ts\nconst value = 1",
			mode: "streaming",
			parseIncompleteMarkdown: true,
		});

		await waitFor(() => {
			expect(container.textContent).toContain("const value = 1");
		});
	});

	it("renders code blocks with Streamdown hooks for Acepe parity styling", async () => {
		const { container } = render(StreamdownMarkdown, {
			markdown: "```ts\nconst value = 1;\n```",
		});

		await waitFor(() => {
			expect(container.querySelector('[data-streamdown="code-block"]')).not.toBeNull();
		});

		expect(container.querySelector('[data-streamdown="code-block-header"]')).not.toBeNull();
		expect(container.querySelector('[data-streamdown="code-block-body"] pre')?.textContent).toContain(
			"const value = 1;"
		);
	});

	it("renders highlighted code blocks with a polished language header", async () => {
		const { container } = render(StreamdownMarkdown, {
			markdown: "```go\npackage main\nfunc main() {}\n```",
		});

		await waitFor(() => {
			expect(container.querySelector("[data-acepe-code-language='go']")).not.toBeNull();
		});

		expect(container.querySelector("[data-acepe-code-language='go']")?.textContent).toContain("Go");
		expect(
			container.querySelector("[data-acepe-code-language='go'] img")?.getAttribute("src")
		).toContain("/svgs/icons/go.svg");

		await waitFor(() => {
			expect(container.querySelector("[data-acepe-code-highlighted='true']")).not.toBeNull();
		});

		expect(container.querySelector(".shiki span[style]")).not.toBeNull();
	});

	it("renders Acepe's code copy button instead of Streamdown's built-in control", async () => {
		const writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});

		const { container } = render(StreamdownMarkdown, {
			markdown: "```ts\nconst value = 1;\n```",
		});

		await waitFor(() => {
			expect(container.querySelector("[data-acepe-code-copy-button]")).not.toBeNull();
		});

		expect(container.querySelector('[data-streamdown="code-block-copy-button"]')).toBeNull();

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

	it("preserves Streamdown code fence metadata when rendering Acepe copy controls", async () => {
		const { container } = render(StreamdownMarkdown, {
			markdown: "```ts startLine=12 noLineNumbers\nconst value = 1;\n```",
		});

		await waitFor(() => {
			expect(container.querySelector("[data-acepe-code-copy-button]")).not.toBeNull();
		});

		const code = container.querySelector('[data-streamdown="code-block-body"] code') as HTMLElement | null;
		expect(code?.getAttribute("style") ?? "").not.toContain("counter-reset");
		expect(container.querySelector('[data-streamdown="code-block-copy-button"]')).toBeNull();
	});

	it("renders lists with Streamdown hooks for compact Acepe spacing", async () => {
		const { container } = render(StreamdownMarkdown, {
			markdown: "- first\n- second\n- third",
		});

		await waitFor(() => {
			expect(container.querySelectorAll('[data-streamdown="list-item"]')).toHaveLength(3);
		});

		expect(container.querySelector('[data-streamdown="unordered-list"]')).not.toBeNull();
	});

	it("renders GFM pipe tables", async () => {
		const { container } = render(StreamdownMarkdown, {
			markdown: "| Name | Status |\n| --- | --- |\n| Tables | Working |",
		});

		await waitFor(() => {
			expect(container.querySelector("table")).not.toBeNull();
		});

		expect(container.querySelector(".acepe-table-wrapper table")).not.toBeNull();
		expect(container.querySelector("th")?.textContent).toBe("Name");
		expect(container.querySelector("td")?.textContent).toBe("Tables");
	});

	it("uses Acepe's word reveal animation while streaming smoothly", async () => {
		const { container } = render(StreamdownMarkdown, {
			markdown: "Hello streaming world",
			mode: "streaming",
			parseIncompleteMarkdown: true,
		});

		await waitFor(() => {
			expect(container.querySelector("[data-sd-animate]")).not.toBeNull();
		});

		const animatedWord = container.querySelector("[data-sd-animate]") as HTMLElement | null;
		expect(animatedWord?.getAttribute("style")).toContain(
			"--sd-animation: sd-acepeTokenReveal"
		);
		expect(animatedWord?.getAttribute("style")).toContain("--sd-duration: 630ms");
	});

	it("maps canonical token reveal timing onto Streamdown animation spans", async () => {
		const { container } = render(StreamdownMarkdown, {
			markdown: "Hello streaming world",
			tokenRevealTiming: {
				revealCount: 3,
				revealedCharCount: "Hello streaming world".length,
				baselineMs: -96,
				tokStepMs: 48,
				tokFadeDurMs: 630,
				mode: "smooth",
			},
		});

		await waitFor(() => {
			expect(container.querySelector("[data-sd-animate]")).not.toBeNull();
		});

		const markdownContent = container.querySelector(".markdown-content") as HTMLElement | null;
		const animatedWords = Array.from(
			container.querySelectorAll("[data-sd-animate]")
		) as HTMLElement[];
		const animatedWord = animatedWords[0];
		const secondAnimatedWord = animatedWords[1];
		expect(markdownContent?.getAttribute("data-token-reveal-mode")).toBe("smooth");
		expect(markdownContent?.getAttribute("style")).toContain(
			"--token-reveal-baseline-ms: -96ms"
		);
		expect(animatedWord?.getAttribute("style")).toContain("--sd-duration: 630ms");
		expect(secondAnimatedWord?.getAttribute("style")).toContain("--sd-delay: 48ms");
	});

	it("keeps token reveal animation on the latest streamed tail only", async () => {
		const firstMarkdown = "alpha beta gamma delta";
		const secondMarkdown = "alpha beta gamma delta epsilon";
		const result = render(StreamdownMarkdown, {
			markdown: firstMarkdown,
			tokenRevealTiming: {
				revealCount: 2,
				revealedCharCount: firstMarkdown.length,
				baselineMs: -96,
				tokStepMs: 48,
				tokFadeDurMs: 630,
				mode: "smooth",
			},
		});

		await waitFor(() => {
			expect(getAnimatedTexts(result.container)).toEqual(["gamma", "delta"]);
		});

		await result.rerender({
			markdown: secondMarkdown,
			tokenRevealTiming: {
				revealCount: 2,
				revealedCharCount: secondMarkdown.length,
				baselineMs: -96,
				tokStepMs: 48,
				tokFadeDurMs: 630,
				mode: "smooth",
			},
		});

		await waitFor(() => {
			expect(getAnimatedTexts(result.container)).toEqual(["delta", "epsilon"]);
		});
	});

	it("routes external link clicks through the host callback", async () => {
		const onExternalLinkClick = vi.fn();
		const { container } = render(StreamdownMarkdown, {
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
		const { container } = render(StreamdownMarkdown, {
			markdown: "Open `src/app.ts` next.",
			onFilePathClick,
		});

		await waitFor(() => {
			expect(container.querySelector(".file-path-badge")?.textContent).toBe("app.ts");
		});

		const chip = container.querySelector(".file-path-badge");
		chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(onFilePathClick).toHaveBeenCalledWith("src/app.ts");
	});

	it("renders plain text file paths as shared file chips", async () => {
		const onFilePathClick = vi.fn();
		const { container } = render(StreamdownMarkdown, {
			markdown: "Open packages/ui/src/index.ts next.",
			onFilePathClick,
		});

		await waitFor(() => {
			expect(container.querySelector(".file-path-badge")?.textContent).toContain("index.ts");
		});

		const chip = container.querySelector(".file-path-badge");
		expect(chip?.className).toContain("rounded-sm");
		expect(chip?.querySelector("img")?.getAttribute("src")).toContain("typescript.svg");
		chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(onFilePathClick).toHaveBeenCalledWith("packages/ui/src/index.ts");
	});

	it("routes local markdown links with line fragments as file chips", async () => {
		const onFilePathClick = vi.fn();
		const { container } = render(StreamdownMarkdown, {
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
		const { container } = render(StreamdownMarkdown, {
			markdown: "Review flazouh/acepe#184 before merging.",
			onExternalLinkClick,
		});

		await waitFor(() => {
			expect(container.querySelector(".github-badge")?.textContent).toBe("flazouh/acepe#184");
		});

		const chip = container.querySelector(".github-badge");
		expect(chip?.getAttribute("href")).toBe("https://github.com/flazouh/acepe/pull/184");
		expect(chip?.className).toContain("rounded-sm");
		chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(onExternalLinkClick).toHaveBeenCalledWith("https://github.com/flazouh/acepe/pull/184");
	});

	it("keeps GitHub PR chips inside streaming list items", async () => {
		const onExternalLinkClick = vi.fn();
		const { container } = render(StreamdownMarkdown, {
			markdown: "- Review flazouh/acepe#184\n- Then open packages/ui/src/index.ts",
			mode: "streaming",
			parseIncompleteMarkdown: true,
			onExternalLinkClick,
			onFilePathClick: vi.fn(),
		});

		await waitFor(() => {
			expect(container.querySelectorAll('[data-streamdown="list-item"]')).toHaveLength(2);
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
		const { container } = render(StreamdownMarkdown, {
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
			expect(container.querySelectorAll('[data-streamdown="list-item"]')).toHaveLength(6);
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
