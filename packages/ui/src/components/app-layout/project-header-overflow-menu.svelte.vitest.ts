import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProjectHeaderOverflowMenu from "./project-header-overflow-menu.svelte";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);
	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => cleanup());

describe("ProjectHeaderOverflowMenu", () => {
	it("organizes project actions into icon-led categories", async () => {
		const onMoveUp = vi.fn();
		const onMoveDown = vi.fn();
		const onColorChange = vi.fn();
		const onChangeProjectIcon = vi.fn();
		const onRemoveProject = vi.fn();
		const onHideExternalCliSessionsChange = vi.fn();

		render(ProjectHeaderOverflowMenu, {
			props: {
				projectName: "acepe",
				currentColor: "red",
				onMoveUp,
				onMoveDown,
				onColorChange,
				onChangeProjectIcon,
				onRemoveProject,
				onHideExternalCliSessionsChange,
			},
		});

		await fireEvent.click(screen.getByLabelText("Project menu"));

		const order = screen.getByRole("menuitem", { name: "Order" });
		const visibility = screen.getByRole("menuitem", { name: "Visibility" });
		const appearance = screen.getByRole("menuitem", { name: "Appearance" });
		const project = screen.getByRole("menuitem", { name: "Project" });

		expect(order.querySelector("svg")).not.toBeNull();
		expect(visibility.querySelector("svg")).not.toBeNull();
		expect(appearance.querySelector("svg")).not.toBeNull();
		expect(project.querySelector("svg")).not.toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Move Up" })).toBeNull();

		await fireEvent.keyDown(order, { key: "ArrowRight", code: "ArrowRight" });
		await fireEvent.click(await screen.findByRole("menuitem", { name: "Move Up" }));

		expect(onMoveUp).toHaveBeenCalledTimes(1);
	});

	it("keeps session visibility under the visibility category", async () => {
		const onHideExternalCliSessionsChange = vi.fn();

		render(ProjectHeaderOverflowMenu, {
			props: {
				projectName: "acepe",
				onHideExternalCliSessionsChange,
			},
		});

		await fireEvent.click(screen.getByLabelText("Project menu"));
		await fireEvent.keyDown(screen.getByRole("menuitem", { name: "Visibility" }), {
			key: "ArrowRight",
			code: "ArrowRight",
		});
		await fireEvent.click(
			await screen.findByRole("switch", { name: "Hide external CLI sessions" })
		);

		expect(onHideExternalCliSessionsChange).toHaveBeenCalledWith(true);
	});

	it("separates appearance actions from destructive project removal", async () => {
		const onChangeProjectIcon = vi.fn();
		const onColorChange = vi.fn();
		const onRemoveProject = vi.fn();

		render(ProjectHeaderOverflowMenu, {
			props: {
				projectName: "acepe",
				currentColor: "red",
				onChangeProjectIcon,
				onColorChange,
				onRemoveProject,
			},
		});

		await fireEvent.click(screen.getByLabelText("Project menu"));
		await fireEvent.keyDown(screen.getByRole("menuitem", { name: "Appearance" }), {
			key: "ArrowRight",
			code: "ArrowRight",
		});

		expect(await screen.findByRole("menuitem", { name: "Icon..." })).not.toBeNull();
		expect(screen.getByRole("menuitem", { name: "Color" })).not.toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Remove Project" })).toBeNull();

		await fireEvent.click(screen.getByRole("menuitem", { name: "Icon..." }));
		expect(onChangeProjectIcon).toHaveBeenCalledTimes(1);

		await fireEvent.click(screen.getByLabelText("Project menu"));
		await fireEvent.keyDown(screen.getByRole("menuitem", { name: "Project" }), {
			key: "ArrowRight",
			code: "ArrowRight",
		});
		await fireEvent.click(await screen.findByRole("menuitem", { name: "Remove Project" }));
		await fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		expect(onRemoveProject).toHaveBeenCalledTimes(1);
		expect(onColorChange).not.toHaveBeenCalled();
	});
});
