// mode: which mode of a modal spell or ability, from the chooser (live.js `status`'s generic branch).
import type { ModeDecision } from "../../protocol";
import { chooserKind } from "./chooser";
import { base } from "./kind";
import type { Kind } from "./kind";

export const mode: Kind<ModeDecision> = { ...base<ModeDecision>(), ...chooserKind<ModeDecision>(), prefetch: false };
