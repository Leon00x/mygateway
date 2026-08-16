import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'dashboard/dist', 'test-results']);
const markdownFiles = [];

function collect(directory, relativeDirectory = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(relativePath) && !ignoredDirectories.has(entry.name)) {
        collect(join(directory, entry.name), relativePath);
      }
      continue;
    }
    if (extname(entry.name).toLowerCase() === '.md') markdownFiles.push(relativePath);
  }
}

collect(repositoryRoot);

const errors = [];
const linkPattern = /!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*["'])?\)/g;

for (const relativePath of markdownFiles) {
  const absolutePath = join(repositoryRoot, relativePath);
  const contents = readFileSync(absolutePath, 'utf8');

  if (/\/(?:home|Users)\/[^\s`]+/.test(contents)) {
    errors.push(`${relativePath}: contains a machine-specific absolute path`);
  }

  for (const match of contents.matchAll(linkPattern)) {
    const rawTarget = match[1] ?? match[2];
    if (!rawTarget || /^(?:#|https?:|mailto:|data:)/i.test(rawTarget) || rawTarget.startsWith('/')) continue;
    const fileTarget = decodeURIComponent(rawTarget.split('#', 1)[0].split('?', 1)[0]);
    if (!fileTarget) continue;
    const resolvedTarget = resolve(dirname(absolutePath), fileTarget);
    if (!existsSync(resolvedTarget)) {
      errors.push(`${relativePath}: missing link target ${rawTarget}`);
    } else if (!statSync(resolvedTarget).isFile() && !statSync(resolvedTarget).isDirectory()) {
      errors.push(`${relativePath}: unsupported link target ${rawTarget}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Documentation check failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed (${markdownFiles.length} Markdown files).`);
}
