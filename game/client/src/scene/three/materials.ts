// The signal a card's rim burns with: its colours, shared by every card and breathing together, and the clock its
// flicker reads. (The card's material, which draws it, is the deck's: cards.ts.) Parameters live in theme.
import { Color } from "three";
import { materials, motion, signal } from "../../theme";

const { rim: rimParams } = materials;

export type Signal = "option" | "selected" | "danger" | "lit";

/** The rim colours and clock every face material shares: set once a frame, read by every lit card. */
export class Rim {
  /** Seconds, for the rim's flicker. */
  readonly time = { value: 0 };
  readonly colours: Readonly<Record<Signal, Color>> = {
    option: new Color(signal.option),
    selected: new Color(signal.giltRim),
    danger: new Color(signal.dangerRim),
    lit: new Color(signal.lit).multiplyScalar(rimParams.litGain),
  };

  /**
   * Breathe: the option ring pulses, danger beats (a heartbeat, plain at arm's length, never past full: blood, not light).
   * `still` (reduced motion): neither moves; each holds at its strongest.
   */
  update(nowMs: number, still = false): void {
    this.time.value = still ? 0 : nowMs / 1000;
    const o = rimParams.optionBreath,
      d = rimParams.dangerBeat;
    this.colours.option.set(signal.option).multiplyScalar(o.base + o.swing * (still ? 1 : Math.sin(nowMs / motion.optionPeriod)));
    this.colours.danger
      .set(signal.dangerRim)
      .multiplyScalar(d.base + d.swing * (still ? 1 : Math.pow(Math.max(0, Math.sin(nowMs / motion.dangerPeriod)), 4)));
  }
}
