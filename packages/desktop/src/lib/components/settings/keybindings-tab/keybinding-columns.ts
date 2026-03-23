import { createColumnHelper } from "@tanstack/table-core";

import { renderComponent } from "$lib/components/ui/data-table/index.js";
import type { Action, Keybinding } from "$lib/keybindings/types.js";
import * as m from "$lib/paraglide/messages.js";

import KeybindingCell from "./keybinding-cell.svelte";

export interface KeybindingRow {
	action: Action;
	binding: Keybinding | undefined;
	isCustom: boolean;
}

export interface ColumnHandlers {
	onEdit: (actionId: string) => void;
	onReset: (actionId: string) => void;
	isLoading: boolean;
}

const columnHelper = createColumnHelper<KeybindingRow>();

export function createKeybindingColumns(handlers: ColumnHandlers) {
	return [
		columnHelper.accessor((row) => row.action.label, {
			id: "action",
			header: () => m.settings_keybindings_action(),
			cell: (info) => info.getValue(),
		}),

		columnHelper.accessor((row) => row.binding, {
			id: "keybinding",
			header: () => m.settings_keybindings_keybinding(),
			cell: (info) =>
				renderComponent(KeybindingCell, {
					binding: info.getValue(),
					actionId: info.row.original.action.id,
					isCustom: info.row.original.isCustom,
					isLoading: handlers.isLoading,
					onEdit: handlers.onEdit,
					onReset: handlers.onReset,
				}),
		}),
	];
}
