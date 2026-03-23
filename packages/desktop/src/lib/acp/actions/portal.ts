/**
 * Svelte action that teleports an element to document.body.
 * This escapes any parent transforms that would affect position: fixed.
 *
 * Usage:
 * ```svelte
 * <div use:portal class="fixed ...">
 *   Content that needs to escape parent transforms
 * </div>
 * ```
 */
export function portal(node: HTMLElement): { destroy: () => void } {
	// Store original parent and next sibling for potential restoration
	const originalParent = node.parentElement;
	const placeholder = document.createComment("portal");

	// Insert placeholder where the node was
	originalParent?.insertBefore(placeholder, node);

	// Move node to body
	document.body.appendChild(node);

	return {
		destroy() {
			// Remove from body
			if (node.parentElement === document.body) {
				document.body.removeChild(node);
			}
			// Remove placeholder
			placeholder.remove();
		},
	};
}
