// ─────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types for the Salesforce AI Agent MCP server
// ─────────────────────────────────────────────────────────────────────────────

// ── MCP Tool Response ──────────────────────────────────────────────────────

export interface McpToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// ── Jira Types ────────────────────────────────────────────────────────────

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  description: JiraDocumentNode | null;
  descriptionText: string;
  status: string;
  statusCategory: string;
  assignee: string | null;
  reporter: string | null;
  priority: string | null;
  labels: string[];
  components: string[];
  acceptanceCriteria: string;
  customFields: Record<string, unknown>;
  created: string;
  updated: string;
  url: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: {
    id: string;
    name: string;
    statusCategory: { name: string };
  };
}

export interface JiraComment {
  id: string;
  author: string;
  body: string;
  created: string;
  updated: string;
}

export interface JiraSearchResult {
  total: number;
  issues: JiraIssue[];
  startAt: number;
  maxResults: number;
}

export interface JiraDocumentNode {
  type: string;
  content?: JiraDocumentNode[];
  text?: string;
  attrs?: Record<string, unknown>;
}

// ── Salesforce Types ───────────────────────────────────────────────────────

export interface SalesforceAuthToken {
  accessToken: string;
  instanceUrl: string;
  tokenType: string;
  issuedAt: number;
}

export interface SalesforceField {
  name: string;
  label: string;
  type: string;
  length?: number;
  precision?: number;
  scale?: number;
  nillable: boolean;
  createable: boolean;
  updateable: boolean;
  custom: boolean;
  referenceTo?: string[];
  picklistValues?: Array<{ label: string; value: string; active: boolean }>;
}

export interface SalesforceObjectDescribe {
  name: string;
  label: string;
  fields: SalesforceField[];
  custom: boolean;
  queryable: boolean;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
}

export interface SalesforceQueryResult<T = Record<string, unknown>> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

export type SalesforceFieldType =
  | "Text"
  | "Number"
  | "Currency"
  | "Picklist"
  | "MultiSelectPicklist"
  | "Checkbox"
  | "Date"
  | "DateTime"
  | "Email"
  | "Phone"
  | "URL"
  | "TextArea"
  | "LongTextArea"
  | "RichTextArea"
  | "Lookup"
  | "MasterDetail"
  | "Percent"
  | "AutoNumber"
  | "Formula";

export interface SalesforceCustomFieldPayload {
  FullName: string;
  Metadata: SalesforceCustomFieldMetadata;
}

export interface SalesforceCustomFieldMetadata {
  type: string;
  label: string;
  length?: number;
  precision?: number;
  scale?: number;
  required?: boolean;
  unique?: boolean;
  externalId?: boolean;
  description?: string;
  inlineHelpText?: string;
  defaultValue?: string;
  referenceTo?: string;
  relationshipName?: string;
  relationshipOrder?: number;
  visibleLines?: number;
  formula?: string;
  formulaTreatNullNumberAsZero?: boolean;
  startingNumber?: number;
  displayFormat?: string;
  valueSet?: {
    restricted?: boolean;
    valueSetDefinition?: {
      sorted?: boolean;
      value: Array<{ fullName: string; label: string; default?: boolean }>;
    };
  };
}

export interface SalesforceValidationRulePayload {
  FullName: string;
  Metadata: {
    active: boolean;
    description?: string;
    errorConditionFormula: string;
    errorDisplayField?: string | null;
    errorMessage: string;
  };
}

export interface SalesforceDeployOptions {
  allowMissingFiles?: boolean;
  autoUpdatePackage?: boolean;
  checkOnly?: boolean;
  ignoreWarnings?: boolean;
  performRetrieve?: boolean;
  purgeOnDelete?: boolean;
  rollbackOnError?: boolean;
  runTests?: string[];
  singlePackage?: boolean;
  testLevel?: "NoTestRun" | "RunSpecifiedTests" | "RunLocalTests" | "RunAllTestsInOrg";
}

export interface SalesforceDeployResult {
  id: string;
  status: string;
  success: boolean;
  done: boolean;
  numberComponentErrors: number;
  numberComponentsDeployed: number;
  numberComponentsTotal: number;
  numberTestErrors: number;
  numberTestsCompleted: number;
  numberTestsTotal: number;
  details?: {
    componentFailures?: SalesforceDeployFailure[];
    componentSuccesses?: SalesforceDeploySuccess[];
    runTestResult?: {
      numFailures: number;
      numTestsRun: number;
      failures?: Array<{ name: string; methodName: string; message: string }>;
    };
  };
  errorMessage?: string;
  errorStatusCode?: string;
}

export interface SalesforceDeployFailure {
  changed: boolean;
  componentType: string;
  created: boolean;
  deleted: boolean;
  fileName: string;
  fullName: string;
  problem: string;
  problemType: string;
  success: boolean;
}

export interface SalesforceDeploySuccess {
  changed: boolean;
  componentType: string;
  created: boolean;
  deleted: boolean;
  fileName: string;
  fullName: string;
  success: boolean;
}

// ── n8n Types ─────────────────────────────────────────────────────────────

export interface N8nExecution {
  id: string;
  finished: boolean;
  mode: string;
  startedAt: string;
  stoppedAt?: string;
  status: "running" | "success" | "error" | "canceled" | "waiting" | "new";
  workflowId: string;
  workflowName?: string;
  data?: {
    resultData?: {
      runData?: Record<string, unknown[]>;
      error?: { message: string; stack?: string };
    };
  };
}

export interface N8nWebhookResponse {
  executionId?: string;
  data?: unknown;
  status?: string;
}

// ── Logger ────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  tool?: string;
  error?: string;
  [key: string]: unknown;
}
