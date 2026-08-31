import { NetworkClient } from "./network-client";

export const dynamic = "force-dynamic";

export default function NetworkPage() {
  return (
    <div>
      <h1>人脉</h1>
      <p style={{ color: "#666", fontSize: 13, margin: "8px 0 16px" }}>
        联系人可以手动添加,也会被 network-executor 找人模式自动写入。选联系人 + 剧本 + 可选关联岗位点"AI
        草稿"生成初稿;草稿区可编辑后批准发送——执行器只发送你批准过的原文,LinkedIn 消息由执行器发送,Email
        走 mailto:(你自己的邮件客户端发)。
      </p>
      <NetworkClient />
    </div>
  );
}
