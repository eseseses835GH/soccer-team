/**
 * The collectible player card: a shield of metal (gold / silver / bronze by score, the shirt colour
 * without one), the player standing in front of his shirt's pattern, name on a collar band.
 * One SVG (viewBox 300×420), crisp at any size; `renderCardPng` reuses it.
 */
import { useId } from 'react';
import { POSITION_NAMES, luma, metalInk, metalStops, mix, shirtOf, tierOf, type CardPosition, type CardStyle, type Shirt, type ShirtPattern } from './style';

export interface CardStat {
  label: string;
  value: string | number;
}

export interface PlayerCardProps {
  name: string;
  /** Background-free picture (preferred). */
  cutout?: string | null;
  /** Square picture with its background (used when there's no cutout). */
  portrait?: string | null;
  position?: CardPosition;
  /** 70–99; optional. */
  score?: number;
  stats?: CardStat[];
  style: CardStyle;
  /** Width in px (height is 1.4×). */
  size?: number;
  className?: string;
  /** Leave the text out (the PNG renderer draws it with the page's fonts). */
  textless?: boolean;
  /** Where the picture lies, in shares of its square slot (moving the photo in the maker); default the slot. */
  imageBox?: { x: number; y: number; w: number; h: number };
}

/** The `<image>` placement for a slot, honouring `imageBox`. */
function placed(slot: { x: number; y: number; s: number }, b?: PlayerCardProps['imageBox']) {
  if (!b) return { x: slot.x, y: slot.y, width: slot.s, height: slot.s, preserveAspectRatio: 'xMidYMid slice' };
  return { x: slot.x + b.x * slot.s, y: slot.y + b.y * slot.s, width: b.w * slot.s, height: b.h * slot.s, preserveAspectRatio: 'none' };
}

export const VIEW_W = 300;
export const VIEW_H = 420;
export const FONT = "Heebo, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";

/** The shield, `i` px inside the outer edge. */
export function shieldPath(i: number): string {
  const c = 22 - i * 0.4; // top chamfer
  const y1 = 345;
  const r = VIEW_W - i;
  return [
    `M${i + c},${i}`,
    `H${r - c}`,
    `L${r},${i + c}`,
    `V${y1}`,
    `C${r},${y1 + 30} ${218},${412 - i * 0.6} 150,${VIEW_H - i}`,
    `C${82},${412 - i * 0.6} ${i},${y1 + 30} ${i},${y1}`,
    `V${i + c}`,
    'Z',
  ].join(' ');
}

export interface CardText {
  text: string;
  x: number;
  y: number;
  size: number;
  weight: number;
  fill: string;
  opacity?: number;
  /** Letter spacing, px. */
  spacing?: number;
  shadow?: boolean;
  /** A thin outline (legible on a two-coloured shirt). */
  outline?: string;
}

const firstStops = (p: PlayerCardProps) => metalStops(tierOf(p.score), shirtOf(p.style.shirt));

