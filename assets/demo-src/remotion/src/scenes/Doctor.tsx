import React from 'react';
import {captures} from '../captures';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const DOCTOR_FRAMES = sceneDuration(captures.doctor, 60);

export const Doctor: React.FC = () => (
  <TerminalScene
    step="02 · Check"
    title="Doctor"
    subtitle="health per backend"
    steps={captures.doctor}
  />
);
