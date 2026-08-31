// The standard macOS application menu, without which the app has NO key
// equivalents at all: Cmd+Q quit, Cmd+A select-all, Cmd+C/V/X copy/paste and
// Cmd+Z undo are menu-item accelerators on macOS, not webview behavior, so an
// Electrobun app that never calls setApplicationMenu silently loses every one
// of them. Roles map to native NSResponder selectors (see electrobun's
// menuRoles.ts), so Edit-menu items act on whatever field has focus with no
// app code involved; accelerators are set explicitly so the shortcuts do not
// depend on the native side inferring them from roles.
//
// Deliberately no Close (Cmd+W) item: Acepe is a single-window app and
// closing its only window would leave a headless process with no way to get
// the window back. Cmd+M minimize and Cmd+Q quit cover the intent.

type ApplicationMenuItem = {
	readonly type?: "normal" | "divider";
	readonly label?: string;
	readonly role?: string;
	readonly accelerator?: string;
	readonly submenu?: ReadonlyArray<ApplicationMenuItem>;
};

const divider: ApplicationMenuItem = { type: "divider" };

export const standardApplicationMenu = (): Array<ApplicationMenuItem> => [
	{
		label: "Acepe",
		submenu: [
			{ role: "hide", accelerator: "CommandOrControl+H" },
			{ role: "hideOthers", accelerator: "Alt+CommandOrControl+H" },
			{ role: "showAll" },
			divider,
			{ role: "quit", label: "Quit Acepe", accelerator: "CommandOrControl+Q" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo", accelerator: "CommandOrControl+Z" },
			{ role: "redo", accelerator: "Shift+CommandOrControl+Z" },
			divider,
			{ role: "cut", accelerator: "CommandOrControl+X" },
			{ role: "copy", accelerator: "CommandOrControl+C" },
			{ role: "paste", accelerator: "CommandOrControl+V" },
			{ role: "pasteAndMatchStyle", accelerator: "Shift+CommandOrControl+V" },
			{ role: "delete" },
			{ role: "selectAll", accelerator: "CommandOrControl+A" },
		],
	},
	{
		label: "View",
		submenu: [{ role: "toggleFullScreen", accelerator: "Control+CommandOrControl+F" }],
	},
	{
		label: "Window",
		submenu: [
			{ role: "minimize", accelerator: "CommandOrControl+M" },
			{ role: "zoom" },
			divider,
			{ role: "bringAllToFront" },
		],
	},
];
