import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";

vi.mock("axios");

// ── Shared mock setup ──────────────────────────────────────────────────────

const mockClient = {
  get: vi.fn(),
  post: vi.fn(),
};

beforeEach(() => {
  vi.mocked(axios.create).mockReturnValue(mockClient as never);

  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "test@example.com";
  process.env["JIRA_API_TOKEN"] = "test-api-token";
});

afterEach(() => {
  delete process.env["JIRA_BASE_URL"];
  delete process.env["JIRA_EMAIL"];
  delete process.env["JIRA_API_TOKEN"];
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRawIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "10001",
    key: "SFDC-123",
    fields: {
      summary: "Add custom field to Account",
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Deploy a new text field." }],
          },
        ],
      },
      status: { name: "To Do", statusCategory: { name: "To Do" } },
      assignee: { displayName: "Alice Smith" },
      reporter: { displayName: "Bob Jones" },
      priority: { name: "High" },
      labels: ["sf-config"],
      components: [{ name: "Salesforce" }],
      created: "2024-01-01T00:00:00.000Z",
      updated: "2024-01-02T00:00:00.000Z",
    },
    ...overrides,
  };
}

// ── jiraGetStory ───────────────────────────────────────────────────────────

describe("jiraGetStory", () => {
  it("fetches and parses a Jira issue with all core fields", async () => {
    mockClient.get.mockResolvedValue({ data: makeRawIssue() });

    const { jiraGetStory } = await import("../clients/jiraClient.js");
    const issue = await jiraGetStory("SFDC-123");

    expect(issue.id).toBe("10001");
    expect(issue.key).toBe("SFDC-123");
    expect(issue.summary).toBe("Add custom field to Account");
    expect(issue.status).toBe("To Do");
    expect(issue.assignee).toBe("Alice Smith");
    expect(issue.reporter).toBe("Bob Jones");
    expect(issue.priority).toBe("High");
    expect(issue.labels).toEqual(["sf-config"]);
    expect(issue.components).toEqual(["Salesforce"]);
  });

  it("constructs the issue URL from baseUrl + key", async () => {
    mockClient.get.mockResolvedValue({ data: makeRawIssue() });

    const { jiraGetStory } = await import("../clients/jiraClient.js");
    const issue = await jiraGetStory("SFDC-123");

    expect(issue.url).toBe("https://test.atlassian.net/browse/SFDC-123");
  });

  it("converts ADF paragraph nodes to plain text", async () => {
    const raw = makeRawIssue({
      fields: {
        ...makeRawIssue().fields,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "First paragraph." }],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "Second paragraph." }],
            },
          ],
        },
      },
    });
    mockClient.get.mockResolvedValue({ data: raw });

    const { jiraGetStory } = await import("../clients/jiraClient.js");
    const issue = await jiraGetStory("SFDC-123");

    expect(issue.descriptionText).toContain("First paragraph.");
    expect(issue.descriptionText).toContain("Second paragraph.");
  });

  it("converts ADF bullet list items with bullet markers", async () => {
    const raw = makeRawIssue({
      fields: {
        ...makeRawIssue().fields,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Item one" }],
                    },
                  ],
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Item two" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    mockClient.get.mockResolvedValue({ data: raw });

    const { jiraGetStory } = await import("../clients/jiraClient.js");
    const issue = await jiraGetStory("SFDC-123");

    expect(issue.descriptionText).toContain("•");
    expect(issue.descriptionText).toContain("Item one");
    expect(issue.descriptionText).toContain("Item two");
  });

  it("extracts acceptance criteria from customfield_10016", async () => {
    const raw = makeRawIssue({
      fields: {
        ...makeRawIssue().fields,
        customfield_10016: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Field must be required." }],
            },
          ],
        },
      },
    });
    mockClient.get.mockResolvedValue({ data: raw });

    const { jiraGetStory } = await import("../clients/jiraClient.js");
    const issue = await jiraGetStory("SFDC-123");

    expect(issue.acceptanceCriteria).toContain("Field must be required.");
  });

  it("handles null assignee and reporter gracefully", async () => {
    const raw = makeRawIssue({
      fields: {
        ...makeRawIssue().fields,
        assignee: null,
        reporter: null,
      },
    });
    mockClient.get.mockResolvedValue({ data: raw });

    const { jiraGetStory } = await import("../clients/jiraClient.js");
    const issue = await jiraGetStory("SFDC-123");

    expect(issue.assignee).toBeNull();
    expect(issue.reporter).toBeNull();
  });

  it("throws if JIRA_BASE_URL is missing", async () => {
    delete process.env["JIRA_BASE_URL"];

    const { jiraGetStory } = await import("../clients/jiraClient.js");

    await expect(jiraGetStory("SFDC-123")).rejects.toThrow(
      "Missing required Jira environment variables"
    );
  });
});

