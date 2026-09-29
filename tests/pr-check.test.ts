import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPRCheck } from '../src/modes/pr-check.js';
import type { ActionInputs } from '../src/types.js';

const mock = vi.hoisted(() => ({
  config: { configDir: process.cwd(), contracts: [{ name: 'api', type: 'openapi', absolutePath: '/api.yaml', lint: false }], changeset: { requireOnPR: true } },
  files: [] as any[], changesets: [] as any[], results: [] as any[],
  paginate: vi.fn(), listFiles: vi.fn(), setFailed: vi.fn(), commit: vi.fn(), comment: vi.fn(), generate: vi.fn(),
}));
vi.mock('@actions/core', () => ({ info: vi.fn(), debug: vi.fn(), warning: vi.fn(), setOutput: vi.fn(), setFailed: mock.setFailed }));
vi.mock('@actions/github', () => ({
  getOctokit: () => ({ paginate: mock.paginate, rest: { pulls: { listFiles: mock.listFiles } } }),
  context: { repo: { owner: 'owner', repo: 'repo' }, payload: { repository: { full_name: 'owner/repo' }, pull_request: { number: 1, head: { repo: { full_name: 'owner/repo' } } } } },
}));
vi.mock('@contractual/cli', () => ({
  loadConfig: () => mock.config, getLinter: vi.fn(), getDiffer: () => () => {}, diffContracts: async () => ({ results: mock.results }),
  readChangesets: async () => mock.changesets,
  aggregateBumps: (sets: any[]) => Object.assign({}, ...sets.map(cs => cs.bumps)),
  createChangeset: mock.generate,
}));
vi.mock('../src/github/commits.js', () => ({ commitChangeset: mock.commit }));
vi.mock('../src/github/comments.js', () => ({ postOrUpdateComment: mock.comment }));
const inputs = { githubToken: 'test', autoChangeset: false, failOnBreaking: false } as ActionInputs;
const change = { contract: 'api', changes: [{ path: '/x', message: 'Removed', severity: 'breaking' }], summary: { breaking: 1, nonBreaking: 0, patch: 0 }, suggestedBump: 'major' };

beforeEach(() => {
  vi.clearAllMocks();
  mock.config.changeset.requireOnPR = true;
  mock.results = [change]; mock.files = []; mock.changesets = [];
  mock.paginate.mockImplementation(async () => mock.files);
  mock.commit.mockResolvedValue(undefined);
});
describe('changeset coverage', () => {
  it('fails a required changeset check when auto-generation is disabled', async () => {
    await runPRCheck(inputs);
    expect(mock.setFailed).toHaveBeenCalledWith(expect.stringContaining('sufficient version bump'));
  });
  it('uses pagination and accepts a sufficient changeset returned from later pages', async () => {
    mock.files = [{ filename: '.contractual/changesets/change.md', status: 'added' }];
    mock.changesets = [{ filename: 'change.md', bumps: { api: 'major' } }];
    await runPRCheck(inputs);
    expect(mock.paginate).toHaveBeenCalledWith(mock.listFiles, expect.objectContaining({ per_page: 100 }));
    expect(mock.setFailed).not.toHaveBeenCalled();
  });
  it('does not accept a deleted changeset', async () => {
    mock.files = [{ filename: '.contractual/changesets/change.md', status: 'removed' }];
    mock.changesets = [{ filename: 'change.md', bumps: { api: 'major' } }];
    await runPRCheck(inputs);
    expect(mock.setFailed).toHaveBeenCalled();
  });
  it('does not accept an insufficient bump', async () => {
    mock.files = [{ filename: '.contractual/changesets/change.md', status: 'modified' }];
    mock.changesets = [{ filename: 'change.md', bumps: { api: 'patch' } }];
    await runPRCheck(inputs);
    expect(mock.setFailed).toHaveBeenCalled();
  });
  it('auto-generates a sufficient changeset for uncovered contracts', async () => {
    mock.generate.mockReturnValue({ filename: 'new.md', content: 'changes' });
    await runPRCheck({ ...inputs, autoChangeset: true });
    expect(mock.generate).toHaveBeenCalledWith([change]);
    expect(mock.commit).toHaveBeenCalled();
    expect(mock.setFailed).not.toHaveBeenCalled();
  });
  it('fails when generating the required changeset cannot be committed', async () => {
    mock.generate.mockReturnValue({ filename: 'new.md', content: 'changes' });
    mock.commit.mockRejectedValue(new Error('permission denied'));
    await runPRCheck({ ...inputs, autoChangeset: true });
    expect(mock.setFailed).toHaveBeenCalled();
  });
  it('honors requireOnPR: false', async () => {
    mock.config.changeset.requireOnPR = false;
    await runPRCheck(inputs);
    expect(mock.setFailed).not.toHaveBeenCalled();
  });
});
