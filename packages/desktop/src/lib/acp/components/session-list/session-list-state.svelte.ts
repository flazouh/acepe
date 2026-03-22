/**
 * Session List State Manager
 *
 * Manages ONLY local UI state for the session list.
 * Follows idiomatic Svelte 5 pattern: classes manage local state, not props.
 *
 * @example
 * ```ts
 * const state = new SessionListState();
 * state.searchQuery
 * state.setSearchQuery("test");
 * ```
 */
export class SessionListState {
	/**
	 * Current search query for filtering sessions.
	 */
	searchQuery = $state("");

	/**
	 * Updates the search query.
	 */
	setSearchQuery(query: string): void {
		this.searchQuery = query;
	}
}
