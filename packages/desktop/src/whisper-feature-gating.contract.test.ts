import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const cargoTomlPath = resolve(import.meta.dir, "../src-tauri/Cargo.toml");
const source = readFileSync(cargoTomlPath, "utf8");

describe("whisper feature gating contract", () => {
	it("keeps Metal enabled by default but lets packaged builds disable it with --no-default-features", () => {
		expect(source).toContain('default = ["whisper-metal"]');
		expect(source).not.toContain(
			'whisper-rs = { version = "=0.16.0", features = ["metal"] }'
		);
		expect(source).toContain('whisper-metal = ["whisper-rs/metal"]');
	});
});
