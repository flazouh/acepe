export type WebviewClickWait = (milliseconds: number) => Promise<void>;

/**
 * Dispatch a click inside the WebView using browser-like event detail.
 * Pointer-driven controls receive detail 1; keyboard/programmatic activation
 * keeps HTMLElement.click() and its detail 0 semantics.
 */
export async function dispatchWebviewClick(
	element: HTMLElement,
	dispatchPointerEvents: boolean,
	wait: WebviewClickWait
): Promise<void> {
	element.scrollIntoView({ block: "center", inline: "nearest" });
	await wait(100);
	if (!dispatchPointerEvents) {
		element.click();
		return;
	}

	const rect = element.getBoundingClientRect();
	const clientX = rect.left + rect.width / 2;
	const clientY = rect.top + rect.height / 2;
	const pointerDownInit: PointerEventInit = {
		bubbles: true,
		cancelable: true,
		view: window,
		clientX,
		clientY,
		button: 0,
		buttons: 1,
		pointerId: 1,
		pointerType: "mouse",
		isPrimary: true,
	};
	const pointerUpInit: PointerEventInit = {
		bubbles: true,
		cancelable: true,
		view: window,
		clientX,
		clientY,
		button: 0,
		buttons: 0,
		pointerId: 1,
		pointerType: "mouse",
		isPrimary: true,
	};
	if (typeof PointerEvent === "function") {
		element.dispatchEvent(new PointerEvent("pointerdown", pointerDownInit));
	}
	element.dispatchEvent(new MouseEvent("mousedown", pointerDownInit));
	if (typeof PointerEvent === "function") {
		element.dispatchEvent(new PointerEvent("pointerup", pointerUpInit));
	}
	element.dispatchEvent(new MouseEvent("mouseup", pointerUpInit));
	element.dispatchEvent(
		new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			view: window,
			clientX,
			clientY,
			button: 0,
			buttons: 0,
			detail: 1,
		})
	);
}
