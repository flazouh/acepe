import type { ResultAsync } from "neverthrow";
import { tauriClient } from "../../utils/tauri-client.js";
import type {
	ConnectionFormInput,
	QueryExecutionRequest,
	QueryExecutionResult,
	S3BucketNode,
	S3DownloadRequest,
	S3ListObjectsRequest,
	S3ListObjectsResponse,
	S3PreviewRequest,
	S3PreviewResponse,
	SavedConnectionDetail,
	SavedConnectionSummary,
	SchemaNode,
	TableExploreRequest,
	TableExploreResult,
	TableUpdateRequest,
	TableUpdateResult,
	TestConnectionResult,
} from "../types/index.js";

function mapError<T>(
	promise: ResultAsync<T, import("../../acp/errors/app-error.js").AppError>
): ResultAsync<T, Error> {
	return promise.mapErr((e) => new Error(String(e)));
}

export function listConnections(): ResultAsync<readonly SavedConnectionSummary[], Error> {
	return mapError(tauriClient.sqlStudio.listConnections());
}

export function getConnection(id: string): ResultAsync<SavedConnectionDetail, Error> {
	return mapError(tauriClient.sqlStudio.getConnection(id));
}

export function saveConnection(
	input: ConnectionFormInput
): ResultAsync<SavedConnectionSummary, Error> {
	return mapError(tauriClient.sqlStudio.saveConnection(input));
}

export function deleteConnection(id: string): ResultAsync<void, Error> {
	return mapError(tauriClient.sqlStudio.deleteConnection(id));
}

export function pickSqliteFile(): ResultAsync<string | null, Error> {
	return mapError(tauriClient.sqlStudio.pickSqliteFile());
}

export function testConnection(id: string): ResultAsync<TestConnectionResult, Error> {
	return mapError(tauriClient.sqlStudio.testConnection(id));
}

export function testConnectionInput(
	config: ConnectionFormInput
): ResultAsync<TestConnectionResult, Error> {
	return mapError(tauriClient.sqlStudio.testConnectionInput(config));
}

export function listSchema(connectionId: string): ResultAsync<readonly SchemaNode[], Error> {
	return mapError(tauriClient.sqlStudio.listSchema(connectionId));
}

export function executeQuery(
	request: QueryExecutionRequest
): ResultAsync<QueryExecutionResult, Error> {
	return mapError(tauriClient.sqlStudio.executeQuery(request));
}

export function exploreTable(request: TableExploreRequest): ResultAsync<TableExploreResult, Error> {
	return mapError(tauriClient.sqlStudio.exploreTable(request));
}

export function updateTableCell(
	request: TableUpdateRequest
): ResultAsync<TableUpdateResult, Error> {
	return mapError(tauriClient.sqlStudio.updateTableCell(request));
}

export function listS3Buckets(connectionId: string): ResultAsync<readonly S3BucketNode[], Error> {
	return mapError(tauriClient.sqlStudio.listS3Buckets(connectionId));
}

export function listS3Objects(
	request: S3ListObjectsRequest
): ResultAsync<S3ListObjectsResponse, Error> {
	return mapError(tauriClient.sqlStudio.listS3Objects(request));
}

export function previewS3Object(request: S3PreviewRequest): ResultAsync<S3PreviewResponse, Error> {
	return mapError(tauriClient.sqlStudio.previewS3Object(request));
}

export function downloadS3Object(request: S3DownloadRequest): ResultAsync<string | null, Error> {
	return mapError(tauriClient.sqlStudio.downloadS3Object(request));
}
