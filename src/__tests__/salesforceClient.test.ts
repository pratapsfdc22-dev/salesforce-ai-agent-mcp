import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Helpers ────────────────────────────────────────────────────────────────

const TOKEN_RESPONSE = {
  data: {
    access_token: "mock-access-token",
    instance_url: "https://test.salesforce.com",
    token_type: "Bearer",
    issued_at: String(Date.now()),
  },
};

const DESCRIBE_RESPONSE = {
  data: {
    name: "Account",
    label: "Account",
    custom: false,
    queryable: true,
    createable: true,
    updateable: true,
    deletable: true,
    fields: [
      {
        name: "Id",
        label: "Account ID",
        type: "id",
        length: 18,
        nillable: false,
        createable: false,
        updateable: false,
        custom: false,
      },
    ],
  },
};

const TOOLING_SUCCESS_RESPONSE = {
  data: { id: "a001XXXXXXXXXXXXXXX", success: true, errors: [] },
};

// Per-test module reset ensures the module-level `cachedToken` singleton starts null.
// Without this, token caching state leaks between tests.
beforeEach(() => {
  vi.resetModules();

  process.env["SF_LOGIN_URL"] = "https://login.salesforce.com";
  process.env["SF_CLIENT_ID"] = "test-client-id";
  process.env["SF_CLIENT_SECRET"] = "test-client-secret";
  process.env["SF_USERNAME"] = "test@example.com";
  process.env["SF_PASSWORD"] = "test-password";
  process.env["SF_SECURITY_TOKEN"] = "test-security-token";
  process.env["SF_API_VERSION"] = "v61.0";
});

afterEach(() => {
  [
    "SF_LOGIN_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET",
    "SF_USERNAME", "SF_PASSWORD", "SF_SECURITY_TOKEN", "SF_API_VERSION",
  ].forEach((k) => delete process.env[k]);
});

// Sets up axios mock after vi.resetModules(). Must be called at the start of each test.
async function setupAxiosMock(apiClientOverrides?: { get?: ReturnType<typeof vi.fn>; post?: ReturnType<typeof vi.fn> }) {
  const mockApiClient = {
    get: apiClientOverrides?.get ?? vi.fn().mockResolvedValue(DESCRIBE_RESPONSE),
    post: apiClientOverrides?.post ?? vi.fn().mockResolvedValue(TOOLING_SUCCESS_RESPONSE),
  };

  vi.doMock("axios", () => ({
    default: {
      create: vi.fn().mockReturnValue(mockApiClient),
      post: vi.fn().mockResolvedValue(TOKEN_RESPONSE),
      isAxiosError: vi.fn().mockReturnValue(false),
    },
  }));

  const axios = (await import("axios")).default;
  const sf = await import("../clients/salesforceClient.js");

  return { axios, sf, mockApiClient };
}

// ── sfGetObjectFields ──────────────────────────────────────────────────────

describe("sfGetObjectFields", () => {
  it("fetches and returns object describe data", async () => {
    const { sf } = await setupAxiosMock();
    const result = await sf.sfGetObjectFields("Account");

    expect(result.name).toBe("Account");
    expect(result.label).toBe("Account");
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]?.name).toBe("Id");
  });

  it("maps all describe flags correctly", async () => {
    const { sf } = await setupAxiosMock();
    const result = await sf.sfGetObjectFields("Account");

    expect(result.queryable).toBe(true);
    expect(result.createable).toBe(true);
    expect(result.deletable).toBe(true);
    expect(result.custom).toBe(false);
  });

  it("throws if SF_CLIENT_ID is missing", async () => {
    delete process.env["SF_CLIENT_ID"];
    const { sf } = await setupAxiosMock();

    await expect(sf.sfGetObjectFields("Account")).rejects.toThrow(
      "Missing required Salesforce environment variables"
    );
  });
});

// ── sfCreateCustomField ────────────────────────────────────────────────────

