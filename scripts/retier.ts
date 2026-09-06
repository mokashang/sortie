import { getDb } from "../src/lib/db";
import { retierAll } from "../src/scanner/retier";

// 手动重算板块分级(平时每天 03:xx 由 tick 自动跑)。
const r = retierAll(getDb());
console.log(`retier: ${r.changed} boards changed`);
