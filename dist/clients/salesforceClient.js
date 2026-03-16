import axios from "axios";
import { logger } from "./logger.js";
// ─────────────────────────────────────────────────────────────────────────────
// Salesforce Tooling API + Metadata API Client
// Auth: OAuth 2.0 Username–Password flow with automatic token refresh
// ─────────────────────────────────────────────────────────────────────────────
// Token cache (module-level singleton)
let cachedToken = null;
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
        throw new Error("Missing required Salesforce environment variables: SF_LOGIN_URL, SF_CLIENT_ID, SF_CLIENT_SECRET, SF_USERNAME, SF_PASSWORD");
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
async function fetchToken() {
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
    const { data } = await axios.post(`${cfg.loginUrl}/services/oauth2/token`, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 30_000,
    });
    const token = {
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
async function getToken() {
    if (cachedToken &&
        Date.now() - cachedToken.issuedAt < TOKEN_TTL_MS) {
        return cachedToken;
    }
    return fetchToken();
}
function createSfAxios(token, tooling = false) {
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
async function sfRequest(fn) {
    let token = await getToken();
    try {
        return await fn(createSfAxios(token, false), createSfAxios(token, true));
    }
    catch (err) {
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
const FIELD_TYPE_MAP = {
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
export async function sfGetObjectFields(objectName) {
    logger.debug("sfGetObjectFields", { objectName });
    return sfRequest(async (client) => {
        const { data } = await client.get(`/sobjects/${encodeURIComponent(objectName)}/describe`);
        const fields = (data.fields ?? []).map((f) => ({
            name: String(f["name"] ?? ""),
            label: String(f["label"] ?? ""),
            type: String(f["type"] ?? ""),
            length: typeof f["length"] === "number" ? f["length"] : undefined,
            precision: typeof f["precision"] === "number" ? f["precision"] : undefined,
            scale: typeof f["scale"] === "number" ? f["scale"] : undefined,
            nillable: Boolean(f["nillable"]),
            createable: Boolean(f["createable"]),
            updateable: Boolean(f["updateable"]),
            custom: Boolean(f["custom"]),
            referenceTo: Array.isArray(f["referenceTo"])
                ? f["referenceTo"]
                : undefined,
            picklistValues: Array.isArray(f["picklistValues"])
                ? f["picklistValues"].map((p) => ({
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
export async function sfCreateCustomField(params) {
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
    const metadata = {
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
                throw new Error(`referenceTo is required for ${params.fieldType} fields`);
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
    const payload = {
        FullName: fullName,
        Metadata: metadata,
    };
    return sfRequest(async (_client, tooling) => {
        const { data } = await tooling.post("/sobjects/CustomField", payload);
        if (!data.success) {
            const errs = (data.errors ?? []).map((e) => e.message).join("; ");
            throw new Error(`Failed to create field ${fullName}: ${errs}`);
        }
        return { id: data.id, fullName, success: true };
    });
}
export async function sfCreateValidationRule(params) {
    logger.debug("sfCreateValidationRule", {
        objectName: params.objectName,
        ruleName: params.ruleName,
    });
    const fullName = `${params.objectName}.${params.ruleName}`;
    const payload = {
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
        const { data } = await tooling.post("/sobjects/ValidationRule", payload);
        if (!data.success) {
            const errs = (data.errors ?? []).map((e) => e.message).join("; ");
            throw new Error(`Failed to create validation rule ${fullName}: ${errs}`);
        }
        return { id: data.id, fullName, success: true };
    });
}
export async function sfDeployMetadata(params) {
    logger.debug("sfDeployMetadata");
    const deployOptions = {
        rollbackOnError: true,
        checkOnly: false,
        testLevel: "NoTestRun",
        ...params.deployOptions,
    };
    return sfRequest(async (client) => {
        const { data } = await client.post("/metadata/deployRequest", {
            zipFile: params.zipFile,
            deployOptions,
        });
        return { id: data.id, status: data.status, done: data.done };
    });
}
export async function sfGetDeploymentStatus(deploymentId) {
    logger.debug("sfGetDeploymentStatus", { deploymentId });
    return sfRequest(async (client) => {
        const { data } = await client.get(`/metadata/deployRequest/${encodeURIComponent(deploymentId)}?includeDetails=true`);
        return data.deployResult;
    });
}
export async function sfQuery(soql) {
    logger.debug("sfQuery", { soql: soql.substring(0, 200) });
    return sfRequest(async (client) => {
        const { data } = await client.get(`/query/`, { params: { q: soql } });
        return data;
    });
}
//# sourceMappingURL=salesforceClient.js.map