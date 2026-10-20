// 版本号：认什么写法、怎么比大小。下载地址上的 channel.json、App 的 Info.plist、各份程序的 package.json 都按这里认。

/** 和安装脚本认的写法一样：v0.6.0、0.6.0-rc.1 */
const VERSION = /^v?(\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.-]+)?)$/;

/** 去掉开头的 v 的版本号；不像版本号的（比如问到的其实是一个报错的网页）是 null */
export function parseVersion(text) {
  return VERSION.exec(String(text ?? "").trim())?.[1] ?? null;
}

/**
 * 两个版本号比大小：按数比（0.10.0 比 0.9.0 新）；同一个号的预发版比正式版旧，预发版之间按 rc.9 < rc.10 比。
 * @returns {number} a 新是正数，一样是 0，a 旧是负数
 */
export function compareVersions(a, b) {
  const split = (version) => {
    const [core, ...pre] = version.split("-");
    return { numbers: core.split(".").map(Number), pre: pre.join("-") };
  };
  const left = split(a);
  const right = split(b);
  for (let index = 0; index < 3; index++) {
    const difference = left.numbers[index] - right.numbers[index];
    if (difference !== 0) return difference;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === "") return 1;
  if (right.pre === "") return -1;
  return left.pre.localeCompare(right.pre, "en", { numeric: true });
}
