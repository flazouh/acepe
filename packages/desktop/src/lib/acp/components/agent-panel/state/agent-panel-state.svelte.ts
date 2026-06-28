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
 * state.handlePointerDownEdge(event, panelId, panelWidth);
 * ```
 */
import { MIN_PANEL_WIDTH } from "../../../store/types.js";

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
	 * X coordinate and width where drag started.
	 * Private - only used internally for calculating delta.
	 */
	private dragStartX = 0;
	private dragStartWidth = 0;
	private dragStartRenderedWidth = 0;
	private lastClientX: number | null = null;
	private dragShellElement: HTMLElement | null = null;

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
	handlePointerDownEdge(
		e: PointerEvent,
		panelId: string | undefined,
		currentWidth: number | undefined
	) {
		if (!panelId) {
			return;
		}

		this.isDraggingEdge = true;
		this.dragStartX = e.clientX;
		this.dragStartWidth = Math.max(currentWidth ?? MIN_PANEL_WIDTH, MIN_PANEL_WIDTH);
		this.lastClientX = e.clientX;
		this.dragShellElement = this.resolveResizeShell(e);
		this.dragStartRenderedWidth = Math.max(
			this.dragShellElement?.getBoundingClientRect().width ?? this.dragStartWidth,
			MIN_PANEL_WIDTH
		);
		this.applyShellWidth(this.dragStartRenderedWidth);

		if (e.currentTarget instanceof HTMLElement) {
			e.currentTarget.setPointerCapture(e.pointerId);
		}
	}

	/**
	 * Handles pointer move event during resize drag.
	 * Updates the shell width immediately. The store is committed once on pointer up.
	 */
	handlePointerMoveEdge(e: PointerEvent, panelId: string | undefined) {
		if (!this.isDraggingEdge || !panelId) {
			return;
		}

		this.lastClientX = e.clientX;
		this.applyShellWidth(this.resolveRenderedWidth(e.clientX));
	}

	/**
	 * Handles pointer up event to end resize drag.
	 */
	handlePointerUpEdge(
		panelId: string | undefined,
		onResizePanel?: (panelId: string, delta: number) => void
	) {
		if (!this.isDraggingEdge || !panelId) {
			this.clearResizeDragState();
			return;
		}

		const finalWidth = this.resolveBaseWidth(this.lastClientX ?? this.dragStartX);
		const delta = finalWidth - this.dragStartWidth;
		this.clearResizeDragState();

		if (delta !== 0) {
			onResizePanel?.(panelId, delta);
		}
	}

	dispose(): void {
		this.clearResizeDragState();
	}

	private resolveBaseWidth(clientX: number): number {
		return Math.max(this.dragStartWidth + clientX - this.dragStartX, MIN_PANEL_WIDTH);
	}

	private resolveRenderedWidth(clientX: number): number {
		const delta = this.resolveBaseWidth(clientX) - this.dragStartWidth;
		return Math.max(this.dragStartRenderedWidth + delta, MIN_PANEL_WIDTH);
	}

	private applyShellWidth(width: number): void {
		const shell = this.dragShellElement;
		if (shell === null) {
			return;
		}

		const pixelWidth = `${width}px`;
		shell.style.width = pixelWidth;
		shell.style.minWidth = pixelWidth;
		shell.style.maxWidth = pixelWidth;
	}

	private resolveResizeShell(e: PointerEvent): HTMLElement | null {
		if (!(e.currentTarget instanceof HTMLElement)) {
			return null;
		}

		const shell = e.currentTarget.closest("[style*='min-width'][style*='max-width']");
		return shell instanceof HTMLElement ? shell : null;
	}

	private clearResizeDragState(): void {
		this.isDraggingEdge = false;
		this.lastClientX = null;
		this.dragShellElement = null;
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
