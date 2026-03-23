/**
 * Panel Resizer - Handles panel resize logic
 * Manages drag state, hover detection, and resize callbacks
 */

export interface PanelResizerState {
	isHoveringEdge: boolean;
	isDraggingEdge: boolean;
}

export interface PanelResizerHandlers {
	handlePointerDownEdge: (e: PointerEvent) => void;
	handlePointerMoveEdge: (e: PointerEvent) => void;
	handlePointerUpEdge: () => void;
	handleMouseMoveDetectEdge: (e: MouseEvent) => void;
	handleMouseLeaveDetectEdge: () => void;
	handleDragStart: (e: DragEvent) => void;
}

export interface PanelResizerConfig {
	panelId?: string;
	edgeDetectionWidth?: number;
	onResize?: (panelId: string, delta: number) => void;
}

/**
 * Create a panel resizer with state and handlers
 * Call this in your component to get resize functionality
 */
export function createPanelResizer(config: PanelResizerConfig = {}): {
	state: PanelResizerState;
	handlers: PanelResizerHandlers;
} {
	const { panelId, edgeDetectionWidth = 8, onResize } = config;

	// State - using plain objects so it works in tests, component will wrap with $state
	const state = {
		isHoveringEdge: false,
		isDraggingEdge: false,
	};
	let dragStartX = 0;

	// Handlers
	function handlePointerDownEdge(e: PointerEvent) {
		if (!panelId) return;
		state.isDraggingEdge = true;
		dragStartX = e.clientX;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMoveEdge(e: PointerEvent) {
		if (!state.isDraggingEdge || !panelId) return;
		const delta = e.clientX - dragStartX;
		dragStartX = e.clientX;
		onResize?.(panelId, delta);
	}

	function handlePointerUpEdge() {
		state.isDraggingEdge = false;
	}

	function handleMouseMoveDetectEdge(e: MouseEvent) {
		if (state.isDraggingEdge) return; // Skip hover detection while dragging

		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const distFromRight = rect.right - e.clientX;

		state.isHoveringEdge = distFromRight <= edgeDetectionWidth && distFromRight >= 0;
	}

	function handleMouseLeaveDetectEdge() {
		state.isHoveringEdge = false;
	}

	function handleDragStart(e: DragEvent) {
		if (state.isDraggingEdge) {
			e.preventDefault();
		}
	}

	return {
		state,
		handlers: {
			handlePointerDownEdge,
			handlePointerMoveEdge,
			handlePointerUpEdge,
			handleMouseMoveDetectEdge,
			handleMouseLeaveDetectEdge,
			handleDragStart,
		},
	};
}
