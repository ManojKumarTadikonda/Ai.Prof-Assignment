const risk = { urgent: 50, concerning: 35, unknown: 40, routine: 10 };

export function deadlinePressure(deadline, now = Date.now()) {
  if (!deadline) return 10;
  const hours = (new Date(deadline).getTime() - now) / 3600000;
  if (hours <= 0) return 90;
  if (hours < 2) return 70;
  if (hours < 6) return 50;
  if (hours < 12) return 35;
  if (hours < 24) return 20;
  return 10;
}

export function priorityScore({ patient, campaign, task, now = Date.now() }) {
  const deadline = task?.deadline || Date.now() + 7 * 86400000;
  const riskScore = risk[patient?.risk] ?? 40;
  const deadlineScore = deadlinePressure(deadline, now);
  const campaignPriority = Number(campaign?.priority || 0);
  const retryPressure = Math.min(Number(task?.attempts || 0) * 5, 15);
  const callbackBonus = task?.callbackAt ? 40 : 0;
  const waitingHours = task?.createdAt
    ? Math.max(0, (now - new Date(task.createdAt).getTime()) / 3600000)
    : 0;
  const agingBonus = waitingHours >= 4 ? 10 : waitingHours >= 2 ? 5 : 0;

  return Math.round(
    riskScore +
      deadlineScore +
      campaignPriority +
      retryPressure +
      callbackBonus +
      agingBonus,
  );
}

export function explainPriority({ patient, campaign, task, now = Date.now() }) {
  const deadline = task?.deadline || Date.now() + 7 * 86400000;
  const hoursRemaining = (new Date(deadline).getTime() - now) / 3600000;
  return {
    risk: risk[patient?.risk] ?? 40,
    deadline: deadlinePressure(deadline, now),
    campaign: Number(campaign?.priority || 0),
    retry: Math.min(Number(task?.attempts || 0) * 5, 15),
    callback: task?.callbackAt ? 40 : 0,
    aging: task?.createdAt
      ? ((now - new Date(task.createdAt).getTime()) / 3600000 >= 4 ? 10 : (now - new Date(task.createdAt).getTime()) / 3600000 >= 2 ? 5 : 0)
      : 0,
    hoursRemaining: Number.isFinite(hoursRemaining) ? Number(hoursRemaining.toFixed(2)) : null,
  };
}
