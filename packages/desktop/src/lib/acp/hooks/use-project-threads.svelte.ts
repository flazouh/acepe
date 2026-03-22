import { SvelteDate } from "svelte/reactivity";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import type { SessionDisplayItem, ThreadTableRow } from "../types/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({
	id: LOGGER_IDS.PROJECT_THREADS,
	name: "Project Threads",
});

/**
 * Hook for managing threads in a project page.
 * Handles loading threads, statistics, and provides sorting/filtering state.
 */
export function useProjectThreads(projectPath: string) {
	// Reactive state
	let threads = $state<ThreadTableRow[]>([]);
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	// Global filter for searching threads
	let globalFilter = $state("");

	// Sorting state
	const sorting = $state<{ column: string; direction: "asc" | "desc" }>({
		column: "updatedAt",
		direction: "desc",
	});

	/**
	 * Load all threads for the project.
	 * Converts SessionDisplayItem to ThreadTableRow and sets up stats loading.
	 */
	function loadThreads(allThreads: SessionDisplayItem[]): void {
		isLoading = true;
		error = null;

		// Filter threads for this project
		const projectThreads = allThreads.filter((t) => t.projectPath === projectPath);

		// Convert to table rows
		threads = projectThreads.map((thread) => ({
			...thread,
			statsLoading: false,
			statsError: undefined,
			duration:
				thread.createdAt && thread.updatedAt
					? new SvelteDate(thread.updatedAt).getTime() - new SvelteDate(thread.createdAt).getTime()
					: undefined,
		}));

		logger.debug("Loaded threads for project", {
			projectPath,
			count: threads.length,
		});

		isLoading = false;
	}

	/**
	 * Set the global filter for searching threads.
	 */
	function setGlobalFilter(filter: string) {
		globalFilter = filter;
	}

	/**
	 * Set sorting configuration.
	 */
	function setSorting(column: string, direction: "asc" | "desc") {
		sorting.column = column;
		sorting.direction = direction;
	}

	/**
	 * Toggle sort direction for a column.
	 */
	function toggleSort(column: string) {
		if (sorting.column === column) {
			sorting.direction = sorting.direction === "asc" ? "desc" : "asc";
		} else {
			sorting.column = column;
			sorting.direction = "desc"; // Default to descending for new sorts
		}
	}

	// Reactive computed values
	const filteredAndSortedThreads = $derived.by(() => {
		let filtered = threads;

		// Apply global filter
		if (globalFilter.trim()) {
			const filter = globalFilter.toLowerCase();
			filtered = threads.filter(
				(thread) =>
					thread.title.toLowerCase().includes(filter) ||
					thread.projectName.toLowerCase().includes(filter) ||
					thread.agentId.toLowerCase().includes(filter)
			);
		}

		// Apply sorting
		filtered = [...filtered].sort((a, b) => {
			let aValue: string | number;
			let bValue: string | number;

			switch (sorting.column) {
				case "title":
					aValue = a.title.toLowerCase();
					bValue = b.title.toLowerCase();
					break;
				case "createdAt":
					aValue = new SvelteDate(a.createdAt).getTime();
					bValue = new SvelteDate(b.createdAt).getTime();
					break;
				case "updatedAt":
					aValue = new SvelteDate(a.updatedAt || a.createdAt).getTime();
					bValue = new SvelteDate(b.updatedAt || b.createdAt).getTime();
					break;
				case "messageCount":
					aValue = 0;
					bValue = 0;
					break;
				case "toolUseCount":
					aValue = 0;
					bValue = 0;
					break;
				case "tokens":
					aValue = 0;
					bValue = 0;
					break;
				default:
					return 0;
			}

			if (sorting.direction === "asc") {
				return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
			}
			return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
		});

		return filtered;
	});

	const totalThreadCount = $derived(threads.length);
	const filteredThreadCount = $derived(filteredAndSortedThreads.length);

	return {
		// State
		threads: filteredAndSortedThreads,
		isLoading,
		error,
		globalFilter,
		sorting,
		totalThreadCount,
		filteredThreadCount,

		// Actions
		loadThreads,
		setGlobalFilter,
		setSorting,
		toggleSort,
	};
}
