import type { IconSvgElement } from "@hugeicons/svelte";
import {
	Activity01Icon,
	AiBrain01Icon,
	Add01Icon,
	Alert01Icon,
	AppWindowIcon,
	Archive01Icon,
	ArrowExpand01Icon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	ArrowUp01Icon,
	BellIcon,
	Bug01Icon,
	BrowserIcon,
	Cancel01Icon,
	CancelCircleIcon,
	ChatIcon,
	CheckIcon,
	CheckmarkCircle01Icon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronUpIcon,
	CircleDashedIcon,
	ClockIcon,
	CodeIcon,
	ComputerTerminal01Icon,
	Copy01Icon,
	Database01Icon,
	Delete01Icon,
	DiscordIcon,
	DockIcon,
	Download02Icon,
	EyeIcon,
	EyeOffIcon,
	File01Icon,
	FileDiffIcon,
	Files01Icon,
	FilterIcon,
	FlashIcon,
	FloppyDiskIcon,
	Folder01Icon,
	GitBranchIcon,
	GitPullRequestIcon,
	GithubIcon,
	GoogleIcon,
	GlobeIcon,
	GridViewIcon,
	HandIcon,
	HelpCircleIcon,
	Image01Icon,
	KeyboardIcon,
	LaptopIcon,
	Link01Icon,
	LockIcon,
	MailSend01Icon,
	Menu01Icon,
	MenuCollapseIcon,
	McpServerIcon,
	Mic01Icon,
	MinusSignIcon,
	Moon01Icon,
	More01Icon,
	Notebook01Icon,
	PaintBoardIcon,
	PencilEdit01Icon,
	Recycle01Icon,
	Refresh01Icon,
	Robot01Icon,
	Search01Icon,
	SecurityCheckIcon,
	SecurityWarningIcon,
	Settings01Icon,
	SidebarLeftIcon,
	SlidersHorizontalIcon,
	SparklesIcon,
	StarIcon,
	StopIcon,
	Sun01Icon,
	Task01Icon,
	TextIcon,
	TwitterIcon,
	UndoIcon,
	Wrench01Icon,
	Loading01Icon,
	FolderOpenIcon,
	FolderAddIcon,
	FolderGitIcon,
	CircleQuestionMarkIcon,
} from "@hugeicons/core-free-icons";

export type HugeiconsIconName = string;

