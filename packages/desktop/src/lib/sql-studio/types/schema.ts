export interface ColumnNode {
	readonly name: string;
	readonly dataType: string;
	readonly nullable: boolean;
	readonly isPrimaryKey: boolean;
}

export interface TableNode {
	readonly name: string;
	readonly schema: string;
	readonly columns: readonly ColumnNode[];
	readonly primaryKeyColumns: readonly string[];
}

export interface SchemaNode {
	readonly name: string;
	readonly tables: readonly TableNode[];
}
