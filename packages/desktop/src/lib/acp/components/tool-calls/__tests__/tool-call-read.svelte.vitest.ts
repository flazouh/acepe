import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolCall } from "../../../types/tool-call.js";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(dirname(require.resolve("svelte/package.json")), "src/index-client.js");

	return import(/* @vite-ignore */ svelteClientPath);
});

vi.mock("@acepe/ui/agent-panel", async () => {
	const AgentToolRead =
		(await import("./fixtures/agent-tool-read-stub.svelte")).default;

	return {
		AgentToolRead,
	};
});

vi.mock("$lib/paraglide/messages.js", () => ({
	tool_read_running: () => "Reading",
	tool_read_completed: () => "Read",
}));

const openFilePanelMock = vi.fn();
const getStreamingArgumentsMock = vi.fn(() => null);
const getProjectGitStatusMapMock = vi.fn();
const getProjectGitStatusMock = vi.fn((_projectPath: string) => ({
	match: () => Promise.resolve(undefined),
}));

vi.mock("../../../hooks/use-session-context.js", () => ({
	useSessionContext: () => ({ panelId: "panel-1" }),
}));

vi.mock("../../../store/index.js", () => ({
	getPanelStore: () => ({
		openFilePanel: openFilePanelMock,
	}),
	getSessionStore: () => ({
		getStreamingArguments: getStreamingArgumentsMock,
	}),
}));

vi.mock("../../../services/git-status-cache.svelte.js", () => ({
	gitStatusCache: {
		getProjectGitStatusMap: (projectPath: string) => getProjectGitStatusMapMock(projectPath),
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

const { default: ToolCallRead } = await import("../tool-call-read.svelte");

function createReadToolCall(filePath: string): ToolCall {
	return {
		id: "tool-1",
		name: "read_file",
		kind: "read",
		status: "completed",
		title: "Read file",
		arguments: { kind: "read", file_path: filePath },
		awaitingPlanApproval: false,
	};
}

describe("ToolCallRead", () => {
	beforeEach(() => {
		openFilePanelMock.mockClear();
		getStreamingArgumentsMock.mockReset();
		getStreamingArgumentsMock.mockReturnValue(null);
		getProjectGitStatusMapMock.mockReset();
		getProjectGitStatusMapMock.mockReturnValue({
			match: (onOk: (statusMap: ReadonlyMap<string, { path: string; status: string; insertions: number; deletions: number }>) => void) => {
				onOk(
					new Map([
						[
							"src/file.ts",
							{
								path: "src/file.ts",
								status: "M",
								insertions: 7,
								deletions: 2,
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
		const toolCall = createReadToolCall("/repo/src/file.ts");

		const view = render(ToolCallRead, {
			toolCall,
			projectPath: "/repo",
			turnState: "completed",
		});

		await waitFor(() => {
			expect(view.getByTestId("additions").textContent).toBe("7");
			expect(view.getByTestId("deletions").textContent).toBe("2");
		});

		expect(getProjectGitStatusMapMock).toHaveBeenCalledWith("/repo");
		expect(getProjectGitStatusMock).not.toHaveBeenCalled();
	});
});
