# Acepe Website Setup Guide

This guide will help you set up the Acepe website locally with the waitlist system, admin dashboard, and email confirmation.

## Prerequisites

- Node.js/Bun for package management
- PostgreSQL 14+ for the database
- Resend account for email sending (free tier available)

## Environment Setup

### 1. Install Dependencies

```bash
cd packages/website
bun install
```

### 2. Create Environment File

Create a `.env.local` file in the `packages/website` directory:

```bash
# Database (PostgreSQL)
DATABASE_URL="postgresql://user:password@localhost:5432/acepe_website"

# Email Service (Resend)
RESEND_API_KEY="re_xxxxxxxxxxxxx"

# Public Configuration
PUBLIC_BASE_URL="http://localhost:5173"
ADMIN_EMAIL="admin@acepe.app"
```

### 3. Set Up Database

#### Local PostgreSQL

If you don't have PostgreSQL running locally, you can:

**macOS (Homebrew):**

```bash
brew install postgresql
brew services start postgresql
createdb acepe_website
```

**Docker:**

```bash
docker run --name postgres-acepe \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=acepe_website \
  -p 5432:5432 \
  -d postgres:14
```

#### Run Migrations

```bash
# Generate migration files
bun db:generate

# Run migrations
bun db:push
```

### 4. Create Initial Admin User

```bash
bun scripts/seed-admin.ts admin@acepe.app your-secure-password
```

Replace with your desired admin email and password.

## Development

### Start Dev Server

```bash
bun dev
```

The website will be available at `http://localhost:5173`

### Development Commands

```bash
# Type checking
bun run check

# Linting & formatting
bun run lint
bun run format

# Run tests
bun test

# Database studio (UI for database)
bun db:studio
```

## Flows

### User Waitlist Flow

1. User visits `http://localhost:5173`
2. Clicks "Join the Waitlist" button
3. Enters email in modal
4. Receives confirmation email from Resend
5. Clicks confirmation link
6. Email confirmed at `/confirm?token=xxx`

### Admin Flow

1. Visit `http://localhost:5173/login`
2. Enter admin email and password (created via seed script)
3. Access dashboard at `/admin`
4. View all waitlist entries with pagination
5. Export entries to CSV
6. See real-time statistics (total, confirmed, confirmation rate)

## Testing

### Run Tests

```bash
# Unit tests only
bun test:unit

# Watch mode
bun test:watch
```

Test coverage includes:

- Email value object validation
- Application service logic
- Error handling with neverthrow patterns

## Deployment to Railway

### 1. Create Railway Account

Visit [railway.app](https://railway.app)

### 2. Connect Repository

1. Create new project from GitHub
2. Select this repository
3. Configure build settings

### 3. Add PostgreSQL Add-on

1. Go to project settings
2. Click "Add Plugins"
3. Add PostgreSQL
4. Railway will automatically set `DATABASE_URL`

### 4. Set Environment Variables

In Railway project settings, add:

- `RESEND_API_KEY`: Your Resend API key
- `PUBLIC_BASE_URL`: Your production domain (e.g., `https://acepe.app`)
- `ADMIN_EMAIL`: Your admin email

### 5. Run Migrations on Deploy

Migrations run automatically during build via the `bun run build` script which includes `bun db:push`.

### 6. Create Initial Admin on Production

After deployment, SSH into Railway container or use Railway CLI:

```bash
railway run bun scripts/seed-admin.ts admin@yourdomain.com your-password
```

## Architecture Overview

### Tech Stack

- **Frontend**: SvelteKit 5 + Svelte 5
- **Backend**: SvelteKit form actions (no external API)
- **Database**: PostgreSQL + Drizzle ORM
- **Email**: Resend
- **Authentication**: Bcrypt + Session cookies
- **Error Handling**: neverthrow (ResultAsync patterns)

### Project Structure

```
src/
├── lib/
│   ├── server/
│   │   ├── db/              # Database client & schema
│   │   ├── domain/          # Business logic & error types
│   │   ├── infrastructure/  # Repository & email service
│   │   ├── application/     # Application services
│   │   └── auth/            # Admin authentication
│   └── components/
│       ├── waitlist-inline.svelte
│       └── animated-background.svelte
├── routes/
│   ├── +page.svelte         # Landing page
│   ├── +page.server.ts      # Waitlist form action
│   ├── login/               # Admin login
│   ├── confirm/             # Email confirmation
│   └── admin/               # Admin dashboard (protected)
└── messages/                # i18n translations
```

### Key Features

- **Error Handling**: All async operations use `ResultAsync<T, E>` from neverthrow
- **Email Verification**: Confirmation tokens sent via Resend
- **Admin Dashboard**: Protected route with pagination and CSV export
- **Responsive UI**: Works on desktop and mobile
- **Internationalization**: English and Spanish support (42 more languages ready)

## Troubleshooting

### Database Connection Error

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solution**: Make sure PostgreSQL is running:

```bash
# Check if running
pg_isready

# Start if using Homebrew
brew services start postgresql

# Or check Docker container
docker ps
```

### Email Not Sending

1. Check `RESEND_API_KEY` is set correctly in `.env.local`
2. Verify email domain is verified in Resend dashboard
3. Check spam folder
4. View Resend dashboard for delivery errors

### Migration Failed

1. Reset database:

```bash
dropdb acepe_website
createdb acepe_website
bun db:push
```

2. Check `DATABASE_URL` format is correct

### Login Not Working

1. Verify admin user was created:

```bash
bun scripts/seed-admin.ts test@example.com testpassword
```

2. Check cookies are enabled in browser
3. Clear browser cache/cookies and try again

## Next Steps

- [ ] Customize email templates in `src/lib/server/infrastructure/email/ResendEmailService.ts`
- [ ] Add more language translations (59 more languages available)
- [ ] Add rate limiting to form actions
- [ ] Add CAPTCHA verification
- [ ] Set up analytics (PostHog, Plausible)
- [ ] Create email drip campaign for waitlist members

## Support

For issues or questions, refer to:

- [SvelteKit Docs](https://kit.svelte.dev)
- [Drizzle ORM Docs](https://orm.drizzle.team)
- [Resend Docs](https://resend.com/docs)
- [Railway Docs](https://docs.railway.app)
