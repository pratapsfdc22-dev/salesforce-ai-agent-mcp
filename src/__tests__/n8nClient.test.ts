import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";

vi.mock("axios");

// ── Shared setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  process.env["N8N_BASE_URL"] = "https://n8n.example.com";
  process.env["N8N_API_KEY"] = "test-api-key";
});

afterEach(() => {
  delete process.env["N8N_BASE_URL"];
  delete process.env["N8N_API_KEY"];
});

// ── n8nTriggerWorkflow ─────────────────────────────────────────────────────

describe("n8nTriggerWorkflow", () => {
  it("posts payload to the webhook URL and returns a response", async () => {
    vi.mocked(axios.post).mockResolvedValue({
      status: 200,
      data: { message: "Workflow queued" },
    });

    const { n8nTriggerWorkflow } = await import("../clients/n8nClient.js");
    const result = await n8nTriggerWorkflow(
      "https://n8n.example.com/webhook/abc123",
      { issueKey: "SFDC-99" }
    );

    expect(axios.post).toHaveBeenCalledWith(
      "https://n8n.example.com/webhook/abc123",
      { issueKey: "SFDC-99" },
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
    expect(result.status).toBe("200");
  });

  it("extracts executionId from the executionId field in the response", async () => {
    vi.mocked(axios.post).mockResolvedValue({
      status: 200,
      data: { executionId: "exec-001", message: "ok" },
    });

    const { n8nTriggerWorkflow } = await import("../clients/n8nClient.js");
    const result = await n8nTriggerWorkflow("https://n8n.example.com/webhook/xyz", {});

    expect(result.executionId).toBe("exec-001");
  });

  it("falls back to id field when executionId is absent", async () => {
    vi.mocked(axios.post).mockResolvedValue({
      status: 200,
      data: { id: "exec-002", status: "running" },
    });

    const { n8nTriggerWorkflow } = await import("../clients/n8nClient.js");
    const result = await n8nTriggerWorkflow("https://n8n.example.com/webhook/xyz", {});

    expect(result.executionId).toBe("exec-002");
  });

  it("returns undefined executionId when neither field is present", async () => {
    vi.mocked(axios.post).mockResolvedValue({
      status: 200,
      data: { message: "fired" },
    });

    const { n8nTriggerWorkflow } = await import("../clients/n8nClient.js");
    const result = await n8nTriggerWorkflow("https://n8n.example.com/webhook/xyz", {});

    expect(result.executionId).toBeUndefined();
  });

  it("includes X-N8N-API-KEY header when N8N_API_KEY is set", async () => {
    vi.mocked(axios.post).mockResolvedValue({ status: 200, data: {} });

    const { n8nTriggerWorkflow } = await import("../clients/n8nClient.js");
    await n8nTriggerWorkflow("https://n8n.example.com/webhook/xyz", {});

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-N8N-API-KEY": "test-api-key" }),
      })
    );
  });

  it("does not include X-N8N-API-KEY header when N8N_API_KEY is absent", async () => {
    delete process.env["N8N_API_KEY"];
    vi.mocked(axios.post).mockResolvedValue({ status: 200, data: {} });

    const { n8nTriggerWorkflow } = await import("../clients/n8nClient.js");
    await n8nTriggerWorkflow("https://n8n.example.com/webhook/xyz", {});

    const callArgs = vi.mocked(axios.post).mock.calls[0];
    const headers = (callArgs?.[2] as { headers: Record<string, string> })?.headers;
    expect(headers?.["X-N8N-API-KEY"]).toBeUndefined();
  });

  it("throws if N8N_BASE_URL is not set", async () => {
    delete process.env["N8N_BASE_URL"];

    const { n8nTriggerWorkflow } = await import("../clients/n8nClient.js");
    await expect(
      n8nTriggerWorkflow("https://n8n.example.com/webhook/xyz", {})
    ).rejects.toThrow("N8N_BASE_URL");
  });
});

// ── n8nGetExecutionStatus ──────────────────────────────────────────────────

describe("n8nGetExecutionStatus", () => {
  const mockExecution = {
    id: "exec-001",
    finished: true,
    mode: "webhook",
    startedAt: "2024-01-01T00:00:00.000Z",
    stoppedAt: "2024-01-01T00:00:05.000Z",
    status: "success" as const,
    workflowId: "wf-001",
    workflowName: "Salesforce Pipeline",
    data: {
      resultData: {
        runData: { "Webhook": [{}], "HTTP Request": [{}] },
      },
    },
  };

  it("calls the n8n REST API with the correct execution ID and auth header", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: mockExecution });

    const { n8nGetExecutionStatus } = await import("../clients/n8nClient.js");
    const result = await n8nGetExecutionStatus("exec-001");

    expect(axios.get).toHaveBeenCalledWith(
      "https://n8n.example.com/api/v1/executions/exec-001",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-N8N-API-KEY": "test-api-key" }),
        params: { includeData: true },
      })
    );
    expect(result.id).toBe("exec-001");
    expect(result.status).toBe("success");
    expect(result.finished).toBe(true);
  });

  it("URL-encodes execution IDs that contain special characters", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { ...mockExecution, id: "exec/001" } });

    const { n8nGetExecutionStatus } = await import("../clients/n8nClient.js");
    await n8nGetExecutionStatus("exec/001");

    expect(axios.get).toHaveBeenCalledWith(
      "https://n8n.example.com/api/v1/executions/exec%2F001",
      expect.anything()
    );
  });

  it("throws a clear error when N8N_API_KEY is not set", async () => {
    delete process.env["N8N_API_KEY"];

    const { n8nGetExecutionStatus } = await import("../clients/n8nClient.js");
    await expect(n8nGetExecutionStatus("exec-001")).rejects.toThrow(
      "N8N_API_KEY is required"
    );
  });

  it("throws if N8N_BASE_URL is not set", async () => {
    delete process.env["N8N_BASE_URL"];

    const { n8nGetExecutionStatus } = await import("../clients/n8nClient.js");
    await expect(n8nGetExecutionStatus("exec-001")).rejects.toThrow("N8N_BASE_URL");
  });
});
