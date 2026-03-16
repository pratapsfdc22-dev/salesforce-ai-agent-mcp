// ─────────────────────────────────────────────────────────────────────────────
// Structured JSON logger — writes to stderr so it never interferes with
// MCP stdio transport on stdout.
// ─────────────────────────────────────────────────────────────────────────────
const LEVEL_PRIORITY = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
function currentLevel() {
    const raw = (process.env["LOG_LEVEL"] ?? "info").toLowerCase();
    if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
        return raw;
    }
    return "info";
}
function emit(level, message, meta) {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel()])
        return;
    const entry = {
        level,
        timestamp: new Date().toISOString(),
        message,
        ...meta,
    };
    process.stderr.write(JSON.stringify(entry) + "\n");
}
export const logger = {
    debug: (message, meta) => emit("debug", message, meta),
    info: (message, meta) => emit("info", message, meta),
    warn: (message, meta) => emit("warn", message, meta),
    error: (message, meta) => emit("error", message, meta),
};
//# sourceMappingURL=logger.js.map