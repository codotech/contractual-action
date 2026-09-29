import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createOrUpdateVersionPR } from '../src/github/pull-requests.js';

vi.mock('@actions/core', () => ({ info: vi.fn(), debug: vi.fn() }));
const initialCwd = process.cwd();
let directory: string;
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }).trim();
const octokit = { rest: { pulls: { list: vi.fn(), create: vi.fn(), update: vi.fn() } } };
const context = { repo: { owner: 'owner', repo: 'repo' }, payload: { repository: { default_branch: 'next' } } };
const options = { branch: 'contractual/version', title: 'chore: version contracts', body: 'Versions', files: ['version.json'] };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'contractual-version-pr-'));
  const remote = join(directory, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
  const work = join(directory, 'work');
  mkdirSync(work);
  process.chdir(work);
  git('init', '--initial-branch=next');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.test');
  writeFileSync('version.json', '1.0.0');
  git('add', '.');
  git('commit', '-m', 'chore: initial');
  git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'next');
  vi.clearAllMocks();
  octokit.rest.pulls.list.mockResolvedValue({ data: [] });
  octokit.rest.pulls.create.mockResolvedValue({ data: { number: 1, html_url: 'https://example.test/pr/1' } });
});
afterEach(() => {
  process.chdir(initialCwd);
  rmSync(directory, { recursive: true, force: true });
});

it('regenerates an existing version branch and stages only owned paths', async () => {
  writeFileSync('version.json', '1.1.0');
  writeFileSync('unrelated.txt', 'keep this local');
  await createOrUpdateVersionPR(octokit as any, context as any, options);
  expect(git('show', '--pretty=', '--name-only', 'HEAD')).toBe('version.json');
  git('checkout', 'next');
  writeFileSync('base.txt', 'new base');
  git('add', 'base.txt');
  git('commit', '-m', 'fix: next change');
  const base = git('rev-parse', 'HEAD');
  writeFileSync('version.json', '1.2.0');
  octokit.rest.pulls.list.mockResolvedValue({ data: [{ number: 1, html_url: 'https://example.test/pr/1' }] });
  await createOrUpdateVersionPR(octokit as any, context as any, options);
  expect(git('rev-parse', 'HEAD^')).toBe(base);
  expect(git('show', 'HEAD:version.json')).toBe('1.2.0');
  expect(git('status', '--porcelain')).toContain('?? unrelated.txt');
  expect(octokit.rest.pulls.update).toHaveBeenCalled();
});

it('refuses to commit an existing staged change', async () => {
  writeFileSync('unrelated.txt', 'keep this staged');
  git('add', 'unrelated.txt');
  writeFileSync('version.json', '1.1.0');
  await expect(createOrUpdateVersionPR(octokit as any, context as any, options)).rejects.toThrow('index must be clean');
  expect(git('branch', '--show-current')).toBe('next');
  expect(git('diff', '--cached', '--name-only')).toBe('unrelated.txt');
});
