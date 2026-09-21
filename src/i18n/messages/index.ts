import type { Lang } from "../lang";
import { answers } from "./answers";
import { apply } from "./apply";
import { assistant } from "./assistant";
import { auth } from "./auth";
import { chat } from "./chat";
import { common } from "./common";
import { dashboard } from "./dashboard";
import { errors } from "./errors";
import { history } from "./history";
import { inbox } from "./inbox";
import { labels } from "./labels";
import { legal } from "./legal";
import { mail } from "./mail";
import { nav } from "./nav";
import { network } from "./network";
import { notify } from "./notify";
import { palette } from "./palette";
import { profile } from "./profile";
import { queue } from "./queue";
import { rank } from "./rank";
import { runs } from "./runs";
import { scan } from "./scan";
import { settings } from "./settings";
import { shell } from "./shell";
import { sources } from "./sources";
import { stages } from "./stages";
import { time } from "./time";
import { today } from "./today";
import { ui } from "./ui";

// One namespace per page or concern; every namespace is defined in both languages side by side
// (see ../define.ts). Both trees ship in the client bundle — they are small, and switching
// language then needs no fetch.
function tree(l: Lang) {
  return {
    common: common[l],
    nav: nav[l],
    shell: shell[l],
    ui: ui[l],
    labels: labels[l],
    legal: legal[l],
    mail: mail[l],
    time: time[l],
    rank: rank[l],
    runs: runs[l],
    stages: stages[l],
    answers: answers[l],
    errors: errors[l],
    notify: notify[l],
    settings: settings[l],
    today: today[l],
    queue: queue[l],
    apply: apply[l],
    history: history[l],
    inbox: inbox[l],
    network: network[l],
    profile: profile[l],
    dashboard: dashboard[l],
    sources: sources[l],
    auth: auth[l],
    assistant: assistant[l],
    chat: chat[l],
    palette: palette[l],
    scan: scan[l],
  };
}

export type Messages = ReturnType<typeof tree>;

export const messages: Record<Lang, Messages> = { zh: tree("zh"), en: tree("en") };
