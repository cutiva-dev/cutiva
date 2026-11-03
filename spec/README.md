# spec

Machine-readable contracts.

- `reframe-track.schema.json`: params of the `core/reframe` clip effect (crop keys and the Reframe Track). See `docs/adr/0005-reframe-and-auto-reframe.md` and `docs/adr/0006-reframe-track-in-cpf.md`.
- `examples/`: valid examples. `packages/core/test/reframe-schema.test.ts` checks them, and every `core/reframe` effect in `conformance/fixtures`, against the schema.

Types stay hand-written in `packages/core/src/types.ts` and `packages/flutter/cutiva_core/lib/src/types.dart`. Change the schema, the types and the validation in `parseProject` together, and bump `track.version` with a migration when a track field changes.
