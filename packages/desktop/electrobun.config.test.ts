import { expect, test } from "bun:test";
import { makeElectrobunConfig } from "@acepe/electrobun-shell";
import config from "./electrobun.config.ts";

test("desktop electrobun config copies the svelte bundle into the bun window", () => {
	expect(config.build.copy["build/"]).toBe("views/mainview/");
	expect(config.build.bun.entrypoint).toBe("src/bun/index.ts");
	expect(config.build.mac.createDmg).toBe(false);
	expect(config.release.generatePatch).toBe(true);
});

test("desktop electrobun config matches the shell factory for static fields", () => {
	const factory = makeElectrobunConfig({
		version: config.app.version,
		codesign: config.build.mac.codesign,
		notarize: config.build.mac.notarize,
		baseUrl: config.release.baseUrl,
	});
	expect(config.app.name).toBe(factory.app.name);
	expect(config.app.identifier).toBe(factory.app.identifier);
	expect(config.build.bun.entrypoint).toBe(factory.build.bun.entrypoint);
	expect(config.build.copy["build/"]).toBe(factory.build.copy["build/"]);
	expect(config.build.buildFolder).toBe(factory.build.buildFolder);
	expect(config.build.artifactFolder).toBe(factory.build.artifactFolder);
	expect(config.build.mac.entitlements).toEqual(factory.build.mac.entitlements);
	expect(config.release.generatePatch).toBe(factory.release.generatePatch);
});
