// A value between min and max (live.js `chooser`'s stepper for `number`): it starts at min and steps stay in range.
export const clampStep = (value: number, by: number, min: number, max: number): number => Math.max(min, Math.min(max, value + by));
