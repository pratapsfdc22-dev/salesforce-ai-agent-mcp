import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  sfGetObjectFields,
  sfCreateCustomField,
  sfCreateValidationRule,
  sfDeployMetadata,
  sfGetDeploymentStatus,
  sfQuery,
} from "../clients/salesforceClient.js";
import { logger } from "../clients/logger.js";
import type { McpToolResult, SalesforceFieldType } from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Salesforce MCP Tools
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

// ── Valid Salesforce field types (for Zod enum) ───────────────────────────

const FIELD_TYPES = [
  "Text",
  "Number",
  "Currency",
  "Picklist",
  "MultiSelectPicklist",
  "Checkbox",
  "Date",
  "DateTime",
  "Email",
  "Phone",
  "URL",
  "TextArea",
  "LongTextArea",
  "RichTextArea",
  "Lookup",
  "MasterDetail",
  "Percent",
  "AutoNumber",
  "Formula",
] as const satisfies readonly SalesforceFieldType[];

// ─────────────────────────────────────────────────────────────────────────────

export function registerSalesforceTools(server: McpServer): void {
  // ── salesforce_get_object_fields ────────────────────────────────────────

  server.tool(
    "salesforce_get_object_fields",
    "Query all existing fields on a Salesforce object using the REST API describe endpoint. Returns field names, labels, types, lengths, and picklist values.",
    {
      objectName: z
        .string()
        .min(1)
        .describe(
          "Salesforce object API name (e.g. 'Account', 'Contact', 'Opportunity', 'My_Custom_Object__c')"
        ),
    },
    async ({ objectName }) => {
      logger.info("tool:salesforce_get_object_fields", { objectName });
      try {
        const describe = await sfGetObjectFields(objectName);
        return ok({
          objectName: describe.name,
          label: describe.label,
          totalFields: describe.fields.length,
          customFields: describe.fields.filter((f) => f.custom).length,
          fields: describe.fields.map((f) => ({
            name: f.name,
            label: f.label,
            type: f.type,
            length: f.length,
            required: !f.nillable,
            custom: f.custom,
            referenceTo: f.referenceTo,
            picklistValues: f.picklistValues?.length
              ? f.picklistValues.filter((p) => p.active).map((p) => p.value)
              : undefined,
          })),
        });
      } catch (err) {
        return fail(
          `Failed to describe Salesforce object ${objectName}`,
          extractErrorMessage(err)
        );
      }
    }
  );

  // ── salesforce_create_custom_field ──────────────────────────────────────

  server.tool(
    "salesforce_create_custom_field",
    "Create a custom field on a Salesforce object using the Tooling API. Supports all standard field types including Text, Number, Picklist, Checkbox, Date, Lookup, and more.",
    {
      objectName: z
        .string()
        .min(1)
        .describe(
          "Salesforce object API name (e.g. 'Account', 'My_Object__c')"
        ),
      fieldLabel: z
        .string()
        .min(1)
        .describe("Human-readable field label (e.g. 'Customer Tier')"),
      fieldApiName: z
        .string()
        .min(1)
        .describe(
          "Field API name without the __c suffix (e.g. 'Customer_Tier'). The __c suffix will be added automatically."
        ),
      fieldType: z
        .enum(FIELD_TYPES)
        .describe(
          "Salesforce field type. One of: Text, Number, Currency, Picklist, MultiSelectPicklist, Checkbox, Date, DateTime, Email, Phone, URL, TextArea, LongTextArea, RichTextArea, Lookup, MasterDetail, Percent, AutoNumber, Formula"
        ),
      length: z
        .number()
        .int()
        .min(1)
        .max(131072)
        .optional()
        .describe(
          "Field length. For Text: 1–255 (default 255). For LongTextArea/RichTextArea: up to 131072 (default 32768). Not used for Date, Checkbox, etc."
        ),
      precision: z
        .number()
        .int()
        .min(1)
        .max(18)
        .optional()
        .describe(
          "Total number of digits for Number/Currency/Percent fields (default 18)"
        ),
      scale: z
        .number()
        .int()
        .min(0)
        .max(17)
        .optional()
        .describe(
          "Number of decimal places for Number/Currency/Percent fields (default 0)"
        ),
      required: z
        .boolean()
        .optional()
        .describe("Whether the field is required (default false)"),
      unique: z
        .boolean()
        .optional()
        .describe("Whether the field value must be unique (default false)"),
      description: z
        .string()
        .optional()
        .describe("Internal description of the field's purpose"),
      inlineHelpText: z
        .string()
        .optional()
        .describe("Help text shown to users in the UI"),
      defaultValue: z
        .string()
        .optional()
        .describe(
          "Default value for the field. For AutoNumber fields, this sets the display format (e.g. 'CASE-{000000}')"
        ),
      referenceTo: z
        .string()
        .optional()
        .describe(
          "Target object API name for Lookup or MasterDetail fields (e.g. 'Account', 'My_Object__c'). Required for Lookup/MasterDetail types."
        ),
      relationshipName: z
        .string()
        .optional()
        .describe(
          "Relationship name for Lookup/MasterDetail fields. Auto-generated if not provided."
        ),
      picklistValues: z
        .array(z.string())
        .optional()
        .describe(
          "List of picklist values for Picklist or MultiSelectPicklist fields (e.g. ['High', 'Medium', 'Low'])"
        ),
      formula: z
        .string()
        .optional()
        .describe("Formula expression for Formula fields"),
      visibleLines: z
        .number()
        .int()
        .min(2)
        .max(50)
        .optional()
        .describe(
          "Number of visible lines for LongTextArea/RichTextArea fields (default 5)"
        ),
    },
    async (params) => {
      logger.info("tool:salesforce_create_custom_field", {
        objectName: params.objectName,
        fieldApiName: params.fieldApiName,
        fieldType: params.fieldType,
      });
      try {
        const result = await sfCreateCustomField(params);
        return ok({
          ...result,
          message: `Custom field '${result.fullName}' created successfully`,
        });
      } catch (err) {
        return fail(
          `Failed to create custom field ${params.fieldApiName} on ${params.objectName}`,
          extractErrorMessage(err)
        );
      }
    }
  );

  // ── salesforce_create_validation_rule ───────────────────────────────────

  server.tool(
    "salesforce_create_validation_rule",
    "Create a validation rule on a Salesforce object using the Tooling API. The rule evaluates an error condition formula and displays an error message when the formula returns true.",
    {
      objectName: z
        .string()
        .min(1)
        .describe(
          "Salesforce object API name (e.g. 'Account', 'My_Object__c')"
        ),
      ruleName: z
        .string()
        .min(1)
        .regex(
          /^[A-Za-z][A-Za-z0-9_]*$/,
          "Rule name must start with a letter and contain only letters, numbers, and underscores"
        )
        .describe(
          "API name for the validation rule (no spaces, e.g. 'Require_Phone_For_Hot_Leads')"
        ),
      errorConditionFormula: z
        .string()
        .min(1)
        .describe(
          "Salesforce formula that evaluates to TRUE when the record should be invalid. Example: 'AND(Rating = \"Hot\", ISBLANK(Phone))'"
        ),
      errorMessage: z
        .string()
        .min(1)
        .describe(
          "Error message shown to users when validation fails (e.g. 'Phone is required for Hot leads')"
        ),
      description: z
        .string()
        .optional()
        .describe("Internal description of the rule's purpose"),
      errorDisplayField: z
        .string()
        .optional()
        .describe(
          "API name of the field where the error should appear. If omitted, the error appears at the top of the page."
        ),
      active: z
        .boolean()
        .default(true)
        .describe("Whether the rule should be active after creation (default true)"),
    },
    async (params) => {
      logger.info("tool:salesforce_create_validation_rule", {
        objectName: params.objectName,
        ruleName: params.ruleName,
      });
      try {
        const result = await sfCreateValidationRule(params);
        return ok({
          ...result,
          message: `Validation rule '${result.fullName}' created successfully`,
        });
      } catch (err) {
        return fail(
          `Failed to create validation rule ${params.ruleName} on ${params.objectName}`,
          extractErrorMessage(err)
        );
      }
    }
  );

  // ── salesforce_deploy_metadata ──────────────────────────────────────────

  server.tool(
    "salesforce_deploy_metadata",
    "Trigger a Salesforce metadata deployment using the Metadata API. The metadata must be provided as a base64-encoded ZIP file containing a standard Salesforce metadata package.",
    {
      zipFile: z
        .string()
        .min(1)
        .describe(
          "Base64-encoded ZIP file containing the Salesforce metadata package. Must include package.xml and the appropriate metadata folders."
        ),
      checkOnly: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true, validates the deployment without making changes (dry run). Default false."
        ),
      testLevel: z
        .enum([
          "NoTestRun",
          "RunSpecifiedTests",
          "RunLocalTests",
          "RunAllTestsInOrg",
        ])
        .optional()
        .default("NoTestRun")
        .describe(
          "Test execution level. Use 'RunLocalTests' or 'RunAllTestsInOrg' for production deployments."
        ),
      runTests: z
        .array(z.string())
        .optional()
        .describe(
          "Specific test class names to run when testLevel is 'RunSpecifiedTests'"
        ),
      rollbackOnError: z
        .boolean()
        .optional()
        .default(true)
        .describe("Roll back all changes if any component fails (default true)"),
      ignoreWarnings: z
        .boolean()
        .optional()
        .default(false)
        .describe("Allow deployment to succeed with warnings (default false)"),
    },
    async ({
      zipFile,
      checkOnly,
      testLevel,
      runTests,
      rollbackOnError,
      ignoreWarnings,
    }) => {
      logger.info("tool:salesforce_deploy_metadata", {
        checkOnly,
        testLevel,
      });
      try {
        const result = await sfDeployMetadata({
          zipFile,
          deployOptions: {
            checkOnly,
            testLevel,
            runTests,
            rollbackOnError,
            ignoreWarnings,
          },
        });
        return ok({
          ...result,
          message: `Deployment triggered. Use salesforce_get_deployment_status with deploymentId '${result.id}' to poll for completion.`,
        });
      } catch (err) {
        return fail("Failed to trigger Salesforce deployment", extractErrorMessage(err));
      }
    }
  );

  // ── salesforce_get_deployment_status ───────────────────────────────────

  server.tool(
    "salesforce_get_deployment_status",
    "Poll the status of a Salesforce metadata deployment by its deployment ID. Returns component counts, errors, and test results.",
    {
      deploymentId: z
        .string()
        .min(1)
        .describe(
          "The deployment ID returned by salesforce_deploy_metadata (18-character Salesforce ID)"
        ),
    },
    async ({ deploymentId }) => {
      logger.info("tool:salesforce_get_deployment_status", { deploymentId });
      try {
        const result = await sfGetDeploymentStatus(deploymentId);
        return ok({
          id: result.id,
          status: result.status,
          success: result.success,
          done: result.done,
          progress: {
            componentsDeployed: result.numberComponentsDeployed,
            componentsTotal: result.numberComponentsTotal,
            componentErrors: result.numberComponentErrors,
            testsCompleted: result.numberTestsCompleted,
            testsTotal: result.numberTestsTotal,
            testErrors: result.numberTestErrors,
          },
          details: result.details,
          errorMessage: result.errorMessage,
          message: result.done
            ? result.success
              ? "Deployment completed successfully"
              : `Deployment failed: ${result.errorMessage ?? "See details"}`
            : "Deployment is still in progress. Poll again in a few seconds.",
        });
      } catch (err) {
        return fail(
          `Failed to get deployment status for ${deploymentId}`,
          extractErrorMessage(err)
        );
      }
    }
  );

  // ── salesforce_query ────────────────────────────────────────────────────

  server.tool(
    "salesforce_query",
    "Execute a SOQL query against Salesforce and return the results. Use this to verify field values after deployment, check existing records, or validate configuration.",
    {
      soql: z
        .string()
        .min(1)
        .describe(
          "SOQL query string. Example: 'SELECT Id, Name, Rating, Phone FROM Account WHERE Rating = \\'Hot\\' LIMIT 10'"
        ),
      maxRecords: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .describe(
          "Maximum records to return (1–2000). Use LIMIT in your SOQL for precise control. Default: returns whatever SOQL specifies."
        ),
    },
    async ({ soql, maxRecords }) => {
      logger.info("tool:salesforce_query", {
        soql: soql.substring(0, 200),
        maxRecords,
      });

      // Add a LIMIT if requested and none is present
      let finalSoql = soql.trim();
      if (
        maxRecords !== undefined &&
        !/\bLIMIT\s+\d+/i.test(finalSoql)
      ) {
        finalSoql = `${finalSoql} LIMIT ${maxRecords}`;
      }

      try {
        const result = await sfQuery(finalSoql);
        return ok({
          totalSize: result.totalSize,
          done: result.done,
          recordCount: result.records.length,
          records: result.records,
          hasMore: !result.done,
          message: result.done
            ? `Query returned ${result.records.length} of ${result.totalSize} records`
            : `Query returned ${result.records.length} records. More records available.`,
        });
      } catch (err) {
        return fail("Failed to execute SOQL query", extractErrorMessage(err));
      }
    }
  );
}
