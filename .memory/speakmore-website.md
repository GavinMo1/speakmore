---
name: speakmore-website
description: SpeakMore 官网：域名、证书、图片的桶和 CDN、代码在 website/、上线必须用 Docker；图片域名的证书 2027-01-13 到期要续
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

- 官网代码在 `website/`（2026-10-15 第一版）：React + Tailwind v4 + Vite，配置在 `website/site.config.json`，说明在 `website/README.md`。
- 官网的截图不进仓库：放在单独的私有 COS 桶（桶名在 `.machine.env` 的 `SITE_MEDIA_BUCKET`），前面是 CDN 域名 `media.speakmore.zephyrxiang.com`（全球加速、只让 CDN 读、防盗链只放行官网、localhost、127.0.0.1 和空来源、每天 10 GB 封顶超了 404、强制 https）。**这个域名的证书也是 90 天的免费证书，2027-01-13 到期**，和 dl 那张一样要重新申请并在 CDN 上换绑。桶的策略照发布桶抄的（只给 CDN 服务读）：新建的桶不加这条策略，CDN 回源是 403。
- 容器计划：`website/compose.yaml`，容器名 `speakmore-site`，端口 `127.0.0.1:9800`（同机那两个占了 9600、9700）；同机那两个站的代码放在服务器的 `/home/ubuntu/<项目名>`，在那里 `docker compose up -d --build`，构建用国内 npm 镜像。
- **部署必须用 Docker**（2026-10-15 他说的，原话："一定要用 Docker 去部署。因为现在上面有两个网站都是用 Docker 的，咱们给隔离开，就不要相互干扰，你千万别把东西装到全局上了"）。官网打成一个容器，照同机那两个站点的样子接进来；宿主机上不装任何软件、不装 npm 包，构建在本机或容器里做。

**Why:** 他要网站搭好就能上线，不再操心域名和证书；同机还有别的站点，互不干扰。

**How to apply:** 搭官网时直接改这个站点文件的 443 段；不要另起子域名，也不要动同机别的站点。
