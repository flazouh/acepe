import { describe, expect, it } from "bun:test";
import { standardApplicationMenu } from "./application-menu.ts";

type MenuItem = ReturnType<typeof standardApplicationMenu>[number];

const flatten = (items: ReadonlyArray<MenuItem>): Array<MenuItem> =>
	items.flatMap((item) => [item, ...flatten(item.submenu ?? [])]);

// Reproduces the live defect: with no application menu, macOS has no key
// equivalents at all -- Cmd+Q did not quit and Cmd+A selected nothing in the
// composer. These pin the roles and accelerators that restore the standard
// shortcuts.
describe("standardApplicationMenu", () => {
	const all = flatten(standardApplicationMenu());
	const byRole = (role: string) => all.find((item) => item.role === role);

	it("binds quit to Cmd+Q", () => {
		expect(byRole("quit")?.accelerator).toBe("CommandOrControl+Q");
	});

	it("binds the standard edit actions", () => {
		expect(byRole("selectAll")?.accelerator).toBe("CommandOrControl+A");
		expect(byRole("copy")?.accelerator).toBe("CommandOrControl+C");
		expect(byRole("paste")?.accelerator).toBe("CommandOrControl+V");
		expect(byRole("cut")?.accelerator).toBe("CommandOrControl+X");
		expect(byRole("undo")?.accelerator).toBe("CommandOrControl+Z");
	});

	it("offers no Close item: closing the only window would strand a headless app", () => {
		expect(byRole("close")).toBeUndefined();
	});
});
