import { FileTree } from "@pierre/trees";
import type {
	FileTreeCompositionOptions,
	FileTreeOptions,
	FileTreeRowDecoration,
	GitStatusEntry,
	ContextMenuItem,
	ContextMenuOpenContext,
} from "@pierre/trees";
import type { Attachment } from "svelte/attachments";

import type {
	PierreFileTreeActionItem,
	PierreFileTreeProps,
	PierreFileTreeRowAction,
} from "./pierre-file-tree-types.js";

const EMPTY_PATHS: readonly string[] = [];
const EMPTY_GIT_STATUS: readonly GitStatusEntry[] = [];
const EMPTY_ACTIONS: readonly PierreFileTreeRowAction[] = [];
const DEFAULT_ICONS: FileTreeOptions["icons"] = {
	set: "complete",
	colored: true,
};

interface PierreFileTreeRuntime {
	tree: FileTree;
	props: PierreFileTreeProps;
	syncingSelection: boolean;
}

interface PierreFileTreeRuntimeRef {
	current: PierreFileTreeRuntime | null;
}

export function createPierreFileTreeAttachment(
	readProps: () => PierreFileTreeProps,
): Attachment<HTMLElement> {
	return (node) => {
		let runtime: PierreFileTreeRuntime | null = null;

		$effect(() => {
			const nextProps = normalizeProps(readProps());

			if (!runtime) {
				runtime = mountTree(node, nextProps);
				return;
			}

			if (mustRecreateTree(runtime.props, nextProps)) {
				runtime.tree.cleanUp();
				runtime = mountTree(node, nextProps);
				return;
			}

			updateTree(runtime, nextProps);
		});

		return () => {
			if (runtime) {
				runtime.tree.cleanUp();
				runtime = null;
			}
		};
	};
}

function normalizeProps(props: PierreFileTreeProps): PierreFileTreeProps {
	return {
		paths: props.paths ?? EMPTY_PATHS,
		selectedPath: props.selectedPath,
		selectedPaths: props.selectedPaths,
		onSelectionChange: props.onSelectionChange,
		gitStatus: props.gitStatus ?? EMPTY_GIT_STATUS,
		icons: props.icons,
		rowActions: props.rowActions,
		rowDecoration: props.rowDecoration,
		contextMenuTriggerMode: props.contextMenuTriggerMode ?? "both",
		contextMenuButtonVisibility:
			props.contextMenuButtonVisibility ?? "when-needed",
		initialExpansion: props.initialExpansion ?? "closed",
		initialExpandedPaths: props.initialExpandedPaths,
		flattenEmptyDirectories: props.flattenEmptyDirectories ?? true,
		density: props.density ?? "compact",
		itemHeight: props.itemHeight,
		overscan: props.overscan,
		stickyFolders: props.stickyFolders,
		revealPath: props.revealPath,
		unsafeCSS: props.unsafeCSS,
		id: props.id,
		class: props.class,
		testId: props.testId,
		ariaLabel: props.ariaLabel,
	};
}

function mountTree(
	node: HTMLElement,
	props: PierreFileTreeProps,
): PierreFileTreeRuntime {
	const runtimeRef: PierreFileTreeRuntimeRef = { current: null };
	const tree = new FileTree(createTreeOptionsForRuntime(runtimeRef, props));
	const runtime: PierreFileTreeRuntime = {
		tree,
		props,
		syncingSelection: false,
	};

	runtimeRef.current = runtime;
	runtime.tree.render({ containerWrapper: node });
	syncControlledSelection(runtime, props);
	revealPath(runtime.tree, props.revealPath);

	return runtime;
}

function createTreeOptionsForRuntime(
	runtimeRef: PierreFileTreeRuntimeRef,
	props: PierreFileTreeProps,
): FileTreeOptions {
	return {
		paths: props.paths,
		gitStatus: props.gitStatus,
		icons: props.icons ?? DEFAULT_ICONS,
		composition: createComposition(runtimeRef, props),
		renderRowDecoration: (context) => {
			if (!runtimeRef.current) {
				return null;
			}
			return renderDecoration(runtimeRef.current.props, context.item);
		},
		onSelectionChange: (selectedPaths) => {
			if (!runtimeRef.current || runtimeRef.current.syncingSelection) {
				return;
			}
			runtimeRef.current.props.onSelectionChange?.(selectedPaths);
		},
		initialSelectedPaths: controlledSelectedPaths(props),
		initialExpansion: props.initialExpansion,
		initialExpandedPaths: props.initialExpandedPaths,
		flattenEmptyDirectories: props.flattenEmptyDirectories,
		search: false,
		fileTreeSearchMode: "expand-matches",
		initialSearchQuery: undefined,
		searchBlurBehavior: "retain",
		density: props.density,
		itemHeight: props.itemHeight,
		overscan: props.overscan,
		stickyFolders: props.stickyFolders,
		unsafeCSS: props.unsafeCSS,
		id: props.id,
	};
}

