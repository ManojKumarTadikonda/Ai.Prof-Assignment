import {AuditLog} from '../models/index.js';
export async function audit({hospitalId,actorType='SYSTEM',actorId='',action,entityType,entityId,details={}}){await AuditLog.create({hospitalId,actorType,actorId,action,entityType,entityId,details});}