// ── jiraUpdateStoryStatus ──────────────────────────────────────────────────

describe("jiraUpdateStoryStatus", () => {
  const mockTransitions = {
    transitions: [
      { id: "11", name: "In Progress", to: { id: "3", name: "In Progress", statusCategory: { name: "In Progress" } } },
      { id: "21", name: "Done", to: { id: "5", name: "Done", statusCategory: { name: "Done" } } },
      { id: "31", name: "Blocked", to: { id: "6", name: "Blocked", statusCategory: { name: "Blocked" } } },
    ],
  };

  it("transitions the issue when target status matches exactly", async () => {
    mockClient.get
      .mockResolvedValueOnce({ data: { fields: { status: { name: "To Do" } } } })
      .mockResolvedValueOnce({ data: mockTransitions });
    mockClient.post.mockResolvedValue({});

    const { jiraUpdateStoryStatus } = await import("../clients/jiraClient.js");
    const result = await jiraUpdateStoryStatus("SFDC-123", "Done");

    expect(result.success).toBe(true);
    expect(result.previousStatus).toBe("To Do");
    expect(result.newStatus).toBe("Done");
    expect(mockClient.post).toHaveBeenCalledWith(
      "/issue/SFDC-123/transitions",
      { transition: { id: "21" } }
    );
  });

  it("matches target status case-insensitively", async () => {
    mockClient.get
      .mockResolvedValueOnce({ data: { fields: { status: { name: "To Do" } } } })
      .mockResolvedValueOnce({ data: mockTransitions });
    mockClient.post.mockResolvedValue({});

    const { jiraUpdateStoryStatus } = await import("../clients/jiraClient.js");
    const result = await jiraUpdateStoryStatus("SFDC-123", "in progress");

    expect(result.newStatus).toBe("In Progress");
  });

  it("throws with available transitions when target status is not found", async () => {
    mockClient.get
      .mockResolvedValueOnce({ data: { fields: { status: { name: "To Do" } } } })
      .mockResolvedValueOnce({ data: mockTransitions });

    const { jiraUpdateStoryStatus } = await import("../clients/jiraClient.js");

    await expect(
      jiraUpdateStoryStatus("SFDC-123", "Nonexistent Status")
    ).rejects.toThrow('Transition "Nonexistent Status" not found for SFDC-123');
  });

  it("includes available transition names in the error message", async () => {
    mockClient.get
      .mockResolvedValueOnce({ data: { fields: { status: { name: "To Do" } } } })
      .mockResolvedValueOnce({ data: mockTransitions });

    const { jiraUpdateStoryStatus } = await import("../clients/jiraClient.js");

    await expect(
      jiraUpdateStoryStatus("SFDC-123", "Unknown")
    ).rejects.toThrow("In Progress");
  });
});

// ── jiraPostComment ────────────────────────────────────────────────────────

describe("jiraPostComment", () => {
  it("posts an ADF body with paragraphs split by double newlines", async () => {
    mockClient.post.mockResolvedValue({
      data: {
        id: "comment-1",
        author: { displayName: "Alice Smith" },
        created: "2024-01-01T00:00:00.000Z",
        updated: "2024-01-01T00:00:00.000Z",
      },
    });

    const { jiraPostComment } = await import("../clients/jiraClient.js");
    await jiraPostComment("SFDC-123", "First paragraph.\n\nSecond paragraph.");

    const postBody = mockClient.post.mock.calls[0]?.[1] as Record<string, unknown>;
    const adfBody = postBody["body"] as {
      version: number;
      type: string;
      content: Array<{ type: string }>;
    };

    expect(adfBody.type).toBe("doc");
    expect(adfBody.version).toBe(1);
    expect(adfBody.content).toHaveLength(2);
    expect(adfBody.content[0]?.type).toBe("paragraph");
    expect(adfBody.content[1]?.type).toBe("paragraph");
  });

  it("returns a comment with id, author, and body", async () => {
    mockClient.post.mockResolvedValue({
      data: {
        id: "comment-42",
        author: { displayName: "Alice Smith" },
        created: "2024-01-01T00:00:00.000Z",
        updated: "2024-01-01T00:00:00.000Z",
      },
    });

    const { jiraPostComment } = await import("../clients/jiraClient.js");
    const comment = await jiraPostComment("SFDC-123", "Deployment complete.");

    expect(comment.id).toBe("comment-42");
    expect(comment.author).toBe("Alice Smith");
    expect(comment.body).toBe("Deployment complete.");
  });
});
