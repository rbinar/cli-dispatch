import React from 'react';
import {CalculateMetadataFunction, Composition, Folder} from 'remotion';
import {Demo, demoFrames} from './Demo';
import {Lang} from './strings';
import {FPS} from './theme';
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

type Props = {lang: Lang};
// Scene lengths follow the captured output, which differs per language.
const byLang = (frames: (lang: Lang) => number): CalculateMetadataFunction<Props> => ({props}) => ({durationInFrames: frames(props.lang)});

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Demo" component={Demo} durationInFrames={demoFrames('en')} fps={FPS} width={1920} height={1080} defaultProps={{lang: 'en' as Lang}} calculateMetadata={byLang(demoFrames)} />
    <Composition id="DemoTr" component={Demo} durationInFrames={demoFrames('tr')} fps={FPS} width={1920} height={1080} defaultProps={{lang: 'tr' as Lang}} calculateMetadata={byLang(demoFrames)} />
    <Folder name="Scenes">
      <Composition id="Title" component={Title} durationInFrames={TITLE_FRAMES} fps={FPS} width={1920} height={1080} defaultProps={{lang: 'en' as Lang}} />
      <Composition id="Install" component={Install} durationInFrames={installFrames('en')} fps={FPS} width={1920} height={1080} defaultProps={{lang: 'en' as Lang}} calculateMetadata={byLang(installFrames)} />
      <Composition id="Doctor" component={Doctor} durationInFrames={doctorFrames('en')} fps={FPS} width={1920} height={1080} defaultProps={{lang: 'en' as Lang}} calculateMetadata={byLang(doctorFrames)} />
      <Composition id="Ask" component={Ask} durationInFrames={askFrames('en')} fps={FPS} width={1920} height={1080} defaultProps={{lang: 'en' as Lang}} calculateMetadata={byLang(askFrames)} />
      <Composition id="Delegate" component={Delegate} durationInFrames={delegateFrames('en')} fps={FPS} width={1920} height={1080} defaultProps={{lang: 'en' as Lang}} calculateMetadata={byLang(delegateFrames)} />
      <Composition id="Run" component={Run} durationInFrames={runFrames('en')} fps={FPS} width={1920} height={1080} defaultProps={{lang: 'en' as Lang}} calculateMetadata={byLang(runFrames)} />
      <Composition id="FollowUp" component={FollowUp} durationInFrames={followUpFrames('en')} fps={FPS} width={1920} height={1080} defaultProps={{lang: 'en' as Lang}} calculateMetadata={byLang(followUpFrames)} />
      <Composition id="Housekeeping" component={Housekeeping} durationInFrames={housekeepingFrames('en')} fps={FPS} width={1920} height={1080} defaultProps={{lang: 'en' as Lang}} calculateMetadata={byLang(housekeepingFrames)} />
      <Composition id="Help" component={Help} durationInFrames={helpFrames('en')} fps={FPS} width={1920} height={1080} defaultProps={{lang: 'en' as Lang}} calculateMetadata={byLang(helpFrames)} />
      <Composition id="Outro" component={Outro} durationInFrames={OUTRO_FRAMES} fps={FPS} width={1920} height={1080} defaultProps={{lang: 'en' as Lang}} />
    </Folder>
  </>
);
