/**
 * The back of the player card (the big card only, after a spin): the same shield and metal, the
 * corners as on the front, his name and his record as a list. Same viewBox as PlayerCard.
 */
import { useId } from 'react';
import { FONT, JERSEY, Pattern, VIEW_H, VIEW_W, hexPath, shieldPath, shirtInk, type CardStat } from './PlayerCard';
import { POSITION_NAMES, luma, metalInk, metalStops, mix, shirtOf, tierOf, type CardPosition, type CardStyle } from './style';

export interface CardBackProps {
  name: string;
  position?: CardPosition;
  /** Only when the front shows it. */
  score?: number;
  style: CardStyle;
  record: CardStat[];
  group?: string;
  size?: number;
}

export function CardBack({ name, position, score, style, record, group, size = 260 }: CardBackProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (s: string) => `${s}${uid}`;
  const shirt = shirtOf(style.shirt);
  const [c1, c2] = shirt.colors;
  const tier = tierOf(score);
  const hasScore = tier !== 'team';
  const stops = metalStops(tier, shirt);
  const ink = metalInk(tier, shirt);
  const light = stops[0];
  const deep = mix(c1, '#06070a', luma(c1) > 0.7 ? 0.9 : 0.8);
  const deeper = mix(c1, '#040406', 0.94);
  const shown = name.trim() || ' ';
  const nameSize = Math.min(28, Math.max(15, 220 / (Array.from(shown).length * 0.6)));
  const rows = record.slice(0, 5);
  const top = 196;
  const step = rows.length > 4 ? 30 : 36;
  const text = { fontFamily: FONT, textAnchor: 'middle' as const };
  const label = rows.map((r) => `${r.label} ${r.value}`).join(', ');

  return (
    <svg
      className="player-card card-back"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width={size}
      height={(size * VIEW_H) / VIEW_W}
      role="img"
      aria-label={`${name}: ${label}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={id('metal')} x1="0" y1="0" x2="1" y2="1">
          {stops.map((c, i) => (
            <stop key={i} offset={i / (stops.length - 1)} stopColor={c} />
          ))}
        </linearGradient>
        <linearGradient id={id('edge')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.15" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id={id('bg')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(c1, '#0b0c10', luma(c1) > 0.7 ? 0.8 : 0.6)} />
          <stop offset="0.5" stopColor={deep} />
          <stop offset="1" stopColor={deeper} />
        </linearGradient>
        <radialGradient id={id('glow')} cx="150" cy="120" r="170" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={stops[0]} stopOpacity="0.28" />
          <stop offset="1" stopColor={stops[1]} stopOpacity="0" />
        </radialGradient>
        <clipPath id={id('inner')}>
          <path d={shieldPath(9)} />
        </clipPath>
        <clipPath id={id('jersey')}>
          <path d={JERSEY} />
        </clipPath>
        <pattern id={id('net')} width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0,0 H18 M0,0 V18" stroke="#fff" strokeWidth="0.6" fill="none" />
        </pattern>
      </defs>

      <path d={shieldPath(0)} fill={`url(#${id('metal')})`} />
      <path d={shieldPath(0.6)} fill="none" stroke={`url(#${id('edge')})`} strokeWidth="1.2" />
      <path d={shieldPath(6.5)} fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="1.4" />

      <g clipPath={`url(#${id('inner')})`}>
        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${id('bg')})`} />
        <g opacity={luma(c1) > 0.7 ? 0.1 : 0.2}>
          <Pattern pattern={style.pattern} c2={c2} y={0} h={VIEW_H} />
        </g>
        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${id('net')})`} opacity="0.06" />
        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${id('glow')})`} />
        {rows.map((_, i) =>
          i ? <line key={i} x1="48" x2="252" y1={top + (i - 0.5) * step - 5} y2={top + (i - 0.5) * step - 5} stroke="#fff" strokeOpacity="0.12" /> : null,
        )}
        <path d="M150,398 l5,6 l-5,6 l-5,-6 Z" fill={`url(#${id('metal')})`} />
      </g>

      {/* Corners as on the front. */}
      {hasScore && (
        <g>
          <path d={hexPath(250, 58, 25)} fill={`url(#${id('metal')})`} stroke="#000" strokeOpacity="0.35" strokeWidth="1" />
          <path d={hexPath(250, 58, 21.5)} fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.8" />
          <text x="250" y="66" {...text} fontWeight="900" fontSize="27" fill={ink}>
            {Math.round(score!)}
          </text>
        </g>
      )}
      {position && (
        <g>
          <rect x="222" y={hasScore ? 92 : 46} width="56" height={hasScore ? 17 : 20} rx="8.5" fill="#000" fillOpacity="0.42" stroke={`url(#${id('metal')})`} strokeWidth="1" />
          <text x="250" y={hasScore ? 104 : 60} {...text} direction="rtl" fontWeight="700" fontSize={hasScore ? 10.5 : 12} fill="#fff">
            {POSITION_NAMES[position]}
          </text>
        </g>
      )}
      <g transform="translate(28,40)">
        <g clipPath={`url(#${id('jersey')})`}>
          <rect width="44" height="42" fill={c1} />
          <Pattern pattern={style.pattern} c2={c2} y={0} h={42} w={44} scale={0.3} />
        </g>
        <path d={JERSEY} fill="none" stroke={`url(#${id('metal')})`} strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      {style.number ? (
        <text
          x="50"
          y="70"
          {...text}
          fontWeight="900"
          fontSize="17"
          fill={shirtInk(shirt, style.pattern)}
          style={{ paintOrder: 'stroke', stroke: shirtInk(shirt, style.pattern) === '#ffffff' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.7)', strokeWidth: 2.2, strokeLinejoin: 'round' }}
        >
          {style.number}
        </text>
      ) : null}

      <text x="150" y="146" {...text} direction="rtl" fontWeight="800" fontSize={nameSize} fill="#fff">
        {shown}
      </text>
      <rect x="125" y="158" width="50" height="2" rx="1" fill={`url(#${id('metal')})`} />

      {/* The record: label on the start (right) side, the number on the end side. */}
      {rows.map((r, i) => (
        <g key={r.label}>
          <text x="246" y={top + i * step} fontFamily={FONT} direction="rtl" textAnchor="start" fontWeight="600" fontSize="15" fill="#fff" fillOpacity="0.78">
            {r.label}
          </text>
          <text x="54" y={top + i * step + 1} fontFamily={FONT} direction="ltr" textAnchor="start" fontWeight="800" fontSize="21" fill={light}>
            {r.value}
          </text>
        </g>
      ))}

      {group ? (
        <text x="150" y="366" {...text} direction="rtl" fontWeight="500" fontSize="11" fill="#fff" fillOpacity="0.5">
          {group}
        </text>
      ) : null}
    </svg>
  );
}
