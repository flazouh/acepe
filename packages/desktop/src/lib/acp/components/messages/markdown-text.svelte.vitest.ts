import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../services/github-service.js", () => ({
	getRepoContext: vi.fn(),
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
	(text: string) => ({
		match: (
			onOk: (html: string) => void,
			onErr: (error: string) => void
		): Promise<void> => {
			pendingAsyncRenders.set(text, {
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
	mountFileBadges: vi.fn(() => () => {}),
}));

vi.mock("./logic/mount-github-badges.js", () => ({
	mountGitHubBadges: vi.fn(() => () => {}),
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

const { default: MarkdownText } = await import("./markdown-text.svelte");

beforeEach(() => {
	pendingAsyncRenders.clear();
	renderMarkdownMock.mockClear();
	renderMarkdownSyncMock.mockReset();
});

afterEach(() => {
	cleanup();
});

describe("MarkdownText", () => {
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

		const firstPending = pendingAsyncRenders.get(firstChunk);
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

		const secondPending = pendingAsyncRenders.get(secondChunk);
		if (!secondPending) {
			throw new Error("Expected second async markdown render to start");
		}

		secondPending.resolve("<h2>Section B</h2><p>Beta body</p>");

		await waitFor(() => {
			expect(view.container.querySelector(".markdown-content h2")?.textContent).toBe("Section B");
		});
	});
});