import { cleanup, render } from "@testing-library/svelte";
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
	getRepoContext: vi.fn(() => ({
		match: () => Promise.resolve(undefined),
	})),
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

const renderMarkdownSyncMock = vi.fn();

vi.mock("../../utils/markdown-renderer.js", () => ({
	renderMarkdown: vi.fn(() => ({
		match: () => Promise.resolve(undefined),
	})),
	renderMarkdownSync: (...args: unknown[]) => renderMarkdownSyncMock(...args),
}));

vi.mock("./content-block-renderer.svelte", async () => ({
	default: (await import("../pr-status-card/test-component-stub.svelte")).default,
}));

vi.mock("./logic/mount-file-badges.js", () => ({
	mountFileBadges: vi.fn(() => () => {}),
}));

vi.mock("./logic/mount-github-badges.js", () => ({
	mountGitHubBadges: vi.fn(() => () => {}),
}));

vi.mock("./logic/parse-content-blocks.js", () => ({
	parseContentBlocks: vi.fn(() => []),
}));

const bindContainerMock = vi.fn();
const setStreamingMock = vi.fn();
const destroyMock = vi.fn();

vi.mock("./logic/typewriter-reveal-controller.js", () => ({
	createTypewriterRevealBinding: () => ({
		bindContainer: bindContainerMock,
		setStreaming: setStreamingMock,
		destroy: destroyMock,
	}),
}));

const { default: TypewriterText } = await import("./typewriter-text.svelte");

describe("TypewriterText", () => {
	beforeEach(() => {
		renderMarkdownSyncMock.mockReset();
		renderMarkdownSyncMock.mockReturnValue({
			html: "<h1>Streaming title</h1>",
			fromCache: false,
			needsAsync: false,
		});
		bindContainerMock.mockClear();
		setStreamingMock.mockClear();
		destroyMock.mockClear();
	});

	afterEach(() => {
		cleanup();
	});

	it("keeps markdown in plain-text mode while streaming", () => {
		const view = render(TypewriterText, {
			text: "# Streaming title",
			isStreaming: true,
		});

		expect(view.container.querySelector(".markdown-content")).toBeNull();
		expect(view.container.querySelector(".markdown-loading")?.textContent).toContain(
			"# Streaming title"
		);
		expect(setStreamingMock).toHaveBeenCalledWith(true);
	});
});