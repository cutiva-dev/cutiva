# Releasing

`@cutiva/core`, `@cutiva/web` and `@cutiva/react` are published to npm together and always share one version.

## Every PR

If a PR changes a published package, run `npm run changeset`, choose the bump (patch, minor or major; before 1.0, breaking changes are minor) and write one line for users. Commit the generated file in `.changeset/`.

## Cutting a release

1. Make sure `main` is green, including the E2E job.
2. `npm run version-packages`. This applies the pending changesets: it bumps the three versions, updates their dependencies on each other and writes `CHANGELOG.md` files.
3. Review the diff, then commit it as "Release vX.Y.Z" in a PR and merge it.
4. On the merged `main`, with an npm account that can publish to the `@cutiva` scope: `npm run release`. It builds, type-checks and tests, then publishes the packages whose version isn't on npm yet and creates git tags.
5. `git push --follow-tags`, and write the GitHub release from the changelog.

## Before the first release

- Create the `cutiva` organization on npm, so the `@cutiva` scope exists, and add the maintainers.
- Turn on two-factor authentication for publishing.

## What consumers need

- ESM only. The packages ship `dist` (JavaScript and `.d.ts`), the TypeScript sources for source maps, `LICENSE` and `NOTICE`.
- TypeScript users need `skipLibCheck: true` (the default in Vite and Next.js templates): Mediabunny's type dependencies don't type-check against every TypeScript DOM library.
- Export needs a browser that can encode H.264 with WebCodecs. Check `engine.capabilities()`.
