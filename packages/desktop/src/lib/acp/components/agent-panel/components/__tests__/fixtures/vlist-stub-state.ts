export const dataLengthHistory: number[] = [];

export const scrollToIndexCalls: Array<{
	index: number;
	options?: { align?: string };
}> = [];

let defaultViewportSize = 100;
let suppressRenderedChildren = false;
let undefinedRenderedIndexes = new Set<number>();

export function clearHistory(): void {
	dataLengthHistory.length = 0;
	scrollToIndexCalls.length = 0;
	defaultViewportSize = 100;
	suppressRenderedChildren = false;
	undefinedRenderedIndexes = new Set<number>();
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

export function setUndefinedRenderedIndexes(indexes: readonly number[]): void {
	undefinedRenderedIndexes = new Set<number>(indexes);
}

export function getRenderedItemAt<T>(data: readonly T[], index: number): T | undefined {
	if (undefinedRenderedIndexes.has(index)) {
		return undefined;
	}

	return data[index];
}
