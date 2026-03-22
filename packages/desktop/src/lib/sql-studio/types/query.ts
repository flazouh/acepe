export interface QueryExecutionRequest {
	readonly connectionId: string;
	readonly sql: string;
}

export interface S3BucketNode {
	readonly name: string;
	readonly creationDate: string | null;
}

export interface S3ObjectNode {
	readonly key: string;
	readonly size: number;
	readonly lastModified: string | null;
	readonly storageClass: string | null;
	readonly isPrefix: boolean;
}

export interface S3ListObjectsRequest {
	readonly connectionId: string;
	readonly bucket: string;
	readonly prefix: string | null;
	readonly continuationToken: string | null;
	readonly limit: number | null;
}

export interface S3ListObjectsResponse {
	readonly bucket: string;
	readonly prefix: string;
	readonly objects: readonly S3ObjectNode[];
	readonly nextContinuationToken: string | null;
}

export interface S3PreviewRequest {
	readonly connectionId: string;
	readonly bucket: string;
	readonly key: string;
}

export interface S3PreviewResponse {
	readonly content: string | null;
	readonly contentType: string | null;
	readonly contentLength: number;
	readonly previewable: boolean;
	readonly reason: string | null;
}

export interface S3DownloadRequest {
	readonly connectionId: string;
	readonly bucket: string;
	readonly key: string;
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
