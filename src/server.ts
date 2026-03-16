import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerJiraTools } from "./tools/jira.js";
import { registerSalesforceTools } from "./tools/salesforce.js";
import { registerN8nTools } from "./tools/n8n.js";
import { logger } from "./clients/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server — creates and configures the server with all tools registered
// ─────────────────────────────────────────────────────────────────────────────

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "salesforce-ai-agent-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  logger.info("Registering MCP tools...");

  registerJiraTools(server);
  logger.info("Registered Jira tools: jira_get_story, jira_update_story_status, jira_post_comment, jira_search_stories");

  registerSalesforceTools(server);
  logger.info("Registered Salesforce tools: salesforce_get_object_fields, salesforce_create_custom_field, salesforce_create_validation_rule, salesforce_deploy_metadata, salesforce_get_deployment_status, salesforce_query");

  registerN8nTools(server);
  logger.info("Registered n8n tools: n8n_trigger_workflow, n8n_get_execution_status");

  return server;
}
