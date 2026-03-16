import axios, { type AxiosInstance } from "axios";
import type {
  SalesforceAuthToken,
  SalesforceField,
  SalesforceObjectDescribe,
  SalesforceQueryResult,
  SalesforceFieldType,
  SalesforceCustomFieldPayload,
  SalesforceCustomFieldMetadata,
  SalesforceValidationRulePayload,
  SalesforceDeployOptions,
  SalesforceDeployResult,
} from "../types/index.js";
import { logger } from "./logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Salesforce Tooling API + Metadata API Client
// Auth: OAuth 2.0 Username–Password flow with automatic token refresh
// ─────────────────────────────────────────────────────────────────────────────

// Token cache (module-level singleton)
let cachedToken: SalesforceAuthToken | null = null;
const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutes (tokens expire at 60 min)

function getSfConfig() {
  const loginUrl = process.env["SF_LOGIN_URL"];
  const clientId = process.env["SF_CLIENT_ID"];
  const clientSecret = process.env["SF_CLIENT_SECRET"];
  const username = process.env["SF_USERNAME"];
  const password = process.env["SF_PASSWORD"];
  const securityToken = process.env["SF_SECURITY_TOKEN"] ?? "";
  const apiVersion = process.env["SF_API_VERSION"] ?? "v61.0";

  if (!loginUrl || !clientId || !clientSecret || !username || !password) {
    throw new Error(
      "Missing required Salesforce environment variables: SF_LOGIN_URL, SF_CLIENT_ID, SF_CLIENT_SECRET, SF_USERNAME, SF_PASSWORD"
    );
  }

  return {
    loginUrl: loginUrl.replace(/\/$/, ""),
    clientId,
    clientSecret,
    username,
    password,
    securityToken,
    apiVersion,
  };
}

// ── OAuth Token Management ────────────────────────────────────────────────

async function fetchToken(): Promise<SalesforceAuthToken> {
  const cfg = getSfConfig();

  logger.debug("salesforceClient: fetching OAuth token");

  const params = new URLSearchParams({
    grant_type: "password",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    username: cfg.username,
    // Security token must be appended directly to password (no space)
    password: cfg.password + cfg.securityToken,
  });

  const { data } = await axios.post<{
    access_token: string;
    instance_url: string;
    token_type: string;
    issued_at: string;
  }>(`${cfg.loginUrl}/services/oauth2/token`, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 30_000,
  });

  const token: SalesforceAuthToken = {
    accessToken: data.access_token,
    instanceUrl: data.instance_url.replace(/\/$/, ""),
    tokenType: data.token_type,
    issuedAt: Date.now(),
  };

  cachedToken = token;
  logger.info("salesforceClient: OAuth token acquired", {
    instanceUrl: token.instanceUrl,
  });

  return token;
}

async function getToken(): Promise<SalesforceAuthToken> {
  if (
    cachedToken &&
    Date.now() - cachedToken.issuedAt < TOKEN_TTL_MS
  ) {
    return cachedToken;
  }
  return fetchToken();
}

function createSfAxios(token: SalesforceAuthToken, tooling = false): AxiosInstance {
  const cfg = getSfConfig();
  const basePath = tooling
    ? `/services/data/${cfg.apiVersion}/tooling`
    : `/services/data/${cfg.apiVersion}`;

  return axios.create({
    baseURL: `${token.instanceUrl}${basePath}`,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 60_000,
  });
}

// Auto-refresh wrapper — retries once on 401
async function sfRequest<T>(
  fn: (client: AxiosInstance, toolingClient: AxiosInstance) => Promise<T>
): Promise<T> {
  let token = await getToken();
  try {
    return await fn(createSfAxios(token, false), createSfAxios(token, true));
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      logger.info("salesforceClient: token expired, refreshing...");
      cachedToken = null;
      token = await fetchToken();
      return await fn(createSfAxios(token, false), createSfAxios(token, true));
    }
    throw err;
  }
}

// ── Field Type Mapping ────────────────────────────────────────────────────

