import axios, { type AxiosInstance } from "axios";
import type {
  JiraIssue,
  JiraTransition,
  JiraComment,
  JiraSearchResult,
  JiraDocumentNode,
} from "../types/index.js";
import { logger } from "./logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Jira REST API v3 Client
// Auth: HTTP Basic (email + API token)
// ─────────────────────────────────────────────────────────────────────────────

function getJiraConfig(): { baseUrl: string; email: string; apiToken: string } {
  const baseUrl = process.env["JIRA_BASE_URL"];
  const email = process.env["JIRA_EMAIL"];
  const apiToken = process.env["JIRA_API_TOKEN"];

  if (!baseUrl || !email || !apiToken) {
    throw new Error(
      "Missing required Jira environment variables: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN"
    );
  }

  return { baseUrl: baseUrl.replace(/\/$/, ""), email, apiToken };
}

function createJiraAxios(): AxiosInstance {
  const { baseUrl, email, apiToken } = getJiraConfig();
  const credentials = Buffer.from(`${email}:${apiToken}`).toString("base64");

  return axios.create({
    baseURL: `${baseUrl}/rest/api/3`,
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 30_000,
  });
}

// ── ADF (Atlassian Document Format) → plain text ──────────────────────────

function adfToText(node: JiraDocumentNode | null | undefined): string {
  if (!node) return "";

  if (node.type === "text") {
    return node.text ?? "";
  }

  const children = (node.content ?? []).map((c) => adfToText(c)).join("");

  switch (node.type) {
    case "paragraph":
      return children + "\n";
    case "heading":
      return children + "\n";
    case "bulletList":
    case "orderedList":
      return children;
    case "listItem":
      return `  • ${children.trim()}\n`;
    case "codeBlock":
      return "```\n" + children + "\n```\n";
    case "blockquote":
      return children
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    case "hardBreak":
      return "\n";
    case "rule":
      return "\n---\n";
    default:
      return children;
  }
}

// ── Issue parser ──────────────────────────────────────────────────────────

function parseIssue(raw: Record<string, unknown>, baseUrl: string): JiraIssue {
  const fields = (raw["fields"] as Record<string, unknown>) ?? {};

  const statusObj = fields["status"] as Record<string, unknown> | undefined;
  const statusCatObj = statusObj?.["statusCategory"] as
    | Record<string, unknown>
    | undefined;

  const assigneeObj = fields["assignee"] as Record<string, unknown> | undefined;
  const reporterObj = fields["reporter"] as Record<string, unknown> | undefined;
  const priorityObj = fields["priority"] as Record<string, unknown> | undefined;

  const labels = (fields["labels"] as string[] | undefined) ?? [];
  const components = (
    (fields["components"] as Array<Record<string, unknown>> | undefined) ?? []
  ).map((c) => String(c["name"] ?? ""));

  const descAdf = fields["description"] as JiraDocumentNode | null;
  const descriptionText = adfToText(descAdf);

  // Extract acceptance criteria from custom field (if present) or from description
  let acceptanceCriteria = "";
  const acField =
    fields["customfield_10016"] ??
    fields["customfield_10014"] ??
    fields["acceptance_criteria"];
  if (acField && typeof acField === "object") {
    acceptanceCriteria = adfToText(acField as JiraDocumentNode);
  } else if (typeof acField === "string") {
    acceptanceCriteria = acField;
  } else {
    // Try to extract from description
    const acMatch = descriptionText.match(
      /acceptance criteria[:\n]+([\s\S]*?)(?:\n\n|\n#|$)/i
    );
    if (acMatch?.[1]) acceptanceCriteria = acMatch[1].trim();
  }

  // Collect custom fields (cf_*)
  const customFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k.startsWith("customfield_") && v !== null) {
      customFields[k] = v;
    }
  }

  const key = String(raw["key"] ?? "");

  return {
    id: String(raw["id"] ?? ""),
    key,
    summary: String(fields["summary"] ?? ""),
    description: descAdf,
    descriptionText: descriptionText.trim(),
    status: String(statusObj?.["name"] ?? ""),
    statusCategory: String(statusCatObj?.["name"] ?? ""),
    assignee: assigneeObj
      ? String(
          assigneeObj["displayName"] ?? assigneeObj["emailAddress"] ?? ""
        )
      : null,
    reporter: reporterObj
      ? String(
          reporterObj["displayName"] ?? reporterObj["emailAddress"] ?? ""
        )
      : null,
    priority: priorityObj ? String(priorityObj["name"] ?? "") : null,
    labels,
    components,
    acceptanceCriteria,
    customFields,
    created: String(fields["created"] ?? ""),
    updated: String(fields["updated"] ?? ""),
    url: `${baseUrl}/browse/${key}`,
  };
}

