// One terminal scene = commands typed one after another, each followed by its real output.
export type Step = {readonly cmd: string; readonly out: readonly string[]};

export const LEAD = 10; // frames before the first keystroke
export const CHARS_PER_FRAME = 3;
export const ENTER = 8; // pause between the last keystroke and the first output line
export const LINE = 3; // frames per output line
export const GAP = 14; // pause before the next command

export type Timed = Step & {typeAt: number; outAt: number; endAt: number};

export const layout = (steps: readonly Step[]): Timed[] => {
  let t = LEAD;
  return steps.map((s) => {
    const typeAt = t;
    const outAt = typeAt + Math.ceil(s.cmd.length / CHARS_PER_FRAME) + ENTER;
    const endAt = outAt + s.out.length * LINE;
    t = endAt + GAP;
    return {...s, typeAt, outAt, endAt};
  });
};

export const sceneDuration = (steps: readonly Step[], hold: number) => {
  const l = layout(steps);
  return l[l.length - 1].endAt + hold;
};
