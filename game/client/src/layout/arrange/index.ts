// The arrangement engine (docs/game-arrangement-engine.md): one container's cards in, where they go out, with the rules
// (the policy) swappable without touching the rest. The first slice plans the across leaf in the shadow of `mat`.
export * from "./contract";
export { arrange } from "./solver";
export { arrCard, arrCardOf, typesOf } from "./card";
export { momentKey, momentOf, stanceOf, REST, NO_DECISION } from "./moment";
export type { Moment, DecisionFacts } from "./moment";
export { S_TABLE, SLOT, tableScale } from "./scale";
export { leafContainer, leafFrame, PARTED, FRONT_Z } from "./leaf";
export { readyTapped } from "./policies/ready-tapped";
export { works } from "./policies/works";
export { POLICIES, policyFor, creatureShare } from "./policies/select";
export { validateIntent } from "./validate";
export { clearArrangeCaches } from "./memo";
