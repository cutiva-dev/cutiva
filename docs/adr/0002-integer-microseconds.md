# ADR 0002: Time is integer microseconds

**Status:** accepted · 2026-10-28

Floats of seconds drift after repeated splits and moves, and map differently across JavaScript, Dart, Swift and Kotlin. Every time in CPF and in the API is an integer number of microseconds (`Us`). Safe integers in JavaScript cover about 285 years, so overflow is not a concern.
