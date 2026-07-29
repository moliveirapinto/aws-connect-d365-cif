# AWS Support Case — Amazon Connect CCP cannot be embedded despite Approved Origins

**Service:** Amazon Connect
**Category:** Agent experience / CCP embedding (amazon-connect-streams)
**Severity:** Production-impacting (blocking a customer integration)

---

## Subject
CCP (`ccp-v2`) returns `Content-Security-Policy: frame-ancestors 'self'` and cannot be iframe-embedded even though the embedding origin is configured under Approved Origins / Application Integration.

## Environment
- **Connect instance ID:** `1fc5d6d3-95c9-421a-b33e-ff1d47db4c49`
- **Instance alias:** `aws-d365-bridge-86405`
- **Account:** `139035987927`
- **Region:** `us-east-1`
- **CCP URL:** `https://aws-d365-bridge-86405.my.connect.aws/ccp-v2/`
- **Integration library:** `amazon-connect-streams` (`connect.core.initCCP`), `softphone.allowFramedSoftphone: true`

## What we're trying to do
Embed the CCP into a first-party web app (which is itself embedded in Dynamics 365) using `amazon-connect-streams`, so the agent can accept/answer calls in-context. Softphone audio requires the CCP iframe, so a true embed is required (a top-level pop-out is not acceptable for this use case).

## Approved Origins configured
We added the embedding origins via `aws connect associate-approved-origin`:
- `https://mango-plant-0482c030f.7.azurestaticapps.net`  (the app host)
- `https://orgcf0d9f1f.crm.dynamics.com`  (the D365 host)

`aws connect list-approved-origins --instance-id 1fc5d6d3-95c9-421a-b33e-ff1d47db4c49 --region us-east-1` confirms both origins are present.

## Observed behavior (the problem)
The CCP HTTP response **always** returns:

```
content-security-policy: ... frame-ancestors 'self'
```

Because of this, the browser blocks the CCP iframe with:

```
Refused to frame 'https://aws-d365-bridge-86405.my.connect.aws/' because an ancestor
violates the following Content Security Policy directive: "frame-ancestors 'self'".
net::ERR_BLOCKED_BY_RESPONSE
```

## Proof / troubleshooting already performed
1. `curl -sSI https://aws-d365-bridge-86405.my.connect.aws/ccp-v2/` → `frame-ancestors 'self'`.
2. Same request **with** matching `Referer` and `Origin` headers for the approved origin → still `frame-ancestors 'self'`.
3. Real browser, loading our app at the **top-level approved origin** (single hop, app → CCP) → blocked with the CSP error above, even though that origin is in Approved Origins.
4. Legacy domain `https://aws-d365-bridge-86405.awsapps.com/connect/ccp-v2/` → also `frame-ancestors 'self'`.
5. Cache-busted request (`?cb=<guid>`) to defeat CloudFront edge caching → still `frame-ancestors 'self'`.

The Approved Origins entries appear to govern only the Streams `postMessage`/login allowlist, and are **not** being reflected in the `frame-ancestors` CSP directive returned by the CCP.

## Questions for AWS
1. Per the amazon-connect-streams docs, Approved Origins (Application Integration) is the mechanism that permits embedding the CCP. Why is `frame-ancestors` on `ccp-v2` still `'self'` after both embedding origins are approved?
2. Is there a propagation delay or an additional instance-level setting required for approved origins to be reflected in the CCP `frame-ancestors` directive?
3. Is CCP iframe-embedding restricted/hardened on `*.my.connect.aws` instances, and if so, what is the supported path to embed the softphone CCP in a third-party web app?

## Desired outcome
`frame-ancestors` on the CCP response includes our approved origins so the CCP can be embedded via `amazon-connect-streams`, or a documented supported alternative to embed the softphone in a first-party page.
