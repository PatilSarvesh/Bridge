import { createHash } from "node:crypto";

import { SESv2Client, SendEmailCommand, type SendEmailCommandOutput } from "@aws-sdk/client-sesv2";

import {
  type EmailRecipientDirectory,
  type EmailSender,
  type EmailSendRequest,
  normalizeEmailAddress,
} from "./email.js";

const maximumRecipientCount = 1_000;
const maximumRecipientConfigurationBytes = 256_000;

export interface SesCommandClient {
  send(command: SendEmailCommand): Promise<Pick<SendEmailCommandOutput, "MessageId">>;
}

export interface SesEmailConfiguration {
  readonly region: string;
  readonly fromAddress: string;
  readonly recipients: Readonly<Record<string, string>>;
  readonly configurationSetName?: string;
}

export interface SesEmailEnvironment {
  readonly BRIDGE_SES_REGION?: string;
  readonly BRIDGE_SES_FROM_ADDRESS?: string;
  readonly BRIDGE_EMAIL_RECIPIENTS?: string;
  readonly BRIDGE_SES_CONFIGURATION_SET?: string;
}

export interface SesEmailSenderOptions {
  readonly region: string;
  readonly fromAddress: string;
  readonly configurationSetName?: string;
  readonly client?: SesCommandClient;
}

function validateRegion(value: string): string {
  const region = value.trim().toLocaleLowerCase("en");
  if (!/^[a-z]{2,8}(?:-[a-z0-9]+)+-[0-9]+$/.test(region)) {
    throw new Error("BRIDGE_SES_REGION must be a valid AWS region name.");
  }
  return region;
}

function validateConfigurationSetName(value: string): string {
  const name = value.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
    throw new Error("BRIDGE_SES_CONFIGURATION_SET must contain only letters, numbers, underscores, or hyphens.");
  }
  return name;
}

function validatePrincipalId(value: string): string {
  const principalId = value.trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(principalId) || ["__proto__", "constructor", "prototype"].includes(principalId)) {
    throw new Error("BRIDGE_EMAIL_RECIPIENTS contains an invalid principal ID.");
  }
  return principalId;
}

function parseRecipientMapping(raw: string): Readonly<Record<string, string>> {
  if (Buffer.byteLength(raw, "utf8") > maximumRecipientConfigurationBytes) {
    throw new Error("BRIDGE_EMAIL_RECIPIENTS exceeds the configured size limit.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("BRIDGE_EMAIL_RECIPIENTS must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BRIDGE_EMAIL_RECIPIENTS must be a JSON object keyed by principal ID.");
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > maximumRecipientCount) {
    throw new Error(`BRIDGE_EMAIL_RECIPIENTS must contain between 1 and ${maximumRecipientCount} recipients.`);
  }

  const normalizedEntries: Array<readonly [string, string]> = [];
  const principalIds = new Set<string>();
  for (const [principalId, address] of entries) {
    const normalizedPrincipalId = validatePrincipalId(principalId);
    if (principalIds.has(normalizedPrincipalId)) {
      throw new Error("BRIDGE_EMAIL_RECIPIENTS contains duplicate normalized principal IDs.");
    }
    if (typeof address !== "string") {
      throw new Error("Every BRIDGE_EMAIL_RECIPIENTS value must be an email address string.");
    }
    principalIds.add(normalizedPrincipalId);
    normalizedEntries.push([normalizedPrincipalId, normalizeEmailAddress(address)]);
  }
  return Object.fromEntries(normalizedEntries);
}

export function loadSesEmailConfiguration(environment: SesEmailEnvironment = process.env): SesEmailConfiguration {
  const rawRegion = environment.BRIDGE_SES_REGION?.trim();
  const rawFromAddress = environment.BRIDGE_SES_FROM_ADDRESS?.trim();
  const rawRecipients = environment.BRIDGE_EMAIL_RECIPIENTS?.trim();
  if (!rawRegion) throw new Error("BRIDGE_SES_REGION is required when worker email delivery is enabled.");
  if (!rawFromAddress) {
    throw new Error("BRIDGE_SES_FROM_ADDRESS is required when worker email delivery is enabled.");
  }
  if (!rawRecipients) {
    throw new Error("BRIDGE_EMAIL_RECIPIENTS is required when worker email delivery is enabled.");
  }

  const configurationSetName = environment.BRIDGE_SES_CONFIGURATION_SET?.trim();
  return {
    region: validateRegion(rawRegion),
    fromAddress: normalizeEmailAddress(rawFromAddress),
    recipients: parseRecipientMapping(rawRecipients),
    ...(configurationSetName ? { configurationSetName: validateConfigurationSetName(configurationSetName) } : {}),
  };
}

export function createEmailRecipientDirectory(recipients: Readonly<Record<string, string>>): EmailRecipientDirectory {
  const normalized = new Map<string, string>();
  const entries = Object.entries(recipients);
  if (entries.length > maximumRecipientCount) {
    throw new Error(`The email recipient directory supports at most ${maximumRecipientCount} recipients.`);
  }
  for (const [principalId, address] of entries) {
    normalized.set(validatePrincipalId(principalId), normalizeEmailAddress(address));
  }
  return {
    resolveEmailRecipient: async (recipientId) => {
      const address = normalized.get(recipientId);
      return address ? { address, preference: "immediate" } : undefined;
    },
  };
}

function validateMessage(request: EmailSendRequest): void {
  if (!request.subject || request.subject.length > 500 || /[\r\n]/.test(request.subject)) {
    throw new Error("The SES email subject is invalid.");
  }
  if (!request.text || Buffer.byteLength(request.text, "utf8") > 500_000) {
    throw new Error("The SES email body is invalid.");
  }
  if (!request.idempotencyKey || request.idempotencyKey.length > 500) {
    throw new Error("The SES email idempotency key is invalid.");
  }
  if (!request.correlationId || request.correlationId.length > 200) {
    throw new Error("The SES email correlation ID is invalid.");
  }
}

function opaqueTag(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createSesEmailSender(options: SesEmailSenderOptions): EmailSender {
  const region = validateRegion(options.region);
  const fromAddress = normalizeEmailAddress(options.fromAddress);
  const configurationSetName = options.configurationSetName
    ? validateConfigurationSetName(options.configurationSetName)
    : undefined;
  const client: SesCommandClient = options.client ?? new SESv2Client({ region });

  return {
    async send(request) {
      validateMessage(request);
      const command = new SendEmailCommand({
        FromEmailAddress: fromAddress,
        Destination: { ToAddresses: [normalizeEmailAddress(request.to)] },
        Content: {
          Simple: {
            Subject: { Data: request.subject, Charset: "UTF-8" },
            Body: { Text: { Data: request.text, Charset: "UTF-8" } },
          },
        },
        EmailTags: [
          { Name: "bridge-delivery", Value: opaqueTag(request.idempotencyKey) },
          { Name: "bridge-correlation", Value: opaqueTag(request.correlationId) },
        ],
        ...(configurationSetName ? { ConfigurationSetName: configurationSetName } : {}),
      });
      const result = await client.send(command);
      const providerMessageId = result.MessageId?.trim();
      if (!providerMessageId) throw new Error("SES did not return a message ID.");
      return { providerMessageId };
    },
  };
}
