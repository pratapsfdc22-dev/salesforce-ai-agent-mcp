import type { SalesforceObjectDescribe, SalesforceQueryResult, SalesforceFieldType, SalesforceDeployOptions, SalesforceDeployResult } from "../types/index.js";
export declare function sfGetObjectFields(objectName: string): Promise<SalesforceObjectDescribe>;
export declare function sfCreateCustomField(params: {
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
}): Promise<{
    id: string;
    fullName: string;
    success: boolean;
}>;
export declare function sfCreateValidationRule(params: {
    objectName: string;
    ruleName: string;
    errorConditionFormula: string;
    errorMessage: string;
    description?: string;
    errorDisplayField?: string;
    active?: boolean;
}): Promise<{
    id: string;
    fullName: string;
    success: boolean;
}>;
export declare function sfDeployMetadata(params: {
    zipFile: string;
    deployOptions?: SalesforceDeployOptions;
}): Promise<{
    id: string;
    status: string;
    done: boolean;
}>;
export declare function sfGetDeploymentStatus(deploymentId: string): Promise<SalesforceDeployResult>;
export declare function sfQuery<T = Record<string, unknown>>(soql: string): Promise<SalesforceQueryResult<T>>;
//# sourceMappingURL=salesforceClient.d.ts.map