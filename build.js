import { watch } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import pug from 'pug';
import { blake3 } from './blake3.js';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const documentFilename = /^\d+\.\d+(?:\.\d+)?\.md$/;
const documentOrder = new Intl.Collator('en', { numeric: true });
const canonicalBaseUrl = 'https://lowerbound.org';
/* Bare URLs, stopping before the shell separators that follow them in commands. */
const urlPattern = /(\S*:\/\/[^\s;|&]+)/;

/* The published digest is the URL-safe base64 encoding of the BLAKE3 hash. */
function digest(source) {
	return Buffer.from(blake3(source)).toString('base64url');
}

/* Printed on revision pages so a reader can compare the served bytes against the published URL. */
function digestCommand(revision, digest) {
	const documentUrl = `${canonicalBaseUrl}/${revision}.md`;
	const commitmentUrl = `${documentUrl}#b3:${digest}`;
	/* The label plus xargs' joining space is sized to put the hash under the one in the URL. */
	const label = `locally calculated hash - ${revision}.md`;
	return `echo ${commitmentUrl}; `
		+ `curl -s ${documentUrl} | b3sum --raw | basenc --base64url | tr -d = `
		+ `| xargs echo '${label}'`;
}

function renderSigningTemplate(template, values) {
	let text = template;
	for (const [name, value] of Object.entries(values)) {
		const placeholder = `{{${name}}}`;
		if (!text.includes(placeholder)) {
			throw new Error(`commitment-template.md is missing ${placeholder}`);
		}
		text = text.replaceAll(placeholder, value);
	}
	if (/\{\{[^}]+\}\}/.test(text)) {
		throw new Error('commitment-template.md contains an unknown placeholder');
	}
	return text;
}

function escapeHtml(value) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/* Link only the first URL in generated text, leaving later repeats as plain text. */
function linkifyFirstUrl(text) {
	let linked = false;
	return text
		.split(urlPattern)
		.map((part) => {
			if (linked || !part.includes('://')) {
				return escapeHtml(part);
			}
			linked = true;
			return `<a href="${escapeHtml(part)}">${escapeHtml(part)}</a>`;
		})
		.join('');
}

/* Wrap the link in a tag so it can break at the container edge instead of a word boundary. */
function signingTemplateHtml(text) {
	return text
		.split(urlPattern)
		.map((part) => (part.includes('://')
			? `<span class="template-url">${escapeHtml(part)}</span>`
			: escapeHtml(part)))
		.join('');
}

/* Render the manifesto, leaving the commitment list markup to the page template. */
function parseManifesto(markdown) {
	const tokens = marked.lexer(markdown);
	const openingIndex = tokens.findIndex((token) => token.type === 'paragraph');
	let end = openingIndex + 1;
	while (['space', 'paragraph'].includes(tokens[end]?.type)) end++;

	return {
		leading: marked.parser(tokens.slice(0, openingIndex + 1)),
		commitments: tokens.slice(openingIndex + 1, end)
			.filter((token) => token.type === 'paragraph')
			.map((token) => marked.parser([token])),
		trailing: marked.parser(tokens.slice(end)),
	};
}

async function readDocument(sourceDirectory, filename) {
	const number = filename.slice(0, -3);
	const source = await readFile(join(sourceDirectory, filename));
	const markdown = source.toString('utf8');
	const declaredRevision = markdown.match(/^- Revision: ([^\r\n]+)\r?$/m)?.[1];
	if (declaredRevision !== number) {
		throw new Error(`${filename} must declare "- Revision: ${number}"`);
	}

	return {
		number,
		source,
		digest: digest(source),
		sourcePath: `/${filename}`,
		/* Only repository-authored Markdown is rendered as HTML. */
		manifesto: parseManifesto(markdown),
	};
}

export async function buildSite(sourceDirectory = projectDirectory) {
	const outputDirectory = join(sourceDirectory, 'dist');
	const filenames = (await readdir(sourceDirectory))
		.filter((filename) => documentFilename.test(filename))
		.sort((left, right) => documentOrder.compare(right, left));
	if (filenames.length === 0) {
		throw new Error('No manifesto documents found. Expected a file such as 1.0.md.');
	}

	const signingTemplate = await readFile(join(sourceDirectory, 'commitment-template.md'), 'utf8');
	const documents = await Promise.all(filenames.map((filename) =>
		readDocument(sourceDirectory, filename)));
	const latest = documents[0];
	const signingTemplates = documents.map((document) => renderSigningTemplate(signingTemplate, {
		digest: document.digest,
		revision: document.number,
	}));
	const renderIndex = pug.compileFile(join(sourceDirectory, 'index.pug'));
	const renderRedirect = pug.compileFile(join(sourceDirectory, 'redirect.pug'));
	const pages = documents.map((document, index) => ({
		number: document.number,
		source: document.source,
		html: renderIndex({
			current: {
				...document,
				signingTemplate: signingTemplates[index],
				signingTemplateHtml: signingTemplateHtml(signingTemplates[index]),
				digestCommandHtml: linkifyFirstUrl(digestCommand(document.number, document.digest)),
			},
		}),
	}));
	const redirectTarget = `/${latest.number}/`;
	const redirectHtml = renderRedirect({ target: redirectTarget, revision: latest.number });
	const assets = {
		'style.css': await readFile(join(sourceDirectory, 'style.css')),
		'blake3.js': await readFile(join(sourceDirectory, 'blake3.js')),
	};

	/* Validate and render everything before replacing the previous build. */
	await rm(outputDirectory, { recursive: true, force: true });
	await mkdir(outputDirectory, { recursive: true });
	for (const [filename, content] of Object.entries(assets)) {
		await writeFile(join(outputDirectory, filename), content);
	}
	await writeFile(join(outputDirectory, 'index.html'), `${redirectHtml}\n`);
	for (const page of pages) {
		const pageDirectory = join(outputDirectory, page.number);
		await mkdir(pageDirectory, { recursive: true });
		await writeFile(join(pageDirectory, 'index.html'), `${page.html}\n`);
		/* Preserve the exact bytes that were hashed, including line endings. */
		await writeFile(join(outputDirectory, `${page.number}.md`), page.source);
	}
	await writeFile(join(outputDirectory, 'commitment-template.md'), signingTemplates[0]);
	return documents;
}

