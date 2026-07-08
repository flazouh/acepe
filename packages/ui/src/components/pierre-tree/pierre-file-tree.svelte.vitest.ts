import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import PierreFileTree from "./pierre-file-tree.svelte";
import type {
	ContextMenuItem,
	ContextMenuOpenContext,
	FileTreeCompositionOptions,
	FileTreeOptions,
	FileTreeRowDecoration,
	FileTreeRowDecorationContext,
	GitStatusEntry,
} from "@pierre/trees";

interface MockFileTreeApi {
	paths: string[];
	selectedPaths: string[];
	gitStatus: readonly GitStatusEntry[] | undefined;
	icons: FileTreeOptions["icons"];
	initialExpansion: FileTreeOptions["initialExpansion"];
	initialExpandedPaths: FileTreeOptions["initialExpandedPaths"];
	density: FileTreeOptions["density"];
	search: FileTreeOptions["search"];
	fileTreeSearchMode: FileTreeOptions["fileTreeSearchMode"];
	initialSearchQuery: FileTreeOptions["initialSearchQuery"];
	searchBlurBehavior: FileTreeOptions["searchBlurBehavior"];
	searchFakeFocus: FileTreeOptions["searchFakeFocus"];
	searchOpen: boolean;
	composition: FileTreeCompositionOptions | undefined;
	renderRowDecoration: FileTreeOptions["renderRowDecoration"];
	cleaned: boolean;
	renderContainer: HTMLElement | undefined;
	readonly resetCalls: string[][];
	readonly gitStatusCalls: Array<readonly GitStatusEntry[] | undefined>;
	readonly scrollCalls: string[];
	onSelectionChange: FileTreeOptions["onSelectionChange"];
	onSearchChange: FileTreeOptions["onSearchChange"];
	render: (input: { containerWrapper?: HTMLElement }) => void;
	cleanUp: () => void;
	getSelectedPaths: () => readonly string[];
	emitSelection: (selectedPaths: readonly string[]) => void;
	openSearch: (initialValue?: string) => void;
	closeSearch: () => void;
	isSearchOpen: () => boolean;
}

const mockState = vi.hoisted(() => {
	return {
		trees: [] as MockFileTreeApi[],
	};
});

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

