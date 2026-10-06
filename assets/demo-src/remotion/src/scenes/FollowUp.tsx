import React from 'react';
import {cap, Lang, t} from '../strings';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const followUpFrames = (lang: Lang) => sceneDuration(cap(lang).sessions, 75);

export const FollowUp: React.FC<{lang: Lang}> = ({lang}) => (
  <TerminalScene lang={lang} {...t[lang].scenes.followUp} steps={cap(lang).sessions} />
);
