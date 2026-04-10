import type { WorktreeSetupEvent } from "$lib/acp/types/worktree-setup.js";

export interface WorktreeSetupMatchContext {
	readonly projectPaths: readonly string[];
	readonly worktreePaths: readonly string[];
}

export interface WorktreeSetupMatchContextOptions {
	readonly pendingSetupProjectPath: string | null;
	readonly pendingSetupWorktreePath: string | null;
	readonly currentSetupProjectPath: string | null;
	readonly currentSetupWorktreePath: string | null;
}

export interface WorktreeSetupState {
	readonly projectPath: string;
	readonly worktreePath: string | null;
	readonly isVisible: boolean;
	readonly status: "creating-worktree" | "running" | "failed" | "succeeded";
	readonly commandCount: number;
	readonly activeCommandIndex: number | null;
	readonly activeCommand: string | null;
	readonly outputText: string;
	readonly error: string | null;
}

export function createWorktreeCreationState(options: {
	projectPath: string;
	worktreePath?: string | null;
}): WorktreeSetupState {
	return {
		projectPath: options.projectPath,
		worktreePath: options.worktreePath ?? null,
		isVisible: true,
		status: "creating-worktree",
		commandCount: 0,
		activeCommandIndex: null,
		activeCommand: null,
		outputText: "",
		error: null,
	};
}

function collectUniquePaths(values: readonly (string | null)[]): string[] {
	const unique: string[] = [];

	for (const value of values) {
		if (!value) {
			continue;
		}

		if (unique.includes(value)) {
			continue;
		}

		unique.push(value);
	}

	return unique;
}

export function createWorktreeSetupMatchContext(
	options: WorktreeSetupMatchContextOptions
): WorktreeSetupMatchContext {
	const worktreePaths = collectUniquePaths([
		options.pendingSetupWorktreePath,
		options.currentSetupWorktreePath,
	]);
	if (worktreePaths.length > 0) {
		return {
			projectPaths: [],
			worktreePaths,
		};
	}

	const projectPaths = collectUniquePaths([
		options.pendingSetupProjectPath,
		options.currentSetupProjectPath,
	]);

	return {
		projectPaths,
		worktreePaths: [],
	};
}

function createInitialState(event: WorktreeSetupEvent): WorktreeSetupState {
	return {
		projectPath: event.projectPath,
		worktreePath: event.worktreePath,
		isVisible: true,
		status: "running",
		commandCount: event.commandCount ?? 0,
		activeCommandIndex: event.commandIndex,
		activeCommand: event.command,
		outputText: "",
		error: null,
	};
}

function appendText(existing: string, next: string): string {
	if (next.length === 0) return existing;
	return `${existing}${next}`;
}

function appendCommandHeader(
	outputText: string,
	command: string | null,
	commandIndex: number | null,
	commandCount: number
): string {
	if (!command) return outputText;
	const prefix =
		commandIndex !== null && commandCount > 0 ? `[${commandIndex}/${commandCount}] ` : "";
	const separator = outputText.length > 0 && !outputText.endsWith("\n") ? "\n" : "";
	return `${outputText}${separator}${prefix}$ ${command}\n`;
}

export function reduceWorktreeSetupEvent(
	state: WorktreeSetupState | null,
	event: WorktreeSetupEvent
): WorktreeSetupState {
	if (event.kind === "started") {
		return createInitialState(event);
	}

	const current = state ?? createInitialState(event);
	const nextCommandCount = event.commandCount ?? current.commandCount;
	const nextCommandIndex = event.commandIndex ?? current.activeCommandIndex;
	const nextCommand = event.command ?? current.activeCommand;

	if (event.kind === "command-started") {
		return {
			...current,
			status: "running",
			isVisible: true,
			commandCount: nextCommandCount,
			activeCommandIndex: nextCommandIndex,
			activeCommand: nextCommand,
			outputText: appendCommandHeader(
				current.outputText,
				event.command,
				event.commandIndex,
				nextCommandCount
			),
			error: null,
		};
	}

	if (event.kind === "output") {
		return {
			...current,
			status: "running",
			isVisible: true,
			commandCount: nextCommandCount,
			activeCommandIndex: nextCommandIndex,
			activeCommand: nextCommand,
			outputText: appendText(current.outputText, event.chunk ?? ""),
		};
	}

	const errorText = event.error ?? current.error;
	const outputWithError =
		errorText && !current.outputText.includes(errorText)
			? appendText(
					current.outputText,
					current.outputText.endsWith("\n") || current.outputText.length === 0
						? `${errorText}\n`
						: `\n${errorText}\n`
				)
			: current.outputText;

	return {
		...current,
		status: event.success ? "succeeded" : "failed",
		isVisible: event.success !== true,
		commandCount: nextCommandCount,
		activeCommandIndex: nextCommandIndex,
		activeCommand: nextCommand,
		outputText: outputWithError,
		error: errorText,
	};
}

export function matchesWorktreeSetupContext(
	event: WorktreeSetupEvent,
	context: WorktreeSetupMatchContext
): boolean {
	if (context.worktreePaths.length > 0) {
		return context.worktreePaths.includes(event.worktreePath);
	}

	if (context.projectPaths.length === 0) {
		return false;
	}

	return context.projectPaths.includes(event.projectPath);
}
