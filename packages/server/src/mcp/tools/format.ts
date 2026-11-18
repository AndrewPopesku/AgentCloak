import type { FilterPipeline } from "../../filters/pipeline.js";
import type { EmailAddress, EmailMessage } from "../../providers/types.js";

const EMAIL_LIKE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function formatAddress(
  addr: EmailAddress,
  pipeline: FilterPipeline,
): string {
  if (pipeline.emailRedactionEnabled) {
    const name = addr.name?.trim();
    if (!name || EMAIL_LIKE.test(name)) {
      return "[Name Unavailable]";
    }
    return name.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL_REDACTED]");
  }
  return `${addr.name} <${addr.email}>`;
}

export function formatAddresses(
  addrs: EmailAddress[],
  pipeline: FilterPipeline,
): string[] {
  return addrs.map((a) => formatAddress(a, pipeline));
}

export function threadParticipants(messages: EmailMessage[]): EmailAddress[] {
  const participants = new Map<string, EmailAddress>();
  for (const message of messages) {
    for (const address of [message.from, ...message.to, ...message.cc]) {
      participants.set(address.email, address);
    }
  }
  return [...participants.values()];
}

export function formatThread(
  id: string,
  messages: EmailMessage[],
  pipeline: FilterPipeline,
) {
  const last = messages[messages.length - 1];
  return {
    id,
    subject: messages[0].subject,
    participants: formatAddresses(threadParticipants(messages), pipeline),
    messageCount: messages.length,
    snippet: last.snippet,
    lastMessageDate: last.date,
    isUnread: messages.some((m) => m.isUnread),
    labels: [...new Set(messages.flatMap((m) => m.labels))],
  };
}
