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

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: vi.fn(),
}));

vi.mock("$lib/paraglide/messages.js", () => ({
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

vi.mock("./logic/parse-content-blocks.js", () => ({
	parseContentBlocks: vi.fn(() => []),
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

const { default: MarkdownText } = await import("./markdown-text.svelte");

beforeEach(() => {
	pendingAsyncRenders.clear();
	getRepoContextMock.mockReset();
	getProjectGitStatusMapMock.mockReset();
	getProjectGitStatusMapMock.mockReturnValue({
		match: () => Promise.resolve(undefined),
	});
	mountFileBadgesMock.mockClear();
	mountGitHubBadgesMock.mockClear();
	renderMarkdownMock.mockClear();
	renderMarkdownSyncMock.mockReset();
});

afterEach(() => {
	cleanup();
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

		await waitFor(() => {
			expect(view.container.querySelector(".markdown-content h1")?.textContent).toBe(
				"Hello streaming"
			);
			expect(view.container.querySelector(".streaming-live-text")?.textContent).toContain("Body");
		});

		expect(renderMarkdownSyncMock).toHaveBeenCalledTimes(1);
		expect(renderMarkdownSyncMock).toHaveBeenCalledWith("# Hello streaming");
		expect(mountFileBadgesMock).not.toHaveBeenCalled();
		expect(mountGitHubBadgesMock).not.toHaveBeenCalled();
	});

	it("updates the live streaming tail in place without rerunning full markdown rendering", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const view = render(MarkdownText, {
			text: "Hello",
			isStreaming: true,
		});

		const firstLiveSection = await waitFor(() => {
			const section = view.container.querySelector('[data-streaming-section-key="LIVE:0"]');
			expect(section).not.toBeNull();
			expect(section?.textContent).toContain("Hello");
			expect(section?.classList.contains("streaming-live-refresh")).toBe(true);
			return section;
		});

		expect(view.container.querySelector(".streaming-live-text")).not.toBeNull();
		expect(renderMarkdownSyncMock).not.toHaveBeenCalled();

		await view.rerender({
			text: "Hello world",
			isStreaming: true,
		});

		await waitFor(() => {
			expect(firstLiveSection?.textContent).toContain("Hello world");
			expect(firstLiveSection?.classList.contains("streaming-live-refresh")).toBe(true);
		});

		expect(view.container.querySelector('[data-streaming-section-key="LIVE:0"]')).toBe(
			firstLiveSection
		);
		expect(renderMarkdownSyncMock).not.toHaveBeenCalled();
	});

	it("fades only the newly appended suffix of the live streaming tail", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const view = render(MarkdownText, {
			text: "Hello",
			isStreaming: true,
		});

		await waitFor(() => {
			expect(view.container.querySelector(".streaming-live-text")?.textContent).toBe("Hello");
			expect(view.container.querySelector(".streaming-live-suffix")?.textContent).toBe("Hello");
		});

		await view.rerender({
			text: "Hello world",
			isStreaming: true,
		});

		await waitFor(() => {
			const liveText = view.container.querySelector(".streaming-live-text");
			const suffix = view.container.querySelector(".streaming-live-suffix");

			expect(liveText?.textContent).toBe("Hello world");
			expect(suffix?.textContent).toBe(" world");
		});
	});

	it("keeps stable streaming sections while append-only markdown grows", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => {
			if (text === "# Title") {
				return {
					html: "<h1>Title</h1>",
					fromCache: false,
					needsAsync: false,
				};
			}

			return {
				html: `<p>${text}</p>`,
				fromCache: false,
				needsAsync: false,
			};
		});

		const view = render(MarkdownText, {
			text: "# Title\n\nHello",
			isStreaming: true,
		});

		const firstSection = await waitFor(() => {
			const section = view.container.querySelector('[data-streaming-section-key="SETTLED:0"]');
			expect(section).not.toBeNull();
			return section;
		});
		const liveSection = view.container.querySelector('[data-streaming-section-key="LIVE:1"]');

		await view.rerender({
			text: "# Title\n\nHello world",
			isStreaming: true,
		});

		await waitFor(() => {
			expect(
				view.container.querySelector('[data-streaming-section-key="LIVE:1"]')?.textContent
			).toContain("Hello world");
		});

		expect(view.container.querySelector('[data-streaming-section-key="SETTLED:0"]')).toBe(
			firstSection
		);
		expect(view.container.querySelector('[data-streaming-section-key="LIVE:1"]')).toBe(liveSection);
		expect(renderMarkdownSyncMock).toHaveBeenCalledTimes(1);
	});

	it("does not re-fade section wrappers when streaming content splits into a new block", async () => {
		renderMarkdownSyncMock.mockImplementation((text) => ({
			html: `<p>${text}</p>`,
			fromCache: false,
			needsAsync: false,
		}));

		const view = render(MarkdownText, {
			text: "Hello",
			isStreaming: true,
		});

		await waitFor(() => {
			expect(
				view.container.querySelector('[data-streaming-section-key="LIVE:0"]')?.textContent
			).toContain("Hello");
		});

		await view.rerender({
			text: "Hello\n\nNext",
			isStreaming: true,
		});

		await waitFor(() => {
			expect(
				view.container.querySelector('[data-streaming-section-key="SETTLED:0"]')?.textContent
			).toContain("Hello");
			expect(
				view.container.querySelector('[data-streaming-section-key="LIVE:1"]')?.textContent
			).toContain("Next");
		});

		expect(view.container.querySelector(".streaming-section.streaming-fade-in")).toBeNull();
	});

	it("renders an open fenced code block as a stable live code tail", async () => {
		renderMarkdownSyncMock.mockImplementation(() => ({
			html: null,
			fromCache: false,
			needsAsync: true,
		}));

		const view = render(MarkdownText, {
			text: "```ts\nconst a = 1;",
			isStreaming: true,
		});

		await waitFor(() => {
			expect(view.container.querySelector(".streaming-live-code code")?.textContent).toContain(
				"const a = 1;"
			);
		});

		expect(renderMarkdownSyncMock).not.toHaveBeenCalled();
		expect(renderMarkdownMock).not.toHaveBeenCalled();
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

		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(renderMarkdownMock).not.toHaveBeenCalled();
		expect(view.container.querySelector(".markdown-content")).not.toBeNull();
		expect(view.container.textContent).toContain("Streaming title");
		expect(mountFileBadgesMock).not.toHaveBeenCalled();
		expect(mountGitHubBadgesMock).not.toHaveBeenCalled();

		await view.rerender({
			text: chunk,
			isStreaming: false,
		});

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

		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(view.container.querySelector(".markdown-content")).not.toBeNull();
		// Async rendering and repo-context fetch are still deferred until streaming settles
		expect(renderMarkdownMock).not.toHaveBeenCalled();
		expect(getRepoContextMock).not.toHaveBeenCalled();
		expect(view.container.textContent).toContain("abcdef1");

		await view.rerender({
			text: chunk,
			isStreaming: false,
			projectPath: "/repo",
		});

		await waitFor(() => {
			expect(getRepoContextMock).toHaveBeenCalledWith("/repo");
		});

		await waitFor(() => {
			expect(renderMarkdownMock).toHaveBeenCalled();
		});
	});
});
