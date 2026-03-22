import type { SortColumn, SortDirection } from "./session-table-types.js";

/**
 * Session Table State Manager
 *
 * Manages ONLY local UI state for the session table.
 * Follows idiomatic Svelte 5 pattern: classes manage local state, not props.
 *
 * Props and derived values belong in the component.
 * This class only handles:
 * - Local UI state (search, sort, filters, pagination)
 * - Event handlers that modify local state
 *
 * @example
 * ```ts
 * const state = new SessionTableState();
 *
 * // Access local state
 * state.searchQuery
 * state.sortColumn
 * state.currentPage
 *
 * // Call handlers
 * state.setSearchQuery("test");
 * state.toggleSort("title");
 * state.goToNextPage();
 * ```
 */
export class SessionTableState {
	/**
	 * Current search query for filtering sessions.
	 */
	searchQuery = $state("");

	/**
	 * Current sort column.
	 */
	sortColumn = $state<SortColumn>("updatedAt");

	/**
	 * Current sort direction.
	 */
	sortDirection = $state<SortDirection>("desc");

	/**
	 * Current project filter (null = all projects).
	 */
	projectFilter = $state<string | null>(null);

	/**
	 * Current agent filter (null = all agents).
	 */
	agentFilter = $state<string | null>(null);

	/**
	 * Current page number (0-indexed).
	 */
	currentPage = $state(0);

	/**
	 * Number of rows per page.
	 */
	pageSize = $state(20);

	/**
	 * Updates the search query and resets to first page.
	 */
	setSearchQuery(query: string): void {
		this.searchQuery = query;
		this.currentPage = 0;
	}

	/**
	 * Sets the sort column and direction.
	 */
	setSort(column: SortColumn, direction: SortDirection): void {
		this.sortColumn = column;
		this.sortDirection = direction;
	}

	/**
	 * Toggles sort direction for a column.
	 * If different column, sets to desc by default.
	 */
	toggleSort(column: SortColumn): void {
		if (this.sortColumn === column) {
			this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
		} else {
			this.sortColumn = column;
			this.sortDirection = "desc";
		}
	}

	/**
	 * Sets the project filter and resets to first page.
	 */
	setProjectFilter(projectPath: string | null): void {
		this.projectFilter = projectPath;
		this.currentPage = 0;
	}

	/**
	 * Sets the agent filter and resets to first page.
	 */
	setAgentFilter(agentId: string | null): void {
		this.agentFilter = agentId;
		this.currentPage = 0;
	}

	/**
	 * Clears all filters and resets to first page.
	 */
	clearFilters(): void {
		this.searchQuery = "";
		this.projectFilter = null;
		this.agentFilter = null;
		this.currentPage = 0;
	}

	/**
	 * Goes to a specific page.
	 */
	goToPage(page: number, totalPages: number): void {
		if (page >= 0 && page < totalPages) {
			this.currentPage = page;
		}
	}

	/**
	 * Goes to the previous page.
	 */
	goToPreviousPage(): void {
		if (this.currentPage > 0) {
			this.currentPage--;
		}
	}

	/**
	 * Goes to the next page.
	 */
	goToNextPage(totalPages: number): void {
		if (this.currentPage < totalPages - 1) {
			this.currentPage++;
		}
	}

	/**
	 * Goes to the first page.
	 */
	goToFirstPage(): void {
		this.currentPage = 0;
	}

	/**
	 * Goes to the last page.
	 */
	goToLastPage(totalPages: number): void {
		this.currentPage = Math.max(0, totalPages - 1);
	}
}
