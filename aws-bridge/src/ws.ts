// WebSocket connection registry (DynamoDB) + push to the CIF agent widget.
//
// Two lookup keys on the same row:
//   - agentEmail  : the widget's SSO identity, declared once via `identify`.
//                   Used to push `assigned` to the SPECIFIC accepting agent at
//                   the moment Amazon Connect routes a contact to them.
//   - contactId   : the active call the widget subscribed to (after `assigned`).
//                   Used to push transcript `segment`s and the `ended` signal.
//
// This is queue-agnostic and scale-free: the browser session IS the agent
// identity, so nothing here depends on which queue the agent is in or on a
// maintained Connect->D365 mapping table.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { env } from "./env.js";
import type { TranscriptSegment } from "./types.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Normalize an identity for stable matching (SSO emails are case-insensitive). */
function normEmail(v: string): string {
  return v.trim().toLowerCase();
}

export async function registerConnection(connectionId: string): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: env.connectionsTable,
      Item: { connectionId, ttl: Math.floor(Date.now() / 1000) + 4 * 3600 },
    })
  );
}

export async function removeConnection(connectionId: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({ TableName: env.connectionsTable, Key: { connectionId } })
  );
}

/** Bind a widget connection to the agent's SSO email (declared via `identify`). */
export async function identifyConnection(connectionId: string, agentEmail: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: env.connectionsTable,
      Key: { connectionId },
      UpdateExpression: "SET agentEmail = :e",
      ExpressionAttributeValues: { ":e": normEmail(agentEmail) },
    })
  );
}

export async function subscribeConnection(connectionId: string, contactId: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: env.connectionsTable,
      Key: { connectionId },
      UpdateExpression: "SET contactId = :c",
      ExpressionAttributeValues: { ":c": contactId },
    })
  );
}

export async function unsubscribeConnection(connectionId: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: env.connectionsTable,
      Key: { connectionId },
      UpdateExpression: "REMOVE contactId",
    })
  );
}

/** Post one JSON frame to a connection, cleaning up if it's gone (410). */
async function postFrame(
  api: ApiGatewayManagementApiClient,
  connectionId: string,
  frame: Uint8Array
): Promise<void> {
  try {
    await api.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: frame }));
  } catch (err: unknown) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 410) {
      await removeConnection(connectionId);
    }
  }
}

/** Connections currently subscribed to a contactId (via the `byContact` GSI). */
async function connectionsForContact(contactId: string): Promise<string[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: env.connectionsTable,
      IndexName: "byContact",
      KeyConditionExpression: "contactId = :c",
      ExpressionAttributeValues: { ":c": contactId },
    })
  );
  return (res.Items ?? []).map((i) => i.connectionId as string);
}

/** Connections owned by an agent email (via the `byAgent` GSI). */
async function connectionsForAgent(agentEmail: string): Promise<string[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: env.connectionsTable,
      IndexName: "byAgent",
      KeyConditionExpression: "agentEmail = :e",
      ExpressionAttributeValues: { ":e": normEmail(agentEmail) },
    })
  );
  return (res.Items ?? []).map((i) => i.connectionId as string);
}

async function pushFrame(connectionIds: string[], payload: unknown): Promise<void> {
  if (connectionIds.length === 0) return;
  const api = new ApiGatewayManagementApiClient({ endpoint: env.wsApiEndpoint });
  const frame = Buffer.from(JSON.stringify(payload));
  await Promise.all(connectionIds.map((id) => postFrame(api, id, frame)));
}

/** Push a transcript segment to every widget subscribed to its contactId. */
export async function broadcastSegment(seg: TranscriptSegment): Promise<void> {
  const ids = await connectionsForContact(seg.contactId);
  await pushFrame(ids, { type: "segment", data: seg });
}

/** Push a batch of transcript segments (used by the post-call S3 path). */
export async function broadcastSegments(segments: TranscriptSegment[]): Promise<void> {
  if (segments.length === 0) return;
  const ids = await connectionsForContact(segments[0].contactId);
  if (ids.length === 0) return;
  const api = new ApiGatewayManagementApiClient({ endpoint: env.wsApiEndpoint });
  for (const seg of segments) {
    const frame = Buffer.from(JSON.stringify({ type: "segment", data: seg }));
    await Promise.all(ids.map((id) => postFrame(api, id, frame)));
  }
}

/**
 * Tell the accepting agent's widget that a contact was routed to THEM, so it can
 * subscribe the live panel and (at call end) open the D365 conversation. Matches
 * any of the supplied identity candidates against the widget's declared email.
 */
export async function notifyAssigned(
  agentIdentities: string[],
  contactId: string
): Promise<number> {
  const seen = new Set<string>();
  for (const identity of agentIdentities) {
    if (!identity) continue;
    for (const id of await connectionsForAgent(identity)) seen.add(id);
  }
  const ids = [...seen];
  await pushFrame(ids, { type: "assigned", data: { contactId } });
  return ids.length;
}

/** Tell every widget subscribed to this contact that the call ended. */
export async function broadcastEnded(contactId: string): Promise<void> {
  const ids = await connectionsForContact(contactId);
  await pushFrame(ids, { type: "ended", data: { contactId } });
}
