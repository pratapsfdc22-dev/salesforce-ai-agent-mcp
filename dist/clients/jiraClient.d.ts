import type { JiraIssue, JiraComment, JiraSearchResult } from "../types/index.js";
export declare function jiraGetStory(issueKey: string): Promise<JiraIssue>;
export declare function jiraUpdateStoryStatus(issueKey: string, targetStatus: string): Promise<{
    success: boolean;
    previousStatus: string;
    newStatus: string;
}>;
export declare function jiraPostComment(issueKey: string, body: string): Promise<JiraComment>;
export declare function jiraSearchStories(jql: string, maxResults?: number, startAt?: number): Promise<JiraSearchResult>;
//# sourceMappingURL=jiraClient.d.ts.map