/**
 * Props for the AgentPanelResizeEdge component.
 *
 * @property isDragging - Whether the edge is currently being dragged
 * @property onPointerDown - Callback when pointer down event occurs
 * @property onPointerMove - Callback when pointer move event occurs
 * @property onPointerUp - Callback when pointer up event occurs
 */
export interface AgentPanelResizeEdgeProps {
	readonly isDragging: boolean;
	readonly onPointerDown: (e: PointerEvent) => void;
	readonly onPointerMove: (e: PointerEvent) => void;
	readonly onPointerUp: () => void;
}