vi.mock("@pierre/trees", () => {
	class MockItemHandle {
		readonly tree: MockFileTree;
		readonly path: string;

		constructor(tree: MockFileTree, path: string) {
			this.tree = tree;
			this.path = path;
		}

		deselect(): void {
			this.tree.deselectPath(this.path);
		}

		focus(): void {}

		getPath(): string {
			return this.path;
		}

		isFocused(): boolean {
			return false;
		}

		isDirectory(): boolean {
			return false;
		}

		isSelected(): boolean {
			return this.tree.selectedPaths.includes(this.path);
		}

		select(): void {
			this.tree.selectPath(this.path);
		}

		toggleSelect(): void {
			if (this.isSelected()) {
				this.deselect();
				return;
			}

			this.select();
		}
	}

	class MockFileTree implements MockFileTreeApi {
		paths: string[];
		selectedPaths: string[];
		gitStatus: readonly GitStatusEntry[] | undefined;
		icons: FileTreeOptions["icons"];
		initialExpansion: FileTreeOptions["initialExpansion"];
		initialExpandedPaths: FileTreeOptions["initialExpandedPaths"];
		density: FileTreeOptions["density"];
		search: FileTreeOptions["search"];
		fileTreeSearchMode: FileTreeOptions["fileTreeSearchMode"];
		initialSearchQuery: FileTreeOptions["initialSearchQuery"];
		searchBlurBehavior: FileTreeOptions["searchBlurBehavior"];
		searchFakeFocus: FileTreeOptions["searchFakeFocus"];
		searchOpen = false;
		composition: FileTreeCompositionOptions | undefined;
		renderRowDecoration: FileTreeOptions["renderRowDecoration"];
		cleaned = false;
		renderContainer: HTMLElement | undefined;
		readonly resetCalls: string[][] = [];
		readonly gitStatusCalls: Array<readonly GitStatusEntry[] | undefined> = [];
		readonly scrollCalls: string[] = [];
		onSelectionChange: FileTreeOptions["onSelectionChange"];
		onSearchChange: FileTreeOptions["onSearchChange"];

		constructor(options: FileTreeOptions) {
			this.paths = Array.from(options.paths ?? []);
			this.selectedPaths = Array.from(options.initialSelectedPaths ?? []);
			this.gitStatus = options.gitStatus;
			this.icons = options.icons;
			this.initialExpansion = options.initialExpansion;
			this.initialExpandedPaths = options.initialExpandedPaths;
			this.density = options.density;
			this.search = options.search;
			this.fileTreeSearchMode = options.fileTreeSearchMode;
			this.initialSearchQuery = options.initialSearchQuery;
			this.searchBlurBehavior = options.searchBlurBehavior;
			this.searchFakeFocus = options.searchFakeFocus;
			this.composition = options.composition;
			this.renderRowDecoration = options.renderRowDecoration;
			this.onSelectionChange = options.onSelectionChange;
			this.onSearchChange = options.onSearchChange;
			mockState.trees.push(this);
		}

		render(input: { containerWrapper?: HTMLElement }): void {
			this.renderContainer = input.containerWrapper;
		}

		cleanUp(): void {
			this.cleaned = true;
		}

		getItem(path: string): MockItemHandle | null {
			if (!this.paths.includes(path)) {
				return null;
			}

			return new MockItemHandle(this, path);
		}

		getSelectedPaths(): readonly string[] {
			return this.selectedPaths;
		}

		resetPaths(paths: readonly string[]): void {
			this.paths = Array.from(paths);
			this.resetCalls.push(Array.from(paths));
			this.selectedPaths = this.selectedPaths.filter((path) =>
				this.paths.includes(path),
			);
		}

		setComposition(composition?: FileTreeCompositionOptions): void {
			this.composition = composition;
		}

		setGitStatus(gitStatus?: readonly GitStatusEntry[]): void {
			this.gitStatus = gitStatus;
			this.gitStatusCalls.push(gitStatus);
		}

		setIcons(icons?: FileTreeOptions["icons"]): void {
			this.icons = icons;
		}

		scrollToPath(path: string): void {
			this.scrollCalls.push(path);
		}

		selectPath(path: string): void {
			if (!this.selectedPaths.includes(path)) {
				this.selectedPaths = this.selectedPaths.concat(path);
			}

			this.onSelectionChange?.(this.selectedPaths);
		}

		deselectPath(path: string): void {
			this.selectedPaths = this.selectedPaths.filter(
				(selectedPath) => selectedPath !== path,
			);
			this.onSelectionChange?.(this.selectedPaths);
		}

		emitSelection(selectedPaths: readonly string[]): void {
			this.selectedPaths = Array.from(selectedPaths);
			this.onSelectionChange?.(this.selectedPaths);
		}

		openSearch(initialValue?: string): void {
			this.searchOpen = true;
			this.initialSearchQuery = initialValue ?? this.initialSearchQuery;
		}

		closeSearch(): void {
			this.searchOpen = false;
		}

		isSearchOpen(): boolean {
			return this.searchOpen;
		}
	}

	return {
		FileTree: MockFileTree,
	};
});

afterEach(() => {
	cleanup();
	mockState.trees.length = 0;
	vi.restoreAllMocks();
});

function firstTree(): MockFileTreeApi {
	const tree = mockState.trees[0];
	if (!tree) {
		throw new Error("expected a Pierre tree instance");
	}

	return tree;
}

function menuContext(): ContextMenuOpenContext {
	return {
		anchorElement: document.createElement("button"),
		anchorRect: {
			bottom: 0,
			height: 0,
			left: 0,
			right: 0,
			top: 0,
			width: 0,
			x: 0,
			y: 0,
		},
		close: vi.fn(),
		restoreFocus: vi.fn(),
	};
}

function fileItem(path: string): ContextMenuItem {
	return {
		kind: "file",
		name: path.split("/").pop() ?? path,
		path,
	};
}

function decorationContext(path: string): FileTreeRowDecorationContext {
	return {
		item: fileItem(path),
		row: {
			ancestorPaths: [],
			depth: 0,
			hasChildren: false,
			index: 0,
			isExpanded: false,
			isFlattened: false,
			isFocused: false,
			isSelected: false,
			kind: "file",
			level: 1,
			name: path,
			path,
			posInSet: 1,
			setSize: 1,
		},
	};
}

