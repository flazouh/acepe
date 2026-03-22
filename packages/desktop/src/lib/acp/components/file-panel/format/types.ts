import type { Result } from "neverthrow";

export type FilePanelFormatKind =
	| "markdown"
	| "mdx"
	| "json"
	| "yaml"
	| "xml"
	| "toml"
	| "ini"
	| "env"
	| "log"
	| "ndjson"
	| "csv"
	| "tsv"
	| "sql"
	| "diff"
	| "html"
	| "http"
	| "dockerfile"
	| "lockfile"
	| "gitignore"
	| "image"
	| "pdf"
	| "other";

export type FilePanelDisplayMode = "raw" | "rendered" | "structured" | "table";

export interface FilePanelDisplayOptions {
	formatKind: FilePanelFormatKind;
	availableModes: readonly FilePanelDisplayMode[];
	defaultMode: FilePanelDisplayMode;
}

export type StructuredPrimitive = string | number | boolean | null;

export type StructuredData =
	| StructuredPrimitive
	| StructuredData[]
	| {
			[key: string]: StructuredData;
	  };

export interface StructuredEntry {
	key: string;
	value: StructuredData;
}

export interface TableData {
	headers: string[];
	rows: string[][];
}

export interface FormatConfig {
	kind: FilePanelFormatKind;
	/** Extensions that map to this format (e.g. ["json"]) */
	extensions?: readonly string[];
	/** File names for exact match, case-insensitive (e.g. "Dockerfile", ".env") */
	fileNames?: readonly string[];
	/** Custom matcher when extensions/fileNames are insufficient */
	matchFile?: (fileName: string, extension: string) => boolean;
	/** Display options */
	displayOptions: {
		availableModes: readonly FilePanelDisplayMode[];
		defaultMode: FilePanelDisplayMode;
	};
	/** Parse content to StructuredData; optional - not all formats have structured parse */
	parseStructured?: (content: string) => Result<StructuredData, Error>;
}
