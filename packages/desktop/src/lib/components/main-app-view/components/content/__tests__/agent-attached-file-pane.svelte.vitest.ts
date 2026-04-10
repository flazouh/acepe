import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FilePanel as FilePanelType } from "$lib/acp/store/file-panel-type.js";

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

vi.mock("@acepe/ui", async () => ({
	FilePathBadge: (await import("./fixtures/file-path-badge-stub.svelte")).default,
}));

vi.mock("$lib/acp/components/file-panel/index.js", async () => ({
	FilePanel: (await import("./fixtures/file-panel-stub.svelte")).default,
}));

vi.mock("$lib/paraglide/messages.js", () => ({
	project_unknown: () => "Unknown project",
}));

const getProjectGitStatusMapMock = vi.fn();

vi.mock("$lib/acp/services/git-status-cache.svelte.js", () => ({
	gitStatusCache: {
		getProjectGitStatusMap: (projectPath: string) => getProjectGitStatusMapMock(projectPath),
	},
}));

const { default: AgentAttachedFilePane } = await import("../agent-attached-file-pane.svelte");

function createFilePanel(id: string, filePath: string): FilePanelType {
	return {
		id,
		kind: "file",
		filePath,
		projectPath: "/repo",
		ownerPanelId: "panel-1",
		width: 420,
	};
}

describe("AgentAttachedFilePane", () => {
	beforeEach(() => {
		getProjectGitStatusMapMock.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("renders attached tab diff stats without materializing the full project status list", async () => {
		const statusMap = new Map([
			[
				"src/a.ts",
				{
					path: "src/a.ts",
					status: "M",
					insertions: 3,
					deletions: 1,
				},
			],
			[
				"src/b.ts",
				{
					path: "src/b.ts",
					status: "M",
					insertions: 8,
					deletions: 2,
				},
			],
		]);
		const valuesSpy = vi.spyOn(statusMap, "values");

		getProjectGitStatusMapMock.mockReturnValue({
			match: (
				onOk: (
					result: ReadonlyMap<
						string,
						{ path: string; status: string; insertions: number; deletions: number }
					>
				) => void
			) => {
				queueMicrotask(() => {
					onOk(statusMap);
				});
				return Promise.resolve();
			},
		});

		const view = render(AgentAttachedFilePane, {
			ownerPanelId: "panel-1",
			filePanels: [createFilePanel("file-a", "src/a.ts"), createFilePanel("file-b", "src/b.ts")],
			activeFilePanelId: "file-a",
			projects: [{ path: "/repo", name: "repo", createdAt: new Date(0), color: "#123456" }],
			onSelectFilePanel: vi.fn(),
			onCloseFilePanel: vi.fn(),
			onResizeFilePanel: vi.fn(),
		});

		await waitFor(() => {
			const badges = view.getAllByTestId("file-path-badge");
			expect(badges[0]?.textContent).toBe("src/a.ts:3:1");
			expect(badges[1]?.textContent).toBe("src/b.ts:8:2");
		});

		expect(getProjectGitStatusMapMock).toHaveBeenCalledTimes(1);
		expect(getProjectGitStatusMapMock).toHaveBeenCalledWith("/repo");
		expect(valuesSpy).not.toHaveBeenCalled();
	});
});
