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

vi.mock("$lib/acp/components/file-panel/file-panel-defer.js", () => ({
	scheduleLazyPanelMetadataWork: (work: () => void) => {
		let cancelled = false;
		queueMicrotask(() => {
			if (!cancelled) {
				work();
			}
		});
		return {
			cancel: () => {
				cancelled = true;
			},
		};
	},
}));

const getProjectGitStatusSummaryMapMock = vi.fn();
const getProjectFileGitStatusSummaryMock = vi.fn();

vi.mock("$lib/acp/services/git-status-cache.svelte.js", () => ({
	gitStatusCache: {
		getProjectGitStatusSummaryMap: (projectPath: string) =>
			getProjectGitStatusSummaryMapMock(projectPath),
		getProjectFileGitStatusSummary: (projectPath: string, filePath: string) =>
			getProjectFileGitStatusSummaryMock(projectPath, filePath),
	},
}));

const { default: AgentAttachedFilePane } = await import("../agent-attached-file-pane.svelte");

function createFilePanel(id: string, filePath: string, projectPath = "/repo"): FilePanelType {
	return {
		id,
		kind: "file",
		filePath,
		projectPath,
		ownerPanelId: "panel-1",
		width: 420,
	};
}

describe("AgentAttachedFilePane", () => {
	beforeEach(() => {
		getProjectGitStatusSummaryMapMock.mockReset();
		getProjectFileGitStatusSummaryMock.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("loads only the active attached tab diff stats", async () => {
		const statusByFilePath = new Map([
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

		getProjectGitStatusSummaryMapMock.mockImplementation(() => {
			throw new Error("must not load full project git status for attached file tabs");
		});
		getProjectFileGitStatusSummaryMock.mockImplementation((_projectPath: string, filePath: string) => ({
			match: (
				onOk: (
					result: { path: string; status: string; insertions: number; deletions: number } | null
				) => void
			) => {
				queueMicrotask(() => {
					onOk(statusByFilePath.get(filePath) ?? null);
				});
				return Promise.resolve();
			},
		}));

		const initialFilePanels = [
			createFilePanel("file-a", "src/a.ts"),
			createFilePanel("file-b", "src/b.ts"),
		];
		const view = render(AgentAttachedFilePane, {
			ownerPanelId: "panel-1",
			filePanels: initialFilePanels,
			activeFilePanelId: "file-a",
			activeFilePanel: initialFilePanels[0],
			projects: [{ path: "/repo", name: "repo", createdAt: new Date(0), color: "#123456" }],
			onSelectFilePanel: vi.fn(),
			onCloseFilePanel: vi.fn(),
			onResizeFilePanel: vi.fn(),
		});

		expect(getProjectGitStatusSummaryMapMock).not.toHaveBeenCalled();
		expect(getProjectFileGitStatusSummaryMock).not.toHaveBeenCalled();

		await waitFor(() => {
			const badges = view.getAllByTestId("file-path-badge");
			expect(badges[0]?.textContent).toBe("src/a.ts:3:1");
			expect(badges[1]?.textContent).toBe("src/b.ts:0:0");
		});

		expect(getProjectGitStatusSummaryMapMock).not.toHaveBeenCalled();
		expect(getProjectFileGitStatusSummaryMock).toHaveBeenCalledTimes(1);
		expect(getProjectFileGitStatusSummaryMock).toHaveBeenCalledWith("/repo", "src/a.ts");

		const nextFilePanels = [
			createFilePanel("file-a", "src/a.ts"),
			createFilePanel("file-b", "src/b.ts"),
		];
		await view.rerender({
			ownerPanelId: "panel-1",
			filePanels: nextFilePanels,
			activeFilePanelId: "file-b",
			activeFilePanel: nextFilePanels[1],
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

		expect(getProjectFileGitStatusSummaryMock).toHaveBeenCalledTimes(2);
		expect(getProjectFileGitStatusSummaryMock).toHaveBeenLastCalledWith("/repo", "src/b.ts");
	});

	it("uses the active file project metadata from the project lookup", () => {
		getProjectFileGitStatusSummaryMock.mockReturnValue({
			match: () => Promise.resolve(),
		});

		const filePanels = [
			createFilePanel("file-a", "src/a.ts", "/repo-a"),
			createFilePanel("file-b", "src/b.ts", "/repo-b"),
		];
		const view = render(AgentAttachedFilePane, {
			ownerPanelId: "panel-1",
			filePanels,
			activeFilePanelId: "file-b",
			activeFilePanel: filePanels[1],
			projects: [
				{ path: "/repo-a", name: "Repo A", createdAt: new Date(0), color: "#123456" },
				{ path: "/repo-b", name: "Repo B", createdAt: new Date(0), color: "#abcdef" },
			],
			onSelectFilePanel: vi.fn(),
			onCloseFilePanel: vi.fn(),
			onResizeFilePanel: vi.fn(),
		});

		expect(view.getByTestId("attached-file-panel").textContent).toBe(
			"file-b:src/b.ts:/repo-b:Repo B:420"
		);
	});
});
