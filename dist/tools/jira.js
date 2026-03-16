import { z } from "zod";
import { jiraGetStory, jiraUpdateStoryStatus, jiraPostComment, jiraSearchStories, } from "../clients/jiraClient.js";
import { logger } from "../clients/logger.js";
// ─────────────────────────────────────────────────────────────────────────────
// Jira MCP Tools
// ─────────────────────────────────────────────────────────────────────────────
function ok(data) {
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
}
function fail(message, detail) {
    logger.error(message, { detail: String(detail ?? "") });
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ error: message, detail: String(detail ?? "") }, null, 2),
            },
        ],
        isError: true,
    };
}
function extractErrorMessage(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
// ─────────────────────────────────────────────────────────────────────────────
export function registerJiraTools(server) {
    // ── jira_get_story ──────────────────────────────────────────────────────
    server.tool("jira_get_story", "Fetch a Jira story by issue key. Returns summary, description, acceptance criteria, status, labels, assignee, and all custom fields.", {
        issueKey: z
            .string()
            .min(1)
            .describe("Jira issue key in the format PROJECT-NNN (e.g. SFDC-123)"),
    }, async ({ issueKey }) => {
        logger.info("tool:jira_get_story", { issueKey });
        try {
            const issue = await jiraGetStory(issueKey);
            return ok(issue);
        }
        catch (err) {
            return fail(`Failed to fetch Jira story ${issueKey}`, extractErrorMessage(err));
        }
    });
    // ── jira_update_story_status ────────────────────────────────────────────
    server.tool("jira_update_story_status", "Transition a Jira story to a new status. The available transitions depend on the current workflow configuration. Common statuses: 'To Do', 'In Progress', 'In Review', 'Done', 'Blocked'.", {
        issueKey: z
            .string()
            .min(1)
            .describe("Jira issue key (e.g. SFDC-123)"),
        targetStatus: z
            .string()
            .min(1)
            .describe("The target workflow status name (e.g. 'In Progress', 'Done', 'Blocked'). Must match an available transition exactly."),
    }, async ({ issueKey, targetStatus }) => {
        logger.info("tool:jira_update_story_status", { issueKey, targetStatus });
        try {
            const result = await jiraUpdateStoryStatus(issueKey, targetStatus);
            return ok({
                ...result,
                message: `Successfully transitioned ${issueKey} from "${result.previousStatus}" to "${result.newStatus}"`,
            });
        }
        catch (err) {
            return fail(`Failed to update status for ${issueKey}`, extractErrorMessage(err));
        }
    });
    // ── jira_post_comment ───────────────────────────────────────────────────
    server.tool("jira_post_comment", "Post a comment to a Jira story. Used by the AI agent to document deployment results, ask for clarification, or provide status updates. Supports plain text with paragraphs separated by blank lines.", {
        issueKey: z
            .string()
            .min(1)
            .describe("Jira issue key (e.g. SFDC-123)"),
        body: z
            .string()
            .min(1)
            .describe("Comment text. Use double newlines to separate paragraphs. Supports plain text — rich formatting will be preserved as ADF."),
    }, async ({ issueKey, body }) => {
        logger.info("tool:jira_post_comment", {
            issueKey,
            bodyLength: body.length,
        });
        try {
            const comment = await jiraPostComment(issueKey, body);
            return ok({
                ...comment,
                message: `Comment posted successfully to ${issueKey}`,
            });
        }
        catch (err) {
            return fail(`Failed to post comment to ${issueKey}`, extractErrorMessage(err));
        }
    });
    // ── jira_search_stories ─────────────────────────────────────────────────
    server.tool("jira_search_stories", "Search Jira stories using JQL (Jira Query Language). Returns matching issues with full details. Example JQL: 'label = \"sf-config\" AND status = \"To Do\" AND project = SFDC ORDER BY created DESC'", {
        jql: z
            .string()
            .min(1)
            .describe("JQL query string. Examples: 'project = SFDC AND status = \"To Do\"', 'label = \"sf-config\" AND assignee = currentUser()', 'issuetype = Story AND sprint in openSprints()'"),
        maxResults: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(50)
            .describe("Maximum number of results to return (1–100, default 50)"),
        startAt: z
            .number()
            .int()
            .min(0)
            .default(0)
            .describe("Zero-based offset for pagination (default 0)"),
    }, async ({ jql, maxResults, startAt }) => {
        logger.info("tool:jira_search_stories", { jql, maxResults, startAt });
        try {
            const result = await jiraSearchStories(jql, maxResults, startAt);
            return ok({
                total: result.total,
                returned: result.issues.length,
                startAt: result.startAt,
                maxResults: result.maxResults,
                issues: result.issues,
            });
        }
        catch (err) {
            return fail("Failed to search Jira stories", extractErrorMessage(err));
        }
    });
}
//# sourceMappingURL=jira.js.map