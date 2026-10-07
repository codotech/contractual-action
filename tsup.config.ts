import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/main.ts' },
  format: ['cjs'],
  outDir: 'dist',
  target: 'node22',
  // Bundle everything into a single file (GitHub Actions requirement)
  noExternal: [/.*/],
  clean: true,
  // Don't split chunks - single file output
  splitting: false,
  // Source maps for debugging
  sourcemap: true,
  // Tree shake unused code
  treeshake: true,
  // Output as .js not .cjs for GitHub Actions compatibility
  outExtension: () => ({ js: '.js' }),
  // Proper CJS interop - don't add the problematic default export wrapper
  cjsInterop: true,
  // esbuild settings
  esbuildOptions(options) {
    // Prefer main field first for CJS compatibility
    options.mainFields = ['main', 'module'];
    // Don't inject the default export wrapper that causes issues
    options.keepNames = true;
  },
});
