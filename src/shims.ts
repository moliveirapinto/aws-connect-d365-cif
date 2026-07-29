// amazon-connect-streams assigns several telemetry helpers as *implicit globals*
// (e.g. `publishTelemetryEvent = function () {}` with no `var`). When the library
// is bundled into an ES module it runs in strict mode, where assigning to an
// undeclared name throws `ReferenceError: publishTelemetryEvent is not defined`,
// which aborts CCP initialization and leaves the page blank.
//
// Pre-seeding the name as an existing property on the global object turns those
// bare assignments into legal writes to an existing binding. This module MUST be
// imported before amazon-connect-streams evaluates (i.e. first in main.tsx).
const g = window as unknown as Record<string, unknown>;
if (typeof g.publishTelemetryEvent === "undefined") {
  g.publishTelemetryEvent = function () {
    /* no-op until amazon-connect-streams installs the real implementation */
  };
}

export {};
