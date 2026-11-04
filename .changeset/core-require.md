---
"@cutiva/core": patch
---

CommonJS apps (NestJS, plain Node) can load `@cutiva/core` with `require()` on Node 20.19+ and 22.12+: the package now has a `default` export condition next to `import`.
