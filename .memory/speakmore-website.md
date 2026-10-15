---
name: speakmore-website
description: SpeakMore 官网的域名 speakmore.zephyrxiang.com 已解析到他的腾讯云服务器、证书已签；官网还没搭，443 临时 302 到 GitHub 仓库
metadata:
  node_type: memory
  type: project
  originSessionId: 6b5e9ce5-00ff-48cc-99ba-a927306fc7c3
  modified: 2026-10-15T12:46:06.279Z
---

2026-10-15 他让先把官网的域名备好，再开始搭官网。

- 域名 `speakmore.zephyrxiang.com`：DNSPod 里一条 A 记录指向那台服务器（ssh 别名 `zephyr-web`），和同机的 `aaai4s` 子域名一个样子。解析托管在发布用的同一个腾讯云账号下，用 `scripts/release/with-cos-key.sh` 加载密钥跑 tccli（[[speakmore-release-on-cos]]）。
- 服务器上的 nginx 站点文件是 `/etc/nginx/sites-available/speakmore-site`（软链进 sites-enabled）：80 端口留着 ACME 目录、其余 301 到 https；443 现在只有一条临时的 `return 302` 到 GitHub 仓库，官网上线时换成真正的站点。照同机别的站点的惯例，改完先 `sudo nginx -t` 再 reload。
- 证书是 certbot 签的 Let's Encrypt（webroot `/var/www/letsencrypt`），续期配置里带 `renew_hook = systemctl reload nginx`，系统的 certbot.timer 自动续，不用手动管。
- 这台服务器的资源够放官网（2 核 4G，另外跑着他的个人网站和另一个项目的官网）。安装包仍走 COS 加 CDN（dl.zephyrxiang.com），官网的下载链接从那里取，不占这台机器的带宽。

**Why:** 他要网站搭好就能上线，不再操心域名和证书。

**How to apply:** 搭官网时直接改这个站点文件的 443 段；不要另起子域名，也不要动同机别的站点。
