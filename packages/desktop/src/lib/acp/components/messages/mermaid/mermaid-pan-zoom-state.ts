import type { PanZoomState } from "./use-pan-zoom.js";

export const MERMAID_CANVAS_DEFAULT_PAN_ZOOM_STATE: PanZoomState = {
	scale: 1,
	translateX: 0,
	translateY: 0,
};

export function applyPanZoomStateUpdate(
	current: PanZoomState,
	updates: Partial<PanZoomState>
): PanZoomState {
	return {
		scale: updates.scale ?? current.scale,
		translateX: updates.translateX ?? current.translateX,
		translateY: updates.translateY ?? current.translateY,
	};
}

export function getPanZoomTransform(state: PanZoomState): string {
	return `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
}

export function getPanZoomLevel(scale: number): number {
	return Math.round(scale * 100);
}

export function zoomMermaidPanZoomIn(state: PanZoomState): PanZoomState {
	return applyPanZoomStateUpdate(state, { scale: Math.min(5, state.scale * 1.25) });
}

export function zoomMermaidPanZoomOut(state: PanZoomState): PanZoomState {
	return applyPanZoomStateUpdate(state, { scale: Math.max(0.2, state.scale * 0.8) });
}

export function resetMermaidPanZoomState(): PanZoomState {
	return { ...MERMAID_CANVAS_DEFAULT_PAN_ZOOM_STATE };
}
