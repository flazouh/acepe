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
const getAttachedFilePanelsMock = vi.fn();
const getActiveFilePanelIdMock = vi.fn();
const getActiveAttachedFilePanelMock = vi.fn();
const setActiveAttachedFilePanelMock = vi.fn();
const closeFilePanelMock = vi.fn();
const resizeFilePanelMock = vi.fn();

vi.mock("$lib/acp/services/git-status-cache.svelte.js", () => ({
	gitStatusCache: {
		getProjectGitStatusSummaryMap: (projectPath: string) =>
			getProjectGitStatusSummaryMapMock(projectPath),
		getProjectFileGitStatusSummary: (projectPath: string, filePath: string) =>
			getProjectFileGitStatusSummaryMock(projectPath, filePath),
	},
}));

vi.mock("$lib/acp/store/index.js", () => ({
	getPanelStore: () => ({
		getAttachedFilePanels: (ownerPanelId: string) => getAttachedFilePanelsMock(ownerPanelId),
		getActiveFilePanelId: (ownerPanelId: string) => getActiveFilePanelIdMock(ownerPanelId),
		getActiveAttachedFilePanel: (ownerPanelId: string) =>
			getActiveAttachedFilePanelMock(ownerPanelId),
		setActiveAttachedFilePanel: (ownerPanelId: string, filePanelId: string) =>
			setActiveAttachedFilePanelMock(ownerPanelId, filePanelId),
		closeFilePanel: (filePanelId: string) => closeFilePanelMock(filePanelId),
		resizeFilePanel: (filePanelId: string, delta: number) => resizeFilePanelMock(filePanelId, delta),
	}),
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
		getAttachedFilePanelsMock.mockReset();
		getActiveFilePanelIdMock.mockReset();
		getActiveAttachedFilePanelMock.mockReset();
		setActiveAttachedFilePanelMock.mockReset();
		closeFilePanelMock.mockReset();
		resizeFilePanelMock.mockReset();
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
		getAttachedFilePanelsMock.mockImplementation(() => initialFilePanels);
		getActiveFilePanelIdMock.mockImplementation(() => "file-a");
		getActiveAttachedFilePanelMock.mockImplementation(() => initialFilePanels[0]);
		const view = render(AgentAttachedFilePane, {
			ownerPanelId: "panel-1",
			projects: [{ path: "/repo", name: "repo", createdAt: new Date(0), color: "#123456" }],
		});

		expect(getProjectGitStatusSummaryMapMock).not.toHaveBeenCalled();
		expect(getProjectFileGitStatusSummaryMock).not.toHaveBeenCalled();

		await waitFor(() => {
			const badges = view.getAllByTestId("file-path-badge");
			expect(badges[0]?.textContent).toBe("src/a.ts:3:1");
			expect(badges[1]?.textContent).toBe("src/b.ts:0:0");
		});
		expect(view.getByTestId("attached-file-panel").textContent).toBe(
			"file-a:src/a.ts:/repo:repo:420:3:1"
		);

		expect(getProjectGitStatusSummaryMapMock).not.toHaveBeenCalled();
		expect(getProjectFileGitStatusSummaryMock).toHaveBeenCalledTimes(1);
		expect(getProjectFileGitStatusSummaryMock).toHaveBeenCalledWith("/repo", "src/a.ts");

		const nextFilePanels = [
			createFilePanel("file-a", "src/a.ts"),
			createFilePanel("file-b", "src/b.ts"),
		];
		getAttachedFilePanelsMock.mockImplementation(() => nextFilePanels);
		getActiveFilePanelIdMock.mockImplementation(() => "file-b");
		getActiveAttachedFilePanelMock.mockImplementation(() => nextFilePanels[1]);
		await view.rerender({
			ownerPanelId: "panel-1",
			projects: [{ path: "/repo", name: "repo", createdAt: new Date(0), color: "#123456" }],
		});

		await waitFor(() => {
			const badges = view.getAllByTestId("file-path-badge");
			expect(badges[0]?.textContent).toBe("src/a.ts:3:1");
			expect(badges[1]?.textContent).toBe("src/b.ts:8:2");
		});
		expect(view.getByTestId("attached-file-panel").textContent).toBe(
			"file-b:src/b.ts:/repo:repo:420:8:2"
		);

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
		getAttachedFilePanelsMock.mockImplementation(() => filePanels);
		getActiveFilePanelIdMock.mockImplementation(() => "file-b");
		getActiveAttachedFilePanelMock.mockImplementation(() => filePanels[1]);
		const view = render(AgentAttachedFilePane, {
			ownerPanelId: "panel-1",
			projects: [
				{ path: "/repo-a", name: "Repo A", createdAt: new Date(0), color: "#123456" },
				{ path: "/repo-b", name: "Repo B", createdAt: new Date(0), color: "#abcdef" },
			],
		});

		expect(view.getByTestId("attached-file-panel").textContent).toBe(
			"file-b:src/b.ts:/repo-b:Repo B:420:0:0"
		);
	});
});
