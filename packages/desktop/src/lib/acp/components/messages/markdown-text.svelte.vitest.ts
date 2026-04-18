import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RepoContext = { owner: string; repo: string };

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

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: openUrlMock,
}));

vi.mock("$lib/messages.js", () => ({
	markdown_render_error: ({ error }: { error: string }) => `Error rendering markdown: ${error}`,
}));

vi.mock("../../hooks/use-session-context.js", () => ({
	useSessionContext: () => null,
}));

const getProjectGitStatusMapMock = vi.fn<
	(projectPath: string) => {
		match: () => Promise<void>;
	}
>(() => ({
	match: () => Promise.resolve(),
}));

vi.mock("../../services/git-status-cache.svelte.js", () => ({
	gitStatusCache: {
		getProjectGitStatusMap: (projectPath: string) => getProjectGitStatusMapMock(projectPath),
	},
}));

const getRepoContextMock = vi.fn();
const mountFileBadgesMock = vi.fn<
	(container: HTMLElement, resolver: (filePath: string) => unknown) => () => void
>(() => () => {});
const mountGitHubBadgesMock = vi.fn<
	(
		container: HTMLElement,
		options: { repoContext?: RepoContext; projectPath?: string }
	) => () => void
>(() => () => {});

vi.mock("../../services/github-service.js", () => ({
	getRepoContext: (...args: unknown[]) => getRepoContextMock(...args),
}));

vi.mock("../../store/index.js", () => ({
	getPanelStore: () => ({
		openFilePanel: vi.fn(),
	}),
}));

vi.mock("../../utils/logger.js", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	}),
}));

const renderMarkdownSyncMock =
	vi.fn<(text: string) => { html: string | null; fromCache: boolean; needsAsync: boolean }>();
const renderMarkdownMock = vi.fn((text: string, repoContext?: RepoContext) => ({
	match: (onOk: (html: string) => void, onErr: (error: string) => void): Promise<void> => {
		pendingAsyncRenders.set(getRequestKey(text, repoContext), {
			reject: onErr,
			resolve: onOk,
		});
		return Promise.resolve();
	},
}));

vi.mock("../../utils/markdown-renderer.js", () => ({
	renderMarkdown: renderMarkdownMock,
	renderMarkdownSync: renderMarkdownSyncMock,
}));

vi.mock("./content-block-renderer.svelte", async () => {
	const Stub = (await import("../pr-status-card/test-component-stub.svelte")).default;

	return {
		default: Stub,
	};
});

vi.mock("./logic/mount-file-badges.js", () => ({
	mountFileBadges: (container: HTMLElement, resolver: (filePath: string) => unknown) =>
		mountFileBadgesMock(container, resolver),
}));

vi.mock("./logic/mount-github-badges.js", () => ({
	mountGitHubBadges: (
		container: HTMLElement,
		options: { repoContext?: RepoContext; projectPath?: string }
	) => mountGitHubBadgesMock(container, options),
}));

const parseContentBlocksMock = vi.fn(() => []);

vi.mock("./logic/parse-content-blocks.js", () => ({
	parseContentBlocks: () => parseContentBlocksMock(),
}));

const pendingAsyncRenders = new Map<
	string,
	{
		reject: (error: string) => void;
		resolve: (html: string) => void;
	}
>();

function getRequestKey(text: string, repoContext?: RepoContext): string {
	if (!repoContext) return `${text}::none`;
	return `${text}::${repoContext.owner}/${repoContext.repo}`;
}

type QueuedAnimationFrame = {
	id: number;
	callback: FrameRequestCallback;
};

let queuedAnimationFrames: QueuedAnimationFrame[] = [];
let nextAnimationFrameId = 1;
let performanceNowSequence: number[] = [];

async function flushAnimationFrames(frameCount = 1, startTime = 16): Promise<void> {
	for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
		const frame = queuedAnimationFrames.shift();
		if (!frame) {
			break;
		}

		frame.callback(startTime + frameIndex * 16);
		await Promise.resolve();
	}
}

async function flushAllAnimationFrames(startTime = 16): Promise<void> {
	let frameIndex = 0;
	while (queuedAnimationFrames.length > 0 && frameIndex < 500) {
		const frame = queuedAnimationFrames.shift();
		if (!frame) {
			break;
		}

		frame.callback(startTime + frameIndex * 16);
		await Promise.resolve();
		frameIndex += 1;
	}
}

