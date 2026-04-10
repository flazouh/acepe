<script lang="ts">
/**
 * Plan Mode demo for the homepage features section.
 * Shows a realistic plan in the shared PlanSidebarLayout component.
 */
import { PlanSidebarLayout } from "@acepe/ui/plan-sidebar";

let isBuilding = $state(false);

const plan = {
	title: "Migrate authentication to JWT",
	slug: "migrate-auth-to-jwt",
	content: `## Goal

Replace session cookies with JWT tokens for stateless API scaling and mobile app support.

## Scope

| Area | Files affected | Priority |
|------|---------------|----------|
| Database schema | 1 migration | P0 |
| JWT service | \`src/lib/auth/jwt.ts\` | P0 |
| API middleware | 3 controllers | P1 |
| Client storage | \`src/lib/stores/auth.ts\` | P1 |
| Test suite | 12 spec files | P2 |

## Steps

### 1. Database migration

Add \`refresh_token\` and \`token_expires_at\` to the \`users\` table.

\`\`\`sql
ALTER TABLE users
  ADD COLUMN refresh_token  VARCHAR(512),
  ADD COLUMN token_expires_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX idx_users_refresh_token ON users (refresh_token);
\`\`\`

### 2. JWT service

Create \`src/lib/auth/jwt.ts\` using the \`jose\` library.

\`\`\`typescript
import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export async function signToken(payload: Record<string, unknown>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .sign(secret);
}

export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, secret);
  return payload;
}
\`\`\`

### 3. API middleware

Replace \`authenticate_session!\` with \`authenticate_jwt!\` in:

- \`src/controllers/users_controller.ts\`
- \`src/controllers/projects_controller.ts\`
- \`src/controllers/api_controller.ts\`

### 4. Client storage

Store access tokens in memory; refresh tokens go in \`httpOnly\` cookies.

> **Security:** Never store JWTs in \`localStorage\`. Use in-memory storage for access tokens to prevent XSS exfiltration.

### 5. Update tests

\`\`\`bash
bun test src/lib/auth --coverage
\`\`\`

Fix specs to send \`Authorization: Bearer <token>\` headers instead of session cookies.

## References

Tracked in acepe/acepe#47. Implementation based on commit \`e8224481\`.`,
};
</script>

<div class="h-full">
	<PlanSidebarLayout
		title={plan.title}
		slug={plan.slug}
		content={plan.content}
		{isBuilding}
		onBuild={() => { isBuilding = !isBuilding; }}
		iconBasePath="/svgs/icons"
	/>
</div>
