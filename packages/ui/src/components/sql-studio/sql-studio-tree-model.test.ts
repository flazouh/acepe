import { describe, expect, it } from "bun:test";

import { createSqlStudioTreeModel, sqlStudioTablePath } from "./sql-studio-tree-model.js";
import type { SqlSchemaInfo } from "./types.js";

const schema: SqlSchemaInfo[] = [
	{
		name: "public",
		tables: [
			{
				name: "users",
				schema: "public",
				columns: [
					{
						name: "id",
						dataType: "uuid",
						nullable: false,
						isPrimaryKey: true,
					},
					{
						name: "email",
						dataType: "text",
						nullable: false,
						isPrimaryKey: false,
					},
				],
			},
		],
	},
];

describe("sql-studio-tree-model", () => {
	it("maps schema tables and columns to stable paths", () => {
		const model = createSqlStudioTreeModel(schema, null, null);

		expect(model.paths).toEqual(["public/users/", "public/users/id", "public/users/email"]);
		expect(model.tablesByPath.get("public/users/")).toEqual({
			schemaName: "public",
			tableName: "users",
		});
	});

	it("marks the selected table path", () => {
		const model = createSqlStudioTreeModel(schema, "public", "users");

		expect(model.selectedPath).toBe("public/users/");
	});

	it("decorates table and column rows with metadata", () => {
		const model = createSqlStudioTreeModel(schema, "public", "users");

		expect(model.decorationsByPath.get("public/users/")).toEqual({
			text: "2",
			title: "users: 2 columns",
		});
		expect(model.decorationsByPath.get("public/users/id")).toEqual({
			text: "PK uuid",
			title: "id: primary key, uuid",
		});
		expect(model.decorationsByPath.get("public/users/email")).toEqual({
			text: "text",
			title: "email: text",
		});
	});

	it("builds table paths from schema and table names", () => {
		expect(sqlStudioTablePath("main", "events")).toBe("main/events/");
	});
});
