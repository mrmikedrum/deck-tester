// A kind this client does not know: shown by its labels in the chooser and answered by number (step.ts warns once).
import type { UnknownDecision } from "../../protocol";
import { chooserKind } from "./chooser";
import { base } from "./kind";
import type { Kind } from "./kind";

export const unknown: Kind<UnknownDecision> = { ...base<UnknownDecision>(), ...chooserKind<UnknownDecision>() };
