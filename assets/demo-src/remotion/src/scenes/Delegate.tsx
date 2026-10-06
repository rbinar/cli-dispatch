import React from 'react';
import {cap, Lang, t} from '../strings';
import {TerminalScene} from '../TerminalScene';
import {sceneDuration} from '../timing';

export const delegateFrames = (lang: Lang) => sceneDuration(cap(lang).agent, 120);

export const Delegate: React.FC<{lang: Lang}> = ({lang}) => (
  <TerminalScene lang={lang} {...t[lang].scenes.delegate} steps={cap(lang).agent} />
);
