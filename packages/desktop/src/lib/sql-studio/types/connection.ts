import type { DbEngine } from "./db-engine.js";

export type ConnectionKind = "sql";

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
}

export interface SqlConnectionFormInput {
	readonly kind: "sql";
	readonly id: string | null;
	readonly name: string;
	readonly engine: DbEngine;
	readonly host: string | null;
	readonly port: number | null;
	readonly databaseName: string | null;
	readonly username: string | null;
	readonly password: string | null;
	readonly filePath: string | null;
	readonly sslMode: string | null;
}

export type ConnectionFormInput = SqlConnectionFormInput;

export interface TestConnectionResult {
	readonly ok: boolean;
	readonly message: string;
}
