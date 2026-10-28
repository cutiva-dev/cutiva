# Contributing to Cutiva

Thanks for helping. A few rules keep the project healthy:

1. **Open an issue first** for anything bigger than a small fix, so we agree on the approach.
2. **Core changes need tests.** `@cutiva/core` is pure logic; keep coverage high. Behavior that every platform must share goes into `conformance/fixtures` with hand-written expected values.
3. **No new runtime dependency** without discussion. Allowed licenses: MIT, Apache-2.0, BSD, ISC, MPL-2.0. No GPL codecs.
4. **Times are integer microseconds.** Never store seconds as floats.
5. **Sign off your commits** (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/).

Before opening a PR: `npm run build && npm run typecheck && npm test`. If you touched `@cutiva/web`, `@cutiva/react` or the playground, also run `npm run e2e` (needs Google Chrome installed).
