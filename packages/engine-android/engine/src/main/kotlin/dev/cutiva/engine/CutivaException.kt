package dev.cutiva.engine

/**
 * Every error thrown by the engine carries a stable [code], the same strings as the other Cutiva SDKs:
 * `NOTHING_TO_EXPORT`, `UNSUPPORTED_FEATURE`, `EXPORT_CANCELLED`, `EXPORT_FAILED`, `INVALID_PROJECT`.
 */
class CutivaException(val code: String, message: String, cause: Throwable? = null) : Exception(message, cause)
