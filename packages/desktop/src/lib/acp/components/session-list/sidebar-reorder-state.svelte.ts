import { SvelteSet } from "svelte/reactivity";

import {
	type AutoScrollDirection,
	type SidebarReorderGroupElement,
	type SidebarReorderRect,
	SidebarReorderState as SidebarReorderStateBase,
} from "./sidebar-reorder-state.js";

export type { AutoScrollDirection, SidebarReorderGroupElement, SidebarReorderRect };

export class SidebarReorderState extends SidebarReorderStateBase {
	override isDragging = $state(false);
	override draggedProjectPath = $state<string | null>(null);
	override insertionIndex = $state<number | null>(null);
	override ghostY = $state<number | null>(null);
	override autoScrollDirection = $state<AutoScrollDirection>(null);
	override preCollapsedPaths = new SvelteSet<string>();
}
