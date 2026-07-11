import { readdirSync, readFileSync, statSync } from "node:fs";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { join } from "node:path";

import type { LinearCacheEntry } from "./types.js";

const INITIAL_MAGIC = 0xfcfb6d1ba7725c30n;
const FINAL_MAGIC = 0xf4fa6f45970d41d8n;
const HEADER_SIZE = 24;
const EOF_SIZE = 24;

type ParsedCacheEntry = {
	readonly urlKey: string;
	readonly contentEncoding: string;
	readonly sourceText: string;
};

function readContentEncoding(headers: Buffer): string {
	const headerFields = headers.toString("latin1").split("\0").filter(Boolean);
	for (const field of headerFields) {
		if (field.startsWith("content-encoding:")) {
			return field.slice("content-encoding:".length).trim();
		}
	}
	return "identity";
}

function decompressBody(body: Buffer, contentEncoding: string): string {
	if (contentEncoding === "br") {
		return brotliDecompressSync(body).toString("utf8");
	}

	if (contentEncoding === "gzip") {
		return gunzipSync(body).toString("utf8");
	}

	return body.toString("utf8");
}

export function parseChromiumSimpleCacheEntry(data: Buffer): ParsedCacheEntry | null {
	if (data.length < HEADER_SIZE + EOF_SIZE) {
		return null;
	}

	const magic = data.readBigUInt64LE(0);
	if (magic !== INITIAL_MAGIC) {
		return null;
	}

	const keyLength = data.readUInt32LE(12);
	const bodyStart = HEADER_SIZE + keyLength;
	if (bodyStart >= data.length) {
		return null;
	}

	let position = data.length;
	const stream0Eof = data.subarray(position - EOF_SIZE, position);
	const stream0Flags = stream0Eof.readUInt32LE(8);
	const stream0Size = stream0Eof.readUInt32LE(16);
	const stream0FinalMagic = stream0Eof.readBigUInt64LE(0);
	if (stream0FinalMagic !== FINAL_MAGIC) {
		return null;
	}

	position -= EOF_SIZE;
	if ((stream0Flags & 2) !== 0) {
		position -= 32;
	}

	if (position < stream0Size) {
		return null;
	}

	const stream0 = data.subarray(position - stream0Size, position);
	position -= stream0Size;

	const stream1Eof = data.subarray(position - EOF_SIZE, position);
	const stream1FinalMagic = stream1Eof.readBigUInt64LE(0);
	if (stream1FinalMagic !== FINAL_MAGIC) {
		return null;
	}

	position -= EOF_SIZE;
	const body = data.subarray(bodyStart, position);
	const urlKey = data.subarray(HEADER_SIZE, bodyStart).toString("utf8");
	const contentEncoding = readContentEncoding(stream0);

	let sourceText = "";
	try {
		sourceText = decompressBody(body, contentEncoding);
	} catch {
		return null;
	}

	return {
		urlKey,
		contentEncoding,
		sourceText,
	};
}

function assetNameFromUrlKey(urlKey: string): string {
	const marker = "/client/assets/";
	const markerIndex = urlKey.indexOf(marker);
	if (markerIndex === -1) {
		return urlKey;
	}
	return urlKey.slice(markerIndex + marker.length);
}

export function readLinearCacheEntries(cacheDataDir: string): LinearCacheEntry[] {
	const entries: LinearCacheEntry[] = [];

	for (const fileName of readdirSync(cacheDataDir)) {
		const filePath = join(cacheDataDir, fileName);
		if (!statSync(filePath).isFile()) {
			continue;
		}

		const parsed = parseChromiumSimpleCacheEntry(readFileSync(filePath));
		if (!parsed) {
			continue;
		}

		if (!parsed.urlKey.includes("static.linear.app/client/assets/")) {
			continue;
		}

		entries.push({
			cacheFile: fileName,
			urlKey: parsed.urlKey,
			assetName: assetNameFromUrlKey(parsed.urlKey),
			contentEncoding: parsed.contentEncoding,
			sourceText: parsed.sourceText,
		});
	}

	return entries.sort((left, right) => left.assetName.localeCompare(right.assetName));
}
