import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {colors, mono} from './theme';
import {CHARS_PER_FRAME, layout, LINE, Step} from './timing';

// The web font has no box-drawing glyphs, so the browser falls back to a font with another
// advance width and help's frame and doctor's rules drift. Pin each one to a 0.6em cell.
const boxCells = (text: string) =>
  text.split(/([\u2500-\u257f])/).map((c, i) =>
    /[\u2500-\u257f]/.test(c) ? (
      <span key={i} style={{display: 'inline-block', width: '0.6em', overflow: 'hidden', verticalAlign: 'bottom'}}>{c}</span>
    ) : (
      c
    ),
  );

// Colours only what a terminal would: ticks, crosses, a passing verify.
const Line: React.FC<{text: string}> = ({text}) => {
  const parts = text.split(/(✓|✔|✗|verify: pass|# pass 1|# fail 0)/);
  return (
    <>
      {parts.map((p, i) => {
        const color = p === '✗' ? colors.red : ['✓', '✔', 'verify: pass', '# pass 1', '# fail 0'].includes(p) ? colors.green : undefined;
        return <span key={i} style={color ? {color, fontWeight: 700} : undefined}>{boxCells(p)}</span>;
      })}
    </>
  );
};

export const Terminal: React.FC<{steps: readonly Step[]; fontSize?: number; title?: string}> = ({steps, fontSize = 28, title = 'claude — ~/demo-app'}) => {
  const frame = useCurrentFrame();
  const timed = layout(steps);
  const lineHeight = 1.42;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: colors.panel,
        border: `2px solid ${colors.border}`,
        borderRadius: 18,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{height: 52, display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', borderBottom: `2px solid ${colors.border}`}}>
        {['#e5806f', '#e3b65e', '#8cc98f'].map((c) => (
          <div key={c} style={{width: 16, height: 16, borderRadius: 8, background: c, opacity: 0.85}} />
        ))}
        <div style={{flex: 1, textAlign: 'center', color: colors.dim, fontFamily: mono, fontSize: 20, marginRight: 76}}>{title}</div>
      </div>
      <div style={{padding: '26px 34px', fontFamily: mono, fontSize, lineHeight, color: colors.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word'}}>
        {timed.map((s, i) => {
          if (frame < s.typeAt) return null;
          const typed = s.cmd.slice(0, Math.floor((frame - s.typeAt) * CHARS_PER_FRAME));
          const typing = typed.length < s.cmd.length;
          const caret = typing || (frame < s.outAt && Math.floor(frame / 8) % 2 === 0);
          return (
            <div key={i} style={{marginTop: i === 0 ? 0 : fontSize * 0.6}}>
              <div style={{fontWeight: 700}}>
                <span style={{color: colors.accent}}>{'❯ '}</span>
                {typed}
                {caret ? <span style={{background: colors.accent, color: colors.accent}}>▌</span> : null}
              </div>
              {s.out.map((l, j) => {
                const at = s.outAt + j * LINE;
                if (frame < at) return null;
                return (
                  <div key={j} style={{color: colors.dim, opacity: interpolate(frame, [at, at + 4], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
                    <Line text={l || ' '} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
