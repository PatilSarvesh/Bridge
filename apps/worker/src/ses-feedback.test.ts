import { generateKeyPairSync, type KeyObject, sign as signCryptographicPayload } from "node:crypto";

import { BridgeMetrics, runWithCorrelationContext } from "@bridge/observability";
import { describe, expect, it, vi } from "vitest";

import {
  createBridgeFeedbackForwarder,
  createSesFeedbackProcessor,
  createSnsSignatureVerifier,
  createSnsSubscriptionConfirmer,
  loadSesFeedbackConfiguration,
  normalizeSesFeedback,
  type SesFeedbackConfiguration,
  type SnsEnvelope,
  snsStringToSign,
  startSesFeedbackServer,
  validateSnsSigningCertificateUrl,
} from "./ses-feedback.js";

const topicArn = "arn:aws:sns:ap-south-1:123456789012:bridge-feedback";
const projectId = "prj_payments";
const certificateUrl = "https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-0123456789abcdef.pem";
const serviceToken = `brg_srv_${"a".repeat(43)}`;

function configuration(overrides: Partial<SesFeedbackConfiguration> = {}): SesFeedbackConfiguration {
  return {
    host: "127.0.0.1",
    port: 4_300,
    apiUrl: "https://api.bridge.example/",
    serviceToken,
    topicProjects: new Map([[topicArn, projectId]]),
    confirmSubscriptions: false,
    requestTimeoutMs: 1_000,
    maximumBodyBytes: 256_000,
    certificateCacheTtlMs: 60_000,
    replayTtlMs: 60_000,
    maximumReplayEntries: 100,
    ...overrides,
  };
}

function baseEnvelope(overrides: Partial<SnsEnvelope> = {}): SnsEnvelope {
  return {
    Type: "Notification",
    MessageId: "11111111-2222-4333-8444-555555555555",
    TopicArn: topicArn,
    Message: JSON.stringify({
      notificationType: "Bounce",
      mail: {
        messageId: "0102018a-message-id",
        destination: ["private-recipient@example.test"],
      },
      bounce: {
        timestamp: "2026-08-30T08:30:00.000Z",
        bouncedRecipients: [{ emailAddress: "private-recipient@example.test" }],
      },
      futureField: { private: "not-forwarded" },
    }),
    Timestamp: "2026-08-30T08:31:00.000Z",
    SignatureVersion: "2",
    Signature: "cGxhY2Vob2xkZXI=",
    SigningCertURL: certificateUrl,
    ...overrides,
  };
}

function signedEnvelope(privateKey: KeyObject, overrides: Partial<SnsEnvelope> = {}): SnsEnvelope {
  const message = baseEnvelope(overrides);
  return {
    ...message,
    Signature: signCryptographicPayload(
      message.SignatureVersion === "1" ? "RSA-SHA1" : "RSA-SHA256",
      Buffer.from(snsStringToSign(message), "utf8"),
      privateKey,
    ).toString("base64"),
  };
}

function snsHeaders(message: SnsEnvelope): Record<string, string> {
  return {
    "content-type": "text/plain; charset=UTF-8",
    "x-amz-sns-message-id": message.MessageId,
    "x-amz-sns-message-type": message.Type,
    "x-amz-sns-topic-arn": message.TopicArn,
  };
}

