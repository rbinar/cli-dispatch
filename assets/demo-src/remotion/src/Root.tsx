import React from 'react';
import {Composition, Folder} from 'remotion';
import {Demo, DEMO_FRAMES} from './Demo';
import {FPS} from './theme';
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

export const RemotionRoot: React.FC = () => (
  <>
    <Folder name="Scenes">
      <Composition id="Title" component={Title} durationInFrames={TITLE_FRAMES} fps={FPS} width={1920} height={1080} />
      <Composition id="Install" component={Install} durationInFrames={INSTALL_FRAMES} fps={FPS} width={1920} height={1080} />
      <Composition id="Doctor" component={Doctor} durationInFrames={DOCTOR_FRAMES} fps={FPS} width={1920} height={1080} />
      <Composition id="Ask" component={Ask} durationInFrames={ASK_FRAMES} fps={FPS} width={1920} height={1080} />
      <Composition id="Delegate" component={Delegate} durationInFrames={DELEGATE_FRAMES} fps={FPS} width={1920} height={1080} />
      <Composition id="Run" component={Run} durationInFrames={RUN_FRAMES} fps={FPS} width={1920} height={1080} />
      <Composition id="FollowUp" component={FollowUp} durationInFrames={FOLLOWUP_FRAMES} fps={FPS} width={1920} height={1080} />
      <Composition id="Housekeeping" component={Housekeeping} durationInFrames={HOUSEKEEPING_FRAMES} fps={FPS} width={1920} height={1080} />
      <Composition id="Help" component={Help} durationInFrames={HELP_FRAMES} fps={FPS} width={1920} height={1080} />
      <Composition id="Outro" component={Outro} durationInFrames={OUTRO_FRAMES} fps={FPS} width={1920} height={1080} />
    </Folder>
    <Composition id="Demo" component={Demo} durationInFrames={DEMO_FRAMES} fps={FPS} width={1920} height={1080} />
  </>
);
