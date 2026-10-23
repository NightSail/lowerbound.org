# Lower Bound

A public, voluntary professional floor for software engineers: a line they state in the open and will not go below.

## Premise

Engineers get asked, regularly, to ship things they know are wrong: the metric that flatters, the review skipped to save a week, the dark pattern that converts. Saying no is expensive when there is nothing to point at.

Lower Bound is something to point at. A person states the responsibilities they accept and the work they will not do, whoever asks, under their own name or a pseudonym. It is not an oath, a certification, or a governing body. It is personal, voluntary, and durable, and `I have a Lower Bound` links back to the published statement. Its weight comes from everyone who does the same.

The name is from computer science: the lower bound is the edge of valid memory, past which is an access violation rather than a warning. These are not preferences to trade against a deadline.

## Current status

Revision 1.0 is written in `1.0.md`. The repository builds the site that publishes it:

- Each revision is served at `/<revision>/`; the root redirects to the latest.
- The document is copied byte for byte to `/<revision>.md`.
- Its BLAKE3 digest is shown as `b3:<base64url>` and embedded in a commitment template, so the published text can be verified without trusting this site.
- A commitment is self-published: replace `[name]`, keep the digest and URL, and post the result wherever you control it. There is no central signer registry and no git-commit signing; a GPG/SSH signature is optional and only ties the statement to a key.

## Build

Requires [Bun](https://bun.sh).

```sh
bun install --frozen-lockfile
bun run build
bun test
```

The build replaces `dist/`. Serve it with a static host that resolves directory indexes; it ships no browser JavaScript. For local preview with rebuilds and hot reload:

```sh
bun run dev
```

This serves `dist/` on <http://localhost:8000/> (override with `PORT`) and reloads connected browsers on changes. The reload script is injected at serve time and never reaches the built files.

## License

ISC. See `LICENSE`.
