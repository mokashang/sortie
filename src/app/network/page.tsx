import { NetworkClient } from "./network-client";
import { ExecutorPanel } from "@/app/components/executor-panel";

export const dynamic = "force-dynamic";

export default function NetworkPage() {
  return (
    <div>
      <h1>人脉</h1>
      <p style={{ color: "#666", fontSize: 13, margin: "8px 0 16px" }}>
        联系人可以手动添加,也会被找人执行器自动写入。选联系人 + 剧本 + 可选关联岗位点"AI
        草稿"生成初稿;草稿区可编辑后批准发送——执行器只发送你批准过的原文,LinkedIn 消息由执行器发送,Email
        走 mailto:(你自己的邮件客户端发)。下面两个按钮直接从 App 里启动执行器,不用再手动开 claude 会话。
      </p>
      <ExecutorPanel
        kinds={[
          { kind: "network_send", label: "发送已批准消息" },
          { kind: "network_find", label: "找人(队列头部公司)" },
        ]}
      />
      <NetworkClient />
    </div>
  );
}
