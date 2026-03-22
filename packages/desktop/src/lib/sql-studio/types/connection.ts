import type { DbEngine } from "./db-engine.js";

export type ConnectionKind = "sql" | "s3";

export interface SavedConnectionSummary {
	readonly id: string;
	readonly name: string;
	readonly engine: DbEngine;
	readonly subtitle: string;
}

export interface SavedConnectionDetail extends SavedConnectionSummary {
	readonly kind: ConnectionKind;
	readonly host: string | null;
	readonly port: number | null;
	readonly databaseName: string | null;
	readonly username: string | null;
	readonly filePath: string | null;
	readonly sslMode: string | null;
	readonly s3Region: string | null;
	readonly s3EndpointUrl: string | null;
	readonly s3ForcePathStyle: boolean | null;
	readonly s3DefaultPrefix: string | null;
	readonly s3AccessKeyId: string | null;
	readonly s3SecretAccessKey: string | null;
	readonly s3SessionToken: string | null;
}

export interface SqlConnectionFormInput {
	readonly kind: "sql";
	readonly id: string | null;
	readonly name: string;
	readonly engine: Exclude<DbEngine, "s3">;
	readonly host: string | null;
	readonly port: number | null;
	readonly databaseName: string | null;
	readonly username: string | null;
	readonly password: string | null;
	readonly filePath: string | null;
	readonly sslMode: string | null;
	readonly s3Region: null;
	readonly s3EndpointUrl: null;
	readonly s3ForcePathStyle: null;
	readonly s3DefaultPrefix: null;
	readonly s3AccessKeyId: null;
	readonly s3SecretAccessKey: null;
	readonly s3SessionToken: null;
}

export interface S3ConnectionFormInput {
	readonly kind: "s3";
	readonly id: string | null;
	readonly name: string;
	readonly engine: "s3";
	readonly host: null;
	readonly port: null;
	readonly databaseName: null;
	readonly username: null;
	readonly password: null;
	readonly filePath: null;
	readonly sslMode: null;
	readonly s3Region: string;
	readonly s3EndpointUrl: string | null;
	readonly s3ForcePathStyle: boolean;
	readonly s3DefaultPrefix: string | null;
	readonly s3AccessKeyId: string;
	readonly s3SecretAccessKey: string;
	readonly s3SessionToken: string | null;
}

export type ConnectionFormInput = SqlConnectionFormInput | S3ConnectionFormInput;

export interface TestConnectionResult {
	readonly ok: boolean;
	readonly message: string;
}
