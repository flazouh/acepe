export interface PanZoomState {
	scale: number;
	translateX: number;
	translateY: number;
}

export interface PanZoomOptions {
	minScale: number;
	maxScale: number;
}

export interface PanZoomHandlers {
	handleWheel: (event: WheelEvent) => void;
	handleMouseDown: (event: MouseEvent) => void;
	handleMouseMove: (event: MouseEvent) => void;
	handleMouseUp: () => void;
	handleTouchStart: (event: TouchEvent) => void;
	handleTouchMove: (event: TouchEvent) => void;
	handleTouchEnd: () => void;
	zoomIn: () => void;
	zoomOut: () => void;
	resetZoom: () => void;
}

export function createPanZoomHandlers(
	getState: () => PanZoomState,
	setState: (updates: Partial<PanZoomState>) => void,
	options: PanZoomOptions
): PanZoomHandlers {
	const { minScale, maxScale } = options;
	let isPanning = false;
	let lastMouseX = 0;
	let lastMouseY = 0;
	let lastPinchDistance = 0;

	function handleWheel(event: WheelEvent): void {
		event.preventDefault();
		const state = getState();
		const delta = event.deltaY > 0 ? 0.9 : 1.1;
		const newScale = Math.min(maxScale, Math.max(minScale, state.scale * delta));

		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const mouseX = event.clientX - rect.left;
		const mouseY = event.clientY - rect.top;

		const scaleChange = newScale / state.scale;
		setState({
			scale: newScale,
			translateX: mouseX - (mouseX - state.translateX) * scaleChange,
			translateY: mouseY - (mouseY - state.translateY) * scaleChange,
		});
	}

	function handleMouseDown(event: MouseEvent): void {
		if (event.button !== 0) return;
		isPanning = true;
		lastMouseX = event.clientX;
		lastMouseY = event.clientY;
		event.preventDefault();

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
	}

	function handleMouseMove(event: MouseEvent): void {
		if (!isPanning) return;
		const deltaX = event.clientX - lastMouseX;
		const deltaY = event.clientY - lastMouseY;
		lastMouseX = event.clientX;
		lastMouseY = event.clientY;
		const state = getState();
		setState({
			translateX: state.translateX + deltaX,
			translateY: state.translateY + deltaY,
		});
	}

	function handleMouseUp(): void {
		isPanning = false;
		window.removeEventListener("mousemove", handleMouseMove);
		window.removeEventListener("mouseup", handleMouseUp);
	}

	function handleTouchStart(event: TouchEvent): void {
		if (event.touches.length === 1) {
			isPanning = true;
			lastMouseX = event.touches[0].clientX;
			lastMouseY = event.touches[0].clientY;
		}
	}

	function handleTouchMove(event: TouchEvent): void {
		event.preventDefault();
		if (event.touches.length === 1 && isPanning) {
			const deltaX = event.touches[0].clientX - lastMouseX;
			const deltaY = event.touches[0].clientY - lastMouseY;
			lastMouseX = event.touches[0].clientX;
			lastMouseY = event.touches[0].clientY;
			const state = getState();
			setState({
				translateX: state.translateX + deltaX,
				translateY: state.translateY + deltaY,
			});
		} else if (event.touches.length === 2) {
			const touch1 = event.touches[0];
			const touch2 = event.touches[1];
			const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);

			if (lastPinchDistance > 0) {
				const delta = distance / lastPinchDistance;
				const state = getState();
				setState({
					scale: Math.min(maxScale, Math.max(minScale, state.scale * delta)),
				});
			}
			lastPinchDistance = distance;
		}
	}

	function handleTouchEnd(): void {
		isPanning = false;
		lastPinchDistance = 0;
	}

	function zoomIn(): void {
		const state = getState();
		setState({ scale: Math.min(maxScale, state.scale * 1.25) });
	}

	function zoomOut(): void {
		const state = getState();
		setState({ scale: Math.max(minScale, state.scale * 0.8) });
	}

	function resetZoom(): void {
		setState({ scale: 1, translateX: 0, translateY: 0 });
	}

	return {
		handleWheel,
		handleMouseDown,
		handleMouseMove,
		handleMouseUp,
		handleTouchStart,
		handleTouchMove,
		handleTouchEnd,
		zoomIn,
		zoomOut,
		resetZoom,
	};
}
