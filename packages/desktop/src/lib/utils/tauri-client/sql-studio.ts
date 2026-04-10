import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../acp/errors/app-error.js";
import type {
	ConnectionFormInput,
	QueryExecutionRequest,
	QueryExecutionResult,
	SavedConnectionDetail,
	SavedConnectionSummary,
	SchemaNode,
	TableExploreRequest,
	TableExploreResult,
	TableUpdateRequest,
	TableUpdateResult,
	TestConnectionResult,
} from "../../sql-studio/types/index.js";
import { CMD } from "./commands.js";
import { invokeAsync } from "./invoke.js";

export const sqlStudio = {
	listConnections: (): ResultAsync<readonly SavedConnectionSummary[], AppError> => {
		return invokeAsync(CMD.sqlStudio.list_connections);
	},

	getConnection: (id: string): ResultAsync<SavedConnectionDetail, AppError> => {
		return invokeAsync(CMD.sqlStudio.get_connection, { id });
	},

	saveConnection: (input: ConnectionFormInput): ResultAsync<SavedConnectionSummary, AppError> => {
		return invokeAsync(CMD.sqlStudio.save_connection, { input });
	},

	deleteConnection: (id: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.sqlStudio.delete_connection, { id });
	},

	pickSqliteFile: (): ResultAsync<string | null, AppError> => {
		return invokeAsync(CMD.sqlStudio.pick_sqlite_file);
	},

	testConnection: (id: string): ResultAsync<TestConnectionResult, AppError> => {
		return invokeAsync(CMD.sqlStudio.test_connection, { id });
	},

	testConnectionInput: (
		config: ConnectionFormInput
	): ResultAsync<TestConnectionResult, AppError> => {
		return invokeAsync(CMD.sqlStudio.test_connection_input, { config });
	},

	listSchema: (connectionId: string): ResultAsync<readonly SchemaNode[], AppError> => {
		return invokeAsync(CMD.sqlStudio.list_schema, { id: connectionId });
	},

	executeQuery: (request: QueryExecutionRequest): ResultAsync<QueryExecutionResult, AppError> => {
		return invokeAsync(CMD.sqlStudio.execute_query, { request });
	},

	exploreTable: (request: TableExploreRequest): ResultAsync<TableExploreResult, AppError> => {
		return invokeAsync(CMD.sqlStudio.explore_table, { request });
	},

	updateTableCell: (request: TableUpdateRequest): ResultAsync<TableUpdateResult, AppError> => {
		return invokeAsync(CMD.sqlStudio.update_table_cell, { request });
	},
};
