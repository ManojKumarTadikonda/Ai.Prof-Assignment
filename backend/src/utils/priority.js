const risk={urgent:50,concerning:35,unknown:40,routine:10};
export function priorityScore({patient,campaign,task}){
  const now=Date.now();
  const deadline=new Date(task.deadline||Date.now()+7*86400000).getTime();
  const hours=Math.max(0,(deadline-now)/3600000);
  const deadlineScore=hours<6?50:hours<12?35:hours<24?20:10;
  const retry=Math.min((task.attempts||0)*5,10);
  const callback=task.callbackAt?40:0;
  const riskScore=risk[patient.risk]??40;
  return riskScore+deadlineScore+(campaign.priority||0)+retry+callback;
}
