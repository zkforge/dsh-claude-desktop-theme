/** Geometric reconstruction of the original click sequence, sampled at 20fps.
 * Recording antialiasing/compression fringes are not artwork: there is no outline
 * layer. All feet have a constant 3px width; their roots follow the belly while
 * their toes share a ground line. Only the projected feet have a deliberate bend.
 */
export type ClaudeFrame = readonly [body: string, shade: string, eyes: string, laptop: string];
export const CLAUDE_GROUND_Y = 23.5;

function box(x: number, y: number, width: number, height: number): string {
  return `M${x} ${y}h${width}v${height}h-${width}Z`;
}

const uprightToes = [6, 12, 20.5, 26.5] as const;
const projectedRoots = [3, 9, 17.5, 23.5] as const;
const projectedToes = [4.5, 10.5, 19, 25] as const;

function straightFeet(belly: number, toes: readonly number[] = uprightToes): string {
  return toes.map(x => box(x, belly, 3, CLAUDE_GROUND_Y - belly)).join('');
}

/** Equal-width roots and toes overlap at the knee; no tapered tips or slivers. */
function bentFoot(root: number, toe: number, belly: number): string {
  return box(root, belly, 3, 22 - belly) + box(toe, 20.5, 3, 3);
}

function projectedFeet(belly: number): string {
  return projectedRoots.map((root, i) => bentFoot(root, projectedToes[i]!, belly)).join('');
}

function eyes(left: number, right: number, y: number, height = 3): string {
  return box(left, y, 3, height) + box(right, y, 3, height);
}

function upright(top: number, belly: number, arms: string, face: string, laptop = '', shade = ''): ClaudeFrame {
  return [box(6, top, 23.5, belly - top) + arms + straightFeet(belly), shade, face, laptop];
}

/** The laptop uses a continuous pixel staircase, never a traced body fringe. */
function laptopSteps(y: number, x = -13, steps = 5, base = 8.5): string {
  return Array.from({ length: steps }, (_, i) => box(x + i * 1.5, y + i * 1.5, 3, 1.5)).join('')
    + (base > 0 ? box(x + (steps - 1) * 1.5, y + steps * 1.5, base, 1.5) : '');
}

const laptopOut = box(1.5, -4.5, 3, 3) + box(-1.5, -3, 6, 1.5)
  + box(-5.5, -1.5, 7, 1.5) + box(-5.5, 0, 4.5, 1.5) + box(-5.5, 1.5, 10, 1.5);
const laptopUp = box(-4, -10, 1.5, 8.5) + box(-4, -3, 8.5, 1.5);
const laptopSwing = box(-11.5, 4.5, 3, 1.5) + box(-13, 6, 6, 1.5)
  + box(-13, 7.5, 7.5, 1.5) + box(-11.5, 9, 6, 1.5)
  + box(-10, 10.5, 10, 1.5) + box(-7, 12, 9, 1.5);
const laptopFlat = box(-14.5, 17.5, 4.5, 1.5) + box(-11.5, 19, 4.5, 1.5)
  + box(-8.5, 20.5, 4.5, 1.5) + box(-7, 22, 8.5, 1.5);
const laptopFold = box(-6, 11, 3, 4.5) + box(-6, 14, 10.5, 1.5)
  + box(-4.5, 9.5, 3, 1.5) + box(-3, 8, 3, 1.5) + box(-1.5, 6.5, 3, 1.5);

const idleArms = box(0, 6, 6, 6) + box(29.5, 6, 5.5, 6);
const winkArms = box(1.5, 11.5, 4.5, 4.5) + box(3, 16, 3, 1.5) + box(29.5, 4.5, 5.5, 6);
const reachingArm = box(0, 3.5, 6, 4) + box(1.5, 7.5, 4.5, 1.5)
  + box(3, 9, 3, 1.5) + box(4.5, 10.5, 1.5, 1.5);
const swingingArm = box(3, 7.5, 3, 1.5) + box(1.5, 9, 4.5, 3) + box(0, 12, 6, 5.5);

export const CLAUDE_IDLE: ClaudeFrame = upright(0, 17.5, idleArms, eyes(9, 23.5, 3));

const turningBody = box(4.5, -1.5, 23.5, 19) + box(3, -5.5, 6, 4)
  + box(17.5, -5.5, 6, 4) + box(1.5, -3, 7.5, 6) + box(23.5, -3, 1.5, 1.5);
const turn: ClaudeFrame = [turningBody + straightFeet(17.5, [4.5, 10.5, 19, 25]),
  box(25, -1.5, 3, 19) + box(25, 17.5, 3, 6), eyes(6, 20.5, 4.5), laptopSteps(13)];

const slopeHand = box(1.5, 10.5, 1.5, 1.5) + box(0, 12, 3, 1.5)
  + box(-1.5, 13.5, 4.5, 1.5) + box(-3, 15, 6, 4.5);
