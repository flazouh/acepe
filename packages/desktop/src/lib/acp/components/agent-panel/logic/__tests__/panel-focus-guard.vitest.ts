import { describe, expect, it } from "vitest";
import { isInteractiveClickTarget } from "../panel-focus-guard.js";

function el(html: string): HTMLElement {
	const container = document.createElement("div");
	container.innerHTML = html;
	return container.firstElementChild as HTMLElement;
}

describe("isInteractiveClickTarget", () => {
	it("treats form controls, buttons, and links as interactive", () => {
		expect(isInteractiveClickTarget(el("<textarea></textarea>"))).toBe(true);
		expect(isInteractiveClickTarget(el("<input />"))).toBe(true);
		expect(isInteractiveClickTarget(el("<button>Go</button>"))).toBe(true);
		expect(isInteractiveClickTarget(el('<a href="#">link</a>'))).toBe(true);
	});

	it("treats a registered data-input-area (and its descendants) as interactive", () => {
		const area = el("<div data-input-area><span>child</span></div>");
		expect(isInteractiveClickTarget(area)).toBe(true);
		expect(isInteractiveClickTarget(area.querySelector("span") as HTMLElement)).toBe(true);
	});

	it("treats descendants of a button as interactive", () => {
		const button = el("<button><span>inner</span></button>");
		expect(isInteractiveClickTarget(button.querySelector("span") as HTMLElement)).toBe(true);
	});

	it("does NOT treat plain content or role=button containers as interactive", () => {
		expect(isInteractiveClickTarget(el("<div>plain</div>"))).toBe(false);
		expect(isInteractiveClickTarget(el('<div role="button">collapsible</div>'))).toBe(false);
	});
});
