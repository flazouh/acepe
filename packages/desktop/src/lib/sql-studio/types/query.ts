export interface QueryExecutionRequest {
	readonly connectionId: string;
	readonly sql: string;
}

export interface TableExploreRequest {
	readonly connectionId: string;
	readonly schemaName: string;
	readonly tableName: string;
	readonly offset: number;
	readonly limit: number;
}

export interface TableExploreResult {
	readonly columns: readonly string[];
	readonly rows: readonly (readonly string[])[];
	readonly nextOffset: number | null;
	readonly rowCountLoaded: number;
}

export interface TableUpdateRequest {
	readonly connectionId: string;
	readonly schemaName: string;
	readonly tableName: string;
	readonly primaryKeyColumns: readonly string[];
	readonly primaryKeyValues: readonly string[];
	readonly columnName: string;
	readonly newValue: string | null;
}

export interface TableUpdateResult {
	readonly rowsAffected: number;
}

export interface QueryExecutionMessage {
	readonly level: "info" | "warning" | "error";
	readonly text: string;
}

export interface TabularResult {
	readonly columns: readonly string[];
	readonly rows: readonly (readonly string[])[];
}

export interface QueryExecutionResult {
	readonly durationMs: number;
	readonly rowCount: number;
	readonly result: TabularResult | null;
	readonly messages: readonly QueryExecutionMessage[];
}
