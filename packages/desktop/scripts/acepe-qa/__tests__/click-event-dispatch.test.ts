import { describe, expect, it } from "bun:test";

import { dispatchWebviewClick } from "../click-event-dispatch.js";

const noWait = (_milliseconds: number): Promise<void> => Promise.resolve();

describe("dispatchWebviewClick", () => {
	it("emits one real-detail click after pointer events", async () => {
		const button = document.createElement("button");
		let menuOpen = false;
		const clickDetails: number[] = [];
		let onclickCount = 0;

		button.addEventListener("pointerdown", () => {
			menuOpen = !menuOpen;
		});
		button.addEventListener("click", (event) => {
			onclickCount += 1;
			clickDetails.push(event.detail);
			if (event.detail === 0) {
				menuOpen = !menuOpen;
			}
		});

		await dispatchWebviewClick(button, true, noWait);

		expect(menuOpen).toBe(true);
		expect(onclickCount).toBe(1);
		expect(clickDetails).toEqual([1]);
	});

	it("keeps element.click for non-pointer activation", async () => {
		const button = document.createElement("button");
		const clickDetails: number[] = [];
		button.addEventListener("click", (event) => {
			clickDetails.push(event.detail);
		});

		await dispatchWebviewClick(button, false, noWait);

		expect(clickDetails).toEqual([0]);
	});
});
