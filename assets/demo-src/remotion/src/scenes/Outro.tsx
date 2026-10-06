import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {colors, mono, sans} from '../theme';

export const OUTRO_FRAMES = 105;

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const a = (from: number) => interpolate(frame, [from, from + 18], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1)});
  return (
    <AbsoluteFill style={{background: colors.bg, justifyContent: 'center', alignItems: 'center', textAlign: 'center'}}>
      <div style={{fontFamily: sans, fontWeight: 800, fontSize: 120, color: colors.text, letterSpacing: -3, opacity: a(0)}}>12 commands. 5 workers.</div>
      <div style={{fontFamily: sans, fontSize: 52, color: colors.dim, marginTop: 18, opacity: a(10)}}>Claude Code reviews. The workers do the work.</div>
      <div style={{fontFamily: mono, fontSize: 48, color: colors.accent, marginTop: 60, opacity: a(22)}}>github.com/rbinar/cli-dispatch</div>
    </AbsoluteFill>
  );
};
