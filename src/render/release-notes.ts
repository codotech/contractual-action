import type { BumpResult, BumpType } from '@contractual/cli';

/**
 * Input for rendering release notes
 */
export interface ReleaseNotesInput {
  /** Contract name */
  contractName: string;
  /** Version before bump */
  oldVersion: string;
  /** Version after bump */
  newVersion: string;
  /** Change descriptions from changesets */
  changes: string;
  /** Type of version bump */
  bumpType: BumpType;
}

/**
 * Get emoji for bump type
 */
function getBumpEmoji(bumpType: BumpType): string {
  switch (bumpType) {
    case 'major':
      return ':boom:'; // 💥
    case 'minor':
      return ':sparkles:'; // ✨
    case 'patch':
      return ':bug:'; // 🐛
  }
}

/**
 * Get description for bump type
 */
function getBumpDescription(bumpType: BumpType): string {
  switch (bumpType) {
    case 'major':
      return 'Breaking Changes';
    case 'minor':
      return 'New Features';
    case 'patch':
      return 'Bug Fixes';
  }
}

/**
 * Render GitHub Release notes for a single contract release
 */
export function renderReleaseNotes(input: ReleaseNotesInput): string {
  const { contractName, oldVersion, newVersion, changes, bumpType } = input;

  let md = `# ${contractName} v${newVersion}\n\n`;

  // Version badge
  md += `${getBumpEmoji(bumpType)} **${getBumpDescription(bumpType)}** (${bumpType} release)\n\n`;

  // Version change
  md += `## Version\n\n`;
  md += `\`${oldVersion}\` → \`${newVersion}\`\n\n`;

  // Changes section
  if (changes && changes.trim()) {
    md += `## What's Changed\n\n`;
    md += changes.trim();
    md += '\n\n';
  }

  // Footer
  md += '---\n\n';
  md += '_Released by [Contractual](https://github.com/codotech/contractual)_\n';

  return md;
}

/**
 * Render a summary of all releases (for multi-contract releases)
 */
export function renderReleaseSummary(bumps: BumpResult[]): string {
  let md = '# Release Summary\n\n';

  md += '| Contract | Version | Type |\n';
  md += '|----------|---------|------|\n';

  for (const bump of bumps) {
    md += `| ${bump.contract} | ${bump.oldVersion} → ${bump.newVersion} | ${bump.bumpType} |\n`;
  }

  return md;
}