const raisedHand = box(-1.5, 10.5, 4.5, 6) + box(1.5, 16.5, 1.5, 3)
  + box(-3, 18, 6, 1.5);
const pressedHand = box(-1.5, 10.5, 4.5, 9);
const loweredHand = raisedHand + box(-3, 19.5, 6, 4);
const raisedCrease = box(-3, 18, 6, 1.5);
const pressedCrease = box(-1.5, 10.5, 4.5, 1.5);

function typing(hand: string, crease = '', laptop = laptopSteps(14.5)): ClaudeFrame {
  return [box(3, 3, 23.5, 16.5) + hand + projectedFeet(19.5),
    box(20.5, 3, 6, 16.5) + bentFoot(23.5, 25, 19.5) + crease,
    eyes(3, 14.5, 7.5), laptop];
}

const lean: ClaudeFrame = [box(3, 1.5, 23.5, 16) + box(-3, 6, 6, 7.5)
  + box(1.5, 13.5, 1.5, 1.5) + box(-3, 15, 6, 2.5) + projectedFeet(17.5),
  box(20.5, 1.5, 6, 16) + bentFoot(23.5, 25, 17.5) + box(-3, 15, 6, 1.5),
  eyes(3, 14.5, 6, 4.5), laptopSteps(14.5)];

const foldingHand = box(0, 4.5, 4.5, 1.5) + box(-1.5, 6, 6, 7.5) + box(0, 13.5, 4.5, 4);
const foldingCrease = box(-1.5, 12, 6, 1.5);
const fold: ClaudeFrame = [box(4.5, 1.5, 23.5, 16) + foldingHand + projectedFeet(17.5),
  box(22, 1.5, 6, 16) + bentFoot(23.5, 25, 17.5) + foldingCrease,
  eyes(4.5, 16, 6, 4.5), laptopSteps(7.5, -11.5, 5, 0)];

const returnArms = box(-3, 11, 9, 3) + box(0, 9.5, 6, 1.5) + box(3, 8, 3, 1.5)
  + box(29.5, 7.5, 5.5, 6);
const returning = upright(0, 17.5, returnArms, eyes(6, 20.5, 4.5), laptopFold,
  box(26.5, 0, 3, 17.5) + box(26.5, 17.5, 3, 6) + box(29.5, 12, 5.5, 1.5));

/** Pose order and hold times follow the recording; identical clean silhouettes
 * are reused so compression noise cannot animate otherwise stationary edges. */
export const CLAUDE_FRAMES: readonly ClaudeFrame[] = [
  upright(1.5, 19, winkArms, box(9, 7.5, 3, 3) + box(22, 9, 4.5, 1.5)),
  upright(0, 17.5, reachingArm + box(29.5, 7.5, 5.5, 6), eyes(9, 23.5, 3), laptopOut),
  upright(0, 17.5, box(0, -1.5, 6, 6) + box(29.5, 7.5, 5.5, 6), eyes(9, 23.5, 3), laptopUp),
  upright(0, 17.5, swingingArm + box(29.5, 6, 5.5, 6), eyes(9, 23.5, 4.5), laptopSwing),
  upright(0, 17.5, box(0, 13.5, 6, 5.5) + box(29.5, 7.5, 5.5, 6), eyes(9, 23.5, 4.5), laptopSteps(14.5)),
  upright(0, 17.5, box(0, 6, 6, 6) + box(29.5, 4.5, 5.5, 6), eyes(9, 23.5, 4.5), laptopFlat),
  turn,
  lean,
  typing(slopeHand, '', laptopSteps(13)),
  typing(slopeHand, '', laptopSteps(13)),
  typing(raisedHand, raisedCrease),
  typing(pressedHand, pressedCrease),
  typing(slopeHand),
  typing(pressedHand, pressedCrease),
  typing(raisedHand, raisedCrease),
  typing(pressedHand, pressedCrease),
  typing(loweredHand, raisedCrease + box(-3, 19.5, 6, 4)),
  typing(loweredHand, raisedCrease + box(-3, 19.5, 6, 4)),
  fold,
  fold,
  returning,
  upright(1.5, 19, winkArms, eyes(9, 23.5, 7.5)),
  upright(1.5, 19, box(3, 11.5, 3, 6) + box(29.5, 4.5, 5.5, 6), eyes(9, 23.5, 7.5)),
  upright(0, 17.5, box(0, 7.5, 6, 6) + box(29.5, 7.5, 5.5, 6), eyes(9, 23.5, 3)),
  CLAUDE_IDLE,
];
export const CLAUDE_TRACK: readonly number[] = [0,0,0,1,1,2,2,2,3,3,4,5,5,6,6,7,8,9,10,10,11,12,12,10,10,11,12,12,10,11,11,12,12,10,10,13,13,13,14,14,15,13,13,16,16,17,18,19,20,20,21,21,21,22,22,23,24];
