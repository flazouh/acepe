import type { CommandOutput } from "$lib/acp/types/worktree-config.js";
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
		// A finished run stays on screen while it still has something to show:
		// always on failure, and on success only when the commands actually
		// printed. A project without setup commands prints nothing and gets no
		// card.
		isVisible: event.success !== true || outputWithError.length > 0,
		commandCount: nextCommandCount,
		activeCommandIndex: nextCommandIndex,
		activeCommand: nextCommand,
		outputText: outputWithError,
		error: errorText,
	};
}

export interface WorktreeSetupTarget {
	readonly projectPath: string;
	readonly worktreePath: string | null;
}

export function matchesWorktreeSetupContext(
	target: WorktreeSetupTarget,
	context: WorktreeSetupMatchContext
): boolean {
	if (context.worktreePaths.length > 0) {
		return target.worktreePath !== null && context.worktreePaths.includes(target.worktreePath);
	}

	if (context.projectPaths.length === 0) {
		return false;
	}

	return context.projectPaths.includes(target.projectPath);
}

function createBaseEvent(
	kind: WorktreeSetupEvent["kind"],
	projectPath: string,
	worktreePath: string
): WorktreeSetupEvent {
	return {
		kind,
		projectPath,
		worktreePath,
		command: null,
		commandCount: null,
		commandIndex: null,
		stream: null,
		chunk: null,
		success: null,
		exitCode: null,
		error: null,
	};
}

/**
 * The event that opens a setup run, emitted the moment the run is kicked off.
 * It carries the worktree path the run belongs to, which is what keeps the
 * card attached to its panel while the commands are still executing.
 */
export function createWorktreeSetupStartedEvent(options: {
	projectPath: string;
	worktreePath: string;
}): WorktreeSetupEvent {
	return createBaseEvent("started", options.projectPath, options.worktreePath);
}

export interface WorktreeSetupRun {
	readonly projectPath: string;
	readonly worktreePath: string;
	readonly commands: readonly CommandOutput[];
	readonly success: boolean;
	readonly error: string | null;
}

/**
 * Project a finished setup run — the per-command stdout/stderr/exit codes the
 * server reported — onto the card's event vocabulary. Pure replay of recorded
 * facts: no timing, no progress guessing, nothing the server did not report.
 */
export function projectWorktreeSetupRunEvents(
	run: WorktreeSetupRun
): readonly WorktreeSetupEvent[] {
	const commandCount = run.commands.length;
	const events: WorktreeSetupEvent[] = [];

	run.commands.forEach((output, index) => {
		const commandIndex = index + 1;
		const base = createBaseEvent("command-started", run.projectPath, run.worktreePath);

		events.push({
			...base,
			command: output.command,
			commandCount,
			commandIndex,
		});

		for (const stream of ["stdout", "stderr"] as const) {
			const chunk = output[stream];
			if (chunk.length === 0) {
				continue;
			}
			events.push({
				...base,
				kind: "output",
				command: output.command,
				commandCount,
				commandIndex,
				stream,
				chunk,
			});
		}
	});

	const lastCommand = run.commands.at(-1) ?? null;

	events.push({
		...createBaseEvent("finished", run.projectPath, run.worktreePath),
		command: lastCommand ? lastCommand.command : null,
		commandCount,
		commandIndex: commandCount === 0 ? null : commandCount,
		success: run.success,
		exitCode: lastCommand ? lastCommand.exitCode : null,
		error: run.error,
	});

	return events;
}
