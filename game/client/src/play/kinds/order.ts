// order: put every option in order, from the chooser; picks are numbered in the order tapped and sent in that order.
import type { OrderDecision } from "../../protocol";
import { chooserKind } from "./chooser";
import { base } from "./kind";
import type { Kind } from "./kind";

export const order: Kind<OrderDecision> = { ...base<OrderDecision>(), ...chooserKind<OrderDecision>() };
