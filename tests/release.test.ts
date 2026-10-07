import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runRelease } from '../src/modes/release.js';
import type { ActionInputs } from '../src/types.js';

const mock = vi.hoisted(() => ({
  tagExists: vi.fn(), createGitTag: vi.fn(), createRelease: vi.fn(), uploadReleaseAsset: vi.fn(),
  getCommit: vi.fn(), getContent: vi.fn(),
  config: { configDir: process.cwd(), contracts: [{ name: 'api', type: 'openapi', absolutePath: '/api.yaml' }] },
}));
vi.mock('@actions/core', () => ({ info: vi.fn(), debug: vi.fn(), warning: vi.fn(), setOutput: vi.fn() }));
vi.mock('@actions/github', () => ({
  getOctokit: () => ({ rest: { repos: { getCommit: mock.getCommit, getContent: mock.getContent } } }),
  context: { eventName: 'push', ref: 'refs/heads/next', sha: 'approved-sha', repo: { owner: 'owner', repo: 'repo' }, payload: { repository: { default_branch: 'next' } } },
}));
vi.mock('@contractual/cli', () => ({
  loadConfig: () => mock.config, readChangesets: async () => [], findContractualDir: () => '/.contractual',
  VersionManager: class { getSnapshotPath() { return null; } },
  aggregateBumps: vi.fn(), extractContractChanges: vi.fn(), appendChangelog: vi.fn(), incrementVersion: vi.fn(), incrementVersionWithPreRelease: vi.fn(), updateSpecVersion: vi.fn(), CHANGESETS_DIR: 'changesets',
}));
vi.mock('../src/github/releases.js', () => ({ ...mock, formatTag: (name: string, version: string) => `${name}@${version}`, isPrerelease: () => false }));
vi.mock('../src/github/pull-requests.js', () => ({ createOrUpdateVersionPR: vi.fn() }));
const inputs = { githubToken: 'test', tagPrefix: 'contract', createReleases: true, attachSpecs: false } as ActionInputs;
beforeEach(() => {
  vi.clearAllMocks();
  mock.tagExists.mockResolvedValue(false);
  mock.createGitTag.mockResolvedValue(undefined);
  mock.createRelease.mockResolvedValue({ id: 1, url: 'https://example.test/release' });
  mock.getCommit.mockResolvedValue({ data: { files: [{ filename: '.contractual/versions.json' }], parents: [{ sha: 'parent' }] } });
  mock.getContent.mockImplementation(async ({ ref }) => ({ data: { content: Buffer.from(JSON.stringify({ api: { version: ref === 'parent' ? '1.0.0' : '1.1.0' } })).toString('base64') } }));
});
describe('post-release recovery', () => {
  it('fails when the commit cannot be inspected', async () => {
    mock.getCommit.mockRejectedValueOnce(new Error('forbidden'));
    await expect(runRelease(inputs)).rejects.toThrow('forbidden');
    expect(mock.createGitTag).not.toHaveBeenCalled();
  });
  it('does not assume a first release when parent access fails', async () => {
    mock.getContent.mockRejectedValueOnce({ status: 403 });
    await expect(runRelease(inputs)).rejects.toThrow('Failed to check');
    expect(mock.createGitTag).not.toHaveBeenCalled();
  });
  it('does not depend on the first page of commit files', async () => {
    mock.getCommit.mockResolvedValueOnce({ data: { files: [], parents: [{ sha: 'parent' }] } });
    await runRelease(inputs);
    expect(mock.createGitTag).toHaveBeenCalled();
  });
  it('fails when a requested release snapshot is missing', async () => {
    await expect(runRelease({ ...inputs, attachSpecs: true })).rejects.toThrow('Missing release snapshot');
  });
  it('repairs a missing release even when the tag already exists', async () => {
    mock.tagExists.mockResolvedValue(true);
    await runRelease(inputs);
    expect(mock.createGitTag).not.toHaveBeenCalled();
    expect(mock.createRelease).toHaveBeenCalled();
  });
  it('tags the triggering commit explicitly', async () => {
    await runRelease(inputs);
    expect(mock.createGitTag).toHaveBeenCalledWith('api@1.1.0', expect.any(String), 'approved-sha');
  });
  it('reports release failure and succeeds on a retry', async () => {
    mock.createRelease.mockRejectedValueOnce(new Error('service unavailable'));
    await expect(runRelease(inputs)).rejects.toThrow('Release incomplete');
    mock.tagExists.mockResolvedValue(true);
    await expect(runRelease(inputs)).resolves.toBeUndefined();
    expect(mock.createGitTag).toHaveBeenCalledTimes(1);
  });
  it('does not disguise authorization errors as absent tags', async () => {
    mock.tagExists.mockRejectedValue(new Error('forbidden'));
    await expect(runRelease(inputs)).rejects.toThrow('forbidden');
    expect(mock.createRelease).not.toHaveBeenCalled();
  });
});