/** Every text on the card, in viewBox units (shared by the SVG and the PNG renderer). */
export function cardTexts(p: PlayerCardProps): CardText[] {
  const shirt = shirtOf(p.style.shirt);
  const tier = tierOf(p.score);
  const ink = metalInk(tier, shirt);
  const light = firstStops(p)[0];
  const out: CardText[] = [];
  const name = p.name.trim() || ' ';
  const nameSize = Math.min(30, Math.max(15, 220 / (Array.from(name).length * 0.6)));
  out.push({ text: name, x: 150, y: 342, size: nameSize, weight: 800, fill: '#ffffff', shadow: true });
  const hasScore = typeof p.score === 'number' && Number.isFinite(p.score);
  if (hasScore) out.push({ text: String(Math.round(p.score!)), x: 250, y: 66, size: 27, weight: 900, fill: ink });
  if (p.position) out.push({ text: POSITION_NAMES[p.position], x: 250, y: hasScore ? 104 : 60, size: hasScore ? 10.5 : 12, weight: 700, fill: '#ffffff', spacing: 0.3 });
  if (p.style.number) {
    const fill = shirtInk(shirt, p.style.pattern);
    out.push({ text: String(p.style.number), x: 50, y: 70, size: 17, weight: 900, fill, outline: fill === '#ffffff' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.7)' });
  }
  const stats = (p.stats ?? []).slice(0, 3);
  const xs = stats.length === 1 ? [150] : stats.length === 2 ? [124, 176] : [108, 150, 192];
  stats.forEach((s, i) => {
    out.push({ text: String(s.value), x: xs[i], y: 368, size: 15, weight: 800, fill: light });
    out.push({ text: s.label, x: xs[i], y: 381, size: 8.5, weight: 500, fill: '#ffffff', opacity: 0.72 });
  });
  return out;
}

/** Ink for the number on the little shirt. */
function shirtInk(shirt: Shirt, pattern: ShirtPattern): string {
  const base = pattern === 'plain' ? shirt.colors[0] : mix(shirt.colors[0], shirt.colors[1], 0.5);
  return luma(base) > 0.62 ? '#15161a' : '#ffffff';
}

export function PlayerCard(props: PlayerCardProps) {
  const { name, cutout, portrait, style, size = 260, className, textless } = props;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (s: string) => `${s}${uid}`;
  const shirt = shirtOf(style.shirt);
  const [c1, c2] = shirt.colors;
  const stops = firstStops(props);
  const tier = tierOf(props.score);
  const hasScore = tier !== 'team';
  const deep = mix(c1, '#06070a', luma(c1) > 0.7 ? 0.88 : 0.74);
  const deeper = mix(c1, '#040406', 0.92);
  const img = cutout || portrait || null;
  const texts = textless ? [] : cardTexts(props);

  return (
    <svg
      className={`player-card ${className ?? ''}`}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width={size}
      height={(size * VIEW_H) / VIEW_W}
      role="img"
      aria-label={name}
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
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
          <stop offset="0" stopColor={mix(c1, '#0b0c10', luma(c1) > 0.7 ? 0.75 : 0.45)} />
          <stop offset="0.55" stopColor={deep} />
          <stop offset="1" stopColor={deeper} />
        </linearGradient>
        <linearGradient id={id('shade')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="0.55" stopColor="#000" stopOpacity="0.1" />
          <stop offset="1" stopColor="#000" stopOpacity="0.75" />
        </linearGradient>
        <radialGradient id={id('glow')} cx="150" cy="150" r="150" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={stops[0]} stopOpacity="0.55" />
          <stop offset="0.45" stopColor={stops[1]} stopOpacity="0.16" />
          <stop offset="1" stopColor={stops[1]} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('sheen')} x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0.3" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.44" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="0.56" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id('fade')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.78" stopColor="#fff" />
          <stop offset="0.97" stopColor="#000" />
        </linearGradient>
        <mask id={id('imgmask')} maskUnits="userSpaceOnUse" x="0" y="0" width={VIEW_W} height={VIEW_H}>
          <rect x="20" y="30" width="260" height="260" fill={`url(#${id('fade')})`} />
        </mask>
        <clipPath id={id('inner')}>
          <path d={shieldPath(9)} />
        </clipPath>
        <clipPath id={id('outer')}>
          <path d={shieldPath(0)} />
        </clipPath>
        <clipPath id={id('collar')}>
          <path d="M0,282 L150,300 L300,282 V300 L150,318 L0,300 Z" />
        </clipPath>
        <clipPath id={id('medal')}>
          <circle cx="150" cy="158" r="98" />
        </clipPath>
        <clipPath id={id('jersey')}>
          <path d={JERSEY} />
        </clipPath>
        <pattern id={id('net')} width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0,0 H18 M0,0 V18" stroke="#fff" strokeWidth="0.6" fill="none" />
        </pattern>
      </defs>

      {/* Metal frame. */}
      <path d={shieldPath(0)} fill={`url(#${id('metal')})`} />
      <path d={shieldPath(0.6)} fill="none" stroke={`url(#${id('edge')})`} strokeWidth="1.2" />
      <path d={shieldPath(6.5)} fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="1.4" />

      {/* Inner panel: the shirt's colours, a net, light behind the player. */}
      <g clipPath={`url(#${id('inner')})`}>
        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${id('bg')})`} />
        <g opacity={luma(c1) > 0.7 ? 0.2 : 0.42}>
          <Pattern pattern={style.pattern} c1={c1} c2={c2} y={0} h={VIEW_H} />
        </g>
        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${id('net')})`} opacity="0.07" />
        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${id('glow')})`} />
        {style.number ? (
          <text
            x="150"
            y="232"
            textAnchor="middle"
            fontFamily={FONT}
            fontWeight="900"
            fontSize="200"
            fill="none"
            stroke={stops[1]}
            strokeOpacity="0.28"
            strokeWidth="2"
            aria-hidden="true"
          >
            {style.number}
          </text>
        ) : null}
        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${id('shade')})`} />

        {img && cutout ? (
          <image href={img} {...placed({ x: 20, y: 30, s: 260 }, props.imageBox)} mask={`url(#${id('imgmask')})`} />
        ) : img ? (
          <g>
            <circle cx="150" cy="158" r="103" fill={`url(#${id('metal')})`} />
            <image href={img} {...placed({ x: 52, y: 60, s: 196 }, props.imageBox)} clipPath={`url(#${id('medal')})`} />
          </g>
        ) : (
          <path d={SILHOUETTE} fill="#fff" opacity="0.14" />
        )}

        {/* Collar band in the shirt's real colours. */}
        <g clipPath={`url(#${id('collar')})`}>
          <rect y="282" width={VIEW_W} height="36" fill={c1} />
          <Pattern pattern={style.pattern} c1={c1} c2={c2} y={282} h={36} />
        </g>
        <path d="M0,282 L150,300 L300,282" fill="none" stroke={`url(#${id('metal')})`} strokeWidth="1.6" />
        <path d="M0,300 L150,318 L300,300" fill="none" stroke={`url(#${id('metal')})`} strokeWidth="1.6" />

        {/* Stats row divider and the tip ornament. */}
        {(props.stats?.length ?? 0) > 1 &&
          (props.stats!.length === 2 ? [150] : [129, 171]).map((x) => <line key={x} x1={x} x2={x} y1="357" y2="384" stroke="#fff" strokeOpacity="0.2" />)}
        <path d="M150,398 l5,6 l-5,6 l-5,-6 Z" fill={`url(#${id('metal')})`} />
      </g>

      {/* Top corners: score medal + position (start side), the little shirt with the number. */}
      {hasScore && (
        <g>
          <path d={hexPath(250, 58, 25)} fill={`url(#${id('metal')})`} stroke="#000" strokeOpacity="0.35" strokeWidth="1" />
          <path d={hexPath(250, 58, 21.5)} fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.8" />
        </g>
      )}
      {props.position && <rect x="222" y={hasScore ? 92 : 46} width="56" height={hasScore ? 17 : 20} rx="8.5" fill="#000" fillOpacity="0.42" stroke={`url(#${id('metal')})`} strokeWidth="1" />}
      <g transform="translate(28,40)">
        <g clipPath={`url(#${id('jersey')})`}>
          <rect width="44" height="42" fill={c1} />
          <Pattern pattern={style.pattern} c1={c1} c2={c2} y={0} h={42} w={44} scale={0.3} />
        </g>
        <path d={JERSEY} fill="none" stroke={`url(#${id('metal')})`} strokeWidth="1.5" strokeLinejoin="round" />
      </g>

      <path d={shieldPath(0)} fill={`url(#${id('sheen')})`} />

      {texts.map((t, i) => (
        <text
          key={i}
          x={t.x}
          y={t.y}
          textAnchor="middle"
          direction="rtl"
          fontFamily={FONT}
          fontWeight={t.weight}
          fontSize={t.size}
          fill={t.fill}
          fillOpacity={t.opacity}
          letterSpacing={t.spacing}
          style={t.shadow || t.outline ? { paintOrder: 'stroke', stroke: t.outline ?? 'rgba(0,0,0,0.45)', strokeWidth: t.outline ? 2.2 : 3, strokeLinejoin: 'round' } : undefined}
        >
          {t.text}
        </text>
      ))}
    </svg>
  );
}

