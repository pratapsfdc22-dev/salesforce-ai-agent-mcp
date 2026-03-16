# Salesforce AI Agent MCP Server

A production-grade **Model Context Protocol (MCP) server** that gives Claude direct, structured access to Jira Cloud, Salesforce (Tooling + Metadata APIs), and n8n workflows.

Built for the **Salesforce Developer AI Agent** project — an automation pipeline that reads Jira stories, interprets Salesforce configuration requirements, and deploys metadata (custom fields, validation rules, etc.) directly into Salesforce.

---

## Architecture

```
Claude Desktop / Claude Code / VS Code
           │  (stdio or SSE)
           ▼
  salesforce-ai-agent-mcp
  ┌───────────────────────────┐
  │  Tools (12 total)         │
  │  ├── Jira (4 tools)       │──► Jira Cloud REST API v3
  │  ├── Salesforce (6 tools) │──► Salesforce Tooling + Metadata APIs
  │  └── n8n (2 tools)        │──► n8n Webhook + REST API
  └───────────────────────────┘
```

---

## Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- A Jira Cloud account with API token
- A Salesforce org with a Connected App (OAuth 2.0)
- An n8n instance (optional, for workflow orchestration)

---

## Installation

```bash
cd salesforce-ai-agent-mcp
npm install
npm run build
```

---

## Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

### Jira

| Variable | Description |
|---|---|
| `JIRA_BASE_URL` | e.g. `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | Generate at [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |

### Salesforce

You need a **Connected App** with the **Username-Password OAuth flow** enabled.

1. In Salesforce Setup → App Manager → New Connected App
2. Enable OAuth settings
3. Add scope: `api`, `refresh_token`
4. Copy Consumer Key → `SF_CLIENT_ID`
5. Copy Consumer Secret → `SF_CLIENT_SECRET`

| Variable | Description |
|---|---|
| `SF_LOGIN_URL` | `https://login.salesforce.com` (prod) or `https://test.salesforce.com` (sandbox) |
| `SF_CLIENT_ID` | Connected App Consumer Key |
| `SF_CLIENT_SECRET` | Connected App Consumer Secret |
| `SF_USERNAME` | Your Salesforce username |
| `SF_PASSWORD` | Your Salesforce password |
| `SF_SECURITY_TOKEN` | Reset at Setup → Personal Information → Reset Security Token |
| `SF_API_VERSION` | API version, e.g. `v61.0` (default) |

### n8n

| Variable | Description |
|---|---|
| `N8N_BASE_URL` | Your n8n instance URL, e.g. `https://your-n8n.com` |
| `N8N_API_KEY` | Generate at n8n Settings → API → Create API Key |

---

## Usage

### stdio mode (Claude Desktop / Claude Code / VS Code)

```bash
npm start
# or for development:
npm run dev
```

### SSE mode (for remote/n8n integration)

```bash
npm run start:sse
# or for development:
npm run dev:sse
```

Endpoints available in SSE mode:
- `GET  http://localhost:3000/sse` — clients connect here
- `POST http://localhost:3000/messages?sessionId=<id>` — clients send messages here
- `GET  http://localhost:3000/health` — liveness probe

Override the port:
```bash
MCP_PORT=8080 npm run start:sse
```

---

## Connecting to Claude Desktop

Add the following to your `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "salesforce-ai-agent": {
      "command": "node",
      "args": ["/absolute/path/to/salesforce-ai-agent-mcp/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://your-org.atlassian.net",
        "JIRA_EMAIL": "you@company.com",
        "JIRA_API_TOKEN": "your_token",
        "SF_LOGIN_URL": "https://login.salesforce.com",
        "SF_CLIENT_ID": "your_client_id",
        "SF_CLIENT_SECRET": "your_client_secret",
        "SF_USERNAME": "you@yourorg.com",
        "SF_PASSWORD": "yourpassword",
        "SF_SECURITY_TOKEN": "yourSecurityToken",
        "N8N_BASE_URL": "https://your-n8n.com",
        "N8N_API_KEY": "your_n8n_api_key"
      }
    }
  }
}
```

---

## Connecting to Claude Code (VS Code Extension)

Add to your VS Code `settings.json` (or via the MCP extension UI):

```json
{
  "mcp.servers": {
    "salesforce-ai-agent": {
      "command": "node",
      "args": ["${workspaceFolder}/salesforce-ai-agent-mcp/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://your-org.atlassian.net",
        "JIRA_EMAIL": "you@company.com",
        "JIRA_API_TOKEN": "your_token",
        "SF_LOGIN_URL": "https://login.salesforce.com",
        "SF_CLIENT_ID": "your_client_id",
        "SF_CLIENT_SECRET": "your_client_secret",
        "SF_USERNAME": "you@yourorg.com",
        "SF_PASSWORD": "yourpassword",
        "SF_SECURITY_TOKEN": "yourSecurityToken",
        "N8N_BASE_URL": "https://your-n8n.com",
        "N8N_API_KEY": "your_n8n_api_key"
      }
    }
  }
}
```

Alternatively, the `mcp.json` file at the root of this project is compatible with VS Code's MCP extension and will be auto-detected if placed in your workspace root.

---

## Available Tools (12 total)

### Jira Tools

