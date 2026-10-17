# 官网的镜像：构建静态页，用 nginx 托管。从仓库根构建（要读根上 package.json 的版本号、assets/icon.svg 和下面拷的两份）：
#   docker build -f website/Dockerfile .
# 平时用 website/compose.yaml 起。
FROM node:22-alpine AS build
WORKDIR /repo/website
# 服务器在大陆时传国内的 npm 镜像进来（compose.yaml 的 NPM_REGISTRY），默认是官方源
ARG NPM_REGISTRY=https://registry.npmjs.org
# 依赖层单独缓存：只有锁文件变了才重新装
COPY website/package.json website/package-lock.json ./
RUN npm ci --no-audit --no-fund --registry="$NPM_REGISTRY"
COPY package.json /repo/package.json
COPY assets/icon.svg /repo/assets/icon.svg
# README 的图的清单（图在图片桶上）、各家模型的标志，都和仓库里 App、README 用的是同一份
COPY docs/media.json /repo/docs/media.json
COPY src/renderer/shared/provider-icons.mjs /repo/src/renderer/shared/provider-icons.mjs
COPY website/ ./
RUN npm run build

FROM nginx:1.28-alpine
# 去掉镜像自带的站点配置和欢迎页、50x.html，只留构建出来的
RUN rm -f /etc/nginx/conf.d/default.conf && rm -rf /usr/share/nginx/html/*
COPY website/nginx.conf /etc/nginx/conf.d/site.conf
COPY --from=build /repo/website/dist /usr/share/nginx/html
EXPOSE 80
# 写 127.0.0.1 不写 localhost：容器里 localhost 可能先解析成 IPv6，nginx 只听 IPv4
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO /dev/null http://127.0.0.1/health || exit 1
