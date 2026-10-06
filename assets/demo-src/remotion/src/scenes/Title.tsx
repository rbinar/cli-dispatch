import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {colors, mono, sans} from '../theme';

export const TITLE_FRAMES = 105;

export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const a = (from: number) => interpolate(frame, [from, from + 18], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1)});
  return (
    <AbsoluteFill style={{background: colors.bg, justifyContent: 'center', padding: '0 140px'}}>
      <div style={{fontFamily: mono, fontSize: 34, letterSpacing: 6, color: colors.accent, textTransform: 'uppercase', opacity: a(0)}}>Claude Code plugin</div>
      <div style={{fontFamily: sans, fontWeight: 800, fontSize: 168, color: colors.text, letterSpacing: -4, opacity: a(6), translate: `0px ${(1 - a(6)) * 30}px`}}>cli-dispatch</div>
      <div style={{fontFamily: sans, fontSize: 54, color: colors.text, marginTop: 10, opacity: a(16)}}>
        Hand Claude Code&apos;s work to
        <br />
        <span style={{color: colors.accent}}>DeepSeek · Gemini · Codex · OpenCode · Copilot</span>
      </div>
      <div style={{fontFamily: sans, fontSize: 36, color: colors.dim, marginTop: 34, opacity: a(30)}}>
        Every output in this video was recorded in a clean Debian container.
      </div>
    </AbsoluteFill>
  );
};