function updateTree(
	runtime: PierreFileTreeRuntime,
	nextProps: PierreFileTreeProps,
): void {
	const previousProps = runtime.props;
	runtime.props = nextProps;

	if (!sameStringArray(previousProps.paths, nextProps.paths)) {
		runtime.tree.resetPaths(nextProps.paths, {
			initialExpandedPaths: nextProps.initialExpandedPaths,
		});
	}

	if (!sameGitStatusEntries(previousProps.gitStatus, nextProps.gitStatus)) {
		runtime.tree.setGitStatus(nextProps.gitStatus);
	}

	if (previousProps.icons !== nextProps.icons) {
		runtime.tree.setIcons(nextProps.icons ?? DEFAULT_ICONS);
	}

	if (
		previousProps.rowActions !== nextProps.rowActions ||
		previousProps.contextMenuTriggerMode !== nextProps.contextMenuTriggerMode ||
		previousProps.contextMenuButtonVisibility !==
			nextProps.contextMenuButtonVisibility
	) {
		runtime.tree.setComposition(createComposition(runtime));
	}

	syncControlledSelection(runtime, nextProps);
	revealPath(runtime.tree, nextProps.revealPath);
}

function mustRecreateTree(
	previousProps: PierreFileTreeProps,
	nextProps: PierreFileTreeProps,
): boolean {
	return (
		previousProps.unsafeCSS !== nextProps.unsafeCSS ||
		previousProps.flattenEmptyDirectories !==
			nextProps.flattenEmptyDirectories ||
		previousProps.initialExpansion !== nextProps.initialExpansion ||
		!sameStringArray(
			previousProps.initialExpandedPaths,
			nextProps.initialExpandedPaths,
		) ||
		previousProps.density !== nextProps.density ||
		previousProps.itemHeight !== nextProps.itemHeight ||
		previousProps.overscan !== nextProps.overscan ||
		previousProps.stickyFolders !== nextProps.stickyFolders ||
		previousProps.id !== nextProps.id
	);
}

function syncControlledSelection(
	runtime: PierreFileTreeRuntime,
	props: PierreFileTreeProps,
): void {
	const targetPaths = controlledSelectedPaths(props);
	const currentPaths = runtime.tree.getSelectedPaths();
	const targetPathSet = new Set(targetPaths);
	const currentPathSet = new Set(currentPaths);

	runtime.syncingSelection = true;

	for (const path of currentPaths) {
		if (!targetPathSet.has(path)) {
			runtime.tree.getItem(path)?.deselect();
		}
	}

	for (const path of targetPaths) {
		if (currentPathSet.has(path)) {
			continue;
		}
		runtime.tree.getItem(path)?.select();
	}

	runtime.syncingSelection = false;
}

function controlledSelectedPaths(
	props: PierreFileTreeProps,
): readonly string[] {
	if (props.selectedPaths) {
		return props.selectedPaths.filter((path) => path.length > 0);
	}

	if (props.selectedPath && props.selectedPath.length > 0) {
		return [props.selectedPath];
	}

	return EMPTY_PATHS;
}

function revealPath(tree: FileTree, path: string | null | undefined): void {
	if (!path || !tree.getItem(path)) {
		return;
	}

	tree.scrollToPath(path, { focus: false, offset: "nearest" });
}

function createComposition(
	runtime: PierreFileTreeRuntime | PierreFileTreeRuntimeRef,
	initialProps?: PierreFileTreeProps,
): FileTreeCompositionOptions | undefined {
	const props = getRuntimeProps(runtime) ?? initialProps ?? null;

	if (!props?.rowActions) {
		return undefined;
	}

	return {
		contextMenu: {
			enabled: true,
			triggerMode: props.contextMenuTriggerMode,
			buttonVisibility: props.contextMenuButtonVisibility,
			render: (item, context) => {
				const currentProps = getRuntimeProps(runtime);
				if (!currentProps) {
					return null;
				}
				return renderActionMenu(currentProps, item, context);
			},
		},
	};
}

function getRuntimeProps(
	runtime: PierreFileTreeRuntime | PierreFileTreeRuntimeRef,
): PierreFileTreeProps | null {
	if ("current" in runtime) {
		return runtime.current?.props ?? null;
	}

	return runtime.props;
}

