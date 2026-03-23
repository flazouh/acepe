export type WorktreeSetupEventKind = "started" | "command-started" | "output" | "finished";

export type WorktreeSetupOutputStream = "stdout" | "stderr";

export interface WorktreeSetupEvent {
	readonly kind: WorktreeSetupEventKind;
	readonly projectPath: string;
	readonly worktreePath: string;
	readonly command: string | null;
	readonly commandCount: number | null;
	readonly commandIndex: number | null;
	readonly stream: WorktreeSetupOutputStream | null;
	readonly chunk: string | null;
	readonly success: boolean | null;
	readonly exitCode: number | null;
	readonly error: string | null;
}