/* Injected at serve time so it never reaches the built files. */
const reloadScript = `<script>
(() => {
	const events = new EventSource('/__dev');
	events.addEventListener('reload', () => location.reload());
	events.addEventListener('build-error', (event) => {
		let overlay = document.getElementById('__dev-error');
		if (!overlay) {
			overlay = document.createElement('pre');
			overlay.id = '__dev-error';
			Object.assign(overlay.style, {
				position: 'fixed', inset: '0', margin: '0', padding: '2rem',
				background: '#1a1a1a', color: '#ff6b6b', 'z-index': '9999',
				'white-space': 'pre-wrap', overflow: 'auto',
			});
			document.body.append(overlay);
		}
		overlay.textContent = event.data;
	});
})();
</script>`;

async function serveStatic(root, url) {
	const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
	const fullPath = resolve(root, relative);
	if (fullPath !== root && !fullPath.startsWith(root + sep)) {
		return new Response('Not found', { status: 404 });
	}

	let filePath = fullPath;
	if ((await stat(fullPath).catch(() => null))?.isDirectory()) {
		if (!url.pathname.endsWith('/')) {
			return Response.redirect(new URL(`${url.pathname}/`, url), 301);
		}
		filePath = join(fullPath, 'index.html');
	}

	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		return new Response('Not found', { status: 404 });
	}
	if (!(file.type ?? '').startsWith('text/html')) {
		return new Response(file);
	}
	const html = await file.text();
	return new Response(html.replace('</body>', `${reloadScript}</body>`), {
		headers: { 'Content-Type': 'text/html; charset=utf-8' },
	});
}

/* Serve dist/ and rebuild on source changes, reloading connected browsers over SSE. */
export async function devServer(port = Number(process.env.PORT) || 8000) {
	const outputDirectory = join(projectDirectory, 'dist');
	const clients = new Set();
	const encoder = new TextEncoder();

	const notify = (event, data = '') => {
		for (const client of clients) {
			try {
				client.write(`event: ${event}\ndata: ${data}\n\n`);
			} catch {
				clients.delete(client);
			}
		}
	};

	const eventStream = () => {
		let client;
		return new ReadableStream({
			start(controller) {
				client = { write: (text) => controller.enqueue(encoder.encode(text)) };
				clients.add(client);
			},
			cancel() {
				clients.delete(client);
			},
		});
	};

	let queued = false;
	let rebuilding = false;
	const rebuild = async () => {
		if (rebuilding) {
			queued = true;
			return;
		}
		rebuilding = true;
		try {
			await buildSite();
			console.log('Rebuilt.');
			notify('reload');
		} catch (error) {
			console.error(error.stack ?? error.message);
			notify('build-error', error.stack ?? error.message);
		} finally {
			rebuilding = false;
			if (queued) {
				queued = false;
				await rebuild();
			}
		}
	};

	await buildSite();
	Bun.serve({
		port,
		/* SSE connections stay open while the browser sits idle. */
		idleTimeout: 0,
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === '/__dev') {
				return new Response(eventStream(), {
					headers: {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
					},
				});
			}
			return serveStatic(outputDirectory, url);
		},
	});

	/* Debounce, and ignore generated output and dependencies. */
	let timer;
	watch(projectDirectory, { recursive: true }, (event, filename) => {
		const name = String(filename);
		if (name.startsWith('dist') || name.startsWith('node_modules')) return;
		if (!/\.(?:md|pug|css)$/.test(name)) return;
		clearTimeout(timer);
		timer = setTimeout(rebuild, 100);
	});

	console.log(`Dev server on http://localhost:${port}/ (watching for changes)`);
}

if (import.meta.main) {
	if (process.argv.includes('--dev')) {
		await devServer();
	} else {
		const documents = await buildSite();
		console.log(`Built the landing page and ${documents.length} manifesto document(s) in dist/.`);
	}
}
