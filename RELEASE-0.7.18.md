# 屏幕彼端 v0.7.18

## 说明

本轮（2026-11-13）汇总修复版：面板白屏、安全加固、稳定性、账目、配置拆分、桌宠 UI、低余额提醒、VM 聊天保护、工程化。

## 主要变化

- 面板 iframe 白屏修复（CSP frame-ancestors / lazy 移除）
- 安全：Host/Origin/Sec-Fetch 校验、可选 API token、可选 DPAPI 密钥加密
- 稳定：回合超时/取消/看门狗、上下文预算、异常兜底、events 轮转、GET 缓存
- 账目：全局 token 账本、集中记账、换 Key 重置、金额口径说明
- 配置：config.json + data/world.json 拆分与原子写
- 桌宠：素材目录化、属性面板悬停修复、金额移入属性面板、按钮上移、低余额主动提醒
- VM 聊天：白名单/未读/图片/守护/校验/登录页保护、视觉 reasoning 兜底
- 工程：冒烟测试 22 项、eslint

## 版本

- 0.7.18