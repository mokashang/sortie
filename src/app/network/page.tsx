import { NetworkClient } from "./network-client";
import { NetworkAssistant } from "./network-assistant";

export const dynamic = "force-dynamic";

export default function NetworkPage() {
  return (
    <div>
      <h1>人脉</h1>
      <p className="panel-sub">
        这里只做两件事:探索隐藏机会(hidden_opportunity)和约 coffee chat。岗位相关的内推请求在「投递」页的「内推进行中」里处理,不在这里显示。
        联系人可以手动添加,也会被找人执行器自动写入。选联系人 + 剧本点"AI 草稿"生成初稿;草稿区可编辑后批准发送——执行器只发送你批准过的原文,LinkedIn
        消息由执行器发送,Email 走 mailto:(你自己的邮件客户端发)。
      </p>
      <NetworkAssistant pendingSend={0} />
      <NetworkClient />
    </div>
  );
}
