import { describe, expect, it } from "bun:test";

import { CommandsProvider } from "./commands-provider.js";

function noop(): void {}

describe("CommandsProvider", () => {
	it("uses exact Hugeicons icons for command palette actions when available", () => {
		const provider = new CommandsProvider({
			onCreateThread: noop,
			onOpenSettings: noop,
			onToggleSidebar: noop,
			onToggleDebug: noop,
			onCloseThread: noop,
			onRefreshSync: noop,
			isDev: true,
		});

		const itemsById = new Map(provider.search("").map((item) => [item.id, item]));

		expect(itemsById.get("thread.create")?.iconName).toBe("new-chat");
		expect(itemsById.get("settings.open")?.iconName).toBe("settings");
		expect(itemsById.get("sidebar.toggle")?.iconName).toBe("sidebar");
		expect(itemsById.get("thread.close")?.iconName).toBe("close");
		expect(itemsById.get("sync.refresh")?.iconName).toBe("refresh");
		expect(itemsById.get("debug.toggle")?.iconName).toBe("terminal");
	});
});
