import React from 'react';
import {captures} from '../captures';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const RUN_FRAMES = sceneDuration(captures.run, 90);

export const Run: React.FC = () => (
  <TerminalScene
    step="05 · Run"
    title="Run directly"
    subtitle="worktree · verify · verdict · 0 LLM tokens"
    steps={captures.run}
  />
);
