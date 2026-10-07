import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateSpecVersion } from '@contractual/cli';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
it('bundles the malformed YAML version-sync fix without a new npm publication', () => {
  const directory = mkdtempSync(join(tmpdir(), 'action-spec-test-')); directories.push(directory);
  const path = join(directory, 'api.yaml');
  const malformed = 'info:\n  version: 1.0.0\nbad: [unterminated\n';
  writeFileSync(path, malformed);
  expect(() => updateSpecVersion(path, '2.0.0', 'openapi')).not.toThrow();
  expect(readFileSync(path, 'utf8')).toContain('2.0.0');
  expect(readFileSync(path, 'utf8')).toContain('bad: [unterminated');
});
