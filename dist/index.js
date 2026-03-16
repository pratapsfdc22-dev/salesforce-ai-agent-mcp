#!/usr/bin/env node
/**
 * Salesforce AI Agent MCP Server
 *
 * Supports two transport modes:
 *  - stdio (default): For Claude Desktop / Claude Code / VS Code MCP extension
 *  - SSE (--sse flag):  For remote / n8n integration via HTTP Server-Sent Events
 *
 * Usage:
 *   node dist/index.js           # stdio mode
 *   node dist/index.js --sse     # SSE mode (HTTP server on MCP_PORT, default 3000)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { createServer } from "./server.js";
import { logger } from "./clients/logger.js";
// ── Detect transport mode ─────────────────────────────────────────────────
const useSSE = process.argv.includes("--sse") ||
    process.env["MCP_TRANSPORT"] === "sse";
// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
    if (useSSE) {
        await startSseServer();
    }
    else {
        await startStdioServer();
    }
}
// ── stdio transport ───────────────────────────────────────────────────────
async function startStdioServer() {
    logger.info("Starting MCP server in stdio mode");
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("MCP server connected via stdio — ready for requests");
    // Keep the process alive until the transport closes
    process.on("SIGINT", async () => {
        logger.info("Received SIGINT, shutting down...");
        await server.close();
        process.exit(0);
    });
    process.on("SIGTERM", async () => {
        logger.info("Received SIGTERM, shutting down...");
        await server.close();
        process.exit(0);
    });
}
// ── SSE transport ─────────────────────────────────────────────────────────
async function startSseServer() {
    const port = parseInt(process.env["MCP_PORT"] ?? "3000", 10);
    logger.info(`Starting MCP server in SSE mode on port ${port}`);
    const app = express();
    app.use(express.json());
    // Map of sessionId → transport (one per connected client)
    const transports = new Map();
    // ── GET /sse — client connects and opens an SSE stream ──────────────────
    app.get("/sse", async (req, res) => {
        logger.info("SSE client connected", { ip: req.ip });
        // Create a new server instance per connection so tools don't share state
        const server = createServer();
        const transport = new SSEServerTransport("/messages", res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);
        res.on("close", () => {
            logger.info("SSE client disconnected", { sessionId });
            transports.delete(sessionId);
        });
        try {
            await server.connect(transport);
            logger.info("MCP server connected via SSE", { sessionId });
        }
        catch (err) {
            logger.error("Failed to connect SSE transport", {
                sessionId,
                error: String(err),
            });
            transports.delete(sessionId);
        }
    });
    // ── POST /messages — client sends MCP messages ──────────────────────────
    app.post("/messages", async (req, res) => {
        const sessionId = req.query["sessionId"];
        if (!sessionId) {
            res.status(400).json({ error: "Missing sessionId query parameter" });
            return;
        }
        const transport = transports.get(sessionId);
        if (!transport) {
            res.status(404).json({
                error: `Session '${sessionId}' not found. Connect to /sse first.`,
            });
            return;
        }
        try {
            await transport.handlePostMessage(req, res);
        }
        catch (err) {
            logger.error("Error handling POST /messages", {
                sessionId,
                error: String(err),
            });
            if (!res.headersSent) {
                res.status(500).json({ error: "Internal server error" });
            }
        }
    });
    // ── GET /health — liveness probe ─────────────────────────────────────────
    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            server: "salesforce-ai-agent-mcp",
            version: "1.0.0",
            transport: "sse",
            activeSessions: transports.size,
            uptime: Math.floor(process.uptime()),
        });
    });
    // ── Start ─────────────────────────────────────────────────────────────────
    await new Promise((resolve, reject) => {
        const httpServer = app.listen(port, () => {
            logger.info(`MCP SSE server listening`, {
                port,
                endpoints: {
                    sse: `http://localhost:${port}/sse`,
                    messages: `http://localhost:${port}/messages`,
                    health: `http://localhost:${port}/health`,
                },
            });
            resolve();
        });
        httpServer.on("error", (err) => {
            logger.error("HTTP server error", { error: String(err) });
            reject(err);
        });
        process.on("SIGINT", () => {
            logger.info("Received SIGINT, shutting down SSE server...");
            httpServer.close(() => process.exit(0));
        });
        process.on("SIGTERM", () => {
            logger.info("Received SIGTERM, shutting down SSE server...");
            httpServer.close(() => process.exit(0));
        });
    });
}
// ── Unhandled error safety net ────────────────────────────────────────────
process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", { error: err.message, stack: err.stack });
    process.exit(1);
});
process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { reason: String(reason) });
    process.exit(1);
});
main().catch((err) => {
    logger.error("Fatal startup error", { error: String(err) });
    process.exit(1);
});
//# sourceMappingURL=index.js.map