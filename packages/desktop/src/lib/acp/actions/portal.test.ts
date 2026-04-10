import { afterEach, describe, expect, it } from "bun:test";
import { portal } from "./portal.js";

function createPortaledNode(): { host: HTMLDivElement; node: HTMLDivElement } {
	const host = document.createElement("div");
	const node = document.createElement("div");
	host.appendChild(node);
	document.body.appendChild(host);
	return { host, node };
}

describe("portal action", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		document.body.removeAttribute("style");
	});

	it("keeps a portaled node interactive when a modal disables pointer events on body", () => {
		document.body.style.pointerEvents = "none";
		const { host, node } = createPortaledNode();

		const action = portal(node);

		expect(node.parentElement).toBe(document.body);
		expect(node.style.pointerEvents).toBe("auto");

		action.destroy();
		host.remove();
	});

	it("preserves an explicit pointer-events style on the portaled node", () => {
		document.body.style.pointerEvents = "none";
		const { host, node } = createPortaledNode();
		node.style.pointerEvents = "none";

		const action = portal(node);

		expect(node.style.pointerEvents).toBe("none");

		action.destroy();
		host.remove();
	});
});
