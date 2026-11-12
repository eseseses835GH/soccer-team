import { useId } from 'react';

/** Hand-drawn art (inline SVG, themed by CSS variables). Motion lives in styles.css under "art". */

/** The ball's panels, centred on 0,0 (r = 13): a dark centre pentagon, seams, and the next ring of pentagons cut by the rim. */
function BallShape() {
  const clip = useId();
  return (
    <>
      <clipPath id={clip}>
        <circle r="13" />
      </clipPath>
      <circle r="13" className="ball-fill" />
      <g clipPath={`url(#${clip})`}>
        <path d="M0-5.2L4.95-1.61L3.06 4.21H-3.06L-4.95-1.61Z" className="ball-ink" />
        {[0, 72, 144, 216, 288].map((a) => (
          <g key={a} transform={`rotate(${a})`}>
            <path d="M0-5.2V-8.1" className="ball-line" />
            <path d="M0-8.1L-4.18-11.14L-2.59-16.06H2.59L4.18-11.14Z" className="ball-ink" />
          </g>
        ))}
      </g>
      <circle r="13" className="ball-line" />
    </>
  );
}

/** Small ball for the brand mark in the top bar. */
export function BallMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-15 -15 30 30" aria-hidden="true" focusable="false" className="ball-mark">
      <BallShape />
    </svg>
  );
}

/** A leg kicks the ball; it flies, bounces and rolls back to the foot (looping; still under reduced motion). */
export function KickArt() {
  return (
    <svg className="kick-art" viewBox="0 0 200 140" aria-hidden="true" focusable="false">
      <path d="M14 128H186" className="art-ground" />
      <g transform="translate(100 129)">
        <g className="kick-x">
          <ellipse rx="15" ry="2.8" className="kick-shadow" />
        </g>
      </g>
      <g className="kick-leg">
        <rect x="137" y="2" width="26" height="30" rx="7" className="art-shorts" />
        <rect x="142" y="28" width="16" height="80" rx="8" className="art-sock" />
        <path d="M143 80H157M143 87H157" className="art-accent-line" />
        <path d="M157 102L160 120Q160 124 156 124H126Q118 124 117 118Q117 112 124 110L142 104Z" className="art-boot" />
        <path d="M128 124v3.5M140 124v3.5M152 124v3.5" className="art-studs" />
      </g>
      <g transform="translate(112 100)" className="kick-pop">
        <path d="M-2-6l-2-7M4-4l5-6M8 2h7" className="art-accent-line" />
      </g>
      <g transform="translate(100 112.4)">
        <g className="kick-x">
          <g className="kick-y">
            <g className="kick-spin">
              <g transform="scale(1.2)">
                <BallShape />
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