const { default: MarkdownText } = await import("./markdown-text.svelte");

function setPerformanceNowSequence(values: number[]) {
	performanceNowSequence = [...values];
}

beforeEach(() => {
	queuedAnimationFrames = [];
	nextAnimationFrameId = 1;
	performanceNowSequence = [];
	pendingAsyncRenders.clear();
	openUrlMock.mockReset();
	getRepoContextMock.mockReset();
	getProjectGitStatusMapMock.mockReset();
	getProjectGitStatusMapMock.mockReturnValue({
		match: () => Promise.resolve(undefined),
	});
	mountFileBadgesMock.mockClear();
	mountGitHubBadgesMock.mockClear();
	parseContentBlocksMock.mockReset();
	parseContentBlocksMock.mockReturnValue([]);
	renderMarkdownMock.mockClear();
	renderMarkdownSyncMock.mockReset();
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
		const id = nextAnimationFrameId;
		nextAnimationFrameId += 1;
		queuedAnimationFrames.push({ id, callback });
		return id;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
		queuedAnimationFrames = queuedAnimationFrames.filter((frame) => frame.id !== id);
	});
	vi.spyOn(performance, "now").mockImplementation(
		() => performanceNowSequence.shift() ?? queuedAnimationFrames.length * 16
	);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("MarkdownText", () => {
	it("does not request repo context for plain markdown content", async () => {
		getRepoContextMock.mockReturnValue({
			match: () => Promise.resolve(),
		});

		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		render(MarkdownText, {
			text: "Plain markdown without GitHub refs.",
			projectPath: "/repo",
		});

		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(getRepoContextMock).not.toHaveBeenCalled();
	});

	it("does not load git status for plain markdown without file badges", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		render(MarkdownText, {
			text: "Plain markdown without file badges.",
			projectPath: "/repo",
		});

		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(getProjectGitStatusMapMock).not.toHaveBeenCalled();
	});

	it("requests repo context when markdown contains bare commit refs", async () => {
		const repoContext = { owner: "acepe", repo: "desktop" };
		getRepoContextMock.mockReturnValue({
			match: (onOk: (ctx: RepoContext) => void) => {
				onOk(repoContext);
				return Promise.resolve();
			},
		});

		renderMarkdownSyncMock.mockImplementation(() => ({
			html: '<p>See <span class="github-badge-placeholder" data-github-ref="ref"></span></p>',
			fromCache: false,
			needsAsync: false,
		}));

		render(MarkdownText, {
			text: "See abcdef1",
			projectPath: "/repo",
		});

		await waitFor(() => {
			expect(getRepoContextMock).toHaveBeenCalledWith("/repo");
		});
	});

	it("keeps the previous async HTML visible while a newer large render is pending", async () => {
		const firstChunk = `# Section A\n\n${"alpha ".repeat(2500)}`;
		const secondChunk = `# Section B\n\n${"beta ".repeat(2600)}`;

		renderMarkdownSyncMock.mockImplementation((text) => {
			if (text === firstChunk || text === secondChunk) {
				return { html: null, fromCache: false, needsAsync: true };
			}

			return { html: `<p>${text}</p>`, fromCache: false, needsAsync: false };
		});

		const view = render(MarkdownText, {
			text: firstChunk,
		});

		const firstPending = pendingAsyncRenders.get(getRequestKey(firstChunk));
		if (!firstPending) {
			throw new Error("Expected first async markdown render to start");
		}

		firstPending.resolve("<h2>Section A</h2><p>Alpha body</p>");

		await waitFor(() => {
			expect(view.container.querySelector(".markdown-content h2")?.textContent).toBe("Section A");
		});

		await view.rerender({
			text: secondChunk,
		});

		await waitFor(() => {
			expect(renderMarkdownMock).toHaveBeenCalledTimes(2);
		});

		expect(view.container.querySelector(".markdown-loading")).toBeNull();
		expect(view.container.querySelector(".markdown-content h2")?.textContent).toBe("Section A");

		const secondPending = pendingAsyncRenders.get(getRequestKey(secondChunk));
		if (!secondPending) {
			throw new Error("Expected second async markdown render to start");
		}

		secondPending.resolve("<h2>Section B</h2><p>Beta body</p>");

		await waitFor(() => {
			expect(view.container.querySelector(".markdown-content h2")?.textContent).toBe("Section B");
		});
	});

	it("ignores an older async markdown result after newer text has arrived", async () => {
		const firstChunk = `# Older\n\n${"alpha ".repeat(2500)}`;
		const secondChunk = `# Newer\n\n${"beta ".repeat(2600)}`;

		renderMarkdownSyncMock.mockImplementation((text) => {
			if (text === firstChunk || text === secondChunk) {
				return { html: null, fromCache: false, needsAsync: true };
			}

			return { html: `<p>${text}</p>`, fromCache: false, needsAsync: false };
		});

		const view = render(MarkdownText, {
			text: firstChunk,
		});

		const firstPending = pendingAsyncRenders.get(getRequestKey(firstChunk));
		if (!firstPending) {
			throw new Error("Expected first async markdown render to start");
		}

		await view.rerender({
			text: secondChunk,
		});

		const secondPending = pendingAsyncRenders.get(getRequestKey(secondChunk));
		if (!secondPending) {
			throw new Error("Expected second async markdown render to start");
		}

		secondPending.resolve("<h2>Newer</h2><p>Beta body</p>");

		await waitFor(() => {
			expect(view.container.querySelector(".markdown-content h2")?.textContent).toBe("Newer");
		});

		firstPending.resolve("<h2>Older</h2><p>Alpha body</p>");

		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(view.container.querySelector(".markdown-content h2")?.textContent).toBe("Newer");
	});

	it("starts a new async render when repo context arrives for the same bare-commit text", async () => {
		const chunk = `# Contextual\n\nSee abcdef1\n\n${"alpha ".repeat(2500)}`;
		const repoContext = { owner: "acepe", repo: "desktop" };
		const repoContextResolver: { current: ((value: RepoContext) => void) | null } = {
			current: null,
		};

		getRepoContextMock.mockReturnValue({
			match: (onOk: (ctx: RepoContext) => void, _onErr?: (error: string) => void) => {
				repoContextResolver.current = onOk;
				return Promise.resolve();
			},
		});

		renderMarkdownSyncMock.mockImplementation(() => ({
			html: null,
			fromCache: false,
			needsAsync: true,
		}));

		renderMarkdownMock.mockImplementation((text: string, currentRepoContext?: RepoContext) => ({
			match: (onOk: (html: string) => void, onErr: (error: string) => void): Promise<void> => {
				pendingAsyncRenders.set(getRequestKey(text, currentRepoContext), {
					reject: onErr,
					resolve: onOk,
				});
				return Promise.resolve();
			},
		}));

		render(MarkdownText, {
			text: chunk,
			projectPath: "/repo",
		});

		await waitFor(() => {
			expect(pendingAsyncRenders.has(getRequestKey(chunk))).toBe(true);
			expect(repoContextResolver.current).not.toBeNull();
		});
		const resolveCurrentRepoContext = repoContextResolver.current;
		if (resolveCurrentRepoContext === null) {
			throw new Error("Expected repo context request to start");
		}

		resolveCurrentRepoContext(repoContext);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(pendingAsyncRenders.has(getRequestKey(chunk, repoContext))).toBe(true);
		expect(renderMarkdownMock).toHaveBeenCalledTimes(2);
	});

	it("renders settled blocks once and keeps the trailing streaming text live", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: text === "# Hello streaming" ? "<h1>Hello streaming</h1>" : `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const view = render(MarkdownText, {
			text: "# Hello streaming\n\nBody",
			isStreaming: true,
		});
		await flushAnimationFrames(8);

		await waitFor(() => {
			expect(view.container.querySelector(".markdown-content h1")?.textContent).toBe(
				"Hello streaming"
			);
			expect(
				view.container.querySelector('[data-streaming-section-key="LIVE:1"] p')?.textContent
			).toContain("Body");
		});

		expect(renderMarkdownSyncMock).not.toHaveBeenCalled();
		expect(mountFileBadgesMock).not.toHaveBeenCalled();
		expect(mountGitHubBadgesMock).not.toHaveBeenCalled();
	});

	it("renders a live heading and following paragraph as separate reveal-safe blocks", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const view = render(MarkdownText, {
			text: "# Title\nBody",
			isStreaming: true,
			streamingAnimationMode: "instant",
		});

		await waitFor(() => {
			expect(view.container.querySelector('[data-streaming-section-key="LIVE:0"] h1')?.textContent).toBe(
				"Title"
			);
			expect(view.container.querySelector('[data-streaming-section-key="LIVE:1"] p')?.textContent).toBe(
				"Body"
			);
		});
	});

	it("renders streaming text immediately instead of buffering partial reveal bursts", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const view = render(MarkdownText, {
			text: "Hello",
			isStreaming: true,
			streamingAnimationMode: "smooth",
		});

		const firstLiveSection = await waitFor(() => {
			const section = view.container.querySelector('[data-streaming-section-key="LIVE:0"]');
			expect(section).not.toBeNull();
			expect(section?.textContent).toContain("Hello");
			return section;
		});

		expect(renderMarkdownSyncMock).not.toHaveBeenCalled();

		await view.rerender({
			text: "Hello world",
			isStreaming: true,
			streamingAnimationMode: "smooth",
		});

		await waitFor(() => {
			expect(firstLiveSection?.textContent).toContain("Hello world");
		});

		expect(view.container.querySelector('[data-streaming-section-key="LIVE:0"]')).toBe(
			firstLiveSection
		);
		expect(renderMarkdownSyncMock).not.toHaveBeenCalled();
	});

	it("keeps previously revealed live word nodes stable while streaming text grows", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const view = render(MarkdownText, {
			text: "Hello world",
			isStreaming: true,
			streamingAnimationMode: "smooth",
		});

		const firstWord = await waitFor(() => {
			const word = Array.from(view.container.querySelectorAll(".sd-word-fade")).find(
				(node) => node.textContent === "Hello"
			);
			expect(word).not.toBeNull();
			return word as HTMLSpanElement;
		});

		await view.rerender({
			text: "Hello world again",
			isStreaming: true,
			streamingAnimationMode: "smooth",
		});

		await waitFor(() => {
			expect(view.container.textContent).toContain("again");
		});

		const persistedWord = Array.from(view.container.querySelectorAll(".sd-word-fade")).find(
			(node) => node.textContent === "Hello"
		);
		expect(persistedWord).toBe(firstWord);
	});

	it("keeps partial markdown confined to the live tail while settled sections stay stable", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const view = render(MarkdownText, {
			text: "# Title\n\nHello",
			isStreaming: true,
		});

		await flushAnimationFrames(12);

		await waitFor(() => {
			expect(view.container.querySelector('[data-streaming-section-key="SETTLED:0"]')).not.toBeNull();
			expect(view.container.querySelector('[data-streaming-section-key="LIVE:1"]')?.textContent).toContain(
				"Hello"
			);
		});

		const settledSection = view.container.querySelector('[data-streaming-section-key="SETTLED:0"]');

		await view.rerender({
			text: "# Title\n\nHello\n\nNext",
			isStreaming: true,
		});
		await flushAnimationFrames(12, 112);

		await waitFor(() => {
			expect(view.container.querySelector('[data-streaming-section-key="SETTLED:0"]')).toBe(
				settledSection
			);
			expect(
				view.container.querySelector('[data-streaming-section-key="SETTLED:1"]')?.textContent
			).toContain("Hello");
			expect(
				view.container.querySelector('[data-streaming-section-key="LIVE:2"]')?.textContent
			).toContain("Next");
		});
	});

	it("renders an open fenced code block as a live code tail during reveal", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => {
			return {
				html: `<p>${text}</p>`,
				fromCache: false,
				needsAsync: false,
			};
		});

		const view = render(MarkdownText, {
			text: "```ts\nconst a = 1;",
			isStreaming: true,
		});
		await flushAnimationFrames(8);

		await waitFor(() => {
			expect(view.container.querySelector(".streaming-live-code code")?.textContent).toContain(
				"const a = 1;"
			);
		});

		expect(view.container.querySelector(".streaming-live-code-shell.sd-word-fade")).not.toBeNull();
		expect(view.container.querySelector(".streaming-live-code.sd-word-fade")).toBeNull();

		expect(renderMarkdownSyncMock).not.toHaveBeenCalled();
		expect(renderMarkdownMock).not.toHaveBeenCalled();
	});

	it("does not render a cursor-only placeholder when the revealed tail has no live section", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const view = render(MarkdownText, {
			text: "# Title\n\n",
			isStreaming: true,
		});
		await flushAnimationFrames(8);

		expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull();
	});

	it("keeps stable streaming sections while append-only revealed markdown grows", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const view = render(MarkdownText, {
			text: "# Title\n\nHello",
			isStreaming: true,
		});
		await waitFor(() => {
			expect(
				view.container.querySelector('[data-streaming-section-key="LIVE:1"]')?.textContent
			).toContain("Hello");
		});

		const settledSection = view.container.querySelector('[data-streaming-section-key="SETTLED:0"]');

		await view.rerender({
			text: "# Title\n\nHello world",
			isStreaming: true,
		});
		await flushAnimationFrames(12, 112);

		await waitFor(() => {
			expect(
				view.container.querySelector('[data-streaming-section-key="LIVE:1"]')?.textContent
			).toContain("Hello world");
		});

		expect(view.container.querySelector('[data-streaming-section-key="SETTLED:0"]')).toBe(
			settledSection
		);
		expect(renderMarkdownSyncMock).not.toHaveBeenCalled();
	});

	it("renders reveal-time links as disabled text instead of interactive anchors", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const view = render(MarkdownText, {
			text: "[Acepe](https://acepe.dev)",
			isStreaming: true,
			streamingAnimationMode: "instant",
		});

		await waitFor(() => {
			const disabledLink = view.container.querySelector(".streaming-live-link.is-disabled");
			expect(disabledLink).toBeTruthy();
			expect(disabledLink?.textContent).toBe("Acepe");
		});

		expect(view.container.querySelector("a")).toBeNull();
		expect(renderMarkdownSyncMock).not.toHaveBeenCalled();
		expect(renderMarkdownMock).not.toHaveBeenCalled();
	});

	it("re-renders live markdown directly without fallback-tail freeze behavior", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const view = render(MarkdownText, {
			text: "Hello",
			isStreaming: true,
			streamingAnimationMode: "instant",
		});

		await waitFor(() => {
			expect(
				view.container.querySelector('[data-streaming-section-key="LIVE:0"] p')?.textContent
			).toBe("Hello");
		});

		await view.rerender({
			text: "Hello world",
			isStreaming: true,
			streamingAnimationMode: "instant",
		});

		await waitFor(() => {
			expect(
				view.container.querySelector('[data-streaming-section-key="LIVE:0"] p')?.textContent
			).toBe("Hello world");
		});

		expect(view.container.querySelector(".streaming-live-fallback-tail")).toBeNull();
	});

	it("keeps final-only settled blocks on plain fallback during reveal and upgrades them after settle", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html:
				text === "```mermaid\ngraph TD;\n```"
					? '<div class="mermaid">graph TD;</div>'
					: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const text = "```mermaid\ngraph TD;\n```";
		const view = render(MarkdownText, {
			text,
			isStreaming: true,
			streamingAnimationMode: "instant",
		});

		await waitFor(() => {
			expect(view.container.textContent).toContain(text);
		});
		expect(view.container.querySelector(".mermaid")).toBeNull();
		expect(renderMarkdownSyncMock).not.toHaveBeenCalled();

		await view.rerender({
			text,
			isStreaming: false,
			streamingAnimationMode: "instant",
		});

		await waitFor(() => {
			expect(view.container.querySelector(".mermaid")?.textContent).toContain("graph TD;");
		});
	});

	it("upgrades reveal-time disabled links into interactive anchors after settle", async () => {
		renderMarkdownSyncMock.mockReturnValue({
			html: '<p><a href="https://acepe.dev">Acepe</a></p>',
			fromCache: false,
			needsAsync: false,
		});

		const text = "[Acepe](https://acepe.dev)";
		const view = render(MarkdownText, {
			text,
			isStreaming: true,
			streamingAnimationMode: "instant",
		});

		await waitFor(() => {
			expect(view.container.querySelector(".streaming-live-link.is-disabled")?.textContent).toBe("Acepe");
		});
		expect(view.container.querySelector("a")).toBeNull();

		await view.rerender({
			text,
			isStreaming: false,
			streamingAnimationMode: "instant",
		});

		await waitFor(() => {
			expect(view.container.querySelector('a[href="https://acepe.dev"]')?.textContent).toBe(
				"Acepe"
			);
		});

		const anchor = view.container.querySelector('a[href="https://acepe.dev"]');
		anchor?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		expect(openUrlMock).toHaveBeenCalledWith("https://acepe.dev");
	});

	describe("streaming reveal behavior", () => {
		it("does not re-animate existing words when streaming text grows", async () => {
			renderMarkdownSyncMock.mockImplementation((text) => ({
				html: `<p>${text}</p>`,
				fromCache: false,
				needsAsync: false,
			}));

			const view = render(MarkdownText, {
				text: "hello world",
				isStreaming: true,
				streamingAnimationMode: "smooth",
			});

			await waitFor(() => {
				const fades = view.container.querySelectorAll(".sd-word-fade");
				expect(fades.length).toBeGreaterThan(0);
			});

			// Rerender with appended text (simulates streaming growth)
			await view.rerender({
				text: "hello world foo",
				isStreaming: true,
				streamingAnimationMode: "smooth",
			});

			await waitFor(() => {
				const section = view.container.querySelector('[data-streaming-live="true"]');
				expect(section).not.toBeNull();
				if (!section) {
					throw new Error("Expected streaming section");
				}
				const html = section.innerHTML;
				// "hello" and "world" should NOT have sd-word-fade class (they were in previous render)
				expect(html).not.toContain('<span class="sd-word-fade">hello</span>');
				expect(html).not.toContain('<span class="sd-word-fade">world</span>');
				// "foo" should have sd-word-fade class (it's new)
				expect(html).toContain('<span class="sd-word-fade">foo</span>');
				// All text should still be present
				expect(section.textContent).toContain("hello");
				expect(section.textContent).toContain("world");
				expect(section.textContent).toContain("foo");
			});
		});

		it("renders word-fade spans while streaming is active", async () => {
			renderMarkdownSyncMock.mockImplementation((text) => ({
				html: `<p>${text.replace("**bold**", "<strong>bold</strong>")}</p>`,
				fromCache: false,
				needsAsync: false,
			}));

			const text = "**bold** text";
			const view = render(MarkdownText, {
				text,
				isStreaming: true,
				revealKey: "smooth-test",
				streamingAnimationMode: "smooth",
			});

			await waitFor(() => {
				expect(view.container.querySelector(".streaming-section strong")?.textContent).toBe("bold");
			});
		});

		it("paces reveal-time markdown while deferring final markdown until streaming ends", async () => {
			renderMarkdownSyncMock.mockImplementation((text) => ({
				html: `<p>${text.replace("**bold**", "<strong>bold</strong>")}</p>`,
				fromCache: false,
				needsAsync: false,
			}));

			const text = "**bold** text";
			const view = render(MarkdownText, {
				text,
				isStreaming: true,
				revealKey: "instant-test",
				streamingAnimationMode: "instant",
			});

			expect(view.container.textContent).not.toContain("bold text");

			await waitFor(() => {
				expect(view.container.textContent).toContain("bold text");
				expect(view.container.querySelector(".streaming-section")).toBeTruthy();
				expect(view.container.querySelector(".streaming-section strong")?.textContent).toBe("bold");
			});
			expect(renderMarkdownSyncMock).not.toHaveBeenCalled();

			await view.rerender({
				text,
				isStreaming: false,
				revealKey: "instant-test",
				streamingAnimationMode: "instant",
			});

			await waitFor(() => {
				const rendered = view.container.querySelector(".markdown-content strong");
				expect(rendered).toBeTruthy();
				expect(rendered?.textContent).toBe("bold");
			});
		});

		it("replaces animated streaming html with clean settled html after drain", async () => {
			renderMarkdownSyncMock.mockImplementation((mdText) => ({
				html: `<p>${mdText.replace("**bold**", "<strong>bold</strong>")}</p>`,
				fromCache: false,
				needsAsync: false,
			}));

			const text = "**bold** text";
			const view = render(MarkdownText, {
				text,
				isStreaming: true,
				revealKey: "final-smooth",
				streamingAnimationMode: "smooth",
			});

			await waitFor(() => {
				expect(view.container.querySelector(".sd-word-fade")).not.toBeNull();
			});

			await view.rerender({
				text,
				isStreaming: false,
				revealKey: "final-smooth",
				streamingAnimationMode: "smooth",
			});

			await waitFor(() => {
				expect(view.container.querySelector(".streaming-section")).toBeNull();
				const rendered = view.container.querySelector(".markdown-content strong");
				expect(rendered?.textContent).toBe("bold");
			});

			expect(view.container.querySelector(".sd-word-fade")).toBeNull();
		});

		it("does not restart reveal from the beginning after a remount with the same reveal key", async () => {
			const text = "Remounted historical assistant text";
			const firstView = render(MarkdownText, {
				text,
				isStreaming: true,
				revealKey: "historical-remount-key",
				streamingAnimationMode: "smooth",
			});

			await waitFor(() => {
				expect(firstView.container.textContent).toContain("Remounted");
			});

			firstView.unmount();

			const remountedView = render(MarkdownText, {
				text,
				isStreaming: true,
				revealKey: "historical-remount-key",
				streamingAnimationMode: "smooth",
			});

			await waitFor(() => {
				expect(remountedView.container.textContent).toContain(text);
				expect(remountedView.container.textContent).not.toBe("");
			});
		});

		it("reports reveal activity through the paced drain window", async () => {
			const activityStates: boolean[] = [];
			const text = "Hello world";
			renderMarkdownSyncMock.mockReturnValue({
				html: `<p>${text}</p>`,
				fromCache: false,
				needsAsync: false,
			});
			const view = render(MarkdownText, {
				text,
				isStreaming: true,
				streamingAnimationMode: "smooth",
				onRevealActivityChange: (active: boolean) => {
					activityStates.push(active);
				},
			});

			await waitFor(() => {
				expect(activityStates).toContain(true);
			});

			await view.rerender({
				text,
				isStreaming: false,
				streamingAnimationMode: "smooth",
				onRevealActivityChange: (active: boolean) => {
					activityStates.push(active);
				},
			});

			await waitFor(() => {
				expect(activityStates.at(-1)).toBe(false);
			});
		});

	});

	it("defers rich markdown rendering until streaming stops", async () => {
		const chunk = `# Streaming title\n\n${"alpha ".repeat(2500)}`;

		renderMarkdownSyncMock.mockImplementation(() => ({
			html: null,
			fromCache: false,
			needsAsync: true,
		}));

		const view = render(MarkdownText, {
			text: chunk,
			isStreaming: true,
		});
		await flushAnimationFrames(40);

		await waitFor(() => {
			expect(view.container.querySelector(".markdown-content")).not.toBeNull();
			expect(view.container.textContent).toContain("Streaming title");
		});
		expect(renderMarkdownMock).not.toHaveBeenCalled();
		expect(mountFileBadgesMock).not.toHaveBeenCalled();
		expect(mountGitHubBadgesMock).not.toHaveBeenCalled();

		await view.rerender({
			text: chunk,
			isStreaming: false,
		});
		await waitFor(
			() => {
				expect(renderMarkdownMock).toHaveBeenCalled();
				expect(pendingAsyncRenders.has(getRequestKey(chunk))).toBe(true);
			},
			{ timeout: 4000 }
		);

		const pending = pendingAsyncRenders.get(getRequestKey(chunk));
		if (!pending) {
			throw new Error("Expected async markdown render to start after streaming stops");
		}

		pending.resolve("<h2>Streaming title</h2><p>Alpha body</p>");

		await waitFor(() => {
			expect(view.container.querySelector(".markdown-content h2")?.textContent).toBe(
				"Streaming title"
			);
		});
	});

	it("defers repo-context and async markdown work until streaming settles", async () => {
		const chunk = `# Streaming title\n\nSee abcdef1\n\n${"alpha ".repeat(2500)}`;
		const repoContext = { owner: "acepe", repo: "desktop" };

		getRepoContextMock.mockReturnValue({
			match: (onOk: (ctx: RepoContext) => void) => {
				onOk(repoContext);
				return Promise.resolve();
			},
		});

		renderMarkdownSyncMock.mockImplementation(() => ({
			html: null,
			fromCache: false,
			needsAsync: true,
		}));

		const view = render(MarkdownText, {
			text: chunk,
			isStreaming: true,
			projectPath: "/repo",
		});
		await flushAnimationFrames(40);

		await waitFor(() => {
			expect(view.container.querySelector(".markdown-content")).not.toBeNull();
			expect(view.container.textContent).toContain("abcdef1");
		});
		// Async rendering and repo-context fetch are still deferred until streaming settles
		expect(renderMarkdownMock).not.toHaveBeenCalled();
		expect(getRepoContextMock).not.toHaveBeenCalled();

		await view.rerender({
			text: chunk,
			isStreaming: false,
			projectPath: "/repo",
		});

		await waitFor(
			() => {
				expect(getRepoContextMock).toHaveBeenCalledWith("/repo");
			},
			{ timeout: 4000 }
		);

		await waitFor(
			() => {
				expect(renderMarkdownMock).toHaveBeenCalled();
			},
			{ timeout: 4000 }
		);
	});
});
