import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {Lang, t} from '../strings';
import {colors, mono, sans} from '../theme';

export const OUTRO_FRAMES = 105;

export const Outro: React.FC<{lang: Lang}> = ({lang}) => {
  const frame = useCurrentFrame();
  const a = (from: number) => interpolate(frame, [from, from + 18], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1)});
  return (
    <AbsoluteFill lang={lang} style={{background: colors.bg, justifyContent: 'center', alignItems: 'center', textAlign: 'center'}}>
      <div style={{fontFamily: sans, fontWeight: 800, fontSize: 120, color: colors.text, letterSpacing: -3, opacity: a(0)}}>{t[lang].outroTitle}</div>
      <div style={{fontFamily: sans, fontSize: 52, color: colors.dim, marginTop: 18, opacity: a(10)}}>{t[lang].outroLine}</div>
      <div style={{fontFamily: mono, fontSize: 48, color: colors.accent, marginTop: 60, opacity: a(22)}}>github.com/rbinar/cli-dispatch</div>
    </AbsoluteFill>
  );
};
