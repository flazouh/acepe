import { describe, expect, it } from "bun:test";

import {
	DEFAULT_APP_ID,
	DEFAULT_PORT,
	resolveDevInstance,
	sanitizeInstanceId,
} from "./dev-instance.ts";

const primaryRoot = "/Users/alex/Documents/acepe";

function forWorktree(path: string) {
	return resolveDevInstance({ checkoutRoot: path, primaryRoot });
}

describe("dev instance identity", () => {
	it("keeps the historical port and app id for the primary checkout", () => {
		const instance = resolveDevInstance({
			checkoutRoot: primaryRoot,
			primaryRoot,
		});

		expect(instance.port).toBe(DEFAULT_PORT);
		expect(instance.appId).toBe(DEFAULT_APP_ID);
		expect(instance.isPrimary).toBe(true);
	});

	it("gives a worktree its own port, app id, label and log", () => {
		const instance = forWorktree(
			"/Users/alex/Documents/acepe/.worktrees/reveal-fix",
		);

		expect(instance.port).not.toBe(DEFAULT_PORT);
		expect(instance.appId).toBe("com.acepe.app.reveal-fix");
		expect(instance.launchdLabel).toBe("acepe.vite.reveal-fix");
		expect(instance.viteLogPath).toBe("/tmp/acepe-vite-reveal-fix.log");
		expect(instance.isPrimary).toBe(false);
	});

	it("returns the same port every time for the same worktree", () => {
		const path = "/Users/alex/Documents/acepe/.worktrees/model-discovery";

		expect(forWorktree(path).port).toBe(forWorktree(path).port);
	});

	it("keeps two worktrees off each other's port", () => {
		const a = forWorktree("/Users/alex/Documents/acepe/.worktrees/alpha");
		const b = forWorktree("/Users/alex/Documents/acepe/.worktrees/beta");

		expect(a.port).not.toBe(b.port);
		expect(a.appId).not.toBe(b.appId);
	});

	it("never hands a worktree the primary's port", () => {
		const ports = Array.from(
			{ length: 200 },
			(_, index) =>
				forWorktree(`/Users/alex/Documents/acepe/.worktrees/w${String(index)}`)
					.port,
		);

		expect(ports.every((port) => port !== DEFAULT_PORT)).toBe(true);
		expect(ports.every((port) => port > DEFAULT_PORT && port < 1520)).toBe(
			true,
		);
	});

	it("makes a messy directory name safe for a socket and a launchd label", () => {
		expect(sanitizeInstanceId("Feature/AC-123 Fix!")).toBe(
			"feature-ac-123-fix",
		);
		expect(sanitizeInstanceId("")).toBe("worktree");
	});
});
