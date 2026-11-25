// The app's own identities. Stops, stamps, commits and answer tokens are shared with play and the transport and live
// in protocol (`protocol/client.ts`); what is left here names the app's timers.

/** Every timer is data, named by the module that owns it: `play/autopass:<stop>`, `app/notice:3`, `moments/m2`. */
export type DeadlineId = `${"app" | "play" | "narrative" | "moments"}/${string}`;

export const isDeadlineId = (id: string): id is DeadlineId => /^(app|play|narrative|moments)\//.test(id);
