import type { FileTreeRowDecoration } from "@pierre/trees";

import type { SqlSchemaInfo, SqlTableInfo } from "./types.js";

export interface SqlStudioTableSelection {
	schemaName: string;
	tableName: string;
}

export interface SqlStudioTreeModel {
	paths: readonly string[];
	selectedPath: string | null;
	tablesByPath: ReadonlyMap<string, SqlStudioTableSelection>;
	decorationsByPath: ReadonlyMap<string, FileTreeRowDecoration>;
}

export function createSqlStudioTreeModel(
	schema: readonly SqlSchemaInfo[],
	selectedSchemaName: string | null,
	selectedTableName: string | null
): SqlStudioTreeModel {
	const paths: string[] = [];
	const tablesByPath = new Map<string, SqlStudioTableSelection>();
	const decorationsByPath = new Map<string, FileTreeRowDecoration>();
	let selectedPath: string | null = null;

	for (const schemaNode of schema) {
		for (const tableNode of schemaNode.tables) {
			const tablePath = sqlStudioTablePath(schemaNode.name, tableNode.name);
			paths.push(tablePath);
			tablesByPath.set(tablePath, {
				schemaName: schemaNode.name,
				tableName: tableNode.name,
			});
			decorationsByPath.set(tablePath, tableDecoration(tableNode));

			if (schemaNode.name === selectedSchemaName && tableNode.name === selectedTableName) {
				selectedPath = tablePath;
			}

			for (const column of tableNode.columns) {
				const columnPath = `${tablePath}${column.name}`;
				paths.push(columnPath);
				decorationsByPath.set(columnPath, {
					text: column.isPrimaryKey ? `PK ${column.dataType}` : column.dataType,
					title: column.isPrimaryKey
						? `${column.name}: primary key, ${column.dataType}`
						: `${column.name}: ${column.dataType}`,
				});
			}
		}
	}

	return {
		paths,
		selectedPath,
		tablesByPath,
		decorationsByPath,
	};
}

export function sqlStudioTablePath(schemaName: string, tableName: string): string {
	return `${schemaName}/${tableName}/`;
}

function tableDecoration(table: SqlTableInfo): FileTreeRowDecoration {
	const columnLabel = table.columns.length === 1 ? "column" : "columns";
	return {
		text: `${table.columns.length}`,
		title: `${table.name}: ${table.columns.length} ${columnLabel}`,
	};
}
