import { describe, expect, it } from "bun:test";

import { CommandsProvider } from "./commands-provider.js";

function noop(): void {}

describe("CommandsProvider", () => {
	it("uses exact rounded icons for command palette actions when available", () => {
		const provider = new CommandsProvider({
			onCreateThread: noop,
			onOpenSettings: noop,
			onOpenSqlStudio: noop,
			onToggleSidebar: noop,
			onToggleDebug: noop,
			onCloseThread: noop,
			onRefreshSync: noop,
			isDev: true,
		});

		const itemsById = new Map(provider.search("").map((item) => [item.id, item]));

		expect(itemsById.get("thread.create")?.roundedIcon).toBe("new-chat");
		expect(itemsById.get("settings.open")?.roundedIcon).toBe("settings");
		expect(itemsById.get("sidebar.toggle")?.roundedIcon).toBe("sidebar");
		expect(itemsById.get("thread.close")?.roundedIcon).toBe("close");
		expect(itemsById.get("sync.refresh")?.roundedIcon).toBe("refresh");
		expect(itemsById.get("debug.toggle")?.roundedIcon).toBe("terminal");

		const sqlItem = itemsById.get("sql-studio.open");
		expect(sqlItem?.roundedIcon).toBeUndefined();
		expect(sqlItem?.icon).toBeDefined();
	});
});
