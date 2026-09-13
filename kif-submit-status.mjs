export function queueStatusPresentation(item) {
  const analysisStatus = item.analysisStatus || item.status;
  const sourceStored = item.storageStatus === "stored" || (!item.storageStatus && Boolean(item.requestId));
  const labels = {
    queued: "解析：待機中",
    processing: "解析：処理中",
    completed: "解析：完了",
  };
  let analysisLabel = labels[analysisStatus] || `解析：${analysisStatus || "状態不明"}`;
  let failureDetail = "";
  if (analysisStatus === "failed" && sourceStored) {
    analysisLabel = "解析：失敗（原棋譜から再試行できます）";
    failureDetail = item.error || "原棋譜は保存済みです。詳細はWindows workerのログで確認してください";
  } else if (analysisStatus === "failed") {
    analysisLabel = "解析：停止（原棋譜が保存されていません）";
    failureDetail = "原棋譜が保存されていないため、この依頼は再試行できません。KIFを再度貼り付けてください";
  }
  return {
    analysisStatus,
    sourceStored,
    sourceLabel: sourceStored ? "原棋譜：保存済み" : "原棋譜：保存なし",
    analysisLabel,
    failureDetail,
    canRetry: analysisStatus === "failed" && sourceStored,
  };
}
