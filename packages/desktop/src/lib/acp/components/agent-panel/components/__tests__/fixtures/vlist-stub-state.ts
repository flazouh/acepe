export const dataLengthHistory: number[] = [];

export const scrollToIndexCalls: Array<{
	index: number;
	options?: { align?: string };
}> = [];

let defaultViewportSize = 100;
let suppressRenderedChildren = false;

export function clearHistory(): void {
	dataLengthHistory.length = 0;
	scrollToIndexCalls.length = 0;
	defaultViewportSize = 100;
	suppressRenderedChildren = false;
}

export function getDefaultViewportSize(): number {
	return defaultViewportSize;
}

export function setDefaultViewportSize(size: number): void {
	defaultViewportSize = size;
}

export function shouldSuppressRenderedChildren(): boolean {
	return suppressRenderedChildren;
}

export function setSuppressRenderedChildren(value: boolean): void {
	suppressRenderedChildren = value;
}
