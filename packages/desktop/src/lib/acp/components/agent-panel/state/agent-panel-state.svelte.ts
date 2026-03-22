/**
 * Agent Panel State Manager
 *
 * Manages ONLY local UI state for the agent panel.
 * Follows idiomatic Svelte 5 pattern: classes manage local state, not props.
 *
 * Props and derived values belong in the component.
 * This class only handles:
 * - Local UI state (dialogs, drag state)
 * - Event handlers that modify local state
 *
 * Note: Plan sidebar expanded state is managed by PanelStore.planSidebarExpanded
 * for centralized state management and automatic persistence.
 *
 * @example
 * ```ts
 * const state = new AgentPanelState();
 *
 * // Access local state
 * state.showPlanDialog = true;
 * state.isDraggingEdge
 *
 * // Call handlers
 * state.handlePointerDownEdge(event, panelId, onResize);
 * ```
 */
export class AgentPanelState {
	/**
	 * Whether the plan dialog is currently open.
	 */
	showPlanDialog = $state(false);

	/**
	 * Current width of the plan sidebar in pixels.
	 */
	planSidebarWidth = $state(280);

	/**
	 * Whether the resize edge is currently being dragged.
	 */
	isDraggingEdge = $state(false);

	/**
	 * X coordinate where drag started.
	 * Private - only used internally for calculating delta.
	 */
	private dragStartX = $state(0);

	/**
	 * Opens the plan dialog.
	 */
	openPlanDialog() {
		this.showPlanDialog = true;
	}

	/**
	 * Closes the plan dialog.
	 */
	closePlanDialog() {
		this.showPlanDialog = false;
	}

	/**
	 * Sets the plan sidebar width.
	 */
	setPlanSidebarWidth(width: number) {
		this.planSidebarWidth = Math.max(200, Math.min(600, width));
	}

	/**
	 * Handles pointer down event on resize edge.
	 * Initiates drag and captures pointer.
	 */
	handlePointerDownEdge(e: PointerEvent, panelId: string | undefined) {
		if (!panelId) {
			return;
		}

		this.isDraggingEdge = true;
		this.dragStartX = e.clientX;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	/**
	 * Handles pointer move event during resize drag.
	 * Calculates delta and calls resize callback.
	 */
	handlePointerMoveEdge(
		e: PointerEvent,
		panelId: string | undefined,
		onResizePanel?: (panelId: string, delta: number) => void
	) {
		if (!this.isDraggingEdge || !panelId) {
			return;
		}

		const delta = e.clientX - this.dragStartX;
		onResizePanel?.(panelId, delta);
		this.dragStartX = e.clientX;
	}

	/**
	 * Handles pointer up event to end resize drag.
	 */
	handlePointerUpEdge() {
		this.isDraggingEdge = false;
	}

	/**
	 * Prevents default drag behavior when resizing.
	 * Called on dragstart event.
	 */
	handleDragStart(e: DragEvent) {
		if (this.isDraggingEdge) {
			e.preventDefault();
		}
	}
}
