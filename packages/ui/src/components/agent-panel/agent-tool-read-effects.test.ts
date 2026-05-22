import { describe, expect, test } from "bun:test";
import {
	readPersistedReadExpanded,
	writePersistedReadExpanded,
} from "./agent-tool-read-effects.js";

function createStorage(initialValue?: string) {
	const values = new Map<string, string>();
	if (initialValue !== undefined) values.set("read-key", initialValue);

	return {
		values,
		storage: {
			getItem(key: string) {
				return values.get(key) ?? null;
			},
			setItem(key: string, value: string) {
				values.set(key, value);
			},
		},
	};
}

describe("agent tool read effects", () => {
	test("defaults to expanded when storage is missing or empty", () => {
		expect(readPersistedReadExpanded(null, null)).toBe(true);
		expect(readPersistedReadExpanded("read-key", null)).toBe(true);

		const { storage } = createStorage();
		expect(readPersistedReadExpanded("read-key", storage)).toBe(true);
	});

	test("reads false as collapsed", () => {
		const { storage } = createStorage("false");

		expect(readPersistedReadExpanded("read-key", storage)).toBe(false);
	});

	test("writes expanded state as strings", () => {
		const { storage, values } = createStorage();

		writePersistedReadExpanded("read-key", false, storage);
		expect(values.get("read-key")).toBe("false");

		writePersistedReadExpanded("read-key", true, storage);
		expect(values.get("read-key")).toBe("true");
	});

	test("does not write without a storage key", () => {
		const { storage, values } = createStorage();

		writePersistedReadExpanded(null, false, storage);
		expect(values.size).toBe(0);
	});
});
