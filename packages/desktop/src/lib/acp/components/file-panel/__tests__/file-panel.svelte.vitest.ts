import { okAsync } from "neverthrow";

import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(dirname(require.resolve("svelte/package.json")), "src/index-client.js");

	return import(/* @vite-ignore */ svelteClientPath);
});

vi.mock("@acepe/ui/file-panel", async () => {
	const FilePanelLayout =
		(await import("./fixtures/file-panel-layout-stub.svelte")).default;

	return {
		FilePanelLayout,
	};
});

vi.mock("$lib/components/ui/codemirror-editor/index.js", async () => {
	const CodeMirrorEditor =
		(await import("./fixtures/code-mirror-editor-stub.svelte")).default;

	return {
		CodeMirrorEditor,
		getLanguageFromFilename: () => "typescript",
	};
});

vi.mock("../file-panel-header.svelte", async () => {
	const FilePanelHeader =
		(await import("./fixtures/file-panel-header-stub.svelte")).default;

	return {
		default: FilePanelHeader,
	};
});

vi.mock("../file-panel-csv-view.svelte", async () => ({
	default: (await import("./fixtures/file-panel-view-stub.svelte")).default,
}));

vi.mock("../file-panel-read-view.svelte", async () => ({
	default: (await import("./fixtures/file-panel-view-stub.svelte")).default,
}));

vi.mock("../file-panel-rendered-view.svelte", async () => ({
	default: (await import("./fixtures/file-panel-view-stub.svelte")).default,
}));

vi.mock("../file-panel-structured-view.svelte", async () => ({
	default: (await import("./fixtures/file-panel-view-stub.svelte")).default,
}));

const getFileContentMock = vi.fn();
const getProjectGitStatusMapMock = vi.fn();
const getProjectGitStatusMock = vi.fn((_projectPath: string) => ({
	match: () => Promise.resolve(undefined),
}));

vi.mock("../../../services/file-content-cache.svelte.js", () => ({
	fileContentCache: {
		getFileContent: (filePath: string, projectPath: string) =>
			getFileContentMock(filePath, projectPath),
		getFileDiff: vi.fn(),
	},
}));

vi.mock("../../../services/git-status-cache.svelte.js", () => ({
	gitStatusCache: {
		getProjectGitStatusMap: (projectPath: string) => getProjectGitStatusMapMock(projectPath),
	},
}));

vi.mock("$lib/utils/tauri-client.js", () => ({
	tauriClient: {
		fileIndex: {
			getProjectGitStatus: (projectPath: string) => getProjectGitStatusMock(projectPath),
		},
	},
}));

vi.mock("../../../utils/logger.js", () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

const { default: FilePanel } = await import("../file-panel.svelte");

describe("FilePanel", () => {
	beforeEach(() => {
		getFileContentMock.mockReset();
		getFileContentMock.mockReturnValue(okAsync("const answer = 42;\n"));

		getProjectGitStatusMapMock.mockReset();
		getProjectGitStatusMapMock.mockReturnValue({
			match: (
				onOk: (
					statusMap: ReadonlyMap<
						string,
						{ path: string; status: string; insertions: number; deletions: number }
					>
				) => void
			) => {
				onOk(
					new Map([
						[
							"src/file.ts",
							{
								path: "src/file.ts",
								status: "A",
								insertions: 5,
								deletions: 0,
							},
						],
					])
				);
				return Promise.resolve();
			},
		});

		getProjectGitStatusMock.mockClear();
	});

	afterEach(() => {
		cleanup();
	});

	it("uses the shared git-status cache instead of fetching project status directly", async () => {
		const view = render(FilePanel, {
			panelId: "panel-1",
			filePath: "/repo/src/file.ts",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#123456",
			width: 420,
			onClose: vi.fn(),
			onResize: vi.fn(),
		});

		await waitFor(() => {
			expect(view.getByTestId("insertions").textContent).toBe("5");
			expect(view.getByTestId("deletions").textContent).toBe("0");
		});

		expect(getProjectGitStatusMapMock).toHaveBeenCalledWith("/repo");
		expect(getProjectGitStatusMock).not.toHaveBeenCalled();
	});
});