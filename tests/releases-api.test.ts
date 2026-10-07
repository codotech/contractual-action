import { beforeEach, expect, it, vi } from 'vitest';
import { createRelease, tagExists, uploadReleaseAsset } from '../src/github/releases.js';

vi.mock('@actions/core', () => ({ info: vi.fn() }));
vi.mock('@actions/exec', () => ({ exec: vi.fn() }));
const context = { repo: { owner: 'owner', repo: 'repo' } } as any;
const options = { tagName: 'api@1.0.0', releaseName: 'api', body: 'changes', prerelease: false };
const api = { rest: { repos: { getReleaseByTag: vi.fn(), createRelease: vi.fn(), listReleaseAssets: vi.fn(), uploadReleaseAsset: vi.fn() }, git: { getRef: vi.fn() } }, paginate: vi.fn() };
beforeEach(() => vi.resetAllMocks());
it('reuses an existing GitHub Release', async () => {
  api.rest.repos.getReleaseByTag.mockResolvedValue({ data: { id: 12, html_url: 'url' } });
  await expect(createRelease(api as any, context, options)).resolves.toEqual({ id: 12, url: 'url' });
  expect(api.rest.repos.createRelease).not.toHaveBeenCalled();
});
it('creates a release only on a 404', async () => {
  api.rest.repos.getReleaseByTag.mockRejectedValue({ status: 404 });
  api.rest.repos.createRelease.mockResolvedValue({ data: { id: 12, html_url: 'url' } });
  await createRelease(api as any, context, options);
  expect(api.rest.repos.createRelease).toHaveBeenCalled();
});
it('propagates API authorization failures', async () => {
  api.rest.repos.getReleaseByTag.mockRejectedValue({ status: 403 });
  await expect(createRelease(api as any, context, options)).rejects.toEqual({ status: 403 });
  api.rest.git.getRef.mockRejectedValue({ status: 403 });
  await expect(tagExists(api as any, context, 'api@1.0.0')).rejects.toEqual({ status: 403 });
});
it('does not upload an asset that already exists on a retry', async () => {
  api.paginate.mockResolvedValue([{ name: 'api.yaml' }]);
  await uploadReleaseAsset(api as any, context, 12, { name: 'api.yaml', path: '/not-read-on-retry' });
  expect(api.rest.repos.uploadReleaseAsset).not.toHaveBeenCalled();
});
