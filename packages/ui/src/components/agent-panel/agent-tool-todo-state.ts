import type { AgentTodoItem } from "./types.js";

export interface TodoProgressSummary {
	totalTasks: number;
	completedCount: number;
	inProgressIndex: number;
	progressPercent: number;
}

export interface TodoDisplayRow {
	todo: AgentTodoItem;
	index: number;
	isCurrent: boolean;
	isCurrentAndLive: boolean;
	displayText: string;
	durationText: string;
}

export function getTodoProgressSummary(
	todos: readonly AgentTodoItem[]
): TodoProgressSummary {
	const totalTasks = todos.length;
	const completedCount = todos.filter((todo) => todo.status === "completed").length;
	const inProgressIndex = todos.findIndex((todo) => todo.status === "in_progress");
	const progressPercent =
		totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

	return {
		totalTasks,
		completedCount,
		inProgressIndex,
		progressPercent,
	};
}

export function formatTodoDuration(durationMs: number | null | undefined): string {
	if (durationMs === null || durationMs === undefined) return "-";
	const seconds = Math.floor(durationMs / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}

export function getTodoDisplayRows(input: {
	todos: readonly AgentTodoItem[];
	isLive: boolean;
	inProgressIndex: number;
}): readonly TodoDisplayRow[] {
	return input.todos.map((todo, index) => {
		const isCurrent = index === input.inProgressIndex;
		const isCurrentAndLive = isCurrent && input.isLive;

		return {
			todo,
			index,
			isCurrent,
			isCurrentAndLive,
			displayText:
				isCurrentAndLive && todo.activeForm ? todo.activeForm : todo.content,
			durationText: formatTodoDuration(todo.duration),
		};
	});
}
