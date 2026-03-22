/** Supported database engine types. */
export type SqlDbEngine = "postgres" | "mysql" | "sqlite" | "s3";

/** Filter comparison operators for the data grid. */
export type SqlFilterOperator = "equals" | "contains" | "starts with" | "greater than" | "less than";

/** Sort direction for the data grid. */
export type SqlSortDirection = "asc" | "desc";

/** A saved database connection as shown in the sidebar. */
export interface SqlConnection {
	id: string;
	name: string;
	engine: SqlDbEngine;
	subtitle: string;
}

/** Column metadata in the schema tree. */
export interface SqlColumnInfo {
	name: string;
	dataType: string;
	nullable: boolean;
	isPrimaryKey: boolean;
}

/** Table in the schema tree. */
export interface SqlTableInfo {
	name: string;
	schema: string;
	columns: readonly SqlColumnInfo[];
}

/** Schema group in the schema tree. */
export interface SqlSchemaInfo {
	name: string;
	tables: readonly SqlTableInfo[];
}
