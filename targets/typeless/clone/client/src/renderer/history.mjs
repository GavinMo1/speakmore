// 历史窗口：列出最近的听写，可以复制。有新记录时主进程会通知这里重新读一遍。

const list = document.getElementById("list");
const template = document.getElementById("entry");
const summary = document.getElementById("summary");
const empty = document.getElementById("empty");
const loadError = document.getElementById("load-error");

const clock = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDuration(seconds) {
  const whole = Math.round(seconds);
  return whole < 60 ? `${whole} 秒` : `${Math.floor(whole / 60)} 分 ${whole % 60} 秒`;
}

function renderEntry(row) {
  const node = template.content.firstElementChild.cloneNode(true);
  const time = node.querySelector("time");
  time.dateTime = row.createdAt;
  time.textContent = clock.format(new Date(row.createdAt));
  node.querySelector(".duration").textContent = formatDuration(row.duration);

  const text = node.querySelector(".text");
  const copy = node.querySelector(".copy");
  if (row.status === "failed") {
    node.classList.add("is-failed");
    node.querySelector(".failed").hidden = false;
    text.textContent = row.error;
    copy.hidden = true;
  } else if (row.refinedText === "") {
    node.classList.add("is-silent");
    text.textContent = "没有听到声音";
    copy.hidden = true;
  } else {
    text.textContent = row.refinedText;
    copy.addEventListener("click", async () => {
      try {
        await window.clone.copyText(row.refinedText);
        copy.textContent = "已复制";
      } catch (error) {
        console.error("复制失败", error);
        copy.textContent = "复制失败";
      }
      setTimeout(() => {
        copy.textContent = "复制";
      }, 1500);
    });
  }
  return node;
}

async function refresh() {
  let rows;
  try {
    rows = await window.clone.listHistory();
  } catch (error) {
    console.error("读历史失败", error);
    loadError.textContent = `历史记录读不出来：${error.message}`;
    loadError.hidden = false;
    return;
  }
  loadError.hidden = true;
  empty.hidden = rows.length > 0;
  const completed = rows.filter((row) => row.status === "completed").length;
  summary.textContent = rows.length === 0 ? "" : `最近 ${rows.length} 条，其中 ${rows.length - completed} 条失败`;
  list.replaceChildren(...rows.map(renderEntry));
}

window.clone.onHistoryChanged(refresh);
refresh();
