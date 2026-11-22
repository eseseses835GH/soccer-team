import { describe, expect, it } from 'vitest';
import { MAX_TILT, atRest, dragAngle, faceAngle, lockAxis, settleTarget, sideOf, springStep, tiltFrom, velocityOf } from './tilt';

const rect = { left: 100, top: 50, width: 200, height: 280 };

describe('tilt', () => {
  it('leans toward the pointer: centre flat, edges at the max, clamped outside', () => {
    expect(tiltFrom(200, 190, rect)).toEqual({ rx: 0, ry: 0 });
    expect(tiltFrom(300, 190, rect)).toEqual({ rx: 0, ry: MAX_TILT });
    expect(tiltFrom(100, 50, rect)).toEqual({ rx: MAX_TILT, ry: -MAX_TILT });
    expect(tiltFrom(250, 330, rect)).toEqual({ rx: -MAX_TILT, ry: MAX_TILT / 2 });
    expect(tiltFrom(900, 900, rect)).toEqual({ rx: -MAX_TILT, ry: MAX_TILT });
  });

  it('picks the axis after the slop; ties scroll', () => {
    expect(lockAxis(3, 4)).toBeNull();
    expect(lockAxis(12, 3)).toBe('x');
    expect(lockAxis(-12, 3)).toBe('x');
    expect(lockAxis(3, -12)).toBe('y');
    expect(lockAxis(9, 9)).toBe('y');
  });

  it('a card width of drag is half a turn', () => {
    expect(dragAngle(0, 140, 280)).toBe(90);
    expect(dragAngle(180, -280, 280)).toBe(0);
  });
});

describe('spin settle', () => {
  it('slow: flips only past halfway, else back', () => {
    expect(settleTarget(0, 60, 0.1)).toBe(0);
    expect(settleTarget(0, -80, 0)).toBe(0);
    expect(settleTarget(0, 100, 0.1)).toBe(180);
    expect(settleTarget(0, -100, 0)).toBe(-180);
    expect(settleTarget(180, 280, 0.05)).toBe(360);
  });

  it('a flick flips even a short drag, in the flick direction', () => {
    expect(settleTarget(0, 30, 0.5)).toBe(180);
    expect(settleTarget(0, 30, -0.5)).toBe(-180);
    expect(settleTarget(180, 150, -0.6)).toBe(0);
  });

  it('a fast flick adds one whole turn and still lands on the other side', () => {
    expect(settleTarget(0, 60, 2)).toBe(540);
    expect(settleTarget(0, -60, -4)).toBe(-540);
    expect(sideOf(settleTarget(0, 60, 2))).toBe('back');
    expect(sideOf(settleTarget(180, 200, 3))).toBe('front');
  });

  it('sides and face angles', () => {
    expect(sideOf(0)).toBe('front');
    expect(sideOf(180)).toBe('back');
    expect(sideOf(-180)).toBe('back');
    expect(sideOf(720)).toBe('front');
    expect(faceAngle(30, 'front')).toBe(30);
    expect(faceAngle(390, 'front')).toBe(30);
    expect(faceAngle(200, 'back')).toBe(20);
    expect(faceAngle(-170, 'back')).toBe(10);
    expect(faceAngle(180, 'front')).toBe(180);
  });

  it('release speed over the last ~80ms, clamped', () => {
    expect(velocityOf([{ t: 0, a: 0 }, { t: 50, a: 20 }, { t: 100, a: 60 }], 100)).toBeCloseTo(0.8);
    expect(velocityOf([{ t: 0, a: 0 }], 0)).toBe(0);
    expect(velocityOf([{ t: 0, a: 0 }, { t: 1, a: 300 }], 1)).toBe(4);
    expect(velocityOf([{ t: 0, a: 0 }, { t: 10, a: 40 }], 500)).toBe(0);
  });

  it('the spring settles on the target, bouncing a little', () => {
    let s = { x: 100, v: 600 };
    let max = s.x;
    let frames = 0;
    while (!atRest(s, 180) && frames < 600) {
      s = springStep(s, 180, 1 / 60);
      max = Math.max(max, s.x);
      frames++;
    }
    expect(frames).toBeLessThan(120);
    expect(s.x).toBeCloseTo(180, 1);
    expect(max).toBeGreaterThan(180);
    expect(max).toBeLessThan(200);
  });

  it('a long frame does not blow the spring up', () => {
    const s = springStep({ x: 0, v: 0 }, 540, 2);
    expect(Math.abs(s.x)).toBeLessThan(540);
  });
});
