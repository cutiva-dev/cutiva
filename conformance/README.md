# Conformance suite

Every Cutiva SDK (TypeScript, Dart, Swift, Kotlin) must load each `*.cpf.json` fixture and produce exactly the values in its `*.expected.json`: total duration, which clip is visible at each sampled time and which source time it shows, and how many audio segments play. This is what keeps web, React Native and Flutter in agreement without sharing native code.

To add a case: write the fixture, write the expected values by hand from the spec (not by running an SDK), and add it to every SDK's test run.
