import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** When a content file was first and last committed, as UTC ISO 8601 timestamps. */
export type ContentDates = { published: string; modified: string };

let cache: Map<string, ContentDates> | undefined;

/**
 * Pages show "last updated" dates and put them in JSON-LD and the sitemap, so they come from git
 * rather than the build time. A file with no history (not committed yet) gets no dates.
 */
export function contentDates(file: string): ContentDates | undefined {
  cache ??= readGitDates();
  return cache.get(path.resolve(file));
}

function readGitDates() {
  const dates = new Map<string, ContentDates>();
  const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

  try {
    // A shallow clone (Vercel's default, unless VERCEL_DEEP_CLONE is set) only has the latest
    // commits, which would date every older page as new. No dates is better than wrong ones.
    if (git('rev-parse', '--is-shallow-repository') === 'true') return dates;

    const root = git('rev-parse', '--show-toplevel');
    const log = git(
      '-c',
      'core.quotepath=off',
      'log',
      '--format=commit:%aI',
      '--name-only',
      '--',
      'content',
    );
    let date: string | undefined;
    for (const line of log.split('\n')) {
      if (line.startsWith('commit:')) {
        date = new Date(line.slice('commit:'.length)).toISOString();
      } else if (line && date) {
        // Newest first: a file's first entry is its last change, and its last entry its first.
        const file = path.join(root, line);
        dates.set(file, { modified: dates.get(file)?.modified ?? date, published: date });
      }
    }
  } catch {
    // No git, or not a repository: pages simply go without dates.
  }
  return dates;
}

/**
 * A blog post is published on its frontmatter date (a UTC day), at its first commit's time when
 * that falls on the same day. It is modified at its last commit, never before it was published.
 */
export function postDates(post: { date: string; info: { path: string } }): ContentDates {
  const git = contentDates(`content/blog/${post.info.path}`);
  const published =
    git?.published.slice(0, 10) === post.date ? git.published : `${post.date}T00:00:00.000Z`;
  return { published, modified: git && git.modified > published ? git.modified : published };
}