// ── Public API ────────────────────────────────────────────────────────────

export async function jiraGetStory(issueKey: string): Promise<JiraIssue> {
  const client = createJiraAxios();
  const { baseUrl } = getJiraConfig();

  logger.debug("jiraGetStory", { issueKey });

  const { data } = await client.get<Record<string, unknown>>(
    `/issue/${encodeURIComponent(issueKey)}`,
    {
      params: {
        expand: "renderedFields,names,schema",
      },
    }
  );

  return parseIssue(data, baseUrl);
}

export async function jiraUpdateStoryStatus(
  issueKey: string,
  targetStatus: string
): Promise<{ success: boolean; previousStatus: string; newStatus: string }> {
  const client = createJiraAxios();

  logger.debug("jiraUpdateStoryStatus", { issueKey, targetStatus });

  // 1. Get current issue to know the current status
  const { data: issue } = await client.get<Record<string, unknown>>(
    `/issue/${encodeURIComponent(issueKey)}`,
    { params: { fields: "status" } }
  );
  const fields = issue["fields"] as Record<string, unknown>;
  const currentStatus = String(
    (fields["status"] as Record<string, unknown> | undefined)?.["name"] ?? ""
  );

  // 2. Get available transitions
  const { data: transitionsData } = await client.get<{
    transitions: JiraTransition[];
  }>(`/issue/${encodeURIComponent(issueKey)}/transitions`);

  const transitions = transitionsData.transitions ?? [];
  const normalised = targetStatus.toLowerCase().trim();

  const match = transitions.find(
    (t) => t.name.toLowerCase().trim() === normalised
  );

  if (!match) {
    const available = transitions.map((t) => t.name).join(", ");
    throw new Error(
      `Transition "${targetStatus}" not found for ${issueKey}. Available: ${available}`
    );
  }

  // 3. Perform the transition
  await client.post(`/issue/${encodeURIComponent(issueKey)}/transitions`, {
    transition: { id: match.id },
  });

  return {
    success: true,
    previousStatus: currentStatus,
    newStatus: match.to.name,
  };
}

export async function jiraPostComment(
  issueKey: string,
  body: string
): Promise<JiraComment> {
  const client = createJiraAxios();

  logger.debug("jiraPostComment", { issueKey, bodyLength: body.length });

  // Post as ADF paragraph for rich rendering
  const adfBody = {
    version: 1,
    type: "doc",
    content: body
      .split("\n\n")
      .filter(Boolean)
      .map((para) => ({
        type: "paragraph",
        content: [{ type: "text", text: para }],
      })),
  };

  const { data } = await client.post<Record<string, unknown>>(
    `/issue/${encodeURIComponent(issueKey)}/comment`,
    { body: adfBody }
  );

  const author = data["author"] as Record<string, unknown> | undefined;

  return {
    id: String(data["id"] ?? ""),
    author: String(author?.["displayName"] ?? author?.["emailAddress"] ?? ""),
    body,
    created: String(data["created"] ?? ""),
    updated: String(data["updated"] ?? ""),
  };
}

export async function jiraSearchStories(
  jql: string,
  maxResults = 50,
  startAt = 0
): Promise<JiraSearchResult> {
  const client = createJiraAxios();
  const { baseUrl } = getJiraConfig();

  logger.debug("jiraSearchStories", { jql, maxResults, startAt });

  const { data } = await client.post<{
    total: number;
    startAt: number;
    maxResults: number;
    issues: Record<string, unknown>[];
  }>("/search", {
    jql,
    maxResults: Math.min(maxResults, 100),
    startAt,
    fields: [
      "summary",
      "description",
      "status",
      "assignee",
      "reporter",
      "priority",
      "labels",
      "components",
      "created",
      "updated",
      "customfield_10016",
    ],
  });

  return {
    total: data.total,
    startAt: data.startAt,
    maxResults: data.maxResults,
    issues: (data.issues ?? []).map((i) => parseIssue(i, baseUrl)),
  };
}
