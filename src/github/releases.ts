/**
 * GitHub Release utilities
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';
import { readFileSync } from 'node:fs';
import type { TagPrefix } from '../types.js';

type Octokit = ReturnType<typeof github.getOctokit>;

export interface ReleaseOptions {
  /** Git tag name (e.g., "orders-api@2.0.0") */
  tagName: string;
  /** Release title (e.g., "orders-api v2.0.0") */
  releaseName: string;
  /** Release body (markdown) */
  body: string;
  /** Whether this is a pre-release */
  prerelease: boolean;
}

export interface ReleaseResult {
  /** GitHub Release URL */
  url: string;
  /** GitHub Release ID (for uploading assets) */
  id: number;
}

export interface AssetInfo {
  /** Display name for the asset */
  name: string;
  /** Path to the file to upload */
  path: string;
}

/**
 * Format a git tag based on the tag prefix setting
 *
 * @param contractName - Contract name (e.g., "orders-api")
 * @param version - Version string (e.g., "2.0.0")
 * @param prefix - Tag prefix format
 * @returns Formatted tag name
 *
 * @example
 * formatTag("orders-api", "2.0.0", "contract") // "orders-api@2.0.0"
 * formatTag("orders-api", "2.0.0", "v")        // "v2.0.0"
 * formatTag("orders-api", "2.0.0", "none")     // "2.0.0"
 */
export function formatTag(contractName: string, version: string, prefix: TagPrefix): string {
  switch (prefix) {
    case 'contract':
      return `${contractName}@${version}`;
    case 'v':
      return `v${version}`;
    case 'none':
      return version;
  }
}

/**
 * Check if a version is a pre-release (contains hyphen)
 *
 * @example
 * isPrerelease("2.0.0")        // false
 * isPrerelease("2.0.0-beta.0") // true
 */
export function isPrerelease(version: string): boolean {
  return version.includes('-');
}

/**
 * Create a git tag using git CLI
 *
 * @param tagName - The tag name to create
 * @param message - Tag message
 */
export async function createGitTag(tagName: string, message: string, sha: string): Promise<void> {
  core.info(`Creating git tag: ${tagName}`);

  // Configure git identity for tag creation
  await exec.exec('git', ['config', 'user.name', 'contractual[bot]']);
  await exec.exec('git', ['config', 'user.email', 'contractual[bot]@users.noreply.github.com']);

  // Create annotated tag
  await exec.exec('git', ['tag', '-a', tagName, sha, '-m', message]);

  // Push tag to remote
  await exec.exec('git', ['push', 'origin', tagName]);

  core.info(`Tag ${tagName} created and pushed`);
}

/**
 * Create a GitHub Release
 *
 * @param octokit - Authenticated Octokit instance
 * @param context - GitHub context
 * @param options - Release options
 * @returns Release URL and ID
 */
export async function createRelease(
  octokit: Octokit,
  context: typeof github.context,
  options: ReleaseOptions
): Promise<ReleaseResult> {
  try {
    const { data: existing } = await octokit.rest.repos.getReleaseByTag({
      owner: context.repo.owner, repo: context.repo.repo, tag: options.tagName,
    });
    return { id: existing.id, url: existing.html_url };
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
  }
  core.info(`Creating GitHub Release: ${options.releaseName}`);

  const { data: release } = await octokit.rest.repos.createRelease({
    owner: context.repo.owner,
    repo: context.repo.repo,
    tag_name: options.tagName,
    name: options.releaseName,
    body: options.body,
    prerelease: options.prerelease,
  });

  core.info(`Release created: ${release.html_url}`);

  return {
    url: release.html_url,
    id: release.id,
  };
}

/**
 * Upload an asset to an existing GitHub Release
 *
 * @param octokit - Authenticated Octokit instance
 * @param context - GitHub context
 * @param releaseId - The release ID to upload to
 * @param asset - Asset info (name and path)
 */
export async function uploadReleaseAsset(
  octokit: Octokit,
  context: typeof github.context,
  releaseId: number,
  asset: AssetInfo
): Promise<void> {
  core.info(`Uploading asset: ${asset.name}`);

  const existing = await octokit.paginate(octokit.rest.repos.listReleaseAssets, {
    owner: context.repo.owner, repo: context.repo.repo, release_id: releaseId, per_page: 100,
  });
  if (existing.some(item => item.name === asset.name)) return;

  const fileContent = readFileSync(asset.path);

  await octokit.rest.repos.uploadReleaseAsset({
    owner: context.repo.owner,
    repo: context.repo.repo,
    release_id: releaseId,
    name: asset.name,
    data: fileContent as unknown as string,
  });

  core.info(`Asset uploaded: ${asset.name}`);
}

/**
 * Check if a tag already exists
 *
 * @param octokit - Authenticated Octokit instance
 * @param context - GitHub context
 * @param tagName - Tag name to check
 * @returns True if tag exists
 */
export async function tagExists(
  octokit: Octokit,
  context: typeof github.context,
  tagName: string
): Promise<boolean> {
  try {
    await octokit.rest.git.getRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: `tags/${tagName}`,
    });
    return true;
  } catch (error) {
    // 404 means tag doesn't exist
    if ((error as { status?: number }).status === 404) return false;
    throw error;
  }
}
