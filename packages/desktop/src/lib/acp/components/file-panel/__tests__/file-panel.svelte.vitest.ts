import { cleanup, render, waitFor } from "@testing-library/svelte";
import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@acepe/ui/file-panel", async () => {
	const FilePanelLayout = (await import("./fixtures/file-panel-layout-stub.svelte")).default;

	return {
		FilePanelLayout,
	};
});

vi.mock("$lib/components/ui/codemirror-editor/index.js", async () => {
	const CodeMirrorEditor = (await import("./fixtures/code-mirror-editor-stub.svelte")).default;

	return {
		CodeMirrorEditor,
		getLanguageFromFilename: () => "typescript",
	};
});

vi.mock("../file-panel-header.svelte", async () => {
	const FilePanelHeader = (await import("./fixtures/file-panel-header-stub.svelte")).default;

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
const getFileDiffMock = vi.fn();
const peekFileContentMock = vi.fn();
const getProjectGitStatusSummaryMapMock = vi.fn();
const getProjectFileGitStatusSummaryMock = vi.fn();
const getProjectGitStatusMock = vi.fn((_projectPath: string) => ({
	match: () => Promise.resolve(undefined),
}));

vi.mock("../../../services/file-content-cache.svelte.js", () => ({
	fileContentCache: {
		peekFileContent: (filePath: string, projectPath: string) =>
			peekFileContentMock(filePath, projectPath),
		getFileContent: (filePath: string, projectPath: string) =>
			getFileContentMock(filePath, projectPath),
		getFileDiff: (filePath: string, projectPath: string) => getFileDiffMock(filePath, projectPath),
	},
}));

vi.mock("../../../services/git-status-cache.svelte.js", () => ({
	gitStatusCache: {
		getProjectGitStatusSummaryMap: (projectPath: string) =>
			getProjectGitStatusSummaryMapMock(projectPath),
		getProjectFileGitStatusSummary: (projectPath: string, filePath: string) =>
			getProjectFileGitStatusSummaryMock(projectPath, filePath),
	},
}));

vi.mock("$lib/utils/tauri-client.js", () => ({
	openFileInEditor: vi.fn(),
	revealInFinder: vi.fn(),
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
		peekFileContentMock.mockReset();
		peekFileContentMock.mockReturnValue(null);
		getFileContentMock.mockReset();
		getFileContentMock.mockReturnValue(okAsync("const answer = 42;\n"));
		getFileDiffMock.mockReset();
		getFileDiffMock.mockReturnValue(
			okAsync({
				oldContent: "const answer = 41;\n",
				newContent: "const answer = 42;\n",
			})
		);

		getProjectGitStatusSummaryMapMock.mockReset();
		getProjectGitStatusSummaryMapMock.mockReturnValue({
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
		getProjectFileGitStatusSummaryMock.mockReset();
		getProjectFileGitStatusSummaryMock.mockReturnValue({
			match: (
				onOk: (fileStatus: {
					path: string;
					status: string;
					insertions: number;
					deletions: number;
				}) => void
			) => {
				onOk({
					path: "src/file.ts",
					status: "A",
					insertions: 5,
					deletions: 0,
				});
				return Promise.resolve();
			},
		});

		getProjectGitStatusMock.mockClear();
	});

	afterEach(() => {
		cleanup();
	});

	it("uses the summary git-status cache instead of fetching full project status directly", async () => {
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

		expect(getFileContentMock).not.toHaveBeenCalled();
		expect(getProjectGitStatusSummaryMapMock).not.toHaveBeenCalled();
		expect(getProjectFileGitStatusSummaryMock).not.toHaveBeenCalled();

		await waitFor(() => {
			expect(view.getByTestId("insertions").textContent).toBe("5");
			expect(view.getByTestId("deletions").textContent).toBe("0");
		});

		expect(getProjectFileGitStatusSummaryMock).toHaveBeenCalledWith("/repo", "/repo/src/file.ts");
		expect(getProjectGitStatusSummaryMapMock).not.toHaveBeenCalled();
		expect(getProjectGitStatusMock).not.toHaveBeenCalled();
	});

	it("defers modified-file gutter diff loading to lazy metadata work", async () => {
		const idleCallbacks: Array<() => void> = [];
		const originalRequestIdleCallback = globalThis.requestIdleCallback;
		const originalCancelIdleCallback = globalThis.cancelIdleCallback;
		const requestIdleCallbackMock = vi.fn((callback: IdleRequestCallback) => {
			idleCallbacks.push(() =>
				callback({
					didTimeout: false,
					timeRemaining: () => 50,
				})
			);
			return idleCallbacks.length;
		}) as unknown as typeof globalThis.requestIdleCallback;
		const cancelIdleCallbackMock = vi.fn();
		Object.defineProperty(globalThis, "requestIdleCallback", {
			configurable: true,
			writable: true,
			value: requestIdleCallbackMock,
		});
		Object.defineProperty(globalThis, "cancelIdleCallback", {
			configurable: true,
			writable: true,
			value: cancelIdleCallbackMock,
		});

		getProjectFileGitStatusSummaryMock.mockReturnValue({
			match: (
				onOk: (fileStatus: {
					path: string;
					status: string;
					insertions: number;
					deletions: number;
				}) => void
			) => {
				onOk({
					path: "src/file.ts",
					status: "M",
					insertions: 5,
					deletions: 1,
				});
				return Promise.resolve();
			},
		});

		try {
			render(FilePanel, {
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
				expect(idleCallbacks.length).toBeGreaterThanOrEqual(1);
				expect(getFileContentMock).toHaveBeenCalledWith("/repo/src/file.ts", "/repo");
			});

			expect(getFileDiffMock).not.toHaveBeenCalled();
			idleCallbacks.shift()?.();

			await waitFor(() => {
				expect(idleCallbacks.length).toBeGreaterThanOrEqual(1);
			});
			expect(getFileDiffMock).not.toHaveBeenCalled();
			idleCallbacks.shift()?.();

			await waitFor(() => {
				expect(getFileDiffMock).toHaveBeenCalledWith("/repo/src/file.ts", "/repo");
			});
		} finally {
			Object.defineProperty(globalThis, "requestIdleCallback", {
				configurable: true,
				writable: true,
				value: originalRequestIdleCallback,
			});
			Object.defineProperty(globalThis, "cancelIdleCallback", {
				configurable: true,
				writable: true,
				value: originalCancelIdleCallback,
			});
		}
	});

	it("does not load modified-file gutter diffs while a markdown file stays in rendered mode", async () => {
		const idleCallbacks: Array<() => void> = [];
		const originalRequestIdleCallback = globalThis.requestIdleCallback;
		const originalCancelIdleCallback = globalThis.cancelIdleCallback;
		const requestIdleCallbackMock = vi.fn((callback: IdleRequestCallback) => {
			idleCallbacks.push(() =>
				callback({
					didTimeout: false,
					timeRemaining: () => 50,
				})
			);
			return idleCallbacks.length;
		}) as unknown as typeof globalThis.requestIdleCallback;
		const cancelIdleCallbackMock = vi.fn();
		Object.defineProperty(globalThis, "requestIdleCallback", {
			configurable: true,
			writable: true,
			value: requestIdleCallbackMock,
		});
		Object.defineProperty(globalThis, "cancelIdleCallback", {
			configurable: true,
			writable: true,
			value: cancelIdleCallbackMock,
		});

		getProjectFileGitStatusSummaryMock.mockReturnValue({
			match: (
				onOk: (fileStatus: {
					path: string;
					status: string;
					insertions: number;
					deletions: number;
				}) => void
			) => {
				onOk({
					path: "docs/readme.md",
					status: "M",
					insertions: 5,
					deletions: 1,
				});
				return Promise.resolve();
			},
		});

		try {
			render(FilePanel, {
				panelId: "panel-1",
				filePath: "/repo/docs/readme.md",
				projectPath: "/repo",
				projectName: "repo",
				projectColor: "#123456",
				width: 420,
				onClose: vi.fn(),
				onResize: vi.fn(),
			});

			await waitFor(() => {
				expect(idleCallbacks.length).toBeGreaterThanOrEqual(1);
				expect(getFileContentMock).toHaveBeenCalledWith("/repo/docs/readme.md", "/repo");
			});

			idleCallbacks.shift()?.();
			await waitFor(() => {
				expect(getProjectFileGitStatusSummaryMock).toHaveBeenCalledWith(
					"/repo",
					"/repo/docs/readme.md"
				);
			});

			expect(getFileDiffMock).not.toHaveBeenCalled();
			expect(idleCallbacks).toHaveLength(0);
		} finally {
			Object.defineProperty(globalThis, "requestIdleCallback", {
				configurable: true,
				writable: true,
				value: originalRequestIdleCallback,
			});
			Object.defineProperty(globalThis, "cancelIdleCallback", {
				configurable: true,
				writable: true,
				value: originalCancelIdleCallback,
			});
		}
	});

	it("renders cached file content immediately without entering the loading skeleton", () => {
		peekFileContentMock.mockReturnValue("cached file body\n");

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

		expect(getFileContentMock).not.toHaveBeenCalled();
		expect(view.getByTestId("code-editor-stub").textContent).toContain("cached file body");
	});

	it("reuses an initial git status summary instead of fetching the same file summary again", () => {
		const view = render(FilePanel, {
			panelId: "panel-1",
			filePath: "/repo/src/file.ts",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#123456",
			width: 420,
			initialGitStatus: {
				status: "M",
				insertions: 8,
				deletions: 2,
			},
			onClose: vi.fn(),
			onResize: vi.fn(),
		});

		expect(getProjectFileGitStatusSummaryMock).not.toHaveBeenCalled();
		expect(view.getByTestId("insertions").textContent).toBe("8");
		expect(view.getByTestId("deletions").textContent).toBe("2");
		expect(view.getByTestId("status").textContent).toBe("M");
	});
});
