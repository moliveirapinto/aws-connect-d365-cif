// API Gateway WebSocket handler for the CIF agent widget.
// Routes: $connect, $disconnect, and "subscribe"/"unsubscribe" (by contactId).

import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  registerConnection,
  removeConnection,
  identifyConnection,
  subscribeConnection,
  unsubscribeConnection,
} from "./ws.js";

export async function handler(
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResultV2> {
  const { connectionId, routeKey } = event.requestContext;

  try {
    if (routeKey === "$connect") {
      await registerConnection(connectionId);
      return { statusCode: 200, body: "connected" };
    }
    if (routeKey === "$disconnect") {
      await removeConnection(connectionId);
      return { statusCode: 200, body: "disconnected" };
    }

    // Custom routes carry a JSON body: { action, agentUpn?, contactId? }.
    const body = event.body
      ? (JSON.parse(event.body) as { action?: string; agentUpn?: string; contactId?: string })
      : {};
    if (body.action === "identify" && body.agentUpn) {
      await identifyConnection(connectionId, body.agentUpn);
      return { statusCode: 200, body: "identified" };
    }
    if (body.action === "subscribe" && body.contactId) {
      await subscribeConnection(connectionId, body.contactId);
      return { statusCode: 200, body: "subscribed" };
    }
    if (body.action === "unsubscribe") {
      await unsubscribeConnection(connectionId);
      return { statusCode: 200, body: "unsubscribed" };
    }
    return { statusCode: 400, body: "unknown action" };
  } catch (err) {
    console.error("websocket handler error", err);
    return { statusCode: 500, body: "error" };
  }
}
