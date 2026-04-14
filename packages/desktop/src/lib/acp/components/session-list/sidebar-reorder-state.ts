import type { SessionGroup } from "./session-list-types.js";

export interface SidebarReorderRect {
	top: number;
	bottom: number;
}

export interface SidebarReorderGroupElement {
	projectPath: string;
	element: {
		getBoundingClientRect(): SidebarReorderRect;
	};
}

export type AutoScrollDirection = "up" | "down" | null;

const AUTO_SCROLL_EDGE_THRESHOLD_PX = 48;

function compareRects(a: SidebarReorderRect, b: SidebarReorderRect): number {
	if (a.top !== b.top) {
		return a.top - b.top;
	}

	return a.bottom - b.bottom;
}

function clamp(value: number, minimum: number, maximum: number): number {
	if (value < minimum) {
		return minimum;
	}

	if (value > maximum) {
		return maximum;
	}

	return value;
}

export class SidebarReorderState {
	isDragging = false;
	draggedProjectPath: string | null = null;
	insertionIndex: number | null = null;
	ghostY: number | null = null;
	autoScrollDirection: AutoScrollDirection = null;
	preCollapsedPaths = new Set<string>();

	private orderedProjectPaths: string[] = [];

	startDrag(
		projectPath: string,
		groupElements: ReadonlyArray<SidebarReorderGroupElement>,
		collapsedProjects: ReadonlySet<string>
	): void {
		this.preCollapsedPaths.clear();
		this.isDragging = true;
		this.draggedProjectPath = projectPath;
		this.autoScrollDirection = null;

		const orderedEntries = groupElements
			.map((groupElement) => ({
				projectPath: groupElement.projectPath,
				rect: groupElement.element.getBoundingClientRect(),
			}))
			.sort((left, right) => compareRects(left.rect, right.rect));

		this.orderedProjectPaths = orderedEntries.map((entry) => entry.projectPath);

		const sourceIndex = this.orderedProjectPaths.findIndex((path) => path === projectPath);
		this.insertionIndex = sourceIndex >= 0 ? sourceIndex : 0;

		const draggedEntry = orderedEntries.find((entry) => entry.projectPath === projectPath) ?? null;
		this.ghostY = draggedEntry ? draggedEntry.rect.top : null;

		if (!collapsedProjects.has(projectPath)) {
			this.preCollapsedPaths.add(projectPath);
		}
	}

	updatePointer(
		clientY: number,
		containerRect: SidebarReorderRect,
		groupRects: ReadonlyArray<SidebarReorderRect>
	): void {
		if (!this.isDragging || this.draggedProjectPath === null) {
			return;
		}

		this.ghostY = clientY;
		this.autoScrollDirection = this.getAutoScrollDirection(clientY, containerRect);

		const candidateRects: SidebarReorderRect[] = [];
		for (let index = 0; index < groupRects.length; index += 1) {
			const projectPath = this.orderedProjectPaths[index] ?? null;
			if (projectPath === this.draggedProjectPath) {
				continue;
			}

			const groupRect = groupRects[index];
			if (groupRect === undefined) {
				continue;
			}

			candidateRects.push(groupRect);
		}

		candidateRects.sort(compareRects);

		if (candidateRects.length === 0) {
			this.insertionIndex = 0;
			return;
		}

		let nextInsertionIndex = 0;
		for (const rect of candidateRects) {
			const midpoint = rect.top + (rect.bottom - rect.top) / 2;
			if (clientY >= midpoint) {
				nextInsertionIndex += 1;
				continue;
			}

			break;
		}

		this.insertionIndex = nextInsertionIndex;
	}

	commitDrop(currentGroups: ReadonlyArray<SessionGroup>): string[] {
		const originalOrder = currentGroups.map((group) => group.projectPath);
		const draggedProjectPath = this.draggedProjectPath;
		const fallbackInsertionIndex = draggedProjectPath
			? currentGroups.findIndex((group) => group.projectPath === draggedProjectPath)
			: -1;

		if (draggedProjectPath === null) {
			return originalOrder;
		}

		const remainingProjectPaths = currentGroups
			.filter((group) => group.projectPath !== draggedProjectPath)
			.map((group) => group.projectPath);
		const normalizedInsertionIndex = clamp(
			this.insertionIndex ?? Math.max(fallbackInsertionIndex, 0),
			0,
			remainingProjectPaths.length
		);

		remainingProjectPaths.splice(normalizedInsertionIndex, 0, draggedProjectPath);
		this.resetTransientDragState();
		return remainingProjectPaths;
	}

	cancelDrag(): void {
		this.resetTransientDragState();
	}

	private getAutoScrollDirection(
		clientY: number,
		containerRect: SidebarReorderRect
	): AutoScrollDirection {
		if (clientY <= containerRect.top + AUTO_SCROLL_EDGE_THRESHOLD_PX) {
			return "up";
		}

		if (clientY >= containerRect.bottom - AUTO_SCROLL_EDGE_THRESHOLD_PX) {
			return "down";
		}

		return null;
	}

	private resetTransientDragState(): void {
		this.isDragging = false;
		this.draggedProjectPath = null;
		this.insertionIndex = null;
		this.ghostY = null;
		this.autoScrollDirection = null;
		this.orderedProjectPaths = [];
	}
}
