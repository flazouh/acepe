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

const openUrlMock = vi.fn();
const openFilePanelMock = vi.fn();
const sessionContextState = vi.hoisted((): {
	current: null | { projectPath: string; turnState: "idle" };
} => ({
	current: null,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: openUrlMock,
}));

vi.mock("../../hooks/use-session-context.js", () => ({
	useSessionContext: () => sessionContextState.current,
}));

vi.mock("../../store/index.js", () => ({
	getPanelStore: () => ({
		openFilePanel: openFilePanelMock,
	}),
}));

vi.mock("../../utils/logger.js", () => ({
	createLogger: () => ({
		warn: vi.fn(),
	}),
}));

const { default: MarkdownText } = await import("./markdown-text.svelte");

afterEach(() => {
	cleanup();
	openUrlMock.mockReset();
	openFilePanelMock.mockReset();
	sessionContextState.current = null;
});

describe("MarkdownText", () => {
	it("renders settled markdown through native markdown", async () => {
		const { container } = render(MarkdownText, {
			text: "# Title\n\n- one",
			isStreaming: false,
		});

		await waitFor(() => {
			expect(container.querySelector(".markdown-content h1")?.textContent).toBe("Title");
		});
		expect(container.querySelector(".markdown-content li")?.textContent).toContain("one");
	});

	it("renders incomplete streaming markdown instead of buffering partial text", async () => {
		const { container } = render(MarkdownText, {
			text: "```ts\nconst value = 1",
			isStreaming: true,
		});

		await waitFor(() => {
			expect(container.querySelector(".markdown-content")?.textContent).toContain(
				"const value = 1"
			);
		});
	});

	it("keeps canonical text authoritative as streaming content grows", async () => {
		const view = render(MarkdownText, {
			text: "Hello",
			isStreaming: true,
		});

		await waitFor(() => {
			expect(view.container.textContent).toContain("Hello");
		});

		await view.rerender({
			text: "Hello world",
			isStreaming: true,
		});

		await waitFor(() => {
			expect(view.container.textContent).toContain("Hello world");
		});
		expect(view.container.textContent).not.toBe("Hello");
	});

	it("applies canonical token reveal timing inside the agent panel", async () => {
		const { container } = render(MarkdownText, {
			text: "Hello streaming world",
			isStreaming: false,
			tokenRevealCss: {
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
		const animatedWord = container.querySelector("[data-sd-animate]") as HTMLElement | null;
		expect(markdownContent?.getAttribute("data-token-reveal-mode")).toBe("smooth");
		expect(markdownContent?.getAttribute("style")).toContain(
			"--token-reveal-baseline-ms: -96ms"
		);
		expect(animatedWord?.getAttribute("style")).toContain(
			"--sd-animation: sd-acepeTokenReveal"
		);
	});

	it("opens external markdown links through the Tauri opener", async () => {
		const { container } = render(MarkdownText, {
			text: "[Acepe](https://acepe.dev)",
			isStreaming: false,
		});

		await waitFor(() => {
			expect(container.querySelector("a")?.getAttribute("href")).toBe("https://acepe.dev/");
		});

		const anchor = container.querySelector("a");
		anchor?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(openUrlMock).toHaveBeenCalledWith("https://acepe.dev/");
	});

	it("opens inline file chips in the project file panel", async () => {
		const { container } = render(MarkdownText, {
			text: "Open `src/app.ts`",
			projectPath: "/repo",
		});

	await waitFor(() => {
		expect(container.querySelector(".file-path-badge")?.textContent?.trim()).toBe("app.ts");
	});

		const chip = container.querySelector(".file-path-badge");
		chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(openFilePanelMock).toHaveBeenCalledWith("src/app.ts", "/repo", {
			ownerPanelId: undefined,
		});
	});

	it("does not read project path from session context for file chips", async () => {
		sessionContextState.current = { projectPath: "/repo", turnState: "idle" };
		const { container } = render(MarkdownText, {
			text: "Open `src/app.ts`",
		});

	await waitFor(() => {
		expect(container.querySelector(".file-path-badge")?.textContent?.trim()).toBe("app.ts");
	});

		container
			.querySelector(".file-path-badge")
			?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(openFilePanelMock).not.toHaveBeenCalled();
	});

	it("opens plain text file chips in the project file panel", async () => {
		const { container } = render(MarkdownText, {
			text: "Open packages/desktop/src/app.css",
			projectPath: "/repo",
		});

	await waitFor(() => {
		expect(container.querySelector(".file-path-badge")?.textContent?.trim()).toBe("app.css");
	});

		const chip = container.querySelector(".file-path-badge");
		expect(chip?.className).toContain("rounded-sm");
		chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(openFilePanelMock).toHaveBeenCalledWith("packages/desktop/src/app.css", "/repo", {
			ownerPanelId: undefined,
		});
	});

	it("opens GitHub shorthand chips through the Tauri opener", async () => {
		const { container } = render(MarkdownText, {
			text: "Review flazouh/acepe#184",
			isStreaming: false,
		});

	await waitFor(() => {
		expect(container.querySelector(".github-badge")?.textContent?.trim()).toBe(
			"flazouh/acepe#184"
		);
	});

		container
			.querySelector(".github-badge")
			?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(openUrlMock).toHaveBeenCalledWith("https://github.com/flazouh/acepe/pull/184");
	});
});
