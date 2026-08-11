import type { BridgeDetectedSecretType } from "@bridge/observability";

export interface DetectedSecret {
  readonly fieldPath: string;
  readonly secretType: BridgeDetectedSecretType;
}

interface SecretPattern {
  readonly secretType: BridgeDetectedSecretType;
  readonly pattern: RegExp;
}

const secretPatterns: readonly SecretPattern[] = [
  {
    secretType: "bridge_service_token",
    pattern: /\bbrg_srv_[A-Za-z0-9_-]{43}\b/,
  },
  {
    secretType: "github_token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{20,255})\b/,
  },
  {
    secretType: "aws_access_key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    secretType: "google_api_key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    secretType: "slack_token",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/,
  },
  {
    secretType: "stripe_live_key",
    pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/,
  },
  {
    secretType: "ai_provider_key",
    pattern: /\bsk-(?:(?:proj|ant-[A-Za-z0-9-]+)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})\b/,
  },
  {
    secretType: "private_key",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
  },
  {
    secretType: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}(?![A-Za-z0-9._~+/-=])/i,
  },
  {
    secretType: "credential_url",
    pattern: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqps?):\/\/[^/\s:@]+:[^@\s/]+@/i,
  },
  {
    secretType: "secret_url_parameter",
    pattern: /[?&](?:access[_-]?token|api[_-]?key|client[_-]?secret|password|token)=[A-Za-z0-9._~+/-]{16,}/i,
  },
] as const;

function detectedSecretType(value: string): BridgeDetectedSecretType | undefined {
  return secretPatterns.find(({ pattern }) => pattern.test(value))?.secretType;
}

function childPath(parent: string, child: string): string {
  const safeChild = /^[A-Za-z0-9_-]{1,64}$/.test(child) ? child : "field";
  return parent ? `${parent}.${safeChild}` : safeChild;
}

export function detectSecret(value: unknown, fieldPath = "content", depth = 0): DetectedSecret | undefined {
  if (typeof value === "string") {
    const secretType = detectedSecretType(value);
    return secretType ? { fieldPath, secretType } : undefined;
  }
  if (value === null || typeof value !== "object" || depth >= 8) return undefined;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const detection = detectSecret(item, `${fieldPath}[${index}]`, depth + 1);
      if (detection) return detection;
    }
    return undefined;
  }
  for (const [key, item] of Object.entries(value).slice(0, 1_000)) {
    const detection = detectSecret(item, childPath(fieldPath, key), depth + 1);
    if (detection) return detection;
  }
  return undefined;
}
