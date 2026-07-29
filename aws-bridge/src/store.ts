// Active-contacts store (DynamoDB): one row per live call being polled for
// Contact Lens real-time transcript.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { env } from "./env.js";
import type { ActiveContact } from "./types.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function putActive(c: ActiveContact): Promise<void> {
  await ddb.send(new PutCommand({ TableName: env.activeTable, Item: c }));
}

export async function getActive(contactId: string): Promise<ActiveContact | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: env.activeTable, Key: { contactId } })
  );
  return res.Item as ActiveContact | undefined;
}

export async function deleteActive(contactId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: env.activeTable, Key: { contactId } }));
}
