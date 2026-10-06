import React from 'react';
import {fade} from '@remotion/transitions/fade';
import {linearTiming, TransitionSeries} from '@remotion/transitions';
import {useVideoConfig} from 'remotion';
import {Lang} from './strings';
import {FADE} from './theme';
import {Title, TITLE_FRAMES} from './scenes/Title';
import {Install, installFrames} from './scenes/Install';
import {Doctor, doctorFrames} from './scenes/Doctor';
import {Ask, askFrames} from './scenes/Ask';
import {Delegate, delegateFrames} from './scenes/Delegate';
import {Run, runFrames} from './scenes/Run';
import {FollowUp, followUpFrames} from './scenes/FollowUp';
import {Housekeeping, housekeepingFrames} from './scenes/Housekeeping';
import {Help, helpFrames} from './scenes/Help';
import {Outro, OUTRO_FRAMES} from './scenes/Outro';

const sceneFrames = (lang: Lang) => [
  TITLE_FRAMES, installFrames(lang), doctorFrames(lang), askFrames(lang), delegateFrames(lang),
  runFrames(lang), followUpFrames(lang), housekeepingFrames(lang), helpFrames(lang), OUTRO_FRAMES,
];
export const demoFrames = (lang: Lang) => {
  const f = sceneFrames(lang);
  return f.reduce((a, b) => a + b, 0) - FADE * (f.length - 1);
};

export const Demo: React.FC<{lang: Lang}> = ({lang}) => {
  const {fps} = useVideoConfig();
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Title" durationInFrames={TITLE_FRAMES} premountFor={fps}><Title lang={lang} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Install" durationInFrames={installFrames(lang)} premountFor={fps}><Install lang={lang} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Doctor" durationInFrames={doctorFrames(lang)} premountFor={fps}><Doctor lang={lang} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Ask" durationInFrames={askFrames(lang)} premountFor={fps}><Ask lang={lang} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Delegate" durationInFrames={delegateFrames(lang)} premountFor={fps}><Delegate lang={lang} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Run" durationInFrames={runFrames(lang)} premountFor={fps}><Run lang={lang} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="FollowUp" durationInFrames={followUpFrames(lang)} premountFor={fps}><FollowUp lang={lang} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Housekeeping" durationInFrames={housekeepingFrames(lang)} premountFor={fps}><Housekeeping lang={lang} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Help" durationInFrames={helpFrames(lang)} premountFor={fps}><Help lang={lang} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: FADE})} />
      <TransitionSeries.Sequence name="Outro" durationInFrames={OUTRO_FRAMES} premountFor={fps}><Outro lang={lang} /></TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