const FIELD_TYPE_MAP: Record<SalesforceFieldType, string> = {
  Text: "Text",
  Number: "Number",
  Currency: "Currency",
  Picklist: "Picklist",
  MultiSelectPicklist: "MultiselectPicklist",
  Checkbox: "Checkbox",
  Date: "Date",
  DateTime: "DateTime",
  Email: "Email",
  Phone: "Phone",
  URL: "Url",
  TextArea: "TextArea",
  LongTextArea: "LongTextArea",
  RichTextArea: "Html",
  Lookup: "Lookup",
  MasterDetail: "MasterDetail",
  Percent: "Percent",
  AutoNumber: "AutoNumber",
  Formula: "Text", // formula type is set via formulaTreatNullNumberAsZero + formula
};

// ── Public API ────────────────────────────────────────────────────────────

export async function sfGetObjectFields(
  objectName: string
): Promise<SalesforceObjectDescribe> {
  logger.debug("sfGetObjectFields", { objectName });

  return sfRequest(async (client) => {
    const { data } = await client.get<{
      name: string;
      label: string;
      custom: boolean;
      queryable: boolean;
      createable: boolean;
      updateable: boolean;
      deletable: boolean;
      fields: Array<Record<string, unknown>>;
    }>(`/sobjects/${encodeURIComponent(objectName)}/describe`);

    const fields: SalesforceField[] = (data.fields ?? []).map((f) => ({
      name: String(f["name"] ?? ""),
      label: String(f["label"] ?? ""),
      type: String(f["type"] ?? ""),
      length: typeof f["length"] === "number" ? f["length"] : undefined,
      precision:
        typeof f["precision"] === "number" ? f["precision"] : undefined,
      scale: typeof f["scale"] === "number" ? f["scale"] : undefined,
      nillable: Boolean(f["nillable"]),
      createable: Boolean(f["createable"]),
      updateable: Boolean(f["updateable"]),
      custom: Boolean(f["custom"]),
      referenceTo: Array.isArray(f["referenceTo"])
        ? (f["referenceTo"] as string[])
        : undefined,
      picklistValues: Array.isArray(f["picklistValues"])
        ? (f["picklistValues"] as Array<Record<string, unknown>>).map((p) => ({
            label: String(p["label"] ?? ""),
            value: String(p["value"] ?? ""),
            active: Boolean(p["active"]),
          }))
        : undefined,
    }));

    return {
      name: data.name,
      label: data.label,
      fields,
      custom: data.custom,
      queryable: data.queryable,
      createable: data.createable,
      updateable: data.updateable,
      deletable: data.deletable,
    };
  });
}

export async function sfCreateCustomField(params: {
  objectName: string;
  fieldLabel: string;
  fieldApiName: string;
  fieldType: SalesforceFieldType;
  length?: number;
  precision?: number;
  scale?: number;
  required?: boolean;
  unique?: boolean;
  description?: string;
  inlineHelpText?: string;
  defaultValue?: string;
  referenceTo?: string;
  relationshipName?: string;
  picklistValues?: string[];
  formula?: string;
  visibleLines?: number;
}): Promise<{ id: string; fullName: string; success: boolean }> {
  logger.debug("sfCreateCustomField", {
    objectName: params.objectName,
    fieldApiName: params.fieldApiName,
    fieldType: params.fieldType,
  });

  // Ensure the API name ends with __c
  const apiName = params.fieldApiName.endsWith("__c")
    ? params.fieldApiName
    : `${params.fieldApiName}__c`;

  const sfType = FIELD_TYPE_MAP[params.fieldType];
  const fullName = `${params.objectName}.${apiName}`;

  const metadata: SalesforceCustomFieldMetadata = {
    type: sfType,
    label: params.fieldLabel,
    description: params.description,
    inlineHelpText: params.inlineHelpText,
    required: params.required,
    unique: params.unique,
    defaultValue: params.defaultValue,
  };

  // Type-specific metadata
  switch (params.fieldType) {
    case "Text":
    case "TextArea":
      metadata.length = params.length ?? 255;
      break;

    case "LongTextArea":
    case "RichTextArea":
      metadata.length = params.length ?? 32768;
      metadata.visibleLines = params.visibleLines ?? 5;
      break;

    case "Number":
    case "Currency":
    case "Percent":
      metadata.precision = params.precision ?? 18;
      metadata.scale = params.scale ?? 0;
      break;

    case "Picklist":
    case "MultiSelectPicklist":
      if (params.picklistValues && params.picklistValues.length > 0) {
        metadata.valueSet = {
          restricted: false,
          valueSetDefinition: {
            sorted: false,
            value: params.picklistValues.map((v, i) => ({
              fullName: v.replace(/\s+/g, "_"),
              label: v,
              default: i === 0,
            })),
          },
        };
      }
      break;

    case "Lookup":
    case "MasterDetail":
      if (!params.referenceTo) {
        throw new Error(
          `referenceTo is required for ${params.fieldType} fields`
        );
      }
      metadata.referenceTo = params.referenceTo;
      metadata.relationshipName =
        params.relationshipName ??
        params.referenceTo.replace(/__c$/, "") + "_" + apiName.replace(/__c$/, "");
      if (params.fieldType === "MasterDetail") {
        metadata.relationshipOrder = 1;
      }
      break;

    case "AutoNumber":
      metadata.displayFormat = params.defaultValue ?? "AN-{000000}";
      metadata.startingNumber = 1;
      break;
  }

  const payload: SalesforceCustomFieldPayload = {
    FullName: fullName,
    Metadata: metadata,
  };

  return sfRequest(async (_client, tooling) => {
    const { data } = await tooling.post<{
      id: string;
      success: boolean;
      errors: Array<{ message: string; statusCode: string }>;
    }>("/sobjects/CustomField", payload);

    if (!data.success) {
      const errs = (data.errors ?? []).map((e) => e.message).join("; ");
      throw new Error(`Failed to create field ${fullName}: ${errs}`);
    }

    return { id: data.id, fullName, success: true };
  });
}

