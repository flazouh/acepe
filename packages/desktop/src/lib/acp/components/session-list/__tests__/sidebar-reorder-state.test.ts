import { describe, expect, it } from "bun:test";

import {
SidebarReorderState,
type SidebarReorderGroupElement,
type SidebarReorderRect,
} from "../sidebar-reorder-state.js";
import type { SessionGroup } from "../session-list-types.js";

function createRect(top: number, height = 40): SidebarReorderRect {
return {
top,
bottom: top + height,
};
}

function createGroupElement(projectPath: string, top: number): SidebarReorderGroupElement {
return {
projectPath,
element: {
getBoundingClientRect() {
return createRect(top);
},
},
};
}

function createGroup(projectPath: string): SessionGroup {
return {
projectPath,
projectName: projectPath,
projectColor: undefined,
projectIconSrc: null,
sessions: [],
};
}

describe("SidebarReorderState", () => {
it("computes the insertion index from group midpoints while excluding the dragged project", () => {
const state = new SidebarReorderState();
state.startDrag(
"/projects/path-0",
[
createGroupElement("/projects/path-0", 0),
createGroupElement("/projects/path-1", 50),
createGroupElement("/projects/path-2", 100),
],
new Set<string>()
);

state.updatePointer(70, createRect(0, 180), [createRect(0), createRect(50), createRect(100)]);

expect(state.insertionIndex).toBe(1);
});

it("starts dragging and records the dragged project path", () => {
const state = new SidebarReorderState();
state.startDrag(
"/projects/path-1",
[
createGroupElement("/projects/path-0", 0),
createGroupElement("/projects/path-1", 50),
],
new Set<string>()
);

expect(state.isDragging).toBeTrue();
expect(state.draggedProjectPath).toBe("/projects/path-1");
});

it("commits a downward drop using the filtered insertion index", () => {
const state = new SidebarReorderState();
state.startDrag(
"/projects/path-0",
[
createGroupElement("/projects/path-0", 0),
createGroupElement("/projects/path-1", 50),
createGroupElement("/projects/path-2", 100),
],
new Set<string>()
);
state.updatePointer(160, createRect(0, 180), [createRect(0), createRect(50), createRect(100)]);

const orderedPaths = state.commitDrop([
createGroup("/projects/path-0"),
createGroup("/projects/path-1"),
createGroup("/projects/path-2"),
]);

expect(orderedPaths).toEqual([
"/projects/path-1",
"/projects/path-2",
"/projects/path-0",
]);
expect(state.isDragging).toBeFalse();
});

it("cancels dragging and clears transient drag state", () => {
const state = new SidebarReorderState();
state.startDrag(
"/projects/path-0",
[
createGroupElement("/projects/path-0", 0),
createGroupElement("/projects/path-1", 50),
],
new Set<string>()
);
state.updatePointer(25, createRect(0, 120), [createRect(0), createRect(50)]);

state.cancelDrag();

expect(state.isDragging).toBeFalse();
expect(state.draggedProjectPath).toBeNull();
expect(state.insertionIndex).toBeNull();
expect(state.ghostY).toBeNull();
expect(state.autoScrollDirection).toBeNull();
});

it("returns the original order when dropped in the same position", () => {
const state = new SidebarReorderState();
state.startDrag(
"/projects/path-1",
[
createGroupElement("/projects/path-0", 0),
createGroupElement("/projects/path-1", 50),
createGroupElement("/projects/path-2", 100),
],
new Set<string>()
);

const orderedPaths = state.commitDrop([
createGroup("/projects/path-0"),
createGroup("/projects/path-1"),
createGroup("/projects/path-2"),
]);

expect(orderedPaths).toEqual([
"/projects/path-0",
"/projects/path-1",
"/projects/path-2",
]);
});

it("places the insertion index at the start when the pointer is above the first group", () => {
const state = new SidebarReorderState();
state.startDrag(
"/projects/path-2",
[
createGroupElement("/projects/path-0", 0),
createGroupElement("/projects/path-1", 50),
createGroupElement("/projects/path-2", 100),
],
new Set<string>()
);

state.updatePointer(-10, createRect(0, 180), [createRect(0), createRect(50), createRect(100)]);

expect(state.insertionIndex).toBe(0);
});

it("places the insertion index at the end when the pointer is below the last group", () => {
const state = new SidebarReorderState();
state.startDrag(
"/projects/path-0",
[
createGroupElement("/projects/path-0", 0),
createGroupElement("/projects/path-1", 50),
createGroupElement("/projects/path-2", 100),
],
new Set<string>()
);

state.updatePointer(200, createRect(0, 180), [createRect(0), createRect(50), createRect(100)]);

expect(state.insertionIndex).toBe(2);
});

it("returns a single-element order unchanged", () => {
const state = new SidebarReorderState();
state.startDrag(
"/projects/path-0",
[createGroupElement("/projects/path-0", 0)],
new Set<string>()
);

const orderedPaths = state.commitDrop([createGroup("/projects/path-0")]);

expect(orderedPaths).toEqual(["/projects/path-0"]);
});

it("keeps the pre-drag expansion snapshot available after commit and cancel", () => {
const commitState = new SidebarReorderState();
commitState.startDrag(
"/projects/path-0",
[
createGroupElement("/projects/path-0", 0),
createGroupElement("/projects/path-1", 50),
],
new Set<string>()
);
commitState.commitDrop([createGroup("/projects/path-0"), createGroup("/projects/path-1")]);

expect(Array.from(commitState.preCollapsedPaths)).toEqual(["/projects/path-0"]);

const cancelState = new SidebarReorderState();
cancelState.startDrag(
"/projects/path-1",
[
createGroupElement("/projects/path-0", 0),
createGroupElement("/projects/path-1", 50),
],
new Set<string>(["/projects/path-0"])
);
cancelState.cancelDrag();

expect(Array.from(cancelState.preCollapsedPaths)).toEqual(["/projects/path-1"]);
});

it("sets auto-scroll direction near the container edges", () => {
const state = new SidebarReorderState();
state.startDrag(
"/projects/path-0",
[
createGroupElement("/projects/path-0", 0),
createGroupElement("/projects/path-1", 50),
],
new Set<string>()
);

state.updatePointer(10, createRect(0, 180), [createRect(0), createRect(50)]);
expect(state.autoScrollDirection).toBe("up");

state.updatePointer(175, createRect(0, 180), [createRect(0), createRect(50)]);
expect(state.autoScrollDirection).toBe("down");
});
});
