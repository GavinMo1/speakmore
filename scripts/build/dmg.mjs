// 把签好名、公证过的 SpeakMore.app 装进一个 dmg：打开后左边是应用，右边是"应用程序"的替身，拖过去就装好了。
// dmg 自己也签名、交苹果公证、钉上票据：浏览器下回来的 dmg 带着"来自网络"的标记，系统打开前先查最外面这一层。

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/**
 * @param {{ appPath: string, dmgPath: string, signing: { identity: string, notaryProfile: string } }} options
 */
export function makeDmg({ appPath, dmgPath, signing }) {
  const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
  const stage = mkdtempSync(join(tmpdir(), "speakmore-dmg-"));
  try {
    // ditto 原样拷贝应用包，保留签名、票据和里面的符号链接
    run("ditto", [appPath, join(stage, basename(appPath))]);
    symlinkSync("/Applications", join(stage, "Applications"));
    run("hdiutil", ["create", "-volname", "SpeakMore", "-srcfolder", stage, "-format", "UDZO", "-ov", dmgPath]);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }

  run("codesign", ["--sign", signing.identity, "--timestamp", dmgPath]);
  notarize(dmgPath, signing.notaryProfile);
  run("xcrun", ["stapler", "staple", dmgPath]);
  run("xcrun", ["stapler", "validate", dmgPath]);
  // 双击打开 dmg 时系统做的就是这一项检查
  run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose", dmgPath]);
}

/** 交给苹果公证，等结果。没通过时把苹果给的问题清单打出来，再报错 */
function notarize(file, profile) {
  const output = execFileSync(
    "xcrun",
    ["notarytool", "submit", file, "--keychain-profile", profile, "--wait", "--output-format", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const result = JSON.parse(output);
  if (result.status === "Accepted") {
    console.log(`公证通过：${basename(file)}（${result.id}）`);
    return;
  }
  execFileSync("xcrun", ["notarytool", "log", result.id, "--keychain-profile", profile], { stdio: "inherit" });
  throw new Error(`${basename(file)} 没过公证：${result.status} ${result.message ?? ""}（编号 ${result.id}）`);
}
