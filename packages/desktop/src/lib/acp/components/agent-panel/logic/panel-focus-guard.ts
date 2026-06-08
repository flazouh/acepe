/**
 * Whether a panel-click landed on an interactive element (form control, button,
 * link, or a registered `data-input-area`) — in which case the panel should NOT
 * steal focus. Pure DOM predicate extracted from the agent-panel controller's
 * `handlePanelClick` so it can be unit-tested in isolation.
 *
 * `role="button"` is intentionally NOT treated as interactive: it is used for
 * accessibility on collapsible containers that should still focus the panel.
 */
export function isInteractiveClickTarget(target: HTMLElement): boolean {
	const isInputArea =
		target.hasAttribute("data-input-area") || target.closest("[data-input-area]") !== null;
	const isTextarea = target.tagName === "TEXTAREA" || target.closest("textarea") !== null;
	const isInput = target.tagName === "INPUT" || target.closest("input") !== null;
	const isButton = target.closest("button") !== null;
	const isLink = target.closest("a") !== null;

	return isInputArea || isTextarea || isInput || isButton || isLink;
}
