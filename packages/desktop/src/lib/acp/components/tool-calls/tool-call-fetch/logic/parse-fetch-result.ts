import type { JsonValue } from "../../../../../services/converted-session-types.js";
import type {
	FetchHeaderMetadata,
	NormalizedFetchResult,
} from "../../../../types/normalized-tool-result.js";

type JsonObject = { readonly [key: string]: JsonValue };

function isJsonObject(value: JsonValue | null | undefined): value is JsonObject {
	return (
		value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
	);
}

function stringifyJsonValue(value: JsonValue | null | undefined): string | null {
	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return JSON.stringify(value, null, 2);
}

function primitiveHeaderValue(value: JsonValue | null | undefined): string | null {
	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return null;
}

function pushHeader(
	headers: FetchHeaderMetadata[],
	name: string | null | undefined,
	value: JsonValue | null | undefined
): void {
	if (name === null || name === undefined || name.length === 0) {
		return;
	}

	const normalizedValue = primitiveHeaderValue(value);
	if (normalizedValue === null) {
		return;
	}

	headers.push({
		name,
		value: normalizedValue,
	});
}

function parseHeaderArrayItem(item: JsonValue, headers: FetchHeaderMetadata[]): void {
	if (Array.isArray(item)) {
		const name = item.length > 0 && typeof item[0] === "string" ? item[0] : null;
		const value = item.length > 1 ? item[1] : null;
		pushHeader(headers, name, value);
		return;
	}

	if (!isJsonObject(item)) {
		return;
	}

	const name =
		typeof item.name === "string" ? item.name : typeof item.key === "string" ? item.key : null;
	const value = item.value ?? null;
	pushHeader(headers, name, value);
}

function parseHeaders(value: JsonValue | null | undefined): FetchHeaderMetadata[] {
	const headers: FetchHeaderMetadata[] = [];

	if (Array.isArray(value)) {
		for (const item of value) {
			parseHeaderArrayItem(item, headers);
		}
		return headers;
	}

	if (!isJsonObject(value)) {
		return headers;
	}

	for (const [name, headerValue] of Object.entries(value)) {
		pushHeader(headers, name, headerValue);
	}

	return headers;
}

function extractNumber(value: JsonValue | null | undefined): number | null {
	return typeof value === "number" ? value : null;
}

function firstDefinedBody(resultObject: JsonObject): string | null {
	const candidateValues = [
		resultObject.responseBody,
		resultObject.response_body,
		resultObject.body,
		resultObject.content,
		resultObject.detailedContent,
		resultObject.text,
	];

	for (const candidateValue of candidateValues) {
		const serialized = stringifyJsonValue(candidateValue);
		if (serialized !== null) {
			return serialized;
		}
	}

	return null;
}

function findContentType(headers: readonly FetchHeaderMetadata[]): string | null {
	for (const header of headers) {
		if (header.name.toLowerCase() === "content-type") {
			return header.value;
		}
	}

	return null;
}

export function parseFetchResult(
	result: JsonValue | null | undefined
): NormalizedFetchResult | null {
	if (result === null || result === undefined) {
		return null;
	}

	if (typeof result === "string") {
		return {
			kind: "fetch",
			responseBody: result,
			statusCode: null,
			headers: [],
			contentType: null,
		};
	}

	if (!isJsonObject(result)) {
		return null;
	}

	const headers = parseHeaders(result.headers ?? result.responseHeaders ?? result.response_headers);
	const responseBody = firstDefinedBody(result);
	const statusCode =
		extractNumber(result.statusCode) ??
		extractNumber(result.status_code) ??
		extractNumber(result.status);

	if (responseBody === null && statusCode === null && headers.length === 0) {
		return null;
	}

	return {
		kind: "fetch",
		responseBody,
		statusCode,
		headers,
		contentType: findContentType(headers),
	};
}
