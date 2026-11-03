# fixtures

Real videos for the reframe benchmark (`docs/reframe-mvp-spec.md`, "Set de fixtures"). They are downloaded, never committed:

```bash
./fixtures/fetch.sh   # reads manifest.json, checks every SHA-256, writes fixtures/videos/
```

Each entry in `manifest.json` names the clip, where it downloads from, its SHA-256, its license and who consented to appear in it. Faces are biometric data in several jurisdictions: only add footage whose speakers agreed to be used as public test data.

These videos are checked by thresholds (speaker accuracy, framing changes per minute, jitter) against hand-labelled "who speaks when" files, not byte for byte. Cross-platform determinism is covered by the synthetic, hand-written fixtures in `conformance/fixtures/auto-reframe/`.
