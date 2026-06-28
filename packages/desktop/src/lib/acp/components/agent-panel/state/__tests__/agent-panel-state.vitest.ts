import { describe, expect, it } from "vitest";
import { AgentPanelState } from "../agent-panel-state.svelte.js";

const makeResizeDom = (width: number) => {
	const shell = document.createElement("div");
	const edge = document.createElement("div");
	shell.appendChild(edge);
	shell.style.width = `${width}px`;
	shell.style.minWidth = `${width}px`;
	shell.style.maxWidth = `${width}px`;
	edge.setPointerCapture = (_pointerId: number): void => undefined;
	Object.defineProperty(shell, "getBoundingClientRect", {
		value: () =>
			DOMRect.fromRect({
				height: 100,
				width,
			}),
	});
	return {
		edge,
		shell,
	};
};

const makePointerEvent = (clientX: number, target: HTMLElement): PointerEvent => {
	const event = new Event("pointermove") as PointerEvent;
	Object.defineProperty(event, "clientX", { value: clientX });
	Object.defineProperty(event, "currentTarget", { value: target });
	Object.defineProperty(event, "pointerId", { value: 1 });
	return event;
};

describe("AgentPanelState", () => {
	it("updates shell width immediately while committing only one final delta", () => {
		const state = new AgentPanelState();
		const resizeDom = makeResizeDom(450);
		const commits: Array<{ panelId: string; delta: number }> = [];

		state.handlePointerDownEdge(makePointerEvent(100, resizeDom.edge), "panel-1", 450);
		state.handlePointerMoveEdge(makePointerEvent(180, resizeDom.edge), "panel-1");

		expect(commits).toEqual([]);
		expect(resizeDom.shell.style.width).toBe("530px");
		expect(resizeDom.shell.style.minWidth).toBe("530px");
		expect(resizeDom.shell.style.maxWidth).toBe("530px");

		state.handlePointerUpEdge("panel-1", (panelId, delta) => {
			commits.push({
				delta,
				panelId,
			});
		});

		expect(commits).toEqual([{ delta: 80, panelId: "panel-1" }]);
		expect(state.isDraggingEdge).toBe(false);
	});

	it("keeps clamped shell width aligned with the final committed delta", () => {
		const state = new AgentPanelState();
		const resizeDom = makeResizeDom(420);
		const commits: Array<{ panelId: string; delta: number }> = [];

		state.handlePointerDownEdge(makePointerEvent(200, resizeDom.edge), "panel-1", 420);
		state.handlePointerMoveEdge(makePointerEvent(100, resizeDom.edge), "panel-1");

		expect(resizeDom.shell.style.width).toBe("400px");

		state.handlePointerUpEdge("panel-1", (panelId, delta) => {
			commits.push({
				delta,
				panelId,
			});
		});

		expect(commits).toEqual([{ delta: -20, panelId: "panel-1" }]);
	});
});
