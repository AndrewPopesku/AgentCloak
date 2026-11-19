import type { EmailMessage } from "../providers/types.js";
import type { EmailFilter, FilterResult } from "./types.js";

interface PiiPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
  validate?: (value: string) => boolean;
}

const PII_PATTERNS: PiiPattern[] = [
  {
    name: "SSN",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[SSN_REDACTED]",
  },
  {
    name: "Credit Card",
    pattern: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{3,4}\b/g,
    replacement: "[CREDIT_CARD_REDACTED]",
  },
  {
    name: "IBAN",
    pattern: /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}(?![\p{L}\p{N}])/giu,
    replacement: "[IBAN_REDACTED]",
    validate: validIban,
  },
  {
    name: "Ukrainian Taxpayer Number",
    pattern: /(?<![\p{L}\p{N}])(?:РНОКПП|ІПН|ідентифікаційний\s+код|tax\s*ID)\s*[:№#-]?\s*\d{10}(?![\p{L}\p{N}])/giu,
    replacement: "[TAX_ID_REDACTED]",
  },
  {
    name: "Phone Number (international)",
    pattern: /(?<![\p{L}\p{N}])\+(?:\d[ .-]?){8,15}(?![\p{L}\p{N}])/giu,
    replacement: "[PHONE_REDACTED]",
    validate: (value) => {
      const digits = value.replace(/\D/g, "");
      return digits.length >= 9 && digits.length <= 15;
    },
  },
  {
    name: "Phone Number (Ukrainian)",
    pattern: /(?<![\p{L}\p{N}])(?:0[3-9]\d|\(0[3-9]\d\))(?:[ .-]?\d){7}(?![\p{L}\p{N}])/giu,
    replacement: "[PHONE_REDACTED]",
  },
  {
    name: "PEM Private Key",
    pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    replacement: "[PRIVATE_KEY_REDACTED]",
  },
  {
    name: "API Key (sk_)",
    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
    replacement: "[API_KEY_REDACTED]",
  },
  {
    name: "API Key (pk_)",
    pattern: /\bpk_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
    replacement: "[API_KEY_REDACTED]",
  },
  {
    name: "API Key (generic)",
    pattern: /\b(?:api_key|apikey|api_secret|token)[=:]\s*["']?[A-Za-z0-9_\-]{20,}["']?/gi,
    replacement: "[API_KEY_REDACTED]",
  },
  {
    name: "AWS Access Key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: "[AWS_KEY_REDACTED]",
  },
  {
    name: "AWS Secret Key",
    pattern: /\b[A-Za-z0-9/+=]{40}\b(?=.*(?:aws|secret|key))/gi,
    replacement: "[AWS_SECRET_REDACTED]",
  },
  {
    name: "Bearer Token",
    pattern: /Bearer\s+[A-Za-z0-9_\-\.]{20,}/g,
    replacement: "Bearer [TOKEN_REDACTED]",
  },
  {
    name: "Account Number (ending in)",
    pattern: /(?:account|acct|card)(?:\s+(?:number|no|#))?\s*(?:ending|ending in|xxxx|\.{3,})\s*\d{4}/gi,
    replacement: "[ACCOUNT_REDACTED]",
  },
  {
    name: "Account Number (with label)",
    pattern: /(?:account|acct)(?:\s+(?:number|no|#))?[.:\s]+\d{6,}/gi,
    replacement: "[ACCOUNT_REDACTED]",
  },
  {
    name: "Routing Number",
    pattern: /(?:routing|aba|transit)\s*(?:number|no|#)?\s*:?\s*\d{9}\b/gi,
    replacement: "[ROUTING_NUMBER_REDACTED]",
  },
];

// ISO 13616: move the four-character prefix to the end, then compute mod 97
// incrementally so large IBANs never overflow a JavaScript number.
function validIban(value: string): boolean {
  const iban = value.replace(/ /g, "").toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const expanded = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

const CURRENCY_AMOUNT_PATTERN: PiiPattern = {
  name: "Currency Amount",
  // An explicit currency marker and at least four integer digits are required.
  // The final two digits after a comma or dot are cents; values below 1,000 pass.
  pattern: /(?<![\p{L}\p{N}])(?:[$€£₴]|грн|UAH|EUR|USD|PLN|zł)\s*(?:\d{1,3}(?:[ .,]\d{3})+|\d{4,})(?:[.,]\d{2})?(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:\d{1,3}(?:[ .,]\d{3})+|\d{4,})(?:[.,]\d{2})?\s*(?:[$€£₴]|грн|UAH|EUR|USD|PLN|zł)(?![\p{L}\p{N}])/giu,
  replacement: "[AMOUNT_REDACTED]",
  validate: (value) => {
    const numeric = value.replace(/(?:[$€£₴]|грн|UAH|EUR|USD|PLN|zł)/giu, "").trim();
    const integer = numeric.replace(/[.,]\d{2}$/, "").replace(/[ .,]/g, "");
    return Number(integer) >= 1000;
  },
};

const DOLLAR_AMOUNT_PATTERN: PiiPattern = {
  name: "Dollar Amount (large)",
  pattern: /\$\d{1,3}(?:,\d{3})+\.\d{2}/g,
  replacement: "[AMOUNT_REDACTED]",
};

const EMAIL_ADDRESS_PATTERN: PiiPattern = {
  name: "Email Address",
  pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  replacement: "[EMAIL_REDACTED]",
};

export class PiiFilter implements EmailFilter {
  name = "pii";
  private enabled: boolean;
  private emailRedactionEnabled: boolean;
  private dollarAmountRedactionEnabled: boolean;

  constructor(enabled = true, emailRedactionEnabled = true, dollarAmountRedactionEnabled = true) {
    this.enabled = enabled;
    this.emailRedactionEnabled = emailRedactionEnabled;
    this.dollarAmountRedactionEnabled = dollarAmountRedactionEnabled;
  }

  filter(message: EmailMessage): FilterResult {
    if (!this.enabled) {
      return { action: "pass", message };
    }

    const sanitized = { ...message };
    let wasRedacted = false;

    const redact = (text: string) => {
      const result = redactPii(text, this.emailRedactionEnabled, this.dollarAmountRedactionEnabled);
      wasRedacted ||= result !== text;
      return result;
    };
    sanitized.body = redact(sanitized.body);
    sanitized.subject = redact(sanitized.subject);
    sanitized.snippet = redact(sanitized.snippet);
    sanitized.from = { ...message.from, name: redact(message.from.name) };
    sanitized.to = message.to.map((address) => ({ ...address, name: redact(address.name) }));
    sanitized.cc = message.cc.map((address) => ({ ...address, name: redact(address.name) }));

    return {
      action: wasRedacted ? "redact" : "pass",
      reason: wasRedacted ? "PII patterns redacted" : undefined,
      message: sanitized,
    };
  }
}

function redactPii(text: string, emailRedaction: boolean, dollarAmountRedaction: boolean): string {
  let result = text;
  const patterns: PiiPattern[] = [...PII_PATTERNS];
  if (dollarAmountRedaction) {
    patterns.push(DOLLAR_AMOUNT_PATTERN, CURRENCY_AMOUNT_PATTERN);
  }
  if (emailRedaction) {
    patterns.push(EMAIL_ADDRESS_PATTERN);
  }
  for (const { pattern, replacement, validate } of patterns) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
    result = result.replace(pattern, (value) => validate && !validate(value) ? value : replacement);
  }
  return result;
}
