import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {Terminal} from './Terminal';
import {colors, mono, sans} from './theme';
import {Step} from './timing';

// A numbered caption above a terminal replaying real captured output.
export const TerminalScene: React.FC<{
  step: string;
  title: string;
  subtitle: string;
  steps: readonly Step[];
  fontSize?: number;
}> = ({step, title, subtitle, steps, fontSize}) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1)});
  return (
    <AbsoluteFill style={{background: colors.bg, padding: '70px 90px 80px', display: 'flex', flexDirection: 'column', gap: 34}}>
      <div style={{opacity: enter, translate: `0px ${(1 - enter) * 20}px`}}>
        <div style={{fontFamily: mono, fontSize: 30, letterSpacing: 4, color: colors.accent, textTransform: 'uppercase'}}>{step}</div>
        <div style={{display: 'flex', alignItems: 'baseline', gap: 28, marginTop: 6}}>
          <div style={{fontFamily: sans, fontWeight: 800, fontSize: 84, color: colors.text, letterSpacing: -1.5}}>{title}</div>
          <div style={{fontFamily: sans, fontSize: 40, color: colors.dim}}>{subtitle}</div>
        </div>
      </div>
      <div style={{flex: 1, minHeight: 0}}>
        <Terminal steps={steps} fontSize={fontSize} />
      </div>
    </AbsoluteFill>
  );
};
