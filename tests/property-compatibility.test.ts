import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDiffer } from '@contractual/cli';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

it.each([
  { direction: 'response', closed: true, value: { type: 'integer' }, severity: 'breaking' },
  { direction: 'request', closed: false, value: { type: 'boolean' }, severity: 'breaking' },
  { direction: 'request', closed: false, value: { enum: ['yt-dlp'] }, severity: 'breaking' },
  { direction: 'response', closed: false, value: { type: 'integer' }, severity: 'non-breaking' },
  { direction: 'request', closed: true, value: { type: 'boolean' }, severity: 'non-breaking' },
])('published CLI detects $severity $direction property additions (closed=$closed)', async ({ direction, closed, value, severity }) => {
  const directory = mkdtempSync(join(tmpdir(), 'action-property-test-'));
  directories.push(directory);
  const document = (added: boolean) => {
    const schema = {
      type: 'object',
      properties: added ? { value } : {},
      ...(closed ? { additionalProperties: false } : {}),
    };
    const content = { 'application/json': { schema } };
    return {
      openapi: '3.1.0',
      info: { title: 'Property compatibility', version: '1.0.0' },
      paths: { '/task': { post: {
        ...(direction === 'request' ? { requestBody: { content } } : {}),
        responses: { 200: { description: 'OK', ...(direction === 'response' ? { content } : {}) } },
      } } },
    };
  };
  const oldPath = join(directory, 'old.json');
  const newPath = join(directory, 'new.json');
  writeFileSync(oldPath, JSON.stringify(document(false)));
  writeFileSync(newPath, JSON.stringify(document(true)));
  const differ = getDiffer('openapi');
  expect(differ).toBeTypeOf('function');
  const result = await differ!(oldPath, newPath);
  expect(result.changes).toEqual([expect.objectContaining({ category: 'property-added', severity })]);
  expect(result.suggestedBump).toBe(severity === 'breaking' ? 'major' : 'minor');
});