/** A small shirt (44×42) for the number. */
const JERSEY = 'M14,1 L4,6 L0,17 L8,20 L9,41 L35,41 L36,20 L44,17 L40,6 L30,1 Q22,8 14,1 Z';

const SILHOUETTE = 'M150,92 a42,46 0 1 1 -0.1,0 Z M60,290 C64,232 98,206 150,206 C202,206 236,232 240,290 Z';

function hexPath(cx: number, cy: number, r: number): string {
  const pts = Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${pts.join(' L')} Z`;
}

/** The shirt pattern drawn in c2 over c1 (the caller paints c1 or a tint underneath). */
function Pattern({ pattern, c2, y, h, w = VIEW_W, scale = 1 }: { pattern: ShirtPattern; c1?: string; c2: string; y: number; h: number; w?: number; scale?: number }) {
  switch (pattern) {
    case 'stripes': {
      const sw = 30 * scale;
      const n = Math.ceil(w / (sw * 2)) + 1;
      const x0 = w / 2 - sw / 2 - Math.ceil(n / 2) * sw * 2;
      return (
        <g>
          {Array.from({ length: n + 1 }, (_, k) => (
            <rect key={k} x={x0 + k * sw * 2} y={y} width={sw} height={h} fill={c2} />
          ))}
        </g>
      );
    }
    case 'halves':
      return <rect x={0} y={y} width={w / 2} height={h} fill={c2} />;
    case 'sash': {
      const s = 34 * scale;
      // From the top right to the bottom left (over the left shoulder, as worn).
      return <path d={`M${w - s},${y} L${w + s},${y} L${s},${y + h} L${-s},${y + h} Z`} fill={c2} />;
    }
    default:
      return null;
  }
}
