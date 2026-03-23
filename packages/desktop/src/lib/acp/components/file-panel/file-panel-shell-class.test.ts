import { describe, expect, it } from "bun:test";

import { getFilePanelShellClass } from "./file-panel-shell-class";

describe("getFilePanelShellClass", () => {
	it("drops left border in flat attached mode", () => {
		const className = getFilePanelShellClass({
			flatStyle: true,
			isDragging: false,
		});

		expect(className).toContain("border-l-0");
		expect(className).toContain("border-r");
		expect(className).toContain("border-y");
	});

	it("keeps full border in regular mode", () => {
		const className = getFilePanelShellClass({
			flatStyle: false,
			isDragging: false,
		});

		expect(className).toContain("border border-border");
		expect(className).not.toContain("border-l-0");
		expect(className).toContain("rounded-lg");
	});

	it("adds select-none while dragging", () => {
		const className = getFilePanelShellClass({
			flatStyle: false,
			isDragging: true,
		});

		expect(className).toContain("select-none");
	});
});
