import { ok, type Result } from "neverthrow";
import { csvConfig } from "./csv.js";
import { diffConfig } from "./diff.js";
import { dockerfileConfig } from "./dockerfile.js";
import { envConfig } from "./env.js";
import { gitignoreConfig } from "./gitignore.js";
import { htmlConfig } from "./html.js";
import { httpConfig } from "./http.js";
import { imageConfig } from "./image.js";
import { iniConfig } from "./ini.js";
import { jsonConfig } from "./json.js";
import { lockfileConfig } from "./lockfile.js";
import { logConfig } from "./log.js";
import { markdownConfig } from "./markdown.js";
import { mdxConfig } from "./mdx.js";
import { ndjsonConfig } from "./ndjson.js";
import { otherConfig } from "./other.js";
import { pdfConfig } from "./pdf.js";
import { sqlConfig } from "./sql.js";
import { tomlConfig } from "./toml.js";
import { tsvConfig } from "./tsv.js";
import type {
	FilePanelDisplayOptions,
	FilePanelFormatKind,
	FormatConfig,
	StructuredData,
} from "./types.js";
import { xmlConfig } from "./xml.js";
import { yamlConfig } from "./yaml.js";

export const FORMAT_CONFIGS: FormatConfig[] = [
	gitignoreConfig,
	dockerfileConfig,
	envConfig,
	lockfileConfig,
	mdxConfig,
	markdownConfig,
	jsonConfig,
	yamlConfig,
	xmlConfig,
	tomlConfig,
	iniConfig,
	logConfig,
	ndjsonConfig,
	csvConfig,
	tsvConfig,
	sqlConfig,
	diffConfig,
	htmlConfig,
	httpConfig,
	pdfConfig,
	imageConfig,
	otherConfig,
];

function getLowercaseFileName(filePath: string): string {
	return (filePath.split("/").pop() ?? filePath).toLowerCase();
}

function getLowercaseFileExtension(filePath: string): string {
	const fileName = filePath.split("/").pop() ?? filePath;
	const dotIndex = fileName.lastIndexOf(".");
	if (dotIndex <= 0 || dotIndex >= fileName.length - 1) {
		return "";
	}

	return fileName.slice(dotIndex + 1).toLowerCase();
}

function configMatches(config: FormatConfig, fileName: string, extension: string): boolean {
	if (config.matchFile) {
		return config.matchFile(fileName, extension);
	}

	if (config.fileNames?.length) {
		const lowerNames = config.fileNames.map((n) => n.toLowerCase());
		if (lowerNames.includes(fileName)) return true;
	}

	if (config.extensions?.length) {
		const lowerExts = config.extensions.map((e) => e.toLowerCase());
		if (lowerExts.includes(extension)) return true;
	}

	return false;
}

export function getFormatKind(filePath: string): FilePanelFormatKind {
	const fileName = getLowercaseFileName(filePath);
	const extension = getLowercaseFileExtension(filePath);

	for (const config of FORMAT_CONFIGS) {
		if (configMatches(config, fileName, extension)) {
			return config.kind;
		}
	}

	return "other";
}

export function getDisplayOptions(filePath: string): FilePanelDisplayOptions {
	const formatKind = getFormatKind(filePath);
	const config = FORMAT_CONFIGS.find((c) => c.kind === formatKind);
	if (!config) {
		return {
			formatKind: "other",
			availableModes: ["raw"],
			defaultMode: "raw",
		};
	}

	return {
		formatKind: config.kind,
		availableModes: config.displayOptions.availableModes,
		defaultMode: config.displayOptions.defaultMode,
	};
}

export function getDisplayOptionsByKind(kind: FilePanelFormatKind): FilePanelDisplayOptions {
	const config = FORMAT_CONFIGS.find((c) => c.kind === kind);
	if (!config) {
		return {
			formatKind: kind,
			availableModes: ["raw"],
			defaultMode: "raw",
		};
	}

	return {
		formatKind: config.kind,
		availableModes: config.displayOptions.availableModes,
		defaultMode: config.displayOptions.defaultMode,
	};
}

export function parseStructuredContent(
	content: string,
	kind: FilePanelFormatKind
): Result<StructuredData, Error> {
	const config = FORMAT_CONFIGS.find((c) => c.kind === kind);
	if (config?.parseStructured) {
		return config.parseStructured(content);
	}

	return ok({ raw: content });
}
