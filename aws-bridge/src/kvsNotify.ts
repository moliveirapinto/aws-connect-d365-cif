// KVS-notify Lambda — invoked by the Amazon Connect contact flow immediately
// after the "Start media streaming" block. Its only job is to tell the Azure
// live-transcription consumer which KVS stream to read for this call, so the
// consumer can begin real-time Azure AI Speech transcription and stream the
// result into the D365 Omnichannel conversation.
//
// Connect exposes the customer media stream details on the contact both as
// invocation Parameters (when mapped in the flow) and under
// ContactData.MediaStreams.Customer.Audio. We read either.

interface ConnectMediaAudio {
  StreamARN?: string;
  StartFragmentNumber?: string;
  StartTimestamp?: string;
}

interface ConnectEvent {
  Details: {
    ContactData: {
      ContactId: string;
      CustomerEndpoint?: { Address?: string };
      Attributes?: Record<string, string>;
      MediaStreams?: { Customer?: { Audio?: ConnectMediaAudio } };
    };
    Parameters?: Record<string, string>;
  };
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export async function handler(event: ConnectEvent): Promise<{ ok: boolean }> {
  const cd = event.Details.ContactData;
  const params = event.Details.Parameters ?? {};
  const audio = cd.MediaStreams?.Customer?.Audio ?? {};

  const contactId = cd.ContactId;
  const ani = cd.CustomerEndpoint?.Address ?? params.ani;
  const agentId = params.agentId || cd.Attributes?.agentId;
  const streamArn = params.streamArn || audio.StreamARN;
  const startFragmentNumber = params.startFragmentNumber || audio.StartFragmentNumber;

  if (!streamArn) {
    console.error(
      `kvs-notify: no media stream ARN for contact ${contactId}. ` +
        `Ensure "Start media streaming" runs before this Lambda and maps the ` +
        `customer audio StreamARN/StartFragmentNumber as parameters.`,
    );
    return { ok: false };
  }

  const consumerUrl = req("CONSUMER_URL").replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = process.env.SESSION_KEY;
  if (key) headers["x-session-key"] = key;

  const res = await fetch(`${consumerUrl}/session/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({ contactId, ani, agentId, streamArn, startFragmentNumber }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    console.error(`kvs-notify: consumer start failed ${res.status} ${text}`);
    return { ok: false };
  }
  console.log(`kvs-notify: started live transcription for contact ${contactId}`);
  return { ok: true };
}
