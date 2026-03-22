export type OpenInFinderTarget =
	| { kind: "reveal"; path: string }
	| { kind: "claude"; sessionId: string; projectPath: string };

type OpenInFinderInput = {
	sessionId?: string | null;
	projectPath?: string | null;
	agentId?: string | null;
	sourcePath?: string | null;
};

function getNonEmptyValue(value?: string | null): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function getOpenInFinderTarget(input: OpenInFinderInput): OpenInFinderTarget | null {
	const sourcePath = getNonEmptyValue(input.sourcePath);
	if (sourcePath) {
		return { kind: "reveal", path: sourcePath };
	}

	const projectPath = getNonEmptyValue(input.projectPath);
	if (!projectPath) {
		return null;
	}

	if (input.agentId === "claude-code") {
		const sessionId = getNonEmptyValue(input.sessionId);
		if (!sessionId) {
			return null;
		}
		return { kind: "claude", sessionId, projectPath };
	}

	return { kind: "reveal", path: projectPath };
}
