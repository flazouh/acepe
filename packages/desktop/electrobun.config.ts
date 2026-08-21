// Electrobun's CLI bun cannot resolve workspace packages or `effect`.
// Keep this file import-free. Match @acepe/electrobun-shell makeElectrobunConfig.
const env = Bun.env;

const present = (value: string | undefined): boolean => value !== undefined && value.length > 0;

const sign = env.ACEPE_SIGN === "true";
const appleId = present(env.ELECTROBUN_APPLEID) ? env.ELECTROBUN_APPLEID : env.APPLE_ID;
const applePassword = present(env.ELECTROBUN_APPLEIDPASS)
	? env.ELECTROBUN_APPLEIDPASS
	: env.APPLE_PASSWORD;
const teamId = present(env.ELECTROBUN_TEAMID) ? env.ELECTROBUN_TEAMID : env.APPLE_TEAM_ID;
const appleIdComplete = present(appleId) && present(applePassword) && present(teamId);
const apiKeyComplete =
	present(env.ELECTROBUN_APPLEAPIISSUER) &&
	present(env.ELECTROBUN_APPLEAPIKEY) &&
	present(env.ELECTROBUN_APPLEAPIKEYPATH);
const notarize = sign === true && (appleIdComplete || apiKeyComplete);

export default {
	app: {
		name: "Acepe",
		identifier: "com.acepe.app",
		version: env.ACEPE_VERSION ?? "2026.3.33",
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		copy: {
			"build/": "views/mainview/",
		},
		buildFolder: "electrobun-build",
		artifactFolder: "electrobun-artifacts",
		watchIgnore: ["electrobun-build/**", "electrobun-artifacts/**"],
		mac: {
			codesign: sign,
			notarize,
			bundleCEF: false,
			createDmg: sign,
			entitlements: {
				"com.apple.security.cs.allow-jit": true,
				"com.apple.security.cs.allow-unsigned-executable-memory": true,
				"com.apple.security.cs.disable-library-validation": true,
				"com.apple.security.device.audio-input":
					"Acepe records microphone input for voice features.",
				"com.apple.security.network.client": true,
				"com.apple.security.network.server": true,
				"com.apple.security.files.user-selected.read-write":
					"Acepe reads and writes the files you select.",
			},
		},
	},
	release: {
		baseUrl: env.ACEPE_BASEURL ?? "https://github.com/flazouh/acepe/releases/latest/download",
		generatePatch: true,
	},
};
