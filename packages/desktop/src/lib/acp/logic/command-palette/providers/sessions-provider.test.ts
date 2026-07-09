import { describe, expect, it } from "bun:test";

import type { SessionPaletteReference } from "../../../store/session-cold-index.js";
import { SessionsProvider } from "./sessions-provider.js";

const session: SessionPaletteReference = {
	id: "session-1",
	projectPath: "/workspace/acepe",
	agentId: "codex",
	title: "Fix sidebar icons",
};

function noop(): void {}

describe("SessionsProvider", () => {
	it("uses the exact rounded chat icon for session palette items", () => {
		const provider = new SessionsProvider({
			sessionStore: {
				read: {
					getSessionPaletteReferences: () => [session],
					getSessionPaletteReference: (sessionId: string) =>
						sessionId === session.id ? session : undefined,
				},
			} as never,
			projectManager: {
				getProject: (projectPath: string) =>
					projectPath === session.projectPath
						? {
								path: session.projectPath,
								name: "Acepe",
								createdAt: new Date("2026-07-01T00:00:00Z"),
								color: "cyan",
								iconPath: null,
							}
						: undefined,
				getProjectBadgeLabel: (projectPath: string) =>
					projectPath === session.projectPath ? "Ac" : undefined,
			} as never,
			onOpenSession: noop,
		});

		const [item] = provider.search("");

		expect(item?.roundedIcon).toBe("chat");
		expect(item?.icon).toBeUndefined();
		expect(item?.metadata.projectBadgeLabel).toBe("Ac");
	});
});