describe("SES feedback ingress configuration", () => {
  it("is disabled by default and loads only exact, bounded deployment mappings", () => {
    expect(loadSesFeedbackConfiguration({})).toBeUndefined();

    const loaded = loadSesFeedbackConfiguration({
      BRIDGE_SES_FEEDBACK_INGRESS_ENABLED: "true",
      BRIDGE_SES_FEEDBACK_API_URL: "https://api.bridge.example",
      BRIDGE_SES_FEEDBACK_SERVICE_TOKEN: serviceToken,
      BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS: JSON.stringify({ [topicArn]: projectId }),
      BRIDGE_SES_FEEDBACK_CONFIRM_SUBSCRIPTIONS: "true",
    });

    expect(loaded).toMatchObject({
      host: "127.0.0.1",
      port: 4_300,
      apiUrl: "https://api.bridge.example/",
      serviceToken,
      confirmSubscriptions: true,
      requestTimeoutMs: 5_000,
      maximumBodyBytes: 256_000,
    });
    expect(loaded?.topicProjects).toEqual(new Map([[topicArn, projectId]]));
  });

  it("rejects credentials in URLs, non-loopback plaintext, malformed tokens, and non-SNS topics", () => {
    const base = {
      BRIDGE_SES_FEEDBACK_INGRESS_ENABLED: "true",
      BRIDGE_SES_FEEDBACK_SERVICE_TOKEN: serviceToken,
      BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS: JSON.stringify({ [topicArn]: projectId }),
    } as const;

    expect(() =>
      loadSesFeedbackConfiguration({ ...base, BRIDGE_SES_FEEDBACK_API_URL: "http://api.bridge.example" }),
    ).toThrow("must use HTTPS");
    expect(() =>
      loadSesFeedbackConfiguration({
        ...base,
        BRIDGE_SES_FEEDBACK_API_URL: "https://user:password@api.bridge.example",
      }),
    ).toThrow("without credentials");
    expect(() =>
      loadSesFeedbackConfiguration({
        ...base,
        BRIDGE_SES_FEEDBACK_API_URL: "https://api.bridge.example",
        BRIDGE_SES_FEEDBACK_SERVICE_TOKEN: "must-not-pass",
      }),
    ).toThrow("valid Bridge service token");
    expect(() =>
      loadSesFeedbackConfiguration({
        ...base,
        BRIDGE_SES_FEEDBACK_API_URL: "https://api.bridge.example",
        BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS: JSON.stringify({ "https://example.test/topic": projectId }),
      }),
    ).toThrow("invalid SNS topic ARN");
  });
});

describe("SNS authentication", () => {
  it("verifies both supported signature versions and caches the trusted key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2_048 });
    const loadSigningKey = vi.fn(async () => ({
      key: publicKey,
      validUntil: Date.parse("2026-09-01T00:00:00.000Z"),
    }));
    const verifySignature = createSnsSignatureVerifier({
      loadSigningKey,
      now: () => Date.parse("2026-08-30T00:00:00.000Z"),
    });

    await verifySignature(signedEnvelope(privateKey, { SignatureVersion: "1" }));
    await verifySignature(signedEnvelope(privateKey, { SignatureVersion: "2", MessageId: "message-two" }));
    expect(loadSigningKey).toHaveBeenCalledTimes(1);

    const tampered = signedEnvelope(privateKey, { MessageId: "message-tampered" });
    await expect(verifySignature({ ...tampered, Message: `${tampered.Message} ` })).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
      statusCode: 403,
    });
  });

  it("uses the fixed AWS field order and rejects certificate SSRF shapes", () => {
    const message = baseEnvelope({ Subject: "Bridge subject" });
    expect(snsStringToSign(message)).toBe(
      `Message\n${message.Message}\nMessageId\n${message.MessageId}\nSubject\nBridge subject\nTimestamp\n${message.Timestamp}\nTopicArn\n${topicArn}\nType\nNotification\n`,
    );
    expect(validateSnsSigningCertificateUrl(certificateUrl).hostname).toBe("sns.ap-south-1.amazonaws.com");
    expect(() =>
      validateSnsSigningCertificateUrl(
        "https://sns.ap-south-1.amazonaws.com.evil.test/SimpleNotificationService-test.pem",
      ),
    ).toThrow("invalid AWS URL");
    expect(() => validateSnsSigningCertificateUrl("https://sns.ap-south-1.amazonaws.com/../../metadata.pem")).toThrow(
      "signing certificate URL is invalid",
    );
    expect(() =>
      validateSnsSigningCertificateUrl(
        "https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-test.pem?target=metadata",
      ),
    ).toThrow("signing certificate URL is invalid");
  });
});

