// Resolve an Amazon Connect agent username to their SSO email — the natural key
// that also identifies the agent in D365 (both provisioned from the same IdP).
//
// This avoids ANY maintained Connect->D365 mapping table: at accept time we look
// up the accepting agent's email directly from Connect and match it against the
// email the D365 CIF widget declared over its WebSocket (`identify`).
//
// SearchUsers(Username EXACT) -> userId -> DescribeUser -> IdentityInfo.Email.
// Results are cached in-process (warm container) so a busy agent costs at most
// one pair of Connect calls per cold start — scale-free for tens of thousands.

import {
  ConnectClient,
  SearchUsersCommand,
  DescribeUserCommand,
} from "@aws-sdk/client-connect";
import { env } from "./env.js";

const connect = new ConnectClient({});
const cache = new Map<string, string | undefined>();

export async function resolveAgentEmail(username: string): Promise<string | undefined> {
  const key = username.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key);

  let email: string | undefined;
  try {
    const found = await connect.send(
      new SearchUsersCommand({
        InstanceId: env.connectInstanceId,
        SearchCriteria: {
          StringCondition: {
            FieldName: "Username",
            Value: username,
            ComparisonType: "EXACT",
          },
        },
        MaxResults: 1,
      })
    );
    const userId = found.Users?.[0]?.Id;
    if (userId) {
      const user = await connect.send(
        new DescribeUserCommand({ InstanceId: env.connectInstanceId, UserId: userId })
      );
      email = user.User?.IdentityInfo?.Email ?? undefined;
    }
  } catch (err) {
    console.warn("resolveAgentEmail failed for", username, err);
  }

  cache.set(key, email);
  return email;
}
