import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  n8nTriggerWorkflow,
  n8nGetExecutionStatus,
} from "../clients/n8nClient.js";
import { logger } from "../clients/logger.js";
import type { McpToolResult } from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// n8n MCP Tools
// ─────────────────────────────────────────────────────────────────────────────

function ok(data: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function fail(message: string, detail?: unknown): McpToolResult {
  logger.error(message, { detail: String(detail ?? "") });
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { error: message, detail: String(detail ?? "") },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─────────────────────────────────────────────────────────────────────────────

export function registerN8nTools(server: McpServer): void {
  // ── n8n_trigger_workflow ────────────────────────────────────────────────

  server.tool(
    "n8n_trigger_workflow",
    "Trigger a specific n8n workflow by its webhook URL, passing a JSON payload. This enables Claude to kick off the full Salesforce automation pipeline — for example, by sending a Jira issue key to start the analysis and deployment workflow.",
    {
      webhookUrl: z
        .string()
        .url()
        .describe(
          "The full n8n webhook URL for the workflow (e.g. https://your-n8n.com/webhook/abc123). Obtain this from the Webhook trigger node in your n8n workflow."
        ),
      payload: z
        .record(z.unknown())
        .describe(
          "JSON payload to send to the webhook. Structure depends on what the n8n workflow expects. For the Salesforce AI Agent pipeline, include fields like: { issueKey, projectKey, environment, triggeredBy }"
        ),
      waitForResponse: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true, the tool waits for a synchronous response from the webhook. If false (default), it fires-and-forgets and returns immediately. Set to true only for workflows configured with 'Respond to Webhook' node."
        ),
    },
    async ({ webhookUrl, payload, waitForResponse }) => {
      logger.info("tool:n8n_trigger_workflow", { webhookUrl, waitForResponse });
      try {
        const result = await n8nTriggerWorkflow(webhookUrl, payload);
        return ok({
          ...result,
          message: result.executionId
            ? `Workflow triggered successfully. Execution ID: ${result.executionId}. Use n8n_get_execution_status to poll for completion.`
            : "Workflow triggered successfully. No execution ID was returned — the workflow may be configured for fire-and-forget mode.",
          note: !waitForResponse
            ? "Trigger was fire-and-forget. Use n8n_get_execution_status with the executionId (if available) to check completion."
            : undefined,
        });
      } catch (err) {
        return fail(
          "Failed to trigger n8n workflow",
          extractErrorMessage(err)
        );
      }
    }
  );

  // ── n8n_get_execution_status ────────────────────────────────────────────

  server.tool(
    "n8n_get_execution_status",
    "Retrieve the current status and output data of an n8n workflow execution by its execution ID. Use this to poll whether a triggered workflow has completed successfully.",
    {
      executionId: z
        .string()
        .min(1)
        .describe(
          "The n8n execution ID returned by n8n_trigger_workflow or found in the n8n Executions panel"
        ),
    },
    async ({ executionId }) => {
      logger.info("tool:n8n_get_execution_status", { executionId });
      try {
        const execution = await n8nGetExecutionStatus(executionId);

        // Summarise the output data to avoid overwhelming token usage
        const summary = {
          id: execution.id,
          status: execution.status,
          finished: execution.finished,
          workflowId: execution.workflowId,
          workflowName: execution.workflowName,
          startedAt: execution.startedAt,
          stoppedAt: execution.stoppedAt,
          durationMs:
            execution.startedAt && execution.stoppedAt
              ? new Date(execution.stoppedAt).getTime() -
                new Date(execution.startedAt).getTime()
              : null,
          error: execution.data?.resultData?.error
            ? {
                message: execution.data.resultData.error.message,
              }
            : null,
          outputNodeCount: execution.data?.resultData?.runData
            ? Object.keys(execution.data.resultData.runData).length
            : 0,
          message: getExecutionMessage(
            execution.status,
            execution.finished
          ),
        };

        return ok(summary);
      } catch (err) {
        return fail(
          `Failed to retrieve n8n execution status for ${executionId}`,
          extractErrorMessage(err)
        );
      }
    }
  );
}

function getExecutionMessage(
  status: string,
  finished: boolean
): string {
  if (!finished) return "Execution is still running. Poll again in a few seconds.";
  switch (status) {
    case "success":
      return "Execution completed successfully.";
    case "error":
      return "Execution failed. Check the error field for details.";
    case "canceled":
      return "Execution was canceled.";
    case "waiting":
      return "Execution is waiting for a trigger or input.";
    default:
      return `Execution status: ${status}`;
  }
}
