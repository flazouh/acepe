import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

export const dataLengthHistory: number[] = [];

export const scrollToIndexCalls: Array<{
	index: number;
	options?: { align?: string };
}> = [];
let currentScrollOffset = 0;
export const conversationEntryHistory: AgentPanelSceneEntryModel[] = [];

let defaultViewportSize = 100;
let suppressRenderedChildren = false;
let useIndexKeys = false;

export function clearHistory(): void {
	dataLengthHistory.length = 0;
	scrollToIndexCalls.length = 0;
	currentScrollOffset = 0;
	conversationEntryHistory.length = 0;
	defaultViewportSize = 100;
	suppressRenderedChildren = false;
	useIndexKeys = false;
}

export function recordConversationEntry(entry: AgentPanelSceneEntryModel): void {
	conversationEntryHistory.push(entry);
}

export function recordScrollOffset(offset: number): void {
	currentScrollOffset = offset;
}

export function getCurrentScrollOffset(): number {
	return currentScrollOffset;
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

export function shouldUseIndexKeys(): boolean {
	return useIndexKeys;
}

export function setUseIndexKeys(value: boolean): void {
	useIndexKeys = value;
}
