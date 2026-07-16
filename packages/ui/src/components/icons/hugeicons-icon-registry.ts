import type { IconSvgElement } from "@hugeicons/svelte";
import {
	Activity01Icon,
	AiBrain01Icon,
	Add01Icon,
	Alert01Icon,
	AppWindowIcon,
	Archive03Icon,
	ArrowExpand01Icon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	ArrowUp01Icon,
	BellIcon,
	Bug01Icon,
	BrowserIcon,
	Cancel01Icon,
	CancelCircleIcon,
	ChartLineData01Icon,
	ChatIcon,
	CheckIcon,
	CheckmarkCircle01Icon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronUpIcon,
	CircleDashedIcon,
	CircleIcon,
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
	FlaskConicalIcon,
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
	HistoryIcon,
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
	MoreVerticalIcon,
	Notebook01Icon,
	PaintBoardIcon,
	PanelLeftCloseIcon,
	PencilEdit01Icon,
	Pin02Icon,
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
	UserCircleIcon,
	UserGroupIcon,
	Wrench01Icon,
	Loading03Icon,
	FolderOpenIcon,
	FolderAddIcon,
	FolderGitIcon,
	CircleQuestionMarkIcon,
} from "@hugeicons/core-free-icons";
import {
	discordFilledIcon,
	githubFilledIcon,
	twitterFilledIcon,
} from "./brand-filled-icons.js";

const iconByName = {
	add: Add01Icon,
	alert: Alert01Icon,
	"app-window": AppWindowIcon,
	apps: GridViewIcon,
	archive: Archive03Icon,
	"arrow-left": ArrowLeft01Icon,
	"arrow-right": ArrowRight01Icon,
	"arrow-up": ArrowUp01Icon,
	"arrow-counter-clockwise": UndoIcon,
	avatar: UserCircleIcon,
	bell: BellIcon,
	branch: GitBranchIcon,
	browser: BrowserIcon,
	"browser-url": GlobeIcon,
	"chart-line": ChartLineData01Icon,
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
	flask: FlaskConicalIcon,
	folder: Folder01Icon,
	"folder-open": FolderOpenIcon,
	folders: FolderOpenIcon,
	format: TextIcon,
	text: TextIcon,
	git: GitBranchIcon,
	"git-diff": FileDiffIcon,
	"git-diff-unified": FileDiffIcon,
	"git-pull-request": GitPullRequestIcon,
	globe: GlobeIcon,
	hand: HandIcon,
	history: HistoryIcon,
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
	"paper-plane": MailSend01Icon,
	pencil: PencilEdit01Icon,
	permissions: SecurityCheckIcon,
	pin: Pin02Icon,
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
	"sidebar-closed": PanelLeftCloseIcon,
	"sidebar-open": SidebarLeftIcon,
	sliders: SlidersHorizontalIcon,
	sparkle: SparklesIcon,
	spinner: Loading03Icon,
	star: StarIcon,
	stop: StopIcon,
	storage: FolderOpenIcon,
	sun: Sun01Icon,
	tasks: Task01Icon,
	team: UserGroupIcon,
	terminal: ComputerTerminal01Icon,
	"tool-browser": BrowserIcon,
	"tool-edit": PencilEdit01Icon,
	"tool-plan": Task01Icon,
	"tool-read": File01Icon,
	"tool-search": Search01Icon,
	"tool-skill": SparklesIcon,
	"tool-sql": Database01Icon,
	"tool-task": Task01Icon,
	"tool-think": AiBrain01Icon,
	"tool-web": GlobeIcon,
	trash: Delete01Icon,
	undo: UndoIcon,
	unselected: CircleIcon,
	warning: SecurityWarningIcon,
	worktree: GitBranchIcon,
	"x-circle": CancelCircleIcon,
	close: Cancel01Icon,
	brain: AiBrain01Icon,
	bug: Bug01Icon,
	chat: ChatIcon,
	clock: ClockIcon,
	discord: DiscordIcon,
	"discord-filled": discordFilledIcon,
	edit: PencilEdit01Icon,
	filter: FilterIcon,
	github: GithubIcon,
	"github-filled": githubFilledIcon,
	image: Image01Icon,
	lock: LockIcon,
	moon: Moon01Icon,
	more: MoreVerticalIcon,
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
	"twitter-filled": twitterFilledIcon,
	"open-in-new-window": ArrowExpand01Icon,
	wrench: Wrench01Icon,
	"stop-circle": StopIcon,
	"folder-add": FolderAddIcon,
	"folder-git": FolderGitIcon,
} as const satisfies Record<string, IconSvgElement>;

export type HugeiconsIconName = keyof typeof iconByName;

export type HugeiconsIconLibraryEntry = {
	readonly name: HugeiconsIconName;
	readonly label: string;
};

export const hugeiconsIconNames = Object.freeze(
	Object.keys(iconByName),
) as readonly HugeiconsIconName[];

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

export function resolveHugeiconsIcon(name: string): IconSvgElement {
	if (Object.hasOwn(iconByName, name)) {
		return iconByName[name as HugeiconsIconName];
	}

	return HelpCircleIcon;
}

export function isHugeiconsIconName(name: string): name is HugeiconsIconName {
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
