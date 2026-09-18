import {AuditLog} from '../models/index.js';
export async function audit({hospitalId,actorType='SYSTEM',actorId='',action,entityType,entityId,details={}}){
  console.log(`[AUDIT] ${action} | ${entityType}:${entityId || "-"} | hospital=${hospitalId || "-"}`);
  return AuditLog.create({hospitalId,actorType,actorId,action,entityType,entityId,details});
}
