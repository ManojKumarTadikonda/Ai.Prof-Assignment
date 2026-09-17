import crypto from 'node:crypto';
export function randomToken(){return crypto.randomBytes(32).toString('hex');}
export function hashToken(token){return crypto.createHash('sha256').update(token).digest('hex');}
export function addHours(date,h){return new Date(new Date(date).getTime()+h*3600000);}