#### `jira_get_story`
Fetch a Jira story by issue key. Returns summary, description, acceptance criteria, status, labels, and all custom fields.

```
issueKey: "SFDC-123"
```

#### `jira_update_story_status`
Transition a Jira story to a new workflow status.

```
issueKey: "SFDC-123"
targetStatus: "In Progress"   # must match an available transition
```

#### `jira_post_comment`
Post a comment to a Jira story (used by the AI agent to report results or ask for clarification).

```
issueKey: "SFDC-123"
body: "Deployed Customer_Tier__c field to Account. Deployment ID: 0Af..."
```

#### `jira_search_stories`
JQL-based story search.

```
jql: "label = \"sf-config\" AND status = \"To Do\" AND project = SFDC"
maxResults: 25
```

---

### Salesforce Tools

#### `salesforce_get_object_fields`
Describe all fields on a Salesforce object.

```
objectName: "Account"
```

#### `salesforce_create_custom_field`
Create a custom field via the Tooling API.

```
objectName: "Account"
fieldLabel: "Customer Tier"
fieldApiName: "Customer_Tier"     # __c added automatically
fieldType: "Picklist"
picklistValues: ["Platinum", "Gold", "Silver", "Bronze"]
description: "Tier classification for account segmentation"
```

**Lookup field example:**
```
objectName: "Case"
fieldLabel: "Related Contract"
fieldApiName: "Related_Contract"
fieldType: "Lookup"
referenceTo: "Contract"
```

#### `salesforce_create_validation_rule`
Create a validation rule via the Tooling API.

```
objectName: "Account"
ruleName: "Require_Phone_For_Hot_Leads"
errorConditionFormula: "AND(Rating = \"Hot\", ISBLANK(Phone))"
errorMessage: "Phone number is required for Hot-rated accounts"
errorDisplayField: "Phone"
active: true
```

#### `salesforce_deploy_metadata`
Trigger a metadata deployment from a base64-encoded ZIP.

```
zipFile: "<base64-encoded-zip>"
checkOnly: false
testLevel: "RunLocalTests"
rollbackOnError: true
```

#### `salesforce_get_deployment_status`
Poll a deployment's status.

```
deploymentId: "0AfXXXXXXXXXXXXX"
```

#### `salesforce_query`
Execute SOQL for validation and verification.

```
soql: "SELECT Id, Name, Customer_Tier__c FROM Account WHERE Rating = 'Hot' LIMIT 10"
```

---

### n8n Tools

#### `n8n_trigger_workflow`
Trigger an n8n workflow via webhook URL.

```
webhookUrl: "https://your-n8n.com/webhook/abc123"
payload: {
  "issueKey": "SFDC-123",
  "environment": "sandbox",
  "triggeredBy": "claude"
}
```

#### `n8n_get_execution_status`
Check the status of an n8n execution.

```
executionId: "12345"
```

---

## Example AI Agent Workflow

```
You: "Process Jira story SFDC-456 and deploy the Salesforce configuration"

Claude:
1. jira_get_story(issueKey: "SFDC-456")
   → reads requirements: "Add Customer_Tier picklist to Account"

2. salesforce_get_object_fields(objectName: "Account")
   → confirms Customer_Tier__c doesn't exist yet

3. salesforce_create_custom_field(
     objectName: "Account",
     fieldLabel: "Customer Tier",
     fieldApiName: "Customer_Tier",
     fieldType: "Picklist",
     picklistValues: ["Platinum", "Gold", "Silver"]
   )
   → creates the field

4. salesforce_query(soql: "SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = 'Account' AND QualifiedApiName = 'Customer_Tier__c'")
   → verifies the field was created

5. jira_post_comment(
     issueKey: "SFDC-456",
     body: "✅ Customer_Tier__c picklist field created on Account object with values: Platinum, Gold, Silver."
   )

6. jira_update_story_status(issueKey: "SFDC-456", targetStatus: "Done")
```

---

## Logging

All logs are written as structured JSON to **stderr** so they never interfere with the MCP stdio transport.

Control the log level via environment variable:

```bash
LOG_LEVEL=debug npm start    # debug | info | warn | error
```

---

## Development

```bash
# Type-check only
npm run typecheck

# Build
npm run build

# Dev with hot reload (stdio)
npm run dev

# Dev with hot reload (SSE)
npm run dev:sse
```

---

## Project Structure

```
salesforce-ai-agent-mcp/
├── src/
│   ├── index.ts              # Entry point — stdio & SSE transport setup
│   ├── server.ts             # McpServer creation & tool registration
│   ├── tools/
│   │   ├── jira.ts           # Jira tool definitions (4 tools)
│   │   ├── salesforce.ts     # Salesforce tool definitions (6 tools)
│   │   └── n8n.ts            # n8n tool definitions (2 tools)
│   ├── clients/
│   │   ├── jiraClient.ts     # Jira REST API v3 client
│   │   ├── salesforceClient.ts  # Salesforce Tooling/Metadata API + OAuth
│   │   ├── n8nClient.ts      # n8n webhook + REST API client
│   │   └── logger.ts         # Structured JSON logger (stderr)
│   └── types/
│       └── index.ts          # Shared TypeScript types
├── .env.example              # All required environment variables
├── mcp.json                  # VS Code MCP extension manifest
├── package.json
├── tsconfig.json
└── README.md
```
