# ADR 0001: Share the contract, not a native binary

**Status:** accepted · 2026-10-28

## Context
Cutiva targets web, React Native and Flutter first. A shared C++/Rust core compiled to WASM and FFI would share code, but turns the first release into a cross-platform build project.

## Decision
What is shared is the **project format (CPF) and command semantics**, implemented in TypeScript for web and React Native, and ported to Dart for Flutter. Each platform renders with its native media engine (WebCodecs, AVFoundation, Media3). A conformance suite of fixtures with hand-written expected values keeps implementations in agreement.

## Consequences
- The web pilot can ship without native toolchains.
- Flutter needs a Dart port of the core. If keeping TypeScript and Dart in sync becomes costly, we move the core to Rust (phase 5), and the conformance suite makes that move safe.