describe("SES feedback normalization and routing", () => {
  it("forwards only normalized bounce metadata and makes a verified replay idempotent", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2_048 });
    const message = signedEnvelope(privateKey);
    const forwarded: unknown[] = [];
    const processor = createSesFeedbackProcessor({
      configuration: configuration(),
      verifySignature: createSnsSignatureVerifier({
        loadSigningKey: async () => ({ key: publicKey, validUntil: Date.now() + 60_000 }),
      }),
      forwardFeedback: async (targetProjectId, input) => {
        forwarded.push({ targetProjectId, input });
      },
      confirmSubscription: async () => undefined,
    });

    await expect(processor({ body: JSON.stringify(message), headers: snsHeaders(message) })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.stringContaining("recorded"),
    });
    await expect(processor({ body: JSON.stringify(message), headers: snsHeaders(message) })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.stringContaining("idempotent_replay"),
    });
    expect(forwarded).toEqual([
      {
        targetProjectId: projectId,
        input: {
          channel: "email",
          provider: "ses",
          providerMessageId: "0102018a-message-id",
          type: "bounce",
          receivedAt: "2026-08-30T08:30:00.000Z",
        },
      },
    ]);
    expect(JSON.stringify(forwarded)).not.toContain("private-recipient");
    expect(JSON.stringify(forwarded)).not.toContain("futureField");
  });

  it("accepts the SES event-publishing complaint shape and ignores unrelated event types", () => {
    const complaint = baseEnvelope({
      Message: JSON.stringify({
        eventType: "Complaint",
        mail: { messageId: "ses-complaint-1" },
        complaint: { timestamp: "2026-08-30T09:00:00.000Z", complainedRecipients: [] },
      }),
    });
    expect(normalizeSesFeedback(complaint)).toEqual({
      channel: "email",
      provider: "ses",
      providerMessageId: "ses-complaint-1",
      type: "complaint",
      receivedAt: "2026-08-30T09:00:00.000Z",
    });
    expect(
      normalizeSesFeedback(
        baseEnvelope({ Message: JSON.stringify({ notificationType: "Delivery", mail: { messageId: "delivered" } }) }),
      ),
    ).toBeUndefined();
  });

  it("rejects unexpected topics and mismatched SNS headers before forwarding", async () => {
    const verifySignature = vi.fn(async () => undefined);
    const forwardFeedback = vi.fn(async () => undefined);
    const processor = createSesFeedbackProcessor({
      configuration: configuration(),
      verifySignature,
      forwardFeedback,
      confirmSubscription: async () => undefined,
    });
    const unexpected = baseEnvelope({ TopicArn: "arn:aws:sns:ap-south-1:123456789012:unexpected" });
    await expect(
      processor({ body: JSON.stringify(unexpected), headers: snsHeaders(unexpected) }),
    ).rejects.toMatchObject({ code: "UNEXPECTED_TOPIC", statusCode: 403 });
    expect(verifySignature).not.toHaveBeenCalled();

    const message = baseEnvelope();
    await expect(
      processor({
        body: JSON.stringify(message),
        headers: { ...snsHeaders(message), "x-amz-sns-message-type": "SubscriptionConfirmation" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_SNS_MESSAGE", statusCode: 400 });
    expect(forwardFeedback).not.toHaveBeenCalled();
  });
});

describe("canonical REST forwarding and subscription confirmation", () => {
  it("sends the scoped bearer only to the configured canonical API endpoint", async () => {
    const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const forward = createBridgeFeedbackForwarder({
      apiUrl: "https://api.bridge.example/",
      serviceToken,
      timeoutMs: 1_000,
      fetch: async (input, init) => {
        requests.push({ url: input.toString(), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({ disposition: "recorded" }), { status: 200 });
      },
    });
    const input = normalizeSesFeedback(baseEnvelope());
    expect(input).toBeDefined();
    await runWithCorrelationContext({ correlationId: "sns-test-correlation", source: "integration" }, () =>
      forward(projectId, input!),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://api.bridge.example/v1/projects/prj_payments/integrations/notifications/delivery-feedback",
    );
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(`Bearer ${serviceToken}`);
    expect(new Headers(requests[0]?.init?.headers).get("x-bridge-correlation-id")).toBe("sns-test-correlation");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(input);
  });

  it("does not reflect downstream bodies or credentials when the canonical API is unavailable", async () => {
    const forward = createBridgeFeedbackForwarder({
      apiUrl: "https://api.bridge.example/",
      serviceToken,
      timeoutMs: 1_000,
      fetch: async () => new Response(`rejected ${serviceToken} private-recipient@example.test`, { status: 403 }),
    });
    const input = normalizeSesFeedback(baseEnvelope());

    let failure: unknown;
    try {
      await forward(projectId, input!);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "BRIDGE_API_UNAVAILABLE", statusCode: 503 });
    expect(String(failure)).not.toContain(serviceToken);
    expect(String(failure)).not.toContain("private-recipient");
  });

  it("confirms only the signed topic's exact AWS confirmation URL", async () => {
    const requests: string[] = [];
    const confirm = createSnsSubscriptionConfirmer({
      timeoutMs: 1_000,
      fetch: async (input) => {
        requests.push(input.toString());
        return new Response("confirmed", { status: 200 });
      },
    });
    const token = "opaque-confirmation-token";
    const subscribeUrl = new URL("https://sns.ap-south-1.amazonaws.com/");
    subscribeUrl.searchParams.set("Action", "ConfirmSubscription");
    subscribeUrl.searchParams.set("TopicArn", topicArn);
    subscribeUrl.searchParams.set("Token", token);
    const message = baseEnvelope({
      Type: "SubscriptionConfirmation",
      Token: token,
      SubscribeURL: subscribeUrl.toString(),
    });

    await confirm(message);
    expect(requests).toEqual([subscribeUrl.toString()]);
    await expect(
      confirm({
        ...message,
        SubscribeURL: "https://sns.ap-south-1.amazonaws.com.evil.test/?Action=ConfirmSubscription",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SNS_MESSAGE", statusCode: 400 });
  });

  it("keeps subscription confirmation disabled until the deployment owner opts in", async () => {
    const message = baseEnvelope({
      Type: "SubscriptionConfirmation",
      Token: "confirmation-token",
      SubscribeURL:
        "https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn%3Aaws%3Asns%3Aap-south-1%3A123456789012%3Abridge-feedback&Token=confirmation-token",
    });
    const processor = createSesFeedbackProcessor({
      configuration: configuration(),
      verifySignature: async () => undefined,
      forwardFeedback: async () => undefined,
      confirmSubscription: async () => undefined,
    });

    await expect(processor({ body: JSON.stringify(message), headers: snsHeaders(message) })).rejects.toMatchObject({
      code: "SUBSCRIPTION_CONFIRMATION_DISABLED",
      statusCode: 503,
    });
  });
});

describe("SES feedback HTTP listener", () => {
  it("exposes only the bounded webhook route and records privacy-safe request metrics", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2_048 });
    const metrics = new BridgeMetrics();
    const apiRequests: string[] = [];
    const server = await startSesFeedbackServer({
      configuration: configuration({ port: 0, maximumBodyBytes: 2_048 }),
      metrics,
      signingKeyLoader: async () => ({ key: publicKey, validUntil: Date.now() + 60_000 }),
      fetch: async (input) => {
        apiRequests.push(input.toString());
        return new Response("{}", { status: 200 });
      },
    });
    try {
      const message = signedEnvelope(privateKey);
      const response = await fetch(`http://127.0.0.1:${server.port}/webhooks/aws/ses`, {
        method: "POST",
        headers: snsHeaders(message),
        body: JSON.stringify(message),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "recorded" });
      expect(apiRequests).toEqual([
        "https://api.bridge.example/v1/projects/prj_payments/integrations/notifications/delivery-feedback",
      ]);

      const unmatched = await fetch(`http://127.0.0.1:${server.port}/private?token=must-not-appear`);
      expect(unmatched.status).toBe(404);
      const oversized = await fetch(`http://127.0.0.1:${server.port}/webhooks/aws/ses`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "x".repeat(2_049),
      });
      expect(oversized.status).toBe(413);
      expect(metrics.renderPrometheus()).toContain(
        'bridge_http_requests_total{operation="/webhooks/aws/ses",outcome="success",service="worker"} 1',
      );
      expect(metrics.renderPrometheus()).not.toContain("must-not-appear");
      expect(metrics.renderPrometheus()).not.toContain(topicArn);
    } finally {
      await server.close();
    }
  });
});
