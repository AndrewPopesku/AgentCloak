export interface Account {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface Connection {
  id: string;
  email: string;
  provider: string;
  displayName: string | null;
  status: "active" | "revoked" | "error";
  createdAt: number;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  key?: string; // only present on creation
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface FilterConfig {
  connectionId: string;
  blockedDomains: string[];
  blockedSenderPatterns: string[];
  blockedSubjectPatterns: string[];
  piiRedactionEnabled: boolean;
  injectionDetectionEnabled: boolean;
  emailRedactionEnabled: boolean;
  showFilteredCount: boolean;
  securityBlockingEnabled: boolean;
  financialBlockingEnabled: boolean;
  sensitiveSenderBlockingEnabled: boolean;
  dollarAmountRedactionEnabled: boolean;
  attachmentFilteringEnabled: boolean;
  allowedFolders: string[];
}

export interface MessageTrace {
  messageId: string;
  decision: "passed" | "redacted" | "blocked";
  sender?: string;
  blockReason?: string;
  sanitizer: { htmlConverted: boolean; invisibleCharactersStripped: number };
  piiPatterns: Record<string, number>;
  injectionLabels: string[];
  attachmentsStripped: number;
}

export interface ActivityEntry {
  id: string;
  createdAt: number;
  connectionId: string;
  apiKeyName: string | null;
  apiKeyPrefix: string | null;
  toolName: string;
  status: "ok" | "error" | "blocked";
  durationMs: number;
  providerCalls: number;
  returnedCount: number;
  redactedCount: number;
  blockedCount: number;
  responseTruncated: boolean;
  errorMessage: string | null;
}

export interface ActivityDetail extends ActivityEntry {
  arguments: Record<string, unknown>;
  filterTrace: MessageTrace[];
  responseText: string;
}