const iconByName: Readonly<Record<string, IconSvgElement>> = {
	add: Add01Icon,
	alert: Alert01Icon,
	"app-window": AppWindowIcon,
	apps: GridViewIcon,
	archive: Archive01Icon,
	"arrow-left": ArrowLeft01Icon,
	"arrow-right": ArrowRight01Icon,
	"arrow-up": ArrowUp01Icon,
	"arrow-counter-clockwise": UndoIcon,
	bell: BellIcon,
	branch: GitBranchIcon,
	browser: BrowserIcon,
	"browser-url": GlobeIcon,
	"check-circle": CheckmarkCircle01Icon,
	"check-circle-filled": CheckmarkCircle01Icon,
	check: CheckIcon,
	"chevron-down": ChevronDownIcon,
	"chevron-left": ChevronLeftIcon,
	"chevron-right": ChevronRightIcon,
	"chevron-up": ChevronUpIcon,
	"circle-dashed": CircleDashedIcon,
	code: CodeIcon,
	collapse: MenuCollapseIcon,
	copy: Copy01Icon,
	"copy-id": Copy01Icon,
	"diff-backgrounds": FileDiffIcon,
	"diff-bars": FileDiffIcon,
	"diff-classic": FileDiffIcon,
	"diff-line-numbers": FileDiffIcon,
	"diff-wrapping": FileDiffIcon,
	document: File01Icon,
	database: Database01Icon,
	download: Download02Icon,
	expand: ArrowExpand01Icon,
	eye: EyeIcon,
	"eye-off": EyeOffIcon,
	"file-text": File01Icon,
	file: File01Icon,
	files: Files01Icon,
	folder: Folder01Icon,
	"folder-open": FolderOpenIcon,
	folders: FolderOpenIcon,
	format: TextIcon,
	text: TextIcon,
	git: GitBranchIcon,
	"git-diff": FileDiffIcon,
	"git-diff-unified": FileDiffIcon,
	hand: HandIcon,
	keyboard: KeyboardIcon,
	laptop: LaptopIcon,
	link: Link01Icon,
	lightning: FlashIcon,
	mcp: McpServerIcon,
	microphone: Mic01Icon,
	minus: MinusSignIcon,
	menu: Menu01Icon,
	"new-chat": ChatIcon,
	notebook: Notebook01Icon,
	pencil: PencilEdit01Icon,
	plan: Task01Icon,
	"pull-request": GitPullRequestIcon,
	"pull-request-closed": GitPullRequestIcon,
	"pull-request-merged": GitPullRequestIcon,
	"question-circle": HelpCircleIcon,
	question: CircleQuestionMarkIcon,
	realtime: Activity01Icon,
	review: CheckmarkCircle01Icon,
	refresh: Refresh01Icon,
	revert: UndoIcon,
	search: Search01Icon,
	send: MailSend01Icon,
	settings: Settings01Icon,
	"shield-check": SecurityCheckIcon,
	"security-check": SecurityCheckIcon,
	"shield-warning": SecurityWarningIcon,
	sidebar: SidebarLeftIcon,
	"sidebar-open": SidebarLeftIcon,
	sliders: SlidersHorizontalIcon,
	sparkle: SparklesIcon,
	spinner: Loading01Icon,
	star: StarIcon,
	stop: StopIcon,
	storage: FolderOpenIcon,
	sun: Sun01Icon,
	tasks: Task01Icon,
	terminal: ComputerTerminal01Icon,
	trash: Delete01Icon,
	undo: UndoIcon,
	warning: SecurityWarningIcon,
	worktree: GitBranchIcon,
	"x-circle": CancelCircleIcon,
	close: Cancel01Icon,
	brain: AiBrain01Icon,
	bug: Bug01Icon,
	chat: ChatIcon,
	clock: ClockIcon,
	discord: DiscordIcon,
	edit: PencilEdit01Icon,
	filter: FilterIcon,
	github: GithubIcon,
	image: Image01Icon,
	lock: LockIcon,
	moon: Moon01Icon,
	more: More01Icon,
	palette: PaintBoardIcon,
	plus: Add01Icon,
	recycle: Recycle01Icon,
	robot: Robot01Icon,
	save: FloppyDiskIcon,
	"settings-general": Settings01Icon,
	"settings-skills": Settings01Icon,
	skills: SparklesIcon,
	dock: DockIcon,
	google: GoogleIcon,
	twitter: TwitterIcon,
	"open-in-new-window": ArrowExpand01Icon,
	wrench: Wrench01Icon,
	"stop-circle": StopIcon,
	"folder-add": FolderAddIcon,
	"folder-git": FolderGitIcon,
};

export type HugeiconsIconLibraryEntry = {
	readonly name: HugeiconsIconName;
	readonly label: string;
};

export const hugeiconsIconNames = Object.freeze(Object.keys(iconByName));

export function formatHugeiconsIconName(name: HugeiconsIconName): string {
	return name
		.split("-")
		.map((part) => {
			if (part.length === 0) {
				return part;
			}

			return `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`;
		})
		.join(" ");
}

export const hugeiconsIconLibrary: readonly HugeiconsIconLibraryEntry[] =
	hugeiconsIconNames.map((name) => ({
		name,
		label: formatHugeiconsIconName(name),
	}));

export function resolveHugeiconsIcon(name: HugeiconsIconName): IconSvgElement {
	return iconByName[name] ?? HelpCircleIcon;
}

export function isHugeiconsIconName(name: string): boolean {
	return Object.hasOwn(iconByName, name);
}

type IconAttributeValue = string | number;

function escapeSvgAttribute(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

/**
 * Returns a self-contained Hugeicons SVG data URI for places that need an
 * image source (for example, a DOM node created outside Svelte). The source
 * is still generated from the same Hugeicons registry as `<HugeiconsIcon>`.
 */
export function hugeiconsIconDataUri(
	name: HugeiconsIconName,
	color: string = "#71717a",
): string {
	const elements = resolveHugeiconsIcon(name).map(([tagName, attributes]) => {
		const serializedAttributes = Object.entries(attributes as Record<string, IconAttributeValue>)
			.map(([attributeName, value]) => {
				const resolvedValue = value === "currentColor" ? color : String(value);
				return `${attributeName}="${escapeSvgAttribute(resolvedValue)}"`;
			})
			.join(" ");

		return `<${tagName} ${serializedAttributes}></${tagName}>`;
	});
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${escapeSvgAttribute(color)}">${elements.join("")}</svg>`;

	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
