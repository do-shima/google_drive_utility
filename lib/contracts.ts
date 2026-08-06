export const LIMITS = {
  namesPerRequest: 500,
  permissionTargetsPerRequest: 500,
  emailsPerTarget: 500,
  permissionMutationsPerRequest: 5000,
  copySourceNodes: 2000,
  copyDepth: 20,
  copyMutationsPerRequest: 5000,
} as const;

export type ItemStatus = "success" | "failed" | "skipped";

export type ItemResult = {
  key: string;
  name: string;
  status: ItemStatus;
  code: string;
  message: string;
  webViewLink?: string;
};

export type PermissionResult = {
  targetId: string;
  email: string;
  status: ItemStatus;
  code: string;
  message: string;
};

export type ResultSummary = {
  succeeded: number;
  failed: number;
  skipped: number;
};

export type DriveFileResult = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
};