describe("sfCreateCustomField", () => {
  it("auto-appends __c to fieldApiName when the suffix is missing", async () => {
    const { sf, mockApiClient } = await setupAxiosMock();

    await sf.sfCreateCustomField({
      objectName: "Account",
      fieldLabel: "Customer Tier",
      fieldApiName: "Customer_Tier",
      fieldType: "Text",
    });

    const payload = mockApiClient.post.mock.calls[0]?.[1] as { FullName: string };
    expect(payload.FullName).toBe("Account.Customer_Tier__c");
  });

  it("does not double-append __c when already present", async () => {
    const { sf, mockApiClient } = await setupAxiosMock();

    await sf.sfCreateCustomField({
      objectName: "Account",
      fieldLabel: "Customer Tier",
      fieldApiName: "Customer_Tier__c",
      fieldType: "Text",
    });

    const payload = mockApiClient.post.mock.calls[0]?.[1] as { FullName: string };
    expect(payload.FullName).toBe("Account.Customer_Tier__c");
  });

  it("sets default length of 255 for Text fields", async () => {
    const { sf, mockApiClient } = await setupAxiosMock();

    await sf.sfCreateCustomField({
      objectName: "Account",
      fieldLabel: "Notes",
      fieldApiName: "Notes",
      fieldType: "Text",
    });

    const payload = mockApiClient.post.mock.calls[0]?.[1] as {
      Metadata: { length: number };
    };
    expect(payload.Metadata.length).toBe(255);
  });

  it("uses provided length for Text fields", async () => {
    const { sf, mockApiClient } = await setupAxiosMock();

    await sf.sfCreateCustomField({
      objectName: "Account",
      fieldLabel: "Short Code",
      fieldApiName: "Short_Code",
      fieldType: "Text",
      length: 10,
    });

    const payload = mockApiClient.post.mock.calls[0]?.[1] as {
      Metadata: { length: number };
    };
    expect(payload.Metadata.length).toBe(10);
  });

  it("builds picklist valueSet for Picklist type", async () => {
    const { sf, mockApiClient } = await setupAxiosMock();

    await sf.sfCreateCustomField({
      objectName: "Account",
      fieldLabel: "Rating",
      fieldApiName: "Rating",
      fieldType: "Picklist",
      picklistValues: ["Hot", "Warm", "Cold"],
    });

    const payload = mockApiClient.post.mock.calls[0]?.[1] as {
      Metadata: {
        valueSet: {
          valueSetDefinition: {
            value: Array<{ label: string; default: boolean }>;
          };
        };
      };
    };
    const values = payload.Metadata.valueSet.valueSetDefinition.value;
    expect(values).toHaveLength(3);
    expect(values[0]?.label).toBe("Hot");
    expect(values[0]?.default).toBe(true);
    expect(values[1]?.label).toBe("Warm");
    expect(values[1]?.default).toBe(false);
  });

  it("sets precision and scale defaults for Number fields", async () => {
    const { sf, mockApiClient } = await setupAxiosMock();

    await sf.sfCreateCustomField({
      objectName: "Account",
      fieldLabel: "Revenue",
      fieldApiName: "Revenue",
      fieldType: "Number",
    });

    const payload = mockApiClient.post.mock.calls[0]?.[1] as {
      Metadata: { precision: number; scale: number };
    };
    expect(payload.Metadata.precision).toBe(18);
    expect(payload.Metadata.scale).toBe(0);
  });

  it("throws if referenceTo is missing for Lookup fields", async () => {
    const { sf } = await setupAxiosMock();

    await expect(
      sf.sfCreateCustomField({
        objectName: "Contact",
        fieldLabel: "Parent Account",
        fieldApiName: "Parent_Account",
        fieldType: "Lookup",
        // referenceTo intentionally omitted
      })
    ).rejects.toThrow("referenceTo is required for Lookup fields");
  });

  it("throws if referenceTo is missing for MasterDetail fields", async () => {
    const { sf } = await setupAxiosMock();

    await expect(
      sf.sfCreateCustomField({
        objectName: "Contact",
        fieldLabel: "Master",
        fieldApiName: "Master",
        fieldType: "MasterDetail",
      })
    ).rejects.toThrow("referenceTo is required for MasterDetail fields");
  });

  it("auto-generates relationshipName for Lookup when not provided", async () => {
    const { sf, mockApiClient } = await setupAxiosMock();

    await sf.sfCreateCustomField({
      objectName: "Contact",
      fieldLabel: "Primary Account",
      fieldApiName: "Primary_Account",
      fieldType: "Lookup",
      referenceTo: "Account",
    });

    const payload = mockApiClient.post.mock.calls[0]?.[1] as {
      Metadata: { relationshipName: string };
    };
    expect(payload.Metadata.relationshipName).toBeTruthy();
    expect(typeof payload.Metadata.relationshipName).toBe("string");
  });

  it("throws an error when the Tooling API returns success: false", async () => {
    const failClient = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({
        data: {
          id: null,
          success: false,
          errors: [{ message: "Duplicate field name", statusCode: "DUPLICATE_VALUE" }],
        },
      }),
    };
    const { sf } = await setupAxiosMock(failClient);

    await expect(
      sf.sfCreateCustomField({
        objectName: "Account",
        fieldLabel: "Dupe",
        fieldApiName: "Dupe",
        fieldType: "Text",
      })
    ).rejects.toThrow("Duplicate field name");
  });
});

