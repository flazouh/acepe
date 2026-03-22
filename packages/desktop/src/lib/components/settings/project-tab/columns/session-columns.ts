import { createColumnHelper } from "@tanstack/table-core";
import { renderComponent } from "$lib/components/ui/data-table/index.js";

import type { SessionTableActionTarget, SessionTableRow } from "../session-table-types.js";

import ActionsCell from "./actions-cell.svelte";
import AgentCell from "./agent-cell.svelte";
import DateCell from "./date-cell.svelte";
import ProjectCell from "./project-cell.svelte";
import StatusCell from "./status-cell.svelte";

const columnHelper = createColumnHelper<SessionTableRow>();

export interface ColumnHandlers {
	onView?: (id: string) => void;
	onDelete?: (id: string) => void;
	onOpenInFinder?: (id: string, projectPath: string) => void;
	onArchive?: (session: SessionTableActionTarget) => void;
	onUnarchive?: (session: SessionTableActionTarget) => void;
}

export function createSessionColumns(handlers: ColumnHandlers) {
	return [
		columnHelper.accessor("title", {
			id: "title",
			header: () => "Title",
			cell: (info) => info.getValue(),
			enableSorting: true,
		}),

		columnHelper.accessor("projectName", {
			id: "projectName",
			header: () => "Project",
			cell: (info) =>
				renderComponent(ProjectCell, {
					name: info.getValue(),
					color: info.row.original.projectColor,
				}),
			enableSorting: true,
		}),

		columnHelper.accessor("agentId", {
			id: "agentId",
			header: () => "Agent",
			cell: (info) =>
				renderComponent(AgentCell, {
					agentId: info.getValue(),
				}),
			enableSorting: true,
		}),

		columnHelper.accessor("status", {
			id: "status",
			header: () => "Status",
			cell: (info) =>
				renderComponent(StatusCell, {
					status: info.getValue(),
					isConnected: info.row.original.isConnected,
					isStreaming: info.row.original.isStreaming,
				}),
			enableSorting: true,
		}),

		columnHelper.accessor("entryCount", {
			id: "entryCount",
			header: () => "Messages",
			cell: (info) => info.getValue().toString(),
			enableSorting: true,
		}),

		columnHelper.accessor("updatedAt", {
			id: "updatedAt",
			header: () => "Updated",
			cell: (info) =>
				renderComponent(DateCell, {
					date: info.getValue(),
				}),
			enableSorting: true,
		}),

		columnHelper.display({
			id: "actions",
			header: () => "",
			cell: (info) =>
				renderComponent(ActionsCell, {
					sessionId: info.row.original.id,
					projectPath: info.row.original.projectPath,
					agentId: info.row.original.agentId,
					onView: handlers.onView,
					onDelete: handlers.onDelete,
					onOpenInFinder: handlers.onOpenInFinder,
					onArchive: handlers.onArchive,
					onUnarchive: handlers.onUnarchive,
				}),
		}),
	];
}
