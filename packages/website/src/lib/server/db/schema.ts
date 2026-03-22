import { pgTable, pgEnum, text, timestamp, boolean, index, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const waitlistEntries = pgTable(
	'waitlist_entries',
	{
		id: text('id').primaryKey(),
		email: text('email').notNull().unique(),
		locale: text('locale').notNull().default('en'),
		confirmationToken: text('confirmation_token').notNull().unique(),
		emailConfirmed: boolean('email_confirmed').notNull().default(false),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		confirmedAt: timestamp('confirmed_at')
	},
	(table) => ({
		emailIdx: index('email_idx').on(table.email),
		confirmationTokenIdx: index('confirmation_token_idx').on(table.confirmationToken)
	})
);

export const users = pgTable('users', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	googleId: text('google_id').notNull().unique(),
	name: text('name'),
	picture: text('picture'),
	isAdmin: boolean('is_admin').notNull().default(false),
	createdAt: timestamp('created_at').notNull().defaultNow()
});

export const sessions = pgTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(table) => ({
		userIdIdx: index('session_user_id_idx').on(table.userId)
	})
);

export const featureFlags = pgTable('feature_flags', {
	name: text('name').primaryKey(),
	enabled: boolean('enabled').notNull().default(false),
	updatedAt: timestamp('updated_at').notNull().defaultNow()
});

export type FeatureFlagName = 'login_enabled' | 'download_enabled' | 'roadmap_enabled';

// --- User Reports ---

export const reportCategoryEnum = pgEnum('report_category', [
	'bug',
	'feature_request',
	'question',
	'discussion'
]);

export const reportStatusEnum = pgEnum('report_status', [
	'open',
	'under_review',
	'planned',
	'in_progress',
	'completed',
	'closed',
	'wont_fix'
]);

export const voteTypeEnum = pgEnum('vote_type', ['up', 'down']);

export const reports = pgTable(
	'reports',
	{
		id: text('id').primaryKey(),
		title: text('title').notNull(),
		body: text('body').notNull(),
		category: reportCategoryEnum('category').notNull(),
		status: reportStatusEnum('status').notNull().default('open'),
		authorId: text('author_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		upvoteCount: integer('upvote_count').notNull().default(0),
		downvoteCount: integer('downvote_count').notNull().default(0),
		commentCount: integer('comment_count').notNull().default(0),
		followerCount: integer('follower_count').notNull().default(0),
		isPinned: boolean('is_pinned').notNull().default(false),
		deletedAt: timestamp('deleted_at'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(table) => ({
		authorIdIdx: index('report_author_id_idx').on(table.authorId),
		categoryDeletedIdx: index('report_category_deleted_idx').on(table.category, table.deletedAt),
		statusDeletedIdx: index('report_status_deleted_idx').on(table.status, table.deletedAt),
		createdAtDeletedIdx: index('report_created_at_deleted_idx').on(table.createdAt, table.deletedAt),
		categoryStatusDeletedIdx: index('report_category_status_deleted_idx').on(
			table.category,
			table.status,
			table.deletedAt
		)
	})
);

export const reportComments = pgTable(
	'report_comments',
	{
		id: text('id').primaryKey(),
		reportId: text('report_id')
			.notNull()
			.references(() => reports.id, { onDelete: 'cascade' }),
		parentId: text('parent_id'),
		authorId: text('author_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		body: text('body').notNull(),
		upvoteCount: integer('upvote_count').notNull().default(0),
		downvoteCount: integer('downvote_count').notNull().default(0),
		deletedAt: timestamp('deleted_at'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(table) => ({
		reportIdIdx: index('comment_report_id_idx').on(table.reportId),
		parentIdIdx: index('comment_parent_id_idx').on(table.parentId),
		authorIdIdx: index('comment_author_id_idx').on(table.authorId)
	})
);

export const reportVotes = pgTable(
	'report_votes',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		reportId: text('report_id').references(() => reports.id, { onDelete: 'cascade' }),
		commentId: text('comment_id').references(() => reportComments.id, { onDelete: 'cascade' }),
		voteType: voteTypeEnum('vote_type').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(table) => ({
		userReportIdx: uniqueIndex('vote_user_report_idx')
			.on(table.userId, table.reportId)
			.where(sql`${table.reportId} IS NOT NULL`),
		userCommentIdx: uniqueIndex('vote_user_comment_idx')
			.on(table.userId, table.commentId)
			.where(sql`${table.commentId} IS NOT NULL`)
	})
);

export const reportFollowers = pgTable(
	'report_followers',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		reportId: text('report_id')
			.notNull()
			.references(() => reports.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(table) => ({
		userReportIdx: uniqueIndex('follower_user_report_idx').on(table.userId, table.reportId)
	})
);
