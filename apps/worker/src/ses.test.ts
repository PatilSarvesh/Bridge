import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { describe, expect, it } from "vitest";

import {
  createEmailRecipientDirectory,
  createSesEmailSender,
  loadSesEmailConfiguration,
  type SesCommandClient,
} from "./ses.js";

describe("SES email configuration", () => {
  it("loads and normalizes a bounded deployment recipient directory", async () => {
    const configuration = loadSesEmailConfiguration({
      BRIDGE_SES_REGION: " AP-SOUTH-1 ",
      BRIDGE_SES_FROM_ADDRESS: " Bridge@Example.test ",
      BRIDGE_EMAIL_RECIPIENTS: JSON.stringify({
        usr_architect: " Architect@Example.test ",
        usr_reviewer: "reviewer@example.test",
      }),
      BRIDGE_SES_CONFIGURATION_SET: "bridge-pilot",
    });

    expect(configuration).toEqual({
      region: "ap-south-1",
      fromAddress: "bridge@example.test",
      recipients: {
        usr_architect: "architect@example.test",
        usr_reviewer: "reviewer@example.test",
      },
      configurationSetName: "bridge-pilot",
    });
    const directory = createEmailRecipientDirectory(configuration.recipients);
    await expect(directory.resolveEmailRecipient("usr_architect")).resolves.toEqual({
      address: "architect@example.test",
      preference: "immediate",
    });
    await expect(directory.resolveEmailRecipient("usr_missing")).resolves.toBeUndefined();
  });

  it("fails closed for missing or malformed deployment configuration", () => {
    expect(() => loadSesEmailConfiguration({})).toThrow(
      "BRIDGE_SES_REGION is required when worker email delivery is enabled.",
    );
    expect(() =>
      loadSesEmailConfiguration({
        BRIDGE_SES_REGION: "ap-south-1",
        BRIDGE_SES_FROM_ADDRESS: "bridge@example.test",
        BRIDGE_EMAIL_RECIPIENTS: "not-json",
      }),
    ).toThrow("BRIDGE_EMAIL_RECIPIENTS must be valid JSON.");
    expect(() =>
      loadSesEmailConfiguration({
        BRIDGE_SES_REGION: "ap-south-1",
        BRIDGE_SES_FROM_ADDRESS: "bridge@example.test",
        BRIDGE_EMAIL_RECIPIENTS: JSON.stringify({ "invalid principal": "person@example.test" }),
      }),
    ).toThrow("BRIDGE_EMAIL_RECIPIENTS contains an invalid principal ID.");
    expect(() =>
      loadSesEmailConfiguration({
        BRIDGE_SES_REGION: "https://example.test",
        BRIDGE_SES_FROM_ADDRESS: "bridge@example.test",
        BRIDGE_EMAIL_RECIPIENTS: JSON.stringify({ usr_architect: "person@example.test" }),
      }),
    ).toThrow("BRIDGE_SES_REGION must be a valid AWS region name.");
    expect(() =>
      loadSesEmailConfiguration({
        BRIDGE_SES_REGION: "ap-south-1",
        BRIDGE_SES_FROM_ADDRESS: "bridge@example.test",
        BRIDGE_EMAIL_RECIPIENTS: JSON.stringify({ usr_architect: "first,second@example.test" }),
      }),
    ).toThrow("The resolved email destination is invalid.");
    expect(() =>
      loadSesEmailConfiguration({
        BRIDGE_SES_REGION: "ap-south-1",
        BRIDGE_SES_FROM_ADDRESS: "bridge@example.test",
        BRIDGE_EMAIL_RECIPIENTS: JSON.stringify({
          " usr_architect": "first@example.test",
          usr_architect: "second@example.test",
        }),
      }),
    ).toThrow("BRIDGE_EMAIL_RECIPIENTS contains duplicate normalized principal IDs.");
  });
});

describe("SES email sender", () => {
  it("sends bounded plain text with opaque provider tags", async () => {
    const commands: SendEmailCommand[] = [];
    const client: SesCommandClient = {
      send: async (command) => {
        commands.push(command);
        return { MessageId: "ses-message-001" };
      },
    };
    const sender = createSesEmailSender({
      region: "ap-south-1",
      fromAddress: "bridge@example.test",
      configurationSetName: "bridge-pilot",
      client,
    });

    await expect(
      sender.send({
        to: "reviewer@example.test",
        subject: "[Bridge] Review assignment",
        text: "Open Bridge to review the authoritative record.",
        idempotencyKey: "evt_sensitive:email",
        correlationId: "cor_sensitive",
      }),
    ).resolves.toEqual({ providerMessageId: "ses-message-001" });

    expect(commands).toHaveLength(1);
    expect(commands[0]?.input).toMatchObject({
      FromEmailAddress: "bridge@example.test",
      Destination: { ToAddresses: ["reviewer@example.test"] },
      Content: {
        Simple: {
          Subject: { Data: "[Bridge] Review assignment", Charset: "UTF-8" },
          Body: { Text: { Data: "Open Bridge to review the authoritative record.", Charset: "UTF-8" } },
        },
      },
      ConfigurationSetName: "bridge-pilot",
    });
    const tags = commands[0]?.input.EmailTags ?? [];
    expect(tags).toEqual([
      { Name: "bridge-delivery", Value: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { Name: "bridge-correlation", Value: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
    expect(JSON.stringify(tags)).not.toContain("evt_sensitive");
    expect(JSON.stringify(tags)).not.toContain("cor_sensitive");
  });

  it("rejects unsafe messages and missing provider identifiers", async () => {
    const client: SesCommandClient = { send: async () => ({}) };
    const sender = createSesEmailSender({
      region: "ap-south-1",
      fromAddress: "bridge@example.test",
      client,
    });
    await expect(
      sender.send({
        to: "reviewer@example.test",
        subject: "unsafe\r\nBcc: outsider@example.test",
        text: "Review Bridge.",
        idempotencyKey: "evt_1:email",
        correlationId: "cor_1",
      }),
    ).rejects.toThrow("The SES email subject is invalid.");
    await expect(
      sender.send({
        to: "reviewer@example.test",
        subject: "Bridge review",
        text: "Review Bridge.",
        idempotencyKey: "evt_1:email",
        correlationId: "cor_1",
      }),
    ).rejects.toThrow("SES did not return a message ID.");
  });
});
