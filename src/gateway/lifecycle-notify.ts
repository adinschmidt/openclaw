import { routeReply } from "../auto-reply/reply/route-reply.js";
import { listChannelPlugins, type ChannelId } from "../channels/plugins/index.js";
import type { OpenClawConfig } from "../config/config.js";

type GatewayLifecycleTarget = {
  channel: ChannelId;
  to: string;
  accountId?: string;
};

function normalizeLifecycleTarget(value: string | number | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  const normalized = String(value).trim();
  if (!normalized || normalized === "*") {
    return undefined;
  }
  return normalized;
}

function resolveLifecycleTarget(params: {
  cfg: OpenClawConfig;
  accountId?: string;
  resolveDefaultTo?: (params: {
    cfg: OpenClawConfig;
    accountId?: string | null;
  }) => string | undefined;
  resolveAllowFrom?: (params: {
    cfg: OpenClawConfig;
    accountId?: string | null;
  }) => Array<string | number> | undefined;
}): string | undefined {
  const defaultTo = normalizeLifecycleTarget(
    params.resolveDefaultTo?.({
      cfg: params.cfg,
      accountId: params.accountId,
    }),
  );
  if (defaultTo) {
    return defaultTo;
  }

  const allowFrom = params.resolveAllowFrom?.({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  if (!allowFrom?.length) {
    return undefined;
  }

  for (const candidate of allowFrom) {
    const target = normalizeLifecycleTarget(candidate);
    if (target) {
      return target;
    }
  }

  return undefined;
}

export async function collectGatewayLifecycleTargets(
  cfg: OpenClawConfig,
): Promise<GatewayLifecycleTarget[]> {
  const targets: GatewayLifecycleTarget[] = [];
  const seen = new Set<string>();

  for (const plugin of listChannelPlugins()) {
    const listAccountIds = plugin.config.listAccountIds;
    const resolveAccount = plugin.config.resolveAccount;
    if (typeof listAccountIds !== "function" || typeof resolveAccount !== "function") {
      continue;
    }

    const listedAccountIds = listAccountIds(cfg);
    const accountIds = listedAccountIds.length > 0 ? listedAccountIds : [undefined];

    for (const accountId of accountIds) {
      let account: unknown;
      try {
        account = resolveAccount(cfg, accountId);
      } catch {
        continue;
      }

      if (plugin.config.isEnabled && !plugin.config.isEnabled(account as never, cfg)) {
        continue;
      }
      if (plugin.config.isConfigured) {
        const isConfigured = await plugin.config.isConfigured(account as never, cfg);
        if (!isConfigured) {
          continue;
        }
      }

      const to = resolveLifecycleTarget({
        cfg,
        accountId,
        resolveDefaultTo: plugin.config.resolveDefaultTo,
        resolveAllowFrom: plugin.config.resolveAllowFrom,
      });
      if (!to) {
        continue;
      }

      const dedupeKey = `${plugin.id}\u0000${accountId ?? ""}\u0000${to}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      targets.push({
        channel: plugin.id,
        to,
        ...(accountId ? { accountId } : {}),
      });
    }
  }

  return targets;
}

export async function sendGatewayLifecycleNotice(params: {
  cfg: OpenClawConfig;
  text: string;
}): Promise<void> {
  const targets = await collectGatewayLifecycleTargets(params.cfg);
  if (targets.length === 0) {
    return;
  }

  await Promise.allSettled(
    targets.map((target) =>
      routeReply({
        payload: { text: params.text },
        channel: target.channel,
        to: target.to,
        accountId: target.accountId,
        cfg: params.cfg,
      }),
    ),
  );
}
