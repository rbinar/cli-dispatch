import React from 'react';
import {captures} from '../captures';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const FOLLOWUP_FRAMES = sceneDuration(captures.sessions, 75);

export const FollowUp: React.FC = () => (
  <TerminalScene
    step="06 · Follow up"
    title="Sessions & resume"
    subtitle="every worker run is resumable"
    steps={captures.sessions}
  />
);
