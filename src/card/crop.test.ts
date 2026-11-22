import { describe, expect, it } from 'vitest';
import { clampFrame, extendBox, minFrame, panFrame, pictureBox, sameFrame, withZoom, zoomFrame, zoomOf, MAX_ZOOM } from './crop';

const pic = { w: 1000, h: 800 };
const base = { x: 300, y: 200, size: 400 };
const min = minFrame(base);

describe('photo position in the card', () => {
  it('keeps a margin around the automatic crop, inside the image', () => {
    expect(extendBox({ x: 300, y: 200, size: 400 }, 2000, 2000)).toEqual({ x: 60, y: 0, w: 880, h: 840 });
    expect(extendBox({ x: 0, y: 0, size: 100 }, 100, 100)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('drags: the photo follows the finger (the frame moves the other way), stops at the edges', () => {
    const f = panFrame(base, 0.1, -0.05, pic, min);
    expect(f).toEqual({ x: 260, y: 220, size: 400 });
    expect(panFrame(base, 5, 5, pic, min)).toEqual({ x: 0, y: 0, size: 400 });
    expect(panFrame(base, -5, -5, pic, min)).toEqual({ x: 600, y: 400, size: 400 });
  });

  it('zooms around a point, between the whole short side and MAX_ZOOM', () => {
    const c = zoomFrame(base, 2, pic, min);
    expect(c).toEqual({ x: 400, y: 300, size: 200 });
    expect(zoomOf(base, c)).toBe(2);
    // Around the top-left corner of the frame: that point stays put.
    expect(zoomFrame(base, 2, pic, min, 0, 0)).toEqual({ x: 300, y: 200, size: 200 });
    expect(zoomFrame(base, 100, pic, min).size).toBeCloseTo(400 / MAX_ZOOM);
    const out = zoomFrame(base, 0.01, pic, min);
    expect(out).toEqual({ x: 100, y: 0, size: 800 });
    expect(zoomFrame(base, 0, pic, min)).toBe(base);
  });

  it('the slider sets an absolute zoom keeping the centre', () => {
    const f = withZoom(base, base, 2, pic);
    expect(f).toEqual({ x: 400, y: 300, size: 200 });
    expect(sameFrame(withZoom(f, base, 1, pic), base)).toBe(true);
  });

  it('clamps any frame into the picture', () => {
    expect(clampFrame({ x: -50, y: 700, size: 2000 }, pic, min)).toEqual({ x: 200, y: 0, size: 800 });
    expect(clampFrame({ x: 10, y: 10, size: 1 }, { w: 50, h: 50 }, 200).size).toBe(50);
  });

  it('places the whole picture for the preview', () => {
    expect(pictureBox(base, pic)).toEqual({ x: -0.75, y: -0.5, w: 2.5, h: 2 });
  });
});
