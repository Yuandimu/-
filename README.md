# 部门项目与绩效管理台

## 云端部署

1. 在 Supabase 创建项目。
2. 在 SQL Editor 中运行 `supabase-schema.sql`。
3. 在 Authentication 设置中关闭公开注册，仅通过后台邀请部门成员邮箱。
4. 将 Supabase Project URL 和 anon public key 填入 `config.js`。
5. 将本目录发布到 GitHub Pages。

登录成员共享 `department-project-dashboard` 工作区中的同一份数据。浏览器本地存储仍作为离线副本。

## 权限说明

数据库仅允许已登录用户读写。关闭公开注册后，只有由管理员邀请的邮箱能够登录。
