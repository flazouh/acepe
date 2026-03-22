import { describe, expect, it } from "bun:test";

import { createPanelResizer } from "../panel-resizer.svelte.js";

describe("createPanelResizer", () => {
	it("should initialize with default state", () => {
		const resizer = createPanelResizer({ panelId: "panel1" });

		expect(resizer.state.isHoveringEdge).toBe(false);
		expect(resizer.state.isDraggingEdge).toBe(false);
	});

	it("should track hover edge state", () => {
		const resizer = createPanelResizer({
			panelId: "panel1",
			edgeDetectionWidth: 8,
		});

		// Create mock mouse event near right edge
		const mockEvent = {
			clientX: 400,
			currentTarget: {
				getBoundingClientRect: () => ({
					right: 408,
					left: 0,
					top: 0,
					bottom: 100,
					width: 408,
					height: 100,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				}),
			},
		} as unknown as MouseEvent;

		resizer.handlers.handleMouseMoveDetectEdge(mockEvent as MouseEvent);
		expect(resizer.state.isHoveringEdge).toBe(true);
	});

	it("should clear hover state when mouse leaves", () => {
		const resizer = createPanelResizer({ panelId: "panel1" });

		// Set hover state first
		(resizer.state as { isHoveringEdge: boolean }).isHoveringEdge = true;

		// Clear on mouse leave
		resizer.handlers.handleMouseLeaveDetectEdge();
		expect(resizer.state.isHoveringEdge).toBe(false);
	});

	it("should call onResize callback when dragging", () => {
		let resizeCount = 0;
		let lastDelta = 0;

		const resizer = createPanelResizer({
			panelId: "panel1",
			onResize: (_panelId, delta) => {
				resizeCount++;
				lastDelta = delta;
			},
		});

		// Simulate drag start
		const pointerDownEvent = {
			clientX: 100,
			currentTarget: { setPointerCapture: () => {} },
		} as unknown as PointerEvent;

		resizer.handlers.handlePointerDownEdge(pointerDownEvent as PointerEvent);

		// Simulate drag move
		const pointerMoveEvent = {
			clientX: 150, // 50px to the right
		} as unknown as PointerEvent;

		resizer.handlers.handlePointerMoveEdge(pointerMoveEvent as PointerEvent);

		expect(resizeCount).toBe(1);
		expect(lastDelta).toBe(50);
	});

	it("should prevent default drag behavior while resizing", () => {
		const resizer = createPanelResizer({ panelId: "panel1" });

		// Simulate starting a drag
		const pointerDownEvent = {
			clientX: 100,
			currentTarget: { setPointerCapture: () => {} },
		} as unknown as PointerEvent;
		resizer.handlers.handlePointerDownEdge(pointerDownEvent as PointerEvent);

		// Now verify dragging state is set
		expect(resizer.state.isDraggingEdge).toBe(true);

		// Test drag start during drag
		const dragEvent = {
			preventDefault: () => {},
		} as unknown as DragEvent;

		let preventDefaultCalled = false;
		dragEvent.preventDefault = () => {
			preventDefaultCalled = true;
		};

		resizer.handlers.handleDragStart(dragEvent as DragEvent);

		expect(preventDefaultCalled).toBe(true);
	});

	it("should stop dragging on pointer up", () => {
		const resizer = createPanelResizer({ panelId: "panel1" });

		// Set dragging state
		(resizer.state as { isDraggingEdge: boolean }).isDraggingEdge = true;

		resizer.handlers.handlePointerUpEdge();

		expect(resizer.state.isDraggingEdge).toBe(false);
	});

	it("should respect panelId requirement", () => {
		let resizeCalled = false;
		const resizer = createPanelResizer({
			onResize: () => {
				resizeCalled = true;
			},
		});

		// Without panelId, resize should not work
		const pointerDownEvent = {
			clientX: 100,
			currentTarget: { setPointerCapture: () => {} },
		} as unknown as PointerEvent;

		resizer.handlers.handlePointerDownEdge(pointerDownEvent as PointerEvent);

		expect(resizer.state.isDraggingEdge).toBe(false);
		expect(resizeCalled).toBe(false);
	});
});
