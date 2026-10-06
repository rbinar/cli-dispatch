import {captures, capturesTr} from './captures';

export type Lang = 'en' | 'tr';

export const cap = (lang: Lang) => (lang === 'tr' ? capturesTr : captures);

type Caption = {step: string; title: string; subtitle: string};

export const t: Record<Lang, {
  kicker: string;
  pitch: string;
  recorded: string;
  outroTitle: string;
  outroLine: string;
  scenes: Record<'install' | 'doctor' | 'ask' | 'delegate' | 'run' | 'followUp' | 'housekeeping' | 'help', Caption>;
}> = {
  en: {
    kicker: 'Claude Code plugin',
    pitch: "Hand Claude Code's work to",
    recorded: 'Every output in this video was recorded in a clean Debian container.',
    outroTitle: '12 commands. 5 workers.',
    outroLine: 'Claude Code reviews. The workers do the work.',
    scenes: {
      install: {step: '01 · Install', title: 'Install', subtitle: 'two plugin commands, then setup'},
      doctor: {step: '02 · Check', title: 'Doctor', subtitle: 'health per backend'},
      ask: {step: '03 · Ask', title: 'Ask a worker', subtitle: 'one-shot, read-only'},
      delegate: {step: '04 · Delegate', title: 'Just ask Claude', subtitle: 'the runner agent delegates and verifies'},
      run: {step: '05 · Run', title: 'Run directly', subtitle: 'worktree · verify · verdict · 0 LLM tokens'},
      followUp: {step: '06 · Follow up', title: 'Sessions & resume', subtitle: 'every worker run is resumable'},
      housekeeping: {step: '07 · Measure', title: 'Gain & clean', subtitle: 'token totals, stale-session cleanup'},
      help: {step: '08 · Reference', title: 'Help', subtitle: 'the whole surface'},
    },
  },
  tr: {
    kicker: 'Claude Code eklentisi',
    pitch: "Claude Code'un işini devret:",
    recorded: "Videodaki her çıktı temiz bir Debian container'ında kaydedildi.",
    outroTitle: '12 komut. 5 worker.',
    outroLine: "Claude Code inceler, işi worker'lar yapar.",
    scenes: {
      install: {step: '01 · Kurulum', title: 'Kurulum', subtitle: 'iki plugin komutu, sonra setup'},
      doctor: {step: '02 · Kontrol', title: 'Doctor', subtitle: 'backend başına sağlık kontrolü'},
      ask: {step: '03 · Sor', title: "Worker'a sor", subtitle: 'tek seferlik, salt-okunur'},
      delegate: {step: '04 · Devret', title: "Claude'a söyle yeter", subtitle: 'runner agent devreder ve doğrular'},
      run: {step: '05 · Run', title: 'Doğrudan çalıştır', subtitle: 'worktree · verify · verdict · 0 LLM token'},
      followUp: {step: '06 · Takip', title: 'Sessions ve resume', subtitle: 'her worker koşusu sürdürülebilir'},
      housekeeping: {step: '07 · Ölçüm', title: 'Gain ve clean', subtitle: 'token toplamları, bayat oturum temizliği'},
      help: {step: '08 · Referans', title: 'Help', subtitle: 'komutların tamamı'},
    },
  },
};
