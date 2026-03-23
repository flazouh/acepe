/**
 * Seed script to create an initial admin user
 *
 * Usage:
 *   bun scripts/seed-admin.ts <email> <password>
 *
 * Example:
 *   bun scripts/seed-admin.ts admin@acepe.app my-secure-password
 */

import { createAdmin } from '../src/lib/server/auth/admin';

async function main() {
	const email = process.argv[2];
	const password = process.argv[3];

	if (!email || !password) {
		console.error('Usage: bun scripts/seed-admin.ts <email> <password>');
		process.exit(1);
	}

	console.log(`Creating admin user: ${email}`);

	const result = await createAdmin(email, password);

	if (result.isErr()) {
		console.error(`Error: ${result.error.message}`);
		process.exit(1);
	}

	console.log('✅ Admin user created successfully!');
	console.log(`Email: ${email}`);
	console.log('You can now log in at /login');

	process.exit(0);
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
