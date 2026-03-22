#!/usr/bin/env node

import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import * as fs from 'fs';

// First, run tsc to generate declaration files (if needed)
console.log('Running TypeScript compilation...');
execSync('npx tsc', { stdio: 'inherit' });

// Bundle the main entry point with all dependencies
console.log('Bundling with esbuild...');
await esbuild.build({
  entryPoints: ['./src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: './dist/index.mjs', // Use .mjs extension for ESM to preserve import.meta.url
  sourcemap: false,
  minify: false, // Keep readable for debugging
  // External packages that should NOT be bundled
  // @anthropic-ai/claude-agent-sdk/embed uses Bun-specific `import ... with { type: 'file' }`
  // which esbuild doesn't support. It's only used at runtime in the Bun-compiled binary.
  external: ['@anthropic-ai/claude-agent-sdk/embed'],
  // Shebang is preserved from source file by esbuild
});

console.log('Build complete!');

// Verify the bundle doesn't have external imports (actual runtime imports, not comments)
const bundleContent = fs.readFileSync('./dist/index.mjs', 'utf8');
// Check for import statements that reference external @-scoped packages
// ESM uses 'import' instead of 'require'
const externalImports = bundleContent.match(/from\s+["']@[^"']+["']/g);
if (externalImports) {
  console.warn('Warning: Bundle has external imports:', externalImports);
} else {
  console.log('✓ Bundle is self-contained - no external @-scoped imports');
}
