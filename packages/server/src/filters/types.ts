import type { EmailMessage } from "../providers/types.js";

export type FilterAction = "pass" | "redact" | "block";

export interface FilterResult {
  action: FilterAction;
  reason?: string;
  message: EmailMessage;
  trace?: { htmlConverted?: boolean; invisibleCharactersStripped?: number; piiPatterns?: Record<string, number>; injectionLabels?: string[] };
}

export interface EmailFilter {
  name: string;
  filter(message: EmailMessage): FilterResult;
}
