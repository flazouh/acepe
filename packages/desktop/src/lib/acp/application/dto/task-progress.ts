/**
 * Task progress for tracking live ACP task steps.
 *
 * This is different from SessionPlanResponse which is Claude Code's plan mode markdown file.
 * TaskProgress tracks the incremental steps being performed during a task.
 */
export interface TaskProgress {
	readonly id: string;
	readonly title?: string;
	readonly steps: ReadonlyArray<string>;
}
