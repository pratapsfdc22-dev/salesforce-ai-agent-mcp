import type { N8nExecution, N8nWebhookResponse } from "../types/index.js";
export declare function n8nTriggerWorkflow(webhookUrl: string, payload: Record<string, unknown>): Promise<N8nWebhookResponse>;
export declare function n8nGetExecutionStatus(executionId: string): Promise<N8nExecution>;
//# sourceMappingURL=n8nClient.d.ts.map