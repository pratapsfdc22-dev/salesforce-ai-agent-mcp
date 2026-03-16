import axios from "axios";
import { logger } from "./logger.js";
// ─────────────────────────────────────────────────────────────────────────────
// n8n Webhook + REST API Client
// ─────────────────────────────────────────────────────────────────────────────
function getN8nConfig() {
    const baseUrl = process.env["N8N_BASE_URL"];
    const apiKey = process.env["N8N_API_KEY"];
    if (!baseUrl) {
        throw new Error("Missing required n8n environment variable: N8N_BASE_URL");
    }
    return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}
// ── Public API ────────────────────────────────────────────────────────────
export async function n8nTriggerWorkflow(webhookUrl, payload) {
    logger.debug("n8nTriggerWorkflow", { webhookUrl });
    const { apiKey } = getN8nConfig();
    const headers = {
        "Content-Type": "application/json",
    };
    if (apiKey) {
        headers["X-N8N-API-KEY"] = apiKey;
    }
    const { data, status } = await axios.post(webhookUrl, payload, { headers, timeout: 30_000 });
    // n8n webhook responses vary — normalise to our type
    const result = {
        data,
        status: String(status),
    };
    // Try to extract execution ID from common n8n response shapes
    if (data && typeof data === "object") {
        const d = data;
        if (typeof d["executionId"] === "string") {
            result.executionId = d["executionId"];
        }
        else if (typeof d["id"] === "string") {
            result.executionId = d["id"];
        }
    }
    return result;
}
export async function n8nGetExecutionStatus(executionId) {
    const { baseUrl, apiKey } = getN8nConfig();
    logger.debug("n8nGetExecutionStatus", { executionId });
    if (!apiKey) {
        throw new Error("N8N_API_KEY is required to retrieve execution status. Set it in your environment.");
    }
    const { data } = await axios.get(`${baseUrl}/api/v1/executions/${encodeURIComponent(executionId)}`, {
        headers: {
            "X-N8N-API-KEY": apiKey,
            Accept: "application/json",
        },
        params: {
            includeData: true,
        },
        timeout: 30_000,
    });
    return data;
}
//# sourceMappingURL=n8nClient.js.map