export async function sfCreateValidationRule(params: {
  objectName: string;
  ruleName: string;
  errorConditionFormula: string;
  errorMessage: string;
  description?: string;
  errorDisplayField?: string;
  active?: boolean;
}): Promise<{ id: string; fullName: string; success: boolean }> {
  logger.debug("sfCreateValidationRule", {
    objectName: params.objectName,
    ruleName: params.ruleName,
  });

  const fullName = `${params.objectName}.${params.ruleName}`;

  const payload: SalesforceValidationRulePayload = {
    FullName: fullName,
    Metadata: {
      active: params.active ?? true,
      description: params.description,
      errorConditionFormula: params.errorConditionFormula,
      errorDisplayField: params.errorDisplayField ?? null,
      errorMessage: params.errorMessage,
    },
  };

  return sfRequest(async (_client, tooling) => {
    const { data } = await tooling.post<{
      id: string;
      success: boolean;
      errors: Array<{ message: string; statusCode: string }>;
    }>("/sobjects/ValidationRule", payload);

    if (!data.success) {
      const errs = (data.errors ?? []).map((e) => e.message).join("; ");
      throw new Error(
        `Failed to create validation rule ${fullName}: ${errs}`
      );
    }

    return { id: data.id, fullName, success: true };
  });
}

export async function sfDeployMetadata(params: {
  zipFile: string; // base64-encoded zip of metadata package
  deployOptions?: SalesforceDeployOptions;
}): Promise<{ id: string; status: string; done: boolean }> {
  logger.debug("sfDeployMetadata");

  const deployOptions: SalesforceDeployOptions = {
    rollbackOnError: true,
    checkOnly: false,
    testLevel: "NoTestRun",
    ...params.deployOptions,
  };

  return sfRequest(async (client) => {
    const { data } = await client.post<{
      id: string;
      status: string;
      done: boolean;
    }>("/metadata/deployRequest", {
      zipFile: params.zipFile,
      deployOptions,
    });

    return { id: data.id, status: data.status, done: data.done };
  });
}

export async function sfGetDeploymentStatus(
  deploymentId: string
): Promise<SalesforceDeployResult> {
  logger.debug("sfGetDeploymentStatus", { deploymentId });

  return sfRequest(async (client) => {
    const { data } = await client.get<{
      deployResult: SalesforceDeployResult;
    }>(
      `/metadata/deployRequest/${encodeURIComponent(deploymentId)}?includeDetails=true`
    );

    return data.deployResult;
  });
}

export async function sfQuery<T = Record<string, unknown>>(
  soql: string
): Promise<SalesforceQueryResult<T>> {
  logger.debug("sfQuery", { soql: soql.substring(0, 200) });

  return sfRequest(async (client) => {
    const { data } = await client.get<SalesforceQueryResult<T>>(
      `/query/`,
      { params: { q: soql } }
    );

    return data;
  });
}
