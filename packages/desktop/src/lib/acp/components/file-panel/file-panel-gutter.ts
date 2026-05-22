import type { FilePanelGitStatus } from "./file-panel-git-status.js";

export type FilePanelGutterAction =
	| { kind: "none"; reason: "missing-content" | "missing-git-status" | "unsupported-status" }
	| { kind: "new-file" }
	| { kind: "load-modified-diff" };

export function resolveFilePanelGutterAction(input: {
	readonly content: string | null;
	readonly gitStatus: FilePanelGitStatus | null;
}): FilePanelGutterAction {
	if (input.content === null) {
		return { kind: "none", reason: "missing-content" };
	}

	if (input.gitStatus === null) {
		return { kind: "none", reason: "missing-git-status" };
	}

	if (input.gitStatus.status === "A" || input.gitStatus.status === "?" || input.gitStatus.status === "??") {
		return { kind: "new-file" };
	}

	if (input.gitStatus.status === "M" || input.gitStatus.status === "MM") {
		return { kind: "load-modified-diff" };
	}

	return { kind: "none", reason: "unsupported-status" };
}