describe("PierreFileTree", () => {
	it("mounts Pierre into the host and cleans it up on unmount", async () => {
		const view = render(PierreFileTree, {
			props: {
				paths: ["src/app.ts"],
				selectedPath: "src/app.ts",
			},
		});

		await waitFor(() => {
			expect(mockState.trees).toHaveLength(1);
		});

		const tree = firstTree();
		expect(tree.renderContainer).toBe(
			view.container.querySelector("[data-pierre-tree-host]"),
		);
		expect(tree.getSelectedPaths()).toEqual(["src/app.ts"]);

		view.unmount();

		expect(tree.cleaned).toBe(true);
	});

	it("uses compact collapsed defaults with complete icons and hidden search", async () => {
		render(PierreFileTree, {
			props: {
				paths: ["src/app.ts"],
			},
		});

		await waitFor(() => {
			expect(mockState.trees).toHaveLength(1);
		});

		const tree = firstTree();
		expect(tree.initialExpansion).toBe("closed");
		expect(tree.density).toBe("compact");
		expect(tree.search).toBe(false);
		expect(tree.searchOpen).toBe(false);
		expect(tree.fileTreeSearchMode).toBe("expand-matches");
		expect(tree.icons).toEqual({
			set: "complete",
			colored: true,
		});
	});

	it("allows tree feature defaults to be adjusted by props", async () => {
		render(PierreFileTree, {
			props: {
				paths: ["src/app.ts"],
				initialExpansion: "open",
				density: "relaxed",
				icons: "minimal",
			},
		});

		await waitFor(() => {
			expect(mockState.trees).toHaveLength(1);
		});

		const tree = firstTree();
		expect(tree.initialExpansion).toBe("open");
		expect(tree.density).toBe("relaxed");
		expect(tree.search).toBe(false);
		expect(tree.fileTreeSearchMode).toBe("expand-matches");
		expect(tree.initialSearchQuery ?? null).toBeNull();
		expect(tree.icons).toBe("minimal");
	});

	async function openSettingsMenu(): Promise<void> {
		const settingsButton = screen.getByRole("button", {
			name: "File tree settings",
		});
		await fireEvent.pointerDown(settingsButton);
		await waitFor(() => {
			expect(
				document.querySelector("[data-pierre-tree-control='density-compact']"),
			).not.toBeNull();
		});
	}

	it("keeps search UI removed from the tree settings menu", async () => {
		const view = render(PierreFileTree, {
			props: {
				paths: ["src/app.ts"],
			},
		});

		await waitFor(() => {
			expect(mockState.trees).toHaveLength(1);
		});
		expect(firstTree().search).toBe(false);

		expect(view.queryByRole("button", { name: "Search" })).toBeNull();
		expect(document.querySelector("[data-file-tree-search-input]")).toBeNull();

		await openSettingsMenu();
		expect(
			document.querySelector("[data-pierre-tree-control='search']"),
		).toBeNull();
		expect(document.querySelector("[data-file-tree-search-input]")).toBeNull();
		expect(mockState.trees).toHaveLength(1);
	});

	it("updates density and expansion from the tree settings menu", async () => {
		const view = render(PierreFileTree, {
			props: {
				paths: ["src/app.ts"],
			},
		});

		await waitFor(() => {
			expect(mockState.trees).toHaveLength(1);
		});

		await openSettingsMenu();
		const defaultDensityItem = document.querySelector<HTMLElement>(
			"[data-pierre-tree-control='density-default']",
		);
		if (!defaultDensityItem) {
			throw new Error("expected default density item");
		}
		await fireEvent.click(defaultDensityItem);
		await waitFor(() => {
			expect(mockState.trees).toHaveLength(2);
		});
		expect(mockState.trees[1]?.density).toBe("default");

		await openSettingsMenu();
		const expandItem = document.querySelector<HTMLElement>(
			"[data-pierre-tree-control='expand']",
		);
		if (!expandItem) {
			throw new Error("expected expand item");
		}
		await fireEvent.click(expandItem);
		await waitFor(() => {
			expect(mockState.trees).toHaveLength(3);
		});
		expect(mockState.trees[2]?.initialExpansion).toBe("open");

		await openSettingsMenu();
		const collapseItem = document.querySelector<HTMLElement>(
			"[data-pierre-tree-control='collapse']",
		);
		if (!collapseItem) {
			throw new Error("expected collapse item");
		}
		await fireEvent.click(collapseItem);
		await waitFor(() => {
			expect(mockState.trees).toHaveLength(4);
		});
		expect(mockState.trees[3]?.initialExpansion).toBe("closed");
	});

	it("remounts when constructor-only feature options change", async () => {
		const view = render(PierreFileTree, {
			props: {
				paths: ["src/app.ts"],
			},
		});

		await waitFor(() => {
			expect(mockState.trees).toHaveLength(1);
		});

		const first = firstTree();

		await view.rerender({
			paths: ["src/app.ts"],
			density: "relaxed",
		});

		await waitFor(() => {
			expect(mockState.trees).toHaveLength(2);
		});
		expect(first.cleaned).toBe(true);
		expect(mockState.trees[1]?.density).toBe("relaxed");
	});

	it("remounts when initial expanded paths change", async () => {
		const view = render(PierreFileTree, {
			props: {
				paths: ["src/a.ts"],
				initialExpandedPaths: ["src/"],
			},
		});

		await waitFor(() => {
			expect(mockState.trees).toHaveLength(1);
		});

		const first = firstTree();

		await view.rerender({
			paths: ["src/a.ts"],
			initialExpandedPaths: ["src/", "src/app/"],
		});

		await waitFor(() => {
			expect(mockState.trees).toHaveLength(2);
		});
		expect(first.cleaned).toBe(true);
		expect(mockState.trees[1]?.initialExpandedPaths).toEqual([
			"src/",
			"src/app/",
		]);
	});

	it("syncs controlled selection after rerender without notifying selection changes", async () => {
		const onSelectionChange = vi.fn();
		const view = render(PierreFileTree, {
			props: {
				paths: ["src/a.ts", "src/b.ts"],
				selectedPath: "src/a.ts",
				onSelectionChange,
			},
		});

		await waitFor(() => {
			expect(firstTree().getSelectedPaths()).toEqual(["src/a.ts"]);
		});
		expect(onSelectionChange).not.toHaveBeenCalled();

		await view.rerender({
			paths: ["src/a.ts", "src/b.ts"],
			selectedPath: "src/b.ts",
			onSelectionChange,
		});

		await waitFor(() => {
			expect(firstTree().getSelectedPaths()).toEqual(["src/b.ts"]);
		});
		expect(onSelectionChange).not.toHaveBeenCalled();

		firstTree().emitSelection(["src/a.ts"]);
		expect(onSelectionChange).toHaveBeenCalledWith(["src/a.ts"]);
	});

	it("resets paths and clears a selected path that no longer exists", async () => {
		const view = render(PierreFileTree, {
			props: {
				paths: ["src/a.ts"],
				selectedPath: "src/a.ts",
			},
		});

		await waitFor(() => {
			expect(firstTree().getSelectedPaths()).toEqual(["src/a.ts"]);
		});

		await view.rerender({
			paths: ["src/b.ts"],
			selectedPath: "src/a.ts",
		});

		await waitFor(() => {
			expect(firstTree().resetCalls).toEqual([["src/b.ts"]]);
		});
		expect(firstTree().getSelectedPaths()).toEqual([]);
	});

	it("updates git status without remounting the tree", async () => {
		const initialStatus: readonly GitStatusEntry[] = [
			{ path: "src/a.ts", status: "modified" },
		];
		const nextStatus: readonly GitStatusEntry[] = [
			{ path: "src/a.ts", status: "added" },
		];
		const view = render(PierreFileTree, {
			props: {
				paths: ["src/a.ts"],
				gitStatus: initialStatus,
			},
		});

		await waitFor(() => {
			expect(mockState.trees).toHaveLength(1);
		});

		await view.rerender({
			paths: ["src/a.ts"],
			gitStatus: nextStatus,
		});

		expect(mockState.trees).toHaveLength(1);
		expect(firstTree().gitStatusCalls).toEqual([nextStatus]);
	});

	it("keeps row decoration callbacks live across rerenders", async () => {
		const firstDecoration = vi.fn(
			(): FileTreeRowDecoration => ({ text: "+1 -0" }),
		);
		const secondDecoration = vi.fn(
			(): FileTreeRowDecoration => ({ text: "+2 -1" }),
		);
		const view = render(PierreFileTree, {
			props: {
				paths: ["src/a.ts"],
				rowDecoration: firstDecoration,
			},
		});

		await waitFor(() => {
			expect(firstTree().renderRowDecoration).toBeDefined();
		});

		expect(
			firstTree().renderRowDecoration?.(decorationContext("src/a.ts")),
		).toEqual({
			text: "+1 -0",
		});

		await view.rerender({
			paths: ["src/a.ts"],
			rowDecoration: secondDecoration,
		});

		expect(
			firstTree().renderRowDecoration?.(decorationContext("src/a.ts")),
		).toEqual({
			text: "+2 -1",
		});
		expect(firstDecoration).toHaveBeenCalledOnce();
		expect(secondDecoration).toHaveBeenCalledOnce();
	});

	it("renders action menu items that call action callbacks", async () => {
		const onStage = vi.fn();
		render(PierreFileTree, {
			props: {
				paths: ["src/a.ts"],
				rowActions: [
					{
						id: "stage",
						label: "Stage",
						onSelect: onStage,
					},
				],
			},
		});

		await waitFor(() => {
			expect(firstTree().composition?.contextMenu?.render).toBeDefined();
		});

		const menu = firstTree().composition?.contextMenu?.render?.(
			fileItem("src/a.ts"),
			menuContext(),
		);

		if (!menu) {
			throw new Error("expected context menu");
		}

		const button = menu.querySelector<HTMLButtonElement>(
			"[data-pierre-tree-action-id='stage']",
		);
		if (!button) {
			throw new Error("expected action button");
		}

		button.click();

		expect(onStage).toHaveBeenCalledWith("src/a.ts");
	});
});