function renderDecoration(
	props: PierreFileTreeProps,
	item: ContextMenuItem,
): FileTreeRowDecoration | null {
	if (!props.rowDecoration) {
		return null;
	}

	return props.rowDecoration(toActionItem(item));
}

function renderActionMenu(
	props: PierreFileTreeProps,
	item: ContextMenuItem,
	context: ContextMenuOpenContext,
): HTMLElement | null {
	const actions = resolveActions(props, item);

	if (actions.length === 0) {
		return null;
	}

	const menu = document.createElement("div");
	menu.setAttribute("role", "menu");
	menu.setAttribute("aria-label", `Actions for ${item.name}`);
	menu.style.display = "flex";
	menu.style.flexDirection = "column";
	menu.style.minWidth = "148px";
	menu.style.padding = "4px";
	menu.style.borderRadius = "8px";
	menu.style.border = "1px solid hsl(var(--border, 220 13% 91%))";
	menu.style.background = "hsl(var(--popover, 0 0% 100%))";
	menu.style.color = "hsl(var(--popover-foreground, 222.2 84% 4.9%))";
	menu.style.boxShadow = "0 12px 32px rgba(15, 23, 42, 0.18)";
	menu.style.gap = "2px";

	for (const action of actions) {
		menu.appendChild(createActionButton(action, item, context));
	}

	return menu;
}

function createActionButton(
	action: PierreFileTreeRowAction,
	item: ContextMenuItem,
	context: ContextMenuOpenContext,
): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.disabled = Boolean(action.disabled);
	button.setAttribute("role", "menuitem");
	button.setAttribute("data-pierre-tree-action-id", action.id);
	button.title = action.title ?? action.label;
	button.style.display = "flex";
	button.style.alignItems = "center";
	button.style.gap = "8px";
	button.style.width = "100%";
	button.style.border = "0";
	button.style.borderRadius = "6px";
	button.style.background = "transparent";
	button.style.color = action.destructive
		? "hsl(var(--destructive, 0 84.2% 60.2%))"
		: "currentColor";
	button.style.cursor = action.disabled ? "not-allowed" : "pointer";
	button.style.font = "inherit";
	button.style.fontSize = "12px";
	button.style.lineHeight = "16px";
	button.style.padding = "5px 8px";
	button.style.textAlign = "left";

	if (action.iconText) {
		const icon = document.createElement("span");
		icon.textContent = action.iconText;
		icon.setAttribute("aria-hidden", "true");
		icon.style.width = "14px";
		icon.style.textAlign = "center";
		button.appendChild(icon);
	}

	const label = document.createElement("span");
	label.textContent = action.label;
	button.appendChild(label);

	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();

		if (action.disabled) {
			return;
		}

		context.close({ restoreFocus: true });
		action.onSelect(item.path);
	});

	return button;
}

function resolveActions(
	props: PierreFileTreeProps,
	item: ContextMenuItem,
): readonly PierreFileTreeRowAction[] {
	if (!props.rowActions) {
		return EMPTY_ACTIONS;
	}

	if (typeof props.rowActions === "function") {
		return props.rowActions(toActionItem(item));
	}

	return props.rowActions;
}

function toActionItem(item: ContextMenuItem): PierreFileTreeActionItem {
	return {
		kind: item.kind,
		name: item.name,
		path: item.path,
	};
}

function sameStringArray(
	left: readonly string[] | undefined,
	right: readonly string[] | undefined,
): boolean {
	const leftValues = left ?? EMPTY_PATHS;
	const rightValues = right ?? EMPTY_PATHS;

	if (leftValues.length !== rightValues.length) {
		return false;
	}

	for (let index = 0; index < leftValues.length; index += 1) {
		if (leftValues[index] !== rightValues[index]) {
			return false;
		}
	}

	return true;
}

function sameGitStatusEntries(
	left: readonly GitStatusEntry[] | undefined,
	right: readonly GitStatusEntry[] | undefined,
): boolean {
	const leftValues = left ?? EMPTY_GIT_STATUS;
	const rightValues = right ?? EMPTY_GIT_STATUS;

	if (leftValues.length !== rightValues.length) {
		return false;
	}

	for (let index = 0; index < leftValues.length; index += 1) {
		const leftEntry = leftValues[index];
		const rightEntry = rightValues[index];
		if (
			leftEntry?.path !== rightEntry?.path ||
			leftEntry?.status !== rightEntry?.status
		) {
			return false;
		}
	}

	return true;
}
