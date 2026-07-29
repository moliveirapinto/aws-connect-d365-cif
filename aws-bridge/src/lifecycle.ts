// Lifecycle Lambda — invoked by the Amazon Connect contact flow at call start/end.
//
// NOTE: On this Connect instance the Contact Lens *real-time* analysis API never
// yields segments, so the real-time streaming path (create conversation on
// "started", poll live segments, close on "ended") produced only an EMPTY D365
// conversation. The transcript now flows exclusively through the post-call
// analysis file that Contact Lens writes to S3 (see transcriptFromS3.ts), which
// creates one complete conversation per call. To avoid a duplicate empty
// conversation, this handler no longer opens a Direct Line conversation or starts
// the poller — it just acknowledges the flow invocation.

interface ConnectEvent {
  Details: {
    ContactData: {
      ContactId: string;
      InstanceARN: string;
      CustomerEndpoint?: { Address?: string };
      Attributes?: Record<string, string>;
    };
    Parameters?: Record<string, string>;
  };
}

export async function handler(event: ConnectEvent): Promise<{ ok: boolean }> {
  const cd = event.Details.ContactData;
  const params = event.Details.Parameters ?? {};
  const phase = (params.event ?? "started").toLowerCase();
  // Transcript delivery is handled post-call by transcriptFromS3.ts.
  console.log(
    `Lifecycle ${phase} for contact ${cd.ContactId} (no-op; transcript via S3 post-call analysis)`
  );
  return { ok: true };
}
