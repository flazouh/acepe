import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RepoContext = { owner: string; repo: string };

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(dirname(require.resolve("svelte/package.json")), "src/index-client.js");

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

vi.mock("../../services/git-status-cache.svelte.js", () => ({
	gitStatusCache: {
		getProjectGitStatusMap: vi.fn(() => ({
			match: () => Promise.resolve(undefined),
		})),
	},
}));

const getRepoContextMock = vi.fn();
const mountFileBadgesMock = vi.fn<
	(container: HTMLElement, resolver: (filePath: string) => unknown) => () => void
>(() => () => {});
const mountGitHubBadgesMock = vi.fn<
	(container: HTMLElement, options: { repoContext?: RepoContext; projectPath?: string }) => () => void
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

const renderMarkdownSyncMock = vi.fn<(text: string) => { html: string | null; fromCache: boolean; needsAsync: boolean }>();
const renderMarkdownMock = vi.fn(
	(text: string, repoContext?: RepoContext) => ({
		match: (
			onOk: (html: string) => void,
			onErr: (error: string) => void
		): Promise<void> => {
			pendingAsyncRenders.set(getRequestKey(text, repoContext), {
				reject: onErr,
				resolve: onOk,
			});
			return Promise.resolve();
		},
	})
);

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
	mountFileBadges: (
		container: HTMLElement,
		resolver: (filePath: string) => unknown
	) => mountFileBadgesMock(container, resolver),
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

	it("requests repo context when markdown contains bare commit refs", async () => {
		const repoContext = { owner: "acepe", repo: "desktop" };
		getRepoContextMock.mockReturnValue({
			match: (onOk: (ctx: RepoContext) => void) => {
				onOk(repoContext);
				return Promise.resolve();
			},
		});

		renderMarkdownSyncMock.mockImplementation(() => ({
			html:
				'<p>See <span class="github-badge-placeholder" data-github-ref="ref"></span></p>',
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
		const firstChunk = "# Section A\n\n" + "alpha ".repeat(2500);
		const secondChunk = "# Section B\n\n" + "beta ".repeat(2600);

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
		const firstChunk = "# Older\n\n" + "alpha ".repeat(2500);
		const secondChunk = "# Newer\n\n" + "beta ".repeat(2600);

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
		const chunk = "# Contextual\n\nSee abcdef1\n\n" + "alpha ".repeat(2500);
		const repoContext = { owner: "acepe", repo: "desktop" };
		const repoContextResolver: { current: ((value: RepoContext) => void) | null } = { current: null };

		getRepoContextMock.mockReturnValue({
			match: (
				onOk: (ctx: RepoContext) => void,
				_onErr?: (error: string) => void
			) => {
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
			match: (
				onOk: (html: string) => void,
				onErr: (error: string) => void
			): Promise<void> => {
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

	it("defers rich markdown rendering until streaming stops", async () => {
		const chunk = "# Streaming title\n\n" + "alpha ".repeat(2500);

		renderMarkdownSyncMock.mockImplementation(() => ({
			html: null,
			fromCache: false,
			needsAsync: true,
		}));

		const view = render(MarkdownText, {
			text: chunk,
			isStreaming: true,
		});

		const pending = pendingAsyncRenders.get(getRequestKey(chunk));
		if (!pending) {
			throw new Error("Expected async markdown render to start");
		}

		pending.resolve("<h2>Streaming title</h2><p>Alpha body</p>");

		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(view.container.querySelector(".markdown-content")).toBeNull();
		expect(view.container.textContent).toContain("Streaming title");
		expect(mountFileBadgesMock).not.toHaveBeenCalled();
		expect(mountGitHubBadgesMock).not.toHaveBeenCalled();

		await view.rerender({
			text: chunk,
			isStreaming: false,
		});

		await waitFor(() => {
			expect(view.container.querySelector(".markdown-content h2")?.textContent).toBe(
				"Streaming title"
			);
		});
	});
});
