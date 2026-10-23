import { afterEach, beforeEach, expect, test } from 'bun:test';
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { buildSite } from './build.js';
import { blake3 } from './blake3.js';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const sourceFiles = ['1.0.md', 'blake3.js', 'index.pug', 'layout.pug', 'redirect.pug', 'style.css', 'commitment-template.md'];
let sourceDirectory;
let outputDirectory;

beforeEach(async () => {
	sourceDirectory = await mkdtemp(join(tmpdir(), 'lowerbound-build-'));
	outputDirectory = join(sourceDirectory, 'dist');
	for (const filename of sourceFiles) {
		await copyFile(join(projectDirectory, filename), join(sourceDirectory, filename));
	}
});

afterEach(async () => {
	await rm(sourceDirectory, { recursive: true, force: true });
});

function output(path) {
	return readFile(join(outputDirectory, path), 'utf8');
}

async function addDocument(number) {
	const original = await readFile(join(sourceDirectory, '1.0.md'), 'utf8');
	const document = original.replace('- Revision: 1.0', `- Revision: ${number}`);
	await writeFile(join(sourceDirectory, `${number}.md`), `${document}\nUnique text for document ${number}.\n`);
}

test('renders the manifest on the landing page and fills the signing template', async () => {
	const [current] = await buildSite(sourceDirectory);
	const source = await readFile(join(sourceDirectory, '1.0.md'));
	const sourceTokens = marked.lexer(source.toString('utf8'));
	const index = await output('1.0/index.html');
	const template = await output('commitment-template.md');
	const digest = Buffer.from(blake3(source)).toString('base64url');

	for (const token of sourceTokens) {
		expect(index).toContain(marked.parser([token]));
	}
	const [opening, ...commitments] = sourceTokens
		.filter((token) => token.type === 'paragraph')
		.map((token) => marked.parser([token]));
	expect(current.manifesto.leading).toContain(opening);
	expect(current.manifesto.commitments).toEqual(commitments);
	expect(current.manifesto.trailing).toBe('');
	expect(current.manifesto.leading).not.toContain('<ol>');
	/* The link is wrapped in a span so it can wrap at the container edge. */
	expect(index.replace(/<\/?span[^>]*>/g, '')).toContain(template);
	expect(template).toContain(`#b3:${digest}`);
	expect(template).toContain('https://lowerbound.org/1.0');
	expect(template).not.toContain('{{');
	expect(current.digest).toBe(digest);
	expect(current.digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
	expect(await readFile(join(outputDirectory, '1.0.md'))).toEqual(source);
});

test('keeps inline Markdown and later sections intact when grouping commitments', async () => {
	const opening = 'I have a Lower Bound.';
	const commitment = 'I will respect **people** and their [agency][agency].';
	const note = 'This note is not a commitment.';
	const document = [
		'# Lower Bound', '- Revision: 1.0', '---', opening, commitment, '## Notes', note,
		'[agency]: https://example.org',
	].join('\n\n');
	await writeFile(join(sourceDirectory, '1.0.md'), document);
	const [current] = await buildSite(sourceDirectory);

	expect(current.manifesto.leading).toContain(`<p>${opening}</p>\n`);
	expect(current.manifesto.commitments).toHaveLength(1);
	expect(current.manifesto.commitments[0]).toContain('<strong>people</strong>');
	expect(current.manifesto.commitments[0]).toContain('<a href="https://example.org">agency</a>');
	expect(current.manifesto.trailing).toContain(`<h2>Notes</h2>\n<p>${note}</p>`);
	expect(await output('1.0.md')).toBe(document);
});

test('shows the newest document and publishes every discovered document', async () => {
	for (const number of ['1.1', '1.10', '2.0', '10.0']) {
		await addDocument(number);
	}
	const documents = await buildSite(sourceDirectory);
	expect(documents.map((document) => document.number)).toEqual(['10.0', '2.0', '1.10', '1.1', '1.0']);
	const index = await output('10.0/index.html');
	expect(index).toContain('Unique text for document 10.0.');
	expect(index).not.toContain('Unique text for document 1.1.');
	expect(index).toContain(`#b3:${documents[0].digest}`);
	expect(await output('commitment-template.md')).toContain('https://lowerbound.org/10.0');
	expect(await output('1.1/index.html')).toContain('Unique text for document 1.1.');
	for (const document of documents) {
		expect(await readFile(join(outputDirectory, `${document.number}.md`))).toEqual(document.source);
		expect(await Bun.file(join(outputDirectory, document.number, 'index.html')).exists()).toBe(true);
	}
});

test('redirects the root to the highest-numbered revision', async () => {
	await addDocument('2.0');
	await buildSite(sourceDirectory);
	const root = await output('index.html');
	expect(root).toContain('url=/2.0/');
	expect(root).toContain('href="/2.0/"');
	expect(await output('2.0/index.html')).toContain('Unique text for document 2.0.');
});

test('preserves CRLF, Unicode, and a missing final newline when hashing and copying', async () => {
	const original = await readFile(join(sourceDirectory, '1.0.md'), 'utf8');
	const source = Buffer.from(`${original.trimEnd()}\n\nA commitment: café, λ.`.replaceAll('\n', '\r\n'));
	await writeFile(join(sourceDirectory, '1.0.md'), source);
	const [current] = await buildSite(sourceDirectory);
	const digest = Buffer.from(blake3(source)).toString('base64url');
	expect(current.digest).toBe(digest);
	expect(await readFile(join(outputDirectory, '1.0.md'))).toEqual(source);
});

test('removes stale generated files when rebuilding', async () => {
	await addDocument('1.1');
	await buildSite(sourceDirectory);
	await rm(join(sourceDirectory, '1.1.md'));
	await buildSite(sourceDirectory);
	expect(await Bun.file(join(outputDirectory, '1.1.md')).exists()).toBe(false);
	expect(await Bun.file(join(outputDirectory, '1.1/index.html')).exists()).toBe(false);
});

test('rejects mismatched revision metadata without replacing the last successful build', async () => {
	await buildSite(sourceDirectory);
	const previousIndex = await output('1.0/index.html');
	const document = await readFile(join(sourceDirectory, '1.0.md'), 'utf8');
	await writeFile(join(sourceDirectory, '1.0.md'), document.replace('Revision: 1.0', 'Revision: 2.0'));
	await expect(buildSite(sourceDirectory)).rejects.toThrow('1.0.md must declare "- Revision: 1.0"');
	expect(await output('1.0/index.html')).toBe(previousIndex);
});

test('fails clearly when no manifesto documents exist', async () => {
	await rm(join(sourceDirectory, '1.0.md'));
	await expect(buildSite(sourceDirectory)).rejects.toThrow('No manifesto documents found');
});

test('rejects a signing template that could retain a stale digest', async () => {
	const path = join(sourceDirectory, 'commitment-template.md');
	const template = await readFile(path, 'utf8');
	await writeFile(path, template.replace('{{digest}}', 'old-digest'));
	await expect(buildSite(sourceDirectory)).rejects.toThrow('commitment-template.md is missing {{digest}}');
});

test('rejects unknown signing template placeholders', async () => {
	const path = join(sourceDirectory, 'commitment-template.md');
	const template = await readFile(path, 'utf8');
	await writeFile(path, `${template}\n{{unknown}}\n`);
	await expect(buildSite(sourceDirectory)).rejects.toThrow('unknown placeholder');
});

test('all local links, assets, and fragment targets resolve in the generated site', async () => {
	await buildSite(sourceDirectory);
	const html = await output('1.0/index.html');
	for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
		const url = new URL(href, 'https://lowerbound.org/1.0/');
		if (url.origin !== 'https://lowerbound.org') continue;
		let path = join(outputDirectory, url.pathname);
		if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
		expect((await stat(path)).isFile()).toBe(true);
		/* #b3: is a content digest carried in the fragment, not an element id. */
		if (url.hash && !url.hash.startsWith('#b3:')) {
			expect(await readFile(path, 'utf8')).toContain(`id="${url.hash.slice(1)}"`);
		}
	}
});
