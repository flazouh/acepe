import type { CommandOutput } from "../../utils/command-output-parser.js";

export interface CommandModelInfo {
	name: string;
	description: string | null;
}

export interface CommandOutputCardState {
	modelInfo: CommandModelInfo | null;
	isModelCommand: boolean;
	displayModel: CommandModelInfo;
	cleanStdout: string;
}

const MODEL_NAMES: Record<string, string> = {
	opus: "Opus 4.5",
	sonnet: "Sonnet 4.5",
	haiku: "Haiku 4.5",
};

export function buildCommandOutputCardState(output: CommandOutput): CommandOutputCardState {
	const cleanStdout = stripAnsiCodes(output.stdout);
	const modelInfo = parseCommandModelInfo(cleanStdout);

	return {
		modelInfo,
		isModelCommand: output.command === "/model" || output.message === "model" || modelInfo !== null,
		displayModel: getDisplayModel(modelInfo),
		cleanStdout,
	};
}

export function stripAnsiCodes(value: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape code pattern intentionally uses control characters.
	return value.replace(/\x1b\[\d+m/g, "").trim();
}

export function parseCommandModelInfo(stdout: string): CommandModelInfo | null {
	const match = stdout.match(/Set model to\s+(\w+)\s*\(([^)]+)\)/i);
	if (match) {
		return {
			name: match[1],
			description: match[2],
		};
	}

	const simpleMatch = stdout.match(/Set model to\s+(.+)/i);
	if (simpleMatch) {
		return {
			name: simpleMatch[1].trim(),
			description: null,
		};
	}

	return null;
}

export function getDisplayModel(modelInfo: CommandModelInfo | null): CommandModelInfo {
	if (!modelInfo) {
		return { name: "", description: null };
	}

	const nameLower = modelInfo.name.toLowerCase();
	const mappedName = MODEL_NAMES[nameLower];

	if (mappedName) {
		return {
			name: mappedName,
			description: isClaudeModelId(modelInfo.description) ? null : modelInfo.description,
		};
	}

	if (nameLower === "default" && modelInfo.description) {
		const versionMatch = modelInfo.description.match(
			/(Opus \d+(?:\.\d+)?|Sonnet \d+(?:\.\d+)?|Haiku \d+(?:\.\d+)?)/i
		);
		if (versionMatch) {
			const descParts = modelInfo.description.split(" · ");
			return {
				name: versionMatch[1],
				description: descParts.length > 1 ? descParts.slice(1).join(" · ") : null,
			};
		}
	}

	return {
		name: modelInfo.name,
		description: isClaudeModelId(modelInfo.description) ? null : modelInfo.description,
	};
}

function isClaudeModelId(value: string | null | undefined): boolean {
	return value?.startsWith("claude-") ?? false;
}
