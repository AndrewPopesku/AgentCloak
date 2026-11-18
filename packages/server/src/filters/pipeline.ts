import type { EmailMessage } from "../providers/types.js";
import type { StoredFilterConfig } from "../storage/types.js";
import { BlocklistFilter } from "./blocklist.js";
import { InjectionFilter } from "./injection.js";
import { PiiFilter } from "./pii.js";
import { SanitizerFilter } from "./sanitizer.js";
import type { EmailFilter, FilterResult } from "./types.js";

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

export class FilterPipeline {
  private filters: EmailFilter[];
  public readonly showFilteredCount: boolean;
  public readonly emailRedactionEnabled: boolean;
  public readonly blockedDomains: string[];
  public readonly attachmentFilteringEnabled: boolean;
  public readonly allowedFolders: string[];
  public onTrace?: (trace: MessageTrace) => void;

  constructor(userConfig?: StoredFilterConfig | null) {
    this.showFilteredCount = userConfig?.showFilteredCount ?? true;
    this.emailRedactionEnabled = userConfig?.emailRedactionEnabled ?? true;
    this.attachmentFilteringEnabled = userConfig?.attachmentFilteringEnabled ?? true;
    this.allowedFolders = userConfig?.allowedFolders ?? [];
    const blocklist = new BlocklistFilter(userConfig);
    this.blockedDomains = blocklist.getBlockedDomains();
    this.filters = [
      new SanitizerFilter(),
      blocklist,
      new PiiFilter(
        userConfig?.piiRedactionEnabled ?? true,
        userConfig?.emailRedactionEnabled ?? true,
        userConfig?.dollarAmountRedactionEnabled ?? true,
      ),
      new InjectionFilter(userConfig?.injectionDetectionEnabled ?? true),
    ];
  }

  addFilter(filter: EmailFilter): void {
    this.filters.push(filter);
  }

  process(message: EmailMessage): FilterResult {
    return this.processWithTrace(message).result;
  }

  processWithTrace(message: EmailMessage): { result: FilterResult; trace: MessageTrace } {
    const trace: MessageTrace = {
      messageId: message.id, decision: "passed",
      sanitizer: { htmlConverted: false, invisibleCharactersStripped: 0 },
      piiPatterns: {}, injectionLabels: [], attachmentsStripped: 0,
    };
    const finish = (result: FilterResult) => {
      this.onTrace?.(trace);
      return { result, trace };
    };
    // Folder restriction: block messages not in allowed folders
    if (this.allowedFolders.length > 0) {
      const allowed = this.allowedFolders.map((f) => f.toLowerCase());
      const messageLabels = message.labels ?? [];
      const hasAllowedFolder = messageLabels.some((label) =>
        allowed.includes(label.toLowerCase()),
      );
      if (!hasAllowedFolder) {
        trace.decision = "blocked";
        trace.sender = message.from.email;
        trace.blockReason = "Folder not in allowed list";
        return finish({
          action: "block",
          reason: "Folder not in allowed list",
          message,
        });
      }
    }

    let current = message;

    for (const filter of this.filters) {
      const result = filter.filter(current);

      if (result.action === "block") {
        trace.decision = "blocked";
        trace.sender = message.from.email;
        trace.blockReason = result.reason;
        return finish(result);
      }

      if (filter.name === "sanitizer") {
        trace.sanitizer = {
          htmlConverted: result.trace?.htmlConverted ?? false,
          invisibleCharactersStripped: result.trace?.invisibleCharactersStripped ?? 0,
        };
      }
      if (filter.name === "pii") trace.piiPatterns = result.trace?.piiPatterns ?? {};
      if (filter.name === "injection") trace.injectionLabels = result.trace?.injectionLabels ?? [];
      if (result.action === "redact") trace.decision = "redacted";

      current = result.message;
    }

    // Attachment filtering: strip attachment metadata
    if (this.attachmentFilteringEnabled) {
      trace.attachmentsStripped = current.attachments.length;
      current = { ...current, attachments: [] };
    }

    return finish({ action: "pass", message: current });
  }

  processBatch(messages: EmailMessage[]): {
    passed: EmailMessage[];
    blocked: Array<{ message: EmailMessage; reason: string }>;
  } {
    const passed: EmailMessage[] = [];
    const blocked: Array<{ message: EmailMessage; reason: string }> = [];

    for (const message of messages) {
      const result = this.process(message);
      if (result.action === "block") {
        blocked.push({ message, reason: result.reason ?? "Blocked" });
      } else {
        passed.push(result.message);
      }
    }

    return { passed, blocked };
  }
}