// ── sfCreateValidationRule ─────────────────────────────────────────────────

describe("sfCreateValidationRule", () => {
  it("posts a validation rule with the correct fullName and metadata", async () => {
    const { sf, mockApiClient } = await setupAxiosMock();

    await sf.sfCreateValidationRule({
      objectName: "Lead",
      ruleName: "Require_Phone_For_Hot",
      errorConditionFormula: 'AND(Rating = "Hot", ISBLANK(Phone))',
      errorMessage: "Phone is required for Hot leads",
    });

    const payload = mockApiClient.post.mock.calls[0]?.[1] as {
      FullName: string;
      Metadata: {
        active: boolean;
        errorConditionFormula: string;
        errorMessage: string;
      };
    };

    expect(payload.FullName).toBe("Lead.Require_Phone_For_Hot");
    expect(payload.Metadata.active).toBe(true);
    expect(payload.Metadata.errorConditionFormula).toBe(
      'AND(Rating = "Hot", ISBLANK(Phone))'
    );
    expect(payload.Metadata.errorMessage).toBe("Phone is required for Hot leads");
  });

  it("defaults active to true when not specified", async () => {
    const { sf, mockApiClient } = await setupAxiosMock();

    await sf.sfCreateValidationRule({
      objectName: "Account",
      ruleName: "My_Rule",
      errorConditionFormula: "ISBLANK(Name)",
      errorMessage: "Name required",
    });

    const payload = mockApiClient.post.mock.calls[0]?.[1] as {
      Metadata: { active: boolean };
    };
    expect(payload.Metadata.active).toBe(true);
  });

  it("creates the rule as inactive when active: false is passed", async () => {
    const { sf, mockApiClient } = await setupAxiosMock();

    await sf.sfCreateValidationRule({
      objectName: "Account",
      ruleName: "Inactive_Rule",
      errorConditionFormula: "ISBLANK(Name)",
      errorMessage: "Name required",
      active: false,
    });

    const payload = mockApiClient.post.mock.calls[0]?.[1] as {
      Metadata: { active: boolean };
    };
    expect(payload.Metadata.active).toBe(false);
  });
});

// ── sfRequest 401 auto-retry ───────────────────────────────────────────────

describe("sfRequest 401 retry", () => {
  it("clears the token cache and retries once on a 401 response", async () => {
    const axiosError = {
      isAxiosError: true,
      response: { status: 401 },
      message: "Unauthorized",
    };

    const mockApiClient = {
      get: vi.fn()
        .mockRejectedValueOnce(axiosError)   // first attempt: 401
        .mockResolvedValueOnce(DESCRIBE_RESPONSE), // retry: success
      post: vi.fn(),
    };

    vi.doMock("axios", () => ({
      default: {
        create: vi.fn().mockReturnValue(mockApiClient),
        post: vi.fn().mockResolvedValue(TOKEN_RESPONSE),
        isAxiosError: vi.fn().mockImplementation(
          (err: unknown) => (err as { isAxiosError?: boolean })?.isAxiosError === true
        ),
      },
    }));

    const axios = (await import("axios")).default;
    const { sfGetObjectFields } = await import("../clients/salesforceClient.js");

    const result = await sfGetObjectFields("Account");

    // The API client was called twice (initial 401, then retry)
    expect(mockApiClient.get).toHaveBeenCalledTimes(2);
    // Token was re-fetched after the 401
    expect(axios.post).toHaveBeenCalledTimes(2); // initial fetch + re-auth
    // Result is correct despite the initial 401
    expect(result.name).toBe("Account");
  });
});

// ── sfQuery ────────────────────────────────────────────────────────────────

describe("sfQuery", () => {
  it("calls the SOQL query endpoint with the correct parameters", async () => {
    const { sf, mockApiClient } = await setupAxiosMock({
      get: vi.fn().mockResolvedValue({
        data: { totalSize: 1, done: true, records: [{ Id: "001xxx" }] },
      }),
    });

    const result = await sf.sfQuery("SELECT Id FROM Account LIMIT 1");

    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/query/",
      expect.objectContaining({ params: { q: "SELECT Id FROM Account LIMIT 1" } })
    );
    expect(result.totalSize).toBe(1);
    expect(result.records).toHaveLength(1);
  });
});
