import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const { listChannelPluginsMock, routeReplyMock } = vi.hoisted(() => ({
  listChannelPluginsMock: vi.fn(),
  routeReplyMock: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../channels/plugins/index.js", () => ({
  listChannelPlugins: listChannelPluginsMock,
}));

vi.mock("../auto-reply/reply/route-reply.js", () => ({
  routeReply: routeReplyMock,
}));

import { sendGatewayLifecycleNotice } from "./lifecycle-notify.js";

describe("sendGatewayLifecycleNotice", () => {
  beforeEach(() => {
    listChannelPluginsMock.mockReset();
    routeReplyMock.mockClear();
  });

  it("broadcasts lifecycle notices across configured channels/accounts", async () => {
    listChannelPluginsMock.mockReturnValue([
      {
        id: "telegram",
        config: {
          listAccountIds: () => ["default"],
          resolveAccount: () => ({ enabled: true }),
          isEnabled: (account: { enabled: boolean }) => account.enabled,
          isConfigured: () => true,
          resolveDefaultTo: () => "377040389",
        },
      },
      {
        id: "slack",
        config: {
          listAccountIds: () => ["work"],
          resolveAccount: () => ({ enabled: true }),
          isConfigured: async () => true,
          resolveDefaultTo: () => "U0AMV83SA6M",
        },
      },
    ]);

    await sendGatewayLifecycleNotice({
      cfg: {} as OpenClawConfig,
      text: "gateway started",
    });

    expect(routeReplyMock).toHaveBeenCalledTimes(2);
    expect(routeReplyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: { text: "gateway started" },
        channel: "telegram",
        to: "377040389",
        accountId: "default",
      }),
    );
    expect(routeReplyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: { text: "gateway started" },
        channel: "slack",
        to: "U0AMV83SA6M",
        accountId: "work",
      }),
    );
  });

  it("falls back to allowFrom when defaultTo is missing and skips wildcard-only routes", async () => {
    listChannelPluginsMock.mockReturnValue([
      {
        id: "discord",
        config: {
          listAccountIds: () => ["default", "default"],
          resolveAccount: () => ({}),
          isConfigured: () => true,
          resolveAllowFrom: () => ["*", "user:123"],
        },
      },
      {
        id: "telegram",
        config: {
          listAccountIds: () => ["default"],
          resolveAccount: () => ({}),
          isConfigured: () => true,
          resolveAllowFrom: () => ["*"],
        },
      },
    ]);

    await sendGatewayLifecycleNotice({
      cfg: {} as OpenClawConfig,
      text: "gateway stopping",
    });

    expect(routeReplyMock).toHaveBeenCalledTimes(1);
    expect(routeReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { text: "gateway stopping" },
        channel: "discord",
        to: "user:123",
        accountId: "default",
      }),
    );
  });
});
