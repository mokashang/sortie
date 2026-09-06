import { SourcesBoard } from "./sources-board";

export const dynamic = "force-dynamic";

// 来源页:每个信息源(招聘系统家族 / 清单 / LinkedIn / Chrome 站点)的产出、层级(多久问一次)、错误,
// 以及三个动作:立即扫描(核心 + 清单)、导入开源目录、Chrome 扫描。
export default function SourcesPage() {
  return (
    <div>
      <h1>来源</h1>
      <p className="panel-sub">
        后台每分钟检查一次哪些板块该问了:core 每小时、longtail 每天、dormant 每周、muted 不问。层级按过去 90 天的产出自动升降,你手动改过的不再自动动。
      </p>
      <SourcesBoard />
    </div>
  );
}
