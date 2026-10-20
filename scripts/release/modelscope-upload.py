"""把一个目录传到魔搭（ModelScope）上的一个模型仓库：仓库没有就建一个公开的，再把目录里的文件传上去。

只由 sync-models.mjs 调用：本机核对、写说明、传完从魔搭上逐个核对，都在那边。魔搭只有 Python 的 SDK，所以单独这一小段。
用项目里装的 SDK 跑（modelscope-sdk.sh），令牌从环境变量 MODELSCOPE_API_TOKEN 来。

标准输入一个 JSON：
  repo         组织/仓库名
  folder       要传的目录（里面的排法就是仓库里的排法）
  license      许可（魔搭认的写法，比如 apache-2.0）
  description  一句话说明
  message      这次提交的说明
  tracker      断点续传的记录放哪（放在 folder 外面，临时目录删了也能接着传）
标准输出最后一行一个 JSON：{"created": 这次是不是新建的仓库}
"""

import json
import os
import sys

from modelscope_hub.api import HubApi


def main() -> None:
    job = json.load(sys.stdin)
    token = os.environ.get("MODELSCOPE_API_TOKEN")
    if not token:
        sys.exit("环境里没有 MODELSCOPE_API_TOKEN：用 scripts/release/with-modelscope-key.sh 跑")
    api = HubApi(token=token)
    created = False
    if not api.repo_exists(job["repo"], "model"):
        api.create_repo(
            job["repo"],
            "model",
            visibility="public",
            license=job["license"],
            description=job["description"],
        )
        created = True
    # 已经在上面、内容一样的文件 SDK 自己会跳过；断了再跑从 tracker 记的地方接着传
    api.upload_folder(
        job["repo"],
        "model",
        job["folder"],
        commit_message=job["message"],
        tracker_path=job["tracker"],
        disable_tqdm=True,
    )
    print(json.dumps({"created": created}))


if __name__ == "__main__":
    main()
