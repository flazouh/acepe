<script lang="ts">
	import { DiffPill, ProjectLetterBadge } from '@acepe/ui';
	import { AgentPanelLayout, type AnyAgentEntry } from '@acepe/ui/agent-panel';
	import {
		FeedItem,
		SectionedFeed,
		type SectionedFeedGroup,
		type SectionedFeedItemData
	} from '@acepe/ui/attention-queue';
	import {
		AppMainLayout,
		AppSidebarProjectGroup,
		AppTabBarGrouped,
		AppTabBarTab,
		AppTopBar,
		type AppProjectGroup,
		type AppTab,
		type AppTabGroup
	} from '@acepe/ui/app-layout';
	import { ProjectCard } from '@acepe/ui/project-card';

	const ACEPE_NAME = 'acepe';
	const ACEPE_COLOR = '#7C3AED';
	const MYAPP_NAME = 'myapp';
	const MYAPP_COLOR = '#0EA5E9';

	interface ShowcaseQueueItem extends SectionedFeedItemData {
		id: string;
		title: string;
		projectName: string;
		projectColor: string;
		agentIconSrc: string;
		statusText?: string;
		insertions?: number;
		deletions?: number;
	}

	const jwtMigrationEntries: AnyAgentEntry[] = [
		{ id: 'jwt-user', type: 'user', text: 'Migrate our auth system to JWT tokens' },
		{ id: 'jwt-thinking', type: 'thinking' },
		{
			id: 'jwt-read',
			type: 'tool_call',
			kind: 'read',
			title: 'Read',
			filePath: 'src/lib/auth/session.ts',
			status: 'done'
		},
		{
			id: 'jwt-search',
			type: 'tool_call',
			kind: 'search',
			title: 'Grep',
			query: 'session_cookie',
			searchFiles: ['src/middleware/auth.ts', 'src/lib/auth/session.ts'],
			searchResultCount: 2,
			status: 'done'
		},
		{
			id: 'jwt-assistant',
			type: 'assistant',
			markdown:
				'Migrating to JWT:\\n\\n1. Create `jwt.ts` with `jose`\\n2. Update auth middleware\\n3. Add refresh token rotation',
			isStreaming: true
		}
	];

	const nPlusOneEntries: AnyAgentEntry[] = [
		{ id: 'n1-user', type: 'user', text: 'Fix the N+1 queries on the users endpoint' },
		{ id: 'n1-thinking', type: 'thinking' },
		{
			id: 'n1-read',
			type: 'tool_call',
			kind: 'read',
			title: 'Read',
			filePath: 'app/controllers/users_controller.rb',
			status: 'done'
		},
		{
			id: 'n1-edit',
			type: 'tool_call',
			kind: 'edit',
			title: 'Edit',
			filePath: 'app/controllers/users_controller.rb',
			status: 'done'
		},
		{
			id: 'n1-run',
			type: 'tool_call',
			kind: 'execute',
			title: 'Run',
			command: 'rails test test/controllers/',
			stdout: '3 runs, 3 assertions, 0 failures',
			exitCode: 0,
			status: 'done'
		},
		{
			id: 'n1-assistant',
			type: 'assistant',
			markdown: 'Queries reduced from **47 to 3** with `includes(:roles, :profile)`.'
		}
	];

	const strictModeEntries: AnyAgentEntry[] = [
		{ id: 'strict-user', type: 'user', text: 'Enable TypeScript strict mode and fix all errors' },
		{
			id: 'strict-run',
			type: 'tool_call',
			kind: 'execute',
			title: 'Run',
			command: 'tsc --strict --noEmit',
			stdout:
				'src/api/users.ts(14,12): error TS2345\\nsrc/utils/format.ts(8,5): error TS2322\\nsrc/hooks/useAuth.ts(22,8): error TS2339\\n\\n3 errors',
			exitCode: 1,
			status: 'done'
		},
		{
			id: 'strict-assistant',
			type: 'assistant',
			markdown: 'Found **3 type errors** across 3 files. Fixing now.'
		}
	];

	const tabGroups: AppTabGroup[] = [
		{
			projectName: ACEPE_NAME,
			projectColor: ACEPE_COLOR,
			tabs: [
				{
					id: 'p1',
					title: 'Migrate auth to JWT',
					agentIconSrc: '/svgs/agents/claude/claude-icon-dark.svg',
					mode: 'build',
					status: 'running',
					isFocused: true
				},
				{
					id: 'p2',
					title: 'Fix N+1 queries',
					agentIconSrc: '/svgs/agents/codex/codex-icon-dark.svg',
					mode: 'build',
					status: 'done',
					isFocused: false
				},
				{
					id: 'p3',
					title: 'TypeScript strict mode',
					agentIconSrc: '/svgs/agents/opencode/opencode-logo-dark.svg',
					mode: 'build',
					status: 'idle',
					isFocused: false
				}
			]
		},
		{
			projectName: MYAPP_NAME,
			projectColor: MYAPP_COLOR,
			tabs: [
				{
					id: 'myapp-1',
					title: 'Setup CI pipeline',
					agentIconSrc: '/svgs/agents/claude/claude-icon-dark.svg',
					status: 'idle',
					isFocused: false
				}
			]
		}
	];

	const queueGroups: SectionedFeedGroup<ShowcaseQueueItem>[] = [
		{
			id: 'working',
			label: 'Working',
			items: [
				{
					id: 'queue-p1',
					title: 'Migrate auth to JWT',
					projectName: ACEPE_NAME,
					projectColor: ACEPE_COLOR,
					agentIconSrc: '/svgs/agents/claude/claude-icon-dark.svg',
					statusText: 'Reading auth/session.ts'
				}
			]
		},
		{
			id: 'needs_review',
			label: 'Needs Review',
			items: [
				{
					id: 'queue-p2',
					title: 'Fix N+1 queries',
					projectName: ACEPE_NAME,
					projectColor: ACEPE_COLOR,
					agentIconSrc: '/svgs/agents/codex/codex-icon-dark.svg',
					insertions: 12,
					deletions: 31
				}
			]
		}
	];

	const acepeGroup: AppProjectGroup = {
		name: ACEPE_NAME,
		color: ACEPE_COLOR,
		sessions: [
			{
				id: 'p1',
				title: 'Migrate auth to JWT',
				agentIconSrc: '/svgs/agents/claude/claude-icon-dark.svg',
				status: 'running',
				isActive: true
			},
			{
				id: 'p2',
				title: 'Fix N+1 queries',
				agentIconSrc: '/svgs/agents/codex/codex-icon-dark.svg',
				status: 'done',
				isActive: false
			},
			{
				id: 'p3',
				title: 'TypeScript strict mode',
				agentIconSrc: '/svgs/agents/opencode/opencode-logo-dark.svg',
				status: 'idle',
				isActive: false
			}
		]
	};

	const myappGroup: AppProjectGroup = {
		name: MYAPP_NAME,
		color: MYAPP_COLOR,
		sessions: [
			{
				id: 'myapp-1',
				title: 'Setup CI pipeline',
				agentIconSrc: '/svgs/agents/claude/claude-icon-dark.svg',
				status: 'idle',
				isActive: false
			}
		]
	};

	const queueTotalCount = queueGroups.reduce((count, group) => count + group.items.length, 0);
