import React from 'react';
import {fade} from '@remotion/transitions/fade';
import {linearTiming, TransitionSeries} from '@remotion/transitions';
import {useVideoConfig} from 'remotion';
import {FADE} from './theme';
import {Title, TITLE_FRAMES} from './scenes/Title';
import {Install, INSTALL_FRAMES} from './scenes/Install';
import {Doctor, DOCTOR_FRAMES} from './scenes/Doctor';
import {Ask, ASK_FRAMES} from './scenes/Ask';
import {Delegate, DELEGATE_FRAMES} from './scenes/Delegate';
import {Run, RUN_FRAMES} from './scenes/Run';
import {FollowUp, FOLLOWUP_FRAMES} from './scenes/FollowUp';
import {Housekeeping, HOUSEKEEPING_FRAMES} from './scenes/Housekeeping';
import {Help, HELP_FRAMES} from './scenes/Help';
import {Outro, OUTRO_FRAMES} from './scenes/Outro';

export const SCENE_FRAMES = [TITLE_FRAMES, INSTALL_FRAMES, DOCTOR_FRAMES, ASK_FRAMES, DELEGATE_FRAMES, RUN_FRAMES, FOLLOWUP_FRAMES, HOUSEKEEPING_FRAMES, HELP_FRAMES, OUTRO_FRAMES];
export const DEMO_FRAMES = SCENE_FRAMES.reduce((a, b) => a + b, 0) - FADE * (SCENE_FRAMES.length - 1);

export const Demo: React.FC = () => {
  const {fps} = useVideoConfig();
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Title" durationInFrames={TITLE_FRAMES} premountFor={fps}><Title /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Install" durationInFrames={INSTALL_FRAMES} premountFor={fps}><Install /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Doctor" durationInFrames={DOCTOR_FRAMES} premountFor={fps}><Doctor /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Ask" durationInFrames={ASK_FRAMES} premountFor={fps}><Ask /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Delegate" durationInFrames={DELEGATE_FRAMES} premountFor={fps}><Delegate /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Run" durationInFrames={RUN_FRAMES} premountFor={fps}><Run /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="FollowUp" durationInFrames={FOLLOWUP_FRAMES} premountFor={fps}><FollowUp /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Housekeeping" durationInFrames={HOUSEKEEPING_FRAMES} premountFor={fps}><Housekeeping /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Help" durationInFrames={HELP_FRAMES} premountFor={fps}><Help /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Outro" durationInFrames={OUTRO_FRAMES} premountFor={fps}><Outro /></TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
