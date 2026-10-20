// 打发布用的 tar 时都带上的参数（macOS 自带的 bsdtar）：tar 头里不留本机的用户名和编号、不留扩展属性和 Mac 的元数据。
// 发出去的包里不该有这台机器的信息，装的人那边也用不着这些；默认的话 bsdtar 会把它们都写进去。
// 调的时候环境里还要设 COPYFILE_DISABLE=1：不然它会把扩展属性另存成一堆 ._ 开头的文件。
export const TAR_ANONYMOUS = [
  "--uid",
  "0",
  "--gid",
  "0",
  "--uname",
  "",
  "--gname",
  "",
  "--no-xattrs",
  "--no-mac-metadata",
];
