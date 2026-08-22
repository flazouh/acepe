import { expect, test } from "bun:test";

import { desktopShellKind, isElectrobunShellWindow } from "./electrobun-shell-window.ts";

test("isElectrobunShellWindow is true for the views scheme", () => {
	expect(
		isElectrobunShellWindow({
			protocol: "views:",
			search: "",
			hasElectrobunGlobal: false,
		}),
	).toBe(true);
});

test("isElectrobunShellWindow is true when the preload global exists on file urls", () => {
	expect(
		isElectrobunShellWindow({
			protocol: "file:",
			search: "",
			hasElectrobunGlobal: true,
		}),
	).toBe(true);
});

test("isElectrobunShellWindow is true for the tracer query on a web origin", () => {
	expect(
		isElectrobunShellWindow({
			protocol: "https:",
			search: "?slice=tracer",
			hasElectrobunGlobal: false,
		}),
	).toBe(true);
});

test("isElectrobunShellWindow is false for the Tauri desktop page", () => {
	expect(
		isElectrobunShellWindow({
			protocol: "https:",
			search: "",
			hasElectrobunGlobal: false,
		}),
	).toBe(false);
});

test("desktopShellKind stays pending until window facts exist", () => {
	expect(desktopShellKind(null)).toBe("pending");
});

test("desktopShellKind is electrobun for the views scheme", () => {
	expect(
		desktopShellKind({
			protocol: "views:",
			search: "",
			hasElectrobunGlobal: false,
		}),
	).toBe("electrobun");
});

test("desktopShellKind is tauri for the shipping desktop page", () => {
	expect(
		desktopShellKind({
			protocol: "https:",
			search: "",
			hasElectrobunGlobal: false,
		}),
	).toBe("tauri");
});
