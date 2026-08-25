import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AppTopBarActions from "./app-top-bar-actions.svelte";
import type { AppTopBarAction } from "./types.js";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js",
	);
	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => cleanup());

describe("AppTopBarActions", () => {
	it("renders one labelled icon button per action", () => {
		const actions: readonly AppTopBarAction[] = [
			{
				id: "new-chat",
				icon: "new-chat",
				label: "New chat",
				onSelect: vi.fn(),
			},
			{ id: "search", icon: "search", label: "Search", onSelect: vi.fn() },
		];

		render(AppTopBarActions, { props: { actions } });

		expect(screen.getByLabelText("New chat")).toBe(
			screen.getByTestId("app-top-bar-action-new-chat"),
		);
		expect(screen.getByLabelText("Search").getAttribute("title")).toBe(
			"Search",
		);
	});

	it("calls the action the user clicks", () => {
		const onSelect = vi.fn();
		const actions: readonly AppTopBarAction[] = [
			{ id: "file-system", icon: "files", label: "File system", onSelect },
		];

		render(AppTopBarActions, { props: { actions } });
		screen.getByLabelText("File system").click();

		expect(onSelect).toHaveBeenCalledTimes(1);
	});
});
