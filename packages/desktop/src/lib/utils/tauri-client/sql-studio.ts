import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
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

const sqlStudioCommands = TAURI_COMMAND_CLIENT.sql_studio;

export const sqlStudio = {
	listConnections: (): ResultAsync<readonly SavedConnectionSummary[], AppError> => {
		return sqlStudioCommands.list_connections.invoke<readonly SavedConnectionSummary[]>();
	},

	getConnection: (id: string): ResultAsync<SavedConnectionDetail, AppError> => {
		return sqlStudioCommands.get_connection.invoke<SavedConnectionDetail>({ id });
	},

	saveConnection: (input: ConnectionFormInput): ResultAsync<SavedConnectionSummary, AppError> => {
		return sqlStudioCommands.save_connection.invoke<SavedConnectionSummary>({ input });
	},

	deleteConnection: (id: string): ResultAsync<void, AppError> => {
		return sqlStudioCommands.delete_connection.invoke<void>({ id });
	},

	pickSqliteFile: (): ResultAsync<string | null, AppError> => {
		return sqlStudioCommands.pick_sqlite_file.invoke<string | null>();
	},

	testConnection: (id: string): ResultAsync<TestConnectionResult, AppError> => {
		return sqlStudioCommands.test_connection.invoke<TestConnectionResult>({ id });
	},

	testConnectionInput: (
		config: ConnectionFormInput
	): ResultAsync<TestConnectionResult, AppError> => {
		return sqlStudioCommands.test_connection_input.invoke<TestConnectionResult>({ config });
	},

	listSchema: (connectionId: string): ResultAsync<readonly SchemaNode[], AppError> => {
		return sqlStudioCommands.list_schema.invoke<readonly SchemaNode[]>({ id: connectionId });
	},

	executeQuery: (request: QueryExecutionRequest): ResultAsync<QueryExecutionResult, AppError> => {
		return sqlStudioCommands.execute_query.invoke<QueryExecutionResult>({ request });
	},

	exploreTable: (request: TableExploreRequest): ResultAsync<TableExploreResult, AppError> => {
		return sqlStudioCommands.explore_table.invoke<TableExploreResult>({ request });
	},

	updateTableCell: (request: TableUpdateRequest): ResultAsync<TableUpdateResult, AppError> => {
		return sqlStudioCommands.update_table_cell.invoke<TableUpdateResult>({ request });
	},
};