</script>

<div class="relative overflow-hidden rounded-2xl bg-primary p-1 shadow-2xl" style="height: 700px;">
	<AppMainLayout>
		{#snippet tabBar()}
			<AppTopBar />
			<AppTabBarGrouped groups={tabGroups}>
				{#snippet tabRenderer(tab: AppTab)}
					<AppTabBarTab {tab} />
				{/snippet}
			</AppTabBarGrouped>
		{/snippet}

		{#snippet sidebar()}
			<aside class="flex w-[280px] shrink-0 flex-col overflow-hidden border-r border-border/40">
				<div class="shrink-0 px-1.5 pt-1.5">
					<SectionedFeed groups={queueGroups} totalCount={queueTotalCount}>
						{#snippet itemRenderer(item: SectionedFeedItemData)}
							{@const queueItem = item as ShowcaseQueueItem}
							<FeedItem>
								<div class="flex items-center gap-1.5">
									<ProjectLetterBadge
										name={queueItem.projectName}
										color={queueItem.projectColor}
										size={14}
									/>
									<img src={queueItem.agentIconSrc} alt="" class="h-3.5 w-3.5 shrink-0" />
									<span class="min-w-0 flex-1 truncate text-xs font-medium">{queueItem.title}</span>
									{#if queueItem.insertions !== undefined && queueItem.deletions !== undefined}
										<DiffPill
											insertions={queueItem.insertions}
											deletions={queueItem.deletions}
											variant="plain"
										/>
									{/if}
								</div>
								{#if queueItem.statusText}
									<div class="text-[10px] text-muted-foreground">{queueItem.statusText}</div>
								{/if}
							</FeedItem>
						{/snippet}
					</SectionedFeed>
				</div>

				<div class="flex flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 py-1.5">
					<AppSidebarProjectGroup group={acepeGroup} />
					<div class="mt-2">
						<AppSidebarProjectGroup group={myappGroup} />
					</div>
				</div>

				<div class="shrink-0 select-none px-3 py-2 text-[10px] text-muted-foreground/40">v0.4.2</div>
			</aside>
		{/snippet}

		{#snippet panels()}
			<div class="flex min-h-0 flex-1 p-0.5">
				<ProjectCard
					projectName={ACEPE_NAME}
					projectColor={ACEPE_COLOR}
					variant="corner"
					class="min-w-0 flex-1"
				>
					<div class="min-w-0 flex-1 overflow-hidden rounded-lg border border-border/30 bg-background">
						<AgentPanelLayout
							entries={jwtMigrationEntries}
							projectName={ACEPE_NAME}
							projectColor={ACEPE_COLOR}
							sessionTitle="Migrate auth to JWT"
							agentIconSrc="/svgs/agents/claude/claude-icon-dark.svg"
							sessionStatus="running"
							iconBasePath="/svgs/icons"
						/>
					</div>
					<div class="min-w-0 flex-1 overflow-hidden rounded-lg border border-border/30 bg-background">
						<AgentPanelLayout
							entries={nPlusOneEntries}
							projectName={ACEPE_NAME}
							projectColor={ACEPE_COLOR}
							sessionTitle="Fix N+1 queries"
							agentIconSrc="/svgs/agents/codex/codex-icon-dark.svg"
							sessionStatus="done"
							iconBasePath="/svgs/icons"
						/>
					</div>
					<div class="min-w-0 flex-1 overflow-hidden rounded-lg border border-border/30 bg-background">
						<AgentPanelLayout
							entries={strictModeEntries}
							projectName={ACEPE_NAME}
							projectColor={ACEPE_COLOR}
							sessionTitle="TypeScript strict mode"
							agentIconSrc="/svgs/agents/opencode/opencode-logo-dark.svg"
							sessionStatus="idle"
							iconBasePath="/svgs/icons"
						/>
					</div>
				</ProjectCard>
			</div>
		{/snippet}
	</AppMainLayout>
</div>
