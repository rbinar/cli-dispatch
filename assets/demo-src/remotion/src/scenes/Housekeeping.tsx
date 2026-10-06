import React from 'react';
import {captures} from '../captures';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const HOUSEKEEPING_FRAMES = sceneDuration(captures.gain, 75);

export const Housekeeping: React.FC = () => (
  <TerminalScene
    step="07 · Measure"
    title="Gain & clean"
    subtitle="token totals, stale-session cleanup"
    steps={captures.gain} fontSize={26}
  />
);